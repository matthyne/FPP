; FM92R fork: new code, included by FM92R.asm at the start of the free area.
;
; PC is $15AF here. Everything up to $1B3F is free (1425 bytes of $00 in the
; master). Hook new routines into the original code by overwriting an original
; instruction with JSR/JMP (plus NOPs to keep the size), so every `.at` in
; FM92R.asm still matches.

; =============================================================================
; Feature: Rx frequency on the control head
;
; After the channel number has been on the head for 2 s, show the channel's Rx
; frequency two characters at a time, 0.5 s each, sliding one character per
; step, then the channel number again for 2 s, and repeat, until something
; else is put on the display (channel change, scan, selcall, display off).
; 147.450 MHz shows: 14, 47, "7 ", " 4", 45, 50 (the '.' is shown as a space).
;
; The firmware can't work out the frequency itself (the step and IF depend on
; the hardware code), so mkradio.py writes a per-channel table (FQ_TABLE, below)
; when it builds the radio image. A channel with no table entry (e.g. an image
; built by plain fm900gen) just shows its channel number, as before.
;
; Table: 4 arrays of 100 bytes (FQ0..FQ3, index = channel number 1-99).
; Byte k of a channel holds characters 2k (high nibble) and 2k+1 (low nibble):
;   0-9 = digit, $F = the decimal point (shown as a space), $E = end.
; 147.450 -> 14 7F 45 0E ;  477.0125 -> 47 7F 01 25 ;  77.500 -> 77 F5 00 EE.
; Byte 0 = 0 means "no entry" (a frequency never starts with 0).
;
; Hooks (each in an `.if FORK` block in FM92R.asm, same size as the original):
;   $0270 wait_startup    clr $10 ; lda #$aa      -> jsr fq_init ; nop
;   $0C09 head_display_off lda #$e5 ; bclr 3,$1c  -> jsr fq_dispoff ; nop
;   $0C14 show_channel    lda $2e ; brclr 6,$13,L -> jsr fq_showch ; bra L_0c1b
;   $0C24 display_digits  sta $41 ; and #$0f      -> jsr fq_disp ; nop
;   $0DCC main loop end   jmp main_loop           -> jmp fq_main
;
; Head link: the display bytes use the same messages as display_digits:
; $80 + right character, $82 + left character (display_digits sends the low
; nibble with $80; show_channel puts the tens digit, blanked when 0, in the
; high nibble). A window is only sent when the UART FIFO is empty and no
; keep-alive reply ($49 to our $E4) is due, so it never talks over the head's
; reply (two missed replies = the radio switches off, FIRMWARE.md §6.3).
; =============================================================================

; RAM. $B8-$BD lie in the unused gap of the external RAM ($A0-$A4 and $BE-$EC
; are used by the selcall code; nothing in the firmware touches $A5-$BD).
FQ_FLAGS        equ     $b8     ; bit 0 = armed by show_channel, bit 1 = cycling
FQ_IDX          equ     $b9     ; 0 = channel number shown, n = window n shown
FQ_CH           equ     $ba     ; channel whose frequency is shown
FQ_CHB          equ     $bb     ; packed channel display byte (as display_digits takes it)
FQ_TMP          equ     $bc
FQ_K            equ     $bd

FQ_TIMER        equ     $57     ; spare 27 ms soft timer (FIRMWARE.md §16.2)
T_CHAN          equ     74      ; 75 x 26.6 ms = 2.0 s
T_STEP          equ     18      ; 19 x 26.6 ms = 0.51 s

FQ_MAGIC        equ     $19ac   ; "FQT1": mkradio.py checks this before filling the table
FQ0             equ     $19b0
FQ1             equ     FQ0+100
FQ2             equ     FQ0+200
FQ3             equ     FQ0+300

; ---- hook at $0270 (warm start, before the start-up message)
fq_init:
        clr     $10                     ; (replaced)
        clr     FQ_FLAGS
        lda     #$aa                    ; (replaced)
        rts

; ---- hook at $0C09 (head_display_off: intermittent display blanks)
fq_dispoff:
        bclr    0,FQ_FLAGS
        bclr    1,FQ_FLAGS
        lda     #$e5                    ; (replaced)
        bclr    3,$1c                   ; (replaced)
        rts

; ---- hook at $0C14 (show_channel). Same choice of channel as the original,
; remembered, and arms fq_disp; returns with A = channel for bin_to_bcd.
fq_showch:
        lda     $2e
        brclr   6,$13,fq_sc1
        lda     $50                     ; vote/scan: the home channel
fq_sc1: sta     FQ_CH
        bset    0,FQ_FLAGS
        rts

; ---- hook at $0C24 (display_digits entry, A = packed digits). If this call
; came from show_channel in the normal display mode and the channel has a
; table entry, start the cycle; any other display write stops it.
fq_disp:
        sta     $41                     ; (replaced)
        brclr   0,FQ_FLAGS,fq_off
        bclr    0,FQ_FLAGS
        brset   1,$1e,fq_off            ; scan-style display ($81/$83): leave it alone
        sta     FQ_CHB
        ldx     FQ_CH
        cpx     #100
        bcc     fq_off
        lda     FQ0,x
        beq     fq_off                  ; no frequency for this channel
        clr     FQ_IDX
        lda     #T_CHAN
        sta     FQ_TIMER
        bset    1,FQ_FLAGS
        bra     fq_d1
fq_off: bclr    0,FQ_FLAGS
        bclr    1,FQ_FLAGS
fq_d1:  lda     $41
        and     #$0f                    ; (replaced)
        rts

; ---- hook at $0DCC (end of the main loop)
fq_main:
        jsr     fq_task
        jmp     main_loop

fq_task:
        brclr   1,FQ_FLAGS,fq_ret
        brclr   0,$11,fq_rx
        ; transmitting: put the channel number back, hold the 2 s timer
        lda     FQ_IDX
        beq     fq_hold
        brset   5,$1c,fq_ret            ; keep-alive reply due
        brset   1,$1a,fq_ret            ; UART FIFO not empty
        lda     FQ_CHB
        jsr     fq_send
        clr     FQ_IDX
fq_hold:
        lda     #T_CHAN
        sta     FQ_TIMER
fq_ret: rts

fq_rx:  brclr   7,FQ_TIMER,fq_ret       ; time for the next step?
        brset   5,$1c,fq_ret            ; keep-alive reply due: try again later
        brset   1,$1a,fq_ret            ; UART FIFO not empty: try again later
        lda     #T_STEP
        sta     FQ_TIMER
        inc     FQ_IDX
        lda     FQ_IDX
        cmp     #8
        bcc     fq_chan
        jsr     fq_nib                  ; right character = character IDX
        cmp     #$0e
        beq     fq_chan                 ; past the end
        sta     FQ_TMP
        lda     FQ_IDX
        deca
        jsr     fq_nib                  ; left character = character IDX-1
        lsla
        lsla
        lsla
        lsla
        ora     FQ_TMP
        bra     fq_send

fq_chan:                                ; end of the frequency: channel number for 2 s
        clr     FQ_IDX
        lda     #T_CHAN
        sta     FQ_TIMER
        lda     FQ_CHB

; A = two characters: high nibble left ($82), low nibble right ($80); $F = space.
; Like display_digits, but without restarting the display timeout.
fq_send:
        sta     FQ_TMP
        and     #$0f
        bsr     fq_char
        lda     #$80
        jsr     head_send2
        lda     FQ_TMP
        lsra
        lsra
        lsra
        lsra
        bsr     fq_char
        lda     #$82
        jmp     head_send2

fq_char:                                ; A = nibble -> X = character
        cmp     #$0f
        bne     fq_c1
        ldx     #$20
        rts
fq_c1:  add     #$30
        tax
        rts

; A = character index 0-7 -> A = that nibble of FQ_CH's table entry
fq_nib:
        sta     FQ_K
        lsra
        ldx     FQ_CH
        tsta
        beq     fq_b0
        deca
        beq     fq_b1
        deca
        beq     fq_b2
        lda     FQ3,x
        bra     fq_nb
fq_b0:  lda     FQ0,x
        bra     fq_nb
fq_b1:  lda     FQ1,x
        bra     fq_nb
fq_b2:  lda     FQ2,x
fq_nb:  brset   0,FQ_K,fq_lo            ; odd index = low nibble
        lsra
        lsra
        lsra
        lsra
        rts
fq_lo:  and     #$0f
        rts

; ---- frequency table (filled per radio by mkradio.py)
        .org    FQ_MAGIC
        db      "FQT1"
FQ_TABLE:
        ds      400
        .at     $1b40

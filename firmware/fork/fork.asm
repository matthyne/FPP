; FM92R fork: new code, included by FM92R.asm at the start of the free area.
;
; PC is $15AF here. Everything up to $1B3F is free (1425 bytes of $00 in the
; master). Hook new routines into the original code by overwriting an original
; instruction with JSR/JMP (plus NOPs to keep the size), so every `.at` in
; FM92R.asm still matches.
;
; Features, selected by build.py with -D (each 0 or 1):
;   INTRO  start-up: "00" on the head and a Morse ident (callsign from a table)
;   FREQ   Rx frequency on the head after the channel number
;   NOHOOK scan ignores the handset hook: an off-hook handset neither stops the
;          scan nor sounds the continuous off-hook tone (FIRMWARE.md 7.3)
; Variants: FM92R-intro.BIN = INTRO + NOHOOK; FM92R-fork.BIN ("enhanced") =
; INTRO + FREQ + NOHOOK.
;
; Hooks (in `.if` blocks in FM92R.asm, each the same size as the original):
;   $0270 wait_startup    clr $10 ; lda #$aa ; jsr head_send
;                                             -> jsr fork_init ; 4 x nop   (FORK)
;   $0C09 head_display_off lda #$e5 ; bclr 3,$1c  -> jsr fq_dispoff ; nop  (FREQ)
;   $0C14 show_channel    lda $2e ; brclr 6,$13,L -> jsr fq_showch ; bra L_0c1b (FREQ)
;   $0C24 display_digits  sta $41 ; and #$0f      -> jsr fq_disp ; nop     (FREQ)
;   $0DCC main loop end   jmp main_loop           -> jmp fq_main           (FREQ)
;   $0EC0, $0EF1, $0FC7 scan_task  brset 4,$11,L -> 3 x nop                 (NOHOOK)
;
; Head display messages: $80 + right character, $82 + left character
; (display_digits sends the low nibble with $80; show_channel puts the tens
; digit, blanked when 0, in the high nibble).

; RAM. $B8-$BD lie in the unused gap of the external RAM ($A0-$A4 and $BE-$EC
; are used by the selcall code; nothing in the firmware touches $A5-$BD).
FQ_FLAGS        equ     $b8     ; bit 0 = armed by show_channel, bit 1 = cycling, bit 2 = blank shown
FQ_IDX          equ     $b9     ; 0 = channel number shown, n = window n shown
FQ_CH           equ     $ba     ; channel whose frequency is shown
FQ_CHB          equ     $bb     ; packed channel display byte (as display_digits takes it)
FQ_TMP          equ     $bc
FQ_K            equ     $bd

MO_IDX          equ     $b7     ; Morse table index (start-up only)
MO_TMP          equ     $b6

FQ_TIMER        equ     $57     ; spare 27 ms soft timer (FIRMWARE.md §16.2)
T_CHAN          equ     74      ; 75 x 26.6 ms = 2.0 s
T_STEP          equ     18      ; 19 x 26.6 ms = 0.51 s

MO_MAGIC        equ     $1978   ; "MOR1": the tools check this before writing the callsign
MO_TAB          equ     $197c   ; 48 bytes, up to FQ_MAGIC
MO_UNIT         equ     5       ; Morse unit = 5 x 13.3 ms = 66.5 ms (18 wpm)
FQ_MAGIC        equ     $19ac   ; "FQT1": mkradio.py checks this before filling the table
FQ0             equ     $19b0
FQ1             equ     FQ0+100
FQ2             equ     FQ0+200
FQ3             equ     FQ0+300

; ---- hook at $0270 (warm start: the start-up message to the head)
fork_init:
        clr     $10                     ; (replaced)
        .if FREQ
        clr     FQ_FLAGS
        .endif
        lda     #$aa                    ; (replaced) start-up message
        jsr     head_send               ; (replaced)
        .if INTRO
        jsr     intro
        .endif
        rts

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


        .if INTRO
; =============================================================================
; Feature INTRO: start-up "00" and Morse ident
;
; Right after the start-up message ($AA), before the channel is selected, show
; "00" on the head and key the callsign in MO_TAB on the radio's beep tone
; ($29.7, the same tone as the key beep: uart_bit toggles $29.4 at ~600 Hz while
; $29.7 is set). Then the normal start-up carries on and shows the channel.
; With an empty table, "00" is shown for 1 s and there is no sound.
;
; Speed 18 wpm: 1 unit = 5 flips of bit 5 of the timer ISR's tick counter $28
; (it flips every 32 ticks of ~415 us = 13.3 ms) = 66.5 ms.
;
; This blocks for the length of the ident (VK2FN: 68 units incl. the final
; pause = 4.5 s). The
; main loop isn't running, so no keep-alive poll ($E4) is sent and nothing can
; time out; keys pressed on the head meanwhile are ignored.
;
; MO_TAB (filled by mkradio.py / WebFPP from the callsign text):
;   1 = dit, 3 = dah (then a 1-unit gap), $80 = end of letter (2 more units),
;   $81 = word space (6 more units), 0 = end.
; =============================================================================
intro:
        lda     #$00
        jsr     fq_send                 ; "00"
        clr     MO_IDX
        lda     MO_TAB
        bne     mo_next
        lda     #15                     ; no callsign: hold "00" for 1 s
        bra     mo_wait
mo_next:
        ldx     MO_IDX
        inc     MO_IDX
        lda     MO_TAB,x                ; sets N and Z for the tests below
        beq     mo_end
        bmi     mo_gap
        bset    7,$29                   ; tone on for 1 or 3 units
        bsr     mo_wait
        bclr    7,$29
        lda     #1                      ; gap between elements
        bsr     mo_wait
        bra     mo_next
mo_gap: and     #$01
        beq     mo_g1
        lda     #6                      ; word space: 1 + 6 = 7 units
        bra     mo_g2
mo_g1:  lda     #2                      ; letter space: 1 + 2 = 3 units
mo_g2:  bsr     mo_wait
        bra     mo_next
mo_end: lda     #6                      ; a short pause before the channel shows
; wait A Morse units (A x MO_UNIT x 13.3 ms, A <= 51), timed from the tick counter $28
mo_wait:
        sta     MO_TMP
        lsla
        lsla
        add     MO_TMP                  ; x 5 (MO_UNIT)
        sta     MO_TMP                  ; = number of 13.3 ms steps
mo_w0:  ldx     $28                     ; X = tick counter now
mo_w1:  txa
        eor     $28
        and     #$20                    ; bit 5 flips every 32 ticks
        beq     mo_w1
        dec     MO_TMP
        bne     mo_w0
        rts

        .endif

        .if FREQ
; =============================================================================
; Feature FREQ: Rx frequency on the control head
;
; After the channel number has been on the head for 2 s, blank the display
; for 0.5 s, show the channel's Rx frequency two characters at a time, 0.5 s
; each, sliding one character per step, blank for 0.5 s, then the channel
; number again for 2 s, and repeat, until something else is put on the display
; (channel change, scan, selcall, display off).
; 147.450 MHz on channel 3: " 3" (2 s), "  ", 14, 47, "7 ", " 4", 45, 50, "  ",
; " 3" ... (the '.' is shown as a space; blank = two spaces).
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
; A window is only sent when the UART FIFO is empty and no keep-alive reply
; ($49 to our $E4) is due, so it never talks over the head's reply (two missed
; replies = the radio switches off, FIRMWARE.md §6.3).
; =============================================================================
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
        bclr    2,FQ_FLAGS
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
        brset   2,FQ_FLAGS,fq_tx1       ; blank shown
        lda     FQ_IDX
        beq     fq_hold                 ; channel number already shown
fq_tx1: brset   5,$1c,fq_ret            ; keep-alive reply due
        brset   1,$1a,fq_ret            ; UART FIFO not empty
        lda     FQ_CHB
        jsr     fq_send
        clr     FQ_IDX
        bclr    2,FQ_FLAGS
fq_hold:
        lda     #T_CHAN
        sta     FQ_TIMER
fq_ret: rts

fq_rx:  brclr   7,FQ_TIMER,fq_ret       ; time for the next step?
        brset   5,$1c,fq_ret            ; keep-alive reply due: try again later
        brset   1,$1a,fq_ret            ; UART FIFO not empty: try again later
        lda     #T_STEP
        sta     FQ_TIMER
        ; Sequence: channel (2 s), blank, windows 1..n, blank, channel ...
        ; (each step 0.5 s). FQ_FLAGS bit 2 = the blank is shown; FQ_IDX tells
        ; which blank: 0 = before the frequency, >0 = after it.
        brclr   2,FQ_FLAGS,fq_r1
        bclr    2,FQ_FLAGS
        lda     FQ_IDX
        bne     fq_chan                 ; blank after the frequency: channel next
        bra     fq_win                  ; blank before it: first window next
fq_r1:  lda     FQ_IDX
        beq     fq_blank                ; channel shown: blank next
fq_win: inc     FQ_IDX
        lda     FQ_IDX
        cmp     #8
        bcc     fq_blank
        jsr     fq_nib                  ; right character = character IDX
        cmp     #$0e
        beq     fq_blank                ; past the end: blank, then the channel
        sta     FQ_TMP
        lda     FQ_IDX
        deca
        jsr     fq_nib                  ; left character = character IDX-1
        lsla
        lsla
        lsla
        lsla
        ora     FQ_TMP
        jmp     fq_send

fq_blank:                               ; both characters blank for 0.5 s
        bset    2,FQ_FLAGS
        lda     #$ff                    ; $F = space
        jmp     fq_send

fq_chan:                                ; after the frequency: channel number for 2 s
        clr     FQ_IDX
        lda     #T_CHAN
        sta     FQ_TIMER
        lda     FQ_CHB
        jmp     fq_send

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

        .endif

; ---- tables at fixed addresses, after all the code (filled per radio by
; mkradio.py / WebFPP; their addresses are constants in those tools)
        .if INTRO
        .org    MO_MAGIC
        db      "MOR1"
MO_TABLE:
        ds      48
        .at     FQ_MAGIC
        .endif
        .if FREQ
; ---- frequency table (filled per radio by mkradio.py)
        .org    FQ_MAGIC
        db      "FQT1"
FQ_TABLE:
        ds      400
        .at     $1b40
        .endif

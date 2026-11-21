; FM92R firmware fork: editable source.
;
; Generated once from fm900/MASTERS/FM92R.BIN by mkasm.py, then edited by hand.
; Unmodified, it assembles byte-identical to the master (test_fork.py checks this).
;
; Rules (see README.md in this folder):
;  * Every original label is pinned with `.at` to its master address. Never
;    insert or delete bytes in the original code: hook new code in by
;    overwriting an instruction with JSR/JMP (+ NOPs to keep the size).
;  * New code goes in the free area at the end ($15AF-$1B3F).
;  * $0000-$00FF (hidden behind on-chip RAM) and $1B40-$1FFF (channel table,
;    configuration, master ID, vectors) are kept verbatim. fm900gen overwrites
;    the configuration when it builds a radio image.
;  * BSET n = $10+2n, BCLR n = $11+2n (Motorola manual).

; Build with build.py, which assembles it twice: -D FORK=0 (stock, must equal the
; master) and -D FORK=1 (the fork). Wrap every change to original code in
;         .if FORK
;         <new bytes, same size>
;         .else
;         <original instructions>
;         .endif
; so the stock build keeps proving the rest of the source is untouched.

        .free   $15AF, $1B3F

; ---- $0000-$00FF: hidden behind on-chip I/O and RAM. Do not edit: the $AC at
; $0023 makes these bytes sum to 0, so the firmware checksum (0x0100-0x1FFF) and
; fm900gen's whole-image checksum agree.
        .org    $0000
        db      $43, $4f, $50, $59, $52, $49, $47, $48, $54, $20, $28, $43, $29, $20, $31, $39
        db      $38, $32, $2c, $20, $50, $48, $49, $4c, $49, $50, $53, $20, $54, $2e, $4d, $2e
        db      $43, $2e, $ac, $00

; ---- $0100-$15AE: original FM92R code (pinned)
        .org    $0100

RESET:                           .at $0100
        sei                                     ; reset vector: SEI, reset stack, set up ports
        rsp     
        jsr     init_ports
        jsr     init_ddr
        jsr     latch29_init
        lda     #$19
        bsr     delay_A
        bsr     chk_ram_config
        clr     $3b
        clr     $3c
        bclr    1,$1a
        lda     $20
        bclr    5,$04
        brset   5,$00,L_0128                    ; PA5 = on/off switch sense; $20 = power state (0x11 off, 0x99 on)
        cmp     #$11                            ; PA5 low (supply glitch): stay off if off, carry on if on
        beq     power_down_stop
        cmp     #$99
        bne     cold_start
        bra     L_0136

L_0128:                          .at $0128
        cmp     #$99                            ; PA5 high (on/off pressed): on -> off, off -> on
        beq     power_down_stop
        cmp     #$11
        bne     cold_start
        lda     #$99
        sta     $20
        bset    5,$2a                           ; latch $2A bit 5 set only while on (switched supply enable, inferred)

L_0136:                          .at $0136
        bset    5,$04
        jsr     auto_power_off_reset
        jmp     warm_start

chk_ram_config:                  .at $013e
        lda     $2b                             ; compare RAM copy of option bytes with EPROM 1F2E/1F33..1F37 (warm start?)
        cmp     $1f2e
        bne     cold_start
        ldx     #$05

L_0147:                          .at $0147
        lda     $2e,x
        cmp     $1f32,x
        bne     cold_start
        decx    
        bne     L_0147
        rts     

delay_A:                         .at $0152
        ldx     #$a3

L_0154:                          .at $0154
        decx    
        bne     L_0154
        deca    
        bne     delay_A
        nop     
        rts     

cold_start:                      .at $015c
        jsr     init_selcall_ctcss
        jsr     clear_ram_10_1f
        clr     $a2
        ldx     #$04
        clr     $de
        clr     $df
        bclr    7,$a0

L_016c:                          .at $016c
        lda     $1f2d,x                         ; copy EPROM 1F2E..1F31 -> RAM $2B..$2E ($2E = current channel = lowest channel)
        sta     $2a,x
        decx    
        bne     L_016c
        lda     $1f32
        sta     $68
        lda     $2e
        sta     $50
        sta     $52
        ldx     #$05

L_0181:                          .at $0181
        lda     $1f32,x                         ; copy option bytes 1F33..1F37 -> RAM $2F..$33; then falls into power_down_stop (cold start ends OFF)
        sta     $2e,x
        decx    
        bne     L_0181

power_down_stop:                 .at $0189
        bclr    6,$29
        jsr     select_channel
        bsr     power_down
        stop                                    ; STOP: oscillator and AS stop, +5VS drops; only RESET (on/off line via IC407) restarts it

power_down:                      .at $0191
        lda     #$11
        sta     $20
        brclr   6,$11,L_019c
        lda     $50
        sta     $2e

L_019c:                          .at $019c
        bsr     init_ddr
        bset    6,$09
        lda     #$07                            ; latch $2A <- $07: bit 5 cleared (switched supply off, inferred)
        sta     $2a
        jsr     write_latch_PB2
        lda     #$21
        bsr     write_latch_PB3
        clr     $00
        bset    4,$01
        bclr    4,$01
        bclr    4,$04
        bclr    5,$04
        clr     $01
        jsr     init_peripherals
        clr     $80
        clr     $81
        clr     $82
        rts     

init_ddr:                        .at $01c1
        lda     #$3f
        sta     $04
        lda     #$fe
        sta     $05
        rts     

init_ports:                      .at $01ca
        lda     #$00
        sta     $00                             ; signature sample byte $01CC; 
        lda     #$22
        sta     $01
        rts     

latch29_init:                    .at $01d3
        lda     #$2d

write_latch_PB3:                 .at $01d5
        sta     $00
        bset    3,$01
        bclr    3,$01
        rts     

eprom_checksum:                  .at $01dc
        lda     #$db                            ; builds "ADD $hhll,X; RTS" in RAM $21 and sums $0100-$1FFF; must equal $FF
        sta     $21
        lda     #$01
        sta     $22
        ldx     #$00
        clr     $23
        lda     #$81
        sta     $24
        clra    

L_01ed:                          .at $01ed
        jsr     $21
        incx    
        bne     L_01ed
        inc     $22
        brclr   5,$22,L_01ed
        inca    
        bne     L_01fb
        rts     

L_01fb:                          .at $01fb
        jmp     RESET

warm_start:                      .at $01fe
        jsr     selcall_display_end
        brset   0,$1f,L_0207
        brset   6,$11,L_0207

L_0207:                          .at $0207
        ror     $22
        brclr   0,$32,L_0218
        brclr   4,$1b,L_0210
        sec     

L_0210:                          .at $0210
        ror     $bf
        brclr   4,$a2,L_0216
        sec     

L_0216:                          .at $0216
        ror     $bf

L_0218:                          .at $0218
        jsr     clear_ram_10_1f
        ldx     #$a0
        lda     #$a4
        jsr     clear_ram_x_to_a
        brclr   7,$22,L_0227
        bset    0,$1f

L_0227:                          .at $0227
        brclr   0,$32,L_0234
        brclr   7,$bf,L_0234
        bset    4,$a2
        brclr   6,$bf,L_0234
        bset    4,$1b

L_0234:                          .at $0234
        clr     $36
        clr     $28
        lda     #$09                            ; timer: TDR=$FF, TCR=$0F
        sta     $62
        lda     #$ff
        sta     $08
        lda     #$0f
        sta     $09
        lda     #$40
        sta     $5e
        bset    2,$11
        lda     $2a
        and     #$20
        ora     #$07
        sta     $2a
        jsr     write_latch_PB2
        bclr    7,$29
        jsr     init_peripherals
        jsr     eprom_checksum
        lda     $1fa9                           ; 1FA9 -> $C8 (selcall timing)
        brset   7,$81,L_0267
        bset    7,$14
        lda     #$ff

L_0267:                          .at $0267
        sta     $c8
        cli     

wait_startup:                    .at $026a
        lda     $28
        cmp     #$19
        bcs     wait_startup
        clr     $10
        lda     #$aa
        jsr     head_send                       ; tell control head we (re)started
        jsr     tx_stop
        brclr   5,$1b,L_027f
        bset    3,$16

L_027f:                          .at $027f
        lda     #$02
        sta     $61
        bset    7,$16
        brclr   4,$a2,L_0290
        lda     #$a7
        jsr     head_send
        brclr   4,$1b,L_0290

L_0290:                          .at $0290
        brclr   6,$13,L_0295
        bset    7,$18

L_0295:                          .at $0295
        jsr     set_ctcss_tone
        jsr     econ_setup
        brclr   6,$13,main_loop
        lda     $02
        sta     $2d

main_loop:                       .at $02a2
        brclr   0,$1a,L_02a8
        jsr     head_key_dispatch

L_02a8:                          .at $02a8
        jsr     key_hold_handler
        brclr   3,$1c,L_02b1
        jsr     display_timeout_task

L_02b1:                          .at $02b1
        brclr   2,$1c,L_02ba
        brclr   7,$55,L_02ba
        jsr     rx_synth_settled

L_02ba:                          .at $02ba
        brclr   1,$1c,L_02c3
        brclr   7,$55,L_02c3
        jsr     tx_synth_settled

L_02c3:                          .at $02c3
        jsr     ptt_handler
        brclr   2,$11,L_02cc
        jsr     send_head_config

L_02cc:                          .at $02cc
        brclr   7,$5e,L_02d2
        jsr     head_poll_timer

L_02d2:                          .at $02d2
        brclr   3,$11,L_02d8
        jsr     head_poll_send

L_02d8:                          .at $02d8
        brclr   5,$1c,L_02de
        jsr     head_poll_check

L_02de:                          .at $02de
        brclr   6,$1c,L_02e4
        jsr     tx_timer_expired

L_02e4:                          .at $02e4
        brclr   1,$12,L_02f1
        brset   4,$a2,L_02f1
        bclr    1,$12
        lda     #$a6
        jsr     head_send

L_02f1:                          .at $02f1
        brclr   2,$12,L_02fe
        brset   4,$a2,L_02fe
        bclr    2,$12
        lda     #$a4
        jsr     head_send

L_02fe:                          .at $02fe
        brset   6,$00,L_0309                    ; PA6 = mic PTT input, low = pressed (inferred): 061a / 0653
        brset   0,$15,L_030f
        jsr     mic_ptt_press
        bra     L_030f

L_0309:                          .at $0309
        brclr   0,$15,L_030f
        jsr     mic_ptt_release

L_030f:                          .at $030f
        brclr   7,$00,L_0319                    ; $11.4 = PA7 high AND head $46 held ($14.0): gates CTCSS encode and the CTCSS monitor (PA7 inferred: hook switch)
        brclr   0,$14,L_0319
        bset    4,$11
        bra     L_031b

L_0319:                          .at $0319
        bclr    4,$11

L_031b:                          .at $031b
        lda     $17
        beq     L_0323
        bset    3,$29
        bra     L_0325

L_0323:                          .at $0323
        bclr    3,$29

L_0325:                          .at $0325
        brset   6,$12,L_032b
        jsr     pa_fault_report

L_032b:                          .at $032b
        brclr   6,$12,L_0339
        lda     $10
        bne     L_0339
        bclr    6,$12
        lda     #$c0
        jsr     head_send

L_0339:                          .at $0339
        brclr   5,$11,L_033f
        jsr     synth_relock

L_033f:                          .at $033f
        brclr   0,$11,L_0345
        jsr     low_batt_check

L_0345:                          .at $0345
        brclr   4,$14,L_034f
        brclr   7,$5c,L_034f
        bclr    4,$14
        bclr    1,$14

L_034f:                          .at $034f
        brclr   1,$15,L_0358                    ; head PTT not repeated within 1.5 s -> released
        brclr   7,$5b,L_0358
        jsr     head_ptt_release

L_0358:                          .at $0358
        brclr   0,$14,L_0361
        brclr   7,$5a,L_0361
        jsr     head_hook_release

L_0361:                          .at $0361
        brclr   3,$2f,L_0367
        jsr     tx_timer_start

L_0367:                          .at $0367
        brclr   7,$61,L_036c
        bclr    7,$16

L_036c:                          .at $036c
        jmp     main_loop_part2

TIMER_ISR:                       .at $036f
        lda     #$09                            ; timer reload: TDR=$C5, TCR=$09 -> ~2.4 kHz tick (one tick ~415 us)
        ldx     #$c5
        stx     $08
        sta     $09
        bset    5,$01                           ; PB5 high (synth strobe idle; strobes are low-going pulses)
        inc     $28
        brclr   0,$28,uart_tick
        bclr    1,$01                           ; PB1 toggles every tick (1.2 kHz square wave)
        lda     $28
        and     #$1e
        sta     $27
        lsra    
        add     $27
        tax     
        jmp     tick_slot_table,x               ; 16-entry slot table, one slot every 2 ticks

tick_slot_table:                 .at $038d
        jmp     tick_rti

tick_slot_01:                    .at $0390
        jmp     adc_start_2

tick_slot_02:                    .at $0393
        jmp     tick_rti

tick_slot_03:                    .at $0396
        jmp     adc_start_1

tick_slot_04:                    .at $0399
        jmp     tick_rti

tick_slot_05:                    .at $039c
        jmp     squelch_task

tick_slot_06:                    .at $039f
        jmp     adc_start_3to6

tick_slot_07:                    .at $03a2
        jmp     tick_rti

tick_slot_08:                    .at $03a5
        jmp     soft_timers

tick_slot_09:                    .at $03a8
        jmp     supervision_task

tick_slot_10:                    .at $03ab
        jmp     write_latch_PB4

tick_slot_11:                    .at $03ae
        jmp     adc_start_1

tick_slot_12:                    .at $03b1
        jmp     tick_rti

tick_slot_13:                    .at $03b4
        jmp     squelch_task

tick_slot_14:                    .at $03b7
        jmp     tick_rti

tick_slot_15:                    .at $03ba
        jmp     tick_rti

tick_rti:                        .at $03bd
        rti     

uart_tick:                       .at $03be
        bset    1,$01
        jmp     uart_bit

clear_ram_10_1f:                 .at $03c3
        ldx     #$10
        lda     #$20

clear_ram_x_to_a:                .at $03c7
        sta     $21

L_03c9:                          .at $03c9
        cpx     $21
        beq     L_03d1
        clr     ,x
        incx    
        bra     L_03c9

L_03d1:                          .at $03d1
        rts     

write_latch_PB2:                 .at $03d2
        ldx     $00
        lda     $2a
        sta     $00
        bset    2,$01
        bclr    2,$01
        stx     $00
        rts     

display_timeout_task:            .at $03df
        brclr   7,$63,L_0428
        bclr    3,$1c
        jsr     head_display_off
        brclr   4,$13,update_display
        bclr    4,$13
        bra     L_0420

update_display:                  .at $03ee
        brset   5,$14,L_041e
        brclr   6,$11,L_040f
        brset   3,$1f,L_0405
        bset    1,$1d
        bset    1,$1e
        lda     $4f
        ora     #$0f
        jsr     display_digits
        bclr    3,$1c
        rts     

L_0405:                          .at $0405
        bset    1,$1d
        bset    1,$1e
        jsr     show_channel
        bclr    3,$1c
        rts     

L_040f:                          .at $040f
        bset    1,$1d
        bclr    1,$1e
        brclr   7,$a0,L_041b
        jsr     show_selcall_digits
        bra     L_041e

L_041b:                          .at $041b
        jsr     show_channel

L_041e:                          .at $041e
        bclr    5,$14

L_0420:                          .at $0420
        brclr   6,$12,L_0428
        lda     #$c1
        jsr     head_send

L_0428:                          .at $0428
        rts     

ptt_handler:                     .at $0429
        ldx     $15
        beq     L_045a
        brclr   0,$11,L_044a
        brset   4,$14,L_0467
        brclr   1,$14,L_0443
        brset   0,$29,L_0467
        bset    0,$29
        bset    1,$13

L_043d:                          .at $043d
        brset   1,$13,L_043d
        clr     $4a
        rts     

L_0443:                          .at $0443
        jsr     tx_inhibited
        bcc     L_0467
        bra     L_045d

L_044a:                          .at $044a
        txa     
        and     #$03
        beq     L_0452
        jmp     L_061f

L_0452:                          .at $0452
        jsr     tx_inhibited
        bcs     L_0467
        jmp     tx_start

L_045a:                          .at $045a
        brclr   0,$11,L_0467

L_045d:                          .at $045d
        jsr     tx_stop
        bclr    1,$14
        brclr   6,$13,L_0467
        bset    7,$18

L_0467:                          .at $0467
        rts     

low_batt_check:                  .at $0468
        brclr   0,$29,L_0474
        lda     $4a
        cmp     #$15
        bcs     L_0474
        jmp     power_down_stop

L_0474:                          .at $0474
        rts     

key_hold_handler:                .at $0475
        brclr   0,$1b,L_047c
        bclr    5,$13
        bra     L_0488

L_047c:                          .at $047c
        brclr   1,$1b,L_0495
        brset   5,$13,L_048b
        lda     #$02
        sta     $59
        bset    5,$13

L_0488:                          .at $0488
        bset    7,$29
        rts     

L_048b:                          .at $048b
        brclr   7,$59,L_0488
        bclr    7,$29
        bclr    1,$1b
        bclr    5,$13
        rts     

L_0495:                          .at $0495
        brset   2,$1b,L_04d8
        brclr   3,$1b,L_04ba
        brset   7,$1b,L_04a6
        lda     #$37
        sta     $5d
        bset    7,$1b
        bra     L_04d8

L_04a6:                          .at $04a6
        brclr   7,$5d,L_04d8

L_04a9:                          .at $04a9
        bclr    7,$29
        bclr    6,$1b
        lda     $36
        and     #$0f
        sta     $36
        bclr    5,$13
        bclr    7,$1b
        bclr    3,$1b
        rts     

L_04ba:                          .at $04ba
        brclr   4,$1b,L_04a9
        brclr   6,$1b,L_04d8
        bclr    7,$29
        brset   5,$13,L_04cc
        lda     #$12
        sta     $59
        bset    5,$13
        rts     

L_04cc:                          .at $04cc
        brclr   7,$59,L_04d7
        bclr    5,$13

L_04d1:                          .at $04d1
        lda     $1b
        eor     #$40
        sta     $1b

L_04d7:                          .at $04d7
        rts     

L_04d8:                          .at $04d8
        brset   5,$13,L_04e8
        lda     #$01
        sta     $59
        bset    5,$13

latch29_toggle_b7:               .at $04e1
        lda     $29
        eor     #$80
        sta     $29
        rts     

L_04e8:                          .at $04e8
        brclr   7,$59,L_04d7
        lda     #$01
        sta     $59
        bsr     latch29_toggle_b7
        brclr   4,$1b,L_04d7
        lda     $36
        add     #$10
        sta     $36
        cmp     #$70
        bcs     L_04d7
        bclr    5,$13
        lda     $36
        and     #$0f
        sta     $36
        bra     L_04d1

send_head_config:                .at $0508
        lda     #$e7
        jsr     head_send
        clrx    

L_050e:                          .at $050e
        lda     $1f10,x
        jsr     head_send
        incx    
        cpx     #$03
        bne     L_050e
        bclr    2,$11
        rts     

head_poll_timer:                 .at $051c
        jsr     selcall_ram_check
        lda     #$13                            ; next keep-alive poll in ~0.53 s ($5E = $13)
        sta     $5e
        bset    3,$11
        rts     

head_poll_send:                  .at $0526
        brset   5,$1c,L_0533
        lda     #$e4                            ; keep-alive: send $E4 to the head, then wait ~1.5 s for $49 ($5F = $38)
        jsr     head_send
        jsr     head_poll_arm
        bclr    3,$11

L_0533:                          .at $0533
        rts     

head_poll_check:                 .at $0534
        brclr   7,$5f,L_053e
        brset   3,$14,L_053f                    ; no $49 after the second poll (~3 s) -> power down
        bset    3,$14
        bclr    5,$1c

L_053e:                          .at $053e
        rts     

L_053f:                          .at $053f
        jmp     power_down_stop

tx_timer_start:                  .at $0542
        brclr   0,$11,L_0558
        brset   6,$1c,L_0558
        lda     $15
        bit     #$03
        beq     L_0558
        brset   7,$1c,L_0558
        lda     $1f38
        sta     $67
        bset    6,$1c

L_0558:                          .at $0558
        rts     

tx_timer_expired:                .at $0559
        lda     $67
        bne     L_0566
        bclr    6,$1c
        jsr     selcall_ani_release
        bset    2,$16
        bset    0,$1b

L_0566:                          .at $0566
        rts     

pa_fault_report:                 .at $0567
        lda     $10                             ; $10 bit7 = PA fault: send $C1 to the head once ($12.6 = sent); main loop sends $C0 when $10 is clear again
        bmi     L_056c
        rts     

L_056c:                          .at $056c
        bset    6,$12
        lda     #$c1
        jsr     head_send
        rts     

head_key_dispatch:               .at $0574
        lda     $38                             ; head byte $44-$4A: index (byte-$44)*3 into head_cmd_table; '0'-'?' = key codes via 0x1F58
        bclr    0,$1a
        brset   2,$1a,L_059b
        brset   3,$1a,L_059b
        cmp     #$30
        bcs     L_0599
        cmp     #$3f
        bls     L_05b1
        sub     #$44
        bmi     L_0599
        sta     $21
        lsla    
        add     $21
        tax     
        cpx     #$15
        bhi     L_0599
        bclr    0,$10
        jmp     head_cmd_table,x

L_0599:                          .at $0599
        bset    0,$10

L_059b:                          .at $059b
        rts     

head_cmd_table:                  .at $059c
        jmp     head_ptt_press                  ; $44 head PTT press, $45 release, $46 hook/monitor press, $47 release, $48 nothing, $49 keep-alive reply, $4A RAM dump

head_cmd_45:                     .at $059f
        jmp     head_ptt_release

head_cmd_46:                     .at $05a2
        jmp     head_hook_press

head_cmd_47:                     .at $05a5
        jmp     head_hook_release

head_cmd_48:                     .at $05a8
        jmp     L_05d5

head_cmd_49:                     .at $05ab
        jmp     head_cmd_alive

head_cmd_4a:                     .at $05ae
        jmp     head_ram_dump

L_05b1:                          .at $05b1
        clrx    

L_05b2:                          .at $05b2
        cmp     $05bf,x
        beq     L_05c3
        incx    
        cpx     #$04
        bne     L_05b2

L_05bc:                          .at $05bc
        bset    3,$1b
        rts     
        .at     $05bf
        db      $31, $32, $34, $37
        .at     $05c3

L_05c3:                          .at $05c3
        lda     $1f58,x
        sta     $21
        lsla    
        add     $21
        tax     
        cpx     #$1b                            ; signature sample byte $05CC; 
        bcc     L_05bc
        bclr    0,$10
        jmp     fkey_func_table,x

L_05d5:                          .at $05d5
        rts     

fkey_func_table:                 .at $05d6
        jmp     L_05d5

fkey_fn1:                        .at $05d9
        jmp     fn_channel_up

fkey_fn2:                        .at $05dc
        jmp     fn_channel_down

fkey_fn3:                        .at $05df
        jmp     fn_channel_tens

fkey_fn4:                        .at $05e2
        jmp     fn_channel_units

fkey_fn5:                        .at $05e5
        jmp     fn_scan

fkey_fn6:                        .at $05e8
        jmp     fn_monitor_toggle

fkey_fn7:                        .at $05eb
        jmp     fn_selcall_send

fkey_fn8:                        .at $05ee
        jmp     fn_selcall_toggle

fn_monitor_toggle:               .at $05f1
        brset   2,$19,L_05fe
        brclr   4,$33,L_0603
        brset   5,$1b,L_0603
        bset    2,$19
        bra     L_0600

L_05fe:                          .at $05fe
        bclr    2,$19

L_0600:                          .at $0600
        bset    1,$1b
        rts     

L_0603:                          .at $0603
        jmp     beep_reject

head_hook_press:                 .at $0606
        bset    0,$14                           ; head $46: $14.0 = 1, auto-release timer $5A = $38 (56 x 27 ms = 1.5 s): the head must repeat $46
        lda     #$38
        sta     $5a
        rts     

head_hook_release:               .at $060d
        bclr    0,$14
        rts     

head_ptt_press:                  .at $0610
        bset    1,$15                           ; head $44: $15.1 = head PTT, auto-release timer $5B = $38 (1.5 s): the head must repeat $44
        lda     #$38
        sta     $5b
        bra     L_061c
        .at     $0618
        db      $20, $02
        .at     $061a

mic_ptt_press:                   .at $061a
        bset    0,$15                           ; PA6 low: $15.0 = mic PTT

L_061c:                          .at $061c
        bclr    2,$17
        rts     

L_061f:                          .at $061f
        brclr   4,$a2,L_062f
        bclr    4,$1b
        bclr    4,$a2
        bset    2,$12
        brclr   4,$19,L_062f
        bset    1,$12
        bclr    2,$12

L_062f:                          .at $062f
        brclr   2,$2f,L_0635
        brset   4,$19,L_064c

L_0635:                          .at $0635
        brset   7,$1c,L_064c
        bsr     tx_inhibited
        bcs     L_064c
        jsr     tx_start
        bcs     L_064c
        jsr     selcall_ani_press
        lda     $17
        bne     L_064c
        jmp     update_display
        .at     $064b
        db      $81
        .at     $064c

L_064c:                          .at $064c
        bset    0,$1b
        rts     

head_ptt_release:                .at $064f
        bclr    1,$15
        bra     ptt_release_common

mic_ptt_release:                 .at $0653
        bclr    0,$15

ptt_release_common:              .at $0655
        jsr     selcall_ani_release
        bset    2,$17
        bclr    6,$1c
        bclr    0,$1b
        bclr    2,$16
        jsr     auto_power_off_reset
        rts     
        .at     $0664
        db      $cc, $15, $74
        .at     $0667

head_cmd_alive:                  .at $0667
        bclr    5,$1c                           ; head $49 = reply to the $E4 keep-alive poll: clear waiting/missed flags $1C.5, $14.3
        bclr    3,$14
        rts     

synth_relock:                    .at $066c
        brset   0,$11,L_0683                    ; $11.5: synthesiser relock; $2D bits 3-7 count retries (+8), on overflow $10.4 = synth fault (inferred)
        brset   2,$1c,L_06a4
        brset   6,$2a,L_06a4
        brset   6,$11,L_06a4
        brclr   6,$13,L_067e
        brset   5,$16,L_06a4

L_067e:                          .at $067e
        jsr     select_channel
        bra     L_0694

L_0683:                          .at $0683
        brset   1,$1c,L_069d
        brset   0,$2f,L_06a4
        lda     #$11
        sta     $55
        bset    1,$1c
        lda     $2e
        jsr     load_synth

L_0694:                          .at $0694
        lda     $2d
        bmi     L_069d
        add     #$08
        sta     $2d
        rts     

L_069d:                          .at $069d
        bset    4,$10
        brclr   0,$11,L_06a4
        bset    1,$14

L_06a4:                          .at $06a4
        rts     

tx_inhibited:                    .at $06a5
        brset   6,$10,L_06b8                    ; carry set = Tx not allowed: $10.6, $16 bits 4-7, or $16 bits 0-3 with no $15 bits 4-7 (includes $16.3 = C/R busy lockout)
        lda     $16
        and     #$f0
        bne     L_06b8
        lda     $15
        and     #$f0
        bne     L_06ba
        lda     $16
        beq     L_06ba

L_06b8:                          .at $06b8
        sec     
        rts     

L_06ba:                          .at $06ba
        clc     
        rts     

tx_start:                        .at $06bc
        jsr     vote_tx_channel
        lda     #$11
        sta     $55
        bset    1,$1c
        bclr    2,$1c
        jsr     unlock_blank_start
        bclr    0,$12
        brset   0,$2f,L_06da
        bset    1,$11
        bsr     synth_retry_clear
        lda     $2e
        jsr     load_synth
        bcs     L_06e0

L_06da:                          .at $06da
        bclr    0,$29
        bset    0,$11
        clc     
        rts     

L_06e0:                          .at $06e0
        bclr    1,$1c
        rts     

synth_retry_clear:               .at $06e3
        lda     $2d
        and     #$07
        sta     $2d
        rts     

tx_stop:                         .at $06ea
        bclr    1,$1c
        bset    0,$29
        bset    1,$13

L_06f0:                          .at $06f0
        brset   1,$13,L_06f0
        clr     $4a
        bclr    4,$14
        bset    2,$17
        jsr     ctcss_tone_off
        brset   2,$a1,L_0704
        lda     #$a0
        jsr     head_send

L_0704:                          .at $0704
        bclr    0,$11
        bsr     synth_retry_clear
        bset    6,$29
        jsr     select_channel
        bclr    6,$29
        bcs     L_0717
        brset   6,$18,L_072c
        jmp     update_display

L_0717:                          .at $0717
        jmp     beep_reject

tx_synth_settled:                .at $071a
        bclr    1,$1c                           ; $55 ran out after a Tx synth load: tell the head Tx is on ($A2), then CTCSS encoder on
        bclr    0,$1b
        lda     #$a2
        jsr     head_send
        jmp     ctcss_tx_on

rx_synth_settled:                .at $0726
        bclr    2,$1c                           ; $55 ran out after an Rx synth load: clear $18.0/$18.1
        bclr    1,$18
        bclr    0,$18

L_072c:                          .at $072c
        rts     

fn_channel_up:                   .at $072d
        brset   7,$a0,L_07a0
        brset   0,$11,L_0792
        brset   6,$11,L_0792
        bsr     scan_restore_channel
        inca    
        bra     L_0751

fn_channel_tens:                 .at $073b
        brset   7,$a0,L_0773
        brset   0,$11,L_0792
        brset   6,$11,L_0792
        bsr     scan_restore_channel

L_0746:                          .at $0746
        sub     #$0a
        bcc     L_0746
        add     #$0a
        sub     $2e
        nega    
        add     #$0a

L_0751:                          .at $0751
        cmp     $1f3e
        bls     L_0759
        lda     $1f3f

L_0759:                          .at $0759
        sta     $2e
        bsr     channel_changed_notify
        jsr     select_channel
        bcc     L_07cf
        bra     fn_channel_up

scan_restore_channel:            .at $0764
        lda     $2e
        brclr   6,$13,L_076f
        lda     $50
        sta     $2e
        bclr    6,$13

L_076f:                          .at $076f
        rts     

fn_channel_down:                 .at $0770
        brclr   7,$a0,L_0776

L_0773:                          .at $0773
        jmp     L_14a5

L_0776:                          .at $0776
        brset   0,$11,L_0792
        brset   6,$11,L_0792
        bsr     scan_restore_channel
        deca    
        cmp     $1f3f
        bcc     L_0787
        lda     $1f3e

L_0787:                          .at $0787
        sta     $2e
        bsr     channel_changed_notify
        jsr     select_channel
        bcs     fn_channel_down
        bra     L_07cf

L_0792:                          .at $0792
        bra     beep_reject

channel_changed_notify:          .at $0794
        jsr     selcall_send_start
        lda     #$a0
        jsr     head_send
        rts     

fn_channel_units:                .at $079d
        brclr   7,$a0,L_07a3

L_07a0:                          .at $07a0
        jmp     L_14a9

L_07a3:                          .at $07a3
        brset   0,$11,L_0792
        brset   6,$11,L_0792
        bsr     scan_restore_channel

L_07ab:                          .at $07ab
        sub     #$0a
        bcc     L_07ab
        tax     
        add     #$0a
        sub     $2e
        nega    
        sta     $2e
        txa     
        inca    
        bpl     L_07bd
        add     #$0a

L_07bd:                          .at $07bd
        add     $2e
        sta     $2e
        cmp     $1f3e
        bhi     fn_channel_units
        cmp     $1f3f
        bcs     fn_channel_units
        bsr     select_channel
        bcs     fn_channel_units

L_07cf:                          .at $07cf
        bset    1,$1b
        bclr    5,$16
        bclr    7,$18
        brclr   6,$13,L_07e2
        lda     $2e
        sta     $50
        sta     $52
        clr     $1f
        bset    7,$18

L_07e2:                          .at $07e2
        clr     $10
        jsr     synth_retry_clear
        jmp     update_display

beep_reject:                     .at $07ea
        bset    3,$1b                           ; $1B.3 = reject beep
        rts     

select_channel:                  .at $07ed
        lda     $2e

select_channel_A:                .at $07ef
        bset    1,$18
        bset    2,$1c
        ldx     #$18
        stx     $55
        bclr    1,$11
        bsr     load_synth
        bcs     L_0841
        brset   6,$29,L_0809
        jsr     $21                             ; bytes 6,7 of slot -> $34 (CTCSS/flags), $35 (link)
        sta     $34
        incx    
        jsr     $21
        sta     $35

L_0809:                          .at $0809
        jsr     selcall_mute_setup
        ldx     #$05
        jsr     $21                             ; byte5 bit3 -> latch $82 bit5
        bit     #$08
        bne     L_0818
        bclr    5,$82
        bra     L_081a

L_0818:                          .at $0818
        bset    5,$82

L_081a:                          .at $081a
        brset   6,$29,L_0840
        jsr     set_ctcss_tone
        ldx     #$05
        jsr     $21                             ; byte5 bits4-5 = power; 0 -> operator-selected power from $2C
        and     #$30
        bne     L_082e
        lda     $2c
        lsra    
        lsra    
        and     #$30

L_082e:                          .at $082e
        and     #$10
        sta     $21
        lda     $2c
        and     #$ef
        add     $21
        jsr     unlock_blank_start
        sta     $2c
        jsr     econ_setup

L_0840:                          .at $0840
        clc     

L_0841:                          .at $0841
        rts     

load_synth:                      .at $0842
        jsr     chan_ptr                        ; X=2: Rx bytes 0-2, X=5: Tx bytes 3-5 of the channel slot
        ldx     #$02
        brclr   1,$11,L_084c
        ldx     #$05

L_084c:                          .at $084c
        stx     $25
        lda     #$d6
        sta     $21
        lda     #$81
        sta     $24
        jsr     $21
        bit     #$80                            ; bit7 of byte2/5 = entry valid, else carry set = empty channel
        bne     L_085e
        sec     
        rts     

L_085e:                          .at $085e
        brclr   1,$11,L_0866
        bset    0,$18
        jsr     mute_close

L_0866:                          .at $0866
        brset   1,$11,L_0882
        bclr    3,$16
        bclr    5,$1b
        bit     #$10                            ; Rx: byte2 bit4 (C/R) -> $1B.5 / $19.2
        beq     L_0875
        bset    5,$1b
        bclr    2,$19

L_0875:                          .at $0875
        jsr     chan_flags_rx                   ; Rx: byte2 bit5 (VOTE) handled in chan_flags_rx
        bit     #$08                            ; Rx: byte2 bit3 -> latch $2C bit5 (VCO band switch)
        beq     L_0880
        bclr    5,$2c
        bra     L_0882

L_0880:                          .at $0880
        bset    5,$2c

L_0882:                          .at $0882
        and     #$40                            ; bit6 (injection side) -> $29.1
        beq     L_088a
        bset    1,$29
        bra     L_088c

L_088a:                          .at $088a
        bclr    1,$29

L_088c:                          .at $088c
        decx    
        decx    
        bsr     synth_strobe
        lda     $1f2d                           ; synth: port A = 1F2D, PB6 high (enable), 2 strobes
        sta     $00
        bset    6,$01
        bsr     synth_strobe
        bsr     synth_strobe

L_089b:                          .at $089b
        jsr     $21                             ; synth: 4 BCD digits, low nibble then high nibble, one PB5 strobe each
        bsr     synth_write_nibble
        lsra    
        lsra    
        lsra    
        lsra    
        bsr     synth_write_nibble
        incx    
        cpx     $25
        bne     L_089b
        jsr     $21                             ; synth: digit 5 (byte2/5 | 8)
        ora     #$08
        bsr     synth_write_nibble
        lda     $1f2c                           ; synth: then reference bytes 1F2C, 1F2D; PB6 low again
        bsr     synth_write_nibble
        lda     $1f2d
        bsr     synth_write_nibble
        bclr    6,$01
        ldx     #$06
        clc     
        rts     

synth_write_nibble:              .at $08c0
        sta     $00

synth_strobe:                    .at $08c2
        bclr    5,$01
        bset    5,$01
        rts     

chan_ptr:                        .at $08c7
        clrx                                    ; ptr = $1BE0 + 8*A  (into RAM routine at $21: LDA $hhll,X; RTS)
        lsla    
        rolx    
        lsla    
        rolx    
        lsla    
        rolx    
        add     #$e0
        sta     $23
        txa     
        adc     #$1b
        sta     $22
        rts     

uart_bit:                        .at $08d8
        lda     $17
        beq     L_08e0
        bset    3,$29
        bra     L_08e2

L_08e0:                          .at $08e0
        bclr    3,$29

L_08e2:                          .at $08e2
        lda     $29
        eor     #$10
        bmi     L_08ea
        and     #$ef

L_08ea:                          .at $08ea
        ldx     $00
        sta     $00
        sta     $29
        bset    3,$01
        bclr    3,$01
        stx     $00
        bclr    1,$13
        brset   4,$1a,L_0935                    ; software UART on PB0: ~1200 baud 8E1 (start, 8 data LSB first, even parity, stop), single wire idle-high; PB0 is driven only while sending; 4-byte TX FIFO $3D-$40
        brset   0,$05,L_0962
        brset   0,$01,L_0914
        bset    4,$1a
        bclr    5,$1a
        bclr    6,$1a
        bclr    2,$1a
        bclr    3,$1a
        clr     $3a
        lda     #$80
        sta     $39
        jmp     L_0991

L_0914:                          .at $0914
        brclr   1,$1a,L_0991
        brset   7,$1a,L_0991
        clr     $39
        bset    0,$05
        bclr    0,$01
        ldx     $3c
        lda     $3d,x
        sta     $37
        txa     
        add     #$01
        and     #$03
        sta     $3c
        cmp     $3b
        bne     L_0991
        bclr    1,$1a
        bra     L_0991

L_0935:                          .at $0935
        brset   6,$1a,L_0953
        brclr   0,$01,L_093d
        inc     $3a

L_093d:                          .at $093d
        rola    
        brset   5,$1a,L_094a
        rora    
        ror     $39
        bcc     L_0991
        bset    5,$1a
        bra     L_0991

L_094a:                          .at $094a
        bset    6,$1a
        brclr   0,$3a,L_0991
        bset    2,$1a
        bra     L_0991

L_0953:                          .at $0953
        brset   0,$01,L_0958
        bset    3,$1a

L_0958:                          .at $0958
        lda     $39
        sta     $38
        bset    0,$1a
        bclr    4,$1a
        bra     L_0991

L_0962:                          .at $0962
        lda     $39
        bne     L_0968
        sta     $3a

L_0968:                          .at $0968
        add     #$01
        sta     $39
        cmp     #$0b
        bne     L_0974
        bclr    0,$05
        bra     L_0991

L_0974:                          .at $0974
        cmp     #$09
        bcc     L_0986
        ror     $37
        bcs     L_0980

L_097c:                          .at $097c
        bclr    0,$01
        bra     L_0991

L_0980:                          .at $0980
        bset    0,$01
        inc     $3a
        bra     L_0991

L_0986:                          .at $0986
        beq     L_098c
        bset    0,$01
        bra     L_0991

L_098c:                          .at $098c
        brclr   0,$3a,L_097c
        bset    0,$01

L_0991:                          .at $0991
        dec     $55
        dec     $56
        dec     $e7
        dec     $e8
        bclr    5,$11
        lda     $1c
        and     #$06
        bne     L_09aa
        bclr    4,$04
        brclr   4,$00,L_09a8
        bset    5,$11

L_09a8:                          .at $09a8
        bset    4,$04

L_09aa:                          .at $09aa
        rti     

adc_start_3to6:                  .at $09ab
        lda     $2a
        and     #$30
        brset   5,$28,L_09c1
        brset   6,$28,L_09bb
        ora     #$04
        ldx     #$48
        bra     L_09e2

L_09bb:                          .at $09bb
        ora     #$05
        ldx     #$49
        bra     L_09e2

L_09c1:                          .at $09c1
        brset   6,$28,L_09ca
        ora     #$06
        ldx     #$4a
        bra     L_09e2

L_09ca:                          .at $09ca
        ora     #$03
        ldx     #$47                            ; signature sample byte $09CC; 
        bra     L_09e2

adc_start_2:                     .at $09d0
        lda     $2a
        and     #$30
        ora     #$02
        ldx     #$46
        bra     L_09e2

adc_start_1:                     .at $09da
        lda     $2a
        and     #$30
        ora     #$01
        ldx     #$45

L_09e2:                          .at $09e2
        stx     $44                             ; ADC: select mux via $2A latch, note start time; IRQ (comparator) stores result
        ldx     $00
        sta     $00
        bset    2,$01
        bclr    2,$01
        lda     $08
        sta     $43
        lda     $28
        sta     $42
        bset    3,$00
        bset    2,$01
        stx     $00
        rti     

squelch_task:                    .at $09fb
        lda     $2d                             ; squelch: pot ($49) -> setting 0-7 via table $0A4C (with hysteresis)
        and     #$07
        tax     
        lslx    
        lda     $49
        cmp     #$50
        bls     L_0a09
        lda     #$50

L_0a09:                          .at $0a09
        cmp     $0a4c,x
        bcs     L_0a2a
        cmp     $0a4d,x
        bhi     L_0a26
        lsrx    
        brset   4,$31,L_0a36
        brset   6,$13,L_0a5c
        lda     $2d
        stx     $2d
        and     #$f8
        ora     $2d
        sta     $2d
        bra     L_0a5c

L_0a26:                          .at $0a26
        incx    
        incx    
        bra     L_0a2c

L_0a2a:                          .at $0a2a
        decx    
        decx    

L_0a2c:                          .at $0a2c
        brset   4,$31,L_0a09
        brset   6,$13,L_0a09
        bset    5,$18
        bra     L_0a09

L_0a36:                          .at $0a36
        brclr   4,$33,L_0a5c
        brset   5,$1b,L_0a48
        cpx     #$02
        bhi     L_0a44
        bset    2,$19
        bra     L_0a5c

L_0a44:                          .at $0a44
        cpx     #$05
        bcs     L_0a5c

L_0a48:                          .at $0a48
        bclr    2,$19
        bra     L_0a5c
        .at     $0a4c
        db      $00, $0b, $09, $15, $13, $1f, $1d, $29, $27, $33, $31, $3d, $3b, $47, $45, $ff
        .at     $0a5c

L_0a5c:                          .at $0a5c
        brclr   5,$18,L_0a64
        jsr     mute_close
        bclr    5,$18

L_0a64:                          .at $0a64
        brset   5,$11,L_0ad9
        brset   0,$18,L_0adb
        lda     $2d
        and     #$07
        tax     
        lda     $45
        brclr   4,$19,L_0a8e
        cmp     $1f1c,x                         ; noise ($45) vs close threshold 1F1C+setting
        bls     L_0aa5
        cmp     $4b
        bmi     L_0a9d
        lda     $4c
        and     #$3f
        tax     
        lsrx    
        lsrx    
        lsrx    
        lda     $1f24,x                         ; squelch tail from table 1F24
        sta     $4d
        bset    5,$19
        bra     L_0aa3

L_0a8e:                          .at $0a8e
        cmp     $1f14,x                         ; noise ($45) vs open threshold 1F14+setting
        bcc     L_0aa5
        bset    4,$19
        bclr    5,$19
        bset    1,$12
        bclr    2,$12
        bra     L_0aa5

L_0a9d:                          .at $0a9d
        bclr    5,$19
        bset    2,$12
        bclr    1,$12

L_0aa3:                          .at $0aa3
        bclr    4,$19

L_0aa5:                          .at $0aa5
        lda     $4b
        sta     $4c
        lda     $45
        sta     $4b
        brclr   5,$19,L_0aba
        dec     $4d
        bne     L_0aba
        bclr    5,$19
        bset    2,$12
        bclr    1,$12

L_0aba:                          .at $0aba
        lda     $19
        and     #$0f
        bne     L_0aca
        lda     $18
        bne     L_0adb
        lda     $19
        and     #$f0
        beq     L_0adb

L_0aca:                          .at $0aca
        brclr   4,$2f,L_0ad0
        brset   4,$11,L_0ad4

L_0ad0:                          .at $0ad0
        bclr    5,$29
        bra     L_0ad6

L_0ad4:                          .at $0ad4
        bset    5,$29

L_0ad6:                          .at $0ad6
        bclr    2,$29
        rti     

L_0ad9:                          .at $0ad9
        bsr     mute_close

L_0adb:                          .at $0adb
        bset    5,$29
        bset    2,$29
        rti     

mute_close:                      .at $0ae0
        bset    2,$12
        bclr    1,$12
        bclr    4,$19
        bclr    5,$19
        rts     

soft_timers:                     .at $0ae9
        brset   5,$28,L_0b07                    ; soft timers: $57-$61,$E9,$EA every 64 ticks (~27 ms)
        dec     $57
        dec     $58
        dec     $59
        dec     $5a
        dec     $5b
        dec     $5c
        dec     $5d
        dec     $5e
        dec     $5f
        dec     $60
        dec     $61
        dec     $e9
        dec     $ea

L_0b06:                          .at $0b06
        rti     

L_0b07:                          .at $0b07
        brset   6,$28,L_0b2b
        brset   7,$28,L_0b20
        dec     $62                             ; $63-$65,$EB,$EC every 2304 ticks (~1 s)
        bne     L_0b06
        lda     #$09
        sta     $62
        dec     $63
        dec     $64
        dec     $65
        dec     $eb
        dec     $ec
        rti     

L_0b20:                          .at $0b20
        dec     $66                             ; $67 every 24064 ticks (~10 s): Tx timer / auto power-off units
        bne     L_0b2a
        lda     #$5e
        sta     $66
        dec     $67

L_0b2a:                          .at $0b2a
        rti     

L_0b2b:                          .at $0b2b
        brclr   7,$28,L_0b2f
        rti     

L_0b2f:                          .at $0b2f
        jmp     L_0d57

write_latch_PB4:                 .at $0b32
        ldx     $00                             ; latch $2C (inverted) -> port A, PB4 strobe: power level, VCO band etc.
        lda     $2c
        coma    
        sta     $00
        bset    4,$01
        bclr    4,$01
        stx     $00
        rti     

supervision_task:                .at $0b40
        brset   5,$28,L_0b53
        brset   6,$28,L_0b51
        bsr     check_signatures
        jsr     check_window_48
        bcc     L_0b73
        bset    6,$10
        bra     L_0b73

L_0b51:                          .at $0b51
        bra     L_0b73

L_0b53:                          .at $0b53
        brset   4,$14,L_0b73
        brset   6,$28,L_0b68
        jsr     check_power_window
        bne     L_0b73
        bcc     L_0b64
        bset    7,$10
        bra     L_0b73

L_0b64:                          .at $0b64
        bclr    7,$10
        bra     L_0b73

L_0b68:                          .at $0b68
        jsr     check_window_47
        bne     L_0b73
        bcc     L_0b73
        bset    5,$10
        bset    1,$14

L_0b73:                          .at $0b73
        jsr     chk_ram_config
        lda     $68
        cmp     $1f32
        beq     L_0b7f
        bset    3,$10

L_0b7f:                          .at $0b7f
        rti     

check_signatures:                .at $0b80
        clra                                    ; signature over firmware + 1F65, and 1F33..1F37 + 1F66: must be 0 else halt
        clrx    
        add     $01cc
        sub     $05cc
        eor     $09cc
        add     L_0dcc
        add     $11cc
        sub     $15cc
        eor     $19cc
        add     $1acc
        add     $1f65
        bne     L_0bad
        ldx     #$05

L_0ba1:                          .at $0ba1
        add     $1f32,x
        decx    
        bne     L_0ba1
        add     $1f66
        bne     L_0bad
        rts     

L_0bad:                          .at $0bad
        incx    
        jmp     $0188,x                         ; on failure jump to $0189 (power down / stop)

IRQ_ISR:                         .at $0bb1
        bclr    2,$01                           ; IRQ = ADC comparator: result = start_time - timer - $1E
        lda     $28
        cmp     $42
        beq     L_0bbd
        bset    2,$10
        bra     L_0bc6

L_0bbd:                          .at $0bbd
        lda     $43
        sub     $08
        sub     #$1e
        ldx     $44
        sta     ,x

L_0bc6:                          .at $0bc6
        bset    5,$01
        ldx     $00
        lda     $2a
        sta     $00
        bset    2,$01
        bclr    2,$01
        stx     $00
        lda     $20
        cmp     #$99
        beq     L_0bdd
        jmp     cold_start

L_0bdd:                          .at $0bdd
        rti     

unlock_blank_start:              .at $0bde
        ldx     #$04                            ; ignore synth unlock for $5C = 4 x 27 ms after a load ($14.4) (inferred)
        stx     $5c
        bset    4,$14
        rts     

head_send:                       .at $0be5
        stx     $25                             ; queue byte for control head (wait while FIFO full)

L_0be7:                          .at $0be7
        ldx     $3b
        cpx     $3c
        bne     L_0bf2
        brclr   1,$1a,L_0bf2
        bra     L_0be7

L_0bf2:                          .at $0bf2
        sta     $3d,x
        txa     
        inca    
        and     #$03
        sta     $3b
        bset    1,$1a
        ldx     $25
        clc     
        rts     
        .at     $0c00
        db      $3f, $41, $81, $11, $12, $11, $1c, $ad, $f7
        .at     $0c09

head_display_off:                .at $0c09
        lda     #$e5                            ; $E5 = display off (intermittent display, s0 = 0/2)
        bclr    3,$1c
        bra     head_send

head_send2:                      .at $0c0f
        bsr     head_send
        txa     
        bra     head_send

show_channel:                    .at $0c14
        lda     $2e
        brclr   6,$13,L_0c1b
        lda     $50

L_0c1b:                          .at $0c1b
        jsr     bin_to_bcd
        bit     #$f0
        bne     display_digits
        ora     #$f0

display_digits:                  .at $0c24
        sta     $41                             ; send 2 display digits: $80/$81 + char, $82/$83 + char
        and     #$0f
        cmp     #$0f
        beq     L_0c39
        add     #$30
        tax     
        brclr   1,$1e,L_0c3b
        lda     #$81
        jsr     head_send2
        bra     L_0c40

L_0c39:                          .at $0c39
        ldx     #$20

L_0c3b:                          .at $0c3b
        lda     #$80
        jsr     head_send2

L_0c40:                          .at $0c40
        lda     $41
        lsra    
        lsra    
        lsra    
        lsra    
        cmp     #$0f
        beq     L_0c57
        add     #$30
        tax     
        brclr   1,$1e,L_0c59
        lda     #$83
        jsr     head_send2
        bra     L_0c5e

L_0c57:                          .at $0c57
        ldx     #$20

L_0c59:                          .at $0c59
        lda     #$82
        jsr     head_send2

L_0c5e:                          .at $0c5e
        bsr     display_timer_start
        brclr   3,$1c,L_0c65
        bset    4,$13

L_0c65:                          .at $0c65
        rts     

display_timer_start:             .at $0c66
        bclr    3,$1c                           ; 0x1F33 bit1 = intermittent display: blank after 0x1F3B seconds ($63)
        brclr   1,$2f,L_0c72
        lda     $1f3b
        sta     $63
        bset    3,$1c

L_0c72:                          .at $0c72
        rts     

head_poll_arm:                   .at $0c73
        lda     #$38
        sta     $5f
        bset    5,$1c
        rts     

check_window_48:                 .at $0c7a
        brclr   6,$2a,L_0c80
        brclr   2,$1f,L_0cc8

L_0c80:                          .at $0c80
        lda     $48
        ldx     #$00
        bra     check_window

check_window_47:                 .at $0c86
        lda     $1c
        and     #$06
        bne     L_0cc8
        brset   6,$18,L_0cc8
        lda     $47
        ldx     #$06
        bra     check_window

check_power_window:              .at $0c95
        brclr   0,$11,L_0ca6                    ; Tx: forward-power ADC ($4A) must lie in window 1F08..1F0F for current power level
        lda     $2c
        lsra    
        lsra    
        lsra    
        and     #$06
        add     #$08
        tax     
        lda     $4a
        bra     check_window

L_0ca6:                          .at $0ca6
        brset   2,$1c,L_0cc8
        brset   0,$2f,L_0cc8
        lda     $4a                             ; Rx: $4A < $15 -> supply too low: shut down with alarm on PA4
        cmp     #$15
        bcs     L_0cd5
        sei     
        jsr     power_down
        bset    4,$04

L_0cb8:                          .at $0cb8
        lda     #$01
        jsr     delay_A
        bset    4,$00
        lda     #$01
        jsr     delay_A
        bclr    4,$00
        bra     L_0cb8

L_0cc8:                          .at $0cc8
        lda     #$01
        rts     

check_window:                    .at $0ccb
        cmp     $1f00,x                         ; window check: 1F00+x <= A <= 1F01+x
        bcs     L_0cd8
        cmp     $1f01,x
        bhi     L_0cd8

L_0cd5:                          .at $0cd5
        clc     
        clra    
        rts     

L_0cd8:                          .at $0cd8
        sec     
        clra    
        rts     

bin_to_bcd:                      .at $0cdb
        clrx    
        sta     $21
        stx     $22
        bmi     L_0d1b
        clr     $23
        clr     $24
        clr     $25
        lda     #$10
        sta     $26

L_0cec:                          .at $0cec
        ldx     #$23

L_0cee:                          .at $0cee
        lda     ,x
        and     #$0f
        cmp     #$05
        lda     ,x
        bcs     L_0cf8
        add     #$03

L_0cf8:                          .at $0cf8
        cmp     #$50
        bcs     L_0cfe
        add     #$30

L_0cfe:                          .at $0cfe
        sta     ,x
        incx    
        cpx     #$26
        bne     L_0cee
        ldx     #$21
        clra    

L_0d07:                          .at $0d07
        rola    
        rol     ,x
        rora    
        incx    
        cpx     #$26
        bne     L_0d07
        dec     $26
        bne     L_0cec
        lda     $23
        ldx     $24
        bmi     L_0d1b
        clc     
        rts     

L_0d1b:                          .at $0d1b
        sec     
        rts     
        .at     $0d1d
        db      $44, $44, $44, $44, $a4, $0f, $ab, $30, $a1, $39, $23, $02, $ab, $07, $81
        .at     $0d2c

init_selcall_ctcss:              .at $0d2c
        lda     #$00
        sta     $4f
        bsr     copy_selcall_codes
        lda     #$0f
        sta     $c2

set_ctcss_tone:                  .at $0d36
        lda     $34                             ; CTCSS code (byte6 bits0-5, 1-38) -> 6-bit tone-chip value at $0E56+code -> $81; bit6 = normal phase
        and     #$3f
        beq     L_0d44
        tax     
        lda     $0e56,x
        ora     #$40
        sta     $81

L_0d44:                          .at $0d44
        rts     

copy_selcall_codes:              .at $0d45
        ldx     #$0a                            ; copy selcall codes 1F67..1F70 -> $CA.., 1F7A..1F83 -> $D4..

L_0d47:                          .at $0d47
        lda     $1f66,x
        sta     $c9,x
        lda     $1f79,x
        sta     $d3,x
        decx    
        bne     L_0d47
        jmp     L_1403

L_0d57:                          .at $0d57
        rti     

main_loop_part2:                 .at $0d58
        brset   0,$11,L_0d5e
        jsr     ctcss_decode_task

L_0d5e:                          .at $0d5e
        brset   6,$81,L_0d64
        jsr     ctcss_burst_end

L_0d64:                          .at $0d64
        brclr   6,$15,L_0d6a
        jsr     ctcss_burst_start

L_0d6a:                          .at $0d6a
        jsr     scan_task
        brclr   6,$13,L_0d73
        jsr     vote_task

L_0d73:                          .at $0d73
        brset   0,$11,L_0d79
        jsr     ctcss_decode_task

L_0d79:                          .at $0d79
        brset   0,$11,L_0d7f
        jsr     selcall_decode_task

L_0d7f:                          .at $0d7f
        brclr   5,$15,L_0d85
        jsr     selcall_encode_task

L_0d85:                          .at $0d85
        brclr   4,$a3,L_0d8b
        jsr     selcall_rx_own

L_0d8b:                          .at $0d8b
        brclr   5,$a3,L_0d91
        jsr     selcall_rx_code2

L_0d91:                          .at $0d91
        brclr   6,$a3,L_0d97
        jsr     selcall_rx_code3

L_0d97:                          .at $0d97
        jsr     selcall_alert_task
        brclr   2,$a1,L_0da0
        jsr     selcall_resend_task

L_0da0:                          .at $0da0
        brclr   7,$14,L_0da6
        jsr     selcall_c8_reload

L_0da6:                          .at $0da6
        brclr   2,$a0,L_0dac
        jsr     selcall_resend_timer

L_0dac:                          .at $0dac
        jsr     selcall_offhook_task
        brclr   0,$a3,L_0dba
        lda     $a3
        bit     #$f0
        bne     L_0dba
        bclr    0,$a3

L_0dba:                          .at $0dba
        brclr   6,$2a,L_0dc0
        jsr     econ_task

L_0dc0:                          .at $0dc0
        brset   1,$82,L_0dc6
        jsr     ctcss_tx_watch

L_0dc6:                          .at $0dc6
        brclr   5,$31,L_0dcc
        jsr     auto_power_off_task

L_0dcc:                          .at $0dcc
        jmp     main_loop                       ; signature sample byte $0DCC; 

ctcss_decode_task:               .at $0dcf
        brclr   0,$30,L_0df5                    ; CTCSS decode, Rx only: $30 = 0x1F34 bit0 CTCSS fitted, bit2 decode; $34 bits 0-5 = channel tone
        brclr   2,$30,L_0df5
        lda     $34
        bit     #$3f
        beq     L_0df5
        brset   4,$19,L_0de5                    ; $19.4 = squelch open; $82 bit2 low = tone detected (inferred); $1B.5 = C/R channel
        bclr    3,$16
        brset   5,$1b,L_0df2                    ; no carrier: mute; on a C/R channel monitor ($11.4) does not open it
        bra     L_0def

L_0de5:                          .at $0de5
        brclr   2,$82,L_0df5
        brclr   5,$1b,L_0def
        bset    3,$16                           ; carrier, wrong/no tone, C/R channel: $16.3 = busy lockout (blocks Tx via tx_inhibited)
        bra     L_0df2

L_0def:                          .at $0def
        brset   4,$11,L_0df5

L_0df2:                          .at $0df2
        bset    3,$18                           ; $18.3 = CTCSS mute closed
        rts     

L_0df5:                          .at $0df5
        bclr    3,$18                           ; tone detected (or CTCSS off): mute open, lockout cleared
        bclr    3,$16
        rts     

ctcss_burst_end:                 .at $0dfa
        brclr   7,$e9,L_0e0f                    ; end of reverse tone burst after $E9 (5 x 27 ms ~ 135 ms): normal phase back, then tone off unless PTT was pressed again

L_0dfd:                          .at $0dfd
        bset    6,$81
        brclr   4,$11,L_0e0b
        lda     $15
        bit     #$03
        beq     L_0e0b
        brclr   2,$16,L_0e0f

L_0e0b:                          .at $0e0b
        bclr    6,$15

ctcss_tone_off:                  .at $0e0d
        bset    1,$82                           ; $82 bit1 = 1: tone not sent (inferred: encoder output gate)

L_0e0f:                          .at $0e0f
        rts     

ctcss_burst_start:               .at $0e10
        brclr   6,$81,L_0e2b                    ; both PTTs released ($15 = $40) with RTB armed: hold Tx, $81 bit6 = 0 (phase reversed, inferred) for $E9 = 5
        brclr   0,$30,L_0dfd
        lda     $15
        cmp     #$40
        beq     L_0e22
        brclr   2,$16,L_0e2b
        brset   5,$15,L_0e2b

L_0e22:                          .at $0e22
        brset   0,$29,L_0e0b
        ldx     #$05
        stx     $e9
        bclr    6,$81

L_0e2b:                          .at $0e2b
        rts     

ctcss_tx_on:                     .at $0e2c
        brclr   0,$30,L_0e44                    ; Tx on: tone only if CTCSS fitted, channel has a tone, and $11.4 or selcall sending ($15.5)
        lda     $34
        bit     #$3f
        beq     L_0e44
        brset   5,$15,L_0e3b
        brclr   4,$11,L_0e44

L_0e3b:                          .at $0e3b
        bset    6,$81
        bclr    1,$82                           ; $82 bit1 = 0: tone into the modulator (inferred)
        brclr   1,$30,L_0e44                    ; 0x1F34 bit1 = reverse tone burst: arm $15.6
        bset    6,$15

L_0e44:                          .at $0e44
        rts     

ctcss_tx_watch:                  .at $0e45
        brset   5,$15,L_0e51
        brset   4,$11,L_0e51
        brclr   6,$15,ctcss_tone_off
        brset   6,$81,L_0e22

L_0e51:                          .at $0e51
        rts     
        .at     $0e52
        db      $12, $1b, $cc, $07, $ea, $38, $34, $30, $2c, $28, $24, $20, $1c, $39, $35, $31   ; 0E57-0E7C: CTCSS tone-chip values for codes 1..38
        db      $2d, $29, $25, $21, $1d, $3f, $3d, $3b, $3c, $37, $33, $2f, $19, $18, $15, $14
        db      $11, $10, $0d, $0c, $09, $08, $05, $04, $01, $00, $2b
        .at     $0e7d

scan_task:                       .at $0e7d
        brset   4,$2a,L_0ead                    ; scanning: lists via $53/$54 pointer (1F40 block 1, 1F4C block 2)
        brclr   0,$1f,L_0eae
        lda     #$04
        and     $1f
        sta     $1f
        bset    0,$16
        bset    4,$18
        bset    6,$11
        bclr    6,$2a
        jsr     update_display
        bra     L_0eae

L_0e96:                          .at $0e96
        jsr     squelch_open_test
        bcc     L_0ea6
        brset   2,$82,L_0ea3
        bclr    2,$14
        jmp     L_0f4c

L_0ea3:                          .at $0ea3
        brclr   7,$61,L_0ead

L_0ea6:                          .at $0ea6
        bclr    2,$14
        bra     L_0ecf

L_0eaa:                          .at $0eaa
        brclr   0,$11,L_0ecf

L_0ead:                          .at $0ead
        rts     

L_0eae:                          .at $0eae
        brclr   6,$11,L_0ead
        brset   2,$1c,L_0ead
        brset   5,$11,L_0eaa
        brset   2,$14,L_0e96
        brset   3,$1f,L_0ee8
        brset   1,$1f,L_0f2a
        brset   4,$11,L_0f12

L_0ec3:                          .at $0ec3
        brclr   4,$1f,L_0ecf
        brset   7,$30,L_0ecc
        brclr   2,$1f,L_0f45

L_0ecc:                          .at $0ecc
        brclr   7,$56,L_0f2e

L_0ecf:                          .at $0ecf
        brset   7,$11,L_0ed5
        jmp     L_0f70

L_0ed5:                          .at $0ed5
        bset    3,$1f
        bclr    0,$16
        bclr    7,$11
        bclr    2,$1f
        bclr    4,$18
        lda     #$4b
        sta     $60
        lda     $51
        jmp     L_0fac

L_0ee8:                          .at $0ee8
        brset   2,$1f,L_0efc
        brclr   7,$60,L_0efc
        brset   0,$11,L_0efc
        brset   4,$11,L_0efc
        brset   7,$1f,L_0efc
        jsr     scan_list_read0
        bne     L_0eff

L_0efc:                          .at $0efc
        jmp     L_0fb1

L_0eff:                          .at $0eff
        bset    7,$11
        bset    5,$29
        bset    2,$29
        lda     $2e
        sta     $51

L_0f09:                          .at $0f09
        bclr    3,$1f
        bset    0,$16
        bset    4,$18
        jmp     L_0f9f

L_0f12:                          .at $0f12
        brset   7,$11,L_0ec3
        bset    1,$1f
        lda     $2e
        sta     $52
        jsr     scan_list_read0
        bne     L_0f27
        lda     $50
        sta     $2e
        jmp     L_0fa6

L_0f27:                          .at $0f27
        brclr   2,$1f,L_0f09

L_0f2a:                          .at $0f2a
        bclr    1,$1f
        bra     L_0f59

L_0f2e:                          .at $0f2e
        bsr     squelch_open_test
        bcc     L_0f44
        brclr   0,$30,L_0f4c
        brclr   2,$30,L_0f4c
        lda     $34
        bit     #$3f
        beq     L_0f4c
        bset    2,$14
        lda     #$0e
        sta     $61

L_0f44:                          .at $0f44
        rts     

L_0f45:                          .at $0f45
        brclr   7,$56,L_0f44
        bsr     squelch_open_test
        bcs     L_0ecf

L_0f4c:                          .at $0f4c
        brset   7,$11,L_0f55
        lda     #$4b
        sta     $60
        bra     L_0f59

L_0f55:                          .at $0f55
        bset    1,$1b
        bclr    7,$11

L_0f59:                          .at $0f59
        bclr    0,$16
        bclr    4,$18
        bset    3,$1f
        jmp     update_display

squelch_open_test:               .at $0f62
        lda     $2d                             ; compare noise $45 with open threshold 1F14+squelch setting
        and     #$07
        bne     L_0f69
        inca    

L_0f69:                          .at $0f69
        tax     
        lda     $45
        cmp     $1f14,x
        rts     

L_0f70:                          .at $0f70
        ldx     #$00
        jsr     scan_list_read
        beq     L_0f7a
        brclr   2,$1f,L_0fa4

L_0f7a:                          .at $0f7a
        ldx     #$0b
        jsr     $21
        bne     L_0f83
        jmp     scan_stop

L_0f83:                          .at $0f83
        sta     $25
        lda     $4f
        and     #$0f
        cmp     $25
        bcs     L_0f94
        lda     $4f
        and     #$f0
        sta     $4f
        clra    

L_0f94:                          .at $0f94
        add     #$01
        tax     
        jsr     $21
        inc     $4f
        bclr    2,$1f
        bra     L_0fa6

L_0f9f:                          .at $0f9f
        ldx     #$00
        jsr     scan_list_read

L_0fa4:                          .at $0fa4
        bset    2,$1f

L_0fa6:                          .at $0fa6
        ldx     #$3b
        stx     $56
        bset    4,$1f

L_0fac:                          .at $0fac
        sta     $2e
        jmp     select_channel

L_0fb1:                          .at $0fb1
        brset   0,$11,L_0fd7
        bsr     squelch_open_test
        bcc     L_0fe5
        brclr   0,$30,L_0fed
        brclr   2,$30,L_0fed
        lda     $34
        bit     #$3f
        beq     L_0fed
        brclr   2,$82,L_0fed

L_0fc7:                          .at $0fc7
        brset   4,$11,L_0ff5
        brset   0,$1b,L_0fd3
        brclr   7,$1f,L_0fde
        brclr   7,$61,L_0fdb

L_0fd3:                          .at $0fd3
        bclr    3,$1f
        bset    0,$1f

L_0fd7:                          .at $0fd7
        bclr    6,$1f
        bclr    7,$1f

L_0fdb:                          .at $0fdb
        bclr    0,$1b
        rts     

L_0fde:                          .at $0fde
        lda     #$7f
        sta     $61
        bset    7,$1f
        rts     

L_0fe5:                          .at $0fe5
        brset   2,$1f,L_0fc7
        brclr   7,$30,L_0fd7
        bra     L_0fc7

L_0fed:                          .at $0fed
        brset   2,$1f,L_0fd7
        brset   7,$30,L_0fd7
        bra     L_0fc7

L_0ff5:                          .at $0ff5
        bclr    7,$1f
        brset   6,$1f,L_1004
        brset   0,$1b,L_1003
        lda     #$20
        sta     $65
        bset    6,$1f

L_1003:                          .at $1003
        rts     

L_1004:                          .at $1004
        brclr   7,$65,L_1003
        bset    0,$1b
        bclr    6,$1f
        rts     

fn_scan:                         .at $100c
        bset    1,$1b
        bclr    0,$1c
        brclr   4,$30,L_1062
        brset   0,$11,L_1062
        brset   6,$13,L_1062
        brclr   6,$11,L_101f
        jsr     scan_stop

L_101f:                          .at $101f
        lda     $4f
        clr     $4f
        and     #$f0
        add     #$10
        beq     L_1037
        cmp     #$30
        bcc     L_1037
        jsr     scan_list_select
        ldx     #$0b
        jsr     scan_list_read
        bne     L_1050

L_1037:                          .at $1037
        clr     $4f
        jmp     update_display

scan_stop:                       .at $103c
        clr     $1f
        bclr    0,$1b
        bclr    4,$18
        bclr    6,$11
        bclr    7,$11
        lda     $50
        sta     $2e
        jsr     select_channel_A
        bclr    0,$16
        rts     

L_1050:                          .at $1050
        brset   6,$13,L_1062
        jsr     selcall_encode_done
        jsr     rx_channel_notify
        lda     $2e
        sta     $50
        clr     $1f
        bset    0,$1f
        rts     

L_1062:                          .at $1062
        jmp     beep_reject

scan_list_read0:                 .at $1065
        ldx     #$00

scan_list_read:                  .at $1067
        lda     #$d6                            ; RAM routine LDA list,X  (X=0 priority channel, X=11 count)
        sta     $21
        lda     #$81
        sta     $24
        lda     $53
        sta     $22
        lda     $54
        sta     $23
        jmp     $21                             ; scan list base table: 1F40, 1F4C
        .at     $1079
        db      $1f, $40, $1f, $4c
        .at     $107d

scan_list_select:                .at $107d
        sta     $4f
        lsra    
        lsra    
        lsra    
        tax     
        lda     $1077,x
        sta     $53
        lda     $1078,x
        sta     $54
        rts     

vote_task:                       .at $108e
        brclr   1,$31,L_10bd                    ; voting: hop round the linked ring (byte7 & $7F)+1, compare RSSI ($46)
        brset   0,$11,L_10bd
        brset   2,$1c,L_10bd
        clra    
        brset   5,$11,L_10c1
        lda     $2d
        and     #$f8
        add     #$02
        sta     $2d
        clra    
        bsr     vote_measure
        brset   7,$18,L_10b3
        brset   4,$19,L_10b8
        brclr   7,$e8,L_10bd
        bset    7,$18
        bra     L_10f6

L_10b3:                          .at $10b3
        brset   1,$1f,L_10be
        bset    1,$1f

L_10b8:                          .at $10b8
        lda     $1fb4
        sta     $e8

L_10bd:                          .at $10bd
        rts     

L_10be:                          .at $10be
        brclr   7,$e8,L_10bd

L_10c1:                          .at $10c1
        brclr   5,$16,L_10ca
        cmp     $51
        bhi     L_10df
        bra     L_10e5

L_10ca:                          .at $10ca
        tst     $15
        bne     L_10bd
        jsr     squelch_open_test
        bcc     L_10f6
        bset    5,$16
        bsr     vote_score
        ldx     $2e
        stx     $53
        clr     $51
        bra     L_10b8

L_10df:                          .at $10df
        sta     $51
        lda     $2e
        sta     $52

L_10e5:                          .at $10e5
        lda     $35
        and     #$7f
        inca    
        cmp     $53
        bne     L_10f6
        bclr    7,$18
        bclr    5,$16
        lda     $52
        bra     L_10fb

L_10f6:                          .at $10f6
        lda     $35
        and     #$7f
        inca    

L_10fb:                          .at $10fb
        ldx     $1fb4                           ; 1FB4 = vote/scan dwell time
        stx     $e8

L_1100:                          .at $1100
        sta     $2e
        bset    6,$a0
        jmp     select_channel_A

chan_flags_rx:                   .at $1107
        bset    6,$13
        bit     #$20
        bne     L_1121
        bclr    6,$13
        bclr    5,$16
        bclr    7,$18
        brclr   3,$31,L_111f
        brclr   6,$2a,L_111f
        brset   2,$1f,L_111f
        brset   6,$29,L_1121

L_111f:                          .at $111f
        bclr    2,$19

L_1121:                          .at $1121
        rts     

vote_measure:                    .at $1122
        jsr     squelch_open_test
        bcs     vote_score
        clra    
        rts     

vote_score:                      .at $1129
        cmp     $1f1b                           ; 1F1B = voting threshold
        bcs     L_1132
        nega    
        and     #$7f
        rts     

L_1132:                          .at $1132
        lda     $46
        ora     #$80
        rts     

vote_tx_channel:                 .at $1137
        brclr   1,$31,L_1141
        brclr   6,$13,L_1141
        lda     $52
        bra     L_1100

L_1141:                          .at $1141
        rts     

selcall_decode_task:             .at $1142
        brset   0,$a3,L_1181                    ; selcall decoder: reads tone digit from $80, compares with 1F8D/1F96/1F9F codes
        brclr   6,$80,L_1169
        lda     $80
        bset    7,$80
        ldx     #$14

L_114e:                          .at $114e
        decx    
        bne     L_114e
        bclr    7,$80
        and     #$0f
        ldx     $c2
        sta     $c2
        brclr   2,$a3,L_1189
        tst     $be
        bne     L_1182
        lda     $a3
        and     #$f2
        ora     #$01
        sta     $a3
        rts     

L_1169:                          .at $1169
        brclr   2,$a3,L_1181
        brclr   7,$ea,L_1181
        brset   3,$a3,L_11c7
        ldx     $c0
        lda     $1f84,x
        tst     $be
        bne     L_117d
        lda     #$3d

L_117d:                          .at $117d
        sta     $ea
        bset    3,$a3

L_1181:                          .at $1181
        rts     

L_1182:                          .at $1182
        cmp     #$0e
        bne     L_1195
        txa     
        bra     L_1195

L_1189:                          .at $1189
        lda     #$f4
        sta     $a3
        lda     $d4
        sta     $be
        clr     $c0
        lda     $c2

L_1195:                          .at $1195
        ldx     $c0
        bclr    0,$13
        cmp     #$0a
        bne     L_11a6
        bset    0,$13
        brclr   2,$32,L_11c7
        bset    1,$a3
        bra     L_11c1

L_11a6:                          .at $11a6
        cmp     $d5,x
        beq     L_11ac
        bclr    4,$a3

L_11ac:                          .at $11ac
        cmp     $1f8d,x
        beq     L_11b3
        bclr    5,$a3

L_11b3:                          .at $11b3
        cmp     $1f96,x
        beq     L_11ba
        bclr    6,$a3

L_11ba:                          .at $11ba
        cmp     $1f9f,x
        beq     L_11c1
        bclr    7,$a3

L_11c1:                          .at $11c1
        lda     $a3
        bit     #$f0
        bne     L_11ca

L_11c7:                          .at $11c7
        clr     $a3
        rts     

L_11ca:                          .at $11ca
        dec     $be
        incx                                    ; signature sample byte $11CC; 
        stx     $c0
        lda     $1f83,x
        brclr   0,$13,L_11d9
        lsla    
        add     $1f83,x

L_11d9:                          .at $11d9
        sta     $ea
        bclr    3,$a3
        rts     

selcall_encode_task:             .at $11de
        brclr   0,$11,L_1238                    ; selcall encoder: sends digits with timing from 1F70/1F71
        brclr   0,$32,L_1262
        brclr   0,$a1,L_1239
        brset   7,$a1,L_123b
        brclr   7,$e7,L_1264
        tst     $c1
        beq     L_11fd
        dec     $c1
        beq     L_11fd
        ldx     $bf
        lda     $1f70,x
        sta     $e7
        rts     

L_11fd:                          .at $11fd
        dec     $be
        beq     L_1265

L_1201:                          .at $1201
        ldx     $c0
        lda     ,x
        brclr   1,$a1,L_1218
        ldx     $bf
        lda     $1f8d,x
        brclr   6,$2f,L_1218
        ldx     $be
        cpx     #$01
        bne     L_1218
        ldx     $c0
        lda     ,x

L_1218:                          .at $1218
        bmi     L_1220
        cmp     $c3
        bne     L_1220
        lda     #$0e

L_1220:                          .at $1220
        sta     $c3
        ora     #$50
        jsr     tone_chip_write
        bclr    6,$80
        ldx     $bf
        lda     $1f71,x
        inc     $c0
        inc     $bf
        sta     $e7
        lda     $c8
        sta     $c1

L_1238:                          .at $1238
        rts     

L_1239:                          .at $1239
        bra     L_1267

L_123b:                          .at $123b
        brclr   7,$e7,L_1264
        dec     $c1
        bne     L_1297

selcall_send_start:              .at $1242
        lda     #$b0
        sta     $84
        lda     #$0f
        bsr     tone_chip_write
        jsr     selcall_display_end_if
        lda     $a1
        and     #$08
        sta     $a1
        bclr    1,$a0

selcall_encode_done:             .at $1255
        bclr    0,$17
        lda     $1f7a
        sta     $d4
        brclr   0,$a0,L_1262
        jsr     selcall_store_last

L_1262:                          .at $1262
        bclr    5,$15

L_1264:                          .at $1264
        rts     

L_1265:                          .at $1265
        bra     L_12b6

L_1267:                          .at $1267
        brset   6,$a1,L_129c
        bset    6,$a1
        bset    0,$17
        ldx     #$d4
        brclr   4,$a1,L_1275
        ldx     #$ca

L_1275:                          .at $1275
        stx     $c0
        clr     $bf
        bset    4,$80
        bclr    6,$80
        lda     #$ff
        sta     $84
        lda     #$5f
        bsr     tone_chip_write
        bclr    6,$80
        lda     $1fab
        brset   1,$a0,L_1295
        brset   3,$a1,L_1295
        brset   0,$33,L_1295
        lda     #$0a

L_1295:                          .at $1295
        sta     $c1

L_1297:                          .at $1297
        lda     #$0c
        sta     $e7
        rts     

L_129c:                          .at $129c
        brclr   7,$e7,L_1264
        dec     $c1
        bne     L_1297
        bclr    6,$a1
        ldx     $c0
        lda     ,x
        sta     $be
        incx    
        stx     $c0
        lda     #$ff
        sta     $c3
        bset    0,$a1
        jmp     L_1201

L_12b6:                          .at $12b6
        lda     #$5f
        bsr     tone_chip_write
        bclr    6,$80
        bclr    1,$a1
        bset    7,$a1
        lda     $1fac
        sta     $c1
        bra     L_1297

tone_chip_write:                 .at $12c7
        sta     $21
        lda     $80
        and     #$20
        ora     $21
        sta     $80
        rts     

selcall_rx_code2:                .at $12d2
        brset   2,$a3,L_1315
        bclr    5,$a3
        brclr   7,$34,L_1315
        brclr   2,$33,L_1315
        bset    1,$a1
        bset    4,$1b
        bra     L_12f5

selcall_rx_own:                  .at $12e3
        brset   2,$a3,L_1315
        bclr    4,$a3
        brclr   1,$32,L_1315
        brclr   7,$34,L_1315
        bclr    5,$a1
        brset   7,$33,L_1301
        bset    1,$1b

L_12f5:                          .at $12f5
        bset    4,$a2
        lda     #$a7
        jsr     head_send
        bclr    2,$18
        brclr   7,$32,L_1315

L_1301:                          .at $1301
        brset   1,$a3,L_1315
        bset    5,$a1
        bset    5,$14
        bset    3,$a1
        bclr    4,$a1
        bset    5,$15

selcall_set_len7:                .at $130e
        brset   3,$32,L_1315
        ldx     #$07
        stx     $d4

L_1315:                          .at $1315
        rts     

selcall_rx_code3:                .at $1316
        brset   2,$a3,L_1327
        bclr    6,$a3
        brset   1,$a3,L_1327
        brclr   3,$33,L_1327
        bset    5,$80
        lda     #$11
        sta     $eb

L_1327:                          .at $1327
        rts     

selcall_alert_task:              .at $1328
        brclr   5,$80,L_133e
        brset   5,$32,L_1333
        brclr   7,$eb,L_133e
        bra     selcall_alert_off

L_1333:                          .at $1333
        brclr   7,$a3,L_1340
        brset   2,$a3,L_1340
        brset   1,$a3,L_133e

selcall_alert_off:               .at $133c
        bclr    5,$80

L_133e:                          .at $133e
        bclr    7,$a3

L_1340:                          .at $1340
        rts     

selcall_resend_task:             .at $1341
        brset   0,$11,L_134d
        brset   4,$19,L_1356
        brclr   6,$11,L_134d
        brclr   4,$11,L_1356

L_134d:                          .at $134d
        bset    5,$15
        bclr    2,$a1
        lda     $1faa
        sta     $ec

L_1356:                          .at $1356
        rts     

selcall_resend_timer:            .at $1357
        brset   1,$a0,L_135f
        brclr   7,$ec,L_135f
        bclr    2,$a0

L_135f:                          .at $135f
        rts     

selcall_ani_release:             .at $1360
        brclr   0,$11,L_1373
        brset   0,$33,L_1373
        bra     L_136b

selcall_ani_press:               .at $1368
        brclr   0,$33,L_1373

L_136b:                          .at $136b
        brclr   7,$35,L_1373
        jsr     selcall_set_len7
        bset    5,$15

L_1373:                          .at $1373
        rts     

selcall_offhook_task:            .at $1374
        brclr   4,$11,L_1399
        bclr    2,$18
        brset   1,$32,L_137f
        brclr   2,$33,L_13b7

L_137f:                          .at $137f
        brset   4,$a0,L_135f
        bset    4,$a0
        bclr    4,$1b
        brset   5,$32,L_138b
        bsr     selcall_alert_off

L_138b:                          .at $138b
        bclr    4,$a2
        bset    2,$12
        brclr   4,$19,L_1396
        bset    1,$12
        bclr    2,$12

L_1396:                          .at $1396
        jmp     update_display

L_1399:                          .at $1399
        brclr   4,$a0,L_135f
        bclr    4,$a0

selcall_mute_setup:              .at $139e
        brclr   1,$32,L_13b1
        brclr   7,$34,L_13b1
        brset   6,$a0,L_13b5
        brset   3,$a1,L_13b1
        brset   7,$33,L_13b1
        bset    2,$18
        bra     L_13b3

L_13b1:                          .at $13b1
        bclr    2,$18

L_13b3:                          .at $13b3
        bclr    3,$a1

L_13b5:                          .at $13b5
        bclr    6,$a0

L_13b7:                          .at $13b7
        rts     
        .at     $13b8
        db      $10, $a0, $cd, $13, $0e, $07, $32, $06, $be, $d9, $b7, $d9, $20, $04, $be, $db
        db      $b7, $db, $bf, $c7, $81
        .at     $13cd

selcall_store_last:              .at $13cd
        lda     $c7
        brclr   3,$32,L_13d6
        sta     $d9
        bra     L_13d8

L_13d6:                          .at $13d6
        sta     $db

L_13d8:                          .at $13d8
        bclr    0,$a0
        rts     

selcall_display_end_if:          .at $13db
        brclr   4,$a1,L_13f9

selcall_display_end:             .at $13de
        brclr   7,$a0,L_1402

selcall_display_restore:         .at $13e1
        bclr    7,$a0
        bclr    1,$1d
        bclr    1,$1e
        lda     $ce
        sta     $de
        lda     $cf
        sta     $df
        lda     $e0
        sta     $ce
        lda     $e1
        sta     $cf
        bra     L_1403

L_13f9:                          .at $13f9
        rts     

selcall_ram_sum:                 .at $13fa
        clra    
        ldx     #$18

L_13fd:                          .at $13fd
        add     $c9,x
        decx    
        bne     L_13fd

L_1402:                          .at $1402
        rts     

L_1403:                          .at $1403
        bsr     selcall_ram_sum
        nega    
        sta     $c9
        rts     

selcall_ram_check:               .at $1409
        brset   7,$a0,L_141b                    ; called from head_poll_timer: re-copy the selcall codes from EPROM if the RAM copy's sum ($C9-$E1) is not 0
        brset   1,$a0,L_141b
        brset   5,$15,L_141b
        bsr     selcall_ram_sum
        add     $c9
        beq     L_141b
        jmp     copy_selcall_codes

L_141b:                          .at $141b
        rts     

fn_selcall_send:                 .at $141c
        brset   7,$16,L_1462
        brset   3,$16,L_1462
        brclr   0,$32,L_1462
        brclr   7,$34,L_1462
        brclr   4,$a2,L_1438
        bclr    4,$a2
        bclr    4,$1b
        bset    2,$12
        brclr   4,$19,L_1438
        bset    1,$12
        bclr    2,$12

L_1438:                          .at $1438
        brset   1,$a0,L_1468
        brclr   5,$1b,L_1441
        brset   4,$19,L_1462

L_1441:                          .at $1441
        bset    4,$a1
        brset   2,$a0,L_1465
        brset   6,$11,L_1462
        brset   0,$11,L_144f
        jsr     auto_power_off_reset

L_144f:                          .at $144f
        bset    1,$1b
        bset    2,$a0
        bset    1,$a0
        bclr    1,$a1
        bset    2,$a1
        brset   0,$11,L_1461
        lda     #$a3
        jsr     head_send

L_1461:                          .at $1461
        rts     

L_1462:                          .at $1462
        jsr     beep_reject

L_1465:                          .at $1465
        bclr    4,$a1
        rts     

L_1468:                          .at $1468
        brclr   1,$33,L_147a
        bset    1,$1b
        bclr    2,$a0
        jsr     selcall_send_start

rx_channel_notify:               .at $1472
        brset   0,$11,L_147a
        lda     #$a0
        jsr     head_send

L_147a:                          .at $147a
        rts     

fn_selcall_toggle:               .at $147b
        brclr   0,$32,L_14a2
        brclr   6,$33,L_14a2
        bset    1,$1b
        brclr   7,$a0,L_148d
        bclr    7,$a0
        jsr     selcall_display_restore
        bra     L_149f

L_148d:                          .at $148d
        bset    7,$a0
        lda     $ce
        sta     $e0
        lda     $cf
        sta     $e1
        lda     $de
        sta     $ce
        lda     $df
        sta     $cf

L_149f:                          .at $149f
        jmp     update_display

L_14a2:                          .at $14a2
        jmp     beep_reject

L_14a5:                          .at $14a5
        ldx     #$ce
        bra     L_14ab

L_14a9:                          .at $14a9
        ldx     #$cf

L_14ab:                          .at $14ab
        inc     ,x
        lda     ,x
        cmp     #$09
        bls     L_14b2
        clr     ,x

L_14b2:                          .at $14b2
        bset    1,$1b
        jmp     update_display

show_selcall_digits:             .at $14b7
        lda     $ce
        lsla    
        lsla    
        lsla    
        lsla    
        ora     $cf
        bset    1,$1d
        bset    1,$1e
        jmp     display_digits

selcall_c8_reload:               .at $14c6
        brclr   7,$81,L_14d0
        bclr    7,$14
        lda     $1fa9
        sta     $c8

L_14d0:                          .at $14d0
        rts     

econ_task:                       .at $14d1
        brset   4,$2a,L_14fd                    ; economiser: power-save cycling with times 1FB1/1FB2/1FB3
        brset   2,$1c,L_14ed
        brset   2,$19,L_150d
        brset   4,$19,L_150d
        brset   0,$11,L_150d
        brset   4,$11,L_150d
        lda     $15
        bne     L_150d
        brset   2,$1f,L_14ee
        brset   7,$60,L_14f3

L_14ed:                          .at $14ed
        rts     

L_14ee:                          .at $14ee
        brclr   7,$60,L_14ed
        bclr    2,$1f

L_14f3:                          .at $14f3
        bset    6,$18
        bset    4,$2a
        lda     $1fb3
        sta     $60
        rts     

L_14fd:                          .at $14fd
        brclr   7,$60,L_14ed
        bsr     econ_wake_delay
        lda     $1fb2
        sta     $60
        jsr     tx_stop
        bclr    6,$18
        rts     

L_150d:                          .at $150d
        bset    2,$1f
        lda     $1fb1
        sta     $60
        rts     

econ_wake_delay:                 .at $1515
        bclr    4,$2a
        lda     #$0c
        jsr     delay_A
        rts     
        .at     $151d
        db      $07, $31, $24, $03, $35, $21, $0c, $11, $1e, $0c, $13, $1b, $12, $1b, $0d, $2a
        db      $0e, $20, $1a
        .at     $1530

econ_setup:                      .at $1530
        brclr   3,$31,L_1543
        brclr   2,$35,L_1547
        brset   6,$11,L_1547
        brset   6,$13,L_1547
        bset    6,$2a
        lda     $1fb2
        sta     $60

L_1543:                          .at $1543
        rts     
        .at     $1544
        db      $cc, $07, $ea
        .at     $1547

L_1547:                          .at $1547
        brclr   6,$2a,L_1543
        bsr     econ_wake_delay
        lda     $1f00
        inca    
        sta     $48
        bclr    6,$18
        bclr    6,$2a
        rts     

auto_power_off_task:             .at $1557
        brset   0,$11,L_1570                    ; 8-hour auto power off: 1FB5 x 30 min (enabled by 1F35 bit5)
        brset   6,$1c,L_1570
        brset   7,$1c,L_1570
        lda     $67
        bne     L_1570
        dec     $4e
        bmi     L_1571
        bne     L_1579
        lda     #$02
        sta     $67
        bset    1,$1b

L_1570:                          .at $1570
        rts     

L_1571:                          .at $1571
        jmp     power_down_stop

auto_power_off_reset:            .at $1574
        lda     $1fb5
        sta     $4e

L_1579:                          .at $1579
        lda     #$b4
        sta     $67
        rts     

head_ram_dump:                   .at $157e
        lda     #$ec                            ; command $4A from head: dump RAM to head (diagnostic)
        jsr     head_send
        clrx    

L_1584:                          .at $1584
        lda     ,x
        jsr     head_send
        decx    
        bne     L_1584
        rts     

init_peripherals:                .at $158c
        brset   6,$11,L_1594                    ; init external peripherals $80-$86
        brset   0,$1f,L_1594
        clr     $4f

L_1594:                          .at $1594
        lda     #$00
        sta     $80
        lda     #$00
        sta     $81
        lda     #$06
        sta     $82
        lda     #$b0
        sta     $84
        sta     $a4
        lda     #$7f
        sta     $85
        lda     #$3b
        sta     $86
        rts     

        .at     $15af
; ---- $15AF-$1B3F: free area. New code goes here (or in fork.asm, included here).
        .if FORK
        .include "fork.asm"
        .endif

; ---- $1B40-$1FEF: channel table (99 x 8 at $1BE8) and configuration block,
; master defaults. fm900gen rewrites most of it (FM900_FORMAT.md §4).
        .org    $1B40
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $25, $4b, $1b, $82, $00, $38, $0d, $68, $00, $82, $00, $15, $09, $32, $1a, $82
        db      $02, $60, $06, $eb, $57, $2a, $23, $1c, $17, $13, $10, $0e, $57, $31, $31, $31
        db      $31, $31, $31, $31, $01, $0a, $14, $1e, $28, $32, $3c, $46, $0f, $05, $5a, $f4
        db      $02, $00, $a5, $00, $00, $00, $00, $00, $00, $00, $0b, $05, $01, $03, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $ff, $1e, $00, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff
        db      $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff
        db      $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff
        db      $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff
        db      $ff, $ff, $ff, $ff, $ff, $ff, $ff, $ff, $07, $00, $0b, $3c, $0a, $12, $23, $24
        db      $12, $4b, $03, $0d, $3b, $10, $08, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        db      $00, $01, $00, $00, $00, $05, $0a, $ff, $f0, $51, $80, $30, $30, $32, $39, $3a

; ---- vectors
        .org    $1FF0
        dw      $0000
        dw      TIMER_ISR
        dw      TIMER_ISR
        dw      TIMER_ISR
        dw      TIMER_ISR
        dw      IRQ_ISR
        dw      RESET
        dw      RESET

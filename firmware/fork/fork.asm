; FM92R fork: new code, included by FM92R.asm at the start of the free area.
;
; PC is $15AF here. Everything up to $1B3F is free (1425 bytes of $00 in the
; master). Hook new routines into the original code by overwriting an original
; instruction with JSR/JMP (plus NOPs to keep the size), so every `.at` in
; FM92R.asm still matches.
;
; Nothing here yet.

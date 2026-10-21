#!/usr/bin/env python3
"""
Patch the FM92R master firmware so the remote control head shows a 2-character
message (default "AA") for a couple of seconds at power-up, before the channel
number appears.

    ./patch_startup_msg.py                       # -> FM92R_AA.BIN next to this script
    ./patch_startup_msg.py --text HI --seconds 3 -o /tmp/FM92R_HI.BIN
    ../fm900gen.py build ch.csv --hw 9234.... --sw ... --master-file FM92R_AA.BIN -o radio.bin

How it works (see FIRMWARE.md):
  * 0x0272  `LDA #$AA ; JSR head_send` (the start-up message to the head) is
    replaced by `JSR $1700 ; NOP ; NOP`.
  * 0x1700 (unused EPROM) re-sends $AA, then sends the two display characters
    with the same messages display_digits uses ($80 + left char, $82 + right
    char, via the routine at 0x0C0F), then waits N x 256 timer ticks (~106 ms
    each, timed off tick counter $28 bit 7) and returns.  The normal start-up
    path then displays the channel number, replacing the message.
  * Nothing that feeds the firmware signature (0x01CC, 0x05CC ... 0x1ACC) is
    touched, and fm900gen / FM900.EXE recompute the EPROM checksum anyway.

UNTESTED ON HARDWARE.  The stock firmware only ever sends '0'-'9' and space to
the head; whether the head's display can draw letters depends on the head's own
character generator.  Worst case it shows blanks or garbage for two seconds.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = 0x0272
ORIG = bytes.fromhex('a6aacd0be5')        # lda #$aa ; jsr $0be5
PATCH_AT = 0x1700


def build_routine(c1, c2, loops):
    code = bytearray()
    code += bytes.fromhex('a6aa cd0be5')            # lda #$aa ; jsr head_send
    code += bytes([0xa6, 0x80, 0xae, c1]) + bytes.fromhex('cd0c0f')   # left char
    code += bytes([0xa6, 0x82, 0xae, c2]) + bytes.fromhex('cd0c0f')   # right char
    code += bytes([0xae, loops])                    # ldx #loops
    w1 = len(code)
    code += bytes.fromhex('0e28fd')                 # w1: brset 7,$28,w1
    code += bytes.fromhex('0f28fd')                 # w2: brclr 7,$28,w2
    code += bytes([0x5a])                           # decx
    rel = (w1 - (len(code) + 2)) & 0xff
    code += bytes([0x26, rel])                      # bne w1
    code += bytes([0x81])                           # rts
    return bytes(code)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--master', default=os.path.join(HERE, '..', 'fm900', 'MASTERS', 'FM92R.BIN'))
    ap.add_argument('--text', default='AA', help='exactly 2 characters')
    ap.add_argument('--seconds', type=float, default=2.0)
    ap.add_argument('-o', '--output')
    a = ap.parse_args()

    if len(a.text) != 2 or not all(32 <= ord(c) < 127 for c in a.text):
        sys.exit('--text must be 2 printable ASCII characters')
    loops = max(1, min(255, round(a.seconds / 0.1065)))
    img = bytearray(open(a.master, 'rb').read())
    if len(img) != 0x2000 or img[0x1FEB:0x1FF0] != b'0029:':
        sys.exit('%s is not the FM92R master (expected ID "0029:")' % a.master)
    if img[SITE:SITE + 5] != ORIG:
        sys.exit('unexpected bytes at 0x%04X - already patched or different firmware' % SITE)
    routine = build_routine(ord(a.text[0]), ord(a.text[1]), loops)
    if any(img[PATCH_AT:PATCH_AT + len(routine)]):
        sys.exit('patch area 0x%04X is not empty' % PATCH_AT)

    img[SITE:SITE + 5] = bytes.fromhex('cd%04x9d9d' % PATCH_AT)   # jsr $1700 ; nop ; nop
    img[PATCH_AT:PATCH_AT + len(routine)] = routine
    out = a.output or os.path.join(HERE, 'FM92R_%s.BIN' % ''.join(c if c.isalnum() else '_' for c in a.text))
    open(out, 'wb').write(img)
    if not a.text.replace(' ', '').isdigit():
        print('note: stock firmware only sends digits/space to the head; letters are untested',
              file=sys.stderr)
    print('wrote %s  ("%s" for ~%.1f s, %d loops)' % (out, a.text, loops * 0.1065, loops))


if __name__ == '__main__':
    main()

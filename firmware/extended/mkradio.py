#!/usr/bin/env python3
"""Build a radio EPROM image from the FM92R fork, with its callsign and Rx-frequency tables.

    python3 mkradio.py build ch.csv --hw 9248.... --sw ... -o radio.bin [--callsign VK2FN] [--keys ...] [--date ...]
    python3 mkradio.py fromjob X.JOB [X.CHL] -o radio.bin [--variant intro]

Same channel-list / .JOB input as fm900gen.py build / fromjob. It builds the
image with fm900gen from a fork master made by build.py:
  --variant enhanced (default)  build/FM92R-fork.BIN: start-up ident + Rx frequency display
  --variant intro               build/FM92R-intro.BIN: start-up ident only
(--master overrides the file). It then fills the tables the extended firmware reads
(fork.asm: MO_TABLE = the start-up Morse callsign, FQ_TABLE = frequencies)
and recomputes the checksums. Without --callsign the start-up shows "00" for
1 s with no sound.

The frequency of each slot is decoded from the slot's own Rx divider,
f = N x step - IF, so it is what the radio actually tunes. It is shown to
3 decimals (147.450), or 4 if the 100 Hz digit isn't 0 (477.0125).

fm900gen on its own (and WebFPP) leaves the table empty: the radio then
shows only the channel number, as stock firmware does.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)
import fm900gen  # noqa: E402

VARIANT_MASTERS = {'enhanced': os.path.join(HERE, 'build', 'FM92R-fork.BIN'),
                   'intro': os.path.join(HERE, 'build', 'FM92R-intro.BIN')}
FORK_MASTER = VARIANT_MASTERS['enhanced']
MO_MAGIC = 0x1978           # keep in sync with fork.asm
MO_TAB = 0x197C
MO_LEN = 48                 # bytes, including the 0 terminator
FQ_MAGIC = 0x19AC
FQ0 = 0x19B0
FQ_SPEED = 0x1977           # frequency window length - 1 in 26.6 ms ticks (fork.asm FQ_SPEED)
TICK_MS = 26.6              # the soft-timer tick
STEP_TICKS = (4, 38)        # allowed window lengths: 0.11 s (the head link needs ~37 ms per window) .. 1.01 s
STEP_DEFAULT = 9            # 0.24 s
NCH = 100                   # each FQn array is indexed by channel number 0-99
SLOTS = 0x1BE8              # FM92 channel table, 99 x 8 bytes, slot 0 = channel 1


MORSE = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.', 'G': '--.', 'H': '....',
    'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---', 'P': '.--.',
    'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
    '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.', '/': '-..-.', '?': '..--..',
    '.': '.-.-.-', ',': '--..--', '=': '-...-',
}


def morse_bytes(text):
    """Callsign text -> MO_TABLE bytes: 1 dit, 3 dah, $80 end of letter, $81 word space, 0 end."""
    out = []
    for word in text.upper().split():
        if out:
            out[-1] = 0x81                         # the letter gap before becomes a word gap
        for c in word:
            if c not in MORSE:
                raise ValueError('no Morse code for %r (letters, digits and / ? . , = only)' % c)
            out += [1 if e == '.' else 3 for e in MORSE[c]] + [0x80]
    out.append(0)
    if len(out) > MO_LEN:
        raise ValueError('callsign too long for the Morse table (%d of %d bytes)' % (len(out), MO_LEN))
    return bytes(out)


def fill_morse(img, text):
    """Write the start-up callsign into img (bytearray). Returns False if the master has no ident."""
    if img[MO_MAGIC:MO_MAGIC + 4] != b'MOR1':
        if text:
            raise fm900gen.FM900Error('master has no start-up ident (not built from the extended firmware)')
        return False
    b = morse_bytes(text or '')
    img[MO_TAB:MO_TAB + MO_LEN] = b + bytes(MO_LEN - len(b))
    return True


def step_ticks(ms):
    """Window length in ms -> whole 26.6 ms ticks, clamped to STEP_TICKS."""
    return max(STEP_TICKS[0], min(STEP_TICKS[1], int(round(ms / TICK_MS))))


def fill_step(img, ticks):
    """Set the frequency display speed: each 2-character window shows for `ticks` x 26.6 ms."""
    if img[FQ_MAGIC:FQ_MAGIC + 4] != b'FQT1':
        raise fm900gen.FM900Error('master has no frequency display (not built from the extended firmware, '
                                  'or an old build without the speed setting)')
    if not STEP_TICKS[0] <= ticks <= STEP_TICKS[1]:
        raise ValueError('frequency step %d ticks out of range %d..%d' % (ticks, *STEP_TICKS))
    img[FQ_SPEED] = ticks - 1


def freq_nibbles(f100):
    """Frequency in 100 Hz units -> list of 8 display nibbles ($F = '.', $E = end)."""
    mhz, frac = divmod(f100, 10000)
    if not 1 <= mhz <= 999:
        raise ValueError('frequency %d.%04d MHz out of range' % (mhz, frac))
    dec = '%04d' % frac
    if dec[3] == '0':                 # 3 decimals (25 kHz raster: 146.800); 4 only when the 100 Hz digit
        dec = dec[:3]                 # is used (12.5 kHz raster: 477.0125)
    s = [int(c) for c in str(mhz)] + [0xF] + [int(c) for c in dec]
    return s + [0xE] * (8 - len(s))


def windows(nibs):
    """What the head shows: 2-character windows sliding one character at a time."""
    ch = lambda n: ' ' if n == 0xF else str(n)
    out = []
    for w in range(1, 8):
        if nibs[w] == 0xE:
            break
        out.append(ch(nibs[w - 1]) + ch(nibs[w]))
    return out


def table_entry(img, ch):
    return [img[FQ0 + k * NCH + ch] for k in range(4)]


def entry_nibbles(b):
    return [n for x in b for n in (x >> 4, x & 0xF)]


def fill_table(img, step, ifo):
    """Write the frequency table into img (bytearray) from its channel slots."""
    if img[FQ_MAGIC:FQ_MAGIC + 4] != b'FQT1':
        raise fm900gen.FM900Error('master has no frequency table (not built from the extended firmware, '
                                  'or fork.asm and mkradio.py disagree on FQ_MAGIC)')
    for k in range(4):
        img[FQ0 + k * NCH: FQ0 + (k + 1) * NCH] = bytes(NCH)
    shown = {}
    for ch in range(1, 100):
        r = img[SLOTS + 8 * (ch - 1): SLOTS + 8 * ch]
        if not r[2] & 0x80:                       # empty slot
            continue
        n = fm900gen.decode_divider(r[0], r[1], r[2])
        f10 = n * step - ifo                      # 10 Hz units
        nibs = freq_nibbles(f10 // 10)
        for k in range(4):
            img[FQ0 + k * NCH + ch] = nibs[2 * k] << 4 | nibs[2 * k + 1]
        shown[ch] = f10
    return shown


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)

    def common(p):
        p.add_argument('--variant', choices=sorted(VARIANT_MASTERS), default='enhanced',
                       help='enhanced = start-up ident + Rx frequency display (default); intro = start-up ident only')
        p.add_argument('--master', help='fork master file (default: from --variant)')
        p.add_argument('--callsign', default='', help='Morse ident at start-up, e.g. VK2FN (default: none, "00" only)')
        p.add_argument('--date')
        p.add_argument('--keys')
        p.add_argument('-o', '--output', required=True)
        p.add_argument('--step-ms', type=float, default=STEP_DEFAULT * TICK_MS,
                       help='frequency display: how long each 2-character window shows, %d-%d ms (default %d; '
                            'rounded to 26.6 ms ticks)' % (round(STEP_TICKS[0] * TICK_MS), round(STEP_TICKS[1] * TICK_MS),
                                                           round(STEP_DEFAULT * TICK_MS)))
        p.add_argument('-v', '--verbose', action='store_true', help='list each channel\'s display sequence')

    p = sub.add_parser('build')
    p.add_argument('channels')
    p.add_argument('--hw', required=True)
    p.add_argument('--sw', required=True)
    p.add_argument('--power', default='H')
    common(p)
    p = sub.add_parser('fromjob')
    p.add_argument('job')
    p.add_argument('chl', nargs='?')
    common(p)
    a = ap.parse_args(argv)
    try:
        if a.cmd == 'build':
            chans = fm900gen.parse_channels(a.channels, a.power)
            hw, sw = a.hw, a.sw
        else:
            job = fm900gen.read_job(a.job)
            hw, sw = job['hw'], job['sw']
            chans = fm900gen.read_chl(a.chl or os.path.splitext(a.job)[0] + '.CHL')
        b = fm900gen.Builder(hw, sw, None, fm900gen.parse_date(a.date), keys=fm900gen.parse_keys(a.keys))
        if b.master_name() != 'FM92R.BIN':
            raise fm900gen.FM900Error('hardware code %s selects %s; the extended firmware is FM92R only '
                                      '(remote control, no selcall)' % (hw, b.master_name()))
        mpath = a.master or VARIANT_MASTERS[a.variant]
        if not os.path.exists(mpath):
            raise fm900gen.FM900Error('%s not found: run build.py first' % mpath)
        with open(mpath, 'rb') as f:
            img = bytearray(b.build(chans, f.read()))
        for w in b.vco_warnings(chans):
            print('WARNING: %s! Radio may not operate correctly.' % w, file=sys.stderr)
        fill_morse(img, a.callsign)
        shown = fill_table(img, b.step, b.ifo) if img[FQ_MAGIC:FQ_MAGIC + 4] == b'FQT1' else {}
        if shown or img[FQ_MAGIC:FQ_MAGIC + 4] == b'FQT1':
            fill_step(img, step_ticks(a.step_ms))
        fm900gen.checksum(img)
    except (fm900gen.FM900Error, ValueError) as e:
        print('error: %s' % e, file=sys.stderr)
        return 1
    with open(a.output, 'wb') as f:
        f.write(img)
    if a.verbose:
        for ch in sorted(shown):
            print('  %2d  %s' % (ch, ', '.join(windows(entry_nibbles(table_entry(img, ch))))))
    print('wrote %s: %s firmware, start-up ident %s, %s' % (
        a.output, a.variant if not a.master else a.master, a.callsign.upper() or 'none ("00" only)',
        'frequency table for %d channels (step %.2f kHz, IF %+.1f MHz), %.2f s per window' % (
            len(shown), b.step / 100, b.ifo / 100000, (img[FQ_SPEED] + 1) * TICK_MS / 1000)
        if img[FQ_MAGIC:FQ_MAGIC + 4] == b'FQT1' else 'no frequency display'))
    return 0


if __name__ == '__main__':
    sys.exit(main())

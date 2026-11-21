#!/usr/bin/env python3
"""Build a radio EPROM image from the FM92R fork, with the Rx-frequency table.

    python3 mkradio.py build ch.csv --hw 9248.... --sw ... -o radio.bin [--keys ...] [--date ...]
    python3 mkradio.py fromjob X.JOB [X.CHL] -o radio.bin

Same channel-list / .JOB input as fm900gen.py build / fromjob. It builds the
image with fm900gen from the fork master (build/FM92R-fork.BIN, made by
build.py; --master to use another), then fills the frequency table the fork's
head display reads (fork.asm, FQ_TABLE) and recomputes the checksums.

The frequency of each slot is decoded from the slot's own Rx divider,
f = N x step - IF, so it is what the radio actually tunes. It is shown to
3 decimals (147.450), or 4 if the 100 Hz digit isn't 0 (477.0125).

fm900gen on its own (and Web FPP) leaves the table empty: the radio then
shows only the channel number, as stock firmware does.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)
import fm900gen  # noqa: E402

FORK_MASTER = os.path.join(HERE, 'build', 'FM92R-fork.BIN')
FQ_MAGIC = 0x19AC           # keep in sync with fork.asm
FQ0 = 0x19B0
NCH = 100                   # each FQn array is indexed by channel number 0-99
SLOTS = 0x1BE8              # FM92 channel table, 99 x 8 bytes, slot 0 = channel 1


def freq_nibbles(f100):
    """Frequency in 100 Hz units -> list of 8 display nibbles ($F = '.', $E = end)."""
    mhz, frac = divmod(f100, 10000)
    if not 1 <= mhz <= 999:
        raise ValueError('frequency %d.%04d MHz out of range' % (mhz, frac))
    dec = '%04d' % frac
    if dec[3] == '0':
        dec = dec[:3]
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
        raise fm900gen.FM900Error('master has no frequency table (not built from the fork, '
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
        p.add_argument('--master', default=FORK_MASTER, help='fork master (default build/FM92R-fork.BIN)')
        p.add_argument('--date')
        p.add_argument('--keys')
        p.add_argument('-o', '--output', required=True)
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
            raise fm900gen.FM900Error('hardware code %s selects %s; the fork is FM92R only '
                                      '(remote control, no selcall)' % (hw, b.master_name()))
        if not os.path.exists(a.master):
            raise fm900gen.FM900Error('%s not found: run build.py first' % a.master)
        img = bytearray(b.build(chans, open(a.master, 'rb').read()))
        for w in b.vco_warnings(chans):
            print('WARNING: %s! Radio may not operate correctly.' % w, file=sys.stderr)
        shown = fill_table(img, b.step, b.ifo)
        fm900gen.checksum(img)
    except (fm900gen.FM900Error, ValueError) as e:
        print('error: %s' % e, file=sys.stderr)
        return 1
    open(a.output, 'wb').write(img)
    if a.verbose:
        for ch in sorted(shown):
            print('  %2d  %s' % (ch, ', '.join(windows(entry_nibbles(table_entry(img, ch))))))
    print('wrote %s: %d channels, frequency table filled (step %.2f kHz, IF %+.1f MHz)' % (
        a.output, len(shown), b.step / 100, b.ifo / 100000))
    return 0


if __name__ == '__main__':
    sys.exit(main())

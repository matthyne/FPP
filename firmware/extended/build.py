#!/usr/bin/env python3
"""Build the FM92R fork masters.

    python3 build.py            # -> build/FM92R-intro.BIN, build/FM92R-fork.BIN (+ .lst, .sym)

1. Assembles FM92R.asm with FORK=0 FREQ=0 INTRO=0 NOHOOK=0 and checks it is
   byte-identical to fm900/MASTERS/FM92R.BIN (so everything outside the `.if`
   blocks is still the original firmware). Stops if not.
2. Assembles each variant (VARIANTS), fixes the EPROM checksum (0x1F64) and
   firmware signature (0x1F65) with fm900gen's checksum(), so each master is
   self-consistent like the factory ones, checks its stack depth against the
   factory master, and writes build/<name>.BIN.

Radio images: mkradio.py (or WebFPP), which also fill the callsign and
frequency tables.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
import asm6805  # noqa: E402
import stackdepth  # noqa: E402
import fm900gen  # noqa: E402

MASTER = os.path.join(ROOT, 'fm900', 'MASTERS', 'FM92R.BIN')
SRC = os.path.join(HERE, 'FM92R.asm')


STOCK = {'FORK': 0, 'FREQ': 0, 'INTRO': 0, 'NOHOOK': 0}
# name -> feature flags. FM92R-fork is the "enhanced" firmware.
VARIANTS = {
    'FM92R-intro': {'FORK': 1, 'FREQ': 0, 'INTRO': 1, 'NOHOOK': 1},
    'FM92R-fork': {'FORK': 1, 'FREQ': 1, 'INTRO': 1, 'NOHOOK': 1},
}


def assemble(flags, src=SRC):
    """flags: a dict of -D values, or a bool (False = stock, True = the full fork)."""
    if flags is False:
        flags = STOCK
    elif flags is True:
        flags = VARIANTS['FM92R-fork']
    a = asm6805.Assembler(flags)
    img = a.assemble(src)
    return bytearray(img), a


def ranges(diff):
    out, start, prev = [], None, None
    for x in diff:
        if start is None:
            start = prev = x
        elif x == prev + 1:
            prev = x
        else:
            out.append((start, prev)); start = prev = x
    if start is not None:
        out.append((start, prev))
    return out


def build(out_dir=os.path.join(HERE, 'build'), quiet=False):
    say = (lambda *a: None) if quiet else print
    master = open(MASTER, 'rb').read()
    stock, _ = assemble(False)
    if bytes(stock) != master:
        d = [i for i in range(0x2000) if stock[i] != master[i]]
        raise SystemExit('stock build (FORK=0) differs from FM92R.BIN at %s: a change to original '
                         'code is not inside `.if FORK ... .else ... .endif`' %
                         ', '.join('$%04X-$%04X' % r for r in ranges(d)[:8]))
    say('stock build == fm900/MASTERS/FM92R.BIN')
    st, sm, si = stackdepth.analyse(master)
    os.makedirs(out_dir, exist_ok=True)
    outs = {}
    for name, flags in VARIANTS.items():
        img, a = assemble(flags)
        fm900gen.checksum(img)
        out = os.path.join(out_dir, name + '.BIN')
        open(out, 'wb').write(img)
        with open(os.path.join(out_dir, name + '.lst'), 'w') as f:
            for addr, bs in a.listing:
                f.write('%04X  %s\n' % (addr, bs.hex(' ')))
        with open(os.path.join(out_dir, name + '.sym'), 'w') as f:
            for k, v in sorted(a.syms.items(), key=lambda kv: (kv[1], kv[0])):
                f.write('%04X %s\n' % (v, k))
        f0, f1 = a.free
        ft, fm, fi = stackdepth.analyse(bytes(img))
        if fm[0] > sm[0] or fi[0] > si[0]:
            raise SystemExit('%s uses more stack than the factory master (main %d > %d or '
                             'interrupt %d > %d): see stackdepth.py' % (name, fm[0], sm[0], fi[0], si[0]))
        d = [i for i in range(0x2000) if img[i] != master[i] and i not in (0x1F64, 0x1F65)]
        say('%s (%s): free area %d of %d bytes used, stack %d (factory %d), changed %s' % (
            name, ' '.join('%s=%d' % kv for kv in flags.items() if kv[0] != 'FORK'),
            sum(a.written[f0:f1 + 1]), f1 - f0 + 1, ft, st,
            ', '.join(('$%04X' % s) if s == e else ('$%04X-$%04X' % (s, e)) for s, e in ranges(d))))
        outs[name] = out
    return outs['FM92R-fork']


def main():
    argparse.ArgumentParser(description=__doc__.split('\n\n')[0]).parse_args()
    try:
        build()
    except asm6805.AsmError as e:
        print('error: %s' % e, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

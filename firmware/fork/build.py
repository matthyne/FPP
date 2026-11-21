#!/usr/bin/env python3
"""Build the FM92R fork master.

    python3 build.py            # -> build/FM92R-fork.BIN (+ .lst, .sym)

1. Assembles FM92R.asm with -D FORK=0 and checks it is byte-identical to
   fm900/MASTERS/FM92R.BIN (so everything outside `.if FORK` blocks is still
   the original firmware). Stops if not.
2. Assembles it with -D FORK=1, fixes the EPROM checksum (0x1F64) and firmware
   signature (0x1F65) with fm900gen's checksum(), so the master is
   self-consistent like the factory ones, and writes build/FM92R-fork.BIN.
3. Lists which bytes differ from the factory master.

Use the result like any master:
    ../../fm900gen.py build ch.csv --hw 9248.... --sw ... --master-file build/FM92R-fork.BIN -o radio.bin
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


def assemble(fork, src=SRC):
    a = asm6805.Assembler({'FORK': 1 if fork else 0})
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
    say('stock build (FORK=0) == fm900/MASTERS/FM92R.BIN')
    img, a = assemble(True)
    fm900gen.checksum(img)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, 'FM92R-fork.BIN')
    open(out, 'wb').write(img)
    with open(os.path.join(out_dir, 'FM92R-fork.lst'), 'w') as f:
        for addr, bs in a.listing:
            f.write('%04X  %s\n' % (addr, bs.hex(' ')))
    with open(os.path.join(out_dir, 'FM92R-fork.sym'), 'w') as f:
        for k, v in sorted(a.syms.items(), key=lambda kv: (kv[1], kv[0])):
            f.write('%04X %s\n' % (v, k))
    f0, f1 = a.free
    used = sum(a.written[f0:f1 + 1])
    say('free area $%04X-$%04X: %d of %d bytes used' % (f0, f1, used, f1 - f0 + 1))
    st, sm, si = stackdepth.analyse(master)
    ft, fm, fi = stackdepth.analyse(bytes(img))
    say('stack (static worst case): main %d + 5 + interrupt %d = %d bytes; factory master %d' % (
        fm[0], fi[0], ft, st))
    if fm[0] > sm[0] or fi[0] > si[0]:
        raise SystemExit('the fork uses more stack than the factory master (main %d > %d or '
                         'interrupt %d > %d): see stackdepth.py' % (fm[0], sm[0], fi[0], si[0]))
    d = [i for i in range(0x2000) if img[i] != master[i] and i not in (0x1F64, 0x1F65)]
    if d:
        say('differs from the factory master at: %s' % ', '.join(
            ('$%04X' % s) if s == e else ('$%04X-$%04X' % (s, e)) for s, e in ranges(d)))
    else:
        say('no changes from the factory master yet')
    say('wrote %s' % out)
    return out


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

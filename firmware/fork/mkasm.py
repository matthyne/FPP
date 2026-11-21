#!/usr/bin/env python3
"""Generate the fork's starting source (FM92R.asm) from the FM92R master.

One-off: FM92R.asm is the checked-in, hand-edited source from then on. Re-running
this would overwrite your changes, so it refuses to if the output exists
(use --force, or -o somewhere else to diff against).

    python3 mkasm.py [-o FM92R.asm] [--force]

Stdlib only. Uses the same code walk as ../tools/d6805.py (recursive descent
from the vectors, following JMP/JSR table,X jump tables of $CC/$CD entries),
decoded with op6805.py, and names/comments from ../FM92R.ann. Every label is
pinned to its master address with `.at`, so the source can only be changed
in ways that keep the original routines where they are.
"""
import argparse, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FW = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from op6805 import DEC, SIZE, ENDS  # noqa: E402

CODE_END = 0x15AF            # first byte after the original code (FIRMWARE.md §13)
FREE_END = 0x1B3F            # last free byte before the data area
SIG = (0x01CC, 0x05CC, 0x09CC, 0x0DCC, 0x11CC, 0x15CC, 0x19CC, 0x1ACC)


def decode(img, a):
    op = img[a]
    if op not in DEC:
        return None
    m, mode = DEC[op]
    n = SIZE[mode]
    return m, mode, bytes(img[a:a + n])


def targets(a, ins):
    m, mode, b = ins
    if mode == 'rel':
        return [(a + 2 + ((b[1] ^ 0x80) - 0x80)) & 0xFFFF]
    if mode == 'btb':
        return [(a + 3 + ((b[2] ^ 0x80) - 0x80)) & 0xFFFF]
    if m in ('jmp', 'jsr') and mode == 'ext':
        return [b[1] << 8 | b[2]]
    if m in ('jmp', 'jsr') and mode == 'dir':
        return [b[1]]
    return []


def walk(img, entries):
    ents = set(entries)
    jts = {}
    while True:
        code, labels, calls = {}, set(ents), set(ents)
        q = sorted(ents)
        while q:
            a = q.pop()
            while 0 <= a < 0x2000 and a not in code:
                ins = decode(img, a)
                if ins is None:
                    break
                code[a] = ins
                for t in targets(a, ins):
                    if t >= 0x100:
                        labels.add(t)
                        if ins[0] in ('jsr', 'bsr'):
                            calls.add(t)
                        q.append(t)
                if ins[0] in ENDS:
                    break
                a += SIZE[ins[1]]
        new = False
        for a, (m, mode, b) in list(code.items()):
            if m in ('jmp', 'jsr') and mode in ('ix1', 'ix2'):
                base = b[1] if mode == 'ix1' else b[1] << 8 | b[2]
                if base == 0:
                    continue
                k, lst = base, []
                while k < 0x2000 and img[k] in (0xCC, 0xCD):
                    lst.append(img[k + 1] << 8 | img[k + 2])
                    if k not in ents:
                        ents.add(k); new = True
                    k += 3
                if img[k] == 0x81 and k not in ents:
                    ents.add(k); new = True
                jts[base] = (a, lst)
        if not new:
            return code, labels, calls, jts


def load_ann(path):
    syms, cm = {}, {}
    if os.path.exists(path):
        for l in open(path):
            l = l.rstrip('\n')
            if not l.strip() or l.startswith('#'):
                continue
            k, _, v = l.partition(' ')
            if k.startswith('='):
                syms[int(k[1:], 16)] = v.strip()
            else:
                cm[int(k, 16)] = v.strip()
    return syms, cm


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--master', default=os.path.join(os.path.dirname(FW), 'fm900', 'MASTERS', 'FM92R.BIN'))
    ap.add_argument('--ann', default=os.path.join(FW, 'FM92R.ann'))
    ap.add_argument('-o', '--output', default=os.path.join(HERE, 'FM92R.asm'))
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    if os.path.exists(args.output) and not args.force:
        sys.exit('%s exists (it is the hand-edited fork source); use --force or another -o' % args.output)

    img = open(args.master, 'rb').read()
    assert len(img) == 0x2000
    syms, cm = load_ann(args.ann)
    vec = [struct.unpack('>H', img[i:i + 2])[0] for i in range(0x1FF0, 0x2000, 2)]
    code, labels, calls, jts = walk(img, [v for v in set(vec) if v])
    labels |= {b for b, (_, lst) in jts.items() if lst}   # jump-table bases get a label too
    bad = [x for x in code if not 0x100 <= x < CODE_END]
    if bad:
        sys.exit('code outside $0100-$%04X: %s' % (CODE_END - 1, ' '.join('%04x' % x for x in bad)))

    def lab(t):
        if t in syms: return syms[t]
        if t in calls: return 'sub_%04x' % t
        if t in jts and jts[t][1]: return 'jt_%04x' % t
        return 'L_%04x' % t

    used = set()
    out = []
    w = out.append
    w('; FM92R firmware fork: editable source.')
    w(';')
    w('; Generated once from fm900/MASTERS/FM92R.BIN by mkasm.py, then edited by hand.')
    w('; Unmodified, it assembles byte-identical to the master (test_fork.py checks this).')
    w(';')
    w('; Rules (see README.md in this folder):')
    w(';  * Every original label is pinned with `.at` to its master address. Never')
    w(';    insert or delete bytes in the original code: hook new code in by')
    w(';    overwriting an instruction with JSR/JMP (+ NOPs to keep the size).')
    w(';  * New code goes in the free area at the end ($%04X-$%04X).' % (CODE_END, FREE_END))
    w(';  * $0000-$00FF (hidden behind on-chip RAM) and $1B40-$1FFF (channel table,')
    w(';    configuration, master ID, vectors) are kept verbatim. fm900gen overwrites')
    w(';    the configuration when it builds a radio image.')
    w(';  * BSET n = $10+2n, BCLR n = $11+2n (Motorola manual).')
    w('')
    w('        .free   $%04X, $%04X' % (CODE_END, FREE_END))
    w('')

    def data(a0, a1, every=16):
        a = a0
        while a < a1:
            n = min(every, a1 - a)
            chunk = img[a:a + n]
            c = cm.get(a, '')
            w('        db      %s%s' % (', '.join('$%02x' % x for x in chunk), ('   ; ' + c) if c else ''))
            a += n

    # ---- page 0: copyright + balancing byte
    w('; ---- $0000-$00FF: hidden behind on-chip I/O and RAM. Do not edit: the $AC at')
    w('; $0023 makes these bytes sum to 0, so the firmware checksum (0x0100-0x1FFF) and')
    w("; fm900gen's whole-image checksum agree.")
    w('        .org    $0000')
    data(0x0000, 0x0024)
    w('')

    # ---- original code
    w('; ---- $0100-$%04X: original FM92R code (pinned)' % (CODE_END - 1))
    w('        .org    $0100')
    a = 0x0100
    while a < CODE_END:
        if a in code:
            m, mode, b = code[a]
            if a in labels:
                w('')
                w('%s:%s.at $%04x' % (lab(a), ' ' * max(1, 32 - len(lab(a))), a))
                used.add(a)
            t = targets(a, code[a])
            if mode == 'inh':
                op = ''
            elif mode == 'imm':
                op = '#$%02x' % b[1]
            elif mode == 'dir':
                op = lab(b[1]) if m in ('jmp', 'jsr') and b[1] in labels else '$%02x' % b[1]
            elif mode == 'ext':
                v = b[1] << 8 | b[2]
                if v in labels and v >= 0x100:
                    op = lab(v)
                elif v < 0x100:
                    op = '>$%02x' % v
                else:
                    op = '$%04x' % v
            elif mode == 'ix':
                op = ',x'
            elif mode == 'ix1':
                op = '$%02x,x' % b[1]
            elif mode == 'ix2':
                v = b[1] << 8 | b[2]
                if v in labels and v >= 0x100:
                    op = '%s,x' % lab(v)
                else:
                    op = ('>$%02x,x' % v) if v < 0x100 else '$%04x,x' % v
            elif mode == 'rel':
                op = lab(t[0])
            elif mode == 'bsc':
                op = '%d,$%02x' % (int(m[-1]), b[1])
            elif mode == 'btb':
                op = '%d,$%02x,%s' % (int(m[-1]), b[1], lab(t[0]))
            mn = m[:-1] if mode in ('bsc', 'btb') else m
            c = cm.get(a, '')
            if a in SIG:
                c = ('signature sample byte $%04X; ' % a) + c
            line = '        %-7s %s' % (mn, op)
            w(('%-48s; %s' % (line, c)) if c else line)
            a += SIZE[mode]
        else:
            b0 = a
            while a < CODE_END and a not in code:
                a += 1
            if b0 in labels:
                w('')
                w('%s:%s.at $%04x' % (lab(b0), ' ' * max(1, 32 - len(lab(b0))), b0))
                used.add(b0)
            else:
                w('        .at     $%04x' % b0)
            data(b0, a)
            if a < CODE_END:
                w('        .at     $%04x' % a)
    w('')
    w('        .at     $%04x' % CODE_END)
    w('; ---- $%04X-$%04X: free area. New code goes here (or in fork.asm, included here).' % (CODE_END, FREE_END))
    w('        .include "fork.asm"')
    w('')

    # ---- data area, verbatim
    w('; ---- $1B40-$1FEF: channel table (99 x 8 at $1BE8) and configuration block,')
    w('; master defaults. fm900gen rewrites most of it (FM900_FORMAT.md §4).')
    w('        .org    $1B40')
    data(0x1B40, 0x1FF0)
    w('')
    w('; ---- vectors')
    w('        .org    $1FF0')
    for i, v in enumerate(vec):
        nm = lab(v) if v in labels else '$%04x' % v
        w('        dw      %s' % nm)
    missing = [x for x in labels if x not in used and 0x100 <= x < CODE_END]
    if missing:
        sys.exit('labels not emitted: %s' % ' '.join('%04x' % x for x in sorted(missing)))
    open(args.output, 'w').write('\n'.join(out) + '\n')
    print('wrote %s (%d instructions, %d labels)' % (args.output, len(code), len(used)))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Worst-case static stack depth of an FM92R(-fork) image.

    python3 stackdepth.py [image]       (default build/FM92R-fork.BIN)

The 6805 stack starts at $7F (RSP) and grows down. FM92R RAM is used up to
$68 (the RAM-config copy checked by supervision_task), so 23 bytes ($69-$7F)
are available. JSR/BSR push 2 bytes; an interrupt pushes 5 (PC, X, A, CC).
Interrupts don't nest (the I bit is set on entry and no ISR clears it), so
worst case = deepest main-line call chain + 5 + deepest ISR call chain.

The bound is pessimistic: it includes paths that never return (e.g. into a
reset). The factory FM92R master scores 27 on it, more than the 23 bytes
available, so the absolute number isn't a pass/fail test. What build.py checks
is that the fork is no deeper than the factory master, on the main line and in
the interrupts.

Calls through JSR table,X follow the table's JMP/JSR entries. JMP table,X
dispatches stay at the same depth. This is a static bound over every path
the code walk finds, so it can only over-estimate.
"""
import os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mkasm import decode, targets  # noqa: E402
from op6805 import SIZE, ENDS  # noqa: E402

STACK_BYTES = 0x7F - 0x68       # $69-$7F


def table(img, base):
    out, k = [], base
    while k < 0x2000 and img[k] in (0xCC, 0xCD):
        out.append(k)           # the entry itself is code (a JMP/JSR)
        k += 3
    return out


def body(img, entry, reset=0x100):
    """Instructions reachable from entry without following calls.
    A jump to RESET is not followed (RESET reloads SP with RSP).
    Returns (set of addresses, list of (call site, callee))."""
    seen, calls, q = set(), [], [entry]
    while q:
        a = q.pop()
        while 0x100 <= a < 0x2000 and a not in seen:
            ins = decode(img, a)
            if ins is None:
                break
            seen.add(a)
            m, mode, b = ins
            ts = [t for t in targets(a, ins) if t >= 0x100]
            if m in ('jsr', 'bsr'):
                calls += [(a, t) for t in ts]
                if mode in ('ix1', 'ix2'):
                    base = b[1] if mode == 'ix1' else b[1] << 8 | b[2]
                    calls += [(a, e) for e in table(img, base)]
            else:
                q += [t for t in ts if t != reset or a == entry]
                if m == 'jmp' and mode in ('ix1', 'ix2'):
                    base = b[1] if mode == 'ix1' else b[1] << 8 | b[2]
                    q += table(img, base)
            if m in ENDS:
                break
            a += SIZE[mode]
    return seen, calls


def analyse(img):
    memo, stack = {}, []

    def depth(f):
        """Max bytes pushed by calls made while running f (not counting f's own return address)."""
        if f in memo:
            return memo[f]
        if f in stack:
            raise ValueError('recursion: %s' % ' -> '.join('%04x' % x for x in stack + [f]))
        stack.append(f)
        best, path = 0, []
        for site, t in body(img, f)[1]:
            d, p = depth(t)
            if 2 + d > best:
                best, path = 2 + d, [t] + p
        stack.pop()
        memo[f] = (best, path)
        return memo[f]

    vec = [struct.unpack('>H', img[i:i + 2])[0] for i in range(0x1FF0, 0x2000, 2)]
    reset = vec[7]
    isrs = sorted({v for v in vec[:7] if v and v != reset})   # SWI = RESET here
    main = depth(reset)
    isr = max((depth(v) + (v,) for v in isrs), key=lambda x: x[0])
    total = main[0] + 5 + isr[0]
    return total, main, isr


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'build', 'FM92R-fork.BIN')
    img = open(path, 'rb').read()
    total, main_, isr = analyse(img)
    print('main line: %d bytes via %s' % (main_[0], ' > '.join('%04x' % x for x in main_[1])))
    print('interrupt: 5 + %d bytes (%04x) via %s' % (isr[0], isr[2], ' > '.join('%04x' % x for x in isr[1])))
    print('worst case %d bytes (static bound; $69-$7F = %d)' % (total, STACK_BYTES))
    return 0


if __name__ == '__main__':
    sys.exit(main())

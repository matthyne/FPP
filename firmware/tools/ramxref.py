"""RAM / I/O cross-reference for a master: who reads and writes each address $00-$FF.

Usage: python3 tools/ramxref.py FM92R [--md]     (needs capstone 5.0.x, like mklist.py)

For every direct-page address it lists the routines that read it (R), write it (W) or
read-modify-write it (M), and which bits are tested/set/cleared with BRSET/BRCLR/BSET/BCLR.
Indexed accesses (`lda $d5,x`) are reported against their base address with an `x` mark.
Routine = nearest preceding named routine (from <name>.ann) or called label.
--md prints a Markdown table (one row per address) for pasting into FIRMWARE.md.
"""
import sys, os, re, struct, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
FWDIR = os.path.dirname(HERE)
MASTERS = os.path.join(os.path.dirname(FWDIR), 'fm900', 'MASTERS')
from d6805 import load, walk2

READ = {'lda', 'ldx', 'cmp', 'cpx', 'bit', 'add', 'adc', 'sub', 'sbc', 'and', 'ora', 'eor', 'tst', 'jmp', 'jsr'}
WRITE = {'sta', 'stx', 'clr'}
RMW = {'inc', 'dec', 'neg', 'com', 'lsl', 'lsla', 'lsr', 'asr', 'rol', 'ror', 'asl'}

def read_ann(n):
    sy = {}
    p = os.path.join(FWDIR, n + '.ann')
    for l in open(p):
        l = l.rstrip('\n')
        if l.startswith('='):
            k, _, v = l.partition(' '); sy[int(k[1:], 16)] = v.strip()
    return sy

def operand(i):
    """Return (address, indexed) for a direct/indexed RAM operand, else None."""
    ops = i.op_str
    m = re.match(r'^\$([0-9a-f]{2})$', ops)                     # direct
    if m: return int(m.group(1), 16), False
    m = re.match(r'^(\d+), x$', ops)                             # 8-bit offset,X (decimal)
    if m and int(m.group(1)) < 0x100: return int(m.group(1)), True
    m = re.match(r'^\$([0-9a-f]{2}), x$', ops)
    if m: return int(m.group(1), 16), True
    m = re.match(r'^(\d), \$([0-9a-f]{2})', ops)                 # bit ops: n, $aa[, target]
    if m: return int(m.group(2), 16), False
    return None

def xref(name):
    img = load(os.path.join(MASTERS, name + '.BIN'))
    vec = [struct.unpack('>H', img[i:i + 2])[0] for i in range(0x1ff4, 0x2000, 2)]
    code, labels, calls, jts = walk2(img, [v for v in set(vec) if v])
    sy = read_ann(name)
    starts = sorted(set(a for a in sy if 0x100 <= a < 0x1b00) | set(calls))
    import bisect
    def owner(a):
        k = bisect.bisect_right(starts, a) - 1
        s = starts[k] if k >= 0 else None
        return sy.get(s, 'sub_%04x' % s if s is not None else '?')
    acc = collections.defaultdict(lambda: collections.defaultdict(set))   # addr -> owner -> marks
    for a, i in sorted(code.items()):
        o = operand(i)
        if not o: continue
        addr, idx = o; m = i.mnemonic
        if m.startswith(('brset', 'brclr')): mark = 'b%s?' % i.op_str[0]
        elif m in ('bset', 'bclr'): mark = 'b%s%s' % (i.op_str[0], '=1' if m == 'bset' else '=0')
        elif m in WRITE: mark = 'W'
        elif m in RMW: mark = 'M'
        elif m in READ: mark = 'R'
        else: mark = m
        if idx: mark += 'x'
        acc[addr][owner(a)].add(mark)
    return acc, sy

def main():
    name = sys.argv[1]; md = '--md' in sys.argv
    acc, sy = xref(name)
    if md:
        print('| Addr | Name | Accesses (routine: marks) |'); print('|---|---|---|')
    for addr in sorted(acc):
        parts = []
        for o in sorted(acc[addr]):
            parts.append('%s: %s' % (o, ' '.join(sorted(acc[addr][o]))))
        nm = sy.get(addr, '')
        if md: print('| `$%02X` | %s | %s |' % (addr, nm, '; '.join(parts)))
        else: print('$%02x %-14s %s' % (addr, nm, ' | '.join(parts)))

if __name__ == '__main__':
    main()

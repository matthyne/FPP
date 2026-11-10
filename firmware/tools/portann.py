"""Port a master's .ann (routine names + comments) to another master by aligning code.

Usage: python3 tools/portann.py SRC DST      e.g.  python3 tools/portann.py FM92R FM92RS
Writes firmware/DST.ann and prints a report: what was mapped, what was dropped, and the
DST code that has no counterpart in SRC (new routines to name by hand).

How addresses are mapped
* $0000-$00FF (I/O, on-chip RAM) and $0100+ data outside the code area
  ($1B00-$1FFF: channel table, configuration block, vectors) are mapped 1:1, but only
  when the byte at that address is the same in both images or the address is RAM/I/O.
* Code is aligned on normalised instructions (mnemonic + operands, with absolute and
  branch targets inside $0100-$1AFF replaced by a placeholder), so code that only moved
  still lines up. Equal runs map instruction by instruction.
* Any other address in $0100-$1AFF (a db line, a jump table) is mapped only if it lies
  inside a run of at least 8 identical bytes in both images (byte-level alignment).
* A ported routine name or code comment is kept only if the first 3 instructions at the
  destination normalise to the same text as at the source.
Existing DST entries in an extra hand-written file DST.ann.local (same format) are
appended unchanged and win over ported ones.
"""
import sys, os, re, difflib, struct, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
FWDIR = os.path.dirname(HERE)
MASTERS = os.path.join(os.path.dirname(FWDIR), 'fm900', 'MASTERS')
from d6805 import load, walk2, dis1

CODE_LO, CODE_HI = 0x0100, 0x1B00

def read_ann(path):
    """Return the file as a list of (kind, addr, text, raw): kind is '=', 'c' or None."""
    out = []
    for raw in open(path):
        l = raw.rstrip('\n')
        if not l.strip() or l.startswith('#'):
            out.append((None, None, None, l)); continue
        k, _, v = l.partition(' ')
        if k.startswith('='): out.append(('=', int(k[1:], 16), v.strip(), l))
        else: out.append(('c', int(k, 16), v.strip(), l))
    return out

def norm(i):
    ops = re.sub(r'\$([0-9a-f]{3,4})\b',
                 lambda m: '@' if CODE_LO <= int(m.group(1), 16) < CODE_HI else m.group(0), i.op_str)
    return i.mnemonic + ' ' + ops

def disasm(img):
    vec = [struct.unpack('>H', img[i:i + 2])[0] for i in range(0x1ff4, 0x2000, 2)]
    code, labels, calls, jts = walk2(img, [v for v in set(vec) if v])
    return code, jts

def build_map(a, b):
    ca, _ = disasm(a); cb, _ = disasm(b)
    la = sorted(ca); lb = sorted(cb)
    ta = [norm(ca[x]) for x in la]; tb = [norm(cb[x]) for x in lb]
    imap = {}
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1): imap[la[i1 + k]] = lb[j1 + k]
    # byte-level runs for data inside the code area
    bmap = {}
    bs = difflib.SequenceMatcher(None, a[CODE_LO:CODE_HI], b[CODE_LO:CODE_HI], autojunk=False)
    for m in bs.get_matching_blocks():
        if m.size >= 8:
            for k in range(m.size): bmap[CODE_LO + m.a + k] = CODE_LO + m.b + k
    matched_b = set(imap.values())
    new_b = [x for x in lb if x not in matched_b]
    return ca, cb, imap, bmap, new_b

def head(code, addr, n=3):
    out = []; x = addr
    for _ in range(n):
        i = code.get(x)
        if i is None: break
        out.append(norm(i)); x += i.size
    return out

def map_addr(x, a, b, imap, bmap):
    if x < 0x100: return x, 'ram'
    if x >= CODE_HI: return (x, 'same') if a[x] == b[x] else (None, 'tail byte differs')
    if x in imap: return imap[x], 'code'
    if x in bmap: return bmap[x], 'data'
    return None, 'no counterpart'

def ranges(addrs, code):
    """Group consecutive instructions into (start, end) ranges."""
    out = []
    for x in addrs:
        e = x + code[x].size
        if out and out[-1][1] == x: out[-1][1] = e
        else: out.append([x, e])
    return out

def main(src, dst):
    a = load(os.path.join(MASTERS, src + '.BIN')); b = load(os.path.join(MASTERS, dst + '.BIN'))
    ca, cb, imap, bmap, new_b = build_map(a, b)
    ann = read_ann(os.path.join(FWDIR, src + '.ann'))
    out = ['# %s annotations ported from %s.ann by tools/portann.py; do not edit by hand.' % (dst, src),
           '# Hand-written %s entries go in %s.ann.local, which is appended below.' % (dst, dst)]
    rep = collections.Counter(); dropped = []
    for kind, x, text, raw in ann:
        if kind is None:
            if raw.startswith('#') and 'ported' not in raw: out.append(raw)
            elif not raw.strip(): out.append(raw)
            continue
        y, how = map_addr(x, a, b, imap, bmap)
        if y is not None and CODE_LO <= x < CODE_HI and x in ca:
            if head(ca, x) != head(cb, y):
                y, how = None, ('routine start differs' if kind == '=' else 'code at comment differs')
        if y is None:
            dropped.append((kind, x, text, how)); rep['dropped'] += 1; continue
        rep[how] += 1
        out.append(('=%04x %s' if kind == '=' else '%04x %s') % (y, text))
    local = os.path.join(FWDIR, dst + '.ann.local')
    if os.path.exists(local):
        out.append('# ---- %s.ann.local ----' % dst)
        out += [l.rstrip('\n') for l in open(local)]
    open(os.path.join(FWDIR, dst + '.ann'), 'w').write('\n'.join(out).rstrip('\n') + '\n')
    print('mapped: %s' % dict((k, v) for k, v in rep.items() if k != 'dropped'))
    print('dropped: %d' % rep['dropped'])
    for kind, x, text, how in dropped:
        print('  %s %04x %-40s (%s)' % ('name' if kind == '=' else 'note', x, text[:40], how))
    print('%s code with no %s counterpart:' % (dst, src))
    for s, e in ranges(new_b, cb):
        print('  %04x-%04x  %d bytes' % (s, e - 1, e - s))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

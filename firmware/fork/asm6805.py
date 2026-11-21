#!/usr/bin/env python3
"""Small two-pass MC146805E2 (6805) assembler for the FM92R firmware fork.

Python 3, stdlib only. Always produces one 8 KB image ($0000-$1FFF); bytes
not written by the source are $00 (as in the masters' empty area).

    python3 asm6805.py FM92R.asm -o build/FM92R-fork.BIN [-l build/FM92R-fork.lst]

Syntax (case-insensitive mnemonics, one statement per line, ';' comments):

    label:  mnemonic operand     ; comment
    name    equ  expr            ; also  name = expr
            .org  expr           ; move PC forward (never backwards: overlap is an error)
            .at   expr           ; assert PC == expr  (pins original code in place)
            db    expr, "text", ...
            dw    expr, ...      ; big-endian
            .avoid expr[, expr]  ; error if any later byte is emitted at these addresses
            .free expr, expr     ; declare [start, end] as the free area (report only)
            .if expr / .else / .endif   ; conditional assembly (nestable)
            .include "file"      ; relative to the including file
            .error "text"        ; stop with this message (e.g. inside an .if)

Symbols can be predefined on the command line with -D NAME=value (default 1).

Operands:
    #expr          immediate
    ,x             indexed, no offset
    expr,x         indexed, 8- or 16-bit offset (chosen by value)
    expr           direct or extended (chosen by value)
    <expr / >expr  force the 8-bit (direct / ix1) or 16-bit (extended / ix2) form
    n,expr         bset / bclr
    n,expr,target  brset / brclr
Expressions: numbers ($hex, %bin, decimal, 'c'), symbols, '*' (= PC of this
statement), + - * / & | ^ << >> ~ ( ), and lo(e) / hi(e).

A forward reference that turns out to be < $100 is an error unless forced
with < or >, so instruction sizes never change between passes.
"""
import argparse, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op6805 import ENC, SIZE, ALIAS  # noqa: E402


class AsmError(Exception):
    pass


# ---------------------------------------------------------------- expressions
TOK = re.compile(r"\s*(?:(\$[0-9a-fA-F]+)|(%[01]+)|(\d+)|('(?:[^'\\]|\\.)')|"
                 r"([A-Za-z_.][A-Za-z0-9_.]*)|(<<|>>|[-+*/&|^~()]))")


def _tokens(s):
    out, pos = [], 0
    s = s.strip()
    while pos < len(s):
        m = TOK.match(s, pos)
        if not m or m.end() == pos:
            raise AsmError('bad expression: %r' % s)
        pos = m.end()
        h, b, d, c, name, op = m.groups()
        if h: out.append(('n', int(h[1:], 16)))
        elif b: out.append(('n', int(b[1:], 2)))
        elif d: out.append(('n', int(d)))
        elif c: out.append(('n', ord(c[1:-1].encode().decode('unicode_escape'))))
        elif name: out.append(('s', name))
        else: out.append(('o', op))
    return out


class Expr:
    """Recursive-descent evaluator. Unknown symbols raise KeyError (pass 1)."""

    def __init__(self, syms, pc):
        self.syms, self.pc = syms, pc

    def eval(self, s):
        self.t, self.i = _tokens(s), 0
        if not self.t:
            raise AsmError('empty expression')
        v = self.binop(0)
        if self.i != len(self.t):
            raise AsmError('bad expression: %r' % s)
        return v

    PREC = [('|',), ('^',), ('&',), ('<<', '>>'), ('+', '-'), ('*', '/')]

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def binop(self, lvl):
        if lvl == len(self.PREC):
            return self.unary()
        v = self.binop(lvl + 1)
        while self.peek()[0] == 'o' and self.peek()[1] in self.PREC[lvl]:
            op = self.t[self.i][1]; self.i += 1
            r = self.binop(lvl + 1)
            v = {'|': v | r, '^': v ^ r, '&': v & r, '<<': v << r, '>>': v >> r,
                 '+': v + r, '-': v - r, '*': v * r, '/': v // r if r else 0}[op]
        return v

    def unary(self):
        k, v = self.peek()
        if k == 'o' and v in ('-', '~', '+'):
            self.i += 1
            x = self.unary()
            return -x if v == '-' else ~x if v == '~' else x
        if k == 'o' and v == '(':
            self.i += 1
            x = self.binop(0)
            self.expect(')')
            return x
        if k == 'n':
            self.i += 1
            return v
        if k == 'o' and v == '*':
            self.i += 1
            return self.pc
        if k == 's':
            self.i += 1
            if v.lower() in ('lo', 'hi') and self.peek() == ('o', '('):
                self.i += 1
                x = self.binop(0)
                self.expect(')')
                return x & 0xFF if v.lower() == 'lo' else (x >> 8) & 0xFF
            if v not in self.syms:
                raise KeyError(v)
            return self.syms[v]
        raise AsmError('bad expression')

    def expect(self, o):
        if self.peek() != ('o', o):
            raise AsmError('expected %r' % o)
        self.i += 1


# ---------------------------------------------------------------- line parser
LINE = re.compile(r'^(?:([A-Za-z_.][A-Za-z0-9_.]*):)?\s*(.*)$')


def strip_comment(s):
    out, q = [], None
    for ch in s:
        if q:
            out.append(ch)
            if ch == q: q = None
        elif ch in '"\'':
            q = ch; out.append(ch)
        elif ch == ';':
            break
        else:
            out.append(ch)
    return ''.join(out).rstrip()


def split_args(s):
    out, cur, q = [], '', None
    for ch in s:
        if q:
            cur += ch
            if ch == q: q = None
        elif ch in '"\'':
            q = ch; cur += ch
        elif ch == ',':
            out.append(cur.strip()); cur = ''
        else:
            cur += ch
    if cur.strip() or out:
        out.append(cur.strip())
    return out


class Assembler:
    def __init__(self, defines=None):
        self.defines = dict(defines or {})
        self.syms = {}

    def assemble(self, path):
        self.src = []
        self.syms = dict(self.defines)
        self._read(path)
        self.pass_(1)
        return self.pass_(2)

    def _read(self, path, depth=0):
        for n, l in enumerate(open(path, encoding='utf-8'), 1):
            m = re.match(r'\s*\.include\s+"([^"]+)"', l)
            if m:
                if depth > 8: raise AsmError('include nesting too deep')
                self._read(os.path.join(os.path.dirname(path), m.group(1)), depth + 1)
            else:
                self.src.append((path, n, l.rstrip('\n')))

    def pass_(self, p):
        self.p = p
        self.img = bytearray(0x2000)
        self.written = bytearray(0x2000)
        self.avoid = set()
        self.free = None
        if p == 1:
            self.unknown_p1 = set()      # lines with a forward reference in pass 1
        self.pc = 0
        self.listing = []
        self.cond = []              # stack of [active, taken]
        for path, n, raw in self.src:
            self.where = '%s:%d' % (os.path.basename(path), n)
            try:
                self.line(raw)
            except AsmError as e:
                raise AsmError('%s: %s\n    %s' % (self.where, e, raw.strip()))
        if self.cond:
            raise AsmError('missing .endif')
        return self.img

    def ev(self, s):
        try:
            return Expr(self.syms, self.pc).eval(s)
        except KeyError as k:
            if self.p == 2:
                raise AsmError('undefined symbol %s' % k)
            self.unknown_p1.add(self.where)
            return None

    def define(self, name, val):
        if self.p == 1:
            if name in self.syms:
                raise AsmError('duplicate symbol %s' % name)
            self.syms[name] = val
        elif self.syms.get(name) != val:
            raise AsmError('symbol %s changed between passes (%r -> %r)' % (
                name, self.syms.get(name), val))

    def emit(self, bs, start=None):
        a0 = self.pc
        for b in bs:
            if self.pc > 0x1FFF:
                raise AsmError('past end of 8 KB image')
            if self.p == 2:
                if self.written[self.pc]:
                    raise AsmError('overlaps earlier code/data at $%04X' % self.pc)
                if self.pc in self.avoid:
                    raise AsmError('emits a byte at reserved address $%04X' % self.pc)
                self.img[self.pc] = b & 0xFF
                self.written[self.pc] = 1
            self.pc += 1
        if self.p == 2:
            self.listing.append((a0, bytes(b & 0xFF for b in bs)))

    def active(self):
        return all(c[0] for c in self.cond)

    def line(self, raw):
        t = strip_comment(raw).strip()
        w = t.split(None, 1)
        d = w[0].lower() if w else ''
        if d == '.if':
            on = self.active()
            v = self.ev(w[1] if len(w) > 1 else '') if on else 0
            if on and v is None:
                raise AsmError('.if uses an undefined or forward symbol (define it first, or pass -D NAME=value)')
            self.cond.append([on and bool(v), on and bool(v)])
            return
        if d in ('.else', '.endif'):
            if not self.cond:
                raise AsmError('%s without .if' % d)
            if d == '.endif':
                self.cond.pop()
            else:
                c = self.cond[-1]
                outer = all(x[0] for x in self.cond[:-1])
                c[0] = outer and not c[1]
                c[1] = True
            return
        if not self.active():
            return
        if d == '.error':
            raise AsmError(w[1].strip('"') if len(w) > 1 else '.error')
        m = LINE.match(strip_comment(raw))
        label, rest = m.group(1), m.group(2).strip()
        # "name equ expr" / "name = expr"
        mm = re.match(r'^([A-Za-z_.][A-Za-z0-9_.]*)\s*(?:\s[eE][qQ][uU]\s|=)\s*(.+)$', rest) if not label else None
        if mm:
            v = self.ev(mm.group(2))
            if v is None:
                raise AsmError('equ must not use forward references')
            self.define(mm.group(1), v)
            return
        if label:
            self.define(label, self.pc)
        if not rest:
            return
        parts = rest.split(None, 1)
        mn = parts[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ''
        if mn.startswith('.') or mn in ('db', 'dw', 'fcb', 'fdb', 'fcc'):
            return self.directive(mn, arg)
        self.insn(mn, arg)

    def directive(self, d, arg):
        if d == '.org':
            v = self.ev(arg)
            if v is None or v < self.pc:
                raise AsmError('.org $%04X would move PC backwards from $%04X' % (v or 0, self.pc))
            self.pc = v
        elif d == '.at':
            v = self.ev(arg)
            if v != self.pc:
                raise AsmError('.at $%04X but PC is $%04X: code before this point changed size '
                               '(original routines must stay at their master addresses)' % (v, self.pc))
        elif d in ('db', 'fcb', 'fcc'):
            out = []
            for a in split_args(arg):
                if a.startswith('"'):
                    out += list(a[1:-1].encode('latin-1').decode('unicode_escape').encode('latin-1'))
                else:
                    v = self.ev(a)
                    if v is not None and not -128 <= v <= 255:
                        raise AsmError('byte out of range: %s' % a)
                    out.append(v or 0)
            self.emit(out)
        elif d in ('dw', 'fdb'):
            out = []
            for a in split_args(arg):
                v = self.ev(a) or 0
                out += [(v >> 8) & 0xFF, v & 0xFF]
            self.emit(out)
        elif d == '.avoid':
            for a in split_args(arg):
                self.avoid.add(self.ev(a))
        elif d == '.free':
            a, b = [self.ev(x) for x in split_args(arg)]
            self.free = (a, b)
        else:
            raise AsmError('unknown directive %s' % d)

    # -- instructions
    def operand(self, s):
        """Return (kind, value, force) for a non-bit operand."""
        s = s.strip()
        force = None
        if s.startswith('#'):
            return 'imm', self.ev(s[1:]), None
        if re.fullmatch(r',\s*[xX]', s):
            return 'ix', 0, None
        mx = re.fullmatch(r'(.+?),\s*[xX]', s)
        if s[:1] in '<>':
            force, s = s[0], s[1:].strip()
            mx = re.fullmatch(r'(.+?),\s*[xX]', s)
        if mx:
            return 'idx', self.ev(mx.group(1)), force
        return 'mem', self.ev(s), force

    def short(self, v, force):
        if force == '<': return True
        if force == '>': return False
        if v is None or self.where in self.unknown_p1:
            return False             # forward ref: 16-bit, as pass 1 assumed
        return 0 <= v <= 0xFF

    def insn(self, mn, arg):
        mn = ALIAS.get(mn, mn)
        if mn in ('bset', 'bclr', 'brset', 'brclr'):
            a = split_args(arg)
            if len(a) != (3 if mn.startswith('br') else 2):
                raise AsmError('%s needs n,addr%s' % (mn, ',target' if mn.startswith('br') else ''))
            n = self.ev(a[0])
            if n is None or not 0 <= n <= 7:
                raise AsmError('bit number must be 0-7')
            addr = self.ev(a[1].lstrip('<'))
            self.chk_dir(addr, a[1])
            if mn.startswith('br'):
                op = ENC[(mn + str(n), 'btb')]
                t = self.ev(a[2])
                self.emit([op, addr or 0, self.rel(t, 3)])
            else:
                self.emit([ENC[(mn + str(n), 'bsc')], addr or 0])
            return
        if (mn, 'rel') in ENC:
            t = self.ev(arg)
            self.emit([ENC[(mn, 'rel')], self.rel(t, 2)])
            return
        if (mn, 'inh') in ENC and not arg:
            self.emit([ENC[(mn, 'inh')]])
            return
        if not any(k[0] == mn for k in ENC):
            raise AsmError('unknown mnemonic %s' % mn)
        kind, v, force = self.operand(arg)
        if kind == 'imm':
            mode = 'imm'
        elif kind == 'ix':
            mode = 'ix'
        elif kind == 'idx':
            mode = 'ix1' if self.short(v, force) and (mn, 'ix1') in ENC else 'ix2'
        else:
            mode = 'dir' if self.short(v, force) and (mn, 'dir') in ENC else 'ext'
        if (mn, mode) not in ENC:
            raise AsmError('%s has no %s addressing mode' % (mn, mode))
        if self.p == 2 and force is None and mode in ('ext', 'ix2') and v is not None and v <= 0xFF \
                and (mn, {'ext': 'dir', 'ix2': 'ix1'}[mode]) in ENC and self.where in self.unknown_p1:
            raise AsmError('forward reference resolved to $%02X: write <%s or >%s' % (v, arg, arg))
        v = v or 0
        if mode == 'imm' and not -128 <= v <= 255:
            raise AsmError('immediate out of range')
        if mode in ('dir', 'ix1') and not 0 <= v <= 0xFF:
            raise AsmError('8-bit operand out of range: $%X' % v)
        if mode in ('ext', 'ix2') and not 0 <= v <= 0x1FFF:
            raise AsmError('address out of range: $%X' % v)
        op = ENC[(mn, mode)]
        n = SIZE[mode]
        if n == 1: self.emit([op])
        elif n == 2: self.emit([op, v])
        else: self.emit([op, v >> 8, v])

    def chk_dir(self, v, s):
        if v is not None and not 0 <= v <= 0xFF:
            raise AsmError('bit operations need a direct address ($00-$FF): %s' % s)
        if v is None and self.p == 2:
            raise AsmError('undefined symbol in %s' % s)

    def rel(self, t, n):
        if t is None:
            return 0
        d = t - (self.pc + n)
        if self.p == 2 and not -128 <= d <= 127:
            raise AsmError('branch out of range (%d bytes)' % d)
        return d & 0xFF


def main(argv=None):
    ap = argparse.ArgumentParser(description='MC146805E2 assembler (8 KB image out)')
    ap.add_argument('source')
    ap.add_argument('-o', '--output', required=True)
    ap.add_argument('-l', '--listing', help='write an address/bytes/source listing')
    ap.add_argument('--syms', help='write the symbol table (name address)')
    ap.add_argument('-D', dest='define', action='append', default=[], metavar='NAME[=value]')
    a = ap.parse_args(argv)
    defs = {}
    for d in a.define:
        k, _, v = d.partition('=')
        defs[k] = Expr({}, 0).eval(v) if v else 1
    asm = Assembler(defs)
    try:
        img = asm.assemble(a.source)
    except AsmError as e:
        print('error: %s' % e, file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(os.path.abspath(a.output)), exist_ok=True)
    open(a.output, 'wb').write(img)
    if asm.free:
        f0, f1 = asm.free
        used = sum(asm.written[f0:f1 + 1])
        print('free area $%04X-$%04X: %d of %d bytes used' % (f0, f1, used, f1 - f0 + 1))
    if a.listing:
        with open(a.listing, 'w') as f:
            for addr, bs in asm.listing:
                f.write('%04X  %s\n' % (addr, bs.hex(' ')))
    if a.syms:
        with open(a.syms, 'w') as f:
            for k, v in sorted(asm.syms.items(), key=lambda kv: (kv[1], kv[0])):
                f.write('%04X %s\n' % (v, k))
    print('wrote %s' % a.output)
    return 0


if __name__ == '__main__':
    sys.exit(main())

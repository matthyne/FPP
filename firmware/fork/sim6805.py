"""Minimal MC146805E2 instruction-set simulator for testing fork routines.

Stdlib only. No interrupts, timers or peripherals: tests set RAM, call a
routine and look at RAM and at what was "sent" through stubbed routines.

    cpu = CPU(image)                       # 8 KB image; $00-$FF is RAM
    cpu.stub(0x0BE5, lambda c: sent.append(c.a))   # runs instead of the routine, then RTS
    cpu.call(0x0C14)                       # run until the routine returns
"""
from op6805 import DEC, SIZE


class SimError(Exception):
    pass


class CPU:
    def __init__(self, image):
        assert len(image) == 0x2000
        self.mem = bytearray(image)
        self.mem[:0x100] = bytes(0x100)
        self.a = self.x = 0
        self.sp = 0x7F
        self.h = self.i = self.n = self.z = self.c = 0
        self.pc = 0
        self.stubs = {}
        self.steps = 0
        self.on_step = None        # called before every instruction (e.g. to run soft timers)

    # -- memory
    def rd(self, a):
        return self.mem[a & 0x1FFF]

    def wr(self, a, v):
        a &= 0x1FFF
        if a >= 0x100:
            raise SimError('write to ROM $%04X at PC $%04X' % (a, self.pc))
        self.mem[a] = v & 0xFF

    def push(self, v):
        if self.sp < 0x60:
            raise SimError('stack overflow below $60')
        self.wr(self.sp, v)
        self.sp -= 1
        self.max_depth = max(getattr(self, 'max_depth', 0), 0x7F - self.sp)

    def pop(self):
        self.sp += 1
        if self.sp > 0x7F:
            raise SimError('stack underflow')
        return self.mem[self.sp]

    def stub(self, addr, fn):
        self.stubs[addr] = fn

    # -- running
    def call(self, addr, max_steps=100000):
        """JSR addr from a sentinel and run until it returns there."""
        sentinel = 0x0000
        self.push(sentinel & 0xFF)
        self.push(sentinel >> 8)
        base_sp = self.sp + 2
        self.pc = addr
        n = 0
        while not (self.pc == sentinel and self.sp == base_sp):
            self.step()
            n += 1
            if n > max_steps:
                raise SimError('no return after %d steps (PC $%04X)' % (n, self.pc))
        return self

    def _rts(self):
        hi = self.pop(); lo = self.pop()
        self.pc = hi << 8 | lo

    def _nz(self, r):
        r &= 0xFF
        self.n = r >> 7
        self.z = int(r == 0)
        return r

    def step(self):
        if self.on_step:
            self.on_step(self)
        if self.pc in self.stubs:
            self.stubs[self.pc](self)
            self._rts()
            return
        pc = self.pc
        op = self.rd(pc)
        if op not in DEC:
            raise SimError('illegal opcode $%02X at $%04X' % (op, pc))
        m, mode = DEC[op]
        size = SIZE[mode]
        b1 = self.rd(pc + 1)
        b2 = self.rd(pc + 2)
        nxt = pc + size
        self.steps += 1

        def rel(off):
            return (nxt + ((off ^ 0x80) - 0x80)) & 0xFFFF

        if mode == 'btb':
            bit = int(m[-1]); v = (self.rd(b1) >> bit) & 1
            self.c = v
            want = 1 if m.startswith('brset') else 0
            self.pc = (nxt + ((b2 ^ 0x80) - 0x80)) & 0xFFFF if v == want else nxt
            return
        if mode == 'bsc':
            bit = int(m[-1]); v = self.rd(b1)
            self.wr(b1, v | (1 << bit) if m.startswith('bset') else v & ~(1 << bit))
            self.pc = nxt
            return
        if mode == 'rel':
            t = rel(b1)
            if m == 'bsr':
                self.push(nxt & 0xFF); self.push(nxt >> 8)
                self.pc = t
                return
            cond = {'bra': 1, 'brn': 0, 'bhi': not (self.c or self.z), 'bls': self.c or self.z,
                    'bcc': not self.c, 'bcs': self.c, 'bne': not self.z, 'beq': self.z,
                    'bhcc': not self.h, 'bhcs': self.h, 'bpl': not self.n, 'bmi': self.n,
                    'bmc': not self.i, 'bms': self.i, 'bil': 0, 'bih': 1}[m]
            self.pc = t if cond else nxt
            return

        # effective address
        ea = None
        if mode == 'dir': ea = b1
        elif mode == 'ext': ea = b1 << 8 | b2
        elif mode == 'ix': ea = self.x
        elif mode == 'ix1': ea = (b1 + self.x) & 0x1FFF
        elif mode == 'ix2': ea = ((b1 << 8 | b2) + self.x) & 0x1FFF
        self.pc = nxt

        if mode == 'inh':
            return self._inherent(m)
        if m in ('jmp', 'jsr'):
            if m == 'jsr':
                self.push(nxt & 0xFF); self.push(nxt >> 8)
            self.pc = ea
            return
        if m in ('sta', 'stx'):
            self.wr(ea, self._nz(self.a if m == 'sta' else self.x))
            return
        if m in ('neg', 'com', 'lsr', 'ror', 'asr', 'lsl', 'rol', 'dec', 'inc', 'tst', 'clr'):
            r = self._rmw(m, self.rd(ea))
            if m != 'tst':
                self.wr(ea, r)
            return
        v = b1 if mode == 'imm' else self.rd(ea)
        self._alu(m, v)

    def _rmw(self, m, v):
        c = self.c
        if m == 'neg': r = (-v) & 0xFF; self.c = int(r != 0)
        elif m == 'com': r = (~v) & 0xFF; self.c = 1
        elif m == 'lsr': self.c = v & 1; r = v >> 1
        elif m == 'ror': self.c = v & 1; r = (v >> 1) | (c << 7)
        elif m == 'asr': self.c = v & 1; r = (v >> 1) | (v & 0x80)
        elif m == 'lsl': self.c = v >> 7; r = (v << 1) & 0xFF
        elif m == 'rol': self.c = v >> 7; r = ((v << 1) | c) & 0xFF
        elif m == 'dec': r = (v - 1) & 0xFF
        elif m == 'inc': r = (v + 1) & 0xFF
        elif m == 'tst': r = v
        elif m == 'clr': r = 0
        return self._nz(r)

    def _alu(self, m, v):
        a = self.a
        if m in ('sub', 'cmp', 'sbc', 'cpx'):
            l = self.x if m == 'cpx' else a
            r = l - v - (self.c if m == 'sbc' else 0)
            self.c = int(r < 0)
            r = self._nz(r)
            if m in ('sub', 'sbc'): self.a = r
        elif m in ('add', 'adc'):
            cin = self.c if m == 'adc' else 0
            r = a + v + cin
            self.h = int(((a & 0xF) + (v & 0xF) + cin) > 0xF)
            self.c = int(r > 0xFF)
            self.a = self._nz(r)
        elif m == 'and': self.a = self._nz(a & v)
        elif m == 'bit': self._nz(a & v)
        elif m == 'eor': self.a = self._nz(a ^ v)
        elif m == 'ora': self.a = self._nz(a | v)
        elif m == 'lda': self.a = self._nz(v)
        elif m == 'ldx': self.x = self._nz(v)
        else:
            raise SimError('unhandled %s' % m)

    def _inherent(self, m):
        if m.endswith('a') and m[:-1] in ('neg', 'com', 'lsr', 'ror', 'asr', 'lsl', 'rol', 'dec', 'inc', 'tst', 'clr'):
            self.a = self._rmw(m[:-1], self.a); return
        if m.endswith('x') and m[:-1] in ('neg', 'com', 'lsr', 'ror', 'asr', 'lsl', 'rol', 'dec', 'inc', 'tst', 'clr'):
            self.x = self._rmw(m[:-1], self.x); return
        if m == 'rts': return self._rts()
        if m == 'tax': self.x = self.a; return
        if m == 'txa': self.a = self.x; return
        if m == 'clc': self.c = 0; return
        if m == 'sec': self.c = 1; return
        if m == 'cli': self.i = 0; return
        if m == 'sei': self.i = 1; return
        if m == 'rsp': self.sp = 0x7F; return
        if m == 'nop': return
        raise SimError('unsupported instruction %s at $%04X' % (m, self.pc))

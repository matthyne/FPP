#!/usr/bin/env python3
"""Tests for fm92cap.py on synthetic PulseView captures.  Run: python3 -m unittest test_fm92cap"""
import contextlib
import io
import os
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fm92cap  # noqa: E402

RATE = 1_000_000            # 1 MHz: 1 sample = 1 us


class Sim:
    """Builds a packed-sample capture by holding channel levels for durations."""

    def __init__(self, names, unitsize=3):
        self.names = names
        self.bit = {n: i for i, n in enumerate(names)}
        self.unit = unitsize
        self.word = 0
        self.samples = []

    def set(self, **lv):
        for n, x in lv.items():
            b = self.bit[n]
            self.word = (self.word | (1 << b)) if x else (self.word & ~(1 << b))

    def port(self, prefix, value):
        for i in range(8):
            if f'{prefix}{i}' in self.bit:
                self.set(**{f'{prefix}{i}': (value >> i) & 1})

    def hold(self, n):
        self.samples.extend([self.word] * n)

    def save(self, path):
        meta = ['[global]', 'sigrok version=0.5.2', '[device 1]', 'capturefile=logic-1',
                f'total probes={len(self.names)}', f'samplerate={RATE // 1_000_000} MHz', 'total analog=0']
        meta += [f'probe{i + 1}={n}' for i, n in enumerate(self.names)]
        meta.append(f'unitsize={self.unit}')
        data = b''.join(w.to_bytes(self.unit, 'little') for w in self.samples)
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr('version', '2')
            z.writestr('metadata', '\n'.join(meta) + '\n')
            half = len(data) // 2 // self.unit * self.unit      # two chunks, to test joining
            z.writestr('logic-1-1', data[:half])
            z.writestr('logic-1-2', data[half:])


def run(argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        fm92cap.main(argv)
    return out.getvalue()


class PortsTest(unittest.TestCase):
    def test_latch_synth_irq_uart(self):
        names = [f'PA{i}' for i in range(8)] + [f'PB{i}' for i in range(8)] + ['AS', 'DS', 'RW', 'IRQ']
        s = Sim(names)
        s.set(PB0=1, PB5=1)               # link idles high, synth strobe idles high
        s.hold(50)
        s.port('PA', 0x5A); s.hold(5)
        s.set(PB4=1); s.hold(3); s.set(PB4=0); s.hold(20)          # latch $2C <- 5A
        s.port('PA', 0x03); s.hold(5)
        s.set(PB2=1); s.hold(3); s.set(PB2=0); s.hold(100)         # latch $2A (ADC mux 3)
        s.set(IRQ=1); s.hold(1); s.set(IRQ=0); s.hold(5); s.set(IRQ=1)   # comparator trips 100 us later
        s.hold(50)
        s.set(PB6=1); s.hold(5)                                      # synth load
        for x in (0x1E, 0x07, 0x0C):
            s.port('PA', x); s.hold(3); s.set(PB5=0); s.hold(2); s.set(PB5=1); s.hold(3)
        s.set(PB6=0); s.hold(50)
        bt = round(RATE / 1200)                                      # 8E1 byte 0xAA on PB0
        bits = [0] + [(0xAA >> k) & 1 for k in range(8)] + [0, 1]   # 0xAA has 4 ones -> parity 0
        for b in bits:
            s.set(PB0=b); s.hold(bt)
        s.hold(200)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'a.sr')
            s.save(p)
            out = run(['ports', p])
        self.assertIn('latch $2C  PA=5A (high pulse 3.0 us)', out)
        self.assertIn('latch $2A  PA=03', out)
        self.assertIn('IRQ (comparator) 101.0 us after latch $2A=03', out)
        self.assertIn('synth load 3 strobes: 1E 07 0C   low nibbles: E7C', out)
        self.assertIn('link PB0  byte AA\n', out)


class BusTest(unittest.TestCase):
    def test_cycles_and_nsc810(self):
        names = [f'AD{i}' for i in range(8)] + [f'A{i}' for i in range(8, 13)] + ['AS', 'DS', 'RW'] \
            + [f'PA{i}' for i in range(8)]
        s = Sim(names, unitsize=4)

        def cycle(addr, data, rw):
            s.set(RW=1 if rw == 'R' else 0)
            for i in range(5):
                s.set(**{f'A{i + 8}': (addr >> (8 + i)) & 1})
            s.port('AD', addr & 0xFF); s.set(AS=1); s.hold(2); s.set(AS=0); s.hold(1)
            s.port('AD', data); s.set(DS=1); s.hold(2); s.set(DS=0); s.hold(1)

        s.hold(5)
        cycle(0x0100, 0x9B, 'R')
        cycle(0x0081, 0x42, 'W')
        cycle(0x1F2D, 0x0F, 'R')
        cycle(0x0081, 0x43, 'W')
        with tempfile.TemporaryDirectory() as d:
            p, c = os.path.join(d, 'b.sr'), os.path.join(d, 'b.csv')
            s.save(p)
            out = run(['bus', p, '--csv', c])
            with open(c) as f:
                rows = f.read().splitlines()
        self.assertIn('4 bus cycles', out)
        self.assertIn('$81 W x2      values: 42 43', out)
        self.assertEqual(rows[1].split(',')[1:], ['0100', '9B', 'R'])
        self.assertEqual(rows[3].split(',')[1:], ['1F2D', '0F', 'R'])


if __name__ == '__main__':
    unittest.main()

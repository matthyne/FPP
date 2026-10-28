#!/usr/bin/env python3
"""Decode PulseView (.sr) captures of an FM92 control board.

Python 3, stdlib only.  Channels are found by the names given to them in
PulseView (see CAPTURE.md for the probe map):

  PA0..PA7  PB0..PB7  AS  DS  RW  IRQ  RESET  AD0..AD7  A8..A12

Sub-commands:
  info   FILE            sample rate, length, and activity per channel
  ports  FILE [--baud N] latch writes, synthesiser loads, IRQ (ADC) timing,
                         head-link bytes on PB0 (setup A)
  bus    FILE [--csv OUT] every external bus cycle (address, data, R/W),
                         NSC810 accesses and AS gaps (setup B)
"""
import argparse
import bisect
import configparser
import csv
import re
import sys
import zipfile
from array import array

# ---------------------------------------------------------------- loading

_UNITS = {'': 1, 'k': 1e3, 'm': 1e6, 'g': 1e9}


def parse_rate(s):
    m = re.fullmatch(r'\s*([\d.]+)\s*([kKmMgG]?)\s*Hz\s*', s)
    if not m:
        raise ValueError(f'unrecognised samplerate {s!r}')
    return float(m.group(1)) * _UNITS[m.group(2).lower()]


class Capture:
    """A capture reduced to transitions: t[i] is the sample at which the
    packed channel word becomes v[i].  t[0] == 0."""

    def __init__(self, rate, names, t, v, nsamples):
        self.rate = rate
        self.names = names          # name -> bit
        self.t = t
        self.v = v
        self.n = nsamples

    @classmethod
    def load(cls, path):
        with zipfile.ZipFile(path) as z:
            return cls._load(z)

    @classmethod
    def _load(cls, z):
        meta = configparser.ConfigParser(interpolation=None)
        meta.read_string(z.read('metadata').decode())
        dev = next(s for s in meta.sections() if s.startswith('device'))
        d = meta[dev]
        rate = parse_rate(d['samplerate'])
        unit = int(d.get('unitsize', '1'))
        names = {}
        for k, val in d.items():
            m = re.fullmatch(r'probe(\d+)', k)
            if m:
                names[val.strip().upper().replace('/', '')] = int(m.group(1)) - 1
        base = d.get('capturefile', 'logic-1')
        chunks = sorted((n for n in z.namelist() if n == base or n.startswith(base + '-')),
                        key=lambda n: int(n.rsplit('-', 1)[1]) if n != base else 0)
        t, v = array('Q'), array('Q')
        prev, i = None, 0
        for name in chunks:
            data = z.read(name)
            if unit in (1, 2, 4, 8):
                words = array({1: 'B', 2: 'H', 4: 'I', 8: 'Q'}[unit])
                words.frombytes(data[:len(data) - len(data) % unit])
                if sys.byteorder != 'little':
                    words.byteswap()
            else:
                words = (int.from_bytes(data[j:j + unit], 'little') for j in range(0, len(data) - unit + 1, unit))
            for w in words:
                if w != prev:
                    t.append(i)
                    v.append(w)
                    prev = w
                i += 1
        return cls(rate, names, t, v, i)

    # ------------------------------------------------------------ access

    def bit(self, name):
        try:
            return self.names[name]
        except KeyError:
            raise SystemExit(f'channel {name} not in capture (have: {", ".join(sorted(self.names))})')

    def has(self, *names):
        return all(n in self.names for n in names)

    def word_at(self, sample):
        """Packed channel word in force at `sample`."""
        return self.v[bisect.bisect_right(self.t, sample) - 1]

    def field(self, word, names):
        out = 0
        for k, n in enumerate(names):
            out |= ((word >> self.bit(n)) & 1) << k
        return out

    def edges(self, name):
        """[(sample, new_level)] for every change of one channel."""
        b = self.bit(name)
        out, prev = [], (self.v[0] >> b) & 1
        for t, w in zip(self.t, self.v):
            lv = (w >> b) & 1
            if lv != prev:
                out.append((t, lv))
                prev = lv
        return out

    def us(self, sample):
        return sample / self.rate * 1e6


PA = [f'PA{i}' for i in range(8)]
AD = [f'AD{i}' for i in range(8)]
AH = [f'A{i}' for i in range(8, 13)]

# ---------------------------------------------------------------- info


def cmd_info(cap, args):
    print(f'samplerate {cap.rate / 1e6:g} MHz, {cap.n} samples = {cap.us(cap.n) / 1e3:.3f} ms, '
          f'{len(cap.t)} transitions')
    for name, b in sorted(cap.names.items(), key=lambda kv: kv[1]):
        e = cap.edges(name)
        rises = sum(1 for _, lv in e if lv)
        f = rises / (cap.n / cap.rate) if cap.n else 0
        lvl = (cap.v[0] >> b) & 1
        print(f'  ch{b:<2} {name:<6} start={lvl} edges={len(e):<8} ~{f:,.0f} rises/s')

# ---------------------------------------------------------------- ports


def pulses(cap, name):
    """Pulses away from the channel's idle level (its level at t=0):
    [(start, end, polarity)].  polarity 1 = high-going."""
    e = cap.edges(name)
    idle = (cap.v[0] >> cap.bit(name)) & 1
    out, start = [], None
    for t, lv in e:
        if lv != idle:
            start = t
        elif start is not None:
            out.append((start, t, 1 - idle))
            start = None
    return out


def uart(cap, name, baud, parity='even'):
    """Decode 8-bit frames with a parity bit, idle high: [(sample, byte, parity_ok)]."""
    bt = cap.rate / baud
    out = []
    falls = [t for t, lv in cap.edges(name) if lv == 0]
    b = cap.bit(name)
    end = -1
    for f in falls:
        if f < end:
            continue
        lv = lambda k: (cap.word_at(int(f + (k + 0.5) * bt)) >> b) & 1
        if lv(0) != 0:
            continue                          # glitch, not a start bit
        byte = sum(lv(1 + k) << k for k in range(8))
        p = lv(9)
        ok = (bin(byte).count('1') + p) % 2 == (0 if parity == 'even' else 1)
        out.append((f, byte, ok and lv(10) == 1))
        end = f + 10.5 * bt
    return out


def cmd_ports(cap, args):
    ev = []
    pa = lambda s: cap.field(cap.word_at(s - 1), PA)    # port A just before the edge
    for ch, label in (('PB2', 'latch $2A'), ('PB3', 'latch $29'), ('PB4', 'latch $2C')):
        if cap.has(ch, *PA):
            for s, e, pol in pulses(cap, ch):
                ev.append((s, f'{label:<10} PA={pa(e):02X} ({"high" if pol else "low"} pulse {cap.us(e - s):.1f} us)'))
    if cap.has('PB5', 'PB6', *PA):
        windows = [(s, e) for s, e, pol in pulses(cap, 'PB6') if pol == 1]
        strobes = pulses(cap, 'PB5')
        for ws, we in windows:
            vals = [pa(e) for s, e, _ in strobes if ws <= s < we]
            ev.append((ws, f'synth load {len(vals)} strobes: ' + ' '.join(f'{x:02X}' for x in vals)
                       + '   low nibbles: ' + ''.join(f'{x & 15:X}' for x in vals)))
    if cap.has('IRQ'):
        mux = [(e, pa(e)) for s, e, _ in pulses(cap, 'PB2')] if cap.has('PB2', *PA) else []
        mt = [m[0] for m in mux]
        for s, lv in cap.edges('IRQ'):
            if lv == 0:
                k = bisect.bisect_right(mt, s) - 1
                note = f' {cap.us(s - mux[k][0]):.1f} us after latch $2A={mux[k][1]:02X}' if k >= 0 else ''
                ev.append((s, f'IRQ (comparator){note}'))
    if cap.has('PB0'):
        for s, byte, ok in uart(cap, 'PB0', args.baud):
            ev.append((s, f'link PB0  byte {byte:02X}{"" if ok else "  (parity/stop error)"}'))
    if cap.has('PB1'):
        r = sum(1 for _, lv in cap.edges('PB1') if lv)
        print(f'PB1: {r / (cap.n / cap.rate):.1f} Hz average')
    for s, text in sorted(ev):
        print(f'{cap.us(s) / 1e3:12.4f} ms  {text}')

# ---------------------------------------------------------------- bus


def cmd_bus(cap, args):
    for n in ('AS', 'DS', 'RW', *AD):
        cap.bit(n)
    high = cap.has(*AH)
    as_falls = [t for t, lv in cap.edges('AS') if lv == 0]
    ds_falls = [t for t, lv in cap.edges('DS') if lv == 0]
    cycles = []
    k = 0
    for d in ds_falls:
        while k + 1 < len(as_falls) and as_falls[k + 1] < d:
            k += 1
        if not as_falls or as_falls[k] > d:
            continue
        aw = cap.word_at(as_falls[k] - 1)
        dw = cap.word_at(d - 1)
        addr = cap.field(aw, AD) | ((cap.field(aw, AH) << 8) if high else 0)
        rw = 'R' if (dw >> cap.bit('RW')) & 1 else 'W'
        cycles.append((as_falls[k], addr, cap.field(dw, AD), rw))
    print(f'{len(cycles)} bus cycles, {len(as_falls)} AS pulses'
          + (f', AS rate {len(as_falls) / (cap.n / cap.rate) / 1e3:.1f} kHz' if cap.n else ''))
    gaps = [(a, b) for a, b in zip(as_falls, as_falls[1:]) if cap.us(b - a) > 20]
    for a, b in gaps[:20]:
        print(f'  AS gap {cap.us(b - a) / 1e3:.3f} ms at {cap.us(a) / 1e3:.4f} ms (STOP/WAIT?)')
    ext = [c for c in cycles if 0x80 <= c[1] <= 0xFF]
    print(f'{len(ext)} accesses to $80-$FF (NSC810 when fitted):')
    seen = {}
    for s, a, dv, rw in ext:
        seen.setdefault((a, rw), []).append(dv)
    for (a, rw), vals in sorted(seen.items()):
        print(f'  ${a:02X} {rw} x{len(vals):<6} values: ' + ' '.join(f'{x:02X}' for x in sorted(set(vals))[:16]))
    if args.csv:
        with open(args.csv, 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(['time_us', 'addr', 'data', 'rw'])
            for s, a, dv, rw in cycles:
                w.writerow([f'{cap.us(s):.3f}', f'{a:04X}', f'{dv:02X}', rw])
        print(f'wrote {args.csv}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('info', 'ports', 'bus'):
        p = sub.add_parser(name)
        p.add_argument('file')
        if name == 'ports':
            p.add_argument('--baud', type=float, default=1200)
        if name == 'bus':
            p.add_argument('--csv')
    args = ap.parse_args(argv)
    cap = Capture.load(args.file)
    {'info': cmd_info, 'ports': cmd_ports, 'bus': cmd_bus}[args.cmd](cap, args)


if __name__ == '__main__':
    main()

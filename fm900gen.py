#!/usr/bin/env python3
"""
fm900gen.py - build Philips FM900 (FM91 / FM92) personality EPROM images on Linux.

This is a clean re-implementation of the image builder inside FM900.EXE
("PHILIPS FM900 Field Personality Programmer", MS C 5.x, 1987-88), recovered by
disassembly.  See FM900_FORMAT.md for the full format description and the
FM900.EXE routine addresses each step corresponds to.

Usage summary (see --help):
  fm900gen.py build  channels.csv --hw 92440150 --sw 110100201000000 -o out.bin
  fm900gen.py fromjob JOB.JOB [CHL] -o out.bin       (rebuild from DOS job files)
  fm900gen.py dump   image.bin [--hw ...]            (decode an image)
  fm900gen.py writejob channels.csv --hw .. --sw .. -o NAME   (write .JOB/.CHL)
"""
import argparse, csv, datetime, io, os, struct, sys
from fractions import Fraction

IMG_SIZE = 0x2000

# ---------------------------------------------------------------------------
# Constant tables copied verbatim from FM900.EXE's data segment (DGROUP 0x230F)
# ---------------------------------------------------------------------------

# DS:0x09CC .. DS:0x0C40.  Two overlapping tables live here:
#   DS:0x09CC  4-byte entries indexed by the 2-digit "selcall encode" code
#              (SW code chars 11-12): u16 flags, u8 or-mask for 0x1F36, u8 for 0x1F37
#   DS:0x0AAE  4-byte entries indexed by the 2-digit "selcall decode" code
#              (SW code chars 13-14): u8 or-mask for 0x1F36, u8 for 0x1F37
_DSBLOB = bytes.fromhex(
    "010008400300090101000900030001010300010103000900020009000300010003000100010009000200094103000141"
    "030001410200094002000940030001400300014004004b80000000000400438000000000020049010200490102004101"
    "020041010600490106004901070041010700410102004900020049000200410002004100060049000600490007004100"
    "070041000200494102004941020041410200414106004941060049410700414107004141020049400200494002004140"
    "020041400600494006004940070041400700414001000940000000000000000001000000010083000100870001008304"
    "010087040100a3080100a30c0100a7080100a70c0100870801008320010087200100872801008324010087240100a328"
    "0100a32c0100a7280100a72c000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000100830001008700010083040100870401008308010087080100830c0100870c01008320"
    "01008720010083240100872401008328010087280100832c0100872c0000000000000000000000000100030001000304"
    "000003080000030c0000000000000000510011000000000000c05040520012009a99999999f95140530013009a999999"
    "9999524054001400000000000040534055001500cdccccccccec5340490009000000000000a05440560016009a999999"
    "99595540410001000000000000205640570017000000000000e056404a000a003333333333b357404200020000000000"
    "000059404b000b000000000000e0594043000300cdcccccccccc5a404c000c009a99999999b95b404400040033333333"
    "33b35c40")
_DSBASE = 0x09CC


def _ds(off):
    return _DSBLOB[off - _DSBASE]


def _ds16(off):
    return _ds(off) | _ds(off + 1) << 8


def enc_tab_word(n):   # DS:0x09CC + 4n
    return _ds16(0x09CC + 4 * n)


# CTCSS table (DS:0x0B8C, 38 x {char code[2]; u16 value; double hz}).
CTCSS = [
    ('Q', 17, 67.0), ('R', 18, 71.9), ('S', 19, 74.4), ('T', 20, 77.0),
    ('U', 21, 79.7), ('I', 9, 82.5), ('V', 22, 85.4), ('A', 1, 88.5),
    ('W', 23, 91.5), ('J', 10, 94.8), ('B', 2, 100.0), ('K', 11, 103.5),
    ('C', 3, 107.2), ('L', 12, 110.9), ('D', 4, 114.8), ('M', 13, 118.8),
    ('E', 5, 123.0), ('N', 14, 127.3), ('F', 6, 131.8), ('O', 15, 136.5),
    ('G', 7, 141.3), ('P', 16, 146.2), ('H', 8, 151.4), ('X', 24, 156.7),
    ('Y', 25, 162.2), ('0', 26, 167.9), ('1', 27, 173.8), ('2', 28, 180.2),
    ('3', 29, 186.2), ('4', 30, 192.8), ('5', 31, 203.5), ('6', 32, 210.7),
    ('7', 33, 218.1), ('8', 34, 225.7), ('9', 35, 233.6), ('*', 36, 241.8),
    ('#', 37, 250.3), ('=', 38, 97.4),
]
CTCSS_BY_CODE = {c: v for c, v, hz in CTCSS}
CTCSS_BY_HZ = {hz: c for c, v, hz in CTCSS}

# Channel-record flag word (offset 0x14 of a .CHL record)
F_HIGH, F_MED, F_LOW, F_SELPWR = 0x0001, 0x0002, 0x0004, 0x0008
F_ECON, F_SELCALL, F_CR = 0x0010, 0x0020, 0x0040
F_SCAN1, F_SCAN2, F_SCAN3 = 0x0080, 0x0100, 0x0200
F_PRI1, F_PRI2, F_PRI3 = 0x0400, 0x0800, 0x1000
F_SCANSEL, F_VOTE = 0x2000, 0x4000

MASTER_VERSION = {   # file -> (byte at 0x1FE5, string at 0x1FEB)   (FUNC 0x8517)
    'FM91S.BIN': (10, '01045'), 'FM91.BIN': (1, '0020:'),
    'FM92LS.BIN': (11, '01065'), 'FM92L.BIN': (4, '0028:'),
    'FM92RS.BIN': (12, '01055'), 'FM92R.BIN': (5, '0029:'),
    'FM93S.BIN': (13, '03851'), 'FM93.BIN': (14, '03861'),
    'FM97WPS.BIN': (12, '03710'), 'FM97WP.BIN': (5, '03700'),
}


class FM900Error(Exception):
    pass


# ---------------------------------------------------------------------------
# Channel record
# ---------------------------------------------------------------------------
class Channel:
    def __init__(self, num, rx, tx, flags=0, ctcss=''):
        self.num = num          # channel number 1..99 (FM92) / 1..120 (FM91)
        self.rx = rx            # "147.0000"  (always 4 decimals)
        self.tx = tx            # "147.0000" or "XXXXXXXX" (receive only)
        self.flags = flags
        self.ctcss = ctcss      # CTCSS letter code ('' = none)

    # .CHL on-disk record: 24 bytes  (see FM900_FORMAT.md)
    def to_chl(self):
        r = bytearray(24)
        struct.pack_into('<H', r, 0, self.num)
        r[2:2 + len(self.rx)] = self.rx.encode()
        r[11:11 + len(self.tx)] = self.tx.encode()
        struct.pack_into('<H', r, 20, self.flags)
        if self.ctcss:
            r[22] = ord(self.ctcss)
        return bytes(r)

    @classmethod
    def from_chl(cls, r):
        num = struct.unpack_from('<H', r, 0)[0]
        rx = r[2:11].split(b'\0')[0].decode('latin1')
        tx = r[11:20].split(b'\0')[0].decode('latin1')
        flags = struct.unpack_from('<H', r, 20)[0]
        # byte 22..23 is a NUL-terminated string; byte 23 is often junk when
        # byte 22 is 0 (no CTCSS).  FM900.EXE does strcmp(rec+0x16, code).
        ct = ''
        if r[22]:
            ct = r[22:24].split(b'\0')[0].decode('latin1') if r[23] == 0 else \
                r[22:24].decode('latin1') + '?'
        return cls(num, rx, tx, flags, ct)


def read_chl(path):
    data = open(path, 'rb').read()
    chans = []
    for i in range(0, len(data) - 23, 24):
        r = data[i:i + 24]
        if r[0] == 0 and r[1] == 0:
            break               # the in-memory channel list ends at the first empty slot
        chans.append(Channel.from_chl(r))
    return chans


def write_chl(path, chans, nrec=120):
    out = bytearray(24 * nrec)
    for i, c in enumerate(chans):
        out[24 * i:24 * i + 24] = c.to_chl()
    open(path, 'wb').write(out)


def read_job(path):
    lines = open(path, 'rb').read().decode('latin1').split('\r\n')
    # line 0: sum of frequencies, then a variable number of comment lines,
    # then the hardware code and the software code as the last two lines.
    while lines and not lines[-1].strip():
        lines.pop()
    if len(lines) < 3:
        raise FM900Error('%s: not a FM900 job file' % path)
    return {'sum': lines[0], 'comments': lines[1:-2], 'hw': lines[-2].strip(), 'sw': lines[-1].strip()}


def write_job(path, hw, sw, comments=(), freqsum=''):
    c = list(comments)[:5] + [''] * (5 - len(list(comments)[:5]))
    txt = '\r\n'.join([freqsum] + c + [hw, sw]) + '\r\n'
    open(path, 'wb').write(txt.encode('latin1'))


# ---------------------------------------------------------------------------
# Frequency helpers
# ---------------------------------------------------------------------------
def norm_freq(s):
    """Normalise to the 'MHz with 4 decimals' string FM900.EXE stores."""
    s = str(s).strip()
    if s.upper().startswith('X'):
        return 'XXXXXXXX'
    f = Fraction(s)
    v = f * 10000
    if v.denominator != 1:
        raise FM900Error('frequency %s has more than 4 decimal places (100 Hz resolution)' % s)
    v = int(v)
    return '%d.%04d' % (v // 10000, v % 10000)


def freq_units(s):
    """FUNC 0x4E2D + atol: '147.0000' -> 1470000 (100 Hz units)."""
    a, _, b = s.partition('.')
    return int(a + (b + '0000')[:4])


# ---------------------------------------------------------------------------
# The builder
# ---------------------------------------------------------------------------
class Builder:
    def __init__(self, hw, sw, masters_dir, date=None, version=(0x21, 0x12)):
        self.hw = hw
        self.sw = sw
        self.masters_dir = masters_dir
        self.date = date or datetime.date.today()
        self.version = version
        self._check_codes()

    # -- code validation -------------------------------------------------
    def _check_codes(self):
        hw, sw = self.hw, self.sw
        if len(hw) != 8 or not hw.isdigit():
            raise FM900Error('hardware code must be 8 digits, got %r' % hw)
        if len(sw) != 15 or not sw.isdigit():
            raise FM900Error('software code must be 15 digits, got %r' % sw)
        if hw[1] not in '12':
            raise FM900Error('only FM91 (hw digit 2 = 1) and FM92 (= 2) are supported; '
                             'FM93 / "92 with 91 PCBs" builds are not implemented')
        if hw[2] not in '2345678':
            raise FM900Error('unknown band digit %r' % hw[2])
        if hw[3] not in '3478':
            raise FM900Error('unknown control/spacing digit %r' % hw[3])
        if hw[4] in '237':
            raise FM900Error('water-proof mechanics (hw digit 5 = 2/3/7) use the FM97WP '
                             'master, which is not supported by this tool')

    @property
    def model(self):            # 1 = FM92, 2 = FM91   (switch in FUNC 0x52FD)
        return {'2': 1, '1': 2}[self.hw[1]]

    def master_name(self):      # FUNC 0x8196
        hw = self.hw
        sel = '3' <= hw[5] <= '5'
        if hw[1] == '1':
            return 'FM91S.BIN' if sel else 'FM91.BIN'
        if hw[3] in '1357':
            return 'FM92LS.BIN' if sel else 'FM92L.BIN'
        return 'FM92RS.BIN' if sel else 'FM92R.BIN'

    # -- synthesiser parameters ------------------------------------------
    def if_offset(self):        # FUNC 0x4723: IF in 10 Hz units, sign = LO side
        c, b = self.hw[3], self.hw[2]
        v = {'1': 1070000, '2': 1070000, '3': 2140000, '4': 2140000,
             '5': 1070000, '6': 1070000, '7': 2140000, '8': 2140000}.get(c, 0)
        if b in '019':
            v = 0
        elif b in '478':
            v = -v
        return v

    def pick_step(self, chans):  # FUNC 0x4A35 / 0x4C99   (10 Hz units)
        vhf = self.hw[2] <= '4'
        wide = self.hw[3] <= '4'
        if vhf:
            order = [500, 625] if wide else [625, 500]
        else:
            order = [2500] if wide else [1250]
        vals = []
        for c in chans:
            vals.append(freq_units(c.rx) * 10)
            if not c.tx.startswith('X'):
                vals.append(freq_units(c.tx) * 10)
        for st in order:
            bad = [v for v in vals if v % st]
            if not bad:
                return st
        raise FM900Error('frequencies are not all on a %s kHz raster' %
                         ' or '.join(str(s / 100) for s in order))

    def divider(self, fstr, is_rx):  # FUNC 0xAE7E
        v = freq_units(fstr) * 10
        if is_rx:
            v += self.ifo
        q = abs(v) // self.step     # C long division truncates toward zero
        q = -q if v < 0 else q
        digs = str(q)
        out = 0
        for i in range(5):           # last 5 decimal digits, each one's-complemented
            ch = digs[len(digs) - 1 - i] if i < len(digs) else '0'
            d = (~int(ch)) & 0xF
            out |= d << (4 * i)
        return out & 0x7FFFF

    # FUNC 0x5FE7: VCO band-switch bit for VHF receive frequencies.
    # True if rx is within [-40 kHz, +30 kHz] of a whole MHz ([-30,+15] on E-band).
    # Evaluated exactly, as the x87 does in 80-bit precision.
    def vco_bit(self, rx):
        lo, hi = (-0.03, 0.015) if self.hw[2] == '2' else (-0.04, 0.03)
        f = Fraction(float(rx))
        ip = Fraction(int(float(rx) + 0.5))
        if ip + Fraction(lo) > f:
            return 0
        if ip + Fraction(hi) < f:
            return 0
        return 1

    # -- per-channel record encoders --------------------------------------
    def rec_power(self, r, c):   # FUNC 0x60C9
        hw, fl = self.hw, c.flags
        if hw[2] <= '4' and hw[1] == '2':
            if fl & F_HIGH:
                r[5] |= 0x30
            elif fl & (F_MED | F_LOW):
                r[5] = (r[5] & 0xCF) | 0x20
        else:
            if fl & F_HIGH:
                r[5] |= 0x30
            elif fl & F_MED:
                r[5] = (r[5] & 0xCF) | 0x20
            elif fl & F_LOW:
                r[5] = (r[5] & 0xCF) | 0x10
            elif fl & F_SELPWR:
                r[5] &= 0xCF
        if hw[2] >= '5':
            p = (r[5] >> 4) & 3
            r[2] = (r[2] & 0xF7) | ((((~p) >> 1) & 1) << 3)
        if not fl & F_ECON:
            r[7] &= 0xFE

    def rec_freqs(self, r, c):   # FUNC 0x5A5D
        n = self.divider(c.rx, True)
        r[0] = n & 0xFF
        r[1] = (n >> 8) & 0xFF
        r[2] = (r[2] & 0xF8) | ((n >> 16) & 7)
        r[2] |= 0x80
        if c.tx == 'XXXXXXXX':
            r[5] &= 0x7F
            r[5] |= 0x08            # common exit at 0x5CA8
            return
        n = self.divider(c.tx, False)
        r[3] = n & 0xFF
        r[4] = (n >> 8) & 0xFF
        r[5] = (r[5] & 0xF8) | ((n >> 16) & 7)
        r[5] |= 0x80
        neg = self.ifo < 0
        if self.hw[2] <= '4':
            if neg:
                r[2] &= 0xBF; r[5] |= 0x40
            else:
                r[2] |= 0x40; r[5] &= 0xBF
            if self.vco_bit(c.rx):
                r[2] |= 0x08
            else:
                r[2] &= 0xF7
        else:
            if neg:
                r[2] |= 0x40; r[5] &= 0xBF
            else:
                r[2] &= 0xBF; r[5] |= 0x40
        r[5] |= 0x08

    def rec_options(self, r, c):  # FUNC 0x6226
        fl, sw = c.flags, self.sw
        if c.ctcss:
            for code, val, hz in CTCSS:
                if code == c.ctcss:
                    r[6] = (r[6] & 0xC0) | (val & 0x3F)
        else:
            r[6] &= 0xC0
        r[6] = (r[6] & 0xBF) | (0x40 if fl & F_SCANSEL else 0)
        r[6] = (r[6] & 0x7F) | (0x80 if fl & F_CR else 0)
        enc = int(sw[11:13])
        r[7] = (r[7] & 0x7F) | (((enc_tab_word(enc) >> 1) & 1) << 7)
        if self.hw[1] != '3':
            if not fl & F_ECON:
                r[7] &= 0xFB
                r[7] &= 0xFD
            if not fl & (F_ECON | F_CR):
                r[7] = (r[7] & 0xFD) | (0x02 if sw[2] == '2' else 0)
                if not r[7] & 0x02:
                    r[7] = (r[7] & 0xFB) | (0x04 if fl & F_SELCALL else 0)
            r[2] = (r[2] & 0xDF) | (0x20 if fl & F_ECON else 0)
        r[2] = (r[2] | 0x10) if (fl & F_VOTE) else (r[2] & 0xEF)

    # -- main ------------------------------------------------------------
    def build(self, chans, master=None):
        hw, sw = self.hw, self.sw
        if master is None:
            mname = self.master_name()
            path = os.path.join(self.masters_dir, mname)
            if not os.path.exists(path):
                raise FM900Error('master image %s not found' % path)
            master = open(path, 'rb').read()
            ver = MASTER_VERSION[mname]
            if master[0x1FE5] != ver[0] or master[0x1FEB:0x1FF0].decode('latin1') != ver[1]:
                raise FM900Error('%s: master contains incorrect version number' % mname)
        else:
            mname = None
        if len(master) != IMG_SIZE:
            raise FM900Error('master must be 8192 bytes')
        img = bytearray(master)
        self.warnings = []

        # FUNC 0x123EA: initialise the selcall tone memory (not done for FM92L)
        if mname != 'FM92L.BIN':
            img[0x1F67] = 0
            for a, n, v in ((0x1F68, 9, 0x0F), (0x1F71, 9, 0), (0x1F7A, 1, 0),
                            (0x1F7B, 9, 0x0F), (0x1F84, 9, 0), (0x1F8D, 9, 0x0F),
                            (0x1F96, 9, 0x0F), (0x1F9F, 9, 0x0F)):
                img[a:a + n] = bytes([v]) * n

        if not chans:
            raise FM900Error('no channels')
        self.ifo = self.if_offset()
        self.step = self.pick_step(chans)

        # ---- FUNC 0x52FD: channel table --------------------------------
        if self.model == 1:      # FM92: 99 slots of 8 bytes from 0x1BE8
            base, nmax = 0x1BE8, 99
        else:                    # FM91: 120 slots from 0x1B40
            base, nmax = 0x1B40, 120
        if len(chans) > nmax:
            raise FM900Error('too many channels (%d > %d)' % (len(chans), nmax))
        used = [[0, 0, 0] for _ in range(0x79)]   # DS:0xA85A {a,b,c}
        top = nmax - 1                            # DS:0xA858
        ch_min, ch_max, pw_min, pw_max = 0x79, 0, 25, 1

        def link(slot, val):     # word at slot+6, bits 8..14
            img[base + 8 * slot + 7] = (img[base + 8 * slot + 7] & 0x80) | (val & 0x7F)

        def remap(idx):          # FUNC 0x5927
            nonlocal top
            if used[idx][0] == 0:
                used[idx] = [1, idx, idx]
                link(idx, idx)
                return idx
            cidx = used[idx][2]
            used[top][1] = used[cidx][1]
            used[cidx][1] = top
            used[top][2] = cidx
            used[idx][2] = top
            link(top, used[top][1])
            link(used[top][2], top)
            r = top
            top -= 1
            return r

        for c in chans:
            n = c.num
            if not 1 <= n <= nmax:
                raise FM900Error('channel number %d out of range 1..%d' % (n, nmax))
            if ch_min > n:
                ch_min = n
            if ch_max < n:
                ch_max = n
            if c.flags & F_HIGH and pw_max < 25:
                pw_max = 25
            if c.flags & F_MED and pw_max < 5:
                pw_max = 5
            if c.flags & F_MED and pw_min > 5:
                pw_min = 5
            if c.flags & F_LOW and pw_min > 1:
                pw_min = 1
            slot = n - 1
            if used[slot][0] or c.flags & F_ECON:
                slot = remap(slot)
            if slot < 0:
                raise FM900Error('out of channel slots')
            a = base + 8 * slot
            r = img[a:a + 8]
            self.rec_power(r, c)
            self.rec_freqs(r, c)
            self.rec_options(r, c)
            img[a:a + 8] = r
            self._vco_check(c)

        # ---- FUNC 0x6452: configuration block ---------------------------
        d = self.date
        img[0x1FE2] = int('%02d' % d.day, 16)
        img[0x1FE3] = int('%02d' % d.month, 16)
        img[0x1FE4] = int('%02d' % (d.year % 100), 16)
        self._options(img)                     # FUNC 0x6688 -> 0x1F32..0x1F37, 0x1F66
        # FUNC 0x7182 -> 0x1F38.., Tx timer and channel range
        img[0x1F38] = {'1': 0x07, '2': 0x13, '3': 0x1F, '4': 0x3D}.get(sw[3], 0)
        img[0x1F3F] = ch_min & 0xFF
        img[0x1F3E] = ch_max & 0xFF
        self._scan(img, chans)                 # FUNC 0x77F7
        self._power_and_misc(img, ch_min, pw_min, pw_max)   # FUNC 0x7285
        img[0x1FE0], img[0x1FE1] = self.version

        # ---- FUNC 0x30A0: checksums ----------------------------------------
        checksum(img)
        self.info = dict(master=mname, step_khz=self.step / 100, if_mhz=self.ifo / 100000,
                         ch_min=ch_min, ch_max=ch_max, pw_min=pw_min, pw_max=pw_max)
        return bytes(img)

    def _vco_check(self, c):
        pass  # warnings are produced in vco_warnings() once all channels are known

    def vco_warnings(self, chans):   # FUNC 0xF7A6 (warning only)
        tab = {'2': (3.0, 5.0, 9.0), '3': (5.5, 6.0, 7.0), '4': (6.0, 7.0, 8.0),
               '5': (10.0, 10.0, 17.0), '6': (10.0, 10.0, 28.0), '7': (10.0, 10.0, 30.0),
               '8': (10.0, 10.0, 17.0)}.get(self.hw[2])
        if not tab:
            return []
        rx = [float(c.rx) for c in chans]
        tx = [float(c.tx) for c in chans if not c.tx.startswith('X')] or [0.0]
        w = []
        if max(rx) - min(rx) > tab[0]:
            w.append('Rx - Rx switching bandwidth of VCO exceeded')
        elif max(tx) - min(tx) > tab[1]:
            w.append('Tx - Tx switching bandwidth of VCO exceeded')
        elif max(rx + tx) - min(rx + tx) > tab[2]:
            w.append('Rx - Tx switching bandwidth of VCO exceeded')
        return w

    def _options(self, img):         # FUNC 0x6688
        sw, hw = self.sw, self.hw
        enc, dec = int(sw[11:13]), int(sw[13:15])
        b = 0
        b |= (sw[10] >= '1') << 0
        b |= (sw[0] in '02') << 1
        b |= (sw[4] == '1') << 2
        b |= (sw[3] >= '1') << 3
        b |= (sw[5] == '3') << 5
        b |= ((enc_tab_word(enc) >> 2) & 1) << 6
        b |= (sw[6] == '3') << 7
        img[0x1F33] = b
        b = 0
        b |= ('1' <= sw[8] <= '7') << 0
        b |= (('3' <= sw[8] <= '4') or sw[8] == '7') << 1
        b |= (hw[5] in '258') << 2
        b |= (sw[8] in '246') << 3
        b |= ('1' <= sw[6] <= '4') << 4
        b |= (hw[7] in '36') << 5
        b |= (dec >= 50) << 6
        b |= ('2' <= sw[6] <= '4') << 7
        img[0x1F34] = b
        b = 0x01 | 0x80
        b |= (sw[7] == '1') << 1
        b |= ('1' <= sw[2] <= '3') << 3
        b |= (sw[1] in '02') << 4
        b |= (sw[0] in '23') << 5
        b |= (sw[10] == '2') << 6
        img[0x1F35] = b
        img[0x1F36] = _ds(0x0AAE + 4 * dec) | _ds(0x09CC + 4 * enc + 2)
        img[0x1F37] = _ds(0x0AAF + 4 * dec) | _ds(0x09CC + 4 * enc + 3)
        if hw[1] == '1' or sw[1] < '2':
            img[0x1F37] |= 0x10
        else:
            img[0x1F37] &= 0xEF
        img[0x1F66] = (-(sum(img[0x1F33:0x1F38]))) & 0xFF

    def _scan(self, img, chans):     # FUNC 0x77F7
        fm91 = self.model == 2
        for a in (0x1F4B, 0x1F57, 0x1F40, 0x1F4C):
            img[a] = 0
        if fm91:
            img[0x1F63] = 0
            img[0x1F58] = 0
        n1 = n2 = n3 = 0
        for c in chans:
            if n1 > 10 or n2 > 10 or n3 > 10:
                raise FM900Error('more than 10 channels in a scan block')
            ch = c.num & 0xFF
            if c.flags & F_SCAN1:
                img[0x1F41 + n1] = ch; n1 += 1; img[0x1F4B] += 1
            if c.flags & F_SCAN2:
                img[0x1F4D + n2] = ch; n2 += 1; img[0x1F57] += 1
            if fm91 and c.flags & F_SCAN3:
                img[0x1F59 + n3] = ch; n3 += 1; img[0x1F63] += 1
            if c.flags & F_PRI1:
                img[0x1F40] = ch
            if c.flags & F_PRI2:
                img[0x1F4C] = ch
            if fm91 and c.flags & F_PRI3:
                img[0x1F58] = ch
        if n1 > 10 or n2 > 10 or n3 > 10:
            raise FM900Error('more than 10 channels in a scan block')

    def _power_and_misc(self, img, ch_min, pw_min, pw_max):   # FUNC 0x7285
        sw, hw = self.sw, self.hw
        img[0x1F08:0x1F10] = bytes([0x00, 0x82, 0x00, 0x15, 0x09, 0x32, 0x1A, 0x82])
        if sw[5] == '6':
            img[0x1F0A], img[0x1F0B], img[0x1F0E], img[0x1F0F] = 0x09, 0x82, 0x09, 0x82
            img[0x1F08], img[0x1F09], img[0x1F0C], img[0x1F0D] = 0x00, 0x82, 0x09, 0x32
        if self.model == 2:          # FM91
            img[0x1F31] = ch_min & 0xFF
            return
        # FM92
        img[0x1F31] = ch_min & 0xFF
        img[0x1F58] = 1
        img[0x1F59] = 2
        if sw[6] > '0':
            img[0x1F5A] = 5
        if sw[6] == '0' and sw[1] == '1':
            img[0x1F5A] = 6
        if img[0x1F37] & 0x40 and (int(sw[11:13]) or int(sw[13:15])):
            img[0x1F5A] = 8
        img[0x1F5B] = 7 if int(sw[11:15]) > 0 else 0
        if hw[2] > '4' or sw[5] == '6':
            return
        def setb(a, v):
            img[a] = v
        if pw_min == 1:
            setb(0x1F08, 0); setb(0x1F09, 0x15); setb(0x1F0C, 0); setb(0x1F0D, 0x15)
        if pw_min == 1 and pw_max == 1:
            setb(0x1F08, 0); setb(0x1F09, 0x15); setb(0x1F0C, 0); setb(0x1F0D, 0x15)
            setb(0x1F0A, 0); setb(0x1F0B, 0); setb(0x1F0E, 0); setb(0x1F0F, 0)
        if pw_min == 5:
            setb(0x1F08, 9); setb(0x1F09, 0x32); setb(0x1F0C, 9); setb(0x1F0D, 0x32)
        if pw_max == 5:
            setb(0x1F0A, 9); setb(0x1F0B, 0x32); setb(0x1F0E, 9); setb(0x1F0F, 0x32)
        if pw_max == 5 and pw_min == 5:
            setb(0x1F0A, 0); setb(0x1F0B, 0); setb(0x1F0E, 0); setb(0x1F0F, 0)
            setb(0x1F08, 9); setb(0x1F09, 0x32); setb(0x1F0C, 9); setb(0x1F0D, 0x32)
        if pw_max == 25:
            setb(0x1F0A, 0x1A); setb(0x1F0B, 0x82); setb(0x1F0E, 0x1A); setb(0x1F0F, 0x82)
        if pw_max == 25 and pw_min == 25:
            setb(0x1F0A, 0x1A); setb(0x1F0B, 0x82); setb(0x1F0E, 0x1A); setb(0x1F0F, 0x82)
            setb(0x1F08, 0); setb(0x1F09, 0); setb(0x1F0C, 0); setb(0x1F0D, 0)


def checksum(img):                   # FUNC 0x30A0
    s = 0
    s = (s + img[0x1CC]) & 0xFFFF
    s = (s - img[0x5CC]) & 0xFFFF
    s ^= img[0x9CC]
    s = (s + img[0xDCC]) & 0xFFFF
    s = (s + img[0x11CC]) & 0xFFFF
    s = (s - img[0x15CC]) & 0xFFFF
    s ^= img[0x19CC]
    s = (s + img[0x1ACC]) & 0xFFFF
    img[0x1F65] = (-s) & 0xFF
    img[0x1F64] = 0
    img[0x1F64] = (0xFF - (sum(img) & 0xFF)) & 0xFF


def verify_checksum(img):
    t = bytearray(img)
    checksum(t)
    return t[0x1F64] == img[0x1F64] and t[0x1F65] == img[0x1F65]


# ---------------------------------------------------------------------------
# Channel list (CSV) parser
# ---------------------------------------------------------------------------
COLS = ['ch', 'rx', 'tx', 'power', 'scan', 'ctcss', 'vote', 'econ', 'selcall', 'cr']


def parse_ctcss(v):
    v = v.strip()
    if not v or v.lower() in ('none', 'off', '-', '0.0'):
        return ''
    if len(v) == 1 and v in CTCSS_BY_CODE:
        return v
    try:
        hz = round(float(v), 1)
    except ValueError:
        raise FM900Error('unknown CTCSS %r' % v)
    if hz in CTCSS_BY_HZ:
        return CTCSS_BY_HZ[hz]
    raise FM900Error('CTCSS %s Hz is not in the radio\'s tone table' % v)


def yes(v):
    return v.strip().upper() in ('Y', 'YES', '1', 'TRUE')


def parse_channels(path, default_power='H'):
    """CSV/whitespace channel list.  See README.md for the format."""
    text = open(path).read() if path != '-' else sys.stdin.read()
    rows = []
    header = None
    for line in text.splitlines():
        line = line.split('#', 1)[0].strip()
        if not line:
            continue
        cells = next(csv.reader([line])) if ',' in line else line.split()
        cells = [x.strip() for x in cells]
        if header is None and cells and cells[0].lower() in COLS + ['channel']:
            header = [h.lower().replace('channel', 'ch') for h in cells]
            continue
        rows.append(cells)
    if header is None:
        header = ['rx', 'tx', 'power', 'scan', 'ctcss', 'vote', 'econ', 'selcall', 'cr']
    chans = []
    nextch = 1
    for cells in rows:
        d = dict(zip(header, cells + [''] * (len(header) - len(cells))))
        num = int(d['ch']) if d.get('ch') else nextch
        nextch = num + 1
        rx = norm_freq(d['rx'])
        tx = norm_freq(d['tx']) if d.get('tx') else rx
        flags = 0
        p = (d.get('power') or default_power).upper()
        flags |= {'H': F_HIGH, 'M': F_MED, 'L': F_LOW, 'S': F_SELPWR, '': 0}[p[:1]]
        s = (d.get('scan') or '').upper()
        # FUNC 0x3225 semantics: '1'/'2'/'3' = member of scan block, 'nP' = priority
        # channel of block n, 'S' = operator-selectable scanning.
        for blk, fm, fp in (('1', F_SCAN1, F_PRI1), ('2', F_SCAN2, F_PRI2), ('3', F_SCAN3, F_PRI3)):
            i = s.find(blk)
            while i >= 0:
                if s[i + 1:i + 2] == 'P':
                    flags |= fp
                else:
                    flags |= fm
                i = s.find(blk, i + 1)
        if 'S' in s:
            flags |= F_SCANSEL
        if yes(d.get('vote', '')):
            flags |= F_VOTE
        if yes(d.get('econ', '')):
            flags |= F_ECON
        if yes(d.get('selcall', '')):
            flags |= F_SELCALL
        if yes(d.get('cr', '')):
            flags |= F_CR
        chans.append(Channel(num, rx, tx, flags, parse_ctcss(d.get('ctcss', ''))))
    return chans


# ---------------------------------------------------------------------------
# Image decoder
# ---------------------------------------------------------------------------
def decode_divider(b0, b1, b2):
    digs = [(~(b0)) & 0xF, (~(b0 >> 4)) & 0xF, (~b1) & 0xF, (~(b1 >> 4)) & 0xF, (~b2) & 0x7]
    return digs[0] + 10 * digs[1] + 100 * digs[2] + 1000 * digs[3] + 10000 * digs[4]


def dump(img, hw=None, step=None):
    out = []
    model = None
    if hw:
        model = hw[1]
    else:
        model = '1' if img[0x1FEB:0x1FF0] in (b'0020:', b'01045') else '2'
    base, n = (0x1BE8, 99) if model == '2' else (0x1B40, 120)
    out.append('model FM9%s, version byte 0x1FE5=%d, id "%s", built %02x/%02x/%02x (DD/MM/YY)' % (
        model, img[0x1FE5], img[0x1FEB:0x1FF0].decode('latin1', 'replace'),
        img[0x1FE2], img[0x1FE3], img[0x1FE4]))
    out.append('checksum 0x1F64=%02x 0x1F65=%02x (%s)' % (
        img[0x1F64], img[0x1F65], 'OK' if verify_checksum(img) else 'BAD'))
    out.append('channels %d..%d' % (img[0x1F3F], img[0x1F3E]))
    ifo = None
    if hw:
        b = Builder.__new__(Builder)
        b.hw = hw
        ifo = b.if_offset()
    if hw and not step:
        try:
            step = Builder(hw, '0' * 15, None).pick_step([])
        except FM900Error:
            step = None
    out.append('slot  raw                       rxN    txN   pwr ctcss flags')
    for i in range(n):
        r = img[base + 8 * i: base + 8 * i + 8]
        if not any(r):
            continue
        rxn = decode_divider(r[0], r[1], r[2])
        txn = decode_divider(r[3], r[4], r[5])
        ct = r[6] & 0x3F
        code = next((c for c, v, hz in CTCSS if v == ct), '') if ct else ''
        line = '%3d   %s  %5d  %5d   %d   %-3s  b2=%02x b5=%02x b6=%02x b7=%02x' % (
            i + 1, r.hex(' '), rxn, txn, (r[5] >> 4) & 3, code, r[2] & 0xF8, r[5] & 0xF8,
            r[6] & 0xC0, r[7])
        if step and ifo is not None:
            rxf = (rxn * step - ifo) / 100000.0
            txf = txn * step / 100000.0
            line += '   rx %.4f tx %.4f' % (rxf, txf)
        out.append(line)
    return '\n'.join(out)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def default_masters():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, 'fm900', 'MASTERS')


def parse_date(s):
    if not s:
        return None
    return datetime.datetime.strptime(s, '%Y-%m-%d').date()


def main(argv=None):
    ap = argparse.ArgumentParser(description='Philips FM900 (FM91/FM92) EPROM image builder')
    sub = ap.add_subparsers(dest='cmd', required=True)

    def common(p):
        p.add_argument('--masters', default=default_masters(), help='directory with FM9x.BIN masters')
        p.add_argument('--date', help='build date YYYY-MM-DD stored in the image (default today)')
        p.add_argument('--master-file', help='use this 8 KB master image instead of auto-selecting')
        p.add_argument('-o', '--output', required=True)

    p = sub.add_parser('build', help='build an image from a channel list')
    p.add_argument('channels', help='channel list file (CSV / whitespace), "-" for stdin')
    p.add_argument('--hw', required=True, help='8-digit hardware code, e.g. 92440150')
    p.add_argument('--sw', required=True, help='15-digit software code, e.g. 110100201000000')
    p.add_argument('--power', default='H', help='default power if column omitted (H/M/L)')
    common(p)

    p = sub.add_parser('fromjob', help='build an image from FM900.EXE .JOB/.CHL files')
    p.add_argument('job')
    p.add_argument('chl', nargs='?')
    common(p)

    p = sub.add_parser('writejob', help='write .JOB + .CHL files for FM900.EXE from a channel list')
    p.add_argument('channels')
    p.add_argument('--hw', required=True)
    p.add_argument('--sw', required=True)
    p.add_argument('--comment', action='append', default=[])
    p.add_argument('--power', default='H')
    p.add_argument('-o', '--output', required=True, help='output base name (no extension)')

    p = sub.add_parser('dump', help='decode an image')
    p.add_argument('image')
    p.add_argument('--hw', help='hardware code (enables frequency decoding)')
    p.add_argument('--step', type=float, help='synth step in kHz (with --hw)')

    a = ap.parse_args(argv)
    try:
        if a.cmd == 'dump':
            img = open(a.image, 'rb').read()
            step = int(round(a.step * 100)) if a.step else None
            print(dump(img, a.hw, step))
            return 0
        if a.cmd == 'writejob':
            chans = parse_channels(a.channels, a.power)
            Builder(a.hw, a.sw, None)
            write_job(a.output + '.JOB', a.hw, a.sw, a.comment)
            write_chl(a.output + '.CHL', chans)
            print('wrote %s.JOB and %s.CHL (%d channels)' % (a.output, a.output, len(chans)))
            return 0
        if a.cmd == 'build':
            chans = parse_channels(a.channels, a.power)
            hw, sw = a.hw, a.sw
        else:
            job = read_job(a.job)
            hw, sw = job['hw'], job['sw']
            chl = a.chl or os.path.splitext(a.job)[0] + '.CHL'
            chans = read_chl(chl)
        b = Builder(hw, sw, a.masters, parse_date(a.date))
        master = open(a.master_file, 'rb').read() if a.master_file else None
        img = b.build(chans, master)
        for w in b.vco_warnings(chans):
            print('WARNING: %s! Radio may not operate correctly.' % w, file=sys.stderr)
        if sw[11:15] != '0000':
            print('NOTE: selcall codes in SW code; FM900.EXE would continue in its selcall '
                  'editor - selcall tones are left at their defaults.', file=sys.stderr)
        open(a.output, 'wb').write(img)
        i = b.info
        print('wrote %s: master %s, %d channels (%d..%d), step %.2f kHz, IF %+.1f MHz' % (
            a.output, i['master'] or a.master_file, len(chans), i['ch_min'], i['ch_max'],
            i['step_khz'], i['if_mhz']))
        return 0
    except FM900Error as e:
        print('error: %s' % e, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

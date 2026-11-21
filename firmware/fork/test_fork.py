"""Tests for the FM92R fork tool chain.   cd firmware/fork && python3 -m unittest test_fork"""
import datetime, os, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
import asm6805, build, fm900gen, mkradio, sim6805  # noqa: E402
from op6805 import DEC, SIZE  # noqa: E402

JOBS = os.path.join(ROOT, 'fm900', 'JOBS')


def asm(text, **defs):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 't.asm')
        open(p, 'w').write(text)
        a = asm6805.Assembler(defs)
        return a.assemble(p), a


class Encodings(unittest.TestCase):
    def test_every_opcode_round_trips(self):
        """Each defined opcode, written the way mkasm.py writes it, assembles to itself."""
        for op, (m, mode) in sorted(DEC.items()):
            base = m[:-1] if mode in ('bsc', 'btb') else m
            n = int(m[-1]) if mode in ('bsc', 'btb') else 0
            opnd = {'inh': '', 'imm': '#$5a', 'dir': '$5a', 'ext': '$1234', 'ix': ',x',
                    'ix1': '$5a,x', 'ix2': '$1234,x', 'rel': '*+2+$10', 'bsc': '%d,$5a' % n,
                    'btb': '%d,$5a,*+3-$10' % n}[mode]
            want = {'inh': [op], 'imm': [op, 0x5A], 'dir': [op, 0x5A], 'ext': [op, 0x12, 0x34],
                    'ix': [op], 'ix1': [op, 0x5A], 'ix2': [op, 0x12, 0x34], 'rel': [op, 0x10],
                    'bsc': [op, 0x5A], 'btb': [op, 0x5A, 0xF0]}[mode]
            img, _ = asm('  .org $200\n  %s %s\n' % (base, opnd))
            self.assertEqual(list(img[0x200:0x200 + SIZE[mode]]), want, '%02x %s %s' % (op, base, opnd))

    def test_bset_bclr_follow_the_manual(self):
        img, _ = asm('  .org $200\n  bset 5,$04\n  bclr 5,$04\n')
        self.assertEqual(bytes(img[0x200:0x204]), bytes([0x1A, 0x04, 0x1B, 0x04]))

    def test_forced_extended_and_forward_reference(self):
        img, _ = asm('  .org $200\n  lda >$20\n  lda <$20\n  jsr later\nlater: rts\n')
        self.assertEqual(bytes(img[0x200:0x208]), bytes.fromhex('c60020b620cd0208'))
        with self.assertRaises(asm6805.AsmError):
            asm('  .org $200\n  lda fwd\nfwd = $20\n')   # forward ref that is < $100

    def test_pins_and_overlap(self):
        asm('  .org $200\n  nop\n  .at $201\n')
        with self.assertRaises(asm6805.AsmError):
            asm('  .org $200\n  nop\n  nop\n  .at $201\n')
        with self.assertRaises(asm6805.AsmError):
            asm('  .org $200\n  nop\n  .org $100\n')
        with self.assertRaises(asm6805.AsmError):
            asm('  .org $200\n  bra far\n  .org $300\nfar: rts\n')

    def test_conditionals(self):
        src = '  .org $200\n  .if FORK\n  db 1\n  .else\n  db 2\n  .endif\n'
        self.assertEqual(asm(src, FORK=1)[0][0x200], 1)
        self.assertEqual(asm(src, FORK=0)[0][0x200], 2)


class Fork(unittest.TestCase):
    def test_stock_source_is_the_master(self):
        img, a = build.assemble(False)
        self.assertEqual(bytes(img), open(build.MASTER, 'rb').read())

    def test_fork_builds_and_is_self_consistent(self):
        with tempfile.TemporaryDirectory() as d:
            out = build.build(d, quiet=True)
            img = open(out, 'rb').read()
        self.assertEqual(len(img), 0x2000)
        self.assertTrue(fm900gen.verify_checksum(img))
        # the hidden page and the vectors are untouched
        m = open(build.MASTER, 'rb').read()
        self.assertEqual(img[:0x100], m[:0x100])
        self.assertEqual(img[0x1FF0:], m[0x1FF0:])

    def test_reference_jobs_through_the_stock_build(self):
        """fromjob --master-file <stock build> reproduces the FM92R reference images."""
        with tempfile.TemporaryDirectory() as d:
            stock = os.path.join(d, 'stock.bin')
            open(stock, 'wb').write(bytes(build.assemble(False)[0]))
            for j in ('2MHAM', 'SH', 'SHC'):
                ref = open(os.path.join(JOBS, j, j + '.BIN'), 'rb').read()
                self.assertEqual(ref[0x1FEB:0x1FF0], b'0029:', j)       # FM92R master
                date = datetime.date(2000 + int('%02x' % ref[0x1FE4]), int('%02x' % ref[0x1FE3]),
                                     int('%02x' % ref[0x1FE2]))
                out = os.path.join(d, j + '.bin')
                rc = fm900gen.main(['fromjob', os.path.join(JOBS, j, j + '.JOB'), '--date',
                                    date.isoformat(), '--master-file', stock, '-o', out])
                self.assertEqual(rc, 0)
                self.assertEqual(open(out, 'rb').read(), ref, j)



# ---------------------------------------------------------------- Rx frequency display
CSV_2M = """ch,rx,tx,power
1,147.000,147.600,H
3,147.450,147.450,H
12,146.000,146.600,H
"""


def fork_radio(d, csv=CSV_2M, hw='92440150', sw='110100201000000'):
    master = build.build(d, quiet=True)
    p = os.path.join(d, 'ch.csv')
    open(p, 'w').write(csv)
    out = os.path.join(d, 'radio.bin')
    rc = mkradio.main(['build', p, '--hw', hw, '--sw', sw, '--master', master, '--date', '2026-11-21',
                       '-o', out])
    assert rc == 0
    return open(out, 'rb').read()


class FreqEncoding(unittest.TestCase):
    def w(self, mhz):
        return mkradio.windows(mkradio.freq_nibbles(int(round(mhz * 10000))))

    def test_users_example(self):
        self.assertEqual(self.w(147.450), ['14', '47', '7 ', ' 4', '45', '50'])

    def test_four_decimals_and_short(self):
        self.assertEqual(self.w(477.0125), ['47', '77', '7 ', ' 0', '01', '12', '25'])
        self.assertEqual(self.w(77.5), ['77', '7 ', ' 5', '50', '00'])
        self.assertEqual(self.w(146.0), ['14', '46', '6 ', ' 0', '00', '00'])


class FreqTable(unittest.TestCase):
    def test_reference_jobs(self):
        """Every table entry is the job's Rx frequency; nothing else differs from fm900gen."""
        with tempfile.TemporaryDirectory() as d:
            master = build.build(d, quiet=True)
            for j in ('2MHAM', 'SH', 'SHC', '477'):     # 477 = UHF (12.5/25 kHz step, other IF sign)
                job = os.path.join(JOBS, j, j + '.JOB')
                a, b = os.path.join(d, 'a.bin'), os.path.join(d, 'b.bin')
                self.assertEqual(mkradio.main(['fromjob', job, '--master', master, '--date', '2026-11-21', '-o', a]), 0)
                self.assertEqual(fm900gen.main(['fromjob', job, '--master-file', master, '--date', '2026-11-21', '-o', b]), 0)
                ia, ib = open(a, 'rb').read(), open(b, 'rb').read()
                self.assertTrue(fm900gen.verify_checksum(ia))
                tab = range(mkradio.FQ0, mkradio.FQ0 + 400)
                diff = [i for i in range(0x2000) if ia[i] != ib[i] and i not in tab and i not in (0x1F64, 0x1F65)]
                self.assertEqual(diff, [], j)
                for c in fm900gen.read_chl(os.path.splitext(job)[0] + '.CHL'):
                    if c.flags & fm900gen.F_VOTE:
                        continue
                    want = mkradio.freq_nibbles(fm900gen.freq_units(c.rx))
                    got = mkradio.entry_nibbles(mkradio.table_entry(ia, c.num))
                    self.assertEqual(got, want, '%s ch %d' % (j, c.num))

    def test_refuses_other_masters(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(AssertionError):
                fork_radio(d, hw='92430150')       # digit 4 = 3: FM92L


class Intro(unittest.TestCase):
    """The start-up "00" and Morse ident, run in the simulator with a soft timer."""

    def run_intro(self, callsign, variant='enhanced'):
        with tempfile.TemporaryDirectory() as d:
            build.build(d, quiet=True)
            p = os.path.join(d, 'ch.csv')
            with open(p, 'w') as f:
                f.write(CSV_2M)
            out = os.path.join(d, 'radio.bin')
            master = os.path.join(d, {'enhanced': 'FM92R-fork.BIN', 'intro': 'FM92R-intro.BIN'}[variant])
            self.assertEqual(mkradio.main(['build', p, '--hw', '92440150', '--sw', '110100201000000',
                                           '--master', master, '--callsign', callsign, '-o', out]), 0)
            with open(out, 'rb') as f:
                img = f.read()
        flags = build.VARIANTS['FM92R-fork' if variant == 'enhanced' else 'FM92R-intro']
        sym = build.assemble(flags)[1].syms
        c = sim6805.CPU(img)
        sent, tone, t = [], [], [0, 0]   # tone: (tick, on) at each change; t = [steps, ticks]

        def on_step(cpu):
            t[0] += 1
            if t[0] % 25 == 0:             # one 27 ms soft-timer tick every 25 instructions
                t[1] += 1
                for a in (0x57, 0x58):
                    cpu.mem[a] = (cpu.mem[a] - 1) & 0xFF
            on = cpu.mem[0x29] >> 7
            if not tone or tone[-1][1] != on:
                tone.append((t[1], on))
        c.on_step = on_step
        c.stub(sym['head_send'], lambda cpu: sent.append(cpu.a))
        c.call(sym['fork_init'], max_steps=10 ** 6)
        return sent, tone, t[1]

    def morse_from(self, tone):
        """Tone changes -> Morse text, in units of 3 ticks."""
        units = [(round((b[0] - a[0]) / 3), a[1]) for a, b in zip(tone, tone[1:])]
        rev = {v: k for k, v in mkradio.MORSE.items()}
        text, letter = '', ''
        for n, on in units:
            if on:
                letter += '.' if n == 1 else '-'
            elif n >= 3:
                text += rev[letter] + (' ' if n >= 7 else ''); letter = ''
        return text + (rev[letter] if letter else ''), units

    def test_vk2fn(self):
        for variant in ('enhanced', 'intro'):
            sent, tone, ticks = self.run_intro('VK2FN', variant)
            self.assertEqual(sent, [0xAA, 0x80, 0x30, 0x82, 0x30], variant)   # start-up, then "00"
            text, units = self.morse_from(tone)
            self.assertEqual(text, 'VK2FN', variant)
            self.assertTrue(all(n in (1, 3) for n, _ in units), units)
            self.assertEqual(tone[-1][1], 0)                                     # tone off at the end
            self.assertAlmostEqual(ticks / 3, 59 + 3 + 6, delta=2)              # 59 units + last letter gap + pause

    def test_word_space(self):
        text, units = self.morse_from(self.run_intro('DE VK2FN')[1])
        self.assertEqual(text, 'DE VK2FN')
        self.assertIn((7, 0), units)

    def test_no_callsign(self):
        sent, tone, ticks = self.run_intro('')
        self.assertEqual(sent, [0xAA, 0x80, 0x30, 0x82, 0x30])
        self.assertEqual([on for _, on in tone], [0])                           # never on
        self.assertAlmostEqual(ticks / 3, 12, delta=1)                          # "00" for 1 s

    def test_morse_encoding(self):
        self.assertEqual(mkradio.morse_bytes('VK2FN').hex(), '0101010380030103800101030303800101030180030180' + '00')
        with self.assertRaises(ValueError):
            mkradio.morse_bytes('VK2#')
        with self.assertRaises(ValueError):
            mkradio.morse_bytes('VK2FN ' * 3)


class Startup(unittest.TestCase):
    """Warm start (switch-on) to the main loop: what each image sends to the head."""

    def boot(self, img, ch):
        sym = build.assemble(build.VARIANTS['FM92R-fork'])[1].syms   # original routines are at the same address in all
        c = sim6805.CPU(img)
        c.mem[0x2E] = ch
        c.mem[0x20] = 0x99
        sent, n = [], [0]

        def on_step(cpu):                    # stand-in for the timer interrupt
            n[0] += 1
            if n[0] % 10 == 0:
                cpu.mem[0x28] = (cpu.mem[0x28] + 1) & 0xFF     # tick counter (wait_startup)
                cpu.mem[0x13] &= ~0x02                         # uart_bit acks tx_stop's handshake
                if n[0] % 250 == 0:
                    for a in (0x57, 0x58, 0x5E, 0x61):
                        cpu.mem[a] = (cpu.mem[a] - 1) & 0xFF
        c.on_step = on_step
        c.stub(sym['head_send'], lambda cpu: sent.append(cpu.a))

        class Done(Exception):
            pass

        def at_main(cpu):
            raise Done
        c.stub(sym['main_loop'], at_main)
        c.pc = sym['warm_start']
        with self.assertRaises(Done):
            for _ in range(3 * 10 ** 6):
                c.step()
        self.assertTrue(c.mem[0x11] & 0x04)                    # head config due on the first main-loop pass
        return sent

    def images(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'ch.csv')
            with open(p, 'w') as f:
                f.write(CSV_2M)
            build.build(d, quiet=True)
            out = {}
            args = ['--hw', '92440150', '--sw', '110100201000000', '--date', '2026-11-21']
            fm900gen.main(['build', p] + args + ['-o', os.path.join(d, 'factory.bin')])
            for v, m in (('intro', 'FM92R-intro.BIN'), ('enhanced', 'FM92R-fork.BIN')):
                mkradio.main(['build', p] + args + ['--master', os.path.join(d, m), '--callsign', 'E',
                                                    '-o', os.path.join(d, v + '.bin')])
            for k in ('factory', 'intro', 'enhanced'):
                with open(os.path.join(d, k + '.bin'), 'rb') as f:
                    out[k] = f.read()
            return out

    def test_switch_on_messages(self):
        im = self.images()
        ch3 = [0xA0, 0x80, ord('3'), 0x82, ord(' ')]
        self.assertEqual(self.boot(im['factory'], 3), [0xAA] + ch3)
        self.assertEqual(self.boot(im['factory'], 12), [0xAA, 0xA0, 0x80, ord('2'), 0x82, ord('1')])
        # the current channel isn't programmed: no digits at all, the head keeps what it showed
        self.assertEqual(self.boot(im['factory'], 5), [0xAA, 0xA0])
        for k in ('intro', 'enhanced'):
            self.assertEqual(self.boot(im[k], 3), [0xAA, 0x80, ord('0'), 0x82, ord('0')] + ch3, k)
            self.assertEqual(self.boot(im[k], 5), [0xAA, 0x80, ord('0'), 0x82, ord('0'), 0xA0], k)


class FreqFirmware(unittest.TestCase):
    """Run the fork's display code in the 6805 simulator."""

    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as d:
            cls.img = fork_radio(d)
        cls.sym = build.assemble(True)[1].syms

    def cpu(self, ch):
        c = sim6805.CPU(self.img)
        self.sent = []
        c.stub(self.sym['head_send'], lambda cpu: self.sent.append(cpu.a))
        c.mem[0x2E] = ch
        return c

    def shown(self):
        """Decode the head messages sent since the last call: '$82 left, $80 right' pairs."""
        s, self.sent = self.sent, []
        if not s:
            return None
        self.assertEqual(len(s), 4)
        d = dict(zip(s[0::2], s[1::2]))
        return chr(d[0x82]) + chr(d[0x80])

    def task(self, c, expire=True):
        if expire:
            c.mem[0x57] = 0xFF
        c.call(self.sym['fq_task'])
        return self.shown()

    def test_cycle(self):
        c = self.cpu(3)
        c.call(self.sym['show_channel'])
        self.assertEqual(self.shown(), ' 3')
        self.assertEqual(c.mem[0x57], 74)                   # 2 s
        self.assertIsNone(self.task(c, expire=False))      # not yet
        seq = [self.task(c) for _ in range(7)]
        self.assertEqual(seq, ['14', '47', '7 ', ' 4', '45', '50', ' 3'])
        self.assertEqual(c.mem[0x57], 74)                   # channel again for 2 s
        self.assertEqual(self.task(c), '14')                # and round again
        self.assertEqual(c.mem[0x57], 18)                   # 0.5 s

    def test_two_digit_channel(self):
        c = self.cpu(12)
        c.call(self.sym['show_channel'])
        self.assertEqual(self.shown(), '12')
        self.assertEqual([self.task(c) for _ in range(7)], ['14', '46', '6 ', ' 0', '00', '00', '12'])

    def test_waits_for_keepalive_and_uart(self):
        c = self.cpu(3)
        c.call(self.sym['show_channel']); self.shown()
        c.mem[0x1C] |= 0x20                                 # $E4 sent, waiting for $49
        self.assertIsNone(self.task(c))
        c.mem[0x1C] &= ~0x20
        c.mem[0x1A] |= 0x02                                 # UART FIFO not empty
        self.assertIsNone(self.task(c, expire=False))
        c.mem[0x1A] &= ~0x02
        self.assertEqual(self.task(c, expire=False), '14')  # timer still expired: goes now

    def test_transmit_shows_channel(self):
        c = self.cpu(3)
        c.call(self.sym['show_channel']); self.shown()
        self.task(c); self.task(c)                          # showing "47"
        c.mem[0x11] |= 0x01                                 # transmitting
        self.assertEqual(self.task(c), ' 3')
        self.assertIsNone(self.task(c))                     # held
        self.assertEqual(c.mem[0x57], 74)
        c.mem[0x11] &= ~0x01
        self.assertIsNone(self.task(c, expire=False))
        self.assertEqual(self.task(c), '14')

    def test_other_display_stops_it(self):
        c = self.cpu(3)
        c.call(self.sym['show_channel']); self.shown()
        c.a = 0x55
        c.call(self.sym['display_digits']); self.shown()    # e.g. selcall digits
        self.assertIsNone(self.task(c))
        c.call(self.sym['show_channel']); self.shown()
        c.call(self.sym['head_display_off']); self.sent = []
        self.assertIsNone(self.task(c))

    def test_scan_display_mode_and_empty_channel(self):
        c = self.cpu(3)
        c.mem[0x1E] |= 0x02                                 # $81/$83 (scan) display mode
        c.call(self.sym['show_channel']); self.sent = []
        self.assertIsNone(self.task(c))
        c = self.cpu(5)                                     # no such channel
        c.call(self.sym['show_channel']); self.shown()
        self.assertIsNone(self.task(c))

    def test_hooks_keep_stock_output(self):
        """show_channel / display_digits send the same bytes as the factory firmware."""
        stock = open(build.MASTER, 'rb').read()
        for ch in (1, 3, 12, 99):
            for flags in (0, 0x02):
                out = []
                for img in (stock, self.img):
                    c = sim6805.CPU(img)
                    got = []
                    c.stub(self.sym['head_send'], lambda cpu, g=got: g.append(cpu.a))
                    c.mem[0x2E] = ch; c.mem[0x1E] = flags
                    c.call(self.sym['show_channel'])
                    out.append(got)
                self.assertEqual(out[0], out[1], (ch, flags))


if __name__ == '__main__':
    unittest.main()

"""Tests for the FM92R fork tool chain.   cd firmware/fork && python3 -m unittest test_fork"""
import datetime, os, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
import asm6805, build, fm900gen  # noqa: E402
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


if __name__ == '__main__':
    unittest.main()

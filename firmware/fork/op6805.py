"""MC146805E2 (6805) opcode table, shared by asm6805.py and mkasm.py.

Encodings follow the Motorola M6805 family manual. Note BSET n = $10+2n and
BCLR n = $11+2n (Capstone 5.0.x prints these the wrong way round; this table
does not use Capstone).

Modes:
  inh  inherent                     1 byte
  imm  #ii                          2
  dir  $dd                          2
  ext  $hhll                        3
  ix   ,x                           1
  ix1  $dd,x                        2
  ix2  $hhll,x                      3
  rel  branch target                2
  bsc  n,$dd        (BSET/BCLR)     2
  btb  n,$dd,target (BRSET/BRCLR)   3
"""

SIZE = {'inh': 1, 'imm': 2, 'dir': 2, 'ext': 3, 'ix': 1, 'ix1': 2, 'ix2': 3,
        'rel': 2, 'bsc': 2, 'btb': 3}

# (mnemonic, mode) -> opcode
ENC = {}
# opcode -> (mnemonic, mode)
DEC = {}


def _add(m, mode, op):
    ENC[(m, mode)] = op
    DEC[op] = (m, mode)


for n in range(8):
    _add('brset%d' % n, 'btb', 0x00 + 2 * n)
    _add('brclr%d' % n, 'btb', 0x01 + 2 * n)
    _add('bset%d' % n, 'bsc', 0x10 + 2 * n)
    _add('bclr%d' % n, 'bsc', 0x11 + 2 * n)

for i, m in enumerate(['bra', 'brn', 'bhi', 'bls', 'bcc', 'bcs', 'bne', 'beq',
                       'bhcc', 'bhcs', 'bpl', 'bmi', 'bmc', 'bms', 'bil', 'bih']):
    _add(m, 'rel', 0x20 + i)
_add('bsr', 'rel', 0xAD)

# read-modify-write group: $3x dir, $4x A, $5x X, $6x ix1, $7x ix
for lo, m in {0x0: 'neg', 0x3: 'com', 0x4: 'lsr', 0x6: 'ror', 0x7: 'asr',
              0x8: 'lsl', 0x9: 'rol', 0xA: 'dec', 0xC: 'inc', 0xD: 'tst',
              0xF: 'clr'}.items():
    _add(m, 'dir', 0x30 + lo)
    _add(m + 'a', 'inh', 0x40 + lo)
    _add(m + 'x', 'inh', 0x50 + lo)
    _add(m, 'ix1', 0x60 + lo)
    _add(m, 'ix', 0x70 + lo)

for m, op in {'rti': 0x80, 'rts': 0x81, 'swi': 0x83, 'stop': 0x8E, 'wait': 0x8F,
              'tax': 0x97, 'clc': 0x98, 'sec': 0x99, 'cli': 0x9A, 'sei': 0x9B,
              'rsp': 0x9C, 'nop': 0x9D, 'txa': 0x9F}.items():
    _add(m, 'inh', op)

# register/memory group: $Ax imm, $Bx dir, $Cx ext, $Dx ix2, $Ex ix1, $Fx ix
for lo, m in enumerate(['sub', 'cmp', 'sbc', 'cpx', 'and', 'bit', 'lda', 'sta',
                        'eor', 'adc', 'ora', 'add', 'jmp', 'jsr', 'ldx', 'stx']):
    for hi, mode in ((0xA, 'imm'), (0xB, 'dir'), (0xC, 'ext'), (0xD, 'ix2'),
                     (0xE, 'ix1'), (0xF, 'ix')):
        if mode == 'imm' and m in ('sta', 'jmp', 'jsr', 'stx'):
            continue          # $A7/$AC/$AE.. : $AD is BSR, the others are illegal
        _add(m, mode, hi << 4 | lo)

# accepted alternative spellings -> canonical
ALIAS = {'bhs': 'bcc', 'blo': 'bcs', 'asl': 'lsl', 'asla': 'lsla', 'aslx': 'lslx'}

MNEMONICS = {m for m, _ in ENC}
for n in range(8):
    for b in ('brset', 'brclr', 'bset', 'bclr'):
        MNEMONICS.add(b)          # also written as "bset n,addr"

# control-flow classes (used by the code walker in mkasm.py)
ENDS = {'rts', 'rti', 'jmp', 'bra', 'swi', 'stop', 'wait'}

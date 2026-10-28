#!/usr/bin/env python3
"""Generate differential test vectors from the reference fm900gen.py.

Writes JSON to stdout: a list of {hw, sw, date, keys, chans, sha256 | error, warnings}.
test/vectors.test.ts rebuilds each case with the TypeScript port and compares.
Run via `npm run vectors`.
"""
import datetime, hashlib, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, ROOT)
import fm900gen as g  # noqa: E402

BANDS = {'2': (66, 88), '3': (132, 153), '4': (148, 174), '5': (403, 440),
         '6': (440, 470), '7': (470, 500), '8': (500, 520)}
rnd = random.Random(900)


def fmt(units100):              # 100 Hz units -> 'MHz.dddd'
    return '%d.%04d' % (units100 // 10000, units100 % 10000)


def rand_freq(band, raster100):
    lo, hi = BANDS[band]
    r = rnd.random()
    if r < 0.35:
        # near a whole MHz: exercises the VCO band-switch bit edges (FUNC 0x5FE7)
        mhz = rnd.randint(lo + 1, hi - 1)
        off = rnd.choice([-400, -300, -150, 0, 150, 300, 400, -401, -399, -301, -299, 151, 149, 299, 301])
        if rnd.random() < 0.03:
            off += rnd.choice([-1, 1])      # off-raster: must fail in both
        elif off % raster100:
            off = off // raster100 * raster100
        return fmt(mhz * 10000 + off)
    n = rnd.randint(lo * 10000 // raster100, hi * 10000 // raster100)
    return fmt(n * raster100)


def make_case():
    model = rnd.choice('1222')
    band = rnd.choice('2345678')
    ctl = rnd.choice('3478')
    hw = '9' + model + band + ctl + rnd.choice('00015') + rnd.choice('0012345678') + \
        rnd.choice('0123456789') + rnd.choice('00134')
    sw = ''.join([rnd.choice('0123'), rnd.choice('0123'), rnd.choice('0123'), rnd.choice('01234'),
                  rnd.choice('01'), rnd.choice('01234670'), rnd.choice('0123'), rnd.choice('01'),
                  rnd.choice('01234567'), rnd.choice('012345'), rnd.choice('012')])
    sw += rnd.choice(['0000', '0000', '%02d%02d' % (rnd.randint(0, 99), rnd.randint(0, 99))])
    vhf = band <= '4'
    if vhf:
        raster = rnd.choice([50, 62.5, 125, 250]) if ctl in '78' else rnd.choice([50, 125, 250, 62.5])
    else:
        raster = 250 if ctl in '34' else rnd.choice([125, 250])
    nmax = 99 if model == '2' else 120
    nch = rnd.choice([1, 2, 5, 10, 20, 40, rnd.randint(1, nmax)])
    chans = []
    nums = list(range(1, nmax + 1))
    rnd.shuffle(nums)
    for i in range(nch):
        if raster == 62.5:
            # 6.25 kHz raster: must be a multiple of 125 in 100 Hz units to have 4 decimals
            rx = fmt(rnd.randint(BANDS[band][0] * 80, BANDS[band][1] * 80) * 125)
        else:
            rx = rand_freq(band, int(raster))
        t = rnd.random()
        tx = 'XXXXXXXX' if t < 0.08 else rx if t < 0.6 else rand_freq(band, int(raster if raster != 62.5 else 125))
        num = nums[i % len(nums)] if rnd.random() > 0.1 else rnd.randint(0 if rnd.random() < 0.05 else 1, nmax + (1 if rnd.random() < 0.05 else 0))
        flags = rnd.choice([g.F_HIGH, g.F_HIGH, g.F_MED, g.F_LOW, g.F_SELPWR, 0, g.F_HIGH | g.F_LOW])
        for f, p in ((g.F_VOTE, .08), (g.F_ECON, .2), (g.F_SELCALL, .1), (g.F_CR, .1), (g.F_SCANSEL, .1),
                     (g.F_SCAN1, .2), (g.F_SCAN2, .15), (g.F_SCAN3, .1),
                     (g.F_PRI1, .03), (g.F_PRI2, .03), (g.F_PRI3, .03)):
            if rnd.random() < p:
                flags |= f
        ct = rnd.choice([''] * 4 + [c for c, v, hz in g.CTCSS] + ['W?'])
        chans.append(dict(num=num, rx=rx, tx=tx, flags=flags, ctcss=ct))
    keys = rnd.choice([None, None, None, [rnd.randint(0, 8) for _ in range(4)]]) if model == '2' or rnd.random() < 0.05 else None
    date = '%04d-%02d-%02d' % (rnd.randint(1988, 2049), rnd.randint(1, 12), rnd.randint(1, 28))
    return dict(hw=hw, sw=sw, date=date, keys=keys, chans=chans)


def run(case):
    out = dict(case)
    try:
        b = g.Builder(case['hw'], case['sw'], os.path.join(ROOT, 'fm900', 'MASTERS'),
                      datetime.date.fromisoformat(case['date']), keys=case['keys'])
        chans = [g.Channel(**c) for c in case['chans']]
        img = b.build(chans)
        out['sha256'] = hashlib.sha256(img).hexdigest()
        out['warnings'] = b.vco_warnings(chans)
    except g.FM900Error as e:
        out['error'] = str(e)
    except (ValueError, IndexError, KeyError) as e:   # Python crashes count as errors too
        out['error'] = 'python %s: %s' % (type(e).__name__, e)
    return out


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    cases = [run(make_case()) for _ in range(n)]
    ok = sum('sha256' in c for c in cases)
    print('%d cases, %d built, %d errors' % (n, ok, n - ok), file=sys.stderr)
    json.dump(cases, sys.stdout, separators=(',', ':'))


if __name__ == '__main__':
    main()

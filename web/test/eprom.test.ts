// Larger EPROMs: the 8 KB image mirrored into every bank, and read back from any bank.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readImage } from '../src/core/decode';
import { EPROMS, eprom, expandImage, splitBanks } from '../src/core/eprom';
import { readJob } from '../src/core/fm900';

const JOBS = join(__dirname, '..', '..', 'fm900', 'JOBS');
const ref = new Uint8Array(readFileSync(join(JOBS, '2MHAM/2MHAM.BIN')));
const hw = readJob(readFileSync(join(JOBS, '2MHAM/2MHAM.JOB'))).hw;

describe('EPROM sizes', () => {
  it('2764 is the default and leaves the image unchanged', () => {
    expect(eprom(undefined).part).toBe('2764');
    expect(eprom('bogus').part).toBe('2764');
    expect(Buffer.from(expandImage(ref, '2764')).equals(Buffer.from(ref))).toBe(true);
  });

  for (const e of EPROMS) {
    it(`${e.part}: ${e.size} bytes, every bank is the 8 KB image, reads back`, () => {
      const big = expandImage(ref, e.part);
      expect(big.length).toBe(e.size);
      for (let o = 0; o < e.size; o += 0x2000) expect(Buffer.from(big.subarray(o, o + 0x2000)).equals(Buffer.from(ref))).toBe(true);
      const s = splitBanks(big)!;
      expect(s.part.part).toBe(e.part);
      expect(s.mirrored).toBe(true);
      expect(readImage(s.banks[0], hw).channels).toEqual(readImage(ref, hw).channels);
    });
  }

  it('detects banks that differ', () => {
    const big = expandImage(ref, '27256');
    big[0x2000 * 3 + 0x1F00] ^= 0xFF;
    const s = splitBanks(big)!;
    expect(s.mirrored).toBe(false);
    expect(s.banks).toHaveLength(4);
    expect(Buffer.from(s.banks[0]).equals(Buffer.from(ref))).toBe(true);
  });

  it('rejects sizes that match no part', () => {
    expect(splitBanks(new Uint8Array(12345))).toBeNull();
    expect(() => expandImage(new Uint8Array(100), '27128')).toThrow();
  });
});

// Reading a reference .BIN back into channels and rebuilding it must give the same bytes
// (none of the sample jobs has duplicate or VOTE channels, so read-back is exact for them).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatChannels, parseChannels } from '../src/core/channels';
import { readImage } from '../src/core/decode';
import { Builder, readJob } from '../src/core/fm900';
import { master } from '../src/core/masters';

const JOBS = join(__dirname, '..', '..', 'fm900', 'JOBS');
const bcd = (b: number) => parseInt(b.toString(16), 10);

describe('read-back', () => {
  for (const path of ['2MHAM/2MHAM', 'SH/SH', 'SHC/SHC', '80CHCB', '477/477']) {
    it(`${path} rebuilds identically from its decoded channels`, () => {
      const job = readJob(readFileSync(join(JOBS, path + '.JOB')));
      const ref = new Uint8Array(readFileSync(join(JOBS, path + '.BIN')));
      const rb = readImage(ref, job.hw);
      expect(rb.warnings).toEqual([]);
      // also round-trip through the CSV text format
      const chans = parseChannels(formatChannels(rb.channels));
      const yy = bcd(ref[0x1FE4]);
      const date = new Date(yy < 50 ? 2000 + yy : 1900 + yy, bcd(ref[0x1FE3]) - 1, bcd(ref[0x1FE2]));
      const img = new Builder(job.hw, job.sw, { date, version: [ref[0x1FE0], ref[0x1FE1]], masters: master }).build(chans);
      expect(Buffer.from(img).equals(Buffer.from(ref))).toBe(true);
    });
  }
});

// The five FM900.EXE sample jobs must rebuild byte-for-byte (see ../../CLAUDE.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Builder, F_SCAN1, readChl, readJob } from '../src/core/fm900';
import { master } from '../src/core/masters';
import { fromProject, toProject } from '../src/core/project';

const JOBS = join(__dirname, '..', '..', 'fm900', 'JOBS');
const bcd = (b: number) => parseInt(b.toString(16), 10);

const cases: [string, string][] = [
  ['2MHAM', '2MHAM/2MHAM'], ['SH', 'SH/SH'], ['SHC', 'SHC/SHC'], ['80CHCB', '80CHCB'], ['477', '477/477'],
];

function load(name: string, path: string) {
  const job = readJob(readFileSync(join(JOBS, path + '.JOB')));
  let chans = readChl(readFileSync(join(JOBS, path + '.CHL')));
  const ref = new Uint8Array(readFileSync(join(JOBS, path + '.BIN')));
  if (name === '477') {
    // the .CHL was edited after its .BIN was made
    chans = chans.slice(0, 20);
    for (const c of chans) if (c.num === 11) c.flags &= ~F_SCAN1;
  }
  const yy = bcd(ref[0x1FE4]);
  const date = new Date(yy < 50 ? 2000 + yy : 1900 + yy, bcd(ref[0x1FE3]) - 1, bcd(ref[0x1FE2]));
  return { job, chans, ref, date, version: [ref[0x1FE0], ref[0x1FE1]] as [number, number] };
}

describe('golden sample jobs', () => {
  for (const [name, path] of cases) {
    it(`${name} is byte-identical`, () => {
      const { job, chans, ref, date, version } = load(name, path);
      const img = new Builder(job.hw, job.sw, { date, version, masters: master }).build(chans);
      expect(Buffer.from(img).equals(Buffer.from(ref))).toBe(true);
    });

    it(`${name} survives the UI project round trip`, () => {
      const { job, chans, ref, date, version } = load(name, path);
      const p = toProject(job.hw, job.sw, chans);
      const back = fromProject(p);
      const img = new Builder(p.hw, p.sw, { date, version, masters: master }).build(back);
      expect(Buffer.from(img).equals(Buffer.from(ref))).toBe(true);
    });
  }
});

describe('FM92 key override', () => {
  it('blocks an FM91 build until it is cleared', async () => {
    const { analyze } = await import('../src/core/analyze');
    const { newProject } = await import('../src/core/project');
    const p = { ...newProject(), hw: '92440150', keys: [1, 2, 5, 6],
      rows: [{ num: '1', rx: '147.0000', tx: '', flags: 1, ctcss: '' }] };
    expect(analyze(p).img).not.toBeNull();
    expect(analyze({ ...p, hw: '91440150' }).codeError).toMatch(/FM92/);
    expect(analyze({ ...p, hw: '91440150', keys: null }).img).not.toBeNull();
  });
});

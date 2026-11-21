// Enhanced FM92R firmware: the TS frequency table matches firmware/fork/mkradio.py byte for byte,
// and the project / read-back plumbing.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { readImage } from '../src/core/decode';
import { readChl, readJob, verifyChecksum } from '../src/core/fm900';
import { FQ0, entryNibbles, freqNibbles, isForkImage, tableEntry, windows } from '../src/core/fork';
import { forkMaster, master } from '../src/core/masters';
import { toProject } from '../src/core/project';

const ROOT = join(__dirname, '..', '..');
const JOBS = join(ROOT, 'fm900', 'JOBS');
const DATE = '2026-11-21';

let python = true;
try { execFileSync('python3', ['--version']); } catch { python = false; }

function project(job: string, firmware?: 'enhanced') {
  const j = readJob(readFileSync(join(JOBS, job, job + '.JOB')));
  const p = toProject(j.hw, j.sw, readChl(readFileSync(join(JOBS, job, job + '.CHL'))), job, j.comments);
  return { ...p, date: DATE, firmware };
}

describe('enhanced firmware', () => {
  it('the fork master is embedded and differs from FM92R only in code and the table marker', () => {
    const f = forkMaster()!;
    expect(f).not.toBeNull();
    expect(isForkImage(f)).toBe(true);
    expect(isForkImage(master('FM92R.BIN')!)).toBe(false);
    const m = master('FM92R.BIN')!;
    for (let i = 0x1B40; i < 0x2000; i++) if (i !== 0x1F64 && i !== 0x1F65) expect(f[i]).toBe(m[i]);
  });

  it('display windows', () => {
    expect(windows(freqNibbles(1474500))).toEqual(['14', '47', '7 ', ' 4', '45', '50']);
    expect(windows(freqNibbles(4770125))).toEqual(['47', '77', '7 ', ' 0', '01', '12', '25']);
    expect(windows(freqNibbles(775000))).toEqual(['77', '7 ', ' 5', '50', '00']);
  });

  for (const job of ['2MHAM', 'SH', 'SHC', '477']) {
    it(`${job}: every table entry is the channel's Rx; standard build unchanged`, () => {
      const a = analyze(project(job, 'enhanced'));
      expect(a.buildError).toBeNull();
      expect(a.enhanced).toBe(true);
      const img = a.img!;
      expect(verifyChecksum(img)).toBe(true);
      for (const c of a.chans) {
        expect(entryNibbles(tableEntry(img, c.num))).toEqual(freqNibbles(Math.round(Number(c.rx) * 10000)));
      }
      // standard: the reference image, as before
      const s = analyze(project(job)).img!;
      expect(isForkImage(s)).toBe(false);
      // the channel data reads back the same from both
      const hw = readJob(readFileSync(join(JOBS, job, job + '.JOB'))).hw;
      expect(readImage(img, hw).channels).toEqual(readImage(s, hw).channels);
    });

    it.skipIf(!python)(`${job}: byte-identical to mkradio.py`, () => {
      const d = mkdtempSync(join(tmpdir(), 'fork-'));
      const out = join(d, 'radio.bin');
      execFileSync('python3', [join(ROOT, 'firmware', 'fork', 'mkradio.py'), 'fromjob', join(JOBS, job, job + '.JOB'),
        '--date', DATE, '-o', out], { stdio: 'ignore' });
      const want = new Uint8Array(readFileSync(out));
      const got = analyze(project(job, 'enhanced')).img!;
      expect(Buffer.from(got).equals(Buffer.from(want))).toBe(true);
    });
  }

  it('refuses masters other than FM92R', () => {
    const p = { ...project('2MHAM', 'enhanced'), hw: '92430150' };   // digit 4 = 3: FM92L
    const a = analyze(p);
    expect(a.img).toBeNull();
    expect(a.buildError).toMatch(/FM92R only.*FM92L\.BIN/);
  });

  it('the table lies in the free area', () => {
    expect(FQ0 + 400).toBe(0x1B40);
  });
});

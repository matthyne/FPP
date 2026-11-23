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
import { FQ0, MO_MAGIC, entryNibbles, freqNibbles, hasIntro, identSeconds, isForkImage, morseBytes, readMorse, tableEntry, windows } from '../src/core/fork';
import { forkMaster, master } from '../src/core/masters';
import { toProject } from '../src/core/project';

const ROOT = join(__dirname, '..', '..');
const JOBS = join(ROOT, 'fm900', 'JOBS');
const DATE = '2026-11-21';

let python = true;
try { execFileSync('python3', ['--version']); } catch { python = false; }

function project(job: string, firmware?: 'enhanced' | 'intro', callsign?: string) {
  const j = readJob(readFileSync(join(JOBS, job, job + '.JOB')));
  const p = toProject(j.hw, j.sw, readChl(readFileSync(join(JOBS, job, job + '.CHL'))), job, j.comments);
  return { ...p, date: DATE, firmware, callsign };
}

describe('identSeconds', () => {
  it('matches the firmware timing (68 units for VK2FN at 66.5 ms, 1 s with no callsign)', () => {
    expect(identSeconds('VK2FN')).toBeCloseTo(68 * 0.0665, 6);
    expect(identSeconds('')).toBeCloseTo(1.0, 1);
    expect(identSeconds('DE VK2FN')).toBeGreaterThan(identSeconds('VK2FN'));
  });
});

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

    for (const [variant, call] of [['enhanced', ''], ['enhanced', 'VK2FN'], ['intro', 'VK2FN'], ['intro', '']] as const) {
      it.skipIf(!python)(`${job}: ${variant}${call ? ' + ' + call : ''} byte-identical to mkradio.py`, () => {
        const d = mkdtempSync(join(tmpdir(), 'fork-'));
        const out = join(d, 'radio.bin');
        execFileSync('python3', [join(ROOT, 'firmware', 'fork', 'mkradio.py'), 'fromjob', join(JOBS, job, job + '.JOB'),
          '--date', DATE, '--variant', variant, '--callsign', call, '-o', out], { stdio: 'ignore' });
        const want = new Uint8Array(readFileSync(out));
        const a = analyze(project(job, variant, call || undefined));
        expect(a.buildError).toBeNull();
        expect(Buffer.from(a.img!).equals(Buffer.from(want))).toBe(true);
      });
    }
  }

  it('start-up callsign: encoding, read-back, variants', () => {
    expect(morseBytes('VK2FN')).toEqual([1, 1, 1, 3, 0x80, 3, 1, 3, 0x80, 1, 1, 3, 3, 3, 0x80, 1, 1, 3, 1, 0x80, 3, 1, 0x80, 0]);
    expect(morseBytes('de vk2fn').includes(0x81)).toBe(true);
    expect(() => morseBytes('VK#')).toThrow();
    const e = analyze(project('2MHAM', 'enhanced', 'DE VK2FN')).img!;
    expect(hasIntro(e) && isForkImage(e)).toBe(true);
    expect(readMorse(e)).toBe('DE VK2FN');
    const i = analyze(project('2MHAM', 'intro', 'VK2FN')).img!;
    expect(hasIntro(i)).toBe(true);
    expect(isForkImage(i)).toBe(false);                 // no frequency display
    expect(readMorse(i)).toBe('VK2FN');
    expect(readMorse(analyze(project('2MHAM')).img!)).toBe('');
    expect(String.fromCharCode(...forkMaster('intro')!.subarray(MO_MAGIC, MO_MAGIC + 4))).toBe('MOR1');
    expect(analyze(project('2MHAM', 'intro', 'VK2#')).buildError).toMatch(/callsign/);
  });

  it('refuses masters other than FM92R', () => {
    for (const fw of ['enhanced', 'intro'] as const) {
      const p = { ...project('2MHAM', fw), hw: '92430150' };   // digit 4 = 3: FM92L
      const a = analyze(p);
      expect(a.img).toBeNull();
      expect(a.buildError).toMatch(/FM92R only.*FM92L\.BIN/);
    }
  });

  it('the table lies in the free area', () => {
    expect(FQ0 + 400).toBe(0x1B40);
  });
});

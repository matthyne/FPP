import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { cheatSheet, sheetEntries, sheetLayout } from '../src/core/cheatsheet';
import { headButtons } from '../src/core/codes';
import { F_SCAN1, F_SCAN2, F_SCAN3, readChl, readJob } from '../src/core/fm900';
import { pdfString } from '../src/core/pdf';
import { Project, toProject } from '../src/core/project';
import { VERSION, VERSION_LABEL } from '../src/version';

const JOBS = join(__dirname, '..', '..', 'fm900', 'JOBS');
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

function job(path: string): Project {
  const j = readJob(readFileSync(join(JOBS, path + '.JOB')));
  return toProject(j.hw, j.sw, readChl(readFileSync(join(JOBS, path + '.CHL'))), path.split('/').pop(), j.comments);
}

/** Structural check: one page, every xref offset points at its object. */
function checkPdf(pdf: Uint8Array): string {
  const s = latin1(pdf);
  expect(s.startsWith('%PDF-1.4\n')).toBe(true);
  expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  expect(s.match(/\/Type \/Page\b/g)).toHaveLength(1);
  const sx = Number(/startxref\n(\d+)\n/.exec(s)![1]);
  expect(s.slice(sx, sx + 5)).toBe('xref\n');
  const entries = s.slice(sx).split('\n').slice(3).filter((l) => / 00000 n $/.test(l));
  expect(entries.length).toBeGreaterThan(4);
  entries.forEach((l, i) => expect(s.slice(Number(l.slice(0, 10))).startsWith(`${i + 1} 0 obj\n`)).toBe(true));
  for (let i = 0; i < pdf.length; i++) expect(pdf[i]).toBeLessThan(0x80);
  const len = Number(/\/Length (\d+) >>\nstream\n/.exec(s)![1]);
  const start = s.indexOf('stream\n') + 7;
  expect(s.slice(start + len, start + len + 10)).toBe('\nendstream');
  return s;
}

describe('cheat sheet PDF', () => {
  for (const path of ['80CHCB', '2MHAM/2MHAM', '477/477']) {
    it(`${path}: one page, every channel listed`, () => {
      const p = job(path);
      const s = checkPdf(cheatSheet(p, analyze(p)));
      const { entries } = sheetEntries(p);
      expect(entries.length).toBe(p.rows.length);
      for (const e of entries) {
        expect(s).toContain(`(${e.rx}) Tj`);
        expect(s).toContain(`(${e.tx}) Tj`);
        expect(s).toContain(`(${e.num}) Tj`);
      }
      expect(s).toContain(`(${p.name}) Tj`);
    });
  }

  it('fits 120 records (and more) inside the page', () => {
    for (const n of [1, 40, 60, 99, 120, 180]) {
      const L = sheetLayout(n, 523, 700);
      expect(L.cols * L.perCol).toBeGreaterThanOrEqual(n);
      expect((L.perCol + 1) * L.lineH).toBeLessThanOrEqual(700 + 1e-9);
      expect(L.fontSize).toBeGreaterThanOrEqual(7);
      expect(L.nameW).toBeGreaterThanOrEqual(7 * L.fontSize - 1e-9);
    }
  });

  it('names, receive-only, simplex and error rows', () => {
    const p = job('80CHCB');
    p.rows = [
      { num: '1', rx: '146.5', tx: '', flags: 0, ctcss: '', name: 'Café (simplex) – a very long name that will not fit in the column at all, not even on a single-column sheet with lots of room' },
      { num: '2', rx: '147.0', tx: 'X', flags: 0, ctcss: '', name: 'µ€😀' },
      { num: '', rx: '', tx: '', flags: 0, ctcss: '' },
      { num: 'x', rx: '1', tx: '', flags: 0, ctcss: '' },
    ];
    const { entries, skipped } = sheetEntries(p);
    expect(skipped).toBe(1);
    expect(entries.map((e) => e.tx)).toEqual(['146.5000', 'Rx only']);
    const s = checkPdf(cheatSheet(p));
    expect(s).toContain('(Caf\\351 \\(simplex\\) \\226 a very');
    expect(s).toContain('\\205) Tj');                      // truncated with an ellipsis
    expect(s).toContain('(\\265\\200?) Tj');
    expect(s).toContain('1 row with errors not shown');
  });

  it('footer carries the Web FPP version from package.json', () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version);
    expect(latin1(cheatSheet(job('80CHCB')))).toContain(`Web FPP \\(FM900 CPS\\) ${VERSION_LABEL.replace(/[()]/g, '\\$&')}`);
  });

  it('head buttons box: FM92 only, defaults or override', () => {
    const fm92 = job('2MHAM/2MHAM');
    const a = analyze(fm92);
    expect(headButtons(fm92, a.defaultKeys)?.map(([b]) => b)).toEqual(['UP', 'DOWN', 'AUX', 'SEND']);
    expect(headButtons(fm92, a.defaultKeys)?.slice(0, 2).map(([, f]) => f)).toEqual(['Channel up', 'Channel down']);
    let s = latin1(cheatSheet(fm92, a));
    expect(s).toContain('(Head buttons) Tj');
    expect(s).toContain('(AUX) Tj');
    const over = { ...fm92, keys: [5, 6, 3, 4] };
    s = latin1(cheatSheet(over, analyze(over)));
    for (const f of ['Scan on/off', 'Monitor on/off', 'Channel tens \\(next 10\\)', 'Channel units']) expect(s).toContain(`(${f}) Tj`);
    const fm91 = job('80CHCB');
    expect(headButtons(fm91, analyze(fm91).defaultKeys)).toBeNull();
    expect(latin1(cheatSheet(fm91, analyze(fm91)))).not.toContain('Head buttons');
  });

  it('scan groups colour the channel badges, with a legend', () => {
    const p = job('2MHAM/2MHAM');
    p.rows = [
      { num: '1', rx: '146.5', tx: '', flags: F_SCAN1, ctcss: '' },
      { num: '2', rx: '146.6', tx: '', flags: F_SCAN2, ctcss: '' },
      { num: '3', rx: '146.7', tx: '', flags: F_SCAN1 | F_SCAN2, ctcss: '' },
      { num: '4', rx: '146.8', tx: '', flags: F_SCAN3, ctcss: '' },          // FM92: no group 3, so not scanned
      { num: '5', rx: '146.9', tx: '', flags: 0, ctcss: '' },
    ];
    expect(sheetEntries(p).entries.map((e) => e.scan)).toEqual([[1], [2], [1, 2], [], []]);
    const s = latin1(cheatSheet(p, analyze(p)));
    expect(s).toContain('0.13 0.42 0.86 rg');
    expect(s).toContain('0.9 0.45 0.02 rg');
    for (const t of ['Channel number colour', 'Scan group 1', 'Scan group 2', 'In groups 1 and 2', 'Not scanned']) expect(s).toContain(`(${t}) Tj`);
    p.rows = p.rows.map((r) => ({ ...r, flags: 0 }));
    expect(latin1(cheatSheet(p, analyze(p)))).not.toContain('Channel number colour');
  });

  it('pdfString escapes', () => {
    expect(pdfString('a(b)\\c')).toBe('a\\(b\\)\\\\c');
  });
});

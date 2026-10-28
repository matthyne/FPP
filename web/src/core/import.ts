// Import channel lists from other tools' CSV files: CHIRP, RepeaterBook (CHIRP export),
// RadioReference (CSV download or a table copied from the web page), the README format,
// or any table with a header row (columns mapped by name, or by hand in the UI).
import { CTCSS, F_CR, F_ECON, F_SELCALL, F_VOTE, FM900Error, normFreq } from './fm900';
import { COLS, powerFlag, scanFlags, yes } from './channels';
import { BAND_MHZ } from './codes';
import { Row } from './project';

export type Field = 'ch' | 'rx' | 'tx' | 'offset' | 'duplex' | 'tone' | 'txTone' | 'rxTone' | 'toneMode' | 'mode' | 'name' | 'power' | 'scan'
  | 'vote' | 'econ' | 'selcall' | 'cr';

export const FIELD_LABELS: Record<Field, string> = {
  ch: 'Channel number', rx: 'Rx / output frequency', tx: 'Tx / input frequency', offset: 'Offset (MHz)',
  duplex: 'Duplex (+ / − / split / off)', tone: 'Tone (CTCSS)', txTone: 'Tx tone', rxTone: 'Rx tone',
  toneMode: 'Tone mode (CHIRP)', mode: 'Mode (FM / DMR / P25…)', name: 'Name / description', power: 'Power', scan: 'Scan',
  vote: 'VOTE (Y/N)', econ: 'ECON (Y/N)', selcall: 'SELCALL (Y/N)', cr: 'C/R (Y/N)',
};
export const FIELDS = Object.keys(FIELD_LABELS) as Field[];

// Header names (lower case, spaces/punctuation removed) each field is recognised by.
const SYNONYMS: Record<Field, string[]> = {
  ch: ['ch', 'chan', 'channel', 'location', 'loc', 'mem', 'memory', 'no', 'number'],
  rx: ['rx', 'frequency', 'freq', 'outputfreq', 'output', 'frequencyoutput', 'rxfreq', 'rxfrequency', 'receive', 'downlink', 'downlinkfreq'],
  tx: ['tx', 'input', 'inputfreq', 'frequencyinput', 'txfreq', 'txfrequency', 'transmit', 'uplink', 'uplinkfreq'],
  offset: ['offset', 'offsetmhz', 'shift'],
  duplex: ['duplex', 'direction', 'offsetdirection'],
  tone: ['tone', 'pltone', 'ctcss', 'pl', 'ctcssdcs', 'tonesquelch', 'accesstone', 'subtone'],
  txTone: ['rtonefreq', 'uplinktone', 'txtone', 'txctcss', 'encode', 'ctcssencode', 'txpl'],
  rxTone: ['ctonefreq', 'downlinktone', 'rxtone', 'rxctcss', 'decode', 'ctcssdecode', 'rxpl', 'tsqtone'],
  toneMode: ['tonemode'],
  mode: ['mode', 'emission', 'modulation', 'type', 'class'],
  name: ['name', 'alphatag', 'description', 'desc', 'call', 'callsign', 'fcccallsign', 'location', 'tag', 'comment', 'notes', 'label'],
  power: ['power', 'pwr', 'txpower'],
  scan: ['scan'],
  vote: ['vote'], econ: ['econ'], selcall: ['selcall'], cr: ['cr'],
};

export interface Mapping { format: string; header: string[]; map: Partial<Record<Field, number>> }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Split text into a table: tab, comma or semicolon separated, double-quote aware. */
export function parseTable(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  const sample = lines.slice(0, 10);
  const count = (c: string) => sample.join('\n').split(c).length - 1;
  const delim = count('\t') >= sample.length ? '\t' : count(',') >= count(';') ? ',' : ';';
  return lines.map((line) => {
    if (!line.includes(delim) && delim !== '\t') return line.trim().split(/\s+/);
    const out: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"' && cur.trim() === '') { q = true; cur = ''; } else if (ch === delim) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

/** Find the header row (the first row with a recognised frequency column) and map the columns. */
export function guessMapping(table: string[][]): { mapping: Mapping; start: number } {
  for (let r = 0; r < Math.min(table.length, 5); r++) {
    const header = table[r].map((h) => h.trim());
    const keys = header.map(norm);
    if (!keys.some((k) => SYNONYMS.rx.includes(k))) continue;
    const map: Partial<Record<Field, number>> = {};
    const taken = new Set<number>();
    // most specific fields first so e.g. "Frequency Input" isn't taken as the Rx column
    for (const f of ['txTone', 'rxTone', 'toneMode', 'tx', 'rx', 'offset', 'duplex', 'tone', 'mode', 'ch', 'power', 'scan',
      'vote', 'econ', 'selcall', 'cr', 'name'] as Field[]) {
      for (const syn of SYNONYMS[f]) {
        const i = keys.findIndex((k, j) => k === syn && !taken.has(j));
        if (i >= 0) { map[f] = i; taken.add(i); break; }
      }
    }
    // CHIRP's "Location" is the channel; RadioReference uses "Alpha Tag" / "Description" for the name
    let format = 'Generic table';
    if (keys.includes('rtonefreq') && keys.includes('duplex')) format = 'CHIRP / RepeaterBook';
    else if (keys.includes('alphatag') || keys.includes('fcccallsign') || keys.includes('frequencyoutput')) format = 'RadioReference';
    else if (keys[0] === 'ch' && keys.every((k) => (COLS as string[]).includes(k) || k === 'name')) format = 'FM900 (README format)';
    if (format === 'CHIRP / RepeaterBook' && map.tone !== undefined) {
      map.toneMode = map.tone;      // CHIRP's "Tone" column is the tone mode (Tone / TSQL / DTCS…)
      delete map.tone;
    }
    if (format === 'RadioReference') {
      const tag = keys.indexOf('alphatag'), desc = keys.indexOf('description');
      if (tag >= 0) map.name = tag; else if (desc >= 0) map.name = desc;
    }
    return { mapping: { format, header, map }, start: r + 1 };
  }
  // no header: README positional format
  const width = Math.max(0, ...table.map((r) => r.length));
  const pos: Field[] = ['rx', 'tx', 'power', 'scan', 'tone', 'vote', 'econ', 'selcall', 'cr'];
  const map: Partial<Record<Field, number>> = {};
  pos.forEach((f, i) => { if (i < width) map[f] = i; });
  return { mapping: { format: 'No header (rx tx power scan ctcss)', header: Array.from({ length: width }, (_, i) => `Column ${i + 1}`), map }, start: 0 };
}

export interface ImportRow {
  include: boolean;     // default selection
  ok: boolean;          // false = can't be imported at all
  reason: string;       // why it's skipped / flagged
  row: Row;
  source: string[];
  tone: string;         // tone as found in the file, for the preview
  mode: string;
}

export interface ImportOptions { hw: string; firstNum: number; useFileNumbers: boolean; power: number }

const NON_FM = /(dmr|p25|apco|nxdn|d-?star|\bdv\b|dig|tdma|fdma|\bam\b|usb|lsb|ssb|cw|ysf|c4fm|fusion|dpmr|provoice|edacs|ltr|tetra|m17|mototrbo|trunk|data|telm|tlm)/i;

function freqMHz(s: string): string {
  // "146.940", "146.94 MHz", "146,9400" (decimal comma), "146940 kHz", "146940000" (Hz)
  let t = s.trim().replace(/\s*mhz$/i, '');
  let scale = 1;
  if (/khz$/i.test(t)) { t = t.replace(/\s*khz$/i, ''); scale = 1e-3; }
  if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) throw new FM900Error(`bad frequency ${JSON.stringify(s)}`);
  if (scale === 1 && !t.includes('.') && t.length >= 7) scale = 1e-6;          // plain Hz
  if (scale === 1) return normFreq(t);
  const [a, b = ''] = t.split('.');
  const digits = scale === 1e-3 ? 3 : 6;
  const whole = (a + b).padStart(digits + 1, '0');
  return normFreq(`${whole.slice(0, whole.length - b.length - digits)}.${whole.slice(whole.length - b.length - digits)}`);
}

function units(f: string): number {           // 'MHz.dddd' -> 100 Hz units
  const [a, b] = f.split('.');
  return +a * 10000 + +b;
}
function fmt(u: number): string {
  return `${Math.floor(u / 10000)}.${String(u % 10000).padStart(4, '0')}`;
}

const TONE_HZ = [...CTCSS].map(([c, , hz]) => [c, hz] as [string, number]);

/** CTCSS letter code for a tone cell, '' for none; throws for DCS or an unknown tone. */
export function parseTone(s: string): string {
  const t = s.trim();
  if (!t || /^(none|off|csq|carrier|-|0|0\.0|n\/a)$/i.test(t)) return '';
  if (/(dcs|dpl|^d\d{3}|nac|ran|cc\d|\bcc\b|\$)/i.test(t)) throw new FM900Error(`DCS / digital code ${t} isn't supported`);
  const m = /(\d{2,3}(?:\.\d)?)/.exec(t);
  if (!m) throw new FM900Error(`unknown tone ${JSON.stringify(t)}`);
  const hz = Math.round(parseFloat(m[1]) * 10) / 10;
  const hit = TONE_HZ.find(([, h]) => Math.abs(h - hz) < 0.05);
  if (!hit) throw new FM900Error(`${hz} Hz isn't in the radio's CTCSS table`);
  return hit[0];
}

export function convert(table: string[][], start: number, mapping: Mapping, o: ImportOptions): ImportRow[] {
  const get = (r: string[], f: Field) => (mapping.map[f] !== undefined ? (r[mapping.map[f]!] ?? '').trim() : '');
  const band = BAND_MHZ[o.hw[2]];
  const nmax = o.hw[1] === '1' ? 120 : 99;
  let next = o.firstNum;
  const out: ImportRow[] = [];
  // CHIRP numbers memories from 0 on many radios: shift so the first one is channel 1
  const fileNums = o.useFileNumbers && mapping.map.ch !== undefined
    ? table.slice(start).map((r) => parseInt(r[mapping.map.ch!] ?? '', 10)).filter((n) => !Number.isNaN(n)) : [];
  const shift = fileNums.length && Math.min(...fileNums) === 0 ? 1 : 0;
  for (const src of table.slice(start)) {
    if (!src.some((c) => c.trim())) continue;
    const mode = get(src, 'mode');
    const toneCell = mapping.map.toneMode !== undefined
      ? (get(src, 'toneMode') ? `${get(src, 'toneMode')} ${get(src, 'txTone')}/${get(src, 'rxTone')}` : '')
      : get(src, 'tone') || get(src, 'txTone') || get(src, 'rxTone');
    const res: ImportRow = { include: true, ok: true, reason: '', source: src, tone: toneCell, mode,
      row: { num: '', rx: '', tx: '', flags: o.power, ctcss: '', name: get(src, 'name') } };
    const flag = (msg: string, fatal = false) => {
      res.reason = res.reason ? `${res.reason}; ${msg}` : msg;
      res.include = false;
      if (fatal) res.ok = false;
    };
    try {
      const rxs = get(src, 'rx');
      if (!rxs) throw new FM900Error('no frequency');
      const rx = freqMHz(rxs);
      let tx = rx;
      const txs = get(src, 'tx'), dup = get(src, 'duplex').toLowerCase(), offs = get(src, 'offset');
      const offset = () => {
        const v = parseFloat(offs.replace(/\s*mhz$/i, ''));
        if (Number.isNaN(v)) throw new FM900Error(`bad offset ${JSON.stringify(offs)}`);
        // MHz normally; values like 600 or -5000 are kHz
        return Math.round((Math.abs(v) >= 100 ? v / 1000 : v) * 10000);
      };
      if (txs && !/^(0|0\.0+|-|none)$/i.test(txs)) {
        tx = /^x/i.test(txs) ? 'XXXXXXXX' : freqMHz(txs);
      } else if (dup === 'off') {
        tx = 'XXXXXXXX';
      } else if (dup === 'split' && offs) {
        tx = freqMHz(offs);
      } else if ((dup === '+' || dup === '-') && offs) {
        tx = fmt(units(rx) + (dup === '-' ? -1 : 1) * Math.abs(offset()));
      } else if (!dup && offs && /^[+-]/.test(offs)) {
        tx = fmt(units(rx) + offset());
      }
      res.row.rx = rx;
      res.row.tx = tx === rx ? '' : tx.startsWith('X') ? 'X' : tx;
    } catch (e) {
      if (!(e instanceof FM900Error)) throw e;
      flag(/decimal places/.test(e.message) ? 'frequency needs more than 4 decimals (not on a 100 Hz step)' : e.message, true);
    }
    if (mode && NON_FM.test(mode) && !/^(fm|nfm|fmn|wfm)$/i.test(mode)) flag(`mode ${mode} isn't analogue FM`, true);
    try {
      if (mapping.map.toneMode !== undefined) {        // CHIRP: the tone frequencies only count in Tone / TSQL mode
        const tm = get(src, 'toneMode').toLowerCase();
        if (tm === 'tone') res.row.ctcss = parseTone(get(src, 'txTone'));
        else if (tm === 'tsql') res.row.ctcss = parseTone(get(src, 'rxTone') || get(src, 'txTone'));
        else if (tm && tm !== 'none' && tm !== '') throw new FM900Error(`tone mode ${get(src, 'toneMode')} isn't supported`);
      } else {
        res.row.ctcss = parseTone(get(src, 'txTone') || get(src, 'tone') || get(src, 'rxTone'));
      }
    } catch (e) {
      if (!(e instanceof FM900Error)) throw e;
      res.reason = res.reason ? `${res.reason}; ${e.message} (imported without a tone)` : `${e.message} (imported without a tone)`;
    }
    const p = get(src, 'power');
    if (p) { try { const f = powerFlag(p); if (f) res.row.flags = f; } catch { /* keep default power */ } }
    if (get(src, 'scan')) res.row.flags |= scanFlags(get(src, 'scan'));
    for (const [f, bit] of [['vote', F_VOTE], ['econ', F_ECON], ['selcall', F_SELCALL], ['cr', F_CR]] as [Field, number][]) {
      if (yes(get(src, f))) res.row.flags |= bit;
    }
    const fileNum = parseInt(get(src, 'ch'), 10);
    const num = o.useFileNumbers && !Number.isNaN(fileNum) ? fileNum + shift : next;
    res.row.num = String(num);
    if (res.ok) {
      next = num + 1;
      if (num < 1 || num > nmax) flag(`channel ${num} is outside 1..${nmax}`);
      if (band) {
        for (const f of [res.row.rx, res.row.tx]) {
          if (!f || f === 'X') continue;
          const mhz = units(f) / 10000;
          if (mhz < band[0] - 5 || mhz > band[1] + 5) { flag(`${f} MHz is outside this radio's band`); break; }
        }
      }
    }
    out.push(res);
  }
  return out;
}

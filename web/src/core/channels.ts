// Channel-list text format (CSV / whitespace), ported from fm900gen.py parse_channels.
// See ../../README.md "Channel list format".
import {
  CTCSS, CTCSS_HZ_BY_CODE, Channel, FM900Error, normFreq,
  F_HIGH, F_MED, F_LOW, F_SELPWR, F_VOTE, F_ECON, F_SELCALL, F_CR, F_SCANSEL,
  F_SCAN1, F_SCAN2, F_SCAN3, F_PRI1, F_PRI2, F_PRI3,
} from './fm900';

export const COLS = ['ch', 'rx', 'tx', 'power', 'scan', 'ctcss', 'vote', 'econ', 'selcall', 'cr'];

const CTCSS_BY_HZ = new Map(CTCSS.map(([c, , hz]) => [hz, c]));

export function parseCtcss(v: string): string {
  v = v.trim();
  if (!v || ['none', 'off', '-', '0.0'].includes(v.toLowerCase())) return '';
  if (v.length === 1 && CTCSS_HZ_BY_CODE.has(v)) return v;
  const f = Number(v);
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v) || Number.isNaN(f)) throw new FM900Error(`unknown CTCSS ${JSON.stringify(v)}`);
  const hz = Math.round(f * 10) / 10;
  const c = CTCSS_BY_HZ.get(hz);
  if (c === undefined) throw new FM900Error(`CTCSS ${v} Hz is not in the radio's tone table`);
  return c;
}

export function yes(v: string): boolean {
  return ['Y', 'YES', '1', 'TRUE'].includes(v.trim().toUpperCase());
}

/** Split one CSV line (double-quote aware, like Python's csv.reader). */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Scan-column semantics of FUNC 0x3225: '1'/'2'/'3' member, 'nP' priority, 'S' selectable. */
export function scanFlags(s: string): number {
  s = s.toUpperCase();
  let flags = 0;
  for (const [blk, fm, fp] of [['1', F_SCAN1, F_PRI1], ['2', F_SCAN2, F_PRI2], ['3', F_SCAN3, F_PRI3]] as const) {
    let i = s.indexOf(blk);
    while (i >= 0) {
      flags |= s[i + 1] === 'P' ? fp : fm;
      i = s.indexOf(blk, i + 1);
    }
  }
  if (s.includes('S')) flags |= F_SCANSEL;
  return flags;
}

export function powerFlag(p: string): number {
  const f = ({ H: F_HIGH, M: F_MED, L: F_LOW, S: F_SELPWR, '': 0 } as Record<string, number>)[p.toUpperCase().slice(0, 1)];
  if (f === undefined) throw new FM900Error(`bad power ${JSON.stringify(p)} (use H, M, L or S)`);
  return f;
}

export function parseChannels(text: string, defaultPower = 'H'): Channel[] {
  const rows: string[][] = [];
  let header: string[] | null = null;
  for (let line of text.split(/\r\n|\r|\n/)) {
    line = line.split('#', 1)[0].trim();
    if (!line) continue;
    const cells = (line.includes(',') ? csvCells(line) : line.split(/\s+/)).map((x) => x.trim());
    if (header === null && cells.length && [...COLS, 'channel'].includes(cells[0].toLowerCase())) {
      header = cells.map((h) => h.toLowerCase().replace('channel', 'ch'));
      continue;
    }
    rows.push(cells);
  }
  if (header === null) header = ['rx', 'tx', 'power', 'scan', 'ctcss', 'vote', 'econ', 'selcall', 'cr'];
  const chans: Channel[] = [];
  let nextch = 1;
  for (const cells of rows) {
    const d: Record<string, string> = {};
    header.forEach((h, i) => { d[h] = cells[i] ?? ''; });
    const num = d.ch ? parseInt(d.ch, 10) : nextch;
    if (Number.isNaN(num)) throw new FM900Error(`bad channel number ${JSON.stringify(d.ch)}`);
    nextch = num + 1;
    const rx = normFreq(d.rx ?? '');
    const tx = d.tx ? normFreq(d.tx) : rx;
    let flags = powerFlag(d.power || defaultPower);
    flags |= scanFlags(d.scan || '');
    if (yes(d.vote || '')) flags |= F_VOTE;
    if (yes(d.econ || '')) flags |= F_ECON;
    if (yes(d.selcall || '')) flags |= F_SELCALL;
    if (yes(d.cr || '')) flags |= F_CR;
    chans.push({ num, rx, tx, flags, ctcss: parseCtcss(d.ctcss || '') });
  }
  return chans;
}

export function powerLetter(flags: number): string {
  if (flags & F_HIGH) return 'H';
  if (flags & F_MED) return 'M';
  if (flags & F_LOW) return 'L';
  if (flags & F_SELPWR) return 'S';
  return '';
}

export function scanText(flags: number): string {
  let s = '';
  for (const [blk, fm, fp] of [['1', F_SCAN1, F_PRI1], ['2', F_SCAN2, F_PRI2], ['3', F_SCAN3, F_PRI3]] as const) {
    if (flags & fm) s += blk;
    if (flags & fp) s += blk + 'P';
  }
  if (flags & F_SCANSEL) s += 'S';
  return s;
}

/** Write the README CSV format with a header row; parseChannels reads it back unchanged. */
export function formatChannels(chans: Channel[]): string {
  const yn = (b: number) => (b ? 'Y' : '');
  const lines = [COLS.join(',')];
  for (const c of chans) {
    const ct = c.ctcss ? (CTCSS_HZ_BY_CODE.get(c.ctcss)?.toFixed(1) ?? '') : '';
    lines.push([c.num, c.rx, c.tx.startsWith('X') ? 'X' : c.tx, powerLetter(c.flags), scanText(c.flags), ct,
      yn(c.flags & F_VOTE), yn(c.flags & F_ECON), yn(c.flags & F_SELCALL), yn(c.flags & F_CR)].join(','));
  }
  return lines.join('\n') + '\n';
}

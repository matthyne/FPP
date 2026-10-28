// fm900.ts - Philips FM900 (FM91 / FM92) personality EPROM image builder.
//
// A faithful TypeScript port of ../../fm900gen.py, which is itself a port of
// FM900.EXE.  Comments give the FM900.EXE routine addresses (FUNC 0x....).
// See ../../FM900_FORMAT.md.  Keep this byte-identical with the Python: the
// golden and differential tests in test/ enforce it.

export const IMG_SIZE = 0x2000;

// ---------------------------------------------------------------------------
// Constant tables copied verbatim from FM900.EXE's data segment (DGROUP 0x230F)
// ---------------------------------------------------------------------------

// DS:0x09CC .. DS:0x0C40.  Two overlapping tables live here:
//   DS:0x09CC  4-byte entries indexed by the 2-digit "selcall encode" code
//              (SW code chars 11-12): u16 flags, u8 or-mask for 0x1F36, u8 for 0x1F37
//   DS:0x0AAE  4-byte entries indexed by the 2-digit "selcall decode" code
//              (SW code chars 13-14): u8 or-mask for 0x1F36, u8 for 0x1F37
const DSBLOB = hexBytes(
  '010008400300090101000900030001010300010103000900020009000300010003000100010009000200094103000141' +
  '030001410200094002000940030001400300014004004b80000000000400438000000000020049010200490102004101' +
  '020041010600490106004901070041010700410102004900020049000200410002004100060049000600490007004100' +
  '070041000200494102004941020041410200414106004941060049410700414107004141020049400200494002004140' +
  '020041400600494006004940070041400700414001000940000000000000000001000000010083000100870001008304' +
  '010087040100a3080100a30c0100a7080100a70c0100870801008320010087200100872801008324010087240100a328' +
  '0100a32c0100a7280100a72c000000000000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000100830001008700010083040100870401008308010087080100830c0100870c01008320' +
  '01008720010083240100872401008328010087280100832c0100872c0000000000000000000000000100030001000304' +
  '000003080000030c0000000000000000510011000000000000c05040520012009a99999999f95140530013009a999999' +
  '9999524054001400000000000040534055001500cdccccccccec5340490009000000000000a05440560016009a999999' +
  '99595540410001000000000000205640570017000000000000e056404a000a003333333333b357404200020000000000' +
  '000059404b000b000000000000e0594043000300cdcccccccccc5a404c000c009a99999999b95b404400040033333333' +
  '33b35c40');
const DSBASE = 0x09CC;

function hexBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(2 * i, 2), 16);
  return out;
}

function ds(off: number): number {
  const i = off - DSBASE;
  if (i < 0 || i >= DSBLOB.length) throw new FM900Error('selcall table index out of range');
  return DSBLOB[i];
}

function ds16(off: number): number {
  return ds(off) | (ds(off + 1) << 8);
}

function encTabWord(n: number): number {   // DS:0x09CC + 4n
  return ds16(0x09CC + 4 * n);
}

// CTCSS table (DS:0x0B8C, 38 x {char code[2]; u16 value; double hz}).
export const CTCSS: [string, number, number][] = [
  ['Q', 17, 67.0], ['R', 18, 71.9], ['S', 19, 74.4], ['T', 20, 77.0],
  ['U', 21, 79.7], ['I', 9, 82.5], ['V', 22, 85.4], ['A', 1, 88.5],
  ['W', 23, 91.5], ['J', 10, 94.8], ['B', 2, 100.0], ['K', 11, 103.5],
  ['C', 3, 107.2], ['L', 12, 110.9], ['D', 4, 114.8], ['M', 13, 118.8],
  ['E', 5, 123.0], ['N', 14, 127.3], ['F', 6, 131.8], ['O', 15, 136.5],
  ['G', 7, 141.3], ['P', 16, 146.2], ['H', 8, 151.4], ['X', 24, 156.7],
  ['Y', 25, 162.2], ['0', 26, 167.9], ['1', 27, 173.8], ['2', 28, 180.2],
  ['3', 29, 186.2], ['4', 30, 192.8], ['5', 31, 203.5], ['6', 32, 210.7],
  ['7', 33, 218.1], ['8', 34, 225.7], ['9', 35, 233.6], ['*', 36, 241.8],
  ['#', 37, 250.3], ['=', 38, 97.4],
];
export const CTCSS_BY_CODE = new Map(CTCSS.map(([c, v]) => [c, v]));
export const CTCSS_HZ_BY_CODE = new Map(CTCSS.map(([c, , hz]) => [c, hz]));

// Channel-record flag word (offset 0x14 of a .CHL record)
export const F_HIGH = 0x0001, F_MED = 0x0002, F_LOW = 0x0004, F_SELPWR = 0x0008;
// Entry-screen field order is CTCSS, C/R, VOTE, ECON, SELCALL (FUNC 0x3225).
export const F_VOTE = 0x0010, F_ECON = 0x0020, F_SELCALL = 0x0040;
export const F_SCAN1 = 0x0080, F_SCAN2 = 0x0100, F_SCAN3 = 0x0200;
export const F_PRI1 = 0x0400, F_PRI2 = 0x0800, F_PRI3 = 0x1000;
export const F_SCANSEL = 0x2000, F_CR = 0x4000;

export const MASTER_VERSION: Record<string, [number, string]> = {   // FUNC 0x8517
  'FM91S.BIN': [10, '01045'], 'FM91.BIN': [1, '0020:'],
  'FM92LS.BIN': [11, '01065'], 'FM92L.BIN': [4, '0028:'],
  'FM92RS.BIN': [12, '01055'], 'FM92R.BIN': [5, '0029:'],
  'FM93S.BIN': [13, '03851'], 'FM93.BIN': [14, '03861'],
  'FM97WPS.BIN': [12, '03710'], 'FM97WP.BIN': [5, '03700'],
};

// FM92 function-key codes (firmware jump table at 0x05D6, see firmware/FIRMWARE.md 6.2)
export const KEY_FUNCS = ['none', 'up', 'down', 'tens', 'units', 'scan', 'monitor', 'selcall', 'dial'];

export class FM900Error extends Error {}

// ---------------------------------------------------------------------------
// Channel record
// ---------------------------------------------------------------------------
export interface Channel {
  num: number;     // channel number 1..99 (FM92) / 1..120 (FM91)
  rx: string;      // "147.0000"  (always 4 decimals)
  tx: string;      // "147.0000" or "XXXXXXXX" (receive only)
  flags: number;
  ctcss: string;   // CTCSS letter code ('' = none)
}

export function latin1(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return s;
}

function cstr(b: Uint8Array): string {
  const z = b.indexOf(0);
  return latin1(z >= 0 ? b.subarray(0, z) : b);
}

// .CHL on-disk record: 24 bytes  (see FM900_FORMAT.md)
export function chlRecord(c: Channel): Uint8Array {
  const r = new Uint8Array(24);
  r[0] = c.num & 0xFF; r[1] = (c.num >> 8) & 0xFF;
  for (let i = 0; i < c.rx.length; i++) r[2 + i] = c.rx.charCodeAt(i);
  for (let i = 0; i < c.tx.length; i++) r[11 + i] = c.tx.charCodeAt(i);
  r[20] = c.flags & 0xFF; r[21] = (c.flags >> 8) & 0xFF;
  if (c.ctcss) r[22] = c.ctcss.charCodeAt(0);
  return r;
}

export function channelFromChl(r: Uint8Array): Channel {
  const num = r[0] | (r[1] << 8);
  const rx = cstr(r.subarray(2, 11));
  const tx = cstr(r.subarray(11, 20));
  const flags = r[20] | (r[21] << 8);
  // byte 22..23 is a NUL-terminated string; byte 23 is often junk when
  // byte 22 is 0 (no CTCSS).  FM900.EXE does strcmp(rec+0x16, code).
  let ct = '';
  if (r[22]) ct = r[23] === 0 ? cstr(r.subarray(22, 24)) : latin1(r.subarray(22, 24)) + '?';
  return { num, rx, tx, flags, ctcss: ct };
}

export function readChl(data: Uint8Array): Channel[] {
  const chans: Channel[] = [];
  for (let i = 0; i < data.length - 23; i += 24) {
    const r = data.subarray(i, i + 24);
    if (r[0] === 0 && r[1] === 0) break;   // the in-memory channel list ends at the first empty slot
    chans.push(channelFromChl(r));
  }
  return chans;
}

export function writeChl(chans: Channel[], nrec = 120): Uint8Array {
  const out = new Uint8Array(24 * nrec);
  chans.forEach((c, i) => out.set(chlRecord(c), 24 * i));
  return out;
}

export interface Job { sum: string; comments: string[]; hw: string; sw: string }

export function readJob(data: Uint8Array): Job {
  const lines = latin1(data).split('\r\n');
  // line 0: sum of frequencies, then a variable number of comment lines,
  // then the hardware code and the software code as the last two lines.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length < 3) throw new FM900Error('not a FM900 job file');
  return { sum: lines[0], comments: lines.slice(1, -2), hw: lines[lines.length - 2].trim(),
    sw: lines[lines.length - 1].trim() };
}

export function writeJob(hw: string, sw: string, comments: string[] = [], freqsum = ''): Uint8Array {
  const c = comments.slice(0, 5);
  while (c.length < 5) c.push('');
  const txt = [freqsum, ...c, hw, sw].join('\r\n') + '\r\n';
  const out = new Uint8Array(txt.length);
  for (let i = 0; i < txt.length; i++) out[i] = txt.charCodeAt(i) & 0xFF;
  return out;
}

// ---------------------------------------------------------------------------
// Frequency helpers
// ---------------------------------------------------------------------------

/** Normalise to the 'MHz with 4 decimals' string FM900.EXE stores. */
export function normFreq(s: string): string {
  s = String(s).trim();
  if (s.toUpperCase().startsWith('X')) return 'XXXXXXXX';
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) throw new FM900Error(`bad frequency ${JSON.stringify(s)}`);
  let frac = (m[3] || '').replace(/0+$/, '');
  if (frac.length > 4) {
    throw new FM900Error(`frequency ${s} has more than 4 decimal places (100 Hz resolution)`);
  }
  frac = (frac + '0000').slice(0, 4);
  let v = parseInt((m[2] || '0') + frac, 10);
  if (m[1] === '-') v = -v;
  const ip = Math.floor(v / 10000), fp = v - ip * 10000;
  return `${ip}.${String(fp).padStart(4, '0')}`;
}

/** FUNC 0x4E2D + atol: '147.0000' -> 1470000 (100 Hz units). */
export function freqUnits(s: string): number {
  const i = s.indexOf('.');
  const a = i < 0 ? s : s.slice(0, i), b = i < 0 ? '' : s.slice(i + 1);
  const v = parseInt(a + (b + '0000').slice(0, 4), 10);
  if (Number.isNaN(v)) throw new FM900Error(`bad frequency ${JSON.stringify(s)}`);
  return v;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------
export interface BuildInfo {
  master: string | null; step_khz: number; if_mhz: number;
  ch_min: number; ch_max: number; pw_min: number; pw_max: number;
}

export interface BuilderOptions {
  date?: Date;                      // build date (local calendar date); default today
  version?: [number, number];       // programmer version at 0x1FE0
  keys?: number[] | null;           // FM92 only: 4 function codes for 0x1F58..0x1F5B
  masters?: (name: string) => Uint8Array | undefined;
}

export class Builder {
  hw: string; sw: string;
  date: Date; version: [number, number]; keys: number[] | null;
  masters?: (name: string) => Uint8Array | undefined;
  ifo = 0; step = 0;
  warnings: string[] = [];
  info: BuildInfo | null = null;

  constructor(hw: string, sw: string, opts: BuilderOptions = {}) {
    this.hw = hw;
    this.sw = sw;
    this.date = opts.date ?? new Date();
    this.version = opts.version ?? [0x21, 0x12];
    this.keys = opts.keys ?? null;
    this.masters = opts.masters;
    this.checkCodes();
  }

  // -- code validation -------------------------------------------------
  checkCodes(): void {
    const { hw, sw } = this;
    if (hw.length !== 8 || !/^\d+$/.test(hw)) {
      throw new FM900Error(`hardware code must be 8 digits, got ${JSON.stringify(hw)}`);
    }
    if (sw.length !== 15 || !/^\d+$/.test(sw)) {
      throw new FM900Error(`software code must be 15 digits, got ${JSON.stringify(sw)}`);
    }
    if (!'12'.includes(hw[1])) {
      throw new FM900Error('only FM91 (hw digit 2 = 1) and FM92 (= 2) are supported; ' +
        'FM93 / "92 with 91 PCBs" builds are not implemented');
    }
    if (!'2345678'.includes(hw[2])) throw new FM900Error(`unknown band digit ${JSON.stringify(hw[2])}`);
    if (!'3478'.includes(hw[3])) throw new FM900Error(`unknown control/spacing digit ${JSON.stringify(hw[3])}`);
    if (this.keys !== null && hw[1] !== '2') {
      throw new FM900Error('key remapping is only valid for FM92 (on FM91, 0x1F58.. holds scan block 3)');
    }
    if ('237'.includes(hw[4])) {
      throw new FM900Error('water-proof mechanics (hw digit 5 = 2/3/7) use the FM97WP ' +
        'master, which is not supported by this tool');
    }
  }

  get model(): number {          // 1 = FM92, 2 = FM91   (switch in FUNC 0x52FD)
    return this.hw[1] === '2' ? 1 : 2;
  }

  masterName(): string {         // FUNC 0x8196
    const hw = this.hw;
    const sel = '3' <= hw[5] && hw[5] <= '5';
    if (hw[1] === '1') return sel ? 'FM91S.BIN' : 'FM91.BIN';
    if ('1357'.includes(hw[3])) return sel ? 'FM92LS.BIN' : 'FM92L.BIN';
    return sel ? 'FM92RS.BIN' : 'FM92R.BIN';
  }

  // -- synthesiser parameters ------------------------------------------
  ifOffset(): number {           // FUNC 0x4723: IF in 10 Hz units, sign = LO side
    const c = this.hw[3], b = this.hw[2];
    let v = ({ '1': 1070000, '2': 1070000, '3': 2140000, '4': 2140000,
      '5': 1070000, '6': 1070000, '7': 2140000, '8': 2140000 } as Record<string, number>)[c] ?? 0;
    if ('019'.includes(b)) v = 0;
    else if ('478'.includes(b)) v = -v;
    return v;
  }

  pickStep(chans: Channel[]): number {   // FUNC 0x4A35 / 0x4C99   (10 Hz units)
    const vhf = this.hw[2] <= '4';
    const wide = this.hw[3] <= '4';
    const order = vhf ? (wide ? [500, 625] : [625, 500]) : (wide ? [2500] : [1250]);
    const vals: number[] = [];
    for (const c of chans) {
      vals.push(freqUnits(c.rx) * 10);
      if (!c.tx.startsWith('X')) vals.push(freqUnits(c.tx) * 10);
    }
    for (const st of order) {
      if (vals.every((v) => v % st === 0)) return st;
    }
    throw new FM900Error(`frequencies are not all on a ${order.map((s) => s / 100).join(' or ')} kHz raster`);
  }

  divider(fstr: string, isRx: boolean): number {  // FUNC 0xAE7E
    let v = freqUnits(fstr) * 10;
    if (isRx) v += this.ifo;
    const q = Math.trunc(v / this.step);       // C long division truncates toward zero
    if (q < 0) throw new FM900Error(`frequency ${fstr} gives a negative divider`);
    const digs = String(q);
    let out = 0;
    for (let i = 0; i < 5; i++) {               // last 5 decimal digits, each one's-complemented
      const ch = i < digs.length ? digs[digs.length - 1 - i] : '0';
      const d = (~parseInt(ch, 10)) & 0xF;
      out |= d << (4 * i);
    }
    return out & 0x7FFFF;
  }

  // FUNC 0x5FE7: VCO band-switch bit for VHF receive frequencies.
  // True if rx is within [-40 kHz, +30 kHz] of a whole MHz ([-30,+15] on E-band).
  // The Python compares the exact values of the doubles (as the x87 does in 80-bit
  // precision).  f - ip is exact in doubles (Sterbenz: ip/2 <= f <= 2 ip for f >= 1),
  // so comparing it with lo/hi as doubles is exact too.
  vcoBit(rx: string): number {
    const [lo, hi] = this.hw[2] === '2' ? [-0.03, 0.015] : [-0.04, 0.03];
    const f = parseFloat(rx);
    const ip = Math.trunc(f + 0.5);
    const d = f - ip;
    if (lo > d) return 0;
    if (hi < d) return 0;
    return 1;
  }

  // -- per-channel record encoders --------------------------------------
  recPower(r: Uint8Array, c: Channel): void {   // FUNC 0x60C9
    const hw = this.hw, fl = c.flags;
    if (hw[2] <= '4' && hw[1] === '2') {
      if (fl & F_HIGH) r[5] |= 0x30;
      else if (fl & (F_MED | F_LOW)) r[5] = (r[5] & 0xCF) | 0x20;
    } else {
      if (fl & F_HIGH) r[5] |= 0x30;
      else if (fl & F_MED) r[5] = (r[5] & 0xCF) | 0x20;
      else if (fl & F_LOW) r[5] = (r[5] & 0xCF) | 0x10;
      else if (fl & F_SELPWR) r[5] &= 0xCF;
    }
    if (hw[2] >= '5') {
      const p = (r[5] >> 4) & 3;
      r[2] = (r[2] & 0xF7) | ((((~p) >> 1) & 1) << 3);
    }
    if (!(fl & F_VOTE)) r[7] &= 0xFE;
  }

  recFreqs(r: Uint8Array, c: Channel): void {   // FUNC 0x5A5D
    let n = this.divider(c.rx, true);
    r[0] = n & 0xFF;
    r[1] = (n >> 8) & 0xFF;
    r[2] = (r[2] & 0xF8) | ((n >> 16) & 7);
    r[2] |= 0x80;
    if (c.tx === 'XXXXXXXX') {
      r[5] &= 0x7F;
      r[5] |= 0x08;            // common exit at 0x5CA8
      return;
    }
    n = this.divider(c.tx, false);
    r[3] = n & 0xFF;
    r[4] = (n >> 8) & 0xFF;
    r[5] = (r[5] & 0xF8) | ((n >> 16) & 7);
    r[5] |= 0x80;
    const neg = this.ifo < 0;
    if (this.hw[2] <= '4') {
      if (neg) { r[2] &= 0xBF; r[5] |= 0x40; } else { r[2] |= 0x40; r[5] &= 0xBF; }
      if (this.vcoBit(c.rx)) r[2] |= 0x08; else r[2] &= 0xF7;
    } else {
      if (neg) { r[2] |= 0x40; r[5] &= 0xBF; } else { r[2] &= 0xBF; r[5] |= 0x40; }
    }
    r[5] |= 0x08;
  }

  recOptions(r: Uint8Array, c: Channel): void {  // FUNC 0x6226
    const fl = c.flags, sw = this.sw;
    if (c.ctcss) {
      for (const [code, val] of CTCSS) {
        if (code === c.ctcss) r[6] = (r[6] & 0xC0) | (val & 0x3F);
      }
    } else {
      r[6] &= 0xC0;
    }
    r[6] = (r[6] & 0xBF) | (fl & F_SCANSEL ? 0x40 : 0);
    r[6] = (r[6] & 0x7F) | (fl & F_SELCALL ? 0x80 : 0);
    const enc = parseInt(sw.slice(11, 13), 10);
    r[7] = (r[7] & 0x7F) | (((encTabWord(enc) >> 1) & 1) << 7);
    if (this.hw[1] !== '3') {
      if (!(fl & F_VOTE)) {
        r[7] &= 0xFB;
        r[7] &= 0xFD;
      }
      if (!(fl & (F_VOTE | F_SELCALL))) {
        r[7] = (r[7] & 0xFD) | (sw[2] === '2' ? 0x02 : 0);
        if (!(r[7] & 0x02)) r[7] = (r[7] & 0xFB) | (fl & F_ECON ? 0x04 : 0);
      }
      r[2] = (r[2] & 0xDF) | (fl & F_VOTE ? 0x20 : 0);
    }
    r[2] = fl & F_CR ? r[2] | 0x10 : r[2] & 0xEF;
  }

  loadMaster(): [string, Uint8Array] {
    const mname = this.masterName();
    const master = this.masters?.(mname);
    if (!master) throw new FM900Error(`master image ${mname} not found`);
    const ver = MASTER_VERSION[mname];
    if (master[0x1FE5] !== ver[0] || latin1(master.subarray(0x1FEB, 0x1FF0)) !== ver[1]) {
      throw new FM900Error(`${mname}: master contains incorrect version number`);
    }
    return [mname, master];
  }

  // -- main ------------------------------------------------------------
  build(chans: Channel[], master?: Uint8Array): Uint8Array {
    const { hw, sw } = this;
    let mname: string | null = null;
    if (master === undefined) [mname, master] = this.loadMaster();
    if (master.length !== IMG_SIZE) throw new FM900Error('master must be 8192 bytes');
    const img = new Uint8Array(master);
    this.warnings = [];

    // FUNC 0x123EA: initialise the selcall tone memory (not done for FM92L)
    if (mname !== 'FM92L.BIN') {
      img[0x1F67] = 0;
      for (const [a, n, v] of [[0x1F68, 9, 0x0F], [0x1F71, 9, 0], [0x1F7A, 1, 0],
        [0x1F7B, 9, 0x0F], [0x1F84, 9, 0], [0x1F8D, 9, 0x0F],
        [0x1F96, 9, 0x0F], [0x1F9F, 9, 0x0F]]) {
        img.fill(v, a, a + n);
      }
    }

    if (!chans.length) throw new FM900Error('no channels');
    this.ifo = this.ifOffset();
    this.step = this.pickStep(chans);

    // ---- FUNC 0x52FD: channel table --------------------------------
    const [base, nmax] = this.model === 1 ? [0x1BE8, 99] : [0x1B40, 120];   // FM92 / FM91
    if (chans.length > nmax) throw new FM900Error(`too many channels (${chans.length} > ${nmax})`);
    const used: number[][] = Array.from({ length: 0x79 }, () => [0, 0, 0]);   // DS:0xA85A {a,b,c}
    let top = nmax - 1;                                                         // DS:0xA858
    let chMin = 0x79, chMax = 0, pwMin = 25, pwMax = 1;

    const link = (slot: number, val: number) => {    // word at slot+6, bits 8..14
      const a = base + 8 * slot + 7;
      img[a] = (img[a] & 0x80) | (val & 0x7F);
    };

    const remap = (idx: number): number => {         // FUNC 0x5927
      if (used[idx][0] === 0) {
        used[idx] = [1, idx, idx];
        link(idx, idx);
        return idx;
      }
      if (top < 0) throw new FM900Error('out of channel slots');
      const cidx = used[idx][2];
      used[top][1] = used[cidx][1];
      used[cidx][1] = top;
      used[top][2] = cidx;
      used[idx][2] = top;
      link(top, used[top][1]);
      link(used[top][2], top);
      const r = top;
      top -= 1;
      return r;
    };

    for (const c of chans) {
      const n = c.num;
      if (!(n >= 1 && n <= nmax)) throw new FM900Error(`channel number ${n} out of range 1..${nmax}`);
      if (chMin > n) chMin = n;
      if (chMax < n) chMax = n;
      if (c.flags & F_HIGH && pwMax < 25) pwMax = 25;
      if (c.flags & F_MED && pwMax < 5) pwMax = 5;
      if (c.flags & F_MED && pwMin > 5) pwMin = 5;
      if (c.flags & F_LOW && pwMin > 1) pwMin = 1;
      let slot = n - 1;
      if (used[slot][0] || c.flags & F_VOTE) slot = remap(slot);
      if (slot < 0) throw new FM900Error('out of channel slots');
      const a = base + 8 * slot;
      const r = img.slice(a, a + 8);
      this.recPower(r, c);
      this.recFreqs(r, c);
      this.recOptions(r, c);
      img.set(r, a);
    }

    // ---- FUNC 0x6452: configuration block ---------------------------
    const d = this.date;
    const bcd = (x: number) => parseInt(String(x).padStart(2, '0'), 16);
    img[0x1FE2] = bcd(d.getDate());
    img[0x1FE3] = bcd(d.getMonth() + 1);
    img[0x1FE4] = bcd(d.getFullYear() % 100);
    this.options(img);                       // FUNC 0x6688 -> 0x1F32..0x1F37, 0x1F66
    // FUNC 0x7182 -> 0x1F38.., Tx timer and channel range
    img[0x1F38] = ({ '1': 0x07, '2': 0x13, '3': 0x1F, '4': 0x3D } as Record<string, number>)[sw[3]] ?? 0;
    img[0x1F3F] = chMin;
    img[0x1F3E] = chMax;
    this.scan(img, chans);                   // FUNC 0x77F7
    this.powerAndMisc(img, chMin, pwMin, pwMax);   // FUNC 0x7285
    if (this.keys !== null) {
      // Not part of FM900.EXE: override the FM92 programmable function keys.
      // These bytes are outside the 0x1F66 option checksum and the 0x1F65
      // signature, so only the 0x1F64 sum (recomputed below) is affected.
      img.set(this.keys, 0x1F58);
    }
    img[0x1FE0] = this.version[0];
    img[0x1FE1] = this.version[1];

    // ---- FUNC 0x30A0: checksums ----------------------------------------
    checksum(img);
    this.info = { master: mname, step_khz: this.step / 100, if_mhz: this.ifo / 100000,
      ch_min: chMin, ch_max: chMax, pw_min: pwMin, pw_max: pwMax };
    return img;
  }

  vcoWarnings(chans: Channel[]): string[] {   // FUNC 0xF7A6 (warning only)
    const tab = ({ '2': [3.0, 5.0, 9.0], '3': [5.5, 6.0, 7.0], '4': [6.0, 7.0, 8.0],
      '5': [10.0, 10.0, 17.0], '6': [10.0, 10.0, 28.0], '7': [10.0, 10.0, 30.0],
      '8': [10.0, 10.0, 17.0] } as Record<string, number[]>)[this.hw[2]];
    if (!tab || !chans.length) return [];
    const rx = chans.map((c) => parseFloat(c.rx));
    let tx = chans.filter((c) => !c.tx.startsWith('X')).map((c) => parseFloat(c.tx));
    if (!tx.length) tx = [0.0];
    const span = (v: number[]) => Math.max(...v) - Math.min(...v);
    const w: string[] = [];
    if (span(rx) > tab[0]) w.push('Rx - Rx switching bandwidth of VCO exceeded');
    else if (span(tx) > tab[1]) w.push('Tx - Tx switching bandwidth of VCO exceeded');
    else if (span([...rx, ...tx]) > tab[2]) w.push('Rx - Tx switching bandwidth of VCO exceeded');
    return w;
  }

  options(img: Uint8Array): void {          // FUNC 0x6688
    const { sw, hw } = this;
    const enc = parseInt(sw.slice(11, 13), 10), dec = parseInt(sw.slice(13, 15), 10);
    const bit = (cond: boolean, n: number) => (cond ? 1 << n : 0);
    img[0x1F33] = bit(sw[10] >= '1', 0) | bit('02'.includes(sw[0]), 1) | bit(sw[4] === '1', 2) |
      bit(sw[3] >= '1', 3) | bit(sw[5] === '3', 5) | (((encTabWord(enc) >> 2) & 1) << 6) |
      bit(sw[6] === '3', 7);
    img[0x1F34] = bit('1' <= sw[8] && sw[8] <= '7', 0) |
      bit(('3' <= sw[8] && sw[8] <= '4') || sw[8] === '7', 1) |
      bit('258'.includes(hw[5]), 2) | bit('246'.includes(sw[8]), 3) |
      bit('1' <= sw[6] && sw[6] <= '4', 4) | bit('36'.includes(hw[7]), 5) |
      bit(dec >= 50, 6) | bit('2' <= sw[6] && sw[6] <= '4', 7);
    img[0x1F35] = 0x01 | 0x80 | bit(sw[7] === '1', 1) | bit('1' <= sw[2] && sw[2] <= '3', 3) |
      bit('02'.includes(sw[1]), 4) | bit('23'.includes(sw[0]), 5) | bit(sw[10] === '2', 6);
    img[0x1F36] = ds(0x0AAE + 4 * dec) | ds(0x09CC + 4 * enc + 2);
    img[0x1F37] = ds(0x0AAF + 4 * dec) | ds(0x09CC + 4 * enc + 3);
    if (hw[1] === '1' || sw[1] < '2') img[0x1F37] |= 0x10;
    else img[0x1F37] &= 0xEF;
    let s = 0;
    for (let a = 0x1F33; a < 0x1F38; a++) s += img[a];
    img[0x1F66] = (-s) & 0xFF;
  }

  scan(img: Uint8Array, chans: Channel[]): void {   // FUNC 0x77F7
    const fm91 = this.model === 2;
    for (const a of [0x1F4B, 0x1F57, 0x1F40, 0x1F4C]) img[a] = 0;
    if (fm91) {
      img[0x1F63] = 0;
      img[0x1F58] = 0;
    }
    let n1 = 0, n2 = 0, n3 = 0;
    const tooMany = () => new FM900Error('more than 10 channels in a scan block');
    for (const c of chans) {
      if (n1 > 10 || n2 > 10 || n3 > 10) throw tooMany();
      const ch = c.num & 0xFF;
      if (c.flags & F_SCAN1) { img[0x1F41 + n1] = ch; n1++; img[0x1F4B]++; }
      if (c.flags & F_SCAN2) { img[0x1F4D + n2] = ch; n2++; img[0x1F57]++; }
      if (fm91 && c.flags & F_SCAN3) { img[0x1F59 + n3] = ch; n3++; img[0x1F63]++; }
      if (c.flags & F_PRI1) img[0x1F40] = ch;
      if (c.flags & F_PRI2) img[0x1F4C] = ch;
      if (fm91 && c.flags & F_PRI3) img[0x1F58] = ch;
    }
    if (n1 > 10 || n2 > 10 || n3 > 10) throw tooMany();
  }

  powerAndMisc(img: Uint8Array, chMin: number, pwMin: number, pwMax: number): void {   // FUNC 0x7285
    const { sw, hw } = this;
    img.set([0x00, 0x82, 0x00, 0x15, 0x09, 0x32, 0x1A, 0x82], 0x1F08);
    if (sw[5] === '6') {
      img[0x1F0A] = 0x09; img[0x1F0B] = 0x82; img[0x1F0E] = 0x09; img[0x1F0F] = 0x82;
      img[0x1F08] = 0x00; img[0x1F09] = 0x82; img[0x1F0C] = 0x09; img[0x1F0D] = 0x32;
    }
    if (this.model === 2) {        // FM91
      img[0x1F31] = chMin;
      return;
    }
    // FM92
    img[0x1F31] = chMin;
    img[0x1F58] = 1;
    img[0x1F59] = 2;
    if (sw[6] > '0') img[0x1F5A] = 5;
    if (sw[6] === '0' && sw[1] === '1') img[0x1F5A] = 6;
    if (img[0x1F37] & 0x40 && (parseInt(sw.slice(11, 13), 10) || parseInt(sw.slice(13, 15), 10))) {
      img[0x1F5A] = 8;
    }
    img[0x1F5B] = parseInt(sw.slice(11, 15), 10) > 0 ? 7 : 0;
    if (hw[2] > '4' || sw[5] === '6') return;
    const set = (a: number, ...v: number[]) => img.set(v, a);
    const low = () => { set(0x1F08, 0, 0x15); set(0x1F0C, 0, 0x15); };
    if (pwMin === 1) low();
    if (pwMin === 1 && pwMax === 1) { low(); set(0x1F0A, 0, 0); set(0x1F0E, 0, 0); }
    if (pwMin === 5) { set(0x1F08, 9, 0x32); set(0x1F0C, 9, 0x32); }
    if (pwMax === 5) { set(0x1F0A, 9, 0x32); set(0x1F0E, 9, 0x32); }
    if (pwMax === 5 && pwMin === 5) {
      set(0x1F0A, 0, 0); set(0x1F0E, 0, 0);
      set(0x1F08, 9, 0x32); set(0x1F0C, 9, 0x32);
    }
    if (pwMax === 25) { set(0x1F0A, 0x1A, 0x82); set(0x1F0E, 0x1A, 0x82); }
    if (pwMax === 25 && pwMin === 25) {
      set(0x1F0A, 0x1A, 0x82); set(0x1F0E, 0x1A, 0x82);
      set(0x1F08, 0, 0); set(0x1F0C, 0, 0);
    }
  }
}

export function checksum(img: Uint8Array): void {   // FUNC 0x30A0
  let s = 0;
  s = (s + img[0x1CC]) & 0xFFFF;
  s = (s - img[0x5CC]) & 0xFFFF;
  s ^= img[0x9CC];
  s = (s + img[0xDCC]) & 0xFFFF;
  s = (s + img[0x11CC]) & 0xFFFF;
  s = (s - img[0x15CC]) & 0xFFFF;
  s ^= img[0x19CC];
  s = (s + img[0x1ACC]) & 0xFFFF;
  img[0x1F65] = (-s) & 0xFF;
  img[0x1F64] = 0;
  let t = 0;
  for (const b of img) t += b;
  img[0x1F64] = (0xFF - (t & 0xFF)) & 0xFF;
}

export function verifyChecksum(img: Uint8Array): boolean {
  const t = new Uint8Array(img);
  checksum(t);
  return t[0x1F64] === img[0x1F64] && t[0x1F65] === img[0x1F65];
}

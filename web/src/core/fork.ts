// Enhanced FM92R firmware (../../firmware/fork): the per-channel Rx-frequency
// table its control-head display reads. A faithful port of firmware/fork/mkradio.py
// (fill_table, freq_nibbles, windows): change both together. mkradio.py stays the
// reference; test/fork.test.ts checks the two give byte-identical images.
import { decodeDivider } from './decode';

export const FQ_MAGIC = 0x19AC;    // "FQT1", keep in sync with fork.asm
export const FQ0 = 0x19B0;         // 4 arrays of 100 bytes, indexed by channel number
const NCH = 100;
const SLOTS = 0x1BE8;              // FM92 channel table, slot 0 = channel 1

/** True if img was built from the enhanced fork master. */
export function isForkImage(img: Uint8Array): boolean {
  return img.length >= 0x2000 && String.fromCharCode(...img.subarray(FQ_MAGIC, FQ_MAGIC + 4)) === 'FQT1';
}

/** Frequency in 100 Hz units -> 8 display nibbles (0xF = '.', 0xE = end). */
export function freqNibbles(f100: number): number[] {
  const mhz = Math.floor(f100 / 10000), frac = f100 % 10000;
  if (mhz < 1 || mhz > 999) throw new Error(`frequency ${mhz}.${String(frac).padStart(4, '0')} MHz out of range`);
  let dec = String(frac).padStart(4, '0');
  if (dec[3] === '0') dec = dec.slice(0, 3);
  const s = [...String(mhz)].map(Number).concat([0xF], [...dec].map(Number));
  while (s.length < 8) s.push(0xE);
  return s;
}

/** What the head shows: 2-character windows sliding one character at a time. */
export function windows(nibs: number[]): string[] {
  const ch = (n: number) => (n === 0xF ? ' ' : String(n));
  const out: string[] = [];
  for (let w = 1; w < 8 && nibs[w] !== 0xE; w++) out.push(ch(nibs[w - 1]) + ch(nibs[w]));
  return out;
}

export function tableEntry(img: Uint8Array, ch: number): number[] {
  return [0, 1, 2, 3].map((k) => img[FQ0 + k * NCH + ch]);
}

export function entryNibbles(b: number[]): number[] {
  return b.flatMap((x) => [x >> 4, x & 0xF]);
}

/** Write the frequency table into img from its channel slots (step and IF offset in 10 Hz units).
 *  Returns the channels filled. The caller recomputes the checksums. */
export function fillTable(img: Uint8Array, step: number, ifo: number): number[] {
  if (!isForkImage(img)) throw new Error('master has no frequency table (not the enhanced firmware)');
  img.fill(0, FQ0, FQ0 + 4 * NCH);
  const shown: number[] = [];
  for (let ch = 1; ch < 100; ch++) {
    const r = img.subarray(SLOTS + 8 * (ch - 1), SLOTS + 8 * ch);
    if (!(r[2] & 0x80)) continue;                       // empty slot
    const f10 = decodeDivider(r[0], r[1], r[2]) * step - ifo;
    const nibs = freqNibbles(Math.floor(f10 / 10));
    for (let k = 0; k < 4; k++) img[FQ0 + k * NCH + ch] = (nibs[2 * k] << 4) | nibs[2 * k + 1];
    shown.push(ch);
  }
  return shown;
}

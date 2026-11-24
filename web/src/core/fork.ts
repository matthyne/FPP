// FM92R fork firmware (../../firmware/fork): the start-up Morse callsign table
// and the per-channel Rx-frequency table its control-head display reads. A faithful
// port of firmware/fork/mkradio.py (morse_bytes, fill_morse, fill_table,
// freq_nibbles, windows): change both together. mkradio.py stays the reference;
// test/fork.test.ts checks the two give byte-identical images.
import { decodeDivider } from './decode';

export const MO_MAGIC = 0x1978;    // "MOR1", keep in sync with fork.asm
export const MO_TAB = 0x197C;
export const MO_LEN = 48;          // bytes, including the 0 terminator

export const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', '0': '-----', '1': '.----',
  '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
  '9': '----.', '/': '-..-.', '?': '..--..', '.': '.-.-.-', ',': '--..--', '=': '-...-',
};

/** True if img has the start-up ident (either fork variant). */
export function hasIntro(img: Uint8Array): boolean {
  return img.length >= 0x2000 && String.fromCharCode(...img.subarray(MO_MAGIC, MO_MAGIC + 4)) === 'MOR1';
}

/** Callsign text -> table bytes: 1 dit, 3 dah, 0x80 end of letter, 0x81 word space, 0 end. Throws on bad input. */
export function morseBytes(text: string): number[] {
  const out: number[] = [];
  for (const word of text.toUpperCase().split(/\s+/).filter(Boolean)) {
    if (out.length) out[out.length - 1] = 0x81;
    for (const c of word) {
      const m = MORSE[c];
      if (!m) throw new Error(`no Morse code for "${c}" (letters, digits and / ? . , = only)`);
      out.push(...[...m].map((e) => (e === '.' ? 1 : 3)), 0x80);
    }
  }
  out.push(0);
  if (out.length > MO_LEN) throw new Error(`callsign too long for the Morse table (${out.length} of ${MO_LEN} bytes)`);
  return out;
}

/** Ident speed of the fork firmware (fork.asm MO_UNIT: 5 x 13.3 ms = 66.5 ms per unit). */
export const MORSE_WPM = 18;
export const MORSE_UNIT_S = 0.0665;

/** How long the start-up ident blocks, in seconds (as fork.asm `intro` times it; 1 s with no callsign). */
export function identSeconds(text: string): number {
  const b = morseBytes(text);
  if (b[0] === 0) return 15 * MORSE_UNIT_S;
  let units = 0;
  for (const x of b) units += x === 0 ? 6 : x === 0x80 ? 2 : x === 0x81 ? 6 : x + 1;
  return units * MORSE_UNIT_S;
}

export function fillMorse(img: Uint8Array, text: string): void {
  if (!hasIntro(img)) throw new Error('master has no start-up ident');
  const b = morseBytes(text);
  img.fill(0, MO_TAB, MO_TAB + MO_LEN);
  img.set(b, MO_TAB);
}

/** Read the callsign back out of an image (best effort; '' if none or unreadable). */
export function readMorse(img: Uint8Array): string {
  if (!hasIntro(img)) return '';
  const rev = new Map(Object.entries(MORSE).map(([k, v]) => [v, k]));
  let text = '', letter = '';
  for (let i = MO_TAB; i < MO_TAB + MO_LEN && img[i]; i++) {
    const b = img[i];
    if (b === 1 || b === 3) letter += b === 1 ? '.' : '-';
    else if (b === 0x80 || b === 0x81) {
      const c = rev.get(letter);
      if (!c) return '';
      text += c + (b === 0x81 ? ' ' : '');
      letter = '';
    } else return '';
  }
  return text.trim();
}

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
  if (dec[3] === '0') {                     // 4 decimals only when the 100 Hz digit is used (12.5 kHz etc.)
    dec = dec.slice(0, 3);
    if (dec[2] === '0') dec = dec.slice(0, 2);  // and one trailing 0 less (147.450 -> 147.45, 146.500 -> 146.50)
  }
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

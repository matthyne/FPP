// EPROM part sizes. The radio decodes 13 address lines (8 KB), but the larger 28-pin
// parts drop into the 2764 socket: their extra address lines land on pins the board
// holds at a fixed level (27128 A13 = pin 26, NC on a 2764; 27256 A14 = pin 27, PGM,
// tied high; 27512 A15 = pin 1, Vpp, tied to Vcc). Mirroring the 8 KB image into every
// bank makes the chip work whatever level those pins sit at.
//
// This is post-processing only: the Builder (the faithful FM900.EXE port) always makes
// the 8 KB image.
import { FM900Error, IMG_SIZE } from './fm900';

export type EpromPart = '2764' | '27128' | '27256' | '27512';

export interface EpromInfo {
  part: EpromPart;
  size: number;      // bytes
  minipro: string;   // minipro -p device name
  extra: string;     // which extra address pin(s) the part has, for the hint
}

export const EPROMS: EpromInfo[] = [
  { part: '2764', size: 0x2000, minipro: '2764', extra: '' },
  { part: '27128', size: 0x4000, minipro: '27128', extra: 'A13 on pin 26' },
  { part: '27256', size: 0x8000, minipro: '27C256', extra: 'A13 on pin 26, A14 on pin 27' },
  { part: '27512', size: 0x10000, minipro: '27C512', extra: 'A13 on pin 26, A14 on pin 27, A15 on pin 1' },
];

export const DEFAULT_EPROM: EpromPart = '2764';

export function eprom(part: string | undefined): EpromInfo {
  return EPROMS.find((e) => e.part === part) ?? EPROMS[0];
}

/** The 8 KB image copied into every bank of the chosen part. */
export function expandImage(img: Uint8Array, part: string | undefined): Uint8Array {
  if (img.length !== IMG_SIZE) throw new FM900Error('image must be 8192 bytes');
  const { size } = eprom(part);
  const out = new Uint8Array(size);
  for (let o = 0; o < size; o += IMG_SIZE) out.set(img, o);
  return out;
}

export interface Banks {
  part: EpromInfo;
  banks: Uint8Array[];   // 8 KB views, bank 0 first
  mirrored: boolean;     // every bank identical
}

/** Split a chip-sized image into 8 KB banks; null if the size matches no part. */
export function splitBanks(data: Uint8Array): Banks | null {
  const part = EPROMS.find((e) => e.size === data.length);
  if (!part) return null;
  const banks: Uint8Array[] = [];
  for (let o = 0; o < data.length; o += IMG_SIZE) banks.push(data.subarray(o, o + IMG_SIZE));
  const mirrored = banks.every((b) => b.every((x, i) => x === banks[0][i]));
  return { part, banks, mirrored };
}

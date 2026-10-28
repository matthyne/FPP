// Image decoder: a port of fm900gen.py dump(), plus a best-effort read-back of an
// EPROM image into an editable channel list.
import {
  Builder, CTCSS, Channel, FM900Error, latin1, verifyChecksum,
  F_HIGH, F_MED, F_LOW, F_SELPWR, F_VOTE, F_ECON, F_SELCALL, F_CR, F_SCANSEL,
  F_SCAN1, F_SCAN2, F_SCAN3, F_PRI1, F_PRI2, F_PRI3,
} from './fm900';
import { BAND_MHZ } from './codes';

export function decodeDivider(b0: number, b1: number, b2: number): number {
  const digs = [(~b0) & 0xF, (~(b0 >> 4)) & 0xF, (~b1) & 0xF, (~(b1 >> 4)) & 0xF, (~b2) & 0x7];
  return digs[0] + 10 * digs[1] + 100 * digs[2] + 1000 * digs[3] + 10000 * digs[4];
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

function bareBuilder(hw: string): Builder {
  const b = Object.create(Builder.prototype) as Builder;
  b.hw = hw;
  return b;
}

/** 2 = FM92, 1 = FM91 (hw digit 2), guessed from the master ID when no HW code is given. */
export function imageModel(img: Uint8Array, hw?: string): string {
  if (hw) return hw[1];
  const id = latin1(img.subarray(0x1FEB, 0x1FF0));
  return id === '0020:' || id === '01045' ? '1' : '2';
}

export function tableBase(model: string): [number, number] {
  return model === '2' ? [0x1BE8, 99] : [0x1B40, 120];
}

/** Text dump, identical in layout to `fm900gen.py dump`. */
export function dump(img: Uint8Array, hw?: string, step?: number): string {
  const out: string[] = [];
  const model = imageModel(img, hw);
  const [base, n] = tableBase(model);
  out.push(`model FM9${model}, version byte 0x1FE5=${img[0x1FE5]}, id "${latin1(img.subarray(0x1FEB, 0x1FF0))}", ` +
    `built ${hex2(img[0x1FE2])}/${hex2(img[0x1FE3])}/${hex2(img[0x1FE4])} (DD/MM/YY)`);
  out.push(`checksum 0x1F64=${hex2(img[0x1F64])} 0x1F65=${hex2(img[0x1F65])} (${verifyChecksum(img) ? 'OK' : 'BAD'})`);
  out.push(`channels ${img[0x1F3F]}..${img[0x1F3E]}`);
  let ifo: number | null = null;
  if (hw) {
    ifo = bareBuilder(hw).ifOffset();
    if (!step) {
      try { step = bareBuilder(hw).pickStep([]); } catch (e) { if (!(e instanceof FM900Error)) throw e; }
    }
  }
  out.push('slot  raw                       rxN    txN   pwr ctcss flags');
  for (let i = 0; i < n; i++) {
    const r = img.subarray(base + 8 * i, base + 8 * i + 8);
    if (!r.some((x) => x)) continue;
    const rxn = decodeDivider(r[0], r[1], r[2]);
    const txn = decodeDivider(r[3], r[4], r[5]);
    const ct = r[6] & 0x3F;
    const code = ct ? (CTCSS.find(([, v]) => v === ct)?.[0] ?? '') : '';
    let line = `${String(i + 1).padStart(3)}   ${[...r].map(hex2).join(' ')}  ${String(rxn).padStart(5)}  ` +
      `${String(txn).padStart(5)}   ${(r[5] >> 4) & 3}   ${code.padEnd(3)}  b2=${hex2(r[2] & 0xF8)} ` +
      `b5=${hex2(r[5] & 0xF8)} b6=${hex2(r[6] & 0xC0)} b7=${hex2(r[7])}`;
    if (step && ifo !== null) {
      line += `   rx ${((rxn * step - ifo) / 100000).toFixed(4)} tx ${(txn * step / 100000).toFixed(4)}`;
    }
    out.push(line);
  }
  return out.join('\n');
}

export interface Readback { channels: Channel[]; step: number; warnings: string[] }

function mhz(units10: number): string {
  // 10 Hz units -> 'MHz.dddd' (5 decimals if not on a 100 Hz boundary)
  const s = (units10 / 100000).toFixed(units10 % 10 ? 5 : 4);
  return s;
}

/**
 * Turn an image back into a channel list.  Needs the HW code (several codes map to
 * the same bits).  Duplicate/VOTE ring slots allocated from the top of the table are
 * attached to their primary channel by following the ring links.  Best effort: the
 * entry order of the original list (which decides scan-list order) is not recoverable.
 */
export function readImage(img: Uint8Array, hw: string, stepOverride?: number): Readback {
  if (img.length !== 0x2000) throw new FM900Error('image must be 8192 bytes');
  const b = bareBuilder(hw);
  const warnings: string[] = [];
  const model = hw[1];
  const [base, n] = tableBase(model);
  const ifo = b.ifOffset();
  const chMax = img[0x1F3E];
  const slots: number[] = [];
  for (let i = 0; i < n; i++) if (img.subarray(base + 8 * i, base + 8 * i + 8).some((x) => x)) slots.push(i);

  // pick the step that puts the decoded frequencies near the band (no warning: radios get re-tuned)
  const vhf = hw[2] <= '4', wide = hw[3] <= '4';
  const cands = stepOverride ? [stepOverride] : vhf ? (wide ? [500, 625] : [625, 500]) : (wide ? [2500] : [1250]);
  const [lo, hi] = BAND_MHZ[hw[2]] ?? [0, 1e9];
  const tol = hw[2] <= '4' ? 5 : 15;   // radios are often re-tuned a little outside the nominal band
  const inBand = (st: number) => slots.every((i) => {
    const r = img.subarray(base + 8 * i, base + 8 * i + 8);
    const f = (decodeDivider(r[0], r[1], r[2]) * st - ifo) / 100000;
    return f >= lo - tol && f <= hi + tol;
  });
  const step = cands.find(inBand) ?? cands[0];

  const rec = (i: number) => img.subarray(base + 8 * i, base + 8 * i + 8);
  const primaryOf = (i: number): number => {
    // ring slots above the highest channel number: walk the ring to a primary slot
    let j = i;
    for (let k = 0; k <= n; k++) {
      if (j < chMax) return j;
      j = rec(j)[7] & 0x7F;
      if (j >= n) break;
    }
    warnings.push(`slot ${i + 1}: could not find its channel in the ring; kept as channel ${i + 1}`);
    return i;
  };

  const prim = slots.filter((i) => i < chMax);
  const ring = slots.filter((i) => i >= chMax).reverse();   // allocated from the top down
  const chans: Channel[] = [];
  for (const i of [...prim, ...ring]) {
    const r = rec(i);
    const num = (i < chMax ? i : primaryOf(i)) + 1;
    const rxu = decodeDivider(r[0], r[1], r[2]) * step - ifo;
    const rx = mhz(rxu);
    const tx = r[5] & 0x80 ? mhz(decodeDivider(r[3], r[4], r[5]) * step) : 'XXXXXXXX';
    let flags = [F_SELPWR, F_LOW, F_MED, F_HIGH][(r[5] >> 4) & 3];
    if (r[6] & 0x40) flags |= F_SCANSEL;
    if (r[6] & 0x80) flags |= F_SELCALL;
    if (r[2] & 0x20) flags |= F_VOTE;
    if (r[2] & 0x10) flags |= F_CR;
    if (!(r[2] & 0x20) && r[7] & 0x04) flags |= F_ECON;
    const ct = r[6] & 0x3F;
    const ctcss = ct ? (CTCSS.find(([, v]) => v === ct)?.[0] ?? '') : '';
    if (ct && !ctcss) warnings.push(`channel ${num}: unknown CTCSS code ${ct}`);
    if (rx.length > 9 || (tx.length > 9 && tx[0] !== 'X')) {
      warnings.push(`channel ${num}: frequency not on a 100 Hz boundary`);
    }
    chans.push({ num, rx, tx, flags, ctcss });
  }

  // scan blocks
  const mark = (ch: number, f: number) => {
    const c = chans.find((x) => x.num === ch);
    if (c) c.flags |= f;
    else if (ch) warnings.push(`scan list names channel ${ch}, which is empty`);
  };
  const blocks: [number, number, number, number, number][] = [[0x1F41, 0x1F4B, 0x1F40, F_SCAN1, F_PRI1],
    [0x1F4D, 0x1F57, 0x1F4C, F_SCAN2, F_PRI2]];
  if (model === '1') blocks.push([0x1F59, 0x1F63, 0x1F58, F_SCAN3, F_PRI3]);
  for (const [list, cnt, pri, fm, fp] of blocks) {
    const k = Math.min(img[cnt], 10);
    for (let j = 0; j < k; j++) mark(img[list + j], fm);
    if (img[pri]) mark(img[pri], fp);
  }
  if (!verifyChecksum(img)) warnings.push('image checksum is BAD');
  return { channels: chans, step, warnings };
}

/** Function codes for head keys 1/2/4/7 on FM92 images. */
export function imageKeys(img: Uint8Array): number[] {
  return [...img.subarray(0x1F58, 0x1F5C)];
}

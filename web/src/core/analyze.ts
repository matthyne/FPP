// Live analysis of a project for the UI: per-row problems plus a trial build.
import { Builder, Channel, FM900Error, F_VOTE, freqUnits } from './fm900';
import { master } from './masters';
import { Project, isBlank, parseDate, rowToChannel } from './project';

export interface Analysis {
  chans: Channel[];
  rowErrors: Map<number, string>;
  rowWarnings: Map<number, string[]>;
  codeError: string | null;      // HW/SW code problem
  buildError: string | null;
  img: Uint8Array | null;
  builder: Builder | null;
  vcoWarnings: string[];
  defaultKeys: number[] | null;  // FM92 key codes FM900.EXE would write
  nmax: number;
}

export function analyze(p: Project): Analysis {
  const a: Analysis = { chans: [], rowErrors: new Map(), rowWarnings: new Map(), codeError: null,
    buildError: null, img: null, builder: null, vcoWarnings: [], defaultKeys: null, nmax: p.hw[1] === '1' ? 120 : 99 };
  const warn = (i: number, m: string) => a.rowWarnings.set(i, [...(a.rowWarnings.get(i) ?? []), m]);
  const rowOf: number[] = [];
  const seen = new Map<number, number>();

  p.rows.forEach((r, i) => {
    if (isBlank(r)) return;
    let c: Channel;
    try {
      c = rowToChannel(r);
    } catch (e) {
      if (!(e instanceof FM900Error)) throw e;
      a.rowErrors.set(i, e.message);
      return;
    }
    if (c.num < 1 || c.num > a.nmax) a.rowErrors.set(i, `channel number must be 1..${a.nmax}`);
    // No out-of-band warning: radios are often re-tuned outside their nominal band (e.g. into the amateur bands).
    if (seen.has(c.num) && !(c.flags & F_VOTE)) warn(i, `duplicate of channel ${c.num} (row ${seen.get(c.num)! + 1}): uses a ring slot`);
    if (!seen.has(c.num)) seen.set(c.num, i);
    a.chans.push(c);
    rowOf.push(i);
  });

  let b: Builder;
  try {
    b = new Builder(p.hw, p.sw, { date: parseDate(p.date), keys: p.keys, masters: master });
  } catch (e) {
    if (!(e instanceof FM900Error)) throw e;
    a.codeError = e.message;
    return a;
  }
  a.builder = b;

  // flag off-raster rows against the preferred step
  const vhf = p.hw[2] <= '4', wide = p.hw[3] <= '4';
  const order = vhf ? (wide ? [500, 625] : [625, 500]) : (wide ? [2500] : [1250]);
  const fits = (st: number, c: Channel) => [c.rx, c.tx].every((f) => f.startsWith('X') || (freqUnits(f) * 10) % st === 0);
  const step = order.find((st) => a.chans.every((c) => fits(st, c)));
  if (step === undefined) {
    a.chans.forEach((c, k) => {
      if (!fits(order[0], c)) warn(rowOf[k], `not on the ${order[0] / 100} kHz raster`);
    });
  }

  if (a.rowErrors.size) {
    a.buildError = `fix the ${a.rowErrors.size} row error${a.rowErrors.size > 1 ? 's' : ''} first`;
    return a;
  }
  if (!a.chans.length) {
    a.buildError = 'no channels';
    return a;
  }
  try {
    a.img = b.build(a.chans);
    a.vcoWarnings = b.vcoWarnings(a.chans);
    if (p.hw[1] === '2') {
      if (p.keys === null) a.defaultKeys = [...a.img.subarray(0x1F58, 0x1F5C)];
      else {
        const d = new Builder(p.hw, p.sw, { date: parseDate(p.date), masters: master }).build(a.chans);
        a.defaultKeys = [...d.subarray(0x1F58, 0x1F5C)];
      }
    }
  } catch (e) {
    if (!(e instanceof FM900Error)) throw e;
    a.buildError = e.message;
  }
  return a;
}

// Printable one-page A4 channel cheat sheet (PDF): a radio header, then channel number,
// Rx, Tx and name for every record, in record order, in 1–3 columns sized to fit the page.
import { Analysis } from './analyze';
import { Segment, splitCallsigns } from './callsign';
import { BLUE_KEYS, KEY_BLUE, headButtons } from './codes';
import { eprom } from './eprom';
import { ICONS, IconName } from './icons';
import { F_PRI1, F_PRI2, F_PRI3, F_SCAN1, F_SCAN2, F_SCAN3 } from './fm900';
import { A4, A5, Colour, Font, PdfPage, textWidth } from './pdf';
import { Project, isBlank, rowToChannel } from './project';
import { VERSION_LABEL } from '../version';

/** `scan` = the scan groups (1-based) the channel is in, `pri` = the groups it is the priority channel of; FM91 has 3 groups, FM92 2. */
export interface SheetEntry { num: string; rx: string; tx: string; name: string; scan: number[]; pri: number[]; duplex: boolean }

/** Valid, non-blank rows in record order. Rows with errors are skipped (`skipped` counts them). */
export function sheetEntries(p: Project): { entries: SheetEntry[]; skipped: number } {
  const entries: SheetEntry[] = [];
  let skipped = 0;
  const fm91 = p.hw[1] === '1';
  const groups = fm91 ? [F_SCAN1, F_SCAN2, F_SCAN3] : [F_SCAN1, F_SCAN2];
  const pris = fm91 ? [F_PRI1, F_PRI2, F_PRI3] : [F_PRI1, F_PRI2];
  for (const r of p.rows) {
    if (isBlank(r)) continue;
    try {
      const c = rowToChannel(r);
      entries.push({ num: String(c.num), rx: c.rx, tx: c.tx.startsWith('X') ? 'Rx only' : c.tx, name: (r.name ?? '').trim(),
        scan: groups.flatMap((f, g) => (r.flags & f ? [g + 1] : [])),
        pri: pris.flatMap((f, g) => (r.flags & f ? [g + 1] : [])),
        duplex: !c.tx.startsWith('X') && parseFloat(c.tx) !== parseFloat(c.rx) });
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
}

// Channel-number badge colours: black = not scanned, then one colour per scan group. They also
// differ in lightness, so they stay distinguishable on a greyscale printout.
export const BADGE_PLAIN: Colour = 0.15;
export const SCAN_COLOURS: Colour[] = [[0.13, 0.42, 0.86], [0.90, 0.45, 0.02], [0.08, 0.50, 0.28]];

/** A channel badge: one horizontal band per scan group, top to bottom (solid when 0 or 1 group), with the text centred
 *  in white. A priority channel gets a white folded corner (triangle) at the top right. */
function badge(page: PdfPage, x: number, y: number, w: number, h: number, scan: number[], text: string, font: Font, size: number,
  base: number, priority = false, fill?: Colour, ink: Colour = 1): void {
  if (!scan.length) page.rect(x, y, w, h, fill ?? BADGE_PLAIN);
  else scan.forEach((g, k) => page.rect(x, y + (k * h) / scan.length, w, h / scan.length, SCAN_COLOURS[g - 1]));
  if (priority) {
    const c = h * 0.6;
    page.poly([[x + w - c, y], [x + w, y], [x + w, y + c]], 1);
  }
  page.text(x + (w - textWidth(text, font, size)) / 2, base, text, font, size, ink);
}

/** Firmware (image) description, as on the Build tab's Firmware menu. */
const FW: Record<string, string> = { standard: 'Factory', intro: 'Start-up ident', enhanced: 'Ident + Rx freq.' };
/** Experimental images: the image description is drawn in this amber (= the UI's light-theme --warn, #975a06). */
const EXP_COLOUR: Colour = [0.592, 0.353, 0.024];

/** One header item: an optional status-bar icon and its text. */
interface InfoItem { icon?: IconName; text: string; colour?: Colour }

/** Lay header items left to right from (x0, after y), wrapping within maxW. Returns the last baseline. */
function infoLine(page: PdfPage, items: InfoItem[], x0: number, y: number, maxW: number, size = 9): number {
  const iconW = size + 2.5, GAP = size * 1.2, LH = size * 1.33;
  let cx = x0;
  y += LH;
  for (const it of items) {
    const text = fit(it.text, 'Helvetica', size, maxW - (it.icon ? iconW : 0));
    const w = (it.icon ? iconW : 0) + textWidth(text, 'Helvetica', size);
    if (cx > x0 && cx + w > x0 + maxW) { cx = x0; y += LH; }
    if (it.icon) {
      page.icon(ICONS[it.icon], cx, y - size * 0.86, size, it.colour ?? 0.25);
      cx += iconW;
    }
    page.text(cx, y, text, 'Helvetica', size, it.colour ?? 0);
    cx += textWidth(text, 'Helvetica', size) + GAP;
  }
  return y;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Cut `s` so it is at most `maxW` points wide, with an ellipsis if anything was dropped. */
function fit(s: string, font: Font, size: number, maxW: number): string {
  if (textWidth(s, font, size) <= maxW) return s;
  const g = [...s];
  while (g.length && textWidth(g.join('') + '…', font, size) > maxW) g.pop();
  return g.length ? g.join('').trimEnd() + '…' : '';
}

const segFont = (g: Segment): Font => (g.call ? 'Helvetica-Bold' : 'Helvetica');

/** A name as runs of regular text and bold callsigns, cut to `maxW` points with an ellipsis if needed. */
export function fitName(name: string, size: number, maxW: number): Segment[] {
  const segs = splitCallsigns(name);
  const width = (gs: Segment[]) => gs.reduce((w, g) => w + textWidth(g.text, segFont(g), size), 0);
  if (width(segs) <= maxW) return segs;
  const ell = textWidth('…', 'Helvetica', size);
  const out: Segment[] = [];
  let used = 0;
  for (const g of segs) {
    const w = textWidth(g.text, segFont(g), size);
    if (used + w + ell <= maxW) { out.push(g); used += w; continue; }
    const cs = [...g.text];
    while (cs.length && used + textWidth(cs.join(''), segFont(g), size) + ell > maxW) cs.pop();
    if (cs.length) out.push({ text: cs.join(''), call: g.call });
    break;
  }
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text.trimEnd() };
  out.push({ text: '…', call: false });
  return out;
}

/** Column geometry, in points. `nameW` = room left for the name. */
export interface SheetLayout { cols: number; perCol: number; lineH: number; fontSize: number; nameW: number }

const MARGIN_A4 = 36;
const GAP = 14;              // between columns
// Column widths in em (Helvetica digits are all 0.556 em, so frequencies still line up):
// badge = 3 digits + 0.3 em padding each side, then a 0.6 em gap; a frequency (4.17 em) + 1 em gap.
// MARK_EM = extra room between Tx and Name for the duplex arrow (⇅, drawn centred in the gap).
const PAD = 0.3, CH_EM = 3 * 0.556 + 2 * PAD + 0.6, FREQ_EM = 5.2, MARK_EM = 1.1, MIN_NAME_EM = 7;
// Adaptive layout: names get up to NAME_CAP_EM (about 28 characters) before being cut; text up to FS_MAX points;
// a row is LINE x the font (at least).
const NAME_CAP_EM = 14, FS_MAX = 14, LINE = 1.3;

/** Layout inputs besides the record count and area, all in em except `minLineH`. */
export interface LayoutOpts {
  rxEm?: number;       // Rx column (frequency + gap): FREQ_EM, or one digit less with 3 decimals
  txEm?: number;       // Tx column: as rxEm, or narrower when it shows the shift
  nameEm?: number;     // longest name (measured), capped at NAME_CAP_EM
  minLineH?: number;   // shortest row, in points (A4 10, Mini (A5) 8.8)
}

/** Adaptive layout: for 1, 2 and 3 columns, the biggest font that fits both the height (rows of LINE x font) and the
 *  width (badge, Rx, Tx, arrow and a name column wide enough for the longest name, capped at NAME_CAP_EM, at least
 *  MIN_NAME_EM). Keeps the biggest; more columns only when the text gets clearly (3%) bigger. Rows then spread up to
 *  1.6 x the font. Never smaller than minLineH allows, except when 3 columns still don't fit. */
export function sheetLayout(n: number, width: number, height: number, o: LayoutOpts = {}): SheetLayout {
  const rxEm = o.rxEm ?? FREQ_EM, txEm = o.txEm ?? FREQ_EM, minLineH = o.minLineH ?? 10;
  const needEm = Math.min(Math.max(o.nameEm ?? MIN_NAME_EM, MIN_NAME_EM), NAME_CAP_EM);
  const fixedEm = CH_EM + rxEm + txEm + MARK_EM;
  let best: SheetLayout | null = null;
  for (let cols = 1; cols <= 3; cols++) {
    const perCol = Math.max(1, Math.ceil(n / cols));
    const colW = (width - GAP * (cols - 1)) / cols;
    const rowH = height / (perCol + 1);                                  // +1 = column heading
    const fontSize = Math.min(FS_MAX, rowH / LINE, colW / (fixedEm + needEm));
    const L = { cols, perCol, lineH: Math.min(rowH, fontSize * 1.6), fontSize, nameW: colW - fixedEm * fontSize };
    if (rowH < minLineH && cols < 3) continue;                           // rows too short: needs more columns
    if (!best || fontSize > best.fontSize * 1.03) best = L;
  }
  return best!;
}

/** Sheet size: 'a4' = full page; 'a5' = "Mini (A5)", an A5 page (148 x 210 mm), to stick on the side of the radio: narrower margins,
 *  the header scaled to 75% and tighter rows. Both sizes show frequencies with 3 decimals when all are on the 25 kHz raster. */
export type SheetSize = 'a4' | 'a5';

/** User options (PDF dialog tick boxes). */
export interface SheetOpts {
  landscape?: boolean;   // turn the page sideways when that gives bigger text (then usually two columns)
  shift?: boolean;       // Tx column shows the shift from Rx (+0.6, –5) on duplex channels, blank on simplex
}

/** Tx shift from Rx in MHz, e.g. "+0.6", "–5", "+0.025" (en dash for minus: WinAnsi has no U+2212). */
export function shiftText(rx: string, tx: string): string {
  const d = Math.round((parseFloat(tx) - parseFloat(rx)) * 10000) / 10000;
  return (d > 0 ? '+' : '\u2013') + String(Math.abs(d));
}

/** True when `f` (MHz, 4 decimals) is a whole multiple of 25 kHz. */
export const on25k = (f: string) => /^\d+\.\d{4}$/.test(f) && Math.round(parseFloat(f) * 10000) % 250 === 0;

/** Frequencies as shown: 4 decimals, or 3 when `short` (every frequency on the sheet is on the 25 kHz raster). */
export function freqText(f: string, short: boolean): string {
  return short && on25k(f) ? f.slice(0, -1) : f;
}

export function cheatSheet(p: Project, a?: Pick<Analysis, 'img' | 'builder' | 'defaultKeys'>, size: SheetSize = 'a4',
  opts: SheetOpts = {}): Uint8Array {
  const portrait = drawSheet(p, a, size, false, opts);
  if (!opts.landscape) return portrait.bytes;
  const land = drawSheet(p, a, size, true, opts);
  return land.fontSize > portrait.fontSize * 1.03 ? land.bytes : portrait.bytes;
}

function drawSheet(p: Project, a: Pick<Analysis, 'img' | 'builder' | 'defaultKeys'> | undefined, size: SheetSize,
  landscape: boolean, opts: SheetOpts): { bytes: Uint8Array; fontSize: number } {
  const half = size === 'a5';
  const [pw, ph] = half ? A5 : A4;
  const page = landscape ? new PdfPage(ph, pw) : new PdfPage(pw, ph);
  const MARGIN = half ? 20 : MARGIN_A4;               // page margin
  const S = half ? 0.75 : 1;                          // header scale
  const W = page.width - 2 * MARGIN;
  const { entries: all, skipped } = sheetEntries(p);
  // Drop the 4th decimal (always 0 then) when every frequency on the sheet is on the 25 kHz raster: more room for names.
  const short = all.length > 0 && all.every((e) => [e.rx, e.tx].every((f) => f === 'Rx only' || on25k(f)));
  const entries = all.map((e) => ({ ...e, rx: freqText(e.rx, short),
    tx: !opts.shift || e.tx === 'Rx only' ? freqText(e.tx, short) : e.duplex ? shiftText(e.rx, e.tx) : '' }));
  const rxEm = short ? FREQ_EM - 0.556 : FREQ_EM;
  const txHead = opts.shift ? 'Shift' : 'Tx MHz';
  // Shift column: as wide as its widest text (or heading) plus a 1 em gap.
  const txEm = opts.shift ? Math.max(textWidth(txHead, 'Helvetica-Bold', 1), ...entries.map((e) => textWidth(e.tx, 'Helvetica', 1))) + 1
    : rxEm;
  const model = p.hw[1] === '1' ? 'FM91' : p.hw[1] === '2' ? 'FM92' : p.hw[1] === '3' ? 'FM93' : 'FM9?';

  // Legend boxes, side by side at the top right: head buttons (FM92) and scan-group colours.
  // Rows: [badge text, badge groups (null = plain), description, priority corner]. Header text goes to the left.
  const buttons = headButtons(p, a?.defaultKeys);
  const boxRow = 12.5 * S, BOX_GAP = 8 * S;
  type LegendRow = [string, number[] | null, string, boolean?, Colour?];   // 5th = badge fill (blue head keys)
  const boxes: [string, LegendRow[]][] = [];
  if (buttons) boxes.push(['Head buttons', buttons.map(([b, f]): LegendRow => [b, null, f, false, BLUE_KEYS.has(b) ? KEY_BLUE : undefined])]);
  const used = [...new Set(entries.flatMap((e) => e.scan))].sort();
  if (used.length) {
    const rows: LegendRow[] = used.map((g) => [`${g}`, [g], `Scan group ${g}`]);
    const multi = [...new Set(entries.filter((e) => e.scan.length > 1).map((e) => e.scan.join('+')))];
    for (const m of multi) rows.push([m, m.split('+').map(Number), `In groups ${m.replace(/\+/g, ' and ')}`]);
    const pg = [...new Set(entries.flatMap((e) => e.pri))].sort();
    if (pg.length) rows.push(['', [pg[0]], 'Priority channel', true]);
    rows.push(['', [], 'Not scanned']);
    boxes.push(['Channel number colour', rows]);
  }
  let boxBottom = MARGIN;
  let bx = MARGIN + W;                                // right edge of the next box (laid out right to left)
  for (const [title, rows] of [...boxes].reverse()) {
    const bw = Math.max(textWidth(title, 'Helvetica-Bold', 8 * S) + 14 * S,
      ...rows.map(([, , d]) => 46 * S + textWidth(d, 'Helvetica', 8.5 * S) + 8 * S));
    bx -= bw;
    const h = (16 + 3) * S + rows.length * boxRow;
    page.rect(bx, MARGIN, bw, h, 0.93);
    page.text(bx + 7 * S, MARGIN + 11 * S, title, 'Helvetica-Bold', 8 * S, 0.3);
    rows.forEach(([label, scan, desc, pri, fill], i) => {
      const ry = MARGIN + 16 * S + i * boxRow;
      badge(page, bx + 6 * S, ry + S, 34 * S, boxRow - 2 * S, scan ?? [], label, 'Helvetica-Bold', 7.5 * S, ry + 9 * S, pri, fill,
        fill ? 0 : 1);
      page.text(bx + 46 * S, ry + 9 * S, desc, 'Helvetica', 8.5 * S);
    });
    boxBottom = Math.max(boxBottom, MARGIN + h);
    bx -= BOX_GAP;
  }
  const leftW = boxes.length ? bx - MARGIN - 6 * S : W;

  // Header: "FMxx Channel Sheet", then the job name and build details, wrapped to fit left of the boxes.
  let y = MARGIN + 14 * S;
  page.text(MARGIN, y, fit(`${model} Channel Sheet`, 'Helvetica-Bold', 16 * S, leftW), 'Helvetica-Bold', 16 * S);
  y += 9 * S;                                            // space under the title, before the info line
  // Same items and icons as WebFPP's status bar, plus the job, callsign and date. The image is described as on the
  // Firmware menu (not "Experimental"), in amber when it is a modified image.
  const fw = p.firmware ?? 'standard', exp = fw !== 'standard';
  const info: InfoItem[] = [{ text: `Job ${p.name.trim() || 'NEWJOB'}` }, { icon: 'radio', text: model },
    { icon: 'heartPulse', text: FW[fw] ?? fw, colour: exp ? EXP_COLOUR : undefined }];
  if (exp && p.callsign?.trim()) info.push({ icon: 'bullhorn', text: p.callsign.trim().toUpperCase() });
  info.push({ icon: 'antenna', text: `${entries.length}/${p.hw[1] === '1' ? 120 : 99} ch` });
  if (a?.builder) info.push({ icon: 'step', text: `${a.builder.step / 100} kHz` });
  info.push({ icon: 'chip', text: eprom(p.eprom).part }, { icon: 'calendar', text: p.date || today() });
  y = infoLine(page, info, MARGIN, y, leftW, 9 * S);
  const comments = p.comments.map((c) => c.trim()).filter(Boolean);
  if (comments.length) {
    y += 12 * S;
    page.text(MARGIN, y, fit(comments.join(' / '), 'Helvetica', 9 * S, leftW), 'Helvetica', 9 * S, 0.3);
  }
  y = Math.max(y, boxBottom - 4);
  y += 8 * S;
  page.line(MARGIN, y, MARGIN + W, y, S);
  y += 6 * S;

  // Footer
  const footY = page.height - MARGIN + 10 * S;
  page.text(MARGIN, footY, `WebFPP ${VERSION_LABEL}, ${today()}${skipped ? `. ${skipped} row${skipped === 1 ? '' : 's'} with errors not shown.` : ''}`,
    'Helvetica', 7 * S, 0.4);

  // Table
  const nameEm = Math.max(0, ...entries.map((e) => splitCallsigns(e.name).reduce((w, g) => w + textWidth(g.text, segFont(g), 1), 0)));
  const L = sheetLayout(entries.length, W, footY - 12 * S - y, { rxEm, txEm, nameEm, minLineH: half ? 8.8 : 10 });
  const colW = (W - GAP * (L.cols - 1)) / L.cols;
  const fs = L.fontSize;
  const base = L.lineH * 0.72;                       // baseline within a row
  for (let c = 0; c < L.cols; c++) {
    const x = MARGIN + c * (colW + GAP);
    const part = entries.slice(c * L.perCol, (c + 1) * L.perCol);
    if (!part.length && c) break;
    const badgeW = (CH_EM - 0.6) * fs;
    const x2 = x + CH_EM * fs, x3 = x2 + rxEm * fs, x4 = x3 + (txEm + MARK_EM) * fs;
    page.rect(x, y, colW, L.lineH, 0.82);
    const hy = y + base;
    page.text(x + (badgeW - textWidth('Ch', 'Helvetica-Bold', fs)) / 2, hy, 'Ch', 'Helvetica-Bold', fs);
    page.text(x2, hy, 'Rx MHz', 'Helvetica-Bold', fs);
    page.text(x3, hy, txHead, 'Helvetica-Bold', fs);
    if (L.nameW > 0) page.text(x4, hy, 'Name', 'Helvetica-Bold', fs);
    part.forEach((e, i) => {
      const ry = y + (i + 1) * L.lineH;
      if (i % 2) page.rect(x, ry, colW, L.lineH, 0.93);
      const by = ry + base;
      // Channel number reversed out: white, centred on a badge coloured by scan group.
      const inset = L.lineH * 0.08;
      badge(page, x, ry + inset, badgeW, L.lineH - 2 * inset, e.scan, e.num, 'Helvetica-Bold', fs, by, e.pri.length > 0);
      page.text(x2, by, e.rx, 'Helvetica-Bold', fs);
      page.text(x3, by, e.tx, 'Helvetica', fs, e.tx === e.rx ? 0.45 : 0);
      if (e.duplex) {                                // ⇅ centred between the end of the Tx frequency and the name
        const s = fs, gx = x3 + textWidth(e.tx, 'Helvetica', fs);
        page.icon(ICONS.duplex, gx + (x4 - gx - s) / 2, by - s * 0.86, s, 0);
      }
      if (L.nameW > 0 && e.name) {
        let nx = x4;                                   // regular text, callsigns in bold
        for (const g of fitName(e.name, fs, L.nameW)) {
          page.text(nx, by, g.text, segFont(g), fs);
          nx += textWidth(g.text, segFont(g), fs);
        }
      }
    });
    page.line(x, y + (part.length + 1) * L.lineH, x + colW, y + (part.length + 1) * L.lineH, 0.5, 0.5);
  }
  if (!entries.length) page.text(MARGIN, y + 30, 'No channels.', 'Helvetica', 12);

  return { bytes: page.toBytes(`${model} Channel Sheet${half ? ' (Mini A5)' : ''} (${p.name.trim() || 'NEWJOB'})`), fontSize: L.fontSize };
}

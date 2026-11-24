// Printable one-page A4 channel cheat sheet (PDF): a radio header, then channel number,
// Rx, Tx and name for every record, in record order, in 1–3 columns sized to fit the page.
import { Analysis } from './analyze';
import { Segment, splitCallsigns } from './callsign';
import { BLUE_KEYS, KEY_BLUE, headButtons } from './codes';
import { eprom } from './eprom';
import { ICONS, IconName } from './icons';
import { F_PRI1, F_PRI2, F_PRI3, F_SCAN1, F_SCAN2, F_SCAN3 } from './fm900';
import { Colour, Font, PdfPage, textWidth } from './pdf';
import { Project, isBlank, rowToChannel } from './project';
import { VERSION_LABEL } from '../version';

/** `scan` = the scan groups (1-based) the channel is in, `pri` = the groups it is the priority channel of; FM91 has 3 groups, FM92 2. */
export interface SheetEntry { num: string; rx: string; tx: string; name: string; scan: number[]; pri: number[] }

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
        pri: pris.flatMap((f, g) => (r.flags & f ? [g + 1] : [])) });
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
  const iconW = size + 2.5, GAP = 11;
  let cx = x0;
  y += 12;
  for (const it of items) {
    const text = fit(it.text, 'Helvetica', size, maxW - (it.icon ? iconW : 0));
    const w = (it.icon ? iconW : 0) + textWidth(text, 'Helvetica', size);
    if (cx > x0 && cx + w > x0 + maxW) { cx = x0; y += 12; }
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

const MARGIN = 36;
const GAP = 14;              // between columns
// Column widths in em (Helvetica digits are all 0.556 em, so frequencies still line up):
// badge = 3 digits + 0.3 em padding each side, then a 0.6 em gap; a frequency (4.17 em) + 1 em gap.
const PAD = 0.3, CH_EM = 3 * 0.556 + 2 * PAD + 0.6, FREQ_EM = 5.2, MIN_NAME_EM = 7;

/** Choose columns and font size so `n` records fit in a `height`-point tall, `width` wide area. */
export function sheetLayout(n: number, width: number, height: number): SheetLayout {
  let cols = 1, perCol = 1, lineH = 14;
  for (cols = 1; cols <= 3; cols++) {
    perCol = Math.max(1, Math.ceil(n / cols));
    lineH = Math.min(14, height / (perCol + 1));       // +1 = column heading
    if (lineH >= 10 || cols === 3) break;
  }
  const colW = (width - GAP * (cols - 1)) / cols;
  // Shrink if needed so a name still gets MIN_NAME_EM (about 13 characters).
  const fontSize = Math.min(10, lineH * 0.8, colW / (CH_EM + 2 * FREQ_EM + MIN_NAME_EM));
  const nameW = colW - (CH_EM + 2 * FREQ_EM) * fontSize;
  return { cols, perCol, lineH, fontSize, nameW };
}

export function cheatSheet(p: Project, a?: Pick<Analysis, 'img' | 'builder' | 'defaultKeys'>): Uint8Array {
  const page = new PdfPage();
  const W = page.width - 2 * MARGIN;
  const { entries, skipped } = sheetEntries(p);
  const model = p.hw[1] === '1' ? 'FM91' : p.hw[1] === '2' ? 'FM92' : p.hw[1] === '3' ? 'FM93' : 'FM9?';

  // Legend boxes, side by side at the top right: head buttons (FM92) and scan-group colours.
  // Rows: [badge text, badge groups (null = plain), description, priority corner]. Header text goes to the left.
  const buttons = headButtons(p, a?.defaultKeys);
  const boxRow = 12.5, BOX_GAP = 8;
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
    const bw = Math.max(textWidth(title, 'Helvetica-Bold', 8) + 14,
      ...rows.map(([, , d]) => 46 + textWidth(d, 'Helvetica', 8.5) + 8));
    bx -= bw;
    const h = 16 + rows.length * boxRow + 3;
    page.rect(bx, MARGIN, bw, h, 0.93);
    page.text(bx + 7, MARGIN + 11, title, 'Helvetica-Bold', 8, 0.3);
    rows.forEach(([label, scan, desc, pri, fill], i) => {
      const ry = MARGIN + 16 + i * boxRow;
      badge(page, bx + 6, ry + 1, 34, boxRow - 2, scan ?? [], label, 'Helvetica-Bold', 7.5, ry + 9, pri, fill, fill ? 0 : 1);
      page.text(bx + 46, ry + 9, desc, 'Helvetica', 8.5);
    });
    boxBottom = Math.max(boxBottom, MARGIN + h);
    bx -= BOX_GAP;
  }
  const leftW = boxes.length ? bx - MARGIN - 6 : W;

  // Header: "FMxx Channel Sheet", then the job name and build details, wrapped to fit left of the boxes.
  let y = MARGIN + 14;
  page.text(MARGIN, y, fit(`${model} Channel Sheet`, 'Helvetica-Bold', 16, leftW), 'Helvetica-Bold', 16);
  y += 3;
  // Same items and icons as WebFPP's status bar, plus the job, callsign and date. The image is described as on the
  // Firmware menu (not "Experimental"), in amber when it is a modified image.
  const fw = p.firmware ?? 'standard', exp = fw !== 'standard';
  const info: InfoItem[] = [{ text: `Job ${p.name.trim() || 'NEWJOB'}` }, { icon: 'radio', text: model },
    { icon: 'heartPulse', text: FW[fw] ?? fw, colour: exp ? EXP_COLOUR : undefined }];
  if (exp && p.callsign?.trim()) info.push({ icon: 'bullhorn', text: p.callsign.trim().toUpperCase() });
  info.push({ icon: 'antenna', text: `${entries.length}/${p.hw[1] === '1' ? 120 : 99} ch` });
  if (a?.builder) info.push({ icon: 'step', text: `${a.builder.step / 100} kHz` });
  info.push({ icon: 'chip', text: eprom(p.eprom).part }, { icon: 'calendar', text: p.date || today() });
  y = infoLine(page, info, MARGIN, y, leftW);
  const comments = p.comments.map((c) => c.trim()).filter(Boolean);
  if (comments.length) {
    y += 12;
    page.text(MARGIN, y, fit(comments.join(' / '), 'Helvetica', 9, leftW), 'Helvetica', 9, 0.3);
  }
  y = Math.max(y, boxBottom - 4);
  y += 8;
  page.line(MARGIN, y, MARGIN + W, y, 1);
  y += 6;

  // Footer
  const footY = page.height - MARGIN + 10;
  page.text(MARGIN, footY, `WebFPP ${VERSION_LABEL}, ${today()}${skipped ? `. ${skipped} row${skipped === 1 ? '' : 's'} with errors not shown.` : ''}`,
    'Helvetica', 7, 0.4);

  // Table
  const L = sheetLayout(entries.length, W, footY - 12 - y);
  const colW = (W - GAP * (L.cols - 1)) / L.cols;
  const fs = L.fontSize;
  const base = L.lineH * 0.72;                       // baseline within a row
  for (let c = 0; c < L.cols; c++) {
    const x = MARGIN + c * (colW + GAP);
    const part = entries.slice(c * L.perCol, (c + 1) * L.perCol);
    if (!part.length && c) break;
    const badgeW = (CH_EM - 0.6) * fs;
    const x2 = x + CH_EM * fs, x3 = x2 + FREQ_EM * fs, x4 = x3 + FREQ_EM * fs;
    page.rect(x, y, colW, L.lineH, 0.82);
    const hy = y + base;
    page.text(x + (badgeW - textWidth('Ch', 'Helvetica-Bold', fs)) / 2, hy, 'Ch', 'Helvetica-Bold', fs);
    page.text(x2, hy, 'Rx MHz', 'Helvetica-Bold', fs);
    page.text(x3, hy, 'Tx MHz', 'Helvetica-Bold', fs);
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

  return page.toBytes(`${model} Channel Sheet (${p.name.trim() || 'NEWJOB'})`);
}

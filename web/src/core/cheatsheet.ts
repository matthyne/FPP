// Printable one-page A4 channel cheat sheet (PDF): a radio header, then channel number,
// Rx, Tx and name for every record, in record order, in 1–3 columns sized to fit the page.
import { Analysis } from './analyze';
import { Segment, splitCallsigns } from './callsign';
import { headButtons } from './codes';
import { F_SCAN1, F_SCAN2, F_SCAN3 } from './fm900';
import { Colour, Font, PdfPage, textWidth } from './pdf';
import { Project, isBlank, rowToChannel } from './project';
import { VERSION_LABEL } from '../version';

/** `scan` = the scan groups (1-based) the channel is in; FM91 has 3 groups, FM92 2. */
export interface SheetEntry { num: string; rx: string; tx: string; name: string; scan: number[] }

/** Valid, non-blank rows in record order. Rows with errors are skipped (`skipped` counts them). */
export function sheetEntries(p: Project): { entries: SheetEntry[]; skipped: number } {
  const entries: SheetEntry[] = [];
  let skipped = 0;
  const groups = p.hw[1] === '1' ? [F_SCAN1, F_SCAN2, F_SCAN3] : [F_SCAN1, F_SCAN2];
  for (const r of p.rows) {
    if (isBlank(r)) continue;
    try {
      const c = rowToChannel(r);
      entries.push({ num: String(c.num), rx: c.rx, tx: c.tx.startsWith('X') ? 'Rx only' : c.tx, name: (r.name ?? '').trim(),
        scan: groups.flatMap((f, g) => (r.flags & f ? [g + 1] : [])) });
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

/** A channel badge: one horizontal band per scan group, top to bottom (solid when 0 or 1 group), with the text centred in white. */
function badge(page: PdfPage, x: number, y: number, w: number, h: number, scan: number[], text: string, font: Font, size: number, base: number): void {
  if (!scan.length) page.rect(x, y, w, h, BADGE_PLAIN);
  else scan.forEach((g, k) => page.rect(x, y + (k * h) / scan.length, w, h / scan.length, SCAN_COLOURS[g - 1]));
  page.text(x + (w - textWidth(text, font, size)) / 2, base, text, font, size, 1);
}

const FW: Record<string, string> = {
  intro: 'start-up ident (modified, experimental)',
  enhanced: 'start-up ident + Rx frequency (modified, experimental)',
};

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

/** Lay out `items` joined by a separator, wrapping onto new lines so no line is wider than `maxW`. */
function flow(items: string[], font: Font, size: number, maxW: number): string[] {
  const sep = '   ·   ';
  const lines: string[] = [];
  let cur = '';
  for (const it of items) {
    const next = cur ? cur + sep + it : it;
    if (cur && textWidth(next, font, size) > maxW) { lines.push(cur); cur = it; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.map((l) => fit(l, font, size, maxW));
}

export function cheatSheet(p: Project, a?: Pick<Analysis, 'img' | 'builder' | 'defaultKeys'>): Uint8Array {
  const page = new PdfPage();
  const W = page.width - 2 * MARGIN;
  const { entries, skipped } = sheetEntries(p);
  const model = p.hw[1] === '1' ? 'FM91' : p.hw[1] === '2' ? 'FM92' : p.hw[1] === '3' ? 'FM93' : 'FM9?';

  // Legend boxes, side by side at the top right: head buttons (FM92) and scan-group colours.
  // Rows: [badge text, badge groups (null = plain), description]. Header text goes to the left.
  const buttons = headButtons(p, a?.defaultKeys);
  const boxRow = 12.5, BOX_GAP = 8;
  const boxes: [string, [string, number[] | null, string][]][] = [];
  if (buttons) boxes.push(['Head buttons', buttons.map(([b, f]) => [b, null, f])]);
  const used = [...new Set(entries.flatMap((e) => e.scan))].sort();
  if (used.length) {
    const rows: [string, number[] | null, string][] = used.map((g) => [`${g}`, [g], `Scan group ${g}`]);
    const multi = [...new Set(entries.filter((e) => e.scan.length > 1).map((e) => e.scan.join('+')))];
    for (const m of multi) rows.push([m, m.split('+').map(Number), `In groups ${m.replace(/\+/g, ' and ')}`]);
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
    rows.forEach(([label, scan, desc], i) => {
      const ry = MARGIN + 16 + i * boxRow;
      badge(page, bx + 6, ry + 1, 34, boxRow - 2, scan ?? [], label, 'Helvetica-Bold', 7.5, ry + 9);
      page.text(bx + 46, ry + 9, desc, 'Helvetica', 8.5);
    });
    boxBottom = Math.max(boxBottom, MARGIN + h);
    bx -= BOX_GAP;
  }
  const leftW = boxes.length ? bx - MARGIN - 6 : W;

  // Header: job name, then model and the build details, wrapped to fit left of the boxes.
  let y = MARGIN + 14;
  page.text(MARGIN, y, fit(p.name.trim() || 'NEWJOB', 'Helvetica-Bold', 16, leftW), 'Helvetica-Bold', 16);
  y += 3;
  const info = [`Philips ${model} channels`];
  if (a?.builder) info.push(`Master ${a.builder.masterName()}`);
  info.push(`Build date ${p.date || today()}`, `${entries.length} channel${entries.length === 1 ? '' : 's'}`);
  if (p.firmware && p.firmware !== 'standard') info.push(`Firmware: ${FW[p.firmware] ?? p.firmware}`);
  if (p.firmware && p.firmware !== 'standard' && p.callsign?.trim()) info.push(`Callsign ${p.callsign.trim().toUpperCase()}`);
  for (const line of flow(info, 'Helvetica', 9, leftW)) {
    y += 12;
    page.text(MARGIN, y, line, 'Helvetica', 9);
  }
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
  page.text(MARGIN, footY, `Web FPP (FM900 CPS) ${VERSION_LABEL}, ${today()}${skipped ? `. ${skipped} row${skipped === 1 ? '' : 's'} with errors not shown.` : ''}`,
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
      badge(page, x, ry + inset, badgeW, L.lineH - 2 * inset, e.scan, e.num, 'Helvetica-Bold', fs, by);
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

  return page.toBytes(`${p.name} channels`);
}

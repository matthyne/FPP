// Printable one-page A4 channel cheat sheet (PDF): a radio header, then channel number,
// Rx, Tx and name for every record, in record order, in 1–3 columns sized to fit the page.
import { Analysis } from './analyze';
import { describeHw } from './codes';
import { Font, PdfPage, textWidth } from './pdf';
import { Project, isBlank, rowToChannel } from './project';
import { VERSION_LABEL } from '../version';

export interface SheetEntry { num: string; rx: string; tx: string; name: string }

/** Valid, non-blank rows in record order. Rows with errors are skipped (`skipped` counts them). */
export function sheetEntries(p: Project): { entries: SheetEntry[]; skipped: number } {
  const entries: SheetEntry[] = [];
  let skipped = 0;
  for (const r of p.rows) {
    if (isBlank(r)) continue;
    try {
      const c = rowToChannel(r);
      entries.push({ num: String(c.num), rx: c.rx, tx: c.tx.startsWith('X') ? 'Rx only' : c.tx, name: (r.name ?? '').trim() });
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
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

export function cheatSheet(p: Project, a?: Pick<Analysis, 'img' | 'builder'>): Uint8Array {
  const page = new PdfPage();
  const W = page.width - 2 * MARGIN;
  const { entries, skipped } = sheetEntries(p);
  const hw = describeHw(p.hw);
  const model = p.hw[1] === '1' ? 'FM91' : p.hw[1] === '2' ? 'FM92' : p.hw[1] === '3' ? 'FM93' : 'FM9?';

  // Header
  let y = MARGIN + 14;
  page.text(MARGIN, y, `${p.name.trim() || 'NEWJOB'}: Philips ${model} channels`, 'Helvetica-Bold', 16);
  y += 15;
  page.text(MARGIN, y, [hw[2], hw[3], hw[5]].join('   ·   '), 'Helvetica', 9);
  y += 12;
  const info = [`HW ${p.hw}`, `SW ${p.sw}`];
  if (a?.builder) info.push(`Master ${a.builder.masterName()}`);
  if (a?.img) info.push(`Checksum ${a.img[0x1F64].toString(16).toUpperCase().padStart(2, '0')}`);
  page.text(MARGIN, y, info.join('   ·   '), 'Helvetica', 9);
  y += 12;
  const more = [`Build date ${p.date || today()}`, `${entries.length} channel${entries.length === 1 ? '' : 's'}`];
  if (p.firmware && p.firmware !== 'standard') more.push(`Firmware: ${FW[p.firmware] ?? p.firmware}`);
  if (p.firmware && p.firmware !== 'standard' && p.callsign?.trim()) more.push(`Callsign ${p.callsign.trim().toUpperCase()}`);
  page.text(MARGIN, y, more.join('   ·   '), 'Helvetica', 9);
  const comments = p.comments.map((c) => c.trim()).filter(Boolean);
  if (comments.length) {
    y += 12;
    page.text(MARGIN, y, fit(comments.join(' / '), 'Helvetica', 9, W), 'Helvetica', 9, 0.3);
  }
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
    page.text(x + PAD * fs, hy, 'Ch', 'Helvetica-Bold', fs);
    page.text(x2, hy, 'Rx MHz', 'Helvetica-Bold', fs);
    page.text(x3, hy, 'Tx MHz', 'Helvetica-Bold', fs);
    if (L.nameW > 0) page.text(x4, hy, 'Name', 'Helvetica-Bold', fs);
    part.forEach((e, i) => {
      const ry = y + (i + 1) * L.lineH;
      if (i % 2) page.rect(x, ry, colW, L.lineH, 0.93);
      const by = ry + base;
      // Channel number reversed out: white, right-aligned on a dark badge.
      const inset = L.lineH * 0.08;
      page.rect(x, ry + inset, badgeW, L.lineH - 2 * inset, 0.15);
      page.text(x + badgeW - PAD * fs - textWidth(e.num, 'Helvetica-Bold', fs), by, e.num, 'Helvetica-Bold', fs, 1);
      page.text(x2, by, e.rx, 'Helvetica-Bold', fs);
      page.text(x3, by, e.tx, 'Helvetica', fs, e.tx === e.rx ? 0.45 : 0);
      if (L.nameW > 0 && e.name) page.text(x4, by, fit(e.name, 'Helvetica-Bold', fs, L.nameW), 'Helvetica-Bold', fs);
    });
    page.line(x, y + (part.length + 1) * L.lineH, x + colW, y + (part.length + 1) * L.lineH, 0.5, 0.5);
  }
  if (!entries.length) page.text(MARGIN, y + 30, 'No channels.', 'Helvetica', 12);

  return page.toBytes(`${p.name} channels`);
}

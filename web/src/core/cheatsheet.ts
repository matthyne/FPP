// Printable one-page A4 channel cheat sheet (PDF): a radio header, then channel number,
// Rx, Tx and name for every record, in record order, in 1–3 columns sized to fit the page.
import { Analysis } from './analyze';
import { describeHw } from './codes';
import { PdfPage, glyphs } from './pdf';
import { Project, isBlank, rowToChannel } from './project';

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

/** Cut to `max` glyphs, with an ellipsis if anything was dropped. */
function fit(s: string, max: number): string {
  if (max <= 0) return '';
  return glyphs(s) <= max ? s : [...s].slice(0, Math.max(0, max - 1)).join('') + '…';
}

export interface SheetLayout { cols: number; perCol: number; lineH: number; fontSize: number; nameChars: number }

const MARGIN = 36;
const GAP = 14;              // between columns
const CH_CHARS = 4, FREQ_CHARS = 9, MIN_NAME = 12;

/** Choose columns and font size so `n` records fit in a `height`-point tall, `width` wide area. */
export function sheetLayout(n: number, width: number, height: number): SheetLayout {
  let cols = 1, perCol = 1, lineH = 14;
  for (cols = 1; cols <= 3; cols++) {
    perCol = Math.max(1, Math.ceil(n / cols));
    lineH = Math.min(14, height / (perCol + 1));       // +1 = column heading
    if (lineH >= 10 || cols === 3) break;
  }
  const colW = (width - GAP * (cols - 1)) / cols;
  // Courier is 0.6 em per glyph: shrink if needed so a name still gets MIN_NAME characters.
  const fontSize = Math.min(10, lineH * 0.8, colW / (0.6 * (CH_CHARS + 2 * FREQ_CHARS + MIN_NAME)));
  const nameChars = Math.floor(colW / (0.6 * fontSize)) - CH_CHARS - 2 * FREQ_CHARS;
  return { cols, perCol, lineH, fontSize, nameChars };
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
    page.text(MARGIN, y, fit(comments.join(' / '), 110), 'Helvetica', 9, 0.3);
  }
  y += 8;
  page.line(MARGIN, y, MARGIN + W, y, 1);
  y += 6;

  // Footer
  const footY = page.height - MARGIN + 10;
  page.text(MARGIN, footY, `Web FPP (FM900 CPS), ${today()}${skipped ? `. ${skipped} row${skipped === 1 ? '' : 's'} with errors not shown.` : ''}`,
    'Helvetica', 7, 0.4);

  // Table
  const L = sheetLayout(entries.length, W, footY - 12 - y);
  const colW = (W - GAP * (L.cols - 1)) / L.cols;
  const cw = 0.6 * L.fontSize;
  const base = L.lineH * 0.72;                       // baseline within a row
  for (let c = 0; c < L.cols; c++) {
    const x = MARGIN + c * (colW + GAP);
    const part = entries.slice(c * L.perCol, (c + 1) * L.perCol);
    if (!part.length && c) break;
    const x2 = x + CH_CHARS * cw, x3 = x2 + FREQ_CHARS * cw, x4 = x3 + FREQ_CHARS * cw;
    page.rect(x, y, colW, L.lineH, 0.82);
    const hy = y + base;
    page.text(x + 0.25 * cw, hy, 'Ch', 'Courier-Bold', L.fontSize);
    page.text(x2, hy, 'Rx MHz', 'Courier-Bold', L.fontSize);
    page.text(x3, hy, 'Tx MHz', 'Courier-Bold', L.fontSize);
    if (L.nameChars > 0) page.text(x4, hy, 'Name', 'Courier-Bold', L.fontSize);
    part.forEach((e, i) => {
      const ry = y + (i + 1) * L.lineH;
      if (i % 2) page.rect(x, ry, colW, L.lineH, 0.93);
      const by = ry + base;
      // Channel number reversed out: white on a dark badge, 3 digits + a quarter-glyph pad each side.
      const inset = L.lineH * 0.08;
      page.rect(x, ry + inset, (CH_CHARS - 0.5) * cw, L.lineH - 2 * inset, 0.15);
      page.text(x + 0.25 * cw, by, e.num.padStart(CH_CHARS - 1), 'Courier-Bold', L.fontSize, 1);
      page.text(x2, by, e.rx, 'Courier-Bold', L.fontSize);
      page.text(x3, by, e.tx, 'Courier', L.fontSize, e.tx === e.rx ? 0.45 : 0);
      if (L.nameChars > 0 && e.name) page.text(x4, by, fit(e.name, L.nameChars), 'Courier-Bold', L.fontSize);
    });
    page.line(x, y + (part.length + 1) * L.lineH, x + colW, y + (part.length + 1) * L.lineH, 0.5, 0.5);
  }
  if (!entries.length) page.text(MARGIN, y + 30, 'No channels.', 'Helvetica', 12);

  return page.toBytes(`${p.name} channels`);
}

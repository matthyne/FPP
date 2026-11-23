// Minimal single-page PDF writer: standard-14 fonts only (no embedding), text, lines and
// filled rectangles. DOM-free so it can be tested in Node. Used by cheatsheet.ts.
// Coordinates are PDF points from the top-left (y is flipped on output).

export const A4: [number, number] = [595.28, 841.89];

export type Font = 'Helvetica' | 'Helvetica-Bold' | 'Courier' | 'Courier-Bold';
const FONTS: Font[] = ['Helvetica', 'Helvetica-Bold', 'Courier', 'Courier-Bold'];

// Unicode → WinAnsiEncoding for the 0x80–0x9F range; 0xA0–0xFF map to themselves.
const WIN: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91,
  0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
  0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};

/** Encode a string as a PDF literal string body (ASCII only: non-ASCII becomes \ddd octal). */
export function pdfString(s: string): string {
  let out = '';
  for (const ch of s) {
    const u = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (u >= 0x20 && u < 0x7F) out += ch;
    else {
      const w = u >= 0xA0 && u <= 0xFF ? u : WIN[u];
      out += w ? '\\' + w.toString(8).padStart(3, '0') : '?';
    }
  }
  return out;
}


// Advance widths (1/1000 em) of ASCII 0x20-0x7E, from the standard Adobe AFM metrics.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260,
  334, 584];
const HELV_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722,
  611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556,
  611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584];

/** Width in points of `s` drawn in `font` at `size`. Non-ASCII glyphs are approximated (… = 1 em, others 0.556 em). */
export function textWidth(s: string, font: Font, size: number): number {
  const table = font === 'Helvetica' ? HELV : font === 'Helvetica-Bold' ? HELV_BOLD : null;
  let w = 0;
  for (const ch of s) {
    const u = ch.codePointAt(0)!;
    w += !table ? 600 : u >= 0x20 && u < 0x7F ? table[u - 0x20] : u === 0x2026 ? 1000 : 556;
  }
  return (w * size) / 1000;
}

const n = (x: number) => (Math.round(x * 100) / 100).toString();

/** A grey level (0 = black, 1 = white) or an [r, g, b] colour, each 0–1. */
export type Colour = number | [number, number, number];
const fillOp = (c: Colour) => (typeof c === 'number' ? `${n(c)} g` : `${c.map(n).join(' ')} rg`);

export class PdfPage {
  private ops: string[] = [];
  constructor(readonly width = A4[0], readonly height = A4[1]) {}

  text(x: number, y: number, s: string, font: Font = 'Helvetica', size = 10, colour: Colour = 0): void {
    const f = FONTS.indexOf(font) + 1;
    this.ops.push(`BT ${fillOp(colour)} /F${f} ${n(size)} Tf ${n(x)} ${n(this.height - y)} Td (${pdfString(s)}) Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, grey = 0): void {
    this.ops.push(`${n(grey)} G ${n(width)} w ${n(x1)} ${n(this.height - y1)} m ${n(x2)} ${n(this.height - y2)} l S`);
  }

  /** Filled rectangle, (x, y) = top-left corner. */
  rect(x: number, y: number, w: number, h: number, colour: Colour): void {
    this.ops.push(`${fillOp(colour)} ${n(x)} ${n(this.height - y - h)} ${n(w)} ${n(h)} re f`);
  }

  toBytes(title = ''): Uint8Array {
    const content = this.ops.join('\n');
    const fontRefs = FONTS.map((_, i) => `/F${i + 1} ${5 + i} 0 R`).join(' ');
    const objs: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.width)} ${n(this.height)}] ` +
        `/Resources << /Font << ${fontRefs} >> >> /Contents 4 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      ...FONTS.map((f) => `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`),
      `<< /Title (${pdfString(title)}) /Producer (Web FPP) >>`,
    ];
    // Everything above is ASCII, so string length = byte length for the xref offsets.
    let out = '%PDF-1.4\n';
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    out += offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
    return bytes;
  }
}

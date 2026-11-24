// Minimal single-page PDF writer: standard-14 fonts only (no embedding), text, lines and
// filled rectangles. DOM-free so it can be tested in Node. Used by cheatsheet.ts.
// Coordinates are PDF points from the top-left (y is flipped on output).

export const A4: [number, number] = [595.28, 841.89];
/** A5 (148 x 210 mm), portrait: the cheat sheet's "Mini (A5)" size. */
export const A5: [number, number] = [419.53, 595.28];

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

/** SVG path data (M L H V C S Q T A Z, absolute or relative) -> PDF path operators in the same coordinates.
 *  Quadratics and arcs become cubics. Used to draw the Material Design Icons (24x24, nonzero fill). */
export function svgPathOps(d: string): string {
  const tok = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const out: string[] = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0, prev = '';
  const num = () => parseFloat(tok[i++]);
  const curve = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
    out.push(`${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(ex)} ${f(ey)} c`);
    cx = x2; cy = y2; x = ex; y = ey;
  };
  while (i < tok.length) {
    if (/[a-z]/i.test(tok[i])) cmd = tok[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? 1 : 0;
    const ox = rel ? x : 0, oy = rel ? y : 0;
    const C = cmd.toUpperCase();
    if (C === 'Z') { out.push('h'); x = sx; y = sy; prev = 'Z'; cmd = ''; continue; }
    if (C === 'M') {
      x = ox + num(); y = oy + num(); sx = x; sy = y;
      out.push(`${f(x)} ${f(y)} m`);
      cmd = rel ? 'l' : 'L';                         // further pairs are line-tos
    } else if (C === 'L') { x = ox + num(); y = oy + num(); out.push(`${f(x)} ${f(y)} l`); }
    else if (C === 'H') { x = ox + num(); out.push(`${f(x)} ${f(y)} l`); }
    else if (C === 'V') { y = oy + num(); out.push(`${f(x)} ${f(y)} l`); }
    else if (C === 'C') {
      const a = [num(), num(), num(), num(), num(), num()];
      curve(ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]);
    } else if (C === 'S') {
      const a = [num(), num(), num(), num()];
      const [x1, y1] = prev === 'C' || prev === 'S' ? [2 * x - cx, 2 * y - cy] : [x, y];
      curve(x1, y1, ox + a[0], oy + a[1], ox + a[2], oy + a[3]);
    } else if (C === 'Q' || C === 'T') {
      let px: number, py: number;
      if (C === 'Q') { px = ox + num(); py = oy + num(); }
      else [px, py] = prev === 'Q' || prev === 'T' ? [2 * x - qx, 2 * y - qy] : [x, y];
      const ex = ox + num(), ey = oy + num();
      curve(x + (2 / 3) * (px - x), y + (2 / 3) * (py - y), ex + (2 / 3) * (px - ex), ey + (2 / 3) * (py - ey), ex, ey);
      qx = px; qy = py;
    } else if (C === 'A') {
      const rx0 = num(), ry0 = num(), rot = num(), large = num(), sweep = num(), ex = ox + num(), ey = oy + num();
      for (const seg of arcToCubics(x, y, rx0, ry0, rot, large !== 0, sweep !== 0, ex, ey)) curve(...seg);
      x = ex; y = ey;
    }
    prev = C;
  }
  return out.join(' ');
}

/** SVG elliptical arc (endpoint form) -> cubic Bezier segments [x1, y1, x2, y2, x, y] (SVG 1.1 F.6.5). */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean,
  x2: number, y2: number): [number, number, number, number, number, number][] {
  if (x1 === x2 && y1 === y2) return [];
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1p) / ry, cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
  const out: [number, number, number, number, number, number][] = [];
  const pt = (t: number): [number, number] => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t: number): [number, number] => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let j = 0; j < n; j++) {
    const a = t1 + (dt * j) / n, b = t1 + (dt * (j + 1)) / n;
    const al = (4 / 3) * Math.tan((b - a) / 4);
    const [px, py] = pt(a), [qx, qy] = pt(b), [dax, day] = der(a), [dbx, dby] = der(b);
    out.push([px + al * dax, py + al * day, qx - al * dbx, qy - al * dby, qx, qy]);
  }
  return out;
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

  /** Filled polygon through `pts` ([x, y] pairs, top-left coordinates). */
  poly(pts: [number, number][], colour: Colour): void {
    const path = pts.map(([x, y], i) => `${n(x)} ${n(this.height - y)} ${i ? 'l' : 'm'}`).join(' ');
    this.ops.push(`${fillOp(colour)} ${path} h f`);
  }

  /** A 24x24 SVG path icon (e.g. core/icons.ts) filled at (x, y) = top-left corner, `size` points square. */
  icon(d: string, x: number, y: number, size: number, colour: Colour = 0): void {
    const k = size / 24;
    this.ops.push(`q ${k.toFixed(5)} 0 0 ${(-k).toFixed(5)} ${n(x)} ${n(this.height - y)} cm ${fillOp(colour)} ${svgPathOps(d)} f Q`);
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
      `<< /Title (${pdfString(title)}) /Producer (WebFPP) >>`,
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

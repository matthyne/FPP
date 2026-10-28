import { useMemo, useState } from 'preact/hooks';
import { Analysis } from '../core/analyze';
import { dump } from '../core/decode';
import { verifyChecksum } from '../core/fm900';
import { master } from '../core/masters';
import { Project } from '../core/project';
import type { Update } from './App';
import { download, safeName } from './files';

/** Short description of an image address, from FM900_FORMAT.md §4. */
export function region(addr: number, fm91: boolean): string {
  const [base, n] = fm91 ? [0x1B40, 120] : [0x1BE8, 99];
  if (addr >= base && addr < base + 8 * n) {
    const s = Math.floor((addr - base) / 8);
    return `channel slot ${s + 1}, byte ${(addr - base) % 8}`;
  }
  const named: [number, number, string][] = [
    [0x1F08, 0x1F0F, 'PA power set points'], [0x1F31, 0x1F31, 'lowest channel'], [0x1F33, 0x1F37, 'option bytes'],
    [0x1F38, 0x1F38, 'Tx timer'], [0x1F3E, 0x1F3E, 'highest channel'], [0x1F3F, 0x1F3F, 'lowest channel'],
    [0x1F40, 0x1F40, 'scan 1 priority'], [0x1F41, 0x1F4A, 'scan 1 list'], [0x1F4B, 0x1F4B, 'scan 1 count'],
    [0x1F4C, 0x1F4C, 'scan 2 priority'], [0x1F4D, 0x1F56, 'scan 2 list'], [0x1F57, 0x1F57, 'scan 2 count'],
    [0x1F58, 0x1F5B, fm91 ? 'scan 3 priority / list' : 'head function keys 1/2/4/7'],
    [0x1F5C, 0x1F62, fm91 ? 'scan 3 list' : 'config'], [0x1F63, 0x1F63, fm91 ? 'scan 3 count' : 'config'],
    [0x1F64, 0x1F64, 'image checksum'], [0x1F65, 0x1F65, 'firmware signature'], [0x1F66, 0x1F66, 'option checksum'],
    [0x1F67, 0x1FA7, 'selcall tone memory'], [0x1FE0, 0x1FE1, 'programmer version'], [0x1FE2, 0x1FE4, 'build date (BCD)'],
    [0x1FE5, 0x1FE5, 'master version'], [0x1FEB, 0x1FEF, 'master ID'], [0x1FF0, 0x1FFF, '68HC05 vectors'],
  ];
  const hit = named.find(([a, b]) => addr >= a && addr <= b);
  if (hit) return hit[2];
  if (addr < 0x23) return 'copyright string';
  if (addr >= 0x1F00) return 'configuration block';
  return 'firmware';
}

const hx = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');

export function HexView({ img, orig: refImg, fm91, from, to }: { img: Uint8Array; orig?: Uint8Array; fm91: boolean; from: number; to: number }) {
  const rows: number[] = [];
  for (let a = from; a < to; a += 16) rows.push(a);
  return (
    <div class="hexwrap">
      <table class="hex mono">
        <tbody>
          {rows.map((a) => {
            const bytes = [...img.subarray(a, a + 16)];
            const blank = bytes.every((b) => b === 0) && (!refImg || [...refImg.subarray(a, a + 16)].every((b) => b === 0));
            return (
              <tr class={blank ? 'blank' : ''}>
                <th>{hx(a, 4)}</th>
                {bytes.map((b, k) => {
                  const ad = a + k;
                  const ch = refImg && refImg[ad] !== b;
                  return <td class={ch ? 'chg' : b === 0 ? 'z' : ''} title={`0x${hx(ad, 4)} = ${hx(b)}${ch ? ` (master ${hx(refImg![ad])})` : ''}\n${region(ad, fm91)}`}>{hx(b)}</td>;
                })}
                <td class="asc">{bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BuildPanel({ p, a, update, notify }: { p: Project; a: Analysis; update: Update; notify: (m: string, e?: boolean) => void }) {
  const [view, setView] = useState<'table' | 'all' | 'dump'>('table');
  const b = a.builder;
  const fm91 = p.hw[1] === '1';
  const base = useMemo(() => (b && a.img ? master(b.masterName()) : undefined), [a.img, b]);
  const changed = useMemo(() => (a.img && base ? a.img.reduce((n, x, i) => n + (x !== base[i] ? 1 : 0), 0) : 0), [a.img, base]);
  const fname = `${safeName(p.name)}.BIN`;

  return (
    <div class="panel build">
      <section class="card wide buildcard">
        <div>
          <h2>Build EPROM image</h2>
          {a.img && b && b.info ? (
            <dl>
              <dt>Master</dt><dd class="mono">{b.info.master}</dd>
              <dt>Channels</dt><dd>{a.chans.length} (numbers {b.info.ch_min}–{b.info.ch_max})</dd>
              <dt>Synth step</dt><dd>{b.info.step_khz} kHz, IF {b.info.if_mhz >= 0 ? '+' : ''}{b.info.if_mhz.toFixed(1)} MHz</dd>
              <dt>Checksum</dt><dd class="mono">0x1F64 = {hx(a.img[0x1F64])}, 0x1F65 = {hx(a.img[0x1F65])} {verifyChecksum(a.img) ? '✓' : '✗'}</dd>
              <dt>Date</dt><dd class="mono">{hx(a.img[0x1FE2])}/{hx(a.img[0x1FE3])}/{hx(a.img[0x1FE4])} <small>DD/MM/YY</small></dd>
              <dt>Changed</dt><dd>{changed} bytes vs. the master</dd>
            </dl>
          ) : (
            <p class="msg bad">{a.codeError ?? a.buildError}</p>
          )}
          {a.vcoWarnings.map((w) => <p class="msg warn">{w}! The radio may not operate correctly.</p>)}
          {p.sw.slice(11, 15) !== '0000' && <p class="msg warn">Selcall codes are set: the selcall tones are left at their defaults.</p>}
          {p.keys && <p class="msg info">Head function keys are overridden (not FM900.EXE behaviour).</p>}
        </div>
        <div class="buildactions">
          <label class="field">
            <span class="lab">Build date</span>
            <input type="date" value={p.date} onInput={(e) => update((q) => ({ ...q, date: (e.target as HTMLInputElement).value }))} />
          </label>
          <button class="primary big" disabled={!a.img} onClick={() => { download(fname, a.img!); notify(`Saved ${fname}`); }}>
            Download {fname}
          </button>
          <p class="hint">8192 bytes for a 2764 / 27C64. For example: <code>minipro -p 2764 -w {fname}</code></p>
        </div>
      </section>

      {a.img && (
        <section class="card wide">
          <div class="viewtabs">
            <button class={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Channels + config</button>
            <button class={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>Whole image</button>
            <button class={view === 'dump' ? 'active' : ''} onClick={() => setView('dump')}>Decoded dump</button>
            <span class="legend"><span class="chg">00</span> changed from master</span>
          </div>
          {view === 'dump' ? (
            <pre class="dump">{dump(a.img, p.hw, b?.step)}</pre>
          ) : (
            <HexView img={a.img} orig={base} fm91={fm91} from={view === 'all' ? 0 : fm91 ? 0x1B40 : 0x1BE0} to={0x2000} />
          )}
        </section>
      )}
    </div>
  );
}

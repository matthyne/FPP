import { useMemo, useState } from 'preact/hooks';
import { Analysis, enhancedProblem } from '../core/analyze';
import { MORSE_WPM, STEP_DEFAULT, STEP_TICKS, TICK_MS, entryNibbles, identSeconds, morseBytes, tableEntry, windows } from '../core/fork';
import { dump } from '../core/decode';
import { verifyChecksum } from '../core/fm900';
import { Firmware, Project } from '../core/project';
import type { Update } from './App';
import { download, safeName } from './files';
import { Icon } from './icons';
import { EPROMS, EpromPart, eprom, expandImage } from '../core/eprom';

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
  if (addr >= 0x1978 && addr < 0x197C) return 'modified firmware: start-up callsign marker';
  if (addr >= 0x197C && addr < 0x19AC) return 'modified firmware: start-up Morse callsign';
  if (addr >= 0x19AC && addr < 0x19B0) return 'enhanced firmware: frequency table marker';
  if (addr >= 0x19B0 && addr < 0x1B40) return 'enhanced firmware: Rx frequency table';
  return 'firmware';
}

// The builder's VCO warnings keep the Original FPP wording (fm900.ts / fm900gen.py, checked by the
// vector tests); this is the friendlier text shown on the Build tab.
const VCO_SPAN: Record<string, string> = {
  'Rx - Rx': 'the receive frequencies span',
  'Tx - Tx': 'the transmit frequencies span',
  'Rx - Tx': 'the receive and transmit frequencies together span',
};
export function vcoMessage(w: string): string {
  const what = VCO_SPAN[w.slice(0, 7)] ?? 'the frequencies span';
  return `Channels outside the factory range: ${what} more than the VCO's factory switching bandwidth. ` +
    'The VCO / radio may require modification (re-tuning) to work on every channel.';
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

/** Shown wherever a non-factory (extended) firmware image is built or read. */
export function ExperimentalBanner({ what }: { what: string }) {
  return (
    <div class="banner-exp" role="note">
      <p><b>Experimental firmware:</b> {what} is modified. It has worked on an FM92R, but it is still experimental and not guaranteed to work on yours. Keep the original EPROM.</p>
    </div>
  );
}

/** What the experimental image does, feature by feature (Build tab, in place of the factory summary). */
function FirmwareInfo({ fw, callsign, sample, stepS }: { fw: Firmware; callsign: string; sample: { ch: number; w: string[] } | null; stepS: string }) {
  const secs = identSeconds(callsign).toFixed(1);
  return (
    <div class="msg info fwinfo">
      <b>What this experimental image does</b> ({fw === 'enhanced' ? 'Ident + Rx freq.' : 'Start-up ident'}, FM92R):
      <ul>
        <li><b>Start-up ident.</b> At switch-on the head shows “00”{callsign
          ? <> while the radio sends <b class="mono">{callsign}</b> in Morse on its beep tone at {MORSE_WPM} wpm (about {secs} s)</>
          : <> for 1 s (no callsign set, so no Morse)</>}, then the channel. Keys pressed meanwhile are ignored.</li>
        {fw === 'enhanced' && <li><b>Rx frequency on the head.</b> After 2 s on the channel number, the head shows the channel's
          Rx frequency two characters at a time, {stepS} s each (set with the speed slider), with a 0.5 s blank before and after, then the channel number again,
          in a loop{sample && <> (channel {sample.ch}: <span class="mono">(blank) {sample.w.map((w) => `“${w}”`).join(' ')} (blank)</span>)</>}.
          The channel number stays while transmitting; the cycle stops while scanning or showing selcall digits, and restarts on a
          channel change.</li>}
        <li><b>No off-hook timer in scan.</b> The factory firmware stops scanning when the handset is lifted (it parks on the
          priority or home channel), and if the handset is left off-hook on a quiet channel, its off-hook timer sounds a continuous
          tone after about 30 s until the handset is hung up. In this image scanning ignores the hook: the scan carries on with the
          handset off-hook, there is no off-hook timer and no tone. To stay on one channel, switch scan off.</li>
        <li><b>Everything else is factory.</b> Channels, CTCSS, keys, PTT, the Tx timeout and the head link behave as with the
          factory FM92R firmware.</li>
      </ul>
    </div>
  );
}

export function BuildPanel({ p, a, update, notify }: { p: Project; a: Analysis; update: Update; notify: (m: string, e?: boolean) => void }) {
  const [view, setView] = useState<'table' | 'all' | 'dump'>('table');
  const b = a.builder;
  const fm91 = p.hw[1] === '1';
  const base = a.img ? a.masterImg ?? undefined : undefined;
  const changed = useMemo(() => (a.img && base ? a.img.reduce((n, x, i) => n + (x !== base[i] ? 1 : 0), 0) : 0), [a.img, base]);
  const fname = `${safeName(p.name)}.BIN`;
  const chip = eprom(p.eprom);
  const fw: Firmware = p.firmware ?? 'standard';
  const noEnh = b ? enhancedProblem(b) : 'enter a valid hardware code first';
  const step = Math.max(STEP_TICKS[0], Math.min(STEP_TICKS[1], p.freqStep ?? STEP_DEFAULT));
  const stepS = (step * TICK_MS / 1000).toFixed(2);
  const morseOk = (() => { try { morseBytes(p.callsign ?? ''); return true; } catch { return false; } })();
  const sample = useMemo(() => {
    if (!a.img || p.firmware !== 'enhanced') return null;
    const ch = a.chans.map((c) => c.num).sort((x, y) => x - y)[0];
    const e = tableEntry(a.img, ch);
    return e[0] ? { ch, w: windows(entryNibbles(e)) } : null;
  }, [a.img, a.enhanced, a.chans]);

  return (
    <div class="panel build">
      {fw !== 'standard' && <div class="fullrow"><ExperimentalBanner what="this image" /></div>}
      <section class="card wide buildcard">
        <div>
          <h2>Build EPROM image</h2>
          {a.img && b && b.info ? (
            <dl>
              <dt>Master</dt><dd class="mono">{p.firmware === 'enhanced' ? 'FM92R.BIN + start-up ident + Rx frequency'
                : p.firmware === 'intro' ? 'FM92R.BIN + start-up ident' : b.info.master}</dd>
              <dt>Channels</dt><dd>{a.chans.length} (numbers {b.info.ch_min}–{b.info.ch_max})</dd>
              <dt>Synth step</dt><dd>{b.info.step_khz} kHz, IF {b.info.if_mhz >= 0 ? '+' : ''}{b.info.if_mhz.toFixed(1)} MHz</dd>
              <dt>Checksum</dt><dd class="mono">0x1F64 = {hx(a.img[0x1F64])}, 0x1F65 = {hx(a.img[0x1F65])} {verifyChecksum(a.img) ? '✓' : '✗'}</dd>
              <dt>Date</dt><dd class="mono">{hx(a.img[0x1FE2])}/{hx(a.img[0x1FE3])}/{hx(a.img[0x1FE4])} <small>DD/MM/YY</small></dd>
              <dt>Changed</dt><dd>{changed} bytes vs. the master</dd>
            </dl>
          ) : (
            <p class="msg bad">{a.codeError ?? a.buildError}</p>
          )}
          {a.vcoWarnings.map((w) => <p class="msg warn" title={`Original FPP warning: ${w}`}>{vcoMessage(w)}</p>)}
          {p.sw.slice(11, 15) !== '0000' && <p class="msg warn">Selcall codes are set: the selcall tones are left at their defaults.</p>}
          {p.keys && <p class="msg info">Head function keys are overridden (not Original FPP behaviour).</p>}
          {a.img && a.enhanced && <FirmwareInfo fw={fw} callsign={morseOk ? p.callsign?.trim().toUpperCase() ?? '' : ''} sample={sample} stepS={stepS} />}
        </div>
        <div class="buildactions">
          <label class="field">
            <span class="lab labicon" title="Build date: stamped into the EPROM image (0x1FE2–0x1FE4), as the Original FPP does"><Icon name="calendar" size={14} />Build date</span>
            <input type="date" value={p.date} onInput={(e) => update((q) => ({ ...q, date: (e.target as HTMLInputElement).value }))} />
          </label>
          <label class="field">
            <span class={`lab labicon ${fw !== 'standard' ? 'exp' : ''}`} title={fw !== 'standard' ? 'Firmware: experimental modified FM92R firmware (not factory)' : 'Firmware: the factory master, as the Original FPP builds it'}>
              <Icon name="heartPulse" size={14} />Firmware</span>
            <select value={fw} onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value as Firmware;
              update((q) => ({ ...q, firmware: v === 'standard' ? undefined : v }));
            }}>
              <option value="standard">Factory (Original FPP)</option>
              <option value="intro" disabled={!!noEnh && fw !== 'intro'} title="FM92R only: 00 and a Morse callsign at switch-on">Start-up ident (FM92R)</option>
              <option value="enhanced" disabled={!!noEnh && fw !== 'enhanced'} title="FM92R only: start-up ident, plus the Rx frequency on the head">Ident + Rx freq. (FM92R)</option>
            </select>
          </label>
          {fw === 'standard' && noEnh && b && <p class="hint">Modified firmware: {noEnh}.</p>}
          {fw === 'enhanced' && (
            <label class="field">
              <span class="lab labicon" title="How long each 2-character window of the Rx frequency readout stays on the head. The radio's timer counts in 26.6 ms steps; 0.11 s is the fastest the head link allows">
                <Icon name="speed" size={14} />Frequency display speed <small>({stepS} s per step)</small></span>
              <input type="range" class="speed" min={STEP_TICKS[0]} max={STEP_TICKS[1]} step={1} value={step}
                aria-valuetext={`${stepS} seconds per step`}
                onInput={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  update((q) => ({ ...q, freqStep: v === STEP_DEFAULT ? undefined : v }));
                }} />
              <span class="speedends"><small>fast {(STEP_TICKS[0] * TICK_MS / 1000).toFixed(2)} s</small>
                <small>{step !== STEP_DEFAULT ? <button class="linkish" onClick={() => update((q) => ({ ...q, freqStep: undefined }))}>default {(STEP_DEFAULT * TICK_MS / 1000).toFixed(2)} s</button> : `default ${(STEP_DEFAULT * TICK_MS / 1000).toFixed(2)} s`}</small>
                <small>slow {(STEP_TICKS[1] * TICK_MS / 1000).toFixed(2)} s</small></span>
            </label>
          )}
          {fw !== 'standard' && (
            <label class="field">
              <span class="lab labicon" title="Callsign the radio sends in Morse on its beep tone at switch-on (experimental firmware only)"><Icon name="bullhorn" size={14} />Start-up Ident Callsign (Morse) <small>(blank = none)</small></span>
              <input class={`mono ${morseOk ? '' : 'invalid'}`} value={p.callsign ?? ''} maxLength={12} placeholder="e.g. VK2FN"
                onInput={(e) => update((q) => ({ ...q, callsign: (e.target as HTMLInputElement).value.toUpperCase() || undefined }))} />
            </label>
          )}
          <label class="field">
            <span class="lab labicon" title="EPROM chip the image will be burned into: the 8 KB image is repeated to fill larger parts"><Icon name="chip" size={14} />EPROM</span>
            <select value={chip.part} onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value as EpromPart;
              update((q) => ({ ...q, eprom: v === '2764' ? undefined : v }));
            }}>
              {EPROMS.map((e) => <option value={e.part}>{e.part} ({e.size / 1024} KB)</option>)}
            </select>
          </label>
          <button class="primary big" disabled={!a.img} onClick={() => { download(fname, expandImage(a.img!, chip.part)); notify(`Saved ${fname} (${chip.part})`); }}>
            Download {fname}
          </button>
          <p class="hint">
            {chip.size} bytes for a {chip.part === '2764' ? '2764 / 27C64' : chip.part}.
            {chip.extra && <> The 8 KB image is repeated in all {chip.size / 0x2000} banks, so the radio runs whatever level the
              extra address pins ({chip.extra}) sit at.</>}
            {' '}For example: <code>minipro -p {chip.minipro} -w {fname}</code>
          </p>
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

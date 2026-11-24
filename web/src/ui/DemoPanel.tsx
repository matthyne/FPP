import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Analysis } from '../core/analyze';
import { BLUE_KEYS, HEAD_BUTTONS, KEY_LABELS } from '../core/codes';
import { F_SCAN1, F_SCAN2, KEY_FUNCS } from '../core/fm900';
import { MORSE_UNIT_S, entryNibbles, identSeconds, morseBytes, tableEntry, windows } from '../core/fork';
import { HeadConfig, HeadFirmware, HeadSim, KeyFunc, SEGMENTS } from '../core/headsim';
import { Project } from '../core/project';
import { Icon } from './icons';

// Seven-segment digit, 60 x 100 units, segments a-g as polygons (slanted with skewX in the SVG).
const SEG_PTS: Record<string, string> = {
  a: '14,4 46,4 40,12 20,12', b: '48,6 48,46 42,42 42,12', c: '48,54 48,94 42,88 42,58',
  d: '14,96 46,96 40,88 20,88', e: '12,54 12,94 18,88 18,58', f: '12,6 12,46 18,42 18,12',
  g: '14,50 20,45 40,45 46,50 40,55 20,55',
};

function Digit({ ch, x }: { ch: string; x: number }) {
  const lit = SEGMENTS[ch] ?? '';
  return (
    <g transform={`translate(${x} 0) skewX(-6)`}>
      {Object.entries(SEG_PTS).map(([s, pts]) => <polygon points={pts} class={lit.includes(s) ? 'seg on' : 'seg'} />)}
    </g>
  );
}

/** Web Audio beeps: key beep, reject warble, Morse ident (600 Hz square, like the radio's beep tone). */
class Beeper {
  private ctx: AudioContext | null = null;
  private tone(start: number, dur: number, freq = 600): void {
    const c = this.ctx!;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.value = 0.04;
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + start); o.stop(c.currentTime + start + dur);
  }
  private ready(): boolean {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return true;
    } catch { return false; }
  }
  /** Call from a click: browsers only start audio from a user gesture. */
  unlock(): void { this.ready(); }
  beep(): void { if (this.ready()) this.tone(0, 0.08); }
  reject(): void { if (this.ready()) for (let i = 0; i < 6; i++) this.tone(i * 0.054, 0.027, 450); }
  morse(text: string): void {
    if (!this.ready() || !text.trim()) return;
    let t = 0;
    for (const b of morseBytes(text)) {
      if (b === 0) break;
      if (b & 0x80) { t += (b === 0x81 ? 6 : 2) * MORSE_UNIT_S; continue; }
      this.tone(t, b * MORSE_UNIT_S);
      t += (b + 1) * MORSE_UNIT_S;
    }
  }
}

/** The head artwork (SVG, 436 x 160 units), drawn after the FM900 remote head; the keys are HTML buttons on top. */
function HeadArt({ on, tx, rx, display }: { on: boolean; tx: boolean; rx: boolean; display: string }) {
  return (
    <svg class="headart" viewBox="0 0 436 160" aria-hidden="true">
      <defs>
        <linearGradient id="hbody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3c3e" /><stop offset="1" stop-color="#232425" /></linearGradient>
        <pattern id="hgrille" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.25" fill="#141414" /></pattern>
        <radialGradient id="hknob" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#4a4a4a" /><stop offset="1" stop-color="#0c0c0c" /></radialGradient>
      </defs>
      <rect x="1" y="1" width="434" height="158" rx="6" fill="url(#hbody)" stroke="#111" stroke-width="2" />
      <rect x="6" y="6" width="424" height="148" rx="3" fill="none" stroke="#4a4b4e" stroke-width="0.8" />
      {/* speaker grille */}
      <rect x="20" y="12" width="110" height="98" rx="5" fill="#2b2b2c" stroke="#1a1a1a" />
      <rect x="24" y="16" width="102" height="90" rx="3" fill="url(#hgrille)" />
      <line x1="140" y1="10" x2="140" y2="150" stroke="#1a1a1b" stroke-width="1.2" />
      {/* knobs */}
      <circle cx="160" cy="40" r="15" fill="url(#hknob)" stroke="#000" /><line x1="160" y1="40" x2="152" y2="29" stroke="#ddd" stroke-width="1.6" />
      <circle cx="160" cy="114" r="15" fill="url(#hknob)" stroke="#000" /><line x1="160" y1="114" x2="152" y2="103" stroke="#ddd" stroke-width="1.6" />
      <text x="150" y="68" class="hlab">VOL</text><text x="160" y="85" class="hlab">MUTE</text>
      <line x1="146" y1="77" x2="184" y2="77" stroke="#8a8b8e" stroke-width="0.6" />
      <line x1="190" y1="10" x2="190" y2="150" stroke="#1a1a1b" stroke-width="1.2" />
      {/* display window and digits */}
      <rect x="198" y="22" width="110" height="56" rx="2" fill="#160404" stroke="#0a0a0a" stroke-width="2" />
      <g transform="translate(216 28) scale(0.44)"><Digit ch={display[0]} x={0} /><Digit ch={display[1]} x={70} /></g>
      {/* TX / RX / power lamps */}
      <rect x="318" y="27" width="9" height="5" rx="1" class={tx ? 'led red lit' : 'led red'} />
      <text x="317" y="41" class="hlab small">TX</text>
      <rect x="318" y="51" width="9" height="5" rx="1" class={rx ? 'led amber lit' : 'led amber'} />
      <text x="317" y="65" class="hlab small">RX</text>
      <rect x="318" y="91" width="9" height="5" rx="1" class={on ? 'led green lit' : 'led green'} />
      {/* arrow key wells (the keys themselves are HTML buttons) */}
      <rect x="198" y="82" width="52" height="22" rx="2" fill="#1b1b1c" /><rect x="255" y="82" width="52" height="22" rx="2" fill="#1b1b1c" />
      <text x="282" y="134" class="hmodel">FM 900</text>
      <line x1="340" y1="10" x2="340" y2="150" stroke="#1a1a1b" stroke-width="1.2" />
      {/* blue key wells and labels */}
      {[24, 55, 86].map((y) => <rect x="352" y={y - 2} width="34" height="15" rx="2" fill="#1b1b1c" />)}
      <text x="392" y="33" class="hlab">SEND</text><text x="392" y="64" class="hlab">AUX</text><text x="392" y="95" class="hlab">PWR</text>
      <rect x="356" y="114" width="56" height="28" rx="2" fill="#151516" stroke="#0b0b0b" />
    </svg>
  );
}

export function DemoPanel({ p, a }: { p: Project; a: Analysis }) {
  const fm92 = p.hw[1] === '2';
  const keyCodes = p.keys ?? a.defaultKeys;
  const fw: HeadFirmware = a.enhanced && p.firmware ? p.firmware as HeadFirmware : 'standard';
  const callsign = (p.callsign ?? '').trim().toUpperCase();

  const cfg = useMemo<HeadConfig | null>(() => {
    if (!fm92 || !a.img || !keyCodes) return null;
    const img = a.img;
    return {
      channels: a.chans.map((c) => c.num),
      scanLists: [a.chans.filter((c) => c.flags & F_SCAN1).map((c) => c.num), a.chans.filter((c) => c.flags & F_SCAN2).map((c) => c.num)],
      keys: keyCodes.map((k) => (KEY_FUNCS[k] ?? 'none') as KeyFunc),
      firmware: fw,
      identMs: fw === 'standard' ? 0 : (() => { try { return identSeconds(callsign) * 1000; } catch { return 1000; } })(),
      freqWindows: fw === 'enhanced' ? (ch) => {
        const e = tableEntry(img, ch);
        return e[0] ? windows(entryNibbles(e)) : null;
      } : undefined,
    };
  }, [fm92, a.img, a.chans, keyCodes?.join(','), fw, callsign]);

  const sim = useMemo(() => (cfg ? new HeadSim(cfg) : null), [cfg]);
  const [, setFrame] = useState(0);
  const [sound, setSound] = useState(true);
  const beeper = useRef(new Beeper());

  useEffect(() => {
    if (!sim) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      sim.tick(now - last);
      last = now;
      for (const e of sim.events.splice(0)) {
        if (!sound) continue;
        if (e === 'beep') beeper.current.beep();
        else if (e === 'reject') beeper.current.reject();
        else if (e === 'ident') beeper.current.morse(callsign);
      }
      setFrame((f) => f + 1);
    }, 40);
    return () => clearInterval(id);
  }, [sim, sound, callsign]);

  if (!fm92) return <div class="panel"><section class="card wide"><h2>Demo</h2><p>The demo shows the FM92 control head. This project's hardware code is not an FM92.</p></section></div>;
  if (!sim || !cfg) return <div class="panel"><section class="card wide"><h2>Demo</h2><p class="msg bad">The image doesn't build yet ({a.codeError ?? a.buildError ?? 'no channels'}), so there is nothing to demonstrate.</p></section></div>;

  const ch = a.chans.find((c) => c.num === sim.ch);
  const row = p.rows.find((r) => r.num.trim() === String(sim.ch));
  // Head keys, placed over the drawn head (coordinates in the 436 x 160 artwork, as percentages).
  // ▷ = UP (key code 1 position), ◁ = DOWN, then the blue keys SEND and AUX, and PWR. The SVG art is decoration.
  const unlock = () => { if (sound) beeper.current.unlock(); };
  const pos = (x: number, y: number, w: number, h: number) =>
    ({ left: `${(x / 436) * 100}%`, top: `${(y / 160) * 100}%`, width: `${(w / 436) * 100}%`, height: `${(h / 160) * 100}%` });
  const hkey = (j: number, x: number, y: number, w: number, h: number, cls: string, face: string) => {
    const f = cfg.keys[j];
    return (
      <button class={`hk ${cls}`} style={pos(x, y, w, h)} onClick={() => { unlock(); sim.press(j); }}
        title={`${HEAD_BUTTONS[j]}: ${KEY_LABELS[f] ?? f}`} aria-label={`${HEAD_BUTTONS[j]} (${KEY_LABELS[f] ?? f})`}>{face}</button>
    );
  };

  return (
    <div class="panel demo">
      <section class="card wide">
        <h2>Control head demo</h2>
        <p class="hint">Try this channel plan on a simulated FM92 control head: switch it on, then use the keys as programmed
          {p.keys ? ' (your key override)' : ' (the Original FPP defaults)'}. {fw === 'enhanced'
            ? 'This is the experimental Ident + Rx freq. image: after 2 s on a channel the head shows its Rx frequency.'
            : fw === 'intro' ? 'This is the experimental Start-up ident image: "00" and the Morse callsign at switch-on.'
              : 'Pick an experimental firmware on the Build tab to see the start-up ident and Rx frequency readout.'}</p>

        <div class="headwrap">
          <div class={`head2 ${sim.on ? 'on' : ''}`}>
            <HeadArt on={sim.on} tx={sim.tx} rx={sim.monitor} display={sim.on ? sim.display : '  '} />
            {hkey(1, 200, 84, 48, 18, 'arrow', '◁')}
            {hkey(0, 257, 84, 48, 18, 'arrow', '▷')}
            {hkey(3, 354, 24, 30, 11, 'blue', '')}
            {hkey(2, 354, 55, 30, 11, 'blue', '')}
            <button class="hk blue" style={pos(354, 86, 30, 11)} onClick={() => { unlock(); sim.power(); }}
              title={sim.on ? 'PWR: switch off' : 'PWR: switch on'} aria-label="Power" />
          </div>
          <button class={`hptt ${sim.tx ? 'lit' : ''}`} disabled={!sim.on}
            onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); sim.ptt(true); }}
            onPointerUp={() => sim.ptt(false)} onPointerCancel={() => sim.ptt(false)}
            title="Microphone PTT: hold to transmit"><Icon name="mic" size={20} /> Mic PTT (hold)</button>
        </div>
        <p class="keylegend">{[[0, '▷'], [1, '◁'], [2, 'AUX'], [3, 'SEND']].map(([j, face]) => (
          <span><b class={`kbtn${BLUE_KEYS.has(HEAD_BUTTONS[j as number]) ? ' blue' : ''}`}>{face}</b>{KEY_LABELS[cfg.keys[j as number]] ?? cfg.keys[j as number]}</span>
        ))}<span><b class="kbtn blue">PWR</b>On / off</span></p>

        <label class="demosound"><input type="checkbox" checked={sound} onChange={(e) => setSound((e.target as HTMLInputElement).checked)} />
          Sound (key beep{fw !== 'standard' && callsign ? ', Morse ident' : ''})</label>

        {sim.on && ch && (
          <dl class="demoinfo">
            <dt>Channel</dt><dd>{sim.ch}{row?.name ? ` · ${row.name}` : ''}</dd>
            <dt>Rx / Tx</dt><dd class="mono">{ch.rx} / {ch.tx.startsWith('X') ? 'Rx only' : ch.tx} MHz</dd>
            <dt>Scanning</dt><dd>{sim.scan ? `list ${sim.scan} (${cfg.scanLists[sim.scan - 1].length} channels)` : 'off'}</dd>
          </dl>
        )}

        <p class="hint">Drawn after the FM900 remote head (▷ / ◁ = up / down, blue SEND, AUX and PWR keys, TX and RX lamps,
          green power lamp). The RX lamp lights while the monitor is on; the VOL and MUTE knobs are decoration. A
          behavioural model, not the radio's firmware: no received signals (so a scan never stops on a channel) and
          selcall keys aren't simulated. Channel keys skip numbers with no channel and wrap; they are refused (reject
          beep) while transmitting or scanning, as on the radio.</p>
      </section>
    </div>
  );
}

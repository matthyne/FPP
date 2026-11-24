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
  const key = (j: number) => {
    const f = cfg.keys[j];
    return (
      <div class="demokey">
        <button class={`hkey${BLUE_KEYS.has(HEAD_BUTTONS[j]) ? ' blue' : ''}`} onClick={() => { if (sound) beeper.current.unlock(); sim.press(j); }}
          title={`${HEAD_BUTTONS[j]}: ${KEY_LABELS[f] ?? f}`}>{HEAD_BUTTONS[j]}</button>
        <small>{KEY_LABELS[f] ?? f}</small>
      </div>
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
          <div class={`head ${sim.on ? 'on' : ''}`}>
            <div class="headtop">
              <div class="lcdwin" aria-label={`Display: ${sim.display.trim() || 'blank'}`} role="img">
                <svg viewBox="-6 -4 132 108" width="132" height="108">
                  <Digit ch={sim.on ? sim.display[0] : ' '} x={0} />
                  <Digit ch={sim.on ? sim.display[1] : ' '} x={64} />
                </svg>
              </div>
              <div class="lamps" aria-label="Demo indicators">
                <span class={`lamp tx ${sim.tx ? 'lit' : ''}`}>TX</span>
                <span class={`lamp mon ${sim.monitor ? 'lit' : ''}`}>MON</span>
                <span class={`lamp scan ${sim.scan ? 'lit' : ''}`}>SCAN</span>
              </div>
              <button class={`hpower ${sim.on ? 'lit' : ''}`} onClick={() => { if (sound) beeper.current.unlock(); sim.power(); }} title={sim.on ? 'Switch off' : 'Switch on'}
                aria-label="Power"><Icon name="power" size={22} /></button>
            </div>
            <div class="headkeysrow">{[0, 1, 2, 3].map(key)}</div>
          </div>
          <button class={`hptt ${sim.tx ? 'lit' : ''}`} disabled={!sim.on}
            onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); sim.ptt(true); }}
            onPointerUp={() => sim.ptt(false)} onPointerCancel={() => sim.ptt(false)}
            title="Microphone PTT: hold to transmit"><Icon name="mic" size={20} /> PTT (hold)</button>
        </div>

        <label class="demosound"><input type="checkbox" checked={sound} onChange={(e) => setSound((e.target as HTMLInputElement).checked)} />
          Sound (key beep{fw !== 'standard' && callsign ? ', Morse ident' : ''})</label>

        {sim.on && ch && (
          <dl class="demoinfo">
            <dt>Channel</dt><dd>{sim.ch}{row?.name ? ` · ${row.name}` : ''}</dd>
            <dt>Rx / Tx</dt><dd class="mono">{ch.rx} / {ch.tx.startsWith('X') ? 'Rx only' : ch.tx} MHz</dd>
            <dt>Scanning</dt><dd>{sim.scan ? `list ${sim.scan} (${cfg.scanLists[sim.scan - 1].length} channels)` : 'off'}</dd>
          </dl>
        )}

        <p class="hint">A behavioural model, not the radio's firmware: no received signals (so a scan never stops on a
          channel), selcall keys aren't simulated, and the TX / MON / SCAN lamps are demo indicators. Channel keys skip
          numbers with no channel and wrap; they are refused (reject beep) while transmitting or scanning, as on the radio.</p>
      </section>
    </div>
  );
}

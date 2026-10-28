import { Analysis } from '../core/analyze';
import { BAND_MHZ, Digit, EXAMPLES, HW_DIGITS, SW_DIGITS } from '../core/codes';
import { Project } from '../core/project';
import type { Update } from './App';

function setDigit(code: string, len: number, i: number, d: string): string {
  const c = code.padEnd(len, '0').slice(0, len);
  return c.slice(0, i) + d + c.slice(i + 1);
}

function DigitSelect({ code, len, i, d, onSet }: { code: string; len: number; i: number; d: Digit; onSet: (v: string) => void }) {
  const v = code[i] ?? '';
  const known = d.options.some(([k]) => k === v);
  return (
    <label class="field digit">
      <span class="lab"><b class="mono">{len === 8 ? 'h' : 's'}{i}</b> {d.label}</span>
      <select value={v} onChange={(e) => onSet(setDigit(code, len, i, (e.target as HTMLSelectElement).value))}
        class={d.unsupported?.includes(v) ? 'warn' : ''}>
        {!known && <option value={v}>{v || '—'} (unknown)</option>}
        {d.options.map(([k, m]) => (
          <option value={k}>{k} · {m}{d.unsupported?.includes(k) ? ' (not supported)' : ''}</option>
        ))}
      </select>
    </label>
  );
}

export function RadioPanel({ p, a, update }: { p: Project; a: Analysis; update: Update }) {
  const set = (patch: Partial<Project>) => update((q) => {
    const n = { ...q, ...patch };
    return n.hw[1] !== '2' ? { ...n, keys: null } : n;   // key remapping is FM92-only
  });
  const b = a.builder;
  const band = BAND_MHZ[p.hw[2]];
  const enc = p.sw.slice(11, 13), dec = p.sw.slice(13, 15);
  const setSel = (i: number, v: string) => {
    const two = v.replace(/\D/g, '').slice(-2).padStart(2, '0');
    set({ sw: p.sw.padEnd(15, '0').slice(0, i) + two + p.sw.padEnd(15, '0').slice(i + 2) });
  };

  return (
    <div class="panel radio">
      <section class="card">
        <h2>Job</h2>
        <div class="grid2">
          <label class="field">
            <span class="lab">Job name <small>(file name, 8 chars)</small></span>
            <input value={p.name} maxLength={8} onInput={(e) => set({ name: (e.target as HTMLInputElement).value.toUpperCase() })} />
          </label>
          <label class="field">
            <span class="lab">Build date <small>(stamped at 0x1FE2; blank = today)</small></span>
            <input type="date" value={p.date} onInput={(e) => set({ date: (e.target as HTMLInputElement).value })} />
          </label>
        </div>
        <label class="field">
          <span class="lab">Comments <small>(up to 5 lines, saved in the .JOB)</small></span>
          <textarea rows={3} value={p.comments.join('\n')}
            onInput={(e) => set({ comments: (e.target as HTMLTextAreaElement).value.split('\n').slice(0, 5) })} />
        </label>
        <label class="field">
          <span class="lab">Start from an example</span>
          <select value="" onChange={(e) => {
            const ex = EXAMPLES[+(e.target as HTMLSelectElement).value];
            if (ex) set({ hw: ex.hw, sw: ex.sw });
          }}>
            <option value="">Choose…</option>
            {EXAMPLES.map((ex, i) => <option value={i}>{ex.name} — {ex.hw} / {ex.sw}</option>)}
          </select>
        </label>
      </section>

      <section class="card summary">
        <h2>Radio</h2>
        {a.codeError ? <p class="msg bad">{a.codeError}</p> : b && (
          <dl>
            <dt>Model</dt><dd>{p.hw[1] === '1' ? 'FM91, 120 channels' : 'FM92, 99 channels'}</dd>
            <dt>Master</dt><dd class="mono">{b.masterName()}</dd>
            <dt>Band</dt><dd>{band ? `${band[0]}–${band[1]} MHz` : '?'}</dd>
            <dt>IF</dt><dd>{(b.ifOffset() / 100000).toFixed(1)} MHz ({b.ifOffset() < 0 ? 'low' : 'high'}-side LO)</dd>
            <dt>Synth step</dt><dd>{a.img ? `${b.step / 100} kHz` : (p.hw[2] <= '4' ? (p.hw[3] <= '4' ? '5 kHz (6.25 fallback)' : '6.25 kHz (5 fallback)') : (p.hw[3] <= '4' ? '25 kHz' : '12.5 kHz'))}</dd>
            <dt>Control</dt><dd>{'1357'.includes(p.hw[3]) ? 'Local front panel (L)' : 'Remote head (R)'}</dd>
          </dl>
        )}
        {p.sw.slice(11, 15) !== '0000' && /^\d{15}$/.test(p.sw) && (
          <p class="msg warn">Selcall codes are set. FM900.EXE would continue into its selcall editor; this tool leaves the selcall tones at their defaults.</p>
        )}
      </section>

      <section class="card wide">
        <div class="codehead">
          <h2>Hardware code</h2>
          <input class={`code mono ${/^\d{8}$/.test(p.hw) ? '' : 'invalid'}`} value={p.hw} maxLength={8} inputMode="numeric"
            aria-label="Hardware code" onInput={(e) => set({ hw: (e.target as HTMLInputElement).value.replace(/\D/g, '') })} />
        </div>
        <div class="digits">
          {HW_DIGITS.map((d, i) => <DigitSelect code={p.hw} len={8} i={i} d={d} onSet={(hw) => set({ hw })} />)}
        </div>
      </section>

      <section class="card wide">
        <div class="codehead">
          <h2>Software code</h2>
          <input class={`code mono ${/^\d{15}$/.test(p.sw) ? '' : 'invalid'}`} value={p.sw} maxLength={15} inputMode="numeric"
            aria-label="Software code" onInput={(e) => set({ sw: (e.target as HTMLInputElement).value.replace(/\D/g, '') })} />
        </div>
        <div class="digits">
          {SW_DIGITS.map((d, i) => <DigitSelect code={p.sw} len={15} i={i} d={d} onSet={(sw) => set({ sw })} />)}
          <label class="field digit">
            <span class="lab"><b class="mono">s11–12</b> Selcall encode format</span>
            <input class="mono" value={enc} inputMode="numeric" maxLength={2} onChange={(e) => setSel(11, (e.target as HTMLInputElement).value)} />
          </label>
          <label class="field digit">
            <span class="lab"><b class="mono">s13–14</b> Selcall decode format</span>
            <input class="mono" value={dec} inputMode="numeric" maxLength={2} onChange={(e) => setSel(13, (e.target as HTMLInputElement).value)} />
          </label>
        </div>
      </section>
    </div>
  );
}

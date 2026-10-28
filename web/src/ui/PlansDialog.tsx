import { useState } from 'preact/hooks';
import { F_HIGH, F_LOW, F_MED } from '../core/fm900';
import { DataChannels, PLANS, PlanOptions } from '../core/presets';
import { Row } from '../core/project';

const POWER: [number, string][] = [[F_HIGH, 'H 25 W'], [F_MED, 'M 5 W'], [F_LOW, 'L 1 W']];

export function PlansDialog({ hw, existing, close, apply }: {
  hw: string; existing: number; close: () => void; apply: (rows: Row[], mode: 'append' | 'replace') => void;
}) {
  const [id, setId] = useState(hw[3] === '3' || hw[3] === '4' ? 'uhfcb40' : 'uhfcb80');
  const plan = PLANS.find((p) => p.id === id)!;
  const [opts, setOpts] = useState<Record<string, PlanOptions>>(Object.fromEntries(PLANS.map((p) => [p.id, { ...p.defaults }])));
  const o = opts[id];
  const set = (patch: Partial<PlanOptions>) => setOpts({ ...opts, [id]: { ...o, ...patch } });
  const rows = plan.build(o);
  const nmax = hw[1] === '1' ? 120 : 99;
  const maxNum = Math.max(...rows.map((r) => +r.num));
  const wideRadio = hw[3] === '3' || hw[3] === '4';

  return (
    <div class="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <div class="modal" role="dialog" aria-label="Channel plans">
        <h2>Channel plans</h2>
        <div class="plans">
          {PLANS.map((p) => (
            <label class={`plan ${p.id === id ? 'active' : ''}`}>
              <input type="radio" name="plan" checked={p.id === id} onChange={() => setId(p.id)} />
              <span><b>{p.name}</b><br /><small>{p.description}</small><br /><small>Needs: {p.needs}</small></span>
            </label>
          ))}
        </div>
        <div class="grid2">
          <label class="check"><input type="checkbox" checked={o.duplex} onChange={() => set({ duplex: !o.duplex })} /> Add repeater (duplex) channels</label>
          {o.duplex ? (
            <label class="field inline"><span class="lab">Duplex channels from</span>
              <input value={o.duplexStart} size={4} inputMode="numeric" onInput={(e) => set({ duplexStart: parseInt((e.target as HTMLInputElement).value, 10) || 1 })} /></label>
          ) : <span />}
          <label class="field"><span class="lab">Channels 22, 23 (data only) and 61–63 (reserved)</span>
            <select value={o.dataChannels} onChange={(e) => set({ dataChannels: (e.target as HTMLSelectElement).value as DataChannels })}>
              <option value="rxonly">Receive only</option>
              <option value="include">Include as normal channels</option>
              <option value="omit">Leave out</option>
            </select></label>
          <label class="field"><span class="lab">Power</span>
            <select value={o.power} onChange={(e) => set({ power: +(e.target as HTMLSelectElement).value })}>
              {POWER.map(([v, l]) => <option value={v}>{l}</option>)}
            </select></label>
        </div>
        <p class="hint">{rows.length} channels, numbered {Math.min(...rows.map((r) => +r.num))}–{maxNum}. Voice is not allowed on
          channels 22 and 23; 5 and 35 are emergency, 11 is calling.</p>
        {plan.spacingKHz < 25 && wideRadio && <p class="msg warn">This radio is set for 25 kHz spacing (hardware digit 4 = {hw[3]}), so channels 41–80 can't be built. Use the 40-channel plan, or set 12.5 kHz spacing on the Radio tab.</p>}
        {maxNum > nmax && <p class="msg warn">Channel {maxNum} is beyond this radio's {nmax} channels: lower the duplex start or turn duplex off.</p>}
        {existing + rows.length > nmax && maxNum <= nmax && <p class="hint">Appending gives {existing + rows.length} rows; use Replace to start fresh.</p>}
        <div class="actions">
          <button onClick={close}>Cancel</button>
          <button onClick={() => apply(rows, 'replace')}>Replace all</button>
          <button class="primary" onClick={() => apply(rows, 'append')}>Append {rows.length}</button>
        </div>
      </div>
    </div>
  );
}

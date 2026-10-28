import { Analysis } from '../core/analyze';
import { F_PRI1, F_PRI2, F_PRI3, F_SCAN1, F_SCAN2, F_SCAN3, KEY_FUNCS } from '../core/fm900';
import { Project, Row, isBlank } from '../core/project';
import type { Update } from './App';

const KEY_HELP: Record<string, string> = {
  none: 'button does nothing', up: 'channel up (skips empty, wraps)', down: 'channel down',
  tens: 'next block of ten (23 → 30)', units: 'units digit up within the block', scan: 'scan on/off',
  monitor: 'monitor (squelch defeat)', selcall: 'send selcall', dial: 'selcall dial mode',
};

export function ScanKeysPanel({ p, a, update }: { p: Project; a: Analysis; update: Update }) {
  const fm92 = p.hw[1] === '2';
  const blocks: [number, number, number][] = [[1, F_SCAN1, F_PRI1], [2, F_SCAN2, F_PRI2]];
  if (!fm92) blocks.push([3, F_SCAN3, F_PRI3]);
  const live = p.rows.map((r, i) => [r, i] as [Row, number]).filter(([r]) => !isBlank(r));
  const setRows = (fn: (rows: Row[]) => Row[]) => update((q) => ({ ...q, rows: fn(q.rows) }));
  const keys = p.keys ?? a.defaultKeys ?? [1, 2, 5, 0];

  return (
    <div class="panel scan">
      <section class="card wide">
        <h2>Scan blocks</h2>
        <p class="hint">Members are listed in row order, which is the order FM900.EXE writes them. Each block holds at most 10 channels.
          You can also tick S1/P1/S2/P2 in the channel grid.</p>
        <div class="blocks">
          {blocks.map(([n, fm, fp]) => {
            const mem = live.filter(([r]) => r.flags & fm);
            const pri = live.find(([r]) => r.flags & fp);
            const over = mem.length > 10;
            return (
              <div class="block">
                <h3>Block {n} <span class={`pill ${over ? 'bad' : ''}`}>{mem.length}/10</span></h3>
                <div class="chips">
                  {mem.length === 0 && <span class="hint">No channels</span>}
                  {mem.map(([r, i]) => (
                    <span class="chip">
                      <b>{r.num}</b> <span class="mono">{r.rx}</span>
                      <button aria-label={`Remove channel ${r.num} from block ${n}`}
                        onClick={() => setRows((rows) => rows.map((x, k) => (k === i ? { ...x, flags: x.flags & ~fm } : x)))}>×</button>
                    </span>
                  ))}
                </div>
                <div class="row">
                  <label class="field">
                    <span class="lab">Add channel</span>
                    <select value="" onChange={(e) => {
                      const i = +(e.target as HTMLSelectElement).value;
                      setRows((rows) => rows.map((x, k) => (k === i ? { ...x, flags: x.flags | fm } : x)));
                    }}>
                      <option value="">Choose…</option>
                      {live.filter(([r]) => !(r.flags & fm)).map(([r, i]) => <option value={i}>{r.num} · {r.rx}</option>)}
                    </select>
                  </label>
                  <label class="field">
                    <span class="lab">Priority channel</span>
                    <select value={pri ? String(pri[1]) : ''} onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      setRows((rows) => rows.map((x, k) => ({ ...x, flags: v !== '' && k === +v ? x.flags | fp : x.flags & ~fp })));
                    }}>
                      <option value="">None</option>
                      {live.map(([r, i]) => <option value={i}>{r.num} · {r.rx}</option>)}
                    </select>
                  </label>
                </div>
                {over && <p class="msg bad">More than 10 channels: the build will fail.</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section class="card wide">
        <h2>Head function keys {fm92 ? '' : <small>(FM92 only)</small>}</h2>
        {!fm92 ? (
          <p class="hint">On the FM91 the key bytes 0x1F58–0x1F5B hold scan block 3, so they can't be remapped.</p>
        ) : (
          <>
            <p class="hint">The FM92 acts on four key codes from the control head: 1, 2, 4 and 7. Each runs the function stored at
              0x1F58–0x1F5B. FM900.EXE fills these from the software code. Overriding them is the one deliberate
              deviation from FM900.EXE; it only changes the image checksum.</p>
            <label class="check">
              <input type="checkbox" checked={p.keys !== null}
                onChange={() => update((q) => ({ ...q, keys: q.keys === null ? [...(a.defaultKeys ?? [1, 2, 5, 0])] : null }))} />
              Override the function keys
            </label>
            <div class="keys">
              {[1, 2, 4, 7].map((k, j) => (
                <label class="field">
                  <span class="lab">Key {k} {a.defaultKeys && <small>(default: {KEY_FUNCS[a.defaultKeys[j]] ?? a.defaultKeys[j]})</small>}</span>
                  <select disabled={p.keys === null} value={keys[j]}
                    onChange={(e) => update((q) => ({ ...q, keys: (q.keys ?? keys).map((x, m) => (m === j ? +(e.target as HTMLSelectElement).value : x)) }))}>
                    {KEY_FUNCS.map((f, v) => <option value={v}>{v} · {f} — {KEY_HELP[f]}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <p class="hint">The firmware can't tell which physical button sends which code. Find out by trying each one with known settings.</p>
          </>
        )}
      </section>
    </div>
  );
}

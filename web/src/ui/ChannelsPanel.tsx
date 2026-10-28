import { useEffect, useState } from 'preact/hooks';
import { Analysis } from '../core/analyze';
import {
  CTCSS, F_CR, F_ECON, F_HIGH, F_LOW, F_MED, F_PRI1, F_PRI2, F_PRI3, F_SCAN1, F_SCAN2, F_SCAN3,
  F_SCANSEL, F_SELCALL, F_SELPWR, F_VOTE, normFreq,
} from '../core/fm900';
import { Project, Row } from '../core/project';
import type { Update } from './App';
import { errMsg } from './App';
import { ImportDialog, ImportSource } from './ImportDialog';

const POWER: [number, string][] = [[F_HIGH, 'H 25 W'], [F_MED, 'M 5 W'], [F_LOW, 'L 1 W'], [F_SELPWR, 'S select'], [0, '—']];
const PWR_MASK = F_HIGH | F_MED | F_LOW | F_SELPWR;
const TONES = [...CTCSS].sort((x, y) => x[2] - y[2]);

const powerOf = (f: number) => (f & F_HIGH ? F_HIGH : f & F_MED ? F_MED : f & F_LOW ? F_LOW : f & F_SELPWR ? F_SELPWR : 0);

interface FlagCol { f: number; label: string; title: string; fm91?: boolean }
const FLAG_COLS: FlagCol[] = [
  { f: F_SCAN1, label: 'S1', title: 'Member of scan block 1 (max 10)' },
  { f: F_PRI1, label: 'P1', title: 'Priority channel of scan block 1' },
  { f: F_SCAN2, label: 'S2', title: 'Member of scan block 2 (max 10)' },
  { f: F_PRI2, label: 'P2', title: 'Priority channel of scan block 2' },
  { f: F_SCAN3, label: 'S3', title: 'Member of scan block 3 (FM91 only)', fm91: true },
  { f: F_PRI3, label: 'P3', title: 'Priority channel of scan block 3 (FM91 only)', fm91: true },
  { f: F_SCANSEL, label: 'OpS', title: 'Operator-selectable scanning' },
  { f: F_VOTE, label: 'Vote', title: 'VOTE: linked-slot voting ring' },
  { f: F_ECON, label: 'Econ', title: 'Economiser on this channel' },
  { f: F_SELCALL, label: 'Sel', title: 'SELCALL on this channel' },
  { f: F_CR, label: 'C/R', title: 'Community repeater (CTCSS)' },
];

function fmtMHz(units100: number): string {
  return `${Math.floor(units100 / 10000)}.${String(units100 % 10000).padStart(4, '0')}`;
}
function toUnits(s: string): number {   // MHz string -> 100 Hz units
  const n = normFreq(s);
  const [a, b] = n.split('.');
  return +a * 10000 + +b * (a.startsWith('-') ? -1 : 1);
}

function focusCell(row: number, col: string) {
  const el = document.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
  el?.focus();
  if (el instanceof HTMLInputElement) el.select();
}

export function ChannelsPanel({ p, a, update, notify, pendingImport, clearImport }: {
  p: Project; a: Analysis; update: Update; notify: (m: string, e?: boolean) => void;
  pendingImport: ImportSource | null; clearImport: () => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<'none' | 'import' | 'fill' | 'offset'>(pendingImport ? 'import' : 'none');
  useEffect(() => { if (pendingImport) setDialog('import'); }, [pendingImport]);
  const fm91 = p.hw[1] === '1';
  const cols = FLAG_COLS.filter((c) => fm91 || !c.fm91);
  const selected = [...sel].filter((i) => i < p.rows.length).sort((x, y) => x - y);

  const setRows = (fn: (rows: Row[]) => Row[]) => update((q) => ({ ...q, rows: fn(q.rows) }));
  const setRow = (i: number, patch: Partial<Row>) => setRows((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const nextNum = () => {
    const nums = p.rows.map((r) => parseInt(r.num, 10)).filter((n) => !Number.isNaN(n));
    return String(nums.length ? Math.max(...nums) + 1 : 1);
  };
  const addRow = () => {
    const last = p.rows[p.rows.length - 1];
    setRows((rows) => [...rows, { num: nextNum(), rx: '', tx: '', flags: last ? last.flags & PWR_MASK : F_HIGH, ctcss: '' }]);
    setTimeout(() => focusCell(p.rows.length, 'rx'), 0);
  };
  const toggleSel = (i: number) => setSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const allSel = selected.length === p.rows.length && p.rows.length > 0;

  const delSel = () => { setRows((rows) => rows.filter((_, i) => !sel.has(i))); setSel(new Set()); };
  const dupSel = () => {
    setRows((rows) => { const out = [...rows]; selected.slice().reverse().forEach((i) => out.splice(i + 1, 0, { ...rows[i] })); return out; });
    setSel(new Set());
  };
  const move = (d: -1 | 1) => {
    if (!selected.length) return;
    if ((d < 0 && selected[0] === 0) || (d > 0 && selected[selected.length - 1] === p.rows.length - 1)) return;
    setRows((rows) => {
      const out = [...rows];
      const order = d < 0 ? selected : selected.slice().reverse();
      for (const i of order) [out[i], out[i + d]] = [out[i + d], out[i]];
      return out;
    });
    setSel(new Set(selected.map((i) => i + d)));
  };
  const bulkFlags = (fn: (f: number) => number) =>
    setRows((rows) => rows.map((r, i) => (sel.has(i) ? { ...r, flags: fn(r.flags) } : r)));
  const renumber = () => setRows((rows) => rows.map((r, i) => ({ ...r, num: String(i + 1) })));
  const sortByNum = () => {
    if (!window.confirm('Sort rows by channel number? Row order decides scan-list order and duplicate/VOTE ring slots.')) return;
    setRows((rows) => [...rows].sort((x, y) => (parseInt(x.num, 10) || 0) - (parseInt(y.num, 10) || 0)));
  };

  const onKey = (i: number, col: string) => (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      if (i + 1 < p.rows.length) focusCell(i + 1, col);
      else if (e.key === 'Enter') addRow();
    } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      if (i > 0) focusCell(i - 1, col);
    }
  };

  const issues = [...new Set([...a.rowErrors.keys(), ...a.rowWarnings.keys()])].sort((x, y) => x - y);

  return (
    <div class="panel channels">
      <div class="toolbar">
        <button class="primary" onClick={addRow}>+ Channel</button>
        <button onClick={() => setDialog('fill')}>Fill range…</button>
        <button onClick={() => setDialog('import')} title="CSV from CHIRP, RepeaterBook, RadioReference or a spreadsheet">Import CSV / paste…</button>
        <button onClick={renumber} title="Number the rows 1, 2, 3… in their current order">Renumber</button>
        <button onClick={sortByNum}>Sort by Ch</button>
        <span class="count">{a.chans.length} / {a.nmax} channels</span>
      </div>
      {selected.length > 0 && (
        <div class="toolbar selbar">
          <span>{selected.length} selected</span>
          <button onClick={() => move(-1)} title="Move up">↑</button>
          <button onClick={() => move(1)} title="Move down">↓</button>
          <button onClick={dupSel}>Duplicate</button>
          <button onClick={() => setDialog('offset')}>Tx offset…</button>
          <select value="" aria-label="Set power" onChange={(e) => { const v = +(e.target as HTMLSelectElement).value; bulkFlags((f) => (f & ~PWR_MASK) | v); }}>
            <option value="">Power…</option>
            {POWER.map(([v, l]) => <option value={v}>{l}</option>)}
          </select>
          <select value="" aria-label="Set CTCSS" onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            setRows((rows) => rows.map((r, i) => (sel.has(i) ? { ...r, ctcss: v === '-' ? '' : v } : r)));
          }}>
            <option value="">CTCSS…</option>
            <option value="-">None</option>
            {TONES.map(([c, , hz]) => <option value={c}>{hz.toFixed(1)}</option>)}
          </select>
          <button class="danger" onClick={delSel}>Delete</button>
          <button onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {p.rows.length === 0 ? (
        <div class="empty">
          <p>No channels yet.</p>
          <p><button class="primary" onClick={addRow}>+ Add a channel</button> <button onClick={() => setDialog('import')}>Import a CSV / paste a list</button> <button onClick={() => setDialog('fill')}>Fill a range</button></p>
          <p class="hint">Or drop a <code>.JOB</code> + <code>.CHL</code> pair, a CSV, or a project file anywhere on the page.</p>
        </div>
      ) : (
        <div class="gridwrap">
          <table class="grid">
            <thead>
              <tr>
                <th class="sel"><input type="checkbox" aria-label="Select all" checked={allSel}
                  onChange={() => setSel(allSel ? new Set() : new Set(p.rows.map((_, i) => i)))} /></th>
                <th class="st" />
                <th>Ch</th><th>Rx MHz</th><th>Tx MHz <small>(X = Rx only)</small></th><th>Power</th><th>CTCSS Hz</th><th>Name</th>
                {cols.map((c) => <th class="flag" title={c.title}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r, i) => {
                const err = a.rowErrors.get(i), warns = a.rowWarnings.get(i);
                const tip = [err, ...(warns ?? [])].filter(Boolean).join('\n');
                const ctKnown = !r.ctcss || TONES.some(([c]) => c === r.ctcss);
                return (
                  <tr class={`${sel.has(i) ? 'selected' : ''} ${err ? 'err' : warns ? 'warnrow' : ''}`}>
                    <td class="sel"><input type="checkbox" aria-label={`Select row ${i + 1}`} checked={sel.has(i)} onChange={() => toggleSel(i)} /></td>
                    <td class="st" title={tip}>{err ? <span class="ico bad">●</span> : warns ? <span class="ico warn">▲</span> : ''}</td>
                    <td><input class="num mono" data-row={i} data-col="num" value={r.num} inputMode="numeric" size={3}
                      onInput={(e) => setRow(i, { num: (e.target as HTMLInputElement).value })} onKeyDown={onKey(i, 'num')} /></td>
                    <td><input class="freq mono" data-row={i} data-col="rx" value={r.rx} inputMode="decimal" placeholder="147.0000"
                      onInput={(e) => setRow(i, { rx: (e.target as HTMLInputElement).value })}
                      onBlur={(e) => { try { const v = (e.target as HTMLInputElement).value; if (v.trim()) setRow(i, { rx: normFreq(v) }); } catch { /* row shows the error */ } }}
                      onKeyDown={onKey(i, 'rx')} /></td>
                    <td><input class="freq mono" data-row={i} data-col="tx" value={r.tx} placeholder={r.rx || 'same as Rx'}
                      onInput={(e) => setRow(i, { tx: (e.target as HTMLInputElement).value })}
                      onBlur={(e) => { try { const v = (e.target as HTMLInputElement).value; if (v.trim()) setRow(i, { tx: v.trim().toUpperCase().startsWith('X') ? 'X' : normFreq(v) }); } catch { /* shown */ } }}
                      onKeyDown={onKey(i, 'tx')} /></td>
                    <td><select data-row={i} data-col="pw" value={powerOf(r.flags)} aria-label="Power"
                      onChange={(e) => setRow(i, { flags: (r.flags & ~PWR_MASK) | +(e.target as HTMLSelectElement).value })}>
                      {POWER.map(([v, l]) => <option value={v}>{l}</option>)}
                    </select></td>
                    <td><select data-row={i} data-col="ct" value={r.ctcss} aria-label="CTCSS"
                      onChange={(e) => setRow(i, { ctcss: (e.target as HTMLSelectElement).value })}>
                      <option value="">—</option>
                      {!ctKnown && <option value={r.ctcss}>{r.ctcss} (invalid)</option>}
                      {TONES.map(([c, , hz]) => <option value={c}>{hz.toFixed(1)}</option>)}
                    </select></td>
                    <td><input class="name" data-row={i} data-col="name" value={r.name ?? ''} placeholder="—" aria-label="Name (not stored in the radio)"
                      onInput={(e) => setRow(i, { name: (e.target as HTMLInputElement).value })} onKeyDown={onKey(i, 'name')} /></td>
                    {cols.map((c) => (
                      <td class="flag"><input type="checkbox" aria-label={`${c.title}, row ${i + 1}`} checked={!!(r.flags & c.f)}
                        onChange={() => setRow(i, { flags: r.flags ^ c.f })} /></td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {issues.length > 0 && (
        <section class="issues">
          <h3>Problems</h3>
          <ul>
            {issues.map((i) => (
              <li>
                <button class="link" onClick={() => focusCell(i, 'rx')}>Row {i + 1}</button>{' '}
                {a.rowErrors.has(i) && <span class="bad">{a.rowErrors.get(i)}</span>}
                {a.rowWarnings.get(i)?.map((w) => <span class="warn"> {w}</span>)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog === 'import' && <ImportDialog hw={p.hw} nextNum={parseInt(nextNum(), 10)} existing={a.chans.length} initial={pendingImport}
        close={() => { setDialog('none'); clearImport(); }}
        apply={(rows, mode) => {
          if (mode === 'replace' && p.rows.length && !window.confirm('Replace the current channel list? (Undo is available.)')) return;
          setRows((old) => (mode === 'replace' ? rows : [...old, ...rows]));
          notify(`${mode === 'replace' ? 'Replaced with' : 'Added'} ${rows.length} channels`);
          setDialog('none');
          clearImport();
        }} />}
      {dialog === 'fill' && <FillDialog start={parseInt(nextNum(), 10)} close={() => setDialog('none')} apply={(rows) => {
        setRows((old) => [...old, ...rows]);
        notify(`Added ${rows.length} channels`);
        setDialog('none');
      }} />}
      {dialog === 'offset' && <OffsetDialog close={() => setDialog('none')} apply={(khz) => {
        try {
          const u = Math.round(khz * 10);
          setRows((rows) => rows.map((r, i) => (sel.has(i) && r.rx.trim() ? { ...r, tx: u === 0 ? '' : fmtMHz(toUnits(r.rx) + u) } : r)));
          setDialog('none');
        } catch (e) {
          notify(errMsg(e), true);
        }
      }} />}
    </div>
  );
}

function Modal({ title, close, children }: { title: string; close: () => void; children: preact.ComponentChildren }) {
  return (
    <div class="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <div class="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function FillDialog({ start, close, apply }: { start: number; close: () => void; apply: (rows: Row[]) => void }) {
  const [f, setF] = useState({ num: String(start), rx: '', step: '25', count: '10', offset: '0', power: String(F_HIGH) });
  const upd = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  let rows: Row[] = [], err = '';
  try {
    if (f.rx.trim()) {
      const base = toUnits(f.rx), st = Math.round(parseFloat(f.step) * 10), off = Math.round(parseFloat(f.offset) * 10);
      const n = parseInt(f.count, 10), c0 = parseInt(f.num, 10);
      if (!(n > 0 && n <= 120) || Number.isNaN(st) || Number.isNaN(off) || Number.isNaN(c0)) throw new Error('check the numbers');
      rows = Array.from({ length: n }, (_, k) => ({
        num: String(c0 + k), rx: fmtMHz(base + k * st), tx: off ? fmtMHz(base + k * st + off) : '', flags: +f.power, ctcss: '',
      }));
    }
  } catch (e) { err = errMsg(e); }
  return (
    <Modal title="Fill a range of channels" close={close}>
      <div class="grid2">
        <label class="field"><span class="lab">First channel number</span><input value={f.num} onInput={upd('num')} inputMode="numeric" /></label>
        <label class="field"><span class="lab">Count</span><input value={f.count} onInput={upd('count')} inputMode="numeric" /></label>
        <label class="field"><span class="lab">First Rx MHz</span><input class="mono" autoFocus value={f.rx} onInput={upd('rx')} placeholder="476.4250" inputMode="decimal" /></label>
        <label class="field"><span class="lab">Spacing kHz</span><input value={f.step} onInput={upd('step')} inputMode="decimal" /></label>
        <label class="field"><span class="lab">Tx offset kHz <small>(0 = simplex)</small></span><input value={f.offset} onInput={upd('offset')} /></label>
        <label class="field"><span class="lab">Power</span>
          <select value={f.power} onChange={upd('power')}>{POWER.map(([v, l]) => <option value={v}>{l}</option>)}</select></label>
      </div>
      <p class={err ? 'msg bad' : 'hint'}>{err || (rows.length ? `${rows[0].rx} … ${rows[rows.length - 1].rx}` : ' ')}</p>
      <div class="actions">
        <button onClick={close}>Cancel</button>
        <button class="primary" disabled={!rows.length} onClick={() => apply(rows)}>Add {rows.length || ''} channels</button>
      </div>
    </Modal>
  );
}

function OffsetDialog({ close, apply }: { close: () => void; apply: (khz: number) => void }) {
  const [v, setV] = useState('-600');
  const n = parseFloat(v);
  return (
    <Modal title="Set Tx offset on selected rows" close={close}>
      <label class="field"><span class="lab">Tx = Rx + offset (kHz). 0 makes the channels simplex.</span>
        <input autoFocus value={v} onInput={(e) => setV((e.target as HTMLInputElement).value)} /></label>
      <p class="hint">Common: −600 (2 m), +5000 / −5000 (70 cm), +750 (UHF CB).</p>
      <div class="actions">
        <button onClick={close}>Cancel</button>
        <button class="primary" disabled={Number.isNaN(n)} onClick={() => apply(n)}>Apply</button>
      </div>
    </Modal>
  );
}

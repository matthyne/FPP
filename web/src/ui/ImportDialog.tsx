import { useEffect, useMemo, useState } from 'preact/hooks';
import { CTCSS_HZ_BY_CODE, F_HIGH, F_LOW, F_MED, F_SELPWR } from '../core/fm900';
import { FIELDS, FIELD_LABELS, Field, ImportRow, Mapping, convert, guessMapping, parseTable } from '../core/import';
import { Row } from '../core/project';
import { pickFiles } from './files';

const POWER: [number, string][] = [[F_HIGH, 'H 25 W'], [F_MED, 'M 5 W'], [F_LOW, 'L 1 W'], [F_SELPWR, 'S select']];

export interface ImportSource { name: string; text: string }

export function ImportDialog({ hw, nextNum, existing, initial, close, apply }: {
  hw: string; nextNum: number; existing: number; initial: ImportSource | null;
  close: () => void; apply: (rows: Row[], mode: 'append' | 'replace') => void;
}) {
  const [src, setSrc] = useState<ImportSource | null>(initial);
  const [paste, setPaste] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [start, setStart] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const [useFileNumbers, setUseFileNumbers] = useState(true);
  const [firstNum, setFirstNum] = useState(String(nextNum));
  const [power, setPower] = useState(F_HIGH);
  const [include, setInclude] = useState<boolean[]>([]);

  const table = useMemo(() => (src ? parseTable(src.text) : []), [src]);
  useEffect(() => {
    if (!table.length) { setMapping(null); return; }
    const g = guessMapping(table);
    setMapping(g.mapping);
    setStart(g.start);
    setUseFileNumbers(g.mapping.map.ch !== undefined);
  }, [table]);

  const rows: ImportRow[] = useMemo(() => (mapping
    ? convert(table, start, mapping, { hw, firstNum: parseInt(firstNum, 10) || 1, useFileNumbers, power })
    : []), [table, start, mapping, hw, firstNum, useFileNumbers, power]);
  useEffect(() => setInclude(rows.map((r) => r.include)), [rows]);

  const chosen = rows.filter((r, i) => r.ok && include[i]);
  const nmax = hw[1] === '1' ? 120 : 99;
  const skipped = rows.filter((r) => !r.ok).length;

  const openFile = async () => {
    const [f] = await pickFiles('.csv,.txt,.tsv,text/csv,text/plain', false);
    if (f) setSrc({ name: f.name, text: await f.text() });
  };
  const setField = (f: Field, v: string) => {
    if (!mapping) return;
    const map = { ...mapping.map };
    if (v === '') delete map[f]; else map[f] = +v;
    setMapping({ ...mapping, map });
  };
  const toneLabel = (c: string) => (c ? CTCSS_HZ_BY_CODE.get(c)?.toFixed(1) ?? c : '');

  return (
    <div class="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={async (e) => {
        e.preventDefault(); e.stopPropagation();
        const f = e.dataTransfer?.files?.[0];
        if (f) setSrc({ name: f.name, text: await f.text() });
      }}>
      <div class="modal wide" role="dialog" aria-label="Import channels">
        <h2>Import channels</h2>

        {!src ? (
          <>
            <p class="hint">Import a CSV from <b>CHIRP</b> or <b>RepeaterBook</b> (its CHIRP export), a <b>RadioReference</b> CSV
              download, or any spreadsheet with a header row. You can also paste a table copied from a RadioReference page or a
              spreadsheet. Columns are matched by name and can be changed before importing.</p>
            <div class="actions left">
              <button class="primary" onClick={openFile}>Choose CSV file…</button>
              <span class="hint">or drop it here</span>
            </div>
            <label class="field" style="margin-top:12px">
              <span class="lab">Or paste a table</span>
              <textarea class="mono" rows={8} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
                placeholder={'Frequency\tInput\tTone\tAlpha Tag\tMode\n146.8500\t146.2500\t100.0 PL\tCity Rptr\tFM'} />
            </label>
            <div class="actions">
              <button onClick={close}>Cancel</button>
              <button class="primary" disabled={!paste.trim()} onClick={() => setSrc({ name: 'pasted text', text: paste })}>Next</button>
            </div>
          </>
        ) : (
          <>
            <div class="importhead">
              <span><b>{src.name}</b> · {mapping?.format ?? 'unrecognised'} · {rows.length} rows</span>
              <button class="link" onClick={() => setSrc(null)}>Choose another</button>
              <button class="link" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide' : 'Change'} column mapping</button>
            </div>

            {showMap && mapping && (
              <div class="mapgrid">
                {FIELDS.map((f) => (
                  <label class="field">
                    <span class="lab">{FIELD_LABELS[f]}</span>
                    <select value={mapping.map[f] ?? ''} onChange={(e) => setField(f, (e.target as HTMLSelectElement).value)}>
                      <option value="">—</option>
                      {mapping.header.map((h, i) => <option value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}

            <div class="importopts">
              <label class="check">
                <input type="checkbox" checked={useFileNumbers} disabled={mapping?.map.ch === undefined}
                  onChange={() => setUseFileNumbers(!useFileNumbers)} /> Use channel numbers from the file
              </label>
              {!useFileNumbers && (
                <label class="field inline"><span class="lab">Number from</span>
                  <input value={firstNum} size={4} inputMode="numeric" onInput={(e) => setFirstNum((e.target as HTMLInputElement).value)} /></label>
              )}
              <label class="field inline"><span class="lab">Power</span>
                <select value={power} onChange={(e) => setPower(+(e.target as HTMLSelectElement).value)}>
                  {POWER.map(([v, l]) => <option value={v}>{l}</option>)}
                </select></label>
            </div>

            <div class="gridwrap preview">
              <table class="grid readonly">
                <thead>
                  <tr>
                    <th class="sel"><input type="checkbox" aria-label="Select all importable rows"
                      checked={chosen.length > 0 && chosen.length === rows.filter((r) => r.ok).length}
                      onChange={(e) => { const on = (e.target as HTMLInputElement).checked; setInclude(rows.map((r) => on && r.ok)); }} /></th>
                    <th>Ch</th><th>Name</th><th>Rx MHz</th><th>Tx MHz</th><th>CTCSS</th><th>Mode</th><th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr class={!r.ok ? 'skip' : !include[i] ? 'off' : ''}>
                      <td class="sel"><input type="checkbox" disabled={!r.ok} checked={r.ok && !!include[i]} aria-label={`Import row ${i + 1}`}
                        onChange={() => setInclude(include.map((v, k) => (k === i ? !v : v)))} /></td>
                      <td class="mono">{r.row.num}</td>
                      <td class="name">{r.row.name}</td>
                      <td class="mono">{r.row.rx}</td>
                      <td class="mono">{r.row.tx === 'X' ? 'Rx only' : r.row.tx}</td>
                      <td title={r.tone ? `in file: ${r.tone}` : ''}>{toneLabel(r.row.ctcss)}</td>
                      <td>{r.mode}</td>
                      <td class={!r.ok ? 'bad' : r.reason ? 'warn' : ''}>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p class="hint">
              {chosen.length} of {rows.length} rows selected{skipped ? `, ${skipped} can't be imported` : ''}.
              {' '}The FM900 has no channel names; names are kept in the project and CSV only.
            </p>
            {existing + chosen.length > nmax && <p class="msg warn">Appending would give {existing + chosen.length} channels; this radio holds {nmax}.</p>}
            {chosen.length > nmax && <p class="msg warn">More than {nmax} channels selected.</p>}
            <div class="actions">
              <button onClick={close}>Cancel</button>
              <button disabled={!chosen.length} onClick={() => apply(chosen.map((r) => r.row), 'replace')}>Replace all</button>
              <button class="primary" disabled={!chosen.length} onClick={() => apply(chosen.map((r) => r.row), 'append')}>Append {chosen.length}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

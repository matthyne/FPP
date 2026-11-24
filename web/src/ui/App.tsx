import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { analyze } from '../core/analyze';
import { SheetOpts, SheetSize, cheatSheet, sheetEntries } from '../core/cheatsheet';
import { BLUE_KEYS, headButtons } from '../core/codes';
import { formatChannels } from '../core/channels';
import { FM900Error, readChl, readJob, writeChl, writeJob } from '../core/fm900';
import { Firmware, Project, Row, channelToRow, fromProject, isBlank, loadProjectJson, newProject } from '../core/project';
import { BuildPanel } from './BuildPanel';
import { ChannelsPanel } from './ChannelsPanel';
import { HelpPanel } from './HelpPanel';
import type { ImportSource } from './ImportDialog';
import { RadioPanel } from './RadioPanel';
import { ReadPanel } from './ReadPanel';
import { ScanKeysPanel } from './ScanKeysPanel';
import { dosName, download, loadSaved, pickFiles, readBytes, safeName, save } from './files';
import { Icon } from './icons';
import { THEMES, Theme, applyTheme, loadTheme } from './theme';
import radioPhoto from '../assets/fm900.webp';
import { VERSION_LABEL } from '../version';
import { eprom } from '../core/eprom';

export type Tab = 'radio' | 'channels' | 'scan' | 'build' | 'read' | 'help';
const TABS: [Tab, string][] = [
  ['radio', 'Radio'], ['channels', 'Channels'], ['scan', 'Scan & Keys'],
  ['build', 'Build'], ['read', 'Read image'], ['help', 'Help'],
];

export type Update = (fn: (p: Project) => Project) => void;

export function App() {
  const [project, setProject] = useState<Project>(() => loadSaved() ?? newProject());
  const [tab, setTab] = useState<Tab>(() => (loadSaved()?.rows.length ? 'channels' : 'radio'));
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [readImg, setReadImg] = useState<{ name: string; data: Uint8Array } | null>(null);
  const [drag, setDrag] = useState(false);
  const [pendingImport, setPendingImport] = useState<ImportSource | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const undo = useRef<Project[]>([]);
  const redo = useRef<Project[]>([]);
  const lastPush = useRef(0);

  const update: Update = (fn) => {
    setProject((p) => {
      const n = fn(p);
      const now = Date.now();
      if (now - lastPush.current > 800) {     // coalesce typing into one undo step
        undo.current = [...undo.current.slice(-99), p];
        redo.current = [];
      }
      lastPush.current = now;
      return n;
    });
  };
  const replace = (p: Project) => {
    lastPush.current = 0;
    update(() => p);
  };
  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(project);
    lastPush.current = 0;
    setProject(prev);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(project);
    lastPush.current = 0;
    setProject(next);
  };

  useEffect(() => save(project), [project]);
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.err ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement)?.closest?.('input, textarea, select');
      if (!(e.ctrlKey || e.metaKey) || inField) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const a = useMemo(() => analyze(project), [project]);
  const notify = (msg: string, err = false) => setToast({ msg, err });
  const fail = (e: unknown) => notify(e instanceof Error ? e.message : String(e), true);

  const confirmReplace = () =>
    !project.rows.length || window.confirm('Replace the current channel list? (Undo is available.)');

  async function openFiles(files: File[]) {
    try {
      const by = (ext: string) => files.filter((f) => f.name.toLowerCase().endsWith(ext));
      const [json, job, chl, bin] = [by('.json')[0], by('.job')[0], by('.chl')[0], by('.bin')[0]];
      const text = files.find((f) => /\.(csv|txt|tsv)$/i.test(f.name));
      if (json) {
        if (!confirmReplace()) return;
        replace(loadProjectJson(await json.text()));
        notify(`Opened ${json.name}`);
        setTab('channels');
      } else if (job || chl) {
        if (!confirmReplace()) return;
        let p = { ...project };
        if (job) {
          const j = readJob(await readBytes(job));
          p = { ...p, hw: j.hw, sw: j.sw, comments: j.comments.filter((c) => c), name: safeName(job.name.replace(/\.job$/i, '')), keys: null };
        }
        if (chl) p = { ...p, rows: readChl(await readBytes(chl)).map(channelToRow) };
        replace(p);
        notify(`Opened ${[job?.name, chl?.name].filter(Boolean).join(' + ')}${job && !chl ? ' (codes only: add the .CHL for channels)' : ''}`);
        setTab(chl ? 'channels' : 'radio');
      } else if (text) {
        setPendingImport({ name: text.name, text: await text.text() });
        setTab('channels');
      } else if (bin) {
        setReadImg({ name: bin.name, data: await readBytes(bin) });
        setTab('read');
      } else if (files.length) {
        notify('Unrecognised file type: use .json, .JOB/.CHL, .csv or .BIN', true);
      }
    } catch (e) {
      fail(e);
    }
  }

  const [exportDialog, setExportDialog] = useState(false);
  // .JOB and .CHL are separate buttons: browsers may block a second download started by the same click.
  const exportJob = () => {
    download(`${dosName(project.name)}.JOB`, writeJob(project.hw, project.sw, project.comments));
    notify(`Saved ${dosName(project.name)}.JOB`);
  };
  const exportChl = () => {
    try {
      download(`${dosName(project.name)}.CHL`, writeChl(fromProject(project)));
      notify(`Saved ${dosName(project.name)}.CHL`);
    } catch (e) {
      fail(e);
    }
  };
  const exportCsv = () => {
    try {
      const names = project.rows.filter((r) => !isBlank(r)).map((r) => r.name ?? '');
      download(`${safeName(project.name)}.csv`, formatChannels(fromProject(project), names), 'text/csv');
      notify(`Saved ${safeName(project.name)}.csv`);
    } catch (e) {
      fail(e);
    }
  };
  const [sheetDialog, setSheetDialog] = useState(false);
  // Cheat-sheet tick boxes, remembered in this browser.
  const [sheetOpts, setSheetOptsState] = useState<SheetOpts>(() => {
    const defaults: SheetOpts = { landscape: true, shift: true };       // both ticked unless the user has changed them
    try { return { ...defaults, ...JSON.parse(localStorage.getItem('fm900-web:sheet') ?? '{}') }; } catch { return defaults; }
  });
  const setSheetOpts = (o: SheetOpts) => {
    setSheetOptsState(o);
    try { localStorage.setItem('fm900-web:sheet', JSON.stringify(o)); } catch { /* private mode */ }
  };
  const exportSheet = (size: SheetSize) => {
    const { entries, skipped } = sheetEntries(project);
    if (!entries.length) return notify('No valid channels to put on the cheat sheet', true);
    const fname = `${safeName(project.name)}-CH${size === 'a5' ? '-A5' : ''}.pdf`;
    download(fname, cheatSheet(project, a, size, sheetOpts), 'application/pdf');
    notify(`Saved ${fname}${skipped ? ` (${skipped} row${skipped === 1 ? '' : 's'} with errors left out)` : ''}`);
  };
  const saveJson = () =>
    download(`${safeName(project.name)}.fm900.json`, JSON.stringify(project, null, 1), 'application/json');
  const newProj = () => {
    if (!project.rows.length || window.confirm('Start a new project? (Undo is available.)')) {
      replace({ ...newProject(), hw: project.hw, sw: project.sw });
      setTab('radio');
    }
  };
  const loadRows = (rows: Row[], hw: string, keys: number[] | null, firmware: Firmware, callsign: string) => {
    if (!confirmReplace()) return;
    update((p) => ({ ...p, rows, hw, keys, firmware: firmware === 'standard' ? undefined : firmware,
      callsign: firmware === 'standard' ? p.callsign : callsign || undefined }));
    setTab('channels');
    notify(`Loaded ${rows.length} channels from the image`);
  };

  const status = a.codeError ?? a.buildError;
  const buttons = headButtons(project, a.defaultKeys);
  const nch = a.chans.length;

  return (
    <div
      class={`app${drag ? ' dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => { if (!(e.relatedTarget as Node | null)) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); openFiles([...(e.dataTransfer?.files ?? [])]); }}
    >
      <header class="topbar">
        <div class="brand">
          <img class="logo" src={radioPhoto} alt="" width={110} height={40} />
          <span class="brand-text">WebFPP <small>Philips FM91 / FM92 EPROM builder</small></span>
        </div>
        <div class="file-actions">
          <button class="icon tip" onClick={newProj} data-tip="New project (keeps the current radio codes)" aria-label="New project">
            <Icon name="new" /></button>
          <button class="icon tip" onClick={async () => openFiles(await pickFiles('.json,.job,.chl,.csv,.txt,.bin,.JOB,.CHL,.BIN'))}
            data-tip="Open a project (.json), Original FPP job (.JOB + .CHL), channel list (.csv) or EPROM image (.BIN). You can also drop files on the page."
            aria-label="Open"><Icon name="open" /></button>
          <button class="icon tip" onClick={saveJson} data-tip="Save the whole project as a .json file" aria-label="Save project">
            <Icon name="save" /></button>
          <button class="icon tip" onClick={() => setExportDialog(true)} data-tip="Export: the channel list as CSV, or .JOB + .CHL files for the Original FPP" aria-label="Export"><Icon name="export" /></button>
          <button class="icon tip" onClick={() => setSheetDialog(true)} aria-label="Download channel cheat sheet (PDF)"
            data-tip="Channel cheat sheet (PDF): full A4, or Mini (A5) to stick on the side of the radio. Channel, Rx, Tx and name, with the head buttons and scan groups">
            <Icon name="pdf" /></button>
          <span class="sep" />
          <button class="icon tip" onClick={doUndo} disabled={!undo.current.length} data-tip="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
          <button class="icon tip" onClick={doRedo} disabled={!redo.current.length} data-tip="Redo (Ctrl+Y or Ctrl+Shift+Z)" aria-label="Redo"><Icon name="redo" /></button>
          <span class="sep" />
          <select class="theme" value={theme} aria-label="Colour theme" title="Colour theme"
            onChange={(e) => setTheme((e.target as HTMLSelectElement).value as Theme)}>
            {THEMES.map(([id, label]) => <option value={id}>Theme: {label}</option>)}
          </select>
        </div>
      </header>

      <nav class="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button role="tab" aria-selected={tab === id} class={`${tab === id ? 'active' : ''}${id === 'build' ? ' tab-build' : ''}`} onClick={() => setTab(id)}>
            {label}
            {id === 'channels' && <span class="pill">{nch}</span>}
            {id === 'build' && <span class={`bstate ${a.img ? 'is-ok' : 'is-bad'}`} title={a.img ? 'Ready: the EPROM image builds' : `Not ready: ${status ?? 'nothing to build yet'}`}>
              <Icon name={a.img ? 'ok' : 'notOk'} size={12} />{a.img ? 'READY' : 'NOT READY'}</span>}
          </button>
        ))}
        {buttons && (
          <div class="headkeys" aria-label="FM92 head buttons" title={`FM92 head buttons (${project.keys ? 'your key override' : 'Original FPP defaults'}). Change them on the Scan & Keys tab.`}>
            {buttons.map(([b, f]) => <span class="hk"><span class={`kbtn${BLUE_KEYS.has(b) ? ' blue' : ''}`}>{b}</span>{f}</span>)}
          </div>
        )}
      </nav>

      <main class="main">
        {tab === 'radio' && <RadioPanel p={project} a={a} update={update} />}
        {tab === 'channels' && <ChannelsPanel p={project} a={a} update={update} notify={notify}
          pendingImport={pendingImport} clearImport={() => setPendingImport(null)} />}
        {tab === 'scan' && <ScanKeysPanel p={project} a={a} update={update} />}
        {tab === 'build' && <BuildPanel p={project} a={a} update={update} notify={notify} />}
        {tab === 'read' && <ReadPanel p={project} img={readImg} setImg={setReadImg} load={loadRows} />}
        {tab === 'help' && <HelpPanel />}
      </main>

      <footer class="statusbar">
        <span class="sbi" title="Radio model (from the hardware code)"><Icon name="radio" size={14} />{project.hw[1] === '1' ? 'FM91' : project.hw[1] === '2' ? 'FM92' : 'FM9?'}</span>
        {(() => {
          const exp = (project.firmware ?? 'standard') !== 'standard';
          const fwName = project.firmware === 'enhanced' ? 'Ident + Rx freq.' : 'Start-up ident';
          return (
            <span class={`sbi ${exp ? 'exp' : ''}`} title={exp
              ? `Image: experimental FM92R firmware (${fwName}), built from ${a.builder?.masterName() ?? 'FM92R.BIN'} (Build tab)`
              : `Image: factory firmware, master ${a.builder ? a.builder.masterName() : '— (no valid hardware code)'}`}>
              <Icon name="heartPulse" size={14} />{exp ? 'Experimental' : 'Factory'}
            </span>
          );
        })()}
        <span class="sbi" title="Channels programmed / maximum for this radio"><Icon name="antenna" size={14} />{nch}/{a.nmax} ch</span>
        {a.img && a.builder && <span class="sbi" title="Synthesiser step (channel raster)"><Icon name="step" size={14} />{a.builder.step / 100} kHz</span>}
        <span title={`EPROM: ${eprom(project.eprom).size / 1024} KB (change it on the Build tab)`} class="sbi"><Icon name="chip" size={14} />{eprom(project.eprom).part}</span>
        <span class={`grow ${status ? 'bad' : 'ok'}`}>{status ? `⚠ ${status}` : '✓ ready to build'}</span>
        <span class="ver" title="WebFPP version (quote this when reporting a problem)">WebFPP {VERSION_LABEL}</span>
      </footer>

      {sheetDialog && (
        <div class="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setSheetDialog(false); }}>
          <div class="modal exportdlg" role="dialog" aria-label="Channel cheat sheet">
            <h2>Channel cheat sheet (PDF)</h2>
            <div class="exportopt">
              <div>
                <b>Full A4</b>
                <p class="hint">One A4 page: channel, Rx, Tx and name, with the radio details, head buttons and scan-group key.</p>
              </div>
              <button onClick={() => exportSheet('a4')}>Download A4</button>
            </div>
            <div class="exportopt">
              <div>
                <b>Mini (A5)</b>
                <p class="hint">The same on an A5 page (148 × 210 mm), to print on A5 paper (or cut from A4) and stick on the side of the radio.
                  Smaller header and tighter rows.</p>
              </div>
              <button onClick={() => exportSheet('a5')}>Download Mini (A5)</button>
            </div>
            <div class="sheetopts">
              <label><input type="checkbox" checked={!!sheetOpts.landscape}
                onChange={(e) => setSheetOpts({ ...sheetOpts, landscape: (e.target as HTMLInputElement).checked })} />
                Landscape when it gives bigger text <small>(e.g. about 30–70 channels as two columns)</small></label>
              <label><input type="checkbox" checked={!!sheetOpts.shift}
                onChange={(e) => setSheetOpts({ ...sheetOpts, shift: (e.target as HTMLInputElement).checked })} />
                Show the Tx shift instead of the Tx frequency <small>(+0.6, –5; blank on simplex: more room for names)</small></label>
            </div>
            <p class="hint">Both sizes: the text is made as big as the page allows, and frequencies drop the last 0 when every
              channel is on the 25 kHz raster.</p>
            <div class="actions">
              <button class="primary" onClick={() => setSheetDialog(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {exportDialog && (
        <div class="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setExportDialog(false); }}>
          <div class="modal exportdlg" role="dialog" aria-label="Export">
            <h2>Export</h2>
            <div class="exportopt">
              <div>
                <b>CSV channel list</b>
                <p class="hint">Rx, Tx, power, CTCSS, flags and the channel names, for a spreadsheet or to import again.</p>
              </div>
              <button onClick={exportCsv}>Download {safeName(project.name)}.csv</button>
            </div>
            <div class="exportopt">
              <div>
                <b>Original FPP job (.JOB + .CHL)</b>
                <p class="hint">Both files, with the same name, go in the Original FPP's <code>JOBS</code> folder.
                  {dosName(project.name) !== safeName(project.name) && <> DOS file names are at most 8 characters, so this job is
                    saved as <code>{dosName(project.name)}</code>.</>}</p>
              </div>
              <div class="exportbtns">
                <button onClick={exportJob}>Download {dosName(project.name)}.JOB</button>
                <button onClick={exportChl}>Download {dosName(project.name)}.CHL</button>
              </div>
            </div>
            <div class="actions">
              <button class="primary" onClick={() => setExportDialog(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div class={`toast ${toast.err ? 'err' : ''}`} role="status" onClick={() => setToast(null)}>{toast.msg}</div>}
      {drag && <div class="dropzone">Drop .json, .JOB + .CHL, .csv or .BIN</div>}
    </div>
  );
}

export function errMsg(e: unknown): string {
  return e instanceof FM900Error || e instanceof Error ? e.message : String(e);
}

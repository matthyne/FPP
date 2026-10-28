import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { analyze } from '../core/analyze';
import { formatChannels } from '../core/channels';
import { FM900Error, readChl, readJob, writeChl, writeJob } from '../core/fm900';
import { Project, Row, channelToRow, fromProject, isBlank, loadProjectJson, newProject } from '../core/project';
import { BuildPanel } from './BuildPanel';
import { ChannelsPanel } from './ChannelsPanel';
import { HelpPanel } from './HelpPanel';
import type { ImportSource } from './ImportDialog';
import { RadioPanel } from './RadioPanel';
import { ReadPanel } from './ReadPanel';
import { ScanKeysPanel } from './ScanKeysPanel';
import { download, loadSaved, pickFiles, readBytes, safeName, save } from './files';
import { Theme, applyTheme, loadTheme } from './theme';

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

  const [jobDialog, setJobDialog] = useState(false);
  const exportJob = () => {
    try {
      fromProject(project);
      setJobDialog(true);
    } catch (e) {
      fail(e);
    }
  };
  const exportCsv = () => {
    try {
      const names = project.rows.filter((r) => !isBlank(r)).map((r) => r.name ?? '');
      download(`${safeName(project.name)}.csv`, formatChannels(fromProject(project), names), 'text/csv');
    } catch (e) {
      fail(e);
    }
  };
  const saveJson = () =>
    download(`${safeName(project.name)}.fm900.json`, JSON.stringify(project, null, 1), 'application/json');
  const newProj = () => {
    if (!project.rows.length || window.confirm('Start a new project? (Undo is available.)')) {
      replace({ ...newProject(), hw: project.hw, sw: project.sw });
      setTab('radio');
    }
  };
  const loadRows = (rows: Row[], hw: string, keys: number[] | null) => {
    if (!confirmReplace()) return;
    update((p) => ({ ...p, rows, hw, keys }));
    setTab('channels');
    notify(`Loaded ${rows.length} channels from the image`);
  };

  const status = a.codeError ?? a.buildError;
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
          <span class="logo" aria-hidden="true">FM900</span>
          <span class="brand-text">Web CPS <small>Philips FM91 / FM92 EPROM builder</small></span>
        </div>
        <div class="file-actions">
          <button onClick={newProj}>New</button>
          <button onClick={async () => openFiles(await pickFiles('.json,.job,.chl,.csv,.txt,.bin,.JOB,.CHL,.BIN'))}>Open…</button>
          <button onClick={saveJson} title="Save the whole project as JSON">Save</button>
          <button onClick={exportJob} title="Write .JOB + .CHL for the DOS FM900.EXE">Export JOB/CHL</button>
          <button onClick={exportCsv}>Export CSV</button>
          <span class="sep" />
          <button onClick={doUndo} disabled={!undo.current.length} title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={doRedo} disabled={!redo.current.length} title="Redo (Ctrl+Y)">Redo</button>
          <span class="sep" />
          <select class="theme" value={theme} aria-label="Colour theme" title="Colour theme"
            onChange={(e) => setTheme((e.target as HTMLSelectElement).value as Theme)}>
            <option value="system">Theme: System</option>
            <option value="light">Theme: Light</option>
            <option value="dark">Theme: Dark</option>
          </select>
        </div>
      </header>

      <nav class="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button role="tab" aria-selected={tab === id} class={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'channels' && <span class="pill">{nch}</span>}
            {id === 'build' && <span class={`dot ${a.img ? 'ok' : 'bad'}`} />}
          </button>
        ))}
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
        <span>{project.hw[1] === '1' ? 'FM91' : project.hw[1] === '2' ? 'FM92' : 'FM9?'}</span>
        <span>{a.builder ? a.builder.masterName() : '—'}</span>
        <span>{nch}/{a.nmax} ch</span>
        {a.img && a.builder && <span>step {a.builder.step / 100} kHz</span>}
        {a.img && <span>sum {a.img[0x1F64].toString(16).padStart(2, '0').toUpperCase()}</span>}
        <span class={`grow ${status ? 'bad' : 'ok'}`}>{status ? `⚠ ${status}` : '✓ ready to build'}</span>
      </footer>

      {jobDialog && (
        <div class="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setJobDialog(false); }}>
          <div class="modal" role="dialog" aria-label="Export JOB/CHL">
            <h2>Export for FM900.EXE</h2>
            <p class="hint">FM900.EXE needs both files, with the same name, in its <code>JOBS</code> folder.</p>
            <div class="actions">
              <button onClick={() => download(`${safeName(project.name)}.JOB`, writeJob(project.hw, project.sw, project.comments))}>
                Download {safeName(project.name)}.JOB</button>
              <button onClick={() => download(`${safeName(project.name)}.CHL`, writeChl(fromProject(project)))}>
                Download {safeName(project.name)}.CHL</button>
              <button class="primary" onClick={() => setJobDialog(false)}>Done</button>
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

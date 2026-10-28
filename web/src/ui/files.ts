// Browser file helpers: downloads, reading, and the project autosave.
import { Project, loadProjectJson } from '../core/project';

export function download(name: string, data: Uint8Array | string, type = 'application/octet-stream'): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readBytes(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => resolve([...(inp.files ?? [])]);
    inp.click();
  });
}

const KEY = 'fm900-web:project';

export function loadSaved(): Project | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? loadProjectJson(s) : null;
  } catch {
    return null;
  }
}

export function save(p: Project): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the session still works */
  }
}

export function safeName(s: string): string {
  return (s.trim() || 'NEWJOB').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 8).toUpperCase();
}

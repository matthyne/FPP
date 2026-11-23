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

/** Longest job name. It is only used for file names and the cheat sheet, never in the image or the .JOB/.CHL contents. */
export const JOB_NAME_MAX = 32;

/** The job name as a file name (letters in either case, digits, _ and -; up to JOB_NAME_MAX characters). */
export function safeName(s: string): string {
  return (s.trim() || 'NEWJOB').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, JOB_NAME_MAX);
}

/** DOS 8-character file name for the Original FPP's .JOB/.CHL pair (its JOBS folder needs 8.3 names). */
export function dosName(s: string): string {
  return safeName(s).slice(0, 8).toUpperCase();
}

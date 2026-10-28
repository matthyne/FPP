// Factory master images, embedded at build time from ../../fm900/MASTERS.
import { MASTERS_B64 } from './masters.gen';

const cache = new Map<string, Uint8Array>();

export function master(name: string): Uint8Array | undefined {
  const key = name.toUpperCase();
  if (!cache.has(key)) {
    const b64 = MASTERS_B64[key];
    if (!b64) return undefined;
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    cache.set(key, out);
  }
  return new Uint8Array(cache.get(key)!);
}

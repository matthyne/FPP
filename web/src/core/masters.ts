// Master images, embedded at build time: the factory masters from ../../fm900/MASTERS
// and the enhanced FM92R fork master from ../../firmware/fork (see scripts/gen-masters.mjs).
import { FORKS_B64, MASTERS_B64 } from './masters.gen';

const cache = new Map<string, Uint8Array>();

function decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function master(name: string): Uint8Array | undefined {
  const key = name.toUpperCase();
  if (!cache.has(key)) {
    const b64 = MASTERS_B64[key];
    if (!b64) return undefined;
    cache.set(key, decode(b64));
  }
  return new Uint8Array(cache.get(key)!);
}

const forkCache = new Map<string, Uint8Array | null>();

/** An FM92R fork master ('enhanced' or 'intro'), or null if it wasn't built into this app. */
export function forkMaster(variant: 'enhanced' | 'intro' = 'enhanced'): Uint8Array | null {
  if (!forkCache.has(variant)) forkCache.set(variant, FORKS_B64[variant] ? decode(FORKS_B64[variant]) : null);
  const m = forkCache.get(variant);
  return m ? new Uint8Array(m) : null;
}

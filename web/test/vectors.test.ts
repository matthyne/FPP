// Differential test: random cases built by the reference fm900gen.py (test/gen_vectors.py)
// must give the same image hash, the same error/no-error outcome and the same warnings.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Builder, Channel, F_VOTE, FM900Error } from '../src/core/fm900';
import { master } from '../src/core/masters';
import { parseDate } from '../src/core/project';

interface Case {
  hw: string; sw: string; date: string; keys: number[] | null; chans: Channel[];
  sha256?: string; error?: string; warnings?: string[];
}

function pythonCases(n: number): Case[] | null {
  try {
    const out = execFileSync('python3', [join(__dirname, 'gen_vectors.py'), String(n)],
      { maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out.toString());
  } catch {
    return null;
  }
}

const cases = pythonCases(Number(process.env.FM900_VECTORS ?? 3000));

describe.skipIf(!cases)('differential vs fm900gen.py', () => {
  it('matches every case', () => {
    let built = 0, rings = 0;
    for (const [i, c] of cases!.entries()) {
      let sha: string | undefined, err: string | undefined, warnings: string[] = [];
      try {
        const b = new Builder(c.hw, c.sw, { date: parseDate(c.date), keys: c.keys, masters: master });
        const img = b.build(c.chans.map((x) => ({ ...x })));
        sha = createHash('sha256').update(img).digest('hex');
        warnings = b.vcoWarnings(c.chans);
      } catch (e) {
        if (!(e instanceof FM900Error)) throw e;
        err = e.message;
      }
      const ctx = `case ${i}: hw ${c.hw} sw ${c.sw} (${c.error ?? 'ok'} / ${err ?? 'ok'})`;
      expect(!!err, ctx).toBe(!!c.error);
      if (!c.error) {
        expect(sha, ctx).toBe(c.sha256);
        expect(warnings, ctx).toEqual(c.warnings);
        built++;
        if (c.chans.some((x) => x.flags & F_VOTE)) rings++;
      }
    }
    expect(built).toBeGreaterThan(1000);
    expect(rings).toBeGreaterThan(50);
  });
});

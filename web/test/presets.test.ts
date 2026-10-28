import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readChl } from '../src/core/fm900';
import { PLANS } from '../src/core/presets';
import { analyze } from '../src/core/analyze';
import { newProject } from '../src/core/project';

const plan = (id: string) => PLANS.find((p) => p.id === id)!;

describe('channel plans', () => {
  it('UHF CB 80 matches the 80CHCB sample job channel for channel', () => {
    const p = plan('uhfcb80');
    const rows = p.build({ ...p.defaults, dataChannels: 'include' });
    const chl = readChl(readFileSync(join(__dirname, '..', '..', 'fm900', 'JOBS', '80CHCB.CHL')));
    expect(rows.map((r) => [r.num, r.rx, r.tx || r.rx])).toEqual(chl.map((c) => [String(c.num), c.rx, c.tx]));
  });

  it('UHF CB 80 builds on an FM92 W1 12.5 kHz radio, with data channels receive-only', () => {
    const p = plan('uhfcb80');
    const rows = p.build(p.defaults);
    expect(rows.find((r) => r.num === '22')!.tx).toBe('X');
    expect(rows).toHaveLength(96);
    const a = analyze({ ...newProject(), hw: '92780000', sw: '110000000000000', rows });
    expect(a.buildError).toBeNull();
    expect(a.builder!.step).toBe(1250);
  });

  it('UHF CB 40 builds on a 25 kHz radio and can omit the data channels', () => {
    const p = plan('uhfcb40');
    const rows = p.build({ ...p.defaults, dataChannels: 'omit' });
    expect(rows.map((r) => r.num)).not.toContain('22');
    expect(rows.find((r) => r.num === '41')).toMatchObject({ rx: '476.4250', tx: '477.1750' });
    const a = analyze({ ...newProject(), hw: '92740000', sw: '110000000000000', rows });
    expect(a.buildError).toBeNull();
    expect(a.rowWarnings.size).toBe(0);
  });
});

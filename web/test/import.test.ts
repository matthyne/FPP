import { describe, expect, it } from 'vitest';
import { convert, guessMapping, parseTable, parseTone } from '../src/core/import';
import { F_HIGH, F_LOW, F_SCAN1, F_VOTE } from '../src/core/fm900';

const opts = { hw: '92440150', firstNum: 1, useFileNumbers: true, power: F_HIGH };
const run = (text: string, o = opts) => {
  const t = parseTable(text);
  const { mapping, start } = guessMapping(t);
  return { format: mapping.format, rows: convert(t, start, mapping, o) };
};

describe('CSV import', () => {
  it('reads CHIRP / RepeaterBook exports', () => {
    const { format, rows } = run(
      'Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,Mode,TStep,Skip,Comment\n' +
      '0,VK3RML,146.700000,-,0.600000,Tone,91.5,88.5,023,NN,FM,5.00,,\n' +
      '1,SIMPLEX,146.500000,,0.000000,,88.5,88.5,023,NN,NFM,5.00,,\n' +
      '2,TSQL,147.000000,+,0.600000,TSQL,88.5,123.0,023,NN,FM,5.00,,\n' +
      '3,SPLIT,146.900000,split,147.500000,,88.5,88.5,023,NN,FM,5.00,,\n' +
      '4,RXONLY,147.100000,off,0.000000,,88.5,88.5,023,NN,FM,5.00,,\n' +
      '5,DSTAR,146.400000,,0.000000,,88.5,88.5,023,NN,DV,5.00,,\n' +
      '6,DCS,146.450000,,0.000000,DTCS,88.5,88.5,023,NN,FM,5.00,,\n');
    expect(format).toBe('CHIRP / RepeaterBook');
    const r = rows.map((x) => x.row);
    expect(r[0]).toMatchObject({ num: '1', rx: '146.7000', tx: '146.1000', ctcss: 'W', name: 'VK3RML' });  // Location 0 -> channel 1
    expect(r[1]).toMatchObject({ rx: '146.5000', tx: '', ctcss: '' });
    expect(r[2]).toMatchObject({ tx: '147.6000', ctcss: 'E' });
    expect(r[3]).toMatchObject({ tx: '147.5000' });
    expect(r[4]).toMatchObject({ tx: 'X' });
    expect(rows[5].ok).toBe(false);
    expect(rows[6]).toMatchObject({ ok: true });
    expect(rows[6].reason).toMatch(/tone mode DTCS/);
  });

  it('reads a RadioReference table copied from the web page (tab separated)', () => {
    const { format, rows } = run(
      'Frequency\tInput\tLicense\tType\tTone\tAlpha Tag\tDescription\tMode\tTag\n' +
      '146.85000\t146.25000\tKA1ABC\tRM\t100.0 PL\tCity Rptr\tCity Repeater\tFM\tHam\n' +
      '154.43000\t\tKB2XYZ\tBM\tCSQ\tFire Disp\tFire Dispatch\tFMN\tFire Dispatch\n' +
      '155.47500\t\t\tBM\t293 NAC\tPD\tPolice\tP25\tLaw Dispatch\n' +
      '151.00000\t\t\tBM\t023 DPL\tDPL ch\tDPL\tFMN\tBusiness\n',
      { ...opts, hw: '92340000', useFileNumbers: false, firstNum: 10 });
    expect(format).toBe('RadioReference');
    expect(rows[0].row).toMatchObject({ num: '10', rx: '146.8500', tx: '146.2500', ctcss: 'B', name: 'City Rptr' });
    expect(rows[1].row).toMatchObject({ num: '11', ctcss: '', tx: '' });
    expect(rows[1].include).toBe(true);
    expect(rows[2].ok).toBe(false);               // P25
    expect(rows[3].row.ctcss).toBe('');
    expect(rows[3].reason).toMatch(/DCS/);
  });

  it('reads the README format with all flag columns', () => {
    const { format, rows } = run('ch,rx,tx,power,scan,ctcss,vote,econ,selcall,cr,name\n3,146.4,147.0,L,1,173.8,Y,,,,"Rptr, north"\n');
    expect(format).toBe('FM900 (README format)');
    expect(rows[0].row).toMatchObject({ num: '3', rx: '146.4000', tx: '147.0000', ctcss: '1', name: 'Rptr, north' });
    expect(rows[0].row.flags).toBe(F_LOW | F_SCAN1 | F_VOTE);
  });

  it('reads a headerless list and a generic spreadsheet', () => {
    expect(run('147.0\n146.4 147.0 M\n').rows.map((r) => [r.row.num, r.row.rx, r.row.tx])).toEqual([['1', '147.0000', ''], ['2', '146.4000', '147.0000']]);
    const g = run('Name;Output Freq;Offset;Uplink Tone\nA;438,1250;-7.6;91.5\nB;439.9875;0;\n', { ...opts, hw: '92540000' });
    expect(g.rows[0].row).toMatchObject({ rx: '438.1250', tx: '430.5250', ctcss: 'W', name: 'A' });
    expect(g.rows[1].row).toMatchObject({ rx: '439.9875', tx: '' });
  });

  it('accepts channels outside the nominal band (re-tuned radios)', () => {
    const r = run('Frequency\n146.5000\n', { ...opts, hw: '92340000' }).rows[0];
    expect(r).toMatchObject({ ok: true, include: true, reason: '' });
  });

  it('flags frequencies that need more than 4 decimals', () => {
    const r = run('Frequency\n146.80625\n').rows[0];
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/4 decimals/);
  });

  it('parses tone cells', () => {
    expect(parseTone('91.5')).toBe('W');
    expect(parseTone('PL 123.0')).toBe('E');
    expect(parseTone('CSQ')).toBe('');
    expect(() => parseTone('D023N')).toThrow(/DCS/);
    expect(() => parseTone('69.3')).toThrow(/table/);
  });
});

import { describe, expect, it } from 'vitest';
import { hasCallsign, qrzUrl, splitCallsigns } from '../src/core/callsign';
import { cheatSheet, fitName } from '../src/core/cheatsheet';
import { newProject } from '../src/core/project';

const calls = (s: string) => splitCallsigns(s).filter((g) => g.call).map((g) => g.text);

describe('callsigns in names', () => {
  it('finds callsigns', () => {
    expect(calls('VK2RXX Sydney')).toEqual(['VK2RXX']);
    expect(calls('vk2rxx / VK3BYY')).toEqual(['vk2rxx', 'VK3BYY']);
    expect(calls('G4ABC, 9V1AB and ZL1ABC/P')).toEqual(['G4ABC', '9V1AB', 'ZL1ABC/P']);
    expect(calls('Repeater (VK2RCG) input')).toEqual(['VK2RCG']);
  });

  it('ignores ordinary names', () => {
    for (const s of ['Simplex Channel 1', 'Repeater Output 01', 'National FM Voice Calling', 'UHF CB 40', 'CH5', 'R1',
      '146.500', 'Mt Ku-ring-gai', 'VK2', 'APRS 145.175', '2m', 'VK2RXX2', 'X VK2RXXXXX']) {
      expect(hasCallsign(s), s).toBe(false);
    }
  });

  it('QRZ links', () => {
    expect(qrzUrl('VK2RXX')).toBe('https://www.qrz.com/db/VK2RXX');
    expect(qrzUrl('vk3byy/m')).toBe('https://www.qrz.com/db/VK3BYY');
  });

  it('split is lossless', () => {
    const s = 'Link VK2RXX-VK2RYY (VK3BYY/M) end';
    expect(splitCallsigns(s).map((g) => g.text).join('')).toBe(s);
  });

  it('cheat sheet: regular name, bold callsign, truncation keeps runs', () => {
    const p = { ...newProject(), rows: [{ num: '1', rx: '146.5', tx: '', flags: 0, ctcss: '', name: 'VK2RXX Sydney' }] };
    const s = String.fromCharCode(...cheatSheet(p));
    expect(s).toMatch(/\/F2 [\d.]+ Tf [\d. ]+Td \(VK2RXX\) Tj/);     // F2 = Helvetica-Bold
    expect(s).toMatch(/\/F1 [\d.]+ Tf [\d. ]+Td \( Sydney\) Tj/);    // F1 = Helvetica
    const cut = fitName('VK2RXX Sydney Harbour Bridge repeater', 10, 60);
    expect(cut[0]).toEqual({ text: 'VK2RXX', call: true });
    expect(cut[cut.length - 1]).toEqual({ text: '…', call: false });
  });
});

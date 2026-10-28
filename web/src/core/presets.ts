// Built-in channel plans.  Only plans that are fixed by regulation are built in;
// amateur repeater lists vary by region, so they come in through the CSV importer.
import { F_HIGH } from './fm900';
import { Row } from './project';

export type DataChannels = 'rxonly' | 'include' | 'omit';

export interface PlanOptions {
  duplex: boolean;          // add the repeater (duplex) channels
  duplexStart: number;      // channel number of the first duplex channel
  dataChannels: DataChannels;
  power: number;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  needs: string;                                 // radio requirement, shown in the dialog
  spacingKHz: number;                            // channel raster the radio must support
  defaults: PlanOptions;
  build: (o: PlanOptions) => Row[];
}

const fmt = (u: number) => `${Math.floor(u / 10000)}.${String(u % 10000).padStart(4, '0')}`;   // 100 Hz units

// Australian UHF CB (ACMA): ch 1-40 from 476.425 MHz at 25 kHz; ch 41-80 interleaved 12.5 kHz above.
// Repeaters: outputs ch 1-8 / 41-48, inputs ch 31-38 / 71-78 (+750 kHz).
// Ch 22 and 23 are for telemetry/telecommand only (no voice); ch 61-63 are reserved.
export function uhfCbFreq(ch: number): number {
  return ch <= 40 ? 4764250 + (ch - 1) * 250 : 4764375 + (ch - 41) * 250;
}

const NO_VOICE = [22, 23, 61, 62, 63];

function uhfCb(channels: number, o: PlanOptions): Row[] {
  const rows: Row[] = [];
  for (let ch = 1; ch <= channels; ch++) {
    const special = NO_VOICE.includes(ch);
    if (special && o.dataChannels === 'omit') continue;
    const name = ch === 5 || ch === 35 ? 'Emergency' : ch === 11 ? 'Calling' : ch === 40 ? 'Road (highway)'
      : ch === 22 || ch === 23 ? 'Data only' : special ? 'Reserved' : '';
    rows.push({ num: String(ch), rx: fmt(uhfCbFreq(ch)), tx: special && o.dataChannels === 'rxonly' ? 'X' : '',
      flags: o.power, ctcss: '', name: name ? `CB ${ch} ${name}` : `CB ${ch}` });
  }
  if (o.duplex) {
    const outputs = channels === 80 ? [1, 2, 3, 4, 5, 6, 7, 8, 41, 42, 43, 44, 45, 46, 47, 48] : [1, 2, 3, 4, 5, 6, 7, 8];
    for (const ch of outputs) {
      // as in the 80CHCB sample job: duplex 1-8 at duplexStart.., 41-48 ten channels further on
      const num = o.duplexStart + (ch <= 8 ? ch - 1 : 10 + (ch - 41));
      rows.push({ num: String(num), rx: fmt(uhfCbFreq(ch)), tx: fmt(uhfCbFreq(ch) + 7500), flags: o.power, ctcss: '',
        name: `CB ${ch} Duplex${ch === 5 || ch === 45 ? ' (emergency)' : ''}` });
    }
  }
  return rows;
}

export const PLANS: Plan[] = [
  {
    id: 'uhfcb80', name: 'UHF CB, 80 channel (Australia)',
    description: 'Channels 1–80 (476.425–477.4125 MHz), plus the 16 repeater duplex channels (Rx 1–8 / 41–48, Tx +750 kHz), laid out as in the 80CHCB sample job.',
    needs: 'W1 band (470–500 MHz), 12.5 kHz spacing (hardware digit 4 = 7 or 8)', spacingKHz: 12.5,
    defaults: { duplex: true, duplexStart: 81, dataChannels: 'rxonly', power: F_HIGH },
    build: (o) => uhfCb(80, o),
  },
  {
    id: 'uhfcb40', name: 'UHF CB, 40 channel (Australia, legacy)',
    description: 'The original 25 kHz plan: channels 1–40 (476.425–477.400 MHz), plus the 8 repeater duplex channels (Rx 1–8, Tx 31–38).',
    needs: 'W1 band (470–500 MHz), 12.5 or 25 kHz spacing', spacingKHz: 25,
    defaults: { duplex: true, duplexStart: 41, dataChannels: 'rxonly', power: F_HIGH },
    build: (o) => uhfCb(40, o),
  },
];

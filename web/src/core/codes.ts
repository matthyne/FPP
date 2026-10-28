// Hardware / software code digit tables (FM900_FORMAT.md §3), for the code editor UI.

export interface Digit {
  label: string;
  options: [string, string][];   // [digit, meaning]
  unsupported?: string;          // digits this tool can't build
}

export const BAND_MHZ: Record<string, [number, number]> = {
  '2': [66, 88], '3': [132, 153], '4': [148, 174], '5': [403, 440],
  '6': [440, 470], '7': [470, 500], '8': [500, 520],
};

export const HW_DIGITS: Digit[] = [
  { label: 'Type', options: [['9', 'Mobile']] },
  { label: 'Model', options: [['1', 'FM91 (120 ch)'], ['2', 'FM92 (99 ch)'], ['3', 'FM93'], ['7', '92 with 91 PCBs']],
    unsupported: '37' },
  { label: 'Band', options: [['2', 'E 66–88 MHz'], ['3', 'B 132–153 MHz'], ['4', 'A 148–174 MHz'],
    ['5', 'T 403–440 MHz'], ['6', 'U 440–470 MHz'], ['7', 'W1 470–500 MHz'], ['8', 'W2 500–520 MHz']] },
  { label: 'Control / spacing', options: [['3', 'Local, 25 kHz'], ['4', 'Remote, 25 kHz'],
    ['7', 'Local, 12.5 kHz'], ['8', 'Remote, 12.5 kHz']] },
  { label: 'Mechanics', options: [['0', 'Standard'], ['1', 'Ext. temp 5 ppm'], ['2', 'Waterproof'],
    ['3', 'WP + ext. temp'], ['5', 'TCXO'], ['7', 'WP TCXO']], unsupported: '237' },
  { label: 'Signalling hardware', options: [['0', 'None'], ['1', 'CTCSS encode'], ['2', 'CTCSS enc/dec'],
    ['3', 'Selcall type 1 (+CTCSS) [3]'], ['4', 'Selcall type 1 (+CTCSS) [4]'], ['5', 'Selcall type 1 (+CTCSS) [5]'],
    ['6', 'Selcall type 2 [6]'], ['7', 'Selcall type 2 [7]'], ['8', 'Selcall type 2 [8]']] },
  { label: 'Selcall', options: [['0', 'None'], ['1', 'CCIR'], ['2', 'ZVEI'], ['3', 'EEA'], ['4', 'EIA'],
    ['5', 'None + I/O kit'], ['6', 'CCIR, encode type 2'], ['7', 'ZVEI, encode type 2'],
    ['8', 'EEA, encode type 2'], ['9', 'EIA, encode type 2']] },
  { label: 'Option', options: [['0', 'Standard'], ['1', 'Reverse tone burst'], ['3', 'Dual front end'],
    ['4', 'Ignition noise blanker']] },
];

export const SW_DIGITS: Digit[] = [
  { label: 'Display', options: [['0', 'Intermittent'], ['1', 'Continuous'], ['2', 'Intermittent + 8 h timer'],
    ['3', 'Continuous + 8 h timer']] },
  { label: 'Mute', options: [['0', 'Fixed, with defeat'], ['1', 'Variable, with defeat'], ['2', 'Fixed, no defeat'],
    ['3', 'Variable, no defeat']] },
  { label: 'Economiser', options: [['0', 'None'], ['1', 'All channels'], ['2', 'Operator selectable'],
    ['3', 'Per channel']] },
  { label: 'Tx timer', options: [['0', 'None'], ['1', '1 min'], ['2', '3 min'], ['3', '5 min'], ['4', '10 min']] },
  { label: 'Tx inhibit', options: [['0', 'None'], ['1', 'On all channels']] },
  { label: 'Tx power', options: [['0', '25 W'], ['1', '5 W'], ['2', '1 W'], ['3', 'Operator selectable'],
    ['4', 'Per channel'], ['6', '5–25 W'], ['7', '1–25 W adjustable']] },
  { label: 'Scanning', options: [['0', 'None'], ['1', 'Vacant'], ['2', 'Occupied'],
    ['3', 'Occupied + operator selectable']] },
  { label: 'Voting', options: [['0', 'Off'], ['1', 'On']] },
  { label: 'CTCSS', options: [['0', 'None'], ['1', 'Per channel'], ['2', 'Via keypad'], ['3', 'Per channel + RTB'],
    ['4', 'Keypad + RTB'], ['5', 'Community repeater per channel'], ['6', 'Keypad + CR'],
    ['7', 'CR per channel + RTB']] },
  { label: 'Tone period', options: [['0', 'None'], ['1', '100 ms'], ['2', '40 ms'], ['3', '70 ms'],
    ['4', '20 ms'], ['5', '33 ms']] },
  { label: 'Simplex / options', options: [['0', 'Simplex'], ['1', 'Option 1'], ['2', 'Option 2']] },
];
// SW digits 11-12 and 13-14 are the 2-digit selcall encode / decode format codes.

export interface Example { name: string; hw: string; sw: string }
export const EXAMPLES: Example[] = [
  { name: '2 m ham, FM92R A-band', hw: '92440150', sw: '110100201000000' },
  { name: 'VHF B-band, FM92R', hw: '92340000', sw: '110300200000000' },
  { name: 'UHF CB, FM92R W1-band', hw: '92740000', sw: '110401200000000' },
  { name: 'UHF CB, FM91, 12.5 kHz', hw: '91785000', sw: '110000000000000' },
];

export function describeHw(hw: string): string[] {
  return HW_DIGITS.map((d, i) => `${d.label}: ${d.options.find(([k]) => k === hw[i])?.[1] ?? `? (${hw[i] ?? ''})`}`);
}

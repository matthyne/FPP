// The editable project: what the UI holds, saves as JSON and keeps in localStorage.
// Rows are an ordered list of records, not a slot array: duplicate channel numbers and
// VOTE rings need several records per number, and record order decides ring slot
// allocation and scan-list order (FUNC 0x52FD / 0x77F7).
import { Channel, FM900Error, normFreq } from './fm900';

export interface Row {
  num: string;     // channel number as typed
  rx: string;      // MHz as typed
  tx: string;      // MHz, 'X' = receive only, '' = same as rx
  flags: number;   // .CHL flag word (F_*)
  ctcss: string;   // CTCSS letter code, '' = none
}

export interface Project {
  format: 'fm900-web';
  version: 1;
  name: string;
  hw: string;
  sw: string;
  comments: string[];
  keys: number[] | null;   // FM92 head keys 1/2/4/7 override, null = as FM900.EXE
  date: string;            // YYYY-MM-DD, '' = today
  rows: Row[];
}

export function newProject(): Project {
  return { format: 'fm900-web', version: 1, name: 'NEWJOB', hw: '92440150', sw: '110100201000000',
    comments: [], keys: null, date: '', rows: [] };
}

export function channelToRow(c: Channel): Row {
  return { num: String(c.num), rx: c.rx, tx: c.tx.startsWith('X') ? 'X' : c.tx, flags: c.flags, ctcss: c.ctcss };
}

export function toProject(hw: string, sw: string, chans: Channel[], name = 'NEWJOB', comments: string[] = []): Project {
  return { ...newProject(), name, hw, sw, comments, rows: chans.map(channelToRow) };
}

export function isBlank(r: Row): boolean {
  return !r.num.trim() && !r.rx.trim() && !r.tx.trim();
}

/** Convert one row; throws FM900Error with a user-facing message. */
export function rowToChannel(r: Row): Channel {
  const num = Number(r.num.trim());
  if (!r.num.trim() || !Number.isInteger(num)) throw new FM900Error(`bad channel number ${JSON.stringify(r.num)}`);
  if (!r.rx.trim()) throw new FM900Error('Rx frequency missing');
  if (r.rx.trim().toUpperCase().startsWith('X')) throw new FM900Error('Rx cannot be X');
  const rx = normFreq(r.rx);
  const tx = r.tx.trim() ? normFreq(r.tx) : rx;
  return { num, rx, tx, flags: r.flags, ctcss: r.ctcss };
}

export interface RowsResult { chans: Channel[]; errors: Map<number, string> }

export function rowsToChannels(rows: Row[]): RowsResult {
  const chans: Channel[] = [];
  const errors = new Map<number, string>();
  rows.forEach((r, i) => {
    if (isBlank(r)) return;
    try {
      chans.push(rowToChannel(r));
    } catch (e) {
      if (!(e instanceof FM900Error)) throw e;
      errors.set(i, e.message);
    }
  });
  return { chans, errors };
}

export function fromProject(p: Project): Channel[] {
  const { chans, errors } = rowsToChannels(p.rows);
  if (errors.size) {
    const [i, msg] = [...errors][0];
    throw new FM900Error(`row ${i + 1}: ${msg}`);
  }
  return chans;
}

export function parseDate(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

export function loadProjectJson(text: string): Project {
  const p = JSON.parse(text);
  if (p?.format !== 'fm900-web' || !Array.isArray(p.rows)) throw new FM900Error('not an FM900 web project file');
  return { ...newProject(), ...p };
}

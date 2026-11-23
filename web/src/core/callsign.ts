// Amateur callsigns inside free text (channel names), for highlighting in the grid and
// bolding on the cheat sheet. Display only: names never reach the radio.

// ITU-style: a prefix (1–2 letters, letter+digit or digit+letter), one digit, a 1–4 letter
// suffix, optionally /P, /M, /QRP etc. E.g. VK2RXX, VK3BYY, G4ABC, 9V1AB, ZL1ABC/P.
// Case-insensitive, whole words only.
const CALL = /(?<![A-Z0-9/])(?:[A-Z]{1,2}|[A-Z][0-9]|[0-9][A-Z])[0-9][A-Z]{1,4}(?:\/[A-Z0-9]{1,4})?(?![A-Z0-9/])/gi;

export interface Segment { text: string; call: boolean }

/** Split `s` into runs of plain text and callsigns (concatenating the texts gives `s` back). */
export function splitCallsigns(s: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of s.matchAll(CALL)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index), call: false });
    out.push({ text: m[0], call: true });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), call: false });
  return out;
}

export const hasCallsign = (s: string): boolean => splitCallsigns(s).some((g) => g.call);

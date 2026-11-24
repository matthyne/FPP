import { describe, expect, it } from 'vitest';
import { HeadConfig, HeadSim, T_CHAN, T_LAMP, T_STEP } from '../src/core/headsim';

const cfg = (over: Partial<HeadConfig> = {}): HeadConfig => ({
  channels: [1, 2, 3, 9, 10, 23, 25, 30, 41],
  scanLists: [[2, 3], []],
  keys: ['up', 'down', 'scan', 'monitor'],
  firmware: 'standard',
  identMs: 1000,
  ...over,
});

function started(c: HeadConfig): HeadSim {
  const h = new HeadSim(c);
  h.power();
  h.tick(T_LAMP);
  if (c.firmware !== 'standard') h.tick(c.identMs);
  h.events = [];
  return h;
}

describe('FM92 head demo', () => {
  it('switch-on: 88, then the lowest channel with the tens digit blanked', () => {
    const h = new HeadSim(cfg());
    h.power();
    expect(h.display).toBe('88');
    h.tick(T_LAMP);
    expect(h.display).toBe(' 1');
  });

  it('experimental images show 00 during the ident first', () => {
    const h = new HeadSim(cfg({ firmware: 'intro', identMs: 4500 }));
    h.power();
    h.tick(T_LAMP);
    expect(h.display).toBe('00');
    expect(h.events).toContain('ident');
    h.press(0);                                        // keys are ignored during the ident
    h.tick(4499);
    expect(h.display).toBe('00');
    h.tick(1);
    expect(h.display).toBe(' 1');
  });

  it('up/down skip empty numbers and wrap; tens and units like the firmware', () => {
    const h = started(cfg({ keys: ['up', 'down', 'tens', 'units'] }));
    h.press(1);
    expect(h.ch).toBe(41);                             // 1 down wraps to the highest
    h.press(0);
    expect(h.ch).toBe(1);
    h.press(0); h.press(0); h.press(0);
    expect(h.ch).toBe(9);                              // 3 -> 9: 4-8 have no channel
    h.press(0);
    expect(h.display).toBe('10');
    h.ch = 23;
    h.press(2);
    expect(h.ch).toBe(30);                             // tens: next block of ten
    h.ch = 25;
    h.press(3);
    expect(h.ch).toBe(23);                             // units: 26-29 empty, wraps within 20s to 20.. -> 23
    h.ch = 41;
    h.press(2);
    expect(h.ch).toBe(1);                              // tens past the highest: lowest
  });

  it('scan key cycles list 1, list 2 (empty here: off); channel keys rejected while scanning', () => {
    const h = started(cfg());
    h.press(2);
    expect(h.scan).toBe(1);
    expect(h.display).toBe('1 ');
    h.press(0);
    expect(h.events).toContain('reject');
    expect(h.ch).toBe(1);
    h.press(2);
    expect(h.scan).toBe(0);                            // list 2 has no members
    expect(h.display).toBe(' 1');
  });

  it('monitor toggles; PTT keeps the channel shown; channel keys rejected while transmitting', () => {
    const h = started(cfg());
    h.press(3);
    expect(h.monitor).toBe(true);
    h.ptt(true);
    h.press(0);
    expect(h.events).toContain('reject');
    h.ptt(false);
    expect(h.tx).toBe(false);
  });

  it('enhanced image: channel 2 s, blank, frequency windows 0.5 s each, blank, channel again', () => {
    const h = started(cfg({ firmware: 'enhanced', freqWindows: (ch) => (ch === 1 ? ['14', '47', '7 ', ' 4', '45', '50'] : null) }));
    const seen = [h.display];
    for (let t = 0; t < T_CHAN + 9 * T_STEP; t += 50) {
      h.tick(50);
      if (h.display !== seen[seen.length - 1]) seen.push(h.display);
    }
    expect(seen).toEqual([' 1', '  ', '14', '47', '7 ', ' 4', '45', '50', '  ', ' 1']);
    // transmitting puts the channel back at once
    h.tick(T_CHAN + T_STEP);
    expect(h.display).toBe('  ');
    h.ptt(true);
    expect(h.display).toBe(' 1');
  });

  it('no cycle on the factory image or for a channel without a table entry', () => {
    const h = started(cfg({ freqWindows: () => ['14'] }));
    h.tick(10000);
    expect(h.display).toBe(' 1');
    const e = started(cfg({ firmware: 'enhanced', freqWindows: () => null }));
    e.tick(10000);
    expect(e.display).toBe(' 1');
  });

  it('power off blanks the display; no channels = will not switch on', () => {
    const h = started(cfg());
    h.power();
    expect(h.display).toBe('  ');
    const empty = new HeadSim(cfg({ channels: [] }));
    empty.power();
    expect(empty.on).toBe(false);
  });
});

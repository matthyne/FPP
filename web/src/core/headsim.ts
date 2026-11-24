// FM92 control-head demo: a behavioural model of what the head shows and how the keys act, for WebFPP's Demo tab.
// DOM-free (tested in Node). It is NOT the 6805 firmware running: it follows the firmware's documented behaviour
// (FIRMWARE.md and firmware/fork/FM92R.asm) closely enough to try a channel plan and key set-up before burning:
//
//  * Channel keys (fn_channel_up/down/tens/units, 0x072D-0x07CF): up/down step one number, skipping numbers with
//    no channel, wrapping highest <-> lowest; tens = next block of ten (23 -> 30); units = units digit +1 within its
//    block (29 -> 20). All refused (reject beep) while transmitting or scanning.
//  * Scan key (fn_scan, 0x100C): each press selects the next scan list (1, 2), then off; a list with no members
//    stops scanning. While scanning the head shows the list number on the left (display_digits with $4F | 0x0F).
//    The demo has no received signals, so a scan never stops on a channel.
//  * Monitor key: toggles the monitor (squelch defeat, $19.2).
//  * Display: two digits, tens blanked when 0 (show_channel). Power on: the head's own "88" until the radio
//    sends digits, then (experimental images) "00" during the Morse ident, then the channel.
//  * Experimental "Ident + Rx freq." image: after 2 s on the channel number, 0.5 s blank, the Rx frequency in
//    2-character windows (0.5 s each), 0.5 s blank, the channel again (fork.asm FREQ). Not while transmitting or
//    scanning; any channel change restarts it.

export type HeadFirmware = 'standard' | 'intro' | 'enhanced';
export type KeyFunc = 'none' | 'up' | 'down' | 'tens' | 'units' | 'scan' | 'monitor' | 'selcall' | 'dial';

export interface HeadConfig {
  channels: number[];                       // channel numbers with a channel (any order, duplicates allowed)
  scanLists: [number[], number[]];          // members of scan list 1 and 2
  keys: KeyFunc[];                          // UP, DOWN, AUX, SEND
  firmware: HeadFirmware;
  identMs: number;                          // experimental images: how long "00" + Morse ident takes
  freqWindows?: (ch: number) => string[] | null;   // enhanced: the frequency windows for a channel, null = none
}

export type HeadEvent = 'beep' | 'reject' | 'ident';

export const T_CHAN = 2000, T_STEP = 500, T_LAMP = 300;

export class HeadSim {
  on = false;
  ch = 0;
  tx = false;
  monitor = false;
  scan = 0;                                 // 0 = off, 1 or 2 = scanning that list
  display = '  ';
  events: HeadEvent[] = [];                 // drained by the UI (sounds)
  private chans: number[];
  private t = 0;                            // ms into the current phase
  private phase: 'off' | 'lamp' | 'ident' | 'chan' | 'freq' = 'off';
  private seq: string[] = [];               // freq cycle: blank, windows..., blank
  private idx = 0;

  constructor(readonly cfg: HeadConfig) {
    this.chans = [...new Set(cfg.channels)].sort((a, b) => a - b);
    this.ch = this.chans[0] ?? 0;
  }

  get lowest(): number { return this.chans[0] ?? 0; }
  get highest(): number { return this.chans[this.chans.length - 1] ?? 0; }

  /** The power key: on (lamp test "88", ident on experimental images, then the channel) or off. */
  power(): void {
    if (this.on) {
      this.on = false; this.tx = false; this.scan = 0; this.monitor = false;
      this.phase = 'off'; this.display = '  ';
      return;
    }
    if (!this.chans.length) return;
    this.on = true;
    this.phase = 'lamp'; this.t = 0; this.display = '88';
  }

  /** A head key (0 = UP, 1 = DOWN, 2 = AUX, 3 = SEND), doing whatever function it is programmed to. */
  press(key: number): void {
    if (!this.on || this.phase === 'lamp' || this.phase === 'ident') return;   // ignored during start-up
    const f = this.cfg.keys[key] ?? 'none';
    if (f === 'up' || f === 'down' || f === 'tens' || f === 'units') {
      if (this.tx || this.scan) return this.reject();
      this.ch = this.step(f);
      this.beep();
      this.showChannel();
    } else if (f === 'scan') {
      if (this.tx) return this.reject();
      this.beep();
      const next = this.scan + 1;
      this.scan = next <= 2 && this.cfg.scanLists[next - 1].length ? next : 0;
      this.showChannel();
    } else if (f === 'monitor') {
      this.monitor = !this.monitor;
      this.beep();
    } else {
      this.reject();                                                 // none, selcall, dial: not simulated
    }
  }

  /** Mic PTT: the channel number stays on the display while transmitting (the frequency cycle pauses). */
  ptt(down: boolean): void {
    if (!this.on || this.phase === 'lamp' || this.phase === 'ident' || down === this.tx) return;
    this.tx = down;
    this.showChannel();
  }

  /** Advance the clock by `ms`. */
  tick(ms: number): void {
    if (!this.on) return;
    this.t += ms;
    if (this.phase === 'lamp' && this.t >= T_LAMP) {
      if (this.cfg.firmware !== 'standard') {
        this.phase = 'ident'; this.t = 0; this.display = '00';
        this.events.push('ident');
      } else this.showChannel();
    } else if (this.phase === 'ident' && this.t >= this.cfg.identMs) {
      this.showChannel();
    } else if (this.phase === 'chan' && this.cycling() && this.t >= T_CHAN) {
      const w = this.cfg.freqWindows?.(this.ch);
      if (w && w.length) {
        this.seq = ['  ', ...w, '  ']; this.idx = 0;
        this.phase = 'freq'; this.t = 0; this.display = this.seq[0];
      } else this.t = 0;
    } else if (this.phase === 'freq') {
      if (!this.cycling()) return this.showChannel();
      while (this.t >= T_STEP && this.phase === 'freq') {
        this.t -= T_STEP;
        if (++this.idx >= this.seq.length) this.showChannel();
        else this.display = this.seq[this.idx];
      }
    }
  }

  private cycling(): boolean {
    return this.cfg.firmware === 'enhanced' && !this.tx && !this.scan;
  }

  private showChannel(): void {
    this.phase = 'chan'; this.t = 0;
    // Scanning: the scan list number on the left, right digit blank. Otherwise the channel, tens blanked when 0.
    this.display = this.scan ? `${this.scan} ` : `${Math.floor(this.ch / 10) || ' '}${this.ch % 10}`;
  }

  private step(f: KeyFunc): number {
    const has = (n: number) => this.chans.includes(n);
    const lo = this.lowest, hi = this.highest;
    let n = this.ch;
    if (f === 'up' || f === 'down') {
      for (let i = 0; i < 100; i++) {
        n = f === 'up' ? (n + 1 > hi ? lo : n + 1) : (n - 1 < lo ? hi : n - 1);
        if (has(n)) return n;
      }
      return this.ch;
    }
    if (f === 'tens') {
      n = n - (n % 10) + 10;
      if (n > hi) n = lo;
      while (!has(n)) n = n + 1 > hi ? lo : n + 1;                  // an empty slot: carry on upwards
      return n;
    }
    // units: the units digit +1 within the block of ten, skipping numbers with no channel or outside lo..hi
    const base = n - (n % 10);
    for (let i = 1; i <= 10; i++) {
      const m = base + ((n % 10) + i) % 10;
      if (m >= lo && m <= hi && has(m)) return m;
    }
    return this.ch;
  }

  private beep(): void { this.events.push('beep'); }
  private reject(): void { this.events.push('reject'); }
}

/** Seven-segment patterns (segments a-g) for what the head can show: digits and space. */
export const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc',
  '8': 'abcdefg', '9': 'abcdfg', ' ': '',
};

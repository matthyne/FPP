# FM92R extended firmware

An editable, re-assemblable source of the FM92R master firmware
(`fm900/MASTERS/FM92R.BIN`), with new features added. It is built into
modified masters, and `mkradio.py` or WebFPP turn those into radio EPROM
images.

**Experimental.** An image has been burned and worked on an FM92R
(reported 2026-11-23), but this is still not guaranteed to work on every
radio. Keep the factory EPROM. WebFPP shows an "Experimental firmware" note
for these images.

FM92R only (remote head, no selcall). Background: `../FIRMWARE.md`
(§6.1 start-up and what the head is sent, §6.2 head messages, §13.0 summary,
§16 RAM map).

## Contents

* [Variants and how to build](#variants-and-how-to-build)
* [Feature: start-up "00" and Morse ident (INTRO)](#feature-start-up-00-and-morse-ident-intro)
* [Feature: Rx frequency on the control head (FREQ)](#feature-rx-frequency-on-the-control-head-freq)
* [Feature: scan ignores the handset hook (NOHOOK)](#feature-scan-ignores-the-handset-hook-nohook)
* [RAM, timers and tables](#ram-timers-and-tables)
* [Bench-test checklist](#bench-test-checklist)
* [Files](#files)
* [Rules for changing the source](#rules-for-changing-the-source)
* [Change history](#change-history)

## Variants and how to build

One source, assembled with feature flags (`-D NAME=0/1`, set by `build.py`):

| Master (`build/`) | Flags | WebFPP Firmware menu | `mkradio.py --variant` | What it does |
|---|---|---|---|---|
| (factory `FM92R.BIN`) | none | Factory (Original FPP) | – | stock |
| `FM92R-intro.BIN` | INTRO + NOHOOK | Start-up ident (FM92R) | `intro` | "00" + Morse callsign at switch-on; scan ignores the hook |
| `FM92R-fork.BIN` | INTRO + FREQ + NOHOOK | Ident + Rx freq. (FM92R) | `enhanced` (default) | the above + Rx frequency on the head |

```sh
cd firmware/extended
python3 build.py              # -> build/FM92R-intro.BIN, build/FM92R-fork.BIN (+ .lst, .sym each)
python3 -m unittest test_fork
python3 mkradio.py build ch.csv --hw 9244.... --sw ... --callsign VK2FN -o radio.bin -v   # ident + Rx frequency
python3 mkradio.py fromjob ../../fm900/JOBS/2MHAM/2MHAM.JOB --variant intro --callsign VK2FN -o radio.bin   # ident only
```

`build.py`:

1. Assembles the **stock** build (`FORK=0 FREQ=0 INTRO=0`). It must be
   byte-identical to `fm900/MASTERS/FM92R.BIN`, or the build stops. This
   proves everything outside the `.if` blocks is still the original firmware.
2. Assembles each **variant**, fixes the EPROM checksum (0x1F64) and firmware
   signature (0x1F65) so the master is self-consistent like the factory
   ones, and checks its stack depth against the factory master
   (`stackdepth.py`). It then writes `build/<name>.BIN` and lists the address
   ranges that differ from the factory master.

`mkradio.py` takes the same channel list / `.JOB` input and `--keys` /
`--date` options as `fm900gen.py`, plus `--variant` and `--callsign`. It
builds with fm900gen from the variant's master, fills the callsign and
frequency tables, and recomputes the checksums. It refuses hardware codes that
don't select FM92R (FM92L, or FM92RS with selcall). `-v` lists what each
channel will show.

**WebFPP** (Build tab, Firmware menu and "Start-up Ident Callsign (Morse)") does the
same in the browser:
* `web/src/core/fork.ts` is a port of `mkradio.py`, and `web/test/fork.test.ts`
  checks the two give byte-identical images for every variant.
* `web/scripts/gen-masters.mjs` runs `build.py` whenever WebFPP is built,
  run or tested, so changes here reach it automatically. If you change a
  table format or address, change `fork.ts` too.
* Read image recognises the variants (by their table markers) and reads the
  callsign back.

Plain `fm900gen.py` gives stock firmware. `fm900gen.py --master-file
build/FM92R-fork.BIN` gives the extended firmware with empty tables: "00" for 1 s with
no Morse, and channel numbers only.

## Feature: start-up "00" and Morse ident (INTRO)

At switch-on, right after the start-up message to the head (`$AA`) and
before the channel is selected, the head shows `00`. Meanwhile the radio
sends the callsign (`--callsign`, WebFPP's "Start-up Ident Callsign (Morse)") in
Morse on its beep tone, then starts normally and shows the channel. With no
callsign, `00` stays for 1 s and there is no sound.

* **Tone.** The beep is the key-beep tone. `$29.7` enables it, and the timer
  interrupt (`uart_bit`) toggles latch bit `$29.4` at about 600 Hz while it
  is set. The key beep holds it for about 80 ms. Whether the tone can be
  heard this early in start-up, before the receiver is unmuted, has to be
  checked on the radio.
* **Speed.** 18 wpm: 1 unit = 66.5 ms. The 27 ms soft timers only allow
  80 ms (15 wpm) or 53 ms (22.6 wpm), so `mo_wait` counts flips of bit 5 of
  the timer ISR's tick counter `$28` instead. It flips every 32 ticks of
  ~415 µs, which is 13.3 ms, and 1 unit = 5 flips (`MO_UNIT`). Dit = 1 unit,
  dah = 3, the gap between elements 1, between letters 3, and between words 7.
  VK2FN takes 68 units including the final pause, about 4.5 s. (Before
  2026-11-23 it was 15 wpm on soft timer `$58`.)
* **Blocking.** It blocks start-up for that long. The main loop isn't
  running, so no keep-alive poll is sent and nothing times out. Keys pressed
  on the head meanwhile are ignored.
* **Table.** `MO_TABLE` at `$197C` (48 bytes, after a `MOR1` marker at
  `$1978`) holds 1 = dit, 3 = dah, `$80` = end of letter, `$81` = word space,
  0 = end. It allows letters, digits and `/ ? . , =`, about 8 to 10
  characters.
* **Where the "88" comes from.** The factory firmware never sends `88`. At
  switch-on it sends `$AA`, then `$A0` and the channel number about 10 ms
  later, then the head configuration (FIRMWARE.md §6.1). So `88` is the head's
  own display, shown until the radio's first digits arrive. It stays up if
  **the radio's current channel isn't programmed**: then no digits are sent at
  all, and you get a reject beep. That happens after fitting an EPROM with
  fewer channels while the radio's RAM kept the old channel number; channel
  up/down fixes it. With this feature the head gets `00` right after `$AA`,
  and then the channel (or, on an unprogrammed channel, it keeps the `00`).
* **Hook.** The start-up hook (7 bytes): `clr $10 ; lda #$aa ; jsr
  head_send` becomes `jsr fork_init` + 4 NOPs. `fork_init` sends the `$AA`
  itself, then runs the ident. RAM `$B6`–`$B7`; timing from the tick counter `$28` (read only).

## Feature: Rx frequency on the control head (FREQ)

After the channel number has been shown for 2 s, the display is blanked for
0.5 s. Then the head shows the channel's Rx frequency two characters at a time,
sliding one character every 0.24 s by default (adjustable from 0.11 s to 1.01 s: see
"Speed" below; the blanks use `T_BLANK`, 19 ticks = 0.5 s), blanks for 0.5 s again, shows the channel
number for 2 s, and repeats. 147.450 MHz on channel 3:

    " 3" (2 s)   "  "   14   47   "7 "   " 4"   45   50   "  "   " 3" (2 s)   "  "   14 ...

* **Speed.** Each window shows for the number of 26.6 ms ticks in the byte
  `FQ_SPEED` at `$1977` (stored as ticks − 1), just before the Morse table.
  The master holds the default, `T_STEP` = 8 (9 ticks = 0.24 s).
  `mkradio.py --step-ms N` (and WebFPP's **Frequency display speed** slider)
  writes it per radio: 4 to 38 ticks, i.e. 0.11 s to 1.01 s. The lower limit
  leaves the head link free most of the time: a window is 4 bytes, about 37 ms
  at 1200 baud, and the head's keep-alive replies must still get through. The
  blanks stay 0.5 s.
* **Blank.** Two spaces (`$80 ' '`, `$82 ' '`), not the `$E5` display-off
  message, which belongs to the intermittent-display option. Transmitting
  during a blank brings the channel number back at once, like during the
  frequency.

* **Format.** The decimal point is shown as a space; the stock firmware only
  ever sends digits and space, so other characters may not exist on the head.
  3 decimals on the 25 kHz raster (146.800, 147.450: trailing zeros kept), or
  4 when the 100 Hz digit isn't 0, as on the 12.5 kHz raster (477.0125). Below
  100 MHz the string is just shorter (77.500 → `77 "7 " " 5" 50 00`).
* **When it stops.** It stops as soon as anything else is put on the display,
  and starts again (with the channel number) whenever the channel is shown
  again. That covers a channel change, scanning (the scan display is left
  alone), selcall digits, and the intermittent display blanking (0x1F33 bit 1).
  The frequency sends don't restart the intermittent-display timeout.
* **Transmit.** While transmitting, the channel number is shown. The end of a
  transmission redisplays the channel and restarts the 2 s wait.
* **Nothing restarts it by itself.** Only user actions redisplay the
  channel: keys, PTT, scan, lifting the mic, or the display timeout. No
  interrupt handler touches the display. The economiser's wake-up calls
  `tx_stop` with `$18.6` set, which returns before redisplaying, so it doesn't
  restart the cycle either.
* **Vote / scan channels.** It shows the home channel's frequency (`$50`),
  the same channel `show_channel` displays.
* **Head link.** A step is only sent when the UART FIFO is empty and no
  keep-alive reply is due (`$1C.5`), so it never talks over the head's `$49`
  reply (two missed replies switch the radio off, FIRMWARE.md §6.3). The head
  can still send at any time (keys, PTT repeats) while the radio is sending;
  that is the same with stock firmware, but there is now more traffic: 4 bytes
  every 0.24 s while the frequency is shown (each 4-byte window takes about
  37 ms on the 1200 baud link).
* **Where the frequency comes from.** The firmware has no way to work out the
  frequency (the step and IF depend on the hardware code), so `mkradio.py`
  decodes each slot's Rx divider (f = N × step − IF, what the radio really
  tunes) and writes a table: 4 arrays of 100 bytes at `$19B0`, after a
  `FQT1` marker at `$19AC`. The format is described at the top of `fork.asm`.
* **RAM and timer.** It uses external RAM `$B8`–`$BD` and the spare 27 ms
  soft timer `$57` (see "RAM and timers" below).
* **Hooks.** These are listed at the top of `fork.asm`: warm start, `head_display_off`,
  `show_channel`, `display_digits`, and the end of the main loop.

## Feature: scan ignores the handset hook (NOHOOK)

In both variants. In the factory firmware, the handset going off-hook (`$11.4` = PA7 high AND head `$46` held) while
scanning stops the scan on the priority or home channel. If that channel then stays quiet with the handset still off,
the radio sounds a **continuous tone** after about 32 s, until the handset goes back on-hook, a signal arrives, PTT is
pressed, or scan is switched off (FIRMWARE.md §7.3). A handset left lying on the bench sets this off. It was
reported on the first radio running the extended firmware.

NOHOOK replaces the three `brset 4,$11,…` tests in `scan_task` with 3 NOPs each:

| Address | Factory | With NOHOOK |
|---|---|---|
| `$0EC0` | off-hook while scanning → park on priority/home channel | keeps scanning |
| `$0EF1` | off-hook → no priority-channel revisit while stopped | priority revisits carry on |
| `$0FC7` | off-hook on a stopped, quiet channel → 32 s, then continuous tone | the normal 3.4 s hang time, then scanning resumes |

`$11.4` still does everything else it did (CTCSS encode gate and the CTCSS monitor, §7.2), and PTT is
unchanged. No RAM, no new code. Tests: `NoHookScan` in `test_fork.py` runs `scan_task` in the simulator with the
original instructions put back (tone on, scan parked) and with NOHOOK (neither).

## RAM, timers and tables

| What | Where | Used by |
|---|---|---|
| Morse table index / scratch | external RAM `$B7` / `$B6` | INTRO |
| Frequency display state | external RAM `$B8`–`$BD` | FREQ |
| Tick counter (read only, bit 5 = 13.3 ms) | `$28` | INTRO |
| Soft timer (27 ms) | `$57` (spare in stock) | FREQ |
| Callsign table | `$1978` "MOR1" + 48 bytes at `$197C` | INTRO, filled by mkradio / WebFPP |
| Frequency table | `$19AC` "FQT1" + 4 × 100 bytes at `$19B0` | FREQ, filled by mkradio / WebFPP |

`$B6`–`$BD` lie in the unused gap `$A5`–`$BD` of the external RAM. Nothing in
the stock firmware touches it, and it is inferred to be real RAM because the
selcall code uses both sides of it. Stack depth is unchanged from the factory
firmware (`stackdepth.py`, checked by `build.py`).

## Bench-test checklist

0. At switch-on: `00` on the head, and VK2FN audible in Morse, then the
   channel. If there is no sound, the audio path is probably still muted at
   that point in start-up; that is fixable by moving the ident later.
1. The radio stays on with the head connected for several minutes. A
   collision on the head link would show up as the radio switching itself off.
2. Keys, PTT and head monitor still work during the cycle.
3. If the display option is intermittent, the display still blanks.
4. On a CTCSS channel, lift the mic or hold monitor and listen for a minute
   while the frequency cycles. The head must repeat `$46` within 1.5 s or the
   radio releases it, so a lost repeat would show up as the audio dropping
   out.

## Files

| File | What it is |
|---|---|
| `FM92R.asm` | The firmware source. Generated once by `mkasm.py` from the master and `../FM92R.ann` (routine names and comments). It is hand-edited from now on. The hooks into the original code are in `.if` blocks. |
| `fork.asm` | New code and tables, included at the start of the free area (`$15AF`). The header lists the feature flags and every hook. |
| `asm6805.py` | Two-pass MC146805E2 assembler. Stdlib Python 3, always writes an 8 KB image. Has `.at`, `.if`/`.else`/`.endif`, `.include`, `ds` and `-D`; the syntax is in its docstring. |
| `op6805.py` | Opcode table shared by the assembler, generator and simulator. |
| `build.py` | Builds and checks the variants (above). |
| `mkradio.py` | Builds a **radio image** (fm900gen inputs + `--variant`, `--callsign`) and fills the callsign and frequency tables. |
| `sim6805.py` | Small 6805 instruction-set simulator (no interrupts or peripherals; tests stand in for the timer). |
| `stackdepth.py` | Static worst-case stack depth. The bound is pessimistic (factory = 27), so `build.py` compares against the factory master. |
| `mkasm.py` | The generator. Only needed to re-create `FM92R.asm` from scratch. It refuses to overwrite an existing file unless given `--force`. |
| `test_fork.py` | Tests: every opcode round-trips; stock source == master; FM92R reference jobs rebuild byte-identical; frequency table and display cycle; Morse ident decoded from the simulated tone timing; switch-on messages of factory and fork images. |
| `build/` | Output (gitignored). |

## Rules for changing the source

* **Original code stays where it is.** Every original label carries
  `.at $addr`, which makes the build fail if the code before it changed size.
  The firmware has pointers the assembler can't see, so moving code is not
  safe:
  * addresses built from immediates for the `$21–$24` RAM routine;
  * `jmp $0188,x`, which means "label − 1 + X";
  * jump tables.
* **Hooking in.** To hook new code in, overwrite an original instruction with
  `JSR`/`JMP` to your routine. Pad with `NOP`s to the same size, and redo the
  overwritten instructions in the new routine. Wrap the change in
  `.if FORK` (or the feature's own flag, e.g. `.if FREQ`) so the stock build
  still has the original:

  ```asm
          .if FORK
          jsr     my_startup        ; 3 bytes
          nop                       ; + 2 = the 5 bytes replaced
          nop
          .else
          lda     #$aa
          jsr     head_send
          .endif
  ```

* **Where new code goes.** New routines go in `fork.asm`, in the free area
  `$15AF–$1B3F` (1425 bytes). Put code first and tables at the end, at fixed
  addresses (the tools write into them). The build reports how much is used,
  and it is an error to run into the data area at `$1B40`.
* **New features** get their own flag (`.if NAME`). Add the flag to every
  entry in `build.py` `STOCK`/`VARIANTS`, and add a variant if it should be
  buildable on its own.
* **Areas not to edit:**
  * `$0000–$00FF`. Its `$AC` balancing byte keeps the firmware's checksum
    and fm900gen's in agreement.
  * `$1B40–$1FFF`: channel table, configuration, master ID and vectors.
    fm900gen rewrites the configuration from the hardware and software codes.
    It does not change 0x1F10–0x1F13 or the master ID.
* **Signature sample bytes.** The sample bytes 0x01CC … 0x1ACC can be
  changed: `build.py`, fm900gen and FM900.EXE all recompute 0x1F65.
  `FIRMWARE.md` §13 says to avoid 0x15CC/0x19CC/0x1ACC, but that only
  mattered for patches that didn't recompute 0x1F65. To keep them anyway,
  add `.avoid $15CC, $19CC, $1ACC` to `fork.asm`.
* **`bset n` / `bclr n`.** These are `$10+2n` / `$11+2n` (Motorola manual).
  Capstone-based listings before the fix in `../tools/d6805.py` had them
  swapped.
* **Forcing addressing modes.** `<expr` forces direct/ix1 and `>expr`
  forces extended/ix2. A forward reference that resolves below `$100` is an
  error unless forced, so instruction sizes can't change between passes.
* **Names.** Routine names come from `../FM92R.ann`, and the RAM meanings are
  in `../FIRMWARE.md` §16 and `../FM92R.ram.txt`. To rename something in the
  extended firmware, edit `FM92R.asm` directly. `mkasm.py` is not re-run.

## Change history

| Commit | Change |
|---|---|
| `d25d095`, `362db4a` | Fork created (renamed "extended firmware" and moved from `firmware/fork/` to `firmware/extended/` on 2026-11-24): `FM92R.asm` (re-assembles byte-identical), `asm6805.py`, `build.py`, tests. |
| `8e4b883`, `339b421` | FREQ: Rx frequency on the head; `mkradio.py`; simulator; stack check. Found that `$82` is the left display digit; `patch_startup_msg.py` and FIRMWARE.md §11 had them swapped. |
| `b93b311` | WebFPP: Firmware menu (Factory / Enhanced). |
| `4eb17d1` | INTRO: start-up "00" + Morse callsign; two variants; WebFPP callsign field and three-way menu. |
| `b99ce34`, `d624717` | WebFPP: "Experimental firmware" note on the Build and Read tabs. |
| `ca3f4b5` | What the factory firmware sends to the head at switch-on (FIRMWARE.md §6.1); start-up regression test. |
| `4b694e9` | FREQ: 0.5 s blank before and after the frequency. |
| (2026-11-23) | First hardware report: an image burned and worked on an FM92R. Still experimental. |
| (2026-11-23) | NOHOOK in both variants: scan ignores the handset hook (no off-hook scan stop, no continuous tone). |
| (2026-11-23) | INTRO: Morse ident 15 → 18 wpm, timed from the tick counter `$28`; soft timer `$58` is spare again. |
| (2026-11-24) | FREQ: frequency windows every 0.24 s (`T_STEP` 18 → 8), blanks kept at 0.5 s (new `T_BLANK`). |
| (2026-11-24) | Frequency table: a trailing 0 decimal is left off (147.450 → 147.45); `mkradio.py` and WebFPP's `fork.ts`. |
| (2026-11-24) | Reverted: always 3 decimals on the 25 kHz raster (146.800), 4 on 12.5 kHz (477.0125). |
| (2026-11-24) | Frequency display speed setting: window length read from `FQ_SPEED` (`$1977`, ticks − 1; default 8 = 0.24 s), set by `mkradio.py --step-ms` / WebFPP's Build-tab slider (0.11–1.01 s). |

# FM92R firmware fork

An editable, re-assemblable source of the FM92R master firmware
(`fm900/MASTERS/FM92R.BIN`). New functionality is added here. The output is
a master image that `fm900gen.py --master-file` turns into a radio EPROM.

**Build radio images with `mkradio.py` or Web FPP.** In Web FPP, choose
the firmware on the Build tab (Start-up ident, or Ident + Rx freq.) and enter
the callsign. Its `src/core/fork.ts` is a port of
`mkradio.py`, and its tests check that the two give byte-identical images.
Web FPP assembles this fork when it is built (`web/scripts/gen-masters.mjs`
runs `build.py`), so a change here reaches it on the next `npm run dev` /
`build` / `test`. If you change the table format or addresses, change
`fork.ts` too.

Plain fm900gen gives stock firmware, and `fm900gen.py --master-file
build/FM92R-fork.BIN` gives the fork firmware with an empty frequency table
(the head then shows only channel numbers).

## Feature: start-up "00" and Morse ident (INTRO)

At switch-on, right after the start-up message to the head (`$AA`) and
before the channel is selected, the head shows `00`. Meanwhile the radio
sends the callsign (`--callsign`, Web FPP's "Start-up Morse callsign") in
Morse on its beep tone, then starts normally and shows the channel. With no
callsign, `00` stays for 1 s and there is no sound.

* **Tone.** The beep is the key-beep tone. `$29.7` enables it, and the timer
  interrupt (`uart_bit`) toggles latch bit `$29.4` at about 600 Hz while it
  is set. The key beep holds it for about 80 ms. Whether the tone can be
  heard this early in start-up, before the receiver is unmuted, has to be
  checked on the radio.
* **Speed.** 15 wpm: 1 unit = 3 soft-timer ticks of 26.6 ms = 80 ms
  (`MO_UNIT`). Dit = 1 unit, dah = 3, the gap between elements 1, between
  letters 3, and between words 7. VK2FN takes 68 units including the final
  pause, about 5.4 s.
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
* **Hook.** It uses the same start-up hook as before, now 7 bytes:
  `clr $10 ; lda #$aa ; jsr head_send` becomes `jsr fork_init` + 4 NOPs.

## Feature: Rx frequency on the control head (FREQ)

After the channel number has been shown for 2 s, the head shows the channel's
Rx frequency two characters at a time, sliding one character every 0.5 s. Then
it shows the channel number for 2 s again, and repeats. 147.450 MHz shows:

    14   47   "7 "   " 4"   45   50   (channel, 2 s)   14 ...

* **Format.** The decimal point is shown as a space; the stock firmware only
  ever sends digits and space, so other characters may not exist on the head.
  3 decimals, or 4 when the 100 Hz digit isn't 0 (477.0125). Below 100 MHz the
  string is just shorter (77.500 → `77 "7 " " 5" 50 00`).
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
  every 0.5 s.
* **Where the frequency comes from.** The firmware has no way to work out the
  frequency (the step and IF depend on the hardware code), so `mkradio.py`
  decodes each slot's Rx divider (f = N × step − IF, what the radio really
  tunes) and writes a table: 4 arrays of 100 bytes at `$19B0`, after a
  `FQT1` marker at `$19AC`. The format is described at the top of `fork.asm`.
* **RAM and timer.** It uses external RAM `$B8`–`$BD` (in the unused gap
  `$A5`–`$BD`; inferred to be real RAM, because the selcall code uses both
  sides of it) and the spare 27 ms soft timer `$57`.
* **Hooks.** These are listed at the top of `fork.asm`: warm start, `head_display_off`,
  `show_channel`, `display_digits`, and the end of the main loop.

**Bench-test checklist:**
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


**Untested on hardware** until a change has been burned and tried. Keep the
factory EPROM.

| File | What it is |
|---|---|
| `FM92R.asm` | The firmware source. Generated once by `mkasm.py` from the master and `../FM92R.ann` (routine names and comments). It is hand-edited from now on. |
| `fork.asm` | New code. `FM92R.asm` includes it at the start of the free area (`$15AF`). |
| `asm6805.py` | Two-pass MC146805E2 assembler. Stdlib Python 3, always writes an 8 KB image. The syntax is in its docstring. |
| `op6805.py` | Opcode table shared by the assembler and the generator. |
| `build.py` | Builds and checks everything (below). |
| `mkradio.py` | Builds a **radio image** from the fork (same inputs as `fm900gen.py build` / `fromjob`), and fills the frequency table. |
| `sim6805.py` | Small 6805 instruction-set simulator (no interrupts or peripherals). The tests use it to run the fork's routines. |
| `stackdepth.py` | Static worst-case stack depth. `build.py` fails if the fork goes deeper than the factory master. |
| `mkasm.py` | The generator. Only needed to re-create `FM92R.asm` from scratch. It refuses to overwrite an existing file unless given `--force`. |
| `test_fork.py` | Tests: every opcode round-trips, stock source == master, the FM92R reference jobs rebuild byte-identical through the stock build, the frequency table and display sequence (the display code is run in `sim6805.py`). |
| `build/` | Output (gitignored). |

## Build

```sh
cd firmware/fork
python3 build.py              # -> build/FM92R-fork.BIN, .lst (address + bytes), .sym
python3 -m unittest test_fork
python3 mkradio.py build ch.csv --hw 9244.... --sw ... --callsign VK2FN -o radio.bin -v   # ident + Rx frequency
python3 mkradio.py fromjob ../../fm900/JOBS/2MHAM/2MHAM.JOB --variant intro --callsign VK2FN -o radio.bin   # ident only
```

`build.py` assembles two variants from the same source, selected by the feature
flags in `fork.asm` (`-D INTRO=1 FREQ=1` etc.):

| Master | Flags | Web FPP name | `mkradio.py --variant` |
|---|---|---|---|
| `build/FM92R-intro.BIN` | INTRO | Start-up ident | `intro` |
| `build/FM92R-fork.BIN` | INTRO + FREQ | Ident + Rx freq. | `enhanced` (default) |

`mkradio.py` takes the same channel list / `.JOB` input and `--keys` /
`--date` options as `fm900gen.py`. It refuses hardware codes that don't select
FM92R (FM92L, or FM92RS with selcall). `-v` lists what each channel will show.

`build.py` assembles the source twice:

1. **`FORK=0` (stock).** The result must be byte-identical to
   `fm900/MASTERS/FM92R.BIN`. If it isn't, the build stops. This proves that
   everything outside the `.if FORK` blocks is still the original firmware.
2. **`FORK=1` (the fork).** It fixes the EPROM checksum (0x1F64) and the
   firmware signature (0x1F65), so the master is self-consistent like the
   factory ones. It writes `build/FM92R-fork.BIN`, then lists the address
   ranges that differ from the factory master.

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
  `.if FORK` so the stock build still has the original:

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
  `$15AF–$1B3F` (1425 bytes). The build reports how much is used, and it is
  an error to run into the data area at `$1B40`.
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
  fork, edit `FM92R.asm` directly. `mkasm.py` is not re-run.

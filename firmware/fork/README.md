# FM92R firmware fork

An editable, re-assemblable source of the FM92R master firmware
(`fm900/MASTERS/FM92R.BIN`). New functionality is added here. The output is
a master image that `fm900gen.py --master-file` turns into a radio EPROM.

**Build radio images with `mkradio.py`.** Web FPP only has the factory
masters built in, and so does fm900gen without `--master-file`: building in
either of those, or reading a fork EPROM back in the Read tab and rebuilding
it, silently gives stock firmware. `fm900gen.py --master-file
build/FM92R-fork.BIN` gives the fork firmware but an empty frequency table,
so the head only shows channel numbers.

## Feature: Rx frequency on the control head

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
1. The radio stays on with the head connected for several minutes. A
   collision on the head link would show up as the radio switching itself off.
2. Keys, PTT and head monitor still work during the cycle.
3. If the display option is intermittent, the display still blanks.


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
python3 mkradio.py build ch.csv --hw 9244.... --sw ... -o radio.bin -v    # the radio EPROM image
python3 mkradio.py fromjob ../../fm900/JOBS/2MHAM/2MHAM.JOB -o radio.bin
```

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

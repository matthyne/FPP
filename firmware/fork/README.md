# FM92R firmware fork

An editable, re-assemblable source of the FM92R master firmware
(`fm900/MASTERS/FM92R.BIN`). New functionality is added here. The output is
a master image that `fm900gen.py` (or Web FPP) turns into a radio EPROM in the
usual way.

**Untested on hardware** until a change has been burned and tried. Keep the
factory EPROM.

| File | What it is |
|---|---|
| `FM92R.asm` | The firmware source. Generated once by `mkasm.py` from the master and `../FM92R.ann` (routine names and comments). It is hand-edited from now on. |
| `fork.asm` | New code. `FM92R.asm` includes it at the start of the free area (`$15AF`). |
| `asm6805.py` | Two-pass MC146805E2 assembler. Stdlib Python 3, always writes an 8 KB image. The syntax is in its docstring. |
| `op6805.py` | Opcode table shared by the assembler and the generator. |
| `build.py` | Builds and checks everything (below). |
| `mkasm.py` | The generator. Only needed to re-create `FM92R.asm` from scratch. It refuses to overwrite an existing file unless given `--force`. |
| `test_fork.py` | Tests: every opcode round-trips, stock source == master, the FM92R reference jobs rebuild byte-identical through the stock build. |
| `build/` | Output (gitignored). |

## Build

```sh
cd firmware/fork
python3 build.py              # -> build/FM92R-fork.BIN, .lst (address + bytes), .sym
python3 -m unittest test_fork
../../fm900gen.py build ch.csv --hw 9248.... --sw ... --master-file build/FM92R-fork.BIN -o radio.bin
```

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

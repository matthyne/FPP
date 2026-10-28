# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

* The original DOS **Philips FM900 Field Personality Programmer**.
* A Linux re-implementation of its EPROM image builder.
* A browser version of that builder (`web/`), in the style of a web CPS.

## Layout

The original DOS files are reference material. **Never modify them.**

| Path | Contents |
|---|---|
| `FPP.EXE`, `FPP.STP`, `FPP.HLP` | DOS menu launcher. No radio logic. |
| `fm900/BIN/FM900.EXE` | The real programmer. EXEPACK-compressed MS C 5.x. |
| `fm900/MASTERS/*.BIN` | 8 KB factory master images (68HC05 firmware). `fm900gen.py` reads these by default. |
| `fm900/JOBS/` | Sample jobs (`.JOB` / `.CHL` / `.BIN`). These are the regression test vectors. |
| `fm900gen.py` | The generator. Python 3, stdlib only, single file. Sub-commands: `build`, `fromjob`, `writejob`, `dump`. `--keys` (FM92 only) is the one deliberate deviation from FM900.EXE: it overrides the function-key bytes 0x1F58–0x1F5B. |
| `FM900_FORMAT.md` | Authoritative format documentation. Keep it in sync with code changes. |
| `README.md` | User docs. |
| `firmware/FIRMWARE.md` | Radio firmware (FM92R/FM92L) documentation. |
| `firmware/*.lst` | Annotated 68HC05 listings. These are generated: edit `firmware/*.ann` (`=addr name` or `addr comment`) and re-run `python3 firmware/tools/mklist.py FM92R` (needs `pip install capstone`). |
| `firmware/FM92L.ann` | FM92L routine names, ported from FM92R by aligning the two instruction streams. |
| `web/` | Web CPS: Vite + TypeScript + Preact static site. See "Web CPS" below. |
| `.github/workflows/pages.yml` | Runs the web tests and deploys `web/dist` to GitHub Pages (`/FPP/`). |

## Rules when changing fm900gen.py

* **Faithful port.** Each method is a faithful port of an FM900.EXE routine, and the comments give the routine's linear address in the unpacked image (e.g. `FUNC 0x5A5D`). Preserve the original quirks: operation order, OR/AND on top of master contents, x87 80-bit comparisons done with `Fraction`, and FM92-VHF storing L power as 2.
* **Regression test.** These must stay byte-identical when built with `fromjob` and the date stamped in each reference `.BIN`:
  * `fm900/JOBS/2MHAM`
  * `fm900/JOBS/SH`
  * `fm900/JOBS/SHC`
  * `fm900/JOBS/80CHCB`
  * `fm900/JOBS/477`, first 20 channels, with channel 11's `F_SCAN1` flag cleared (that `.CHL` was edited after its `.BIN` was made)
* **Unsupported paths.** FM93, FM97WP/waterproof and the selcall tone editor are not implemented. The relevant routines are listed in FM900_FORMAT.md §5.

## Web CPS (`web/`)

* `src/core/fm900.ts` is a **faithful port of `fm900gen.py`**: same routine order, the same FUNC address comments, the same quirks. Change both together. `fm900gen.py` stays the reference.
  * The x87 `Fraction` comparison in `vco_bit` becomes a double comparison of `f - ip`. That subtraction is exact (Sterbenz).
  * Use `.slice()` (copy) where the Python slices a bytearray.
* Other core modules (DOM-free, so they're testable in Node):
  * `channels.ts`: CSV parse and format (the README format, with an optional trailing `name` column).
  * `import.ts`: foreign CSV import. It parses the table, guesses the header mapping (CHIRP/RepeaterBook, RadioReference, generic), and converts rows with a per-row ok/include/reason. The UI is `src/ui/ImportDialog.tsx`.
  * `decode.ts`: `dump` port, plus `readImage` (BIN → channels, best effort).
  * `codes.ts`: HW/SW digit tables.
  * `project.ts`: the UI's project model.
  * `analyze.ts`: per-row problems plus a trial build.
  * `masters.ts`: masters embedded as base64.
* `src/core/masters.gen.ts` is generated from `fm900/MASTERS` by `scripts/gen-masters.mjs`, which runs before dev, build and test. It is gitignored. Don't copy the masters into `web/`.
* `Row.name` is UI-only. It goes in the project JSON and the CSV `name` column, never in the `.CHL` or the EPROM.
* **Rows are an ordered list, not slots.** Duplicate numbers and VOTE rings need several records per number, and record order decides ring slots and scan-list order. Never key the grid by channel number.
* Tests (`cd web && npm test`):
  * `golden.test.ts`: the five regression jobs, byte-identical, both directly and through the UI project model.
  * `vectors.test.ts`: runs `test/gen_vectors.py`, about 3000 random cases built by `fm900gen.py`. Hash, error/no-error and VCO warnings must match. It is skipped if `python3` is missing. `FM900_VECTORS=n` changes the count.
  * `readback.test.ts`: decodes each reference `.BIN` back to channels and rebuilds it identically.
  * `import.test.ts`: CHIRP, RadioReference (pasted), README, headerless and generic tables, plus tone parsing.
* Dev: `cd web && npm install && npm run dev`, then open `http://localhost:5173/FPP/`. Vite `base` is `/FPP/` (override with `FM900_BASE`).

## Facts confirmed from both sides

* `.CHL` flag word: 0x10 = VOTE, 0x20 = ECON, 0x40 = SELCALL, 0x4000 = C/R. The FM900.EXE entry-screen order is CTCSS, C/R, VOTE, ECON, SELCALL. The firmware agrees: VOTE drives the linked-slot voting ring, and slot byte6 bit7 (SELCALL) gates the selcall code.
* FM92L and FM92R differ only in the operator interface. L = local front-panel keys, display and LEDs. R = 1200 baud single-wire serial link to a remote control head. The data layout is identical.

## Re-doing the FM900.EXE disassembly

1. Unpack EXEPACK. The stub is at CS = 0x29B1; the real entry is 1963:0014 and DGROUP is 0x230F.
2. Convert the MS C floating-point emulator calls back to x87 opcodes:
   * `CD 34..3B` → `9B D8..DF`
   * `CD 3D` → `90 9B`
3. Disassemble with Capstone in 16-bit mode.

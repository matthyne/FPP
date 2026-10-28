# Philips FM900 personality EPROM tools

This directory holds the original DOS **Philips Field Personality Programmer**:

* `FPP.EXE`, the menu launcher
* `fm900/BIN/FM900.EXE`, the actual programmer
* the factory master images (`fm900/MASTERS`)
* some saved jobs (`fm900/JOBS`)

It also holds a Linux replacement for the image-building part:

* **`fm900gen.py`**: builds the 8 KB 2764 EPROM image for FM91 and FM92 radios from a list of frequencies. It is Python 3 with no dependencies.
* **`web/`**: the same builder as a **web CPS** that runs in the browser: a channel grid, HW/SW code menus, scan and key setup, `.BIN` download, `.JOB`/`.CHL`/CSV import and export, and read-back of an existing `.BIN`. See [Web CPS](#web-cps).
* **`FM900_FORMAT.md`**: full documentation of FPP.EXE, FM900.EXE, the job file formats, the hardware/software codes, and the EPROM layout.
* **`firmware/`**: disassembly of the radio's own 68HC05 firmware (FM92R and FM92L masters).
  * `FIRMWARE.md` explains what L vs R means, the hardware interface, the scheduler, and how the radio uses every channel and config byte.
  * The folder also holds annotated listings and the disassembler tools.
  * `patch_startup_msg.py` builds a patched FM92R master that shows a start-up message (e.g. `AA`) on the remote head.
  * `FIRMWARE.md` §12 covers EPROM types: why it must be a 2764, 2716→2764 socket conversion, and using a 27128/27256 for 2–4 switchable banks of 99 channels.
  * `FIRMWARE.md` §14: control-head DIN (CFA and VicPol) and microphone connector pinouts.
  * `FIRMWARE.md` §13, **Future Upgrade Options**: designs for a duplex/talk-around key, bank switching from a function key, and PC/tablet control over the remote-head link (not implemented).

## Quick start

```sh
# channels.csv
ch,rx,tx,power,scan,ctcss
1,147.000,147.000,H,,
2,146.400,147.000,H,,173.8
3,146.950,146.350,M,1,91.5

./fm900gen.py build channels.csv --hw 92440150 --sw 110100201000000 -o radio.bin
./fm900gen.py dump radio.bin --hw 92440150 --step 5      # check the result
```

Burn `radio.bin` to a 27C64 or 2764, for example with `minipro -p 2764 -w radio.bin`.

### Channel list format

Lines may be comma- or whitespace-separated. `#` starts a comment.

* **Optional header row.** It names the columns, chosen from `ch rx tx power scan ctcss vote econ selcall cr`.
* **No header.** The columns are `rx tx power scan ctcss vote econ selcall cr`, and channels are numbered from 1.
* A file with one frequency per line is valid: simplex, high power.

| Column | Values |
|---|---|
| `rx` / `tx` | MHz, up to 4 decimals. `tx` defaults to `rx`. Use `X` for receive-only. |
| `power` | `H` 25 W, `M` 5 W, `L` 1 W, `S` selectable. The default is `--power`, normally `H`. |
| `scan` | `1`, `2` or `3` = member of scan block *n* (max 10 each; block 3 is FM91 only). `1P`/`2P`/`3P` = priority channel of that block. `S` = operator-selectable. These can be combined, e.g. `12`. |
| `ctcss` | Tone in Hz (`91.5`) or the letter code (`W`), from the 38-tone table in FM900_FORMAT.md. |
| `vote`, `econ`, `selcall`, `cr` | `Y` / `N` |

### Hardware and software codes

These are the same codes the DOS program asks for. All the digits are tabulated in
FM900_FORMAT.md §3. The important ones:

* **Hardware digit 2 = model:** 1 = FM91 (120 channels), 2 = FM92 (99 channels).
* **Hardware digit 3 = band:** 2 = 66–88, 3 = 132–153, 4 = 148–174, 5 = 403–440, 6 = 440–470, 7 = 470–500, 8 = 500–520 MHz.
* **Hardware digit 4 = control/spacing:** 3/4 = local/remote 25 kHz, 7/8 = local/remote 12.5 kHz. This digit also chooses between the L and R masters.

Examples taken from the existing jobs:

| Job | HW | SW |
|---|---|---|
| 2 m ham, FM92R A-band | `92440150` | `110100201000000` |
| VHF B-band | `92340000` | `110300200000000` |
| UHF CB, FM92R W1-band | `92740000` | `110401200000000` |
| UHF CB, FM91, 12.5 kHz | `91785000` | `110000000000000` |

The codes for an existing radio come from its `.JOB` file, its PIRS sheet, or its label. They cannot be fully recovered from an EPROM image, because several codes map to the same bits.

## Remapping the head's function keys (FM92 only)

The FM92 radio acts on four key codes from the control head: `1`, `2`, `4` and `7`.
Each one runs the function whose number is stored in EPROM bytes 0x1F58–0x1F5B.

FM900.EXE always fills these from the software code. To choose them yourself, pass `--keys`
to `build` or `fromjob`: four comma-separated values, for keys 1, 2, 4 and 7 in that order.

| Code | Name | Function |
|---|---|---|
| 0 | `none` | button does nothing |
| 1 | `up` | channel up (skips empty channels, wraps) |
| 2 | `down` | channel down |
| 3 | `tens` | jump to the next block of ten (23 → 30) |
| 4 | `units` | units digit up within the block (27 → 28, 29 → 20) |
| 5 | `scan` | scan on/off |
| 6 | `monitor` | monitor (squelch defeat) on/off |
| 7 | `selcall` | send selcall |
| 8 | `dial` | selcall dial mode on/off (keys then step the selcall digits) |

```sh
./fm900gen.py build channels.csv --hw 92440150 --sw 110100201000000 \
    --keys up,down,scan,monitor -o radio.bin       # same as --keys 1,2,5,6
```

* Any combination is allowed, including the same function on two keys, or `none`.
* These bytes are not covered by the radio's option checksum or tamper signature. Only the overall EPROM checksum changes, and the tool recomputes it.
* The firmware cannot say which physical button sends which code. Find out by pressing each button with known settings: e.g. with `--keys up,down,scan,monitor`, the button that steps the channel up is key `1`.
* **Not available on FM91**, where those bytes hold scan block 3.
* There is no duplex or talk-around function in the firmware (see firmware/FIRMWARE.md §6.2).

## Other commands

```sh
./fm900gen.py fromjob fm900/JOBS/SH/SH.JOB -o sh.bin    # rebuild from DOS .JOB/.CHL
./fm900gen.py writejob channels.csv --hw .. --sw .. -o MYJOB   # make .JOB/.CHL for FM900.EXE
```

Options:

* `--date YYYY-MM-DD` sets the build date stamped in the image.
* `--masters DIR` sets where the master images are read from. The default is `fm900/MASTERS`.

## Web CPS

`web/` is a browser version of `fm900gen.py`, in the style of the OpenGD77 web CPS. Nothing is uploaded: the image is built in the page, and the factory masters are built in. GitHub Actions publishes it to GitHub Pages at `https://matthyne.github.io/FPP/`.

| Tab | What it does |
|---|---|
| Radio | Job name, comments and build date. The HW and SW codes, as digits or as a menu per digit. Shows the master, band, IF and step it implies. |
| Channels | Grid of Rx, Tx (`X` = receive only), power, CTCSS, a name (kept in the project and CSV only, not in the radio), scan S1/P1/S2/P2 (plus S3/P3 on FM91), operator scan, VOTE, ECON, SELCALL and C/R. Fill a range, pick a **channel plan** (UHF CB 80- or 40-channel, with the repeater duplex channels), **import a CSV or pasted table** (see below), set a Tx offset on the selected rows, duplicate, move, renumber. Each row flags problems (off-raster, duplicate). Frequencies outside the radio's nominal band are allowed without a warning, because many radios have been re-tuned (e.g. into the amateur bands). |
| Scan & Keys | Scan block members and priority, with the 10-channel limit. FM92 head function keys (the same as `--keys`). |
| Build | Downloads the `.BIN`. Shows a summary, VCO warnings, a hex view with the bytes changed from the master highlighted, and the decoded dump. |
| Read image | Opens a `.BIN`. Enter the radio's HW code and it decodes the image into channels, which you can load into the project. |

* **Open** takes `.JOB` + `.CHL` (select both), `.csv`/`.txt`, `.json` projects and `.BIN` images. Drag and drop works too.
* **Import CSV / paste** (Channels tab, or opening a `.csv`) reads:
  * CHIRP CSV, which is also what RepeaterBook exports. Tone mode `Tone` uses rToneFreq and `TSQL` uses cToneFreq. Duplex `+`/`-`/`split`/`off` sets Tx.
  * RadioReference CSV downloads, or a frequency table copied straight from a RadioReference page (tab separated). Tones like `100.0 PL` are read; `CSQ` means none.
  * The README format, including the VOTE/ECON/SELCALL/C/R columns.
  * Any table with a header row. Columns are matched by name and can be remapped in the dialog.

  The dialog has short guides for getting a list out of RadioReference, RepeaterBook, CHIRP and spreadsheets. The preview marks rows it can't import: non-FM modes such as DMR, P25 and D-STAR, and frequencies needing more than 4 decimals. DCS codes are dropped with a note, because the FM900 only does CTCSS. CHIRP's 0-based memory numbers are shifted to start at 1.
* **Save** writes a `.json` project. **Export JOB/CHL** writes files FM900.EXE can open. **Export CSV** writes the README format, with a trailing `name` column that `fm900gen.py` ignores.
* Work is kept in the browser automatically, with undo/redo.
* Light and dark themes. The **Theme** menu in the top bar picks System (follows the OS setting), Light or Dark. The choice is remembered in the browser.

Row order matters, just as it does in FM900.EXE. It sets the scan-list order and which ring slots duplicate or VOTE channels get.

Developing:

```sh
cd web
npm install
npm run dev        # http://localhost:5173/FPP/
npm test           # golden jobs, ~3000 random cases vs fm900gen.py, BIN read-back, CSV import, channel plans
npm run build      # static site in web/dist
```

The TypeScript core (`web/src/core/fm900.ts`) is a line-by-line port of `fm900gen.py`. The tests require it to produce byte-identical images to the Python reference.

## Accuracy

The builder is a line-by-line re-implementation of FM900.EXE's image routines. It regenerates
the sample jobs 2MHAM, SH, SHC and 80CHCB **byte-for-byte**. The 477 job also matches,
except where its `.CHL` was edited after its `.BIN` was produced.

**Not supported:** FM93, the FM97WP / waterproof variants, and selcall tone programming.

## Running the original

The original runs in DOSBox: `dosbox -conf dosbox.conf`, with the mount path edited.

### Paths not covered by the sample jobs

None of the five sample jobs exercises the following, so treat them as unverified:

* VOTE rings or duplicate channel numbers (slot ring links)
* the FM92L master, and any selcall `*S` master
* the VHF 6.25 kHz step
* `L` or `S` power
* the VOTE, C/R and SELCALL flags
* receive-only (`X`) channels
* E, T, U and W2 bands

Before burning an image that uses any of these, cross-check it against the original program in DOSBox:

1. Run `./fm900gen.py writejob list.csv --hw .. --sw .. -o TEST`.
2. Copy `TEST.JOB` and `TEST.CHL` into `fm900/JOBS`.
3. In FM900.EXE, open the order as an existing job and press F10, so it writes `TEST.BIN`.
4. Run `./fm900gen.py fromjob TEST.JOB --date <that day> -o mine.bin`.
5. Run `cmp -l mine.bin fm900/JOBS/TEST.BIN`. Only bytes 0x1FE0–0x1FE4 (version and date) may differ.

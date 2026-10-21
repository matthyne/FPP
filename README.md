# Philips FM900 personality EPROM tools

This directory holds the original DOS **Philips Field Personality Programmer**:

* `FPP.EXE`, the menu launcher
* `fm900/BIN/FM900.EXE`, the actual programmer
* the factory master images (`fm900/MASTERS`)
* some saved jobs (`fm900/JOBS`)

It also holds a Linux replacement for the image-building part:

* **`fm900gen.py`**: builds the 8 KB 2764 EPROM image for FM91 and FM92 radios from a list of frequencies. It is Python 3 with no dependencies.
* **`FM900_FORMAT.md`**: full documentation of FPP.EXE, FM900.EXE, the job file formats, the hardware/software codes, and the EPROM layout.

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

## Other commands

```sh
./fm900gen.py fromjob fm900/JOBS/SH/SH.JOB -o sh.bin    # rebuild from DOS .JOB/.CHL
./fm900gen.py writejob channels.csv --hw .. --sw .. -o MYJOB   # make .JOB/.CHL for FM900.EXE
```

Options:

* `--date YYYY-MM-DD` sets the build date stamped in the image.
* `--masters DIR` sets where the master images are read from. The default is `fm900/MASTERS`.

## Accuracy

The builder is a line-by-line re-implementation of FM900.EXE's image routines. It regenerates
the sample jobs 2MHAM, SH, SHC and 80CHCB **byte-for-byte**. The 477 job also matches,
except where its `.CHL` was edited after its `.BIN` was produced.

**Not supported:** FM93, the FM97WP / waterproof variants, and selcall tone programming.

## Running the original

The original runs in DOSBox: `dosbox -conf dosbox.conf`, with the mount path edited.

### Paths not covered by the sample jobs

None of the five sample jobs exercises the following, so treat them as unverified:

* ECON or duplicate channel numbers (slot ring links)
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

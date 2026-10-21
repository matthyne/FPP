# Philips FM900 Field Personality Programmer: reverse-engineering notes

This document describes the DOS programs in this directory, the files they use, and the
layout of the 8 KB EPROM image that holds an FM91/FM92 radio's channel programming.
Everything here comes from disassembling the programs and was checked byte-for-byte
against the sample jobs in `fm900/JOBS`.

The generator built from these notes is `fm900gen.py` (see `README.md`).

---

## 1. The programs

| File | What it is |
|---|---|
| `FPP.EXE` | "PHILIPS Field Programmer Selection Menu". A generic launcher (MS C 5.1, 1988). It holds **no** radio logic. |
| `FPP.STP` | Setup file for FPP.EXE. |
| `FPP.HLP` | Help text that FPP.EXE shows on F1: 21 lines of 75 characters, plain text. |
| `PARAM.EXE` | Tiny MS C helper (2.3 KB) with no strings of interest. FPP.EXE does not call it. |
| `fm900/DESCRIPT.TXT` | Menu description that FPP.EXE displays for the `fm900` entry. |
| `fm900/BIN/FM900.EXE` | **The actual programmer** ("FM900 FPP" V2.1 build, MS C 5.x, EXEPACK-compressed, "cracked" banner). |
| `fm900/BIN/FM900.CFG` | FM900.EXE config: job directory, masters directory, programmer card I/O port (768 = 0x300), `/c`. |
| `fm900/JOBS/FM900.EXE` | A different, uncompressed build of the programmer. It is not used. |
| `fm900/MASTERS/*.BIN` | Factory master EPROM images: 68HC05 radio firmware plus default data. |
| `fm900/JOBS/<name>.JOB/.CHL/.BIN` | A saved job: order header, channel table, and generated EPROM image. |

### 1.1 How FPP.EXE works

1. **Read the setup file.** FPP.EXE opens `FPP.STP` and reads it as 16-bit words:
   * Magic `0x0056, 0x0001, 0x000C, 0x000C, 0x07C4` followed by `'P','R','C','S'`. If any value is wrong it prints "Error can't find SETUP FILE".
   * Ten screen colour/attribute words.
   * Four CR/LF-separated strings: `\DESCRIPT.TXT`, `\BIN\`, `.EXE` and `FPP.HLP`.
2. **Scan the sub-directories** of the current directory. A directory `<D>` becomes a menu entry only if both of these exist:
   * `<D>\DESCRIPT.TXT`
   * `<D>\BIN\<D>.EXE`

   The first 3 lines (up to 60 characters each) of DESCRIPT.TXT become the entry's description. If the scan fails it prints "Error while analyzing directory structure".
3. **Show the menu.** Cursor keys, PgUp/PgDn and Home/End move the selection. F1 shows FPP.HLP. ESC quits.
4. **Launch on Enter.** FPP.EXE runs `chdir(<D>)`, builds `.\BIN\<D>.EXE` from the setup strings and calls `spawnv(P_WAIT, …)`. Spawn errors are reported as "FPPmenu-F-SpwSubPrc: …". When the program returns, FPP.EXE runs `chdir("..")` and redraws the menu.

With this tree, the only entry is **FM900**, which runs `fm900\BIN\FM900.EXE` with the
current directory set to `fm900`.

### 1.2 How FM900.EXE works (user view)

* **Main menu:** Edit Order / Eprom menu / Setups / Exit.
* **Edit Order:** New, Existing, Re-use, SELCALL entry.
  1. Enter a *PIRS order*: job code (= file name), optional "sum of frequencies" check value, and comment lines.
  2. Enter the 8-digit **hardware code** and the 15-digit **software code** (§3).
  3. Enter channels one by one: Channel, Rx, Tx, Power, Scanning, CTCSS, VOTE, ECON, SELCALL, C/R.
  4. On F10 it validates everything, selects and loads the master image (§4.1), builds the image (§5), and writes `<job>.JOB`, `<job>.CHL` and `<job>.BIN` to the job directory.
* **Eprom menu:** drives the Philips ISA programmer card (port 768–799) to read, blank-check, copy, program and verify 2764/2764A EPROMs.

Linux needs only the `.BIN`. Burn it to a 2764 with any EPROM programmer (for example a TL866 with `minipro -p 2764 -w file.bin`).

---

## 2. Job files

### 2.1 `.JOB` (text, CR/LF)

```
<sum of frequencies (optional, may be empty)>
<comment line 1>
...                     (comment lines; the number varies between jobs)
<hardware code, 8 digits>      e.g. 92440150
<software code, 15 digits>     e.g. 110100201000000
```

The hardware and software codes are always the last two lines.

### 2.2 `.CHL` (binary, 120 records × 24 bytes = 2880 bytes)

| Off | Size | Field |
|---|---|---|
| 0  | u16 LE | channel number (0 = end of list) |
| 2  | char[9] | Rx MHz, `"147.0000"` (always 4 decimals), NUL-terminated |
| 11 | char[9] | Tx MHz, or `"XXXXXXXX"` for receive-only |
| 20 | u16 LE | flag word, see below |
| 22 | char[2] | CTCSS letter code + NUL (byte 23 is uninitialised junk when byte 22 = 0) |

Records appear in entry order, which may be sorted with F3. The order matters: it sets the
scan-list order and the slot allocation for duplicates.

**Flag word.** The program sets these bits from the entry screen (routine `0x3225`):

| Bit | Mask | Entry field | Meaning |
|---|---|---|---|
| 0 | 0x0001 | Power `H` | high, 25 W |
| 1 | 0x0002 | Power `M` | medium, 5 W |
| 2 | 0x0004 | Power `L` | low, 1 W |
| 3 | 0x0008 | Power `S` | operator selectable |
| 4 | 0x0010 | ECON `Y` | economiser on this channel |
| 5 | 0x0020 | SELCALL `Y` | selcall on this channel |
| 6 | 0x0040 | C/R `Y` | CTCSS community-repeater |
| 7 | 0x0080 | Scanning contains `1` | member of scan block 1 |
| 8 | 0x0100 | Scanning contains `2` | member of scan block 2 |
| 9 | 0x0200 | Scanning contains `3` | member of scan block 3 (FM91 only) |
| 10 | 0x0400 | Scanning `1P` | priority channel of block 1 |
| 11 | 0x0800 | Scanning `2P` | priority channel of block 2 |
| 12 | 0x1000 | Scanning `3P` | priority channel of block 3 |
| 13 | 0x2000 | Scanning contains `S` | operator-selectable scan |
| 14 | 0x4000 | VOTE `Y` | voting |
| 15 | 0x8000 | – | never read; appears as junk in some files |

**CTCSS codes:** letter → (radio code, Hz)

```
Q 17  67.0   R 18  71.9   S 19  74.4   T 20  77.0   U 21  79.7   I  9  82.5
V 22  85.4   A  1  88.5   W 23  91.5   J 10  94.8   = 38  97.4   B  2 100.0
K 11 103.5   C  3 107.2   L 12 110.9   D  4 114.8   M 13 118.8   E  5 123.0
N 14 127.3   F  6 131.8   O 15 136.5   G  7 141.3   P 16 146.2   H  8 151.4
X 24 156.7   Y 25 162.2   0 26 167.9   1 27 173.8   2 28 180.2   3 29 186.2
4 30 192.8   5 31 203.5   6 32 210.7   7 33 218.1   8 34 225.7   9 35 233.6
* 36 241.8   # 37 250.3
```

---

## 3. Hardware and software codes

### 3.1 Hardware code (8 digits `h0`–`h7`)

| Digit | Meaning |
|---|---|
| h0 | 9 = mobile |
| h1 | **model**: 1 = FM91, 2 = FM92, 3 = FM93, 7 = "92 with 91 PCBs" |
| h2 | **band**: 2 = E 66–88 MHz, 3 = B 132–153, 4 = A 148–174, 5 = T 403–440, 6 = U 440–470, 7 = W1 470–500, 8 = W2 500–520 |
| h3 | **control/spacing**: 3 = local 25 kHz, 4 = remote 25 kHz, 7 = local 12.5 kHz, 8 = remote 12.5 kHz |
| h4 | mechanics: 0 standard, 1 ext. temp 5 ppm, 2 waterproof, 3 WP + ext. temp, 5 TCXO, 7 WP TCXO |
| h5 | signalling hardware: 0 none, 1 CTCSS enc, 2 CTCSS enc/dec, 3–5 Selcall type 1 (+CTCSS), 6–8 Selcall type 2 |
| h6 | selcall: 0 none, 1 CCIR, 2 ZVEI, 3 EEA, 4 EIA, 5 none + I/O kit, 6–9 = 1–4 with encode type 2 |
| h7 | option: 0 standard, 1 reverse tone burst, 3 dual front end, 4 ignition noise blanker |

### 3.2 Software code (15 digits `s0`–`s14`)

| Digit | Meaning |
|---|---|
| s0 | display: 0 intermittent, 1 continuous, 2 intermittent + 8 h timer, 3 continuous + 8 h timer |
| s1 | mute: 0 fixed with defeat, 1 variable with defeat, 2 fixed no defeat, 3 variable no defeat |
| s2 | economiser: 0 none, 1 all channels, 2 operator selectable, 3 per channel |
| s3 | Tx timer: 0 none, 1 = 1 min, 2 = 3 min, 3 = 5 min, 4 = 10 min |
| s4 | Tx inhibit: 0 none, 1 on all channels |
| s5 | Tx power: 0 25 W, 1 5 W, 2 1 W, 3 operator selectable, 4 per channel, 6 5–25 W, 7 1–25 W adjustable |
| s6 | scanning: 0 none, 1 vacant, 2 occupied, 3 occupied + operator selectable |
| s7 | voting: 0/1 |
| s8 | CTCSS: 0 none, 1 per channel, 2 via keypad, 3 per channel + RTB, 4 keypad + RTB, 5 community repeater per channel, 6 keypad + CR, 7 CR per channel + RTB |
| s9 | tone period: 0 none, 1 100 ms, 2 40 ms, 3 70 ms, 4 20 ms, 5 33 ms |
| s10 | 0 simplex (1 and 2 select further options) |
| s11–s12 | selcall encode format code (2 digits) |
| s13–s14 | selcall decode format code (2 digits) |

---

## 4. EPROM image (2764, 8192 bytes)

| Range | Contents |
|---|---|
| `0x0000–0x0022` | `"COPYRIGHT (C) 1982, PHILIPS T.M.C."` |
| `0x0100–~0x1AFF` | 68HC05 radio firmware, copied unchanged from the master |
| `0x1B40–0x1F07` | **FM91** channel table: 120 slots × 8 bytes; channel *n* is at `0x1B40 + 8(n−1)` |
| `0x1BE8–0x1EFF` | **FM92** channel table: 99 slots × 8 bytes; channel *n* is at `0x1BE8 + 8(n−1)` |
| `0x1F00–0x1FFF` | configuration block (§4.3) |

Empty slots are all `00`.

### 4.1 Master selection (routine `0x8196`)

The master depends on the hardware code. "S" means the selcall variant, chosen when h5 = 3, 4 or 5.

| Hardware code | Master |
|---|---|
| h1 = 1 | `FM91[S].BIN` |
| h1 = 2, h3 odd (local control) | `FM92L[S].BIN` |
| h1 = 2, h3 even (remote control) | `FM92R[S].BIN` |
| h1 = 3 | `FM93[S].BIN` |
| h1 = 7, or waterproof h4 = 2/3/7 | `FM97WP[S].BIN` |

The program checks each master's version byte at `0x1FE5` and its ID string at `0x1FEB`:

| Master | 0x1FE5 | ID |
|---|---|---|
| FM91 | 1 | `0020:` |
| FM91S | 10 | `01045` |
| FM92L | 4 | `0028:` |
| FM92LS | 11 | `01065` |
| FM92R | 5 | `0029:` |
| FM92RS | 12 | `01055` |
| FM93 | 14 | `03861` |
| FM93S | 13 | `03851` |
| FM97WP | 5 | `03700` |
| FM97WPS | 12 | `03710` |

After loading any master except FM92L, the selcall tone area is reset (routine `0x123EA`):

| Range | Value |
|---|---|
| `0x1F67` | `00` |
| `0x1F68–70` | `0F` × 9 |
| `0x1F71–79` | `00` × 9 |
| `0x1F7A` | `00` |
| `0x1F7B–83` | `0F` × 9 |
| `0x1F84–8C` | `00` × 9 |
| `0x1F8D–A7` | `0F` × 27 |

### 4.2 Channel slot (8 bytes)

Encoded by routines `0x60C9` (power), `0x5A5D` (frequencies) and `0x6226` (options), in that order.

```
byte 0  Rx divider digits d1|d0   (each nibble = 15 - decimal digit)
byte 1  Rx divider digits d3|d2
byte 2  b7=1 (Rx valid)  b6=LO-side flag  b5=ECON  b4=VOTE  b3=see below  b2..0 = ~d4
byte 3  Tx divider digits d1|d0
byte 4  Tx divider digits d3|d2
byte 5  b7=Tx enabled  b6=inverse of byte2.b6  b5..4=power  b3=1  b2..0 = ~d4
byte 6  b7=C/R  b6=operator-selectable-scan  b5..0 = CTCSS code (0 = none)
byte 7  b7 = bit 1 of the selcall-encode table word
        b6..0 = duplicate/ECON link (slot index), otherwise:
        b2 = SELCALL per channel, b1 = economiser operator-selectable (s2 = 2)
```

**Frequency dividers** (routine `0xAE7E`)

The program works in 10 Hz units:

```
F = Rx or Tx in units of 10 Hz            (147.0000 MHz -> 14 700 000)
F_rx += IF                                (receive only)
N = F / step                              (integer division)
digits = last 5 decimal digits of N; stored nibble-wise as (~digit & 0xF),
d4 keeps only 3 bits.
```

**IF offset** (routine `0x4723`)

| h3 (control/spacing) | IF |
|---|---|
| 3, 4, 7, 8 | 21.4 MHz |
| 1, 2, 5, 6 | 10.7 MHz |

The sign depends on h2 (band):

| Band | LO side | IF sign |
|---|---|---|
| E, B, T, U | high-side | + |
| A, W1, W2 | low-side | − |

**Synthesiser step** (routines `0x4A35` and `0x4C99`)

* VHF (h2 ≤ 4): 5 kHz for 25 kHz spacing, 6.25 kHz for 12.5 kHz spacing. If any Rx or Tx frequency is off that raster, the other step is used instead.
* UHF: 25 kHz for 25 kHz spacing, 12.5 kHz for 12.5 kHz spacing.

**Flag bits**

* **byte2.b6 / byte5.b6:** For VHF, a negative IF clears byte2.b6 and sets byte5.b6; a positive IF does the opposite. UHF uses the reverse rule.
* **byte2.b3 (VHF):** VCO band-switch bit (routine `0x5FE7`). It is set if Rx lies within −40 kHz…+30 kHz of a whole MHz (−30…+15 kHz on E band). The comparison is done in x87 80-bit precision, so a frequency exactly 30 kHz above a whole MHz gives 0.
* **byte2.b3 (UHF):** set when the power bits are 0 or 1 (low power or selectable).

**Power bits** (byte5 b5..4)

| Power | Value |
|---|---|
| H | 3 |
| M | 2 |
| L | 1 |
| S | 0 |

FM92 VHF exception: L is stored as 2.

**Duplicates / ECON** (routine `0x5927`)

* The first record for channel *n* uses slot *n−1*.
* If that slot is already taken, or the channel has ECON set, the program allocates a free slot from the top of the table downward (FM92 from slot 98, FM91 from 119).
* The slots are chained in a ring through byte7 b6..0.

### 4.3 Configuration block `0x1F00–0x1FFF` (routines `0x6452`, `0x6688`, `0x7182`, `0x7285`, `0x77F7`)

| Address | Contents |
|---|---|
| `0x1F00–07`, `0x1F10–2F` | master constants; never written |
| `0x1F08–0F` | power-amplifier set points. Default `00 82 00 15 09 32 1A 82`. s5 = 6 changes them to `00 82 09 82 09 32 09 82`. FM92 VHF then overrides them from the lowest and highest power used: e.g. 25 W only gives `00 00 1A 82 00 00 1A 82`; 1 W present gives `00 15` at 08/09 and 0C/0D; 5 W gives `09 32`. |
| `0x1F30` | master constant (`02`) |
| `0x1F31` | lowest channel number used |
| `0x1F32` | master constant |
| `0x1F33` | b0 s10≥1, b1 s0∈{0,2}, b2 s4=1, b3 s3≥1, b4 0, b5 s5=3, b6 bit 2 of the encode-table word, b7 s6=3 |
| `0x1F34` | b0 s8∈1..7, b1 s8∈{3,4,7}, b2 h5∈{2,5,8}, b3 s8∈{2,4,6}, b4 s6∈1..4, b5 h7∈{3,6}, b6 decode code ≥ 50, b7 s6∈2..4 |
| `0x1F35` | b0 1, b1 s7=1, b2 0, b3 s2∈1..3, b4 s1∈{0,2}, b5 s0∈{2,3}, b6 s10=2, b7 1 |
| `0x1F36` | `decTab[dec].a OR encTab[enc].a` (tables in FM900.EXE, embedded in fm900gen.py) |
| `0x1F37` | `decTab[dec].b OR encTab[enc].b`, then b4 = 1 for FM91 or s1 < 2, otherwise 0 |
| `0x1F38` | Tx timer: s3 = 1 → `07`, 2 → `13`, 3 → `1F`, 4 → `3D`, otherwise `00` |
| `0x1F39–3D` | master constants |
| `0x1F3E` | highest channel number used |
| `0x1F3F` | lowest channel number used |
| `0x1F40` | priority channel of scan block 1 (`1P`) |
| `0x1F41–4A` | scan block 1 channel numbers (max 10, in entry order) |
| `0x1F4B` | count of scan block 1 |
| `0x1F4C` | priority channel of scan block 2 |
| `0x1F4D–56` | scan block 2 list |
| `0x1F57` | count of scan block 2 |
| `0x1F58` | FM91: priority channel of scan block 3. FM92: always `01` |
| `0x1F59` | FM91: start of scan block 3 list (`0x1F59–62`). FM92: always `02` |
| `0x1F5A` | FM92 only: `05` if s6 > 0; `06` if s6 = 0 and s1 = 1; `08` if 0x1F37.b6 is set and a selcall code is set |
| `0x1F5B` | FM92 only: `07` if s11–s14 ≠ 0000, otherwise `00` |
| `0x1F63` | FM91: count of scan block 3 |
| `0x1F64` | image checksum: `0xFF − (sum of all 8192 bytes with this byte = 0) mod 256` |
| `0x1F65` | firmware signature: `−(((((((b[1CC]−b[5CC])^b[9CC])+b[DCC]+b[11CC])−b[15CC])^b[19CC])+b[1ACC]) mod 256` (16-bit arithmetic) |
| `0x1F66` | `−(0x1F33+0x1F34+0x1F35+0x1F36+0x1F37) mod 256` |
| `0x1F67–A7` | selcall tone memory (§4.1); the selcall editor fills it in |
| `0x1FE0–E1` | programmer version, `21 12` for this build (another build wrote `22 12`) |
| `0x1FE2–E4` | build date, BCD: DD MM YY |
| `0x1FE5`, `0x1FEB–EF` | master version and ID (§4.1) |
| `0x1FF0–FF` | 68HC05 vectors |

Build order: load master → selcall reset → channel slots → date → 1F32..37/1F66 →
1F38/3E/3F → scan lists → 1F08..0F/1F31/1F58..5B → 1FE0/E1 → checksums (1F65, then 1F64).

---

## 5. Verification

`fm900gen.py fromjob` regenerated these sample images from their `.JOB` and `.CHL`. The
date was set to the one stamped in each `.BIN`.

| Job | Model / band | Result |
|---|---|---|
| 2MHAM | FM92R A-band | identical |
| SH | FM92R B-band, 75 ch, scan blocks | identical |
| SHC | FM92R B-band, + CTCSS | identical |
| 80CHCB | FM91 W1-band, 12.5 kHz | identical |
| 477 | FM92R W1-band (first 20 ch) | identical once channel 11's later-added scan flag is removed |

The 477 `.CHL` was edited after its `.BIN` was made: it now holds 48 channels, and channel 11
carries a scan flag the `.BIN` does not have. With that flag cleared, all 8192 bytes match. The `.BIN` was also stamped by a different
programmer version (`22 12`).

**Not implemented:** FM93, FM97WP/waterproof and "92 with 91 PCBs" builds, and the selcall
tone editor. The routines are identified (`0x5CB4`, `0x61ED`, `0x6625`, `0x6C78`; selcall
module around `0x113F9`), but there were no samples to test against.

## 6. Disassembly method

* `BIN/FM900.EXE` is EXEPACK-compressed. It was unpacked with a small Python unpacker (stub at CS = `0x29B1`; real entry `1963:0014`; DGROUP `0x230F`; 3148 relocations).
* MS C floating-point emulator calls (`INT 34h`–`3Dh`) were converted back to x87 opcodes.
* The code was disassembled with Capstone.
* All addresses in this document are linear offsets in the unpacked load image.

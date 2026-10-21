# FM92 radio firmware (FM92R / FM92L masters)

This document describes the 68HC05-family firmware in the master EPROM images
`fm900/MASTERS/FM92R.BIN` and `FM92L.BIN`, and how that firmware uses the channel and
configuration data that FM900.EXE (and `fm900gen.py`) writes into the top of the EPROM.

It was recovered by disassembly. There is no schematic, so where this document names a
hardware function from how the code uses a pin, it says **(inferred)**.

Annotated listings:

* `FM92R.lst` (2381 instructions)
* `FM92L.lst` (2265 instructions)

To regenerate them, run `tools/mklist.py` (needs Python 3 and `capstone`).

---

## 1. FM92L vs FM92R: the actual difference

The hardware-code digit 4 picks the master:

| Digit 4 | Meaning | Master |
|---|---|---|
| 3 | local control, 25 kHz | FM92L |
| 7 | local control, 12.5 kHz | FM92L |
| 4 | remote control, 25 kHz | FM92R |
| 8 | remote control, 12.5 kHz | FM92R |

The two firmwares share about 1,700 instructions of identical logic: synthesiser, squelch,
CTCSS, selcall, scanning, voting, timers and supervision. They differ only in how they talk
to the operator.

| | **FM92L** (local control) | **FM92R** (remote control) |
|---|---|---|
| Controls | Keys on the radio front panel, read directly on port A by `keypad_scan` (0x088D). Debounce and auto-repeat times come from 0x1F10–0x1F12. | Separate control head (e.g. CU91R) connected by a single-wire serial link. |
| Display | 2-digit channel display driven directly: BCD digits on port A, latched with PB0 and PB1 (`display_digits_local`, 0x0B2E). | The radio sends display characters to the head over the link (`display_digits`, 0x0C24). |
| Indicators | LED latch on port A and PB7 (`led_latch_task`, 0x0401). Blink rate from 0x1F13. | The head draws them, from status messages. |
| Serial link | none | 1200 baud software UART on PB0, half-duplex single wire, 11-bit frames, 4-byte transmit FIFO (`uart_bit`, 0x08D8). Bytes 0x1F10–0x1F12 are sent to the head at start-up (`send_head_config`, 0x0508). |
| Head commands | – | `head_key_dispatch` (0x0574) decodes key and command bytes from the head (§6.2). Command 0x4A dumps RAM to the head (service diagnostic). |
| Odd timer ticks | keypad scan | UART bit timing |
| Master ID | `0028:`, version byte 0x1FE5 = 4 | `0029:`, version byte 0x1FE5 = 5 |

So the channel table and configuration layout are **the same** for both. FM900.EXE writes
identical data. Only the 0x1F10–0x1F13 constants (factory values from the master) are used
differently.

---

## 2. Processor and memory map

The CPU is a CMOS 6805 with an external multiplexed bus and 13-bit address space. It uses
`STOP`/`WAIT`, and its vectors sit at 0x1FF6–0x1FFF. This matches an **MC146805E2-class**
part (inferred).

| Address | Use |
|---|---|
| `$00` | Port A data: 8-bit data bus to the external latches and synthesiser. PA6 and PA7 are inputs. |
| `$01` | Port B data: strobes and control (§3). |
| `$04` / `$05` | DDRA = `$3F`, DDRB = `$FE` |
| `$08` / `$09` | Timer data / timer control |
| `$10–$68` | On-chip RAM: flags, current channel, soft timers, ADC results |
| `$21–$24` | Small self-modifying RAM routine (`LDA $hhll,X ; RTS` or `ADD …`), used to index the channel table and scan lists in EPROM |
| `$80–$86` | External peripherals: `$80` selcall tone encoder/decoder, `$81` CTCSS tone generator, `$82` output latch, `$84–$86` tone-chip set-up |
| `$A0–$EC` | External RAM: selcall buffers and flags, additional soft timers |
| `$0100–$1AFF` | Firmware |
| `$1BE8–$1EFF` | Channel table: 99 × 8 bytes (FM900_FORMAT.md §4.2) |
| `$1F00–$1FEF` | Configuration block |
| `$1FF0–$1FFF` | Vectors |

The first 256 bytes of the EPROM are hidden behind on-chip I/O and RAM. They hold only the
copyright string, plus one balancing byte (`$AC` at 0x0023) that makes them sum to 0 mod 256.

### Vectors

| Vector | FM92R | FM92L | Meaning |
|---|---|---|---|
| 0x1FFE reset | 0x0100 | 0x0100 | `RESET` |
| 0x1FFC SWI | 0x0100 | 0x0100 | |
| 0x1FFA IRQ | 0x0BB1 | 0x0AF5 | ADC comparator (§5) |
| 0x1FF8 timer | 0x036F | 0x034C | 2.4 kHz system tick |
| 0x1FF6 / 0x1FF4 / 0x1FF2 | 0x036F | 0x034C | |

## 3. Hardware interface (port usage)

Each external latch is loaded by putting a byte on port A and pulsing a port-B strobe.

| Pin / latch | Use |
|---|---|
| PB2 strobe → latch **`$2A`** | ADC multiplexer select (bits 0–2), plus misc. outputs |
| PB3 strobe → latch **`$29`** | Audio and mute control; bit 1 = receiver injection side (from slot byte2/5 bit 6) (inferred) |
| PB4 strobe → latch **`$2C`** (written inverted) | Transmitter power Hi/Lo (bit 4); VCO band switch (bit 5, from slot byte2 bit 3); others |
| PB5 | Synthesiser data strobe |
| PB6 | Synthesiser enable (active low) |
| PB0 | FM92R: serial link to the control head. FM92L: display low-digit strobe. |
| PB1 | FM92R: 1.2 kHz square wave toggled every tick (inferred: clock or charge pump). FM92L: display high-digit strobe. |
| PB7 | FM92L: indicator LED latch strobe |
| PA5 | On/off switch sense at reset (inferred) |
| PA6 | PTT input (inferred) |
| PA7 | Second front-panel input: hookswitch or monitor (inferred) |
| PA4 | Briefly turned into an input to sense a line (main loop). Also toggled as an alarm when the supply is too low. |
| IRQ pin | ADC comparator |

### 3.1 Synthesiser loading (`load_synth`, 0x0842)

`chan_ptr` (0x08C7) computes `ptr = 0x1BE0 + 8 × channel`, so channel 1 is at 0x1BE8.

1. Check that byte 2 (Rx) or byte 5 (Tx) has bit 7 set. If not, the channel is empty and the routine returns with carry set.
2. Put byte 0x1F2D on port A, pull PB6 low, and give two PB5 strobes.
3. Send the two divider bytes as four nibbles, low nibble first, one PB5 strobe each. These are the one's-complemented BCD digits FM900.EXE wrote.
4. Send the fifth digit: byte2 or byte5, OR'd with `$08`.
5. Send the reference/mode bytes 0x1F2C and 0x1F2D.
6. Release PB6.

The receiver is loaded with slot bytes 0–2 and the transmitter with bytes 3–5. That is why
FM900.EXE folds the IF offset into the Rx divider. This 4-bit, strobed, BCD-loaded interface
matches the Philips HEF4750/HEF4751 synthesiser family (inferred).

## 4. Interrupt-driven scheduler

The timer is reloaded every interrupt with TDR = `$C5`, TCR = `$09`. The tick counter is
`$28`. The tick period works out at about 415 µs (≈ 2.4 kHz). I calibrated this from the
Tx-timer constants:

* FM900.EXE writes 7, 19, 31 or 61 for 1, 3, 5 or 10 minutes.
* The firmware counts that value in units of 24,064 ticks.
* So one unit is 10 s.

At about 1200 baud, the serial-link rate is consistent with this.

* **Odd ticks:** FM92R clocks one UART bit. FM92L scans the keypad.
* **Even ticks:** the ISR runs one entry of a 16-slot table (`tick_slot_table`, 0x038D), so each slot runs every 32 ticks (~13 ms).

| Slot | Routine | Job |
|---|---|---|
| 1 | `adc_start_2` | ADC channel 2 → `$46` (RSSI) |
| 3, 11 | `adc_start_1` | ADC channel 1 → `$45` (squelch noise) |
| 5, 13 | `squelch_task` | squelch decision |
| 6 | `adc_start_3to6` | ADC channels 3–6 in rotation → `$47–$4A` |
| 8 | `soft_timers` | decrement software timers |
| 9 | `supervision_task` | firmware signature, PA windows, RAM check |
| 10 | `write_latch_PB4` | refresh latch `$2C` |
| others | – | idle |

### 4.1 Software timers (`soft_timers`, 0x0AE9)

| Timers | Rate |
|---|---|
| `$57–$61`, `$E9`, `$EA` | every 64 ticks (~27 ms) |
| `$63–$65`, `$EB`, `$EC` | every 2,304 ticks (~1 s) |
| `$67` | every 24,064 ticks (~10 s): Tx timer and auto power-off |

## 5. Analog measurements

The ADC is a single-slope type built from a multiplexer, the timer and a comparator on the IRQ pin:

1. `adc_start_*` selects a multiplexer channel through latch `$2A` and records the timer value.
2. When the comparator trips, the IRQ handler (0x0BB1) stores `start − now − $1E` into `$45 + channel`.

| RAM | Signal (inferred from use) | Used for |
|---|---|---|
| `$45` | receiver noise | Squelch: open when below threshold 0x1F14+s, close when above 0x1F1C+s |
| `$46` | RSSI | Voting (§7.5), threshold 0x1F1B |
| `$47` | – | window 0x1F06/0x1F07 |
| `$48` | – | window 0x1F00/0x1F01; economiser forces it to 0x1F00+1 |
| `$49` | squelch control | 8 squelch settings via table 0x0A4C (with hysteresis) |
| `$4A` | supply / forward power | In Rx, < `$15` shuts the radio down with an alarm (low supply). In Tx, must lie within the 0x1F08–0x1F0F window for the selected power level, otherwise PA fault flag `$10.7`. |

## 6. Program flow

### 6.1 Reset and power control

1. `RESET` initialises the ports and waits.
2. `$20` holds the power state: `$11` = off (stopped), `$99` = running. PA5 decides between switching on and going back to `STOP`.
3. **Cold start** (`cold_start`, 0x015C) happens when the RAM copy no longer matches the EPROM:
   * clear RAM;
   * copy 0x1F2E–0x1F31 to `$2B–$2E`. `$2E` is the current channel, initially the lowest channel (0x1F31);
   * copy the option bytes 0x1F33–0x1F37 to `$2F–$33`.
4. **Warm start** (`warm_start`, 0x01FE):
   * `eprom_checksum` sums 0x0100–0x1FFF; the result must be `$FF`. Otherwise it resets, so a corrupt EPROM never runs. This is the 0x1F64 byte FM900.EXE computes.
   * Initialise the timer and peripherals, enable interrupts, wait about 10 ms.
   * Announce start-up to the head (FM92R), select the channel, and enter the main loop.
5. `power_down_stop` (0x0189) shuts off the outputs and executes `STOP`.

The following all end up there:

* the on/off switch
* the 8-hour timer (§7.7)
* low supply
* a head power-off command
* a failed signature check (§8)

### 6.2 Main loop (`main_loop`, 0x02A2 and 0x0D58)

The main loop polls event flags and calls handlers:

* key and command dispatch
* PTT (`ptt_handler` → `tx_start` / `tx_stop`)
* Tx timer
* display update
* scanning
* voting
* economiser
* selcall encoder and decoder
* CTCSS
* auto power-off

**Keys and programmable function keys.** The firmware recognises four function keys:

* FM92R: the head sends key codes `'1' '2' '4' '7'`.
* FM92L: front-panel key bits 1, 2, 8 and 4.

Key *n* runs the function whose number is stored in **0x1F58 + n**:

| Code in 0x1F58–0x1F5B | Function |
|---|---|
| 0 | none |
| 1 | channel up (wraps at 0x1F3E → 0x1F3F) |
| 2 | channel down |
| 3 | channel tens digit |
| 4 | channel units digit |
| 5 | scan on/off |
| 6 | monitor / mute defeat |
| 7 | send selcall |
| 8 | selcall mode toggle |

**Remapping.** These four bytes are outside the option checksum (0x1F66) and the firmware
signature (0x1F65). They can be set to any code 0–8 in any combination with
`fm900gen.py --keys` (see README). Only the overall EPROM checksum changes.

There is **no duplex / talk-around / reverse function**. Tx always comes from the channel's
own Tx divider. The software-code digit s10 (option byte 0x1F33 bit 0) only makes the radio
skip reloading the synthesiser for transmit, which suits a separate-transmitter variant.
Switching a repeater offset on and off would need either paired channels or a firmware
patch that adds a function 9.

FM900.EXE always writes `01 02` to the first two keys (channel up/down). The third key gets
5 (scan) if scanning is enabled (s6 > 0), or 6 (monitor) if variable mute is chosen; it gets 8
if selcall is set up. The fourth key gets 7 if a selcall code is set.

**Head commands (FM92R).** Bytes `$44–$4A` from the head:

| Bytes | Meaning |
|---|---|
| `$44` / `$45` | head PTT release / press (inferred) |
| `$46` / `$47` | hook / monitor release / press (inferred) |
| `$49` | power-off request |
| `$4A` | RAM dump |

**Messages to the head (FM92R)** go through `head_send`:

| Bytes | Meaning |
|---|---|
| `$80`/`$81` + character, `$82`/`$83` + character | the two display digits |
| `$A0` | channel changed |
| `$AA` | start-up |
| `$E7` + 3 bytes | head configuration, from 0x1F10–0x1F12 |
| others | status codes: `$A2–$A7`, `$C0`/`$C1`, `$E4`/`$E5`, `$EC` |

## 7. How the firmware uses the channel slot

FM900_FORMAT.md §4.2 gives the byte layout. On a channel change, `select_channel`
(0x07ED) does the following:

* **Bytes 0–2 (Rx divider):** loaded into the receive synthesiser.
* **Byte 2 bit 7:** channel valid. Empty channels are skipped by up/down and by scanning.
* **Byte 2 bit 6:** injection side, sent to latch `$29` bit 1.
* **Byte 2 bit 5 (VOTE):** handled by `chan_flags_rx`. When clear, the channel is remembered as the "home" channel (`$50`/`$52`) that scanning and voting return to.
* **Byte 2 bit 4 (C/R):** community-repeater handling of the CTCSS decoder.
* **Byte 2 bit 3:** VCO band switch, sent to latch `$2C` bit 5.
* **Bytes 3–5 (Tx divider):** loaded into the synthesiser when transmitting.
* **Byte 5 bit 7 clear:** receive-only channel.
* **Byte 5 bits 4–5:** power, `$30` = high, `$20` = medium, `$10` = low, `$00` = use the operator's choice. Only bit 4 reaches the PA switch (latch `$2C` bit 4). The bits also select which 0x1F08–0x1F0F window supervises the PA. This is why FM900.EXE stores 1 W as `$20` on FM92 VHF radios: those have only two power stages.
* **Byte 5 bit 3:** sent inverted to latch `$82` bit 5.
* **Byte 6 bits 0–5:** CTCSS code. It is translated through the table at 0x0E56 to a tone-chip value, written to `$81` with bit 6 set (`set_ctcss_tone`). Code 0 means no tone.
* **Byte 6 bit 7 (SELCALL):** selcall enabled on this channel.
* **Byte 6 bit 6:** operator-selectable scan member.
* **Byte 7 bits 0–6:** link to the next slot in a VOTE ring.
* **Byte 7 bits 1 and 2:** economiser flags.

### 7.1 Squelch (`squelch_task`)

1. The squelch control `$49` maps to a setting s = 0–7, with hysteresis (table 0x0A4C).
2. The mute opens when noise `$45` < 0x1F14+s.
3. It closes when noise exceeds 0x1F1C+s. A tail time is taken from 0x1F24+…, which depends on how fast the noise is rising.
4. Fixed-mute radios (option byte 0x1F35 bit 4) skip the user setting.

### 7.2 CTCSS

* The encoder tone is set per channel from byte 6.
* Decode is enabled by option byte 0x1F34 bit 2 (hardware digit h5 ∈ {2, 5, 8}).
* With decode, the receiver mute stays closed until the tone is detected.
* Reverse tone burst (0x1F34 bit 1) cuts the tone briefly at the end of transmission.

### 7.3 Scanning (`scan_task`, `fn_scan`)

* There are two scan blocks.
  * Block 1: priority channel 0x1F40, list 0x1F41–0x1F4A, count 0x1F4B.
  * Block 2: priority channel 0x1F4C, list 0x1F4D–0x1F56, count 0x1F57.
* They are read through the pointer table at 0x1077.
* Scanning stops on a busy channel: squelch open, plus the CTCSS match if required.
* Option byte 0x1F34 bit 7 selects occupied versus vacant scanning.
* The priority channel is revisited periodically.

### 7.4 Transmit

1. PTT starts `tx_start` (0x06BC).
2. The transmission is refused if Tx inhibit is set (0x1F33 bit 2), or if busy-channel lockout applies.
3. Otherwise the Tx divider is loaded, power and latch bits are set, the tone is enabled, and the Tx timer starts (`tx_timer_start`: 0x1F38 → `$67`, in 10 s units, if 0x1F33 bit 3).
4. When the timer expires, `tx_timer_expired` drops the transmitter.

### 7.5 Voting (`vote_task`, 0x108E)

* Enabled by option byte 0x1F35 bit 1.
* The radio hops round the ring of slots linked through byte 7. It measures RSSI (`$46`) on each, dwelling for 0x1FB4.
* It settles on the best channel, comparing against threshold 0x1F1B.

FM900.EXE builds these rings when several records share a channel number with VOTE set.

### 7.6 Economiser (`econ_task`, `econ_setup`)

* Enabled by option byte 0x1F35 bit 3, with per-channel flags in byte 7.
* In standby the receiver is power-cycled.
* The on and off times come from 0x1FB1, 0x1FB2 and 0x1FB3.

### 7.7 Display timeout and 8-hour timer

* **Display timeout:** the display blanks after 0x1F3B seconds if the intermittent-display option is set (0x1F33 bit 1).
* **8-hour timer:** if option byte 0x1F35 bit 5 is set (display option s0 = 2 or 3), `auto_power_off_task` turns the radio off after 0x1FB5 × 30 min without activity. 0x1FB5 = `$10`, so 8 h.

### 7.8 Selcall (`selcall_encode_task`, `selcall_decode_task`)

* The tone chip at `$80` is set up with `$84`–`$86`.
* The transmit code digits come from 0x1F67–0x1F70 and 0x1F7A–0x1F83 (copied into external RAM `$CA`/`$D4`).
* Digit timing comes from 0x1F70, 0x1F71 and 0x1F84.
* Received digits are compared with the stored codes at 0x1F8D, 0x1F96 and 0x1F9F: individual, group and alarm (inferred).
* Behaviour is controlled by option bytes 0x1F36 and 0x1F37, which FM900.EXE derives from the selcall format codes.
* Other timing constants: 0x1FA9 → `$C8`, 0x1FAA, 0x1FAB and 0x1FAC.

## 8. Integrity and tamper checks

| Check | When | Rule | On failure |
|---|---|---|---|
| EPROM sum (0x1F64) | power-up | sum of 0x0100–0x1FFF = `$FF` | endless reset loop |
| Firmware signature (0x1F65) | continuously, slot 9 | `((((((b[1CC]−b[5CC])^b[9CC])+b[DCC]+b[11CC])−b[15CC])^b[19CC])+b[1ACC]+[1F65]) = 0` | radio stops (`STOP`) |
| Option checksum (0x1F66) | continuously | sum of 0x1F33–0x1F37 + 0x1F66 = 0 | radio stops |
| RAM copy | continuously | `$68` = 0x1F32, and RAM `$2B`/`$2F–$33` = EPROM | cold restart |

The signature ties the option bytes to a particular firmware build. That is why FM900.EXE
recomputes 0x1F65 and 0x1F66 every time. Any hand-edited image must have all three bytes
fixed up; `fm900gen.py`'s `checksum()` does this.

## 9. Configuration block: firmware view

The factory constants come from the master; FM900.EXE does not change them unless noted.

| Address | Read by | Meaning |
|---|---|---|
| 1F00–01 | `check_window` | window for ADC `$48` |
| 1F02–07 | | further windows (1F06/07 for `$47`) |
| 1F08–0F | `check_power_window` | PA supervision window (min, max) for each power level. Set by FM900.EXE from the powers used. |
| 1F10–12 | R: sent to head. L: keypad timing. | factory |
| 1F13 | L: LED blink rate | factory |
| 1F14–1B | squelch | open threshold for settings 0–7 (1F1B also = vote threshold) |
| 1F1C–23 | squelch | close threshold for settings 0–7 |
| 1F24–2B | squelch | tail times |
| 1F2C–2D | `load_synth` | synthesiser reference/mode bytes |
| 1F2E | start-up | RAM validity signature → `$2B` |
| 1F2F | start-up | initial latch `$2C` |
| 1F30 | start-up | initial `$2D` (squelch setting / flags) |
| 1F31 | start-up | first channel shown (FM900: lowest channel) |
| 1F32 | supervision | copied to `$68` and re-checked |
| 1F33–37 | start-up → `$2F–$33` | feature option bits (FM900_FORMAT.md §4.3) |
| 1F38 | Tx timer | time-out in 10 s units + 1 |
| 1F3B | display | display timeout (s) |
| 1F3E / 1F3F | channel up/down | highest / lowest channel |
| 1F40–57 | scanning | scan blocks 1 and 2 |
| 1F58–5B | key dispatch | programmable function keys 1–4 |
| 1F64 | power-up check | EPROM checksum |
| 1F65 | supervision | firmware signature |
| 1F66 | supervision | option checksum |
| 1F67–A7 | selcall | tone memory |
| 1FA9–B5 | timers | selcall, economiser, vote dwell, 8-hour timer (1FB5) |
| 1FE0–EF | – | version, build date, master ID (not used by the code) |

Factory values in both FM92 masters (0x1F00–0x1F2F):

```
1F00: 25 4B 1B 82 00 38 0D 68 00 82 00 15 09 32 1A 82
1F10: 02 60 06 EB 57 2A 23 1C 17 13 10 0E 57 31 31 31   (FM92R)
1F10: 03 23 0A 0A 57 2A 23 1C 17 13 10 0E 57 31 31 31   (FM92L)
1F20: 31 31 31 31 01 0A 14 1E 28 32 3C 46 0F 05 5A F4
```

## 10. Reproducing the listings

```sh
pip install capstone
python3 tools/mklist.py FM92R     # reads ../fm900/MASTERS/FM92R.BIN, FM92R.ann
python3 tools/mklist.py FM92L
```

* `tools/d6805.py` is a recursive-descent 6805 disassembler that also follows `JMP table,X` jump tables.
* The `.ann` files hold routine names (`=addr name`) and per-address comments.
* The FM92L names were transferred from FM92R by aligning the two instruction streams.

## 11. Modification: start-up message on the remote head (FM92R)

`patch_startup_msg.py` makes a patched copy of the FM92R master. With it, the control head
shows a 2-character message (default `AA`) for about 2 s at power-up, before the channel
number appears.

```sh
firmware/patch_startup_msg.py --text AA --seconds 2 -o FM92R_AA.BIN
./fm900gen.py build ch.csv --hw 9234.... --sw ... --master-file FM92R_AA.BIN -o radio.bin
```

The patch changes 36 bytes:

* **0x0272:** the start-up `LDA #$AA ; JSR head_send` becomes `JSR $1700 ; NOP ; NOP`.
* **0x1700** (previously empty EPROM):
  1. Re-sends `$AA`.
  2. Sends `$80` + the left character and `$82` + the right character, the same messages `display_digits` uses.
  3. Busy-waits on tick counter bit 7 (256 ticks ≈ 106 ms per loop).
  4. Returns.

  The normal start-up then displays the channel number over the message.
* **Checks:** none of the firmware-signature sample bytes is touched, so 0x1F65 is unchanged. `fm900gen`/FM900.EXE recompute the 0x1F64 checksum as usual.

**Untested on hardware.** The stock firmware only ever sends `'0'`–`'9'` and space to the head.
Whether the head can draw letters depends on the head's own character generator. Digits
(e.g. `--text 88`) are certain to work.

FM92L is not supported by this patch. Its 2-digit display is fed 4-bit BCD values through
latches, which almost certainly use BCD-to-7-segment decoders that can only show 0–9.

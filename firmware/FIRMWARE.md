# FM92 radio firmware (FM92R / FM92L / FM92RS masters)

This document describes the 68HC05-family firmware in the master EPROM images
`fm900/MASTERS/FM92R.BIN` and `FM92L.BIN` (plus the selcall variant `FM92RS.BIN`, §15), and how that firmware uses the channel and
configuration data that FM900.EXE (and `fm900gen.py`) writes into the top of the EPROM.

It was recovered by disassembly. There is no schematic, so where this document names a
hardware function from how the code uses a pin, it says **(inferred)**.

Annotated listings:

* `FM92R.lst` (2381 instructions): every called routine and jump-table entry is named
* `FM92R.ram.txt`: generated RAM/I-O cross-reference, who reads and writes each address (§16)
* `FM92L.lst` (2265 instructions)
* `FM92RS.lst` (2423 instructions): names and comments ported from FM92R by `tools/portann.py`, plus the RS-only notes in `FM92RS.ann.local` (§15)

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
| Serial link | none | Software UART on PB0 (`uart_bit`, 0x08D8): ~1200 baud **8E1** (start bit, 8 data bits LSB first, even parity, stop bit). Single wire, idle high, half-duplex; the radio drives PB0 only while sending a byte. 4-byte transmit FIFO. Bytes 0x1F10–0x1F12 are sent to the head at start-up (`send_head_config`, 0x0508). |
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
| `$80–$86` | External peripherals: `$80` selcall tone encoder/decoder, `$81` CTCSS tone generator, `$82` output latch, `$84–$86` tone-chip set-up. These offsets match an NSC810 RAM-I/O-timer (ports A–C, then their direction registers), which the FM93 service manual shows as IC415 **(inferred; see `../STM900/HARDWARE.md` §6)** |
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
| PB5 | Synthesiser data strobe (idles high, low-going pulses) |
| PB6 | Synthesiser load enable (high while loading) |
| PB0 | FM92R: serial link to the control head. FM92L: display low-digit strobe. |
| PB1 | FM92R: 1.2 kHz square wave toggled every tick, very probably the head-link clock: the head cable carries a shielded data/clock pair (VK3BYY notes, `../docs/Philips FM92 .pdf`) (inferred). FM92L: display high-digit strobe. |
| PB7 | FM92L: indicator LED latch strobe |
| PA5 | On/off switch sense at reset (inferred) |
| PA6 | PTT input (inferred) |
| PA7 | Second front-panel input: hookswitch or monitor (inferred) |
| PA4 | Briefly turned into an input to sense a line (main loop). Also toggled as an alarm when the supply is too low. |
| IRQ pin | ADC comparator |

### 3.1 Synthesiser loading (`load_synth`, 0x0842)

`chan_ptr` (0x08C7) computes `ptr = 0x1BE0 + 8 × channel`, so channel 1 is at 0x1BE8.

1. Check that byte 2 (Rx) or byte 5 (Tx) has bit 7 set. If not, the channel is empty and the routine returns with carry set.
2. Put byte 0x1F2D on port A, raise PB6, and give two PB5 strobes.
3. Send the two divider bytes as four nibbles, low nibble first, one PB5 strobe each. These are the one's-complemented BCD digits FM900.EXE wrote.
4. Send the fifth digit: byte2 or byte5, OR'd with `$08`.
5. Send the reference/mode bytes 0x1F2C and 0x1F2D.
6. Drop PB6 low again.

The receiver is loaded with slot bytes 0–2 and the transmitter with bytes 3–5. That is why
FM900.EXE folds the IF offset into the Rx divider. This 4-bit, strobed, BCD-loaded interface
matches the Philips HEF4750/HEF4751 synthesiser family. A photo of an FM92E synthesiser/control board (VK2DOT guide, `../docs/FM92E-Modification.pdf` §16) shows an HEF4751VD in the synthesiser can; the HEF4750 is still inferred.

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

Fault-finding a radio that won't switch on (relay never pulls in): see `POWER_ON_DEBUG.md`.

While "off", the radio is not unpowered. The CPU sits in `STOP` with its RAM held up by +5VP and the super-cap. `STOP` halts the oscillator, so AS stops and **+5VS** (EPROM, logic) drops (`../STM900/HARDWARE.md` §4). Nothing on the serial link can wake it. Only a hardware `RESET` restarts it. The on/off key (FM92L), or the head cable's **on/off wire** (FM92R), drives IC407, which pulses `RESET` and holds **PA5** high so the firmware can tell a key press from a supply glitch.

1. `RESET` initialises the ports and waits.
2. `$20` (FM92L: `$21`) holds the power state: `$11` = off (stopped), `$99` = running. The reset code (0x0100–0x013B) treats the key as a **toggle**:

   | PA5 at reset | `$20` | Result |
   |---|---|---|
   | high (on/off pressed) | `$11` | **switch on**: `$20 ← $99`, set latch `$2A` bit 5, warm start |
   | high | `$99` | **switch off** (`power_down_stop`) |
   | low (supply glitch) | `$11` | stay off (back into `STOP`) |
   | low | `$99` | carry on running (warm start) |
   | either | anything else (RAM lost) | cold start |

   Latch `$2A` bit 5 is set only at switch-on, kept through a warm start (`$2A & $20 | $07`, 0x024A) and cleared at power-down (`$2A ← $07`). It is very probably the enable for the radio's switched supply **(inferred)**.
3. **Cold start** (`cold_start`, 0x015C) happens when the RAM copy no longer matches the EPROM:
   * clear RAM;
   * copy 0x1F2E–0x1F31 to `$2B–$2E`. `$2E` is the current channel, initially the lowest channel (0x1F31);
   * copy the option bytes 0x1F33–0x1F37 to `$2F–$33`;
   * then fall straight into `power_down_stop`. After the RAM has been lost (super-cap flat, first connection to power), the radio **comes up off** and needs one press of on/off.
4. **Warm start** (`warm_start`, 0x01FE):
   * `eprom_checksum` sums 0x0100–0x1FFF; the result must be `$FF`. Otherwise it resets, so a corrupt EPROM never runs. This is the 0x1F64 byte FM900.EXE computes.
   * Initialise the timer and peripherals, enable interrupts, wait about 10 ms.
   * Announce start-up to the head (FM92R), select the channel, and enter the main loop.
5. `power_down_stop` (0x0189) shuts off the outputs and executes `STOP`.

The following all end up there:

* the on/off switch
* the 8-hour timer (§7.7)
* low supply
* the control head not answering the keep-alive poll (FM92R, §6.3)
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
| `$44` / `$45` | head PTT **press** / release (`head_ptt_press` 0x0610 sets `$15.1`; `head_ptt_release` 0x064F clears it) |
| `$46` / `$47` | hook / monitor **press** / release (`head_hook_press` 0x0606 sets `$14.0`; 0x060D clears it). Gates CTCSS encode and monitor (§7.2) |
| `$48` | ignored |
| `$49` | reply to the radio's `$E4` keep-alive poll (§6.3) |
| `$4A` | RAM dump |
| other | sets the error flag `$10.0` |

The dispatcher (`head_key_dispatch`, 0x0574) jumps through `head_cmd_table` (0x059C) at index (byte − `$44`) × 3. **`$44` and `$46` must be repeated.** Each press starts a 1.5 s timer (`$5B`/`$5A` = `$38`, 56 × 27 ms). If no repeat arrives in time, the main loop releases it as if `$45`/`$47` had been sent. (An earlier version of this table had press and release the wrong way round.)

Bytes `'0'`–`'?'` are key codes (`'1' '2' '4' '7'`, above). The mic PTT is separate: PA6 low sets `$15.0` (`mic_ptt_press`, 0x061A), high clears it (`mic_ptt_release`, 0x0653).

**Messages to the head (FM92R)** go through `head_send`:

| Bytes | Meaning |
|---|---|
| `$80`/`$81` + character, `$82`/`$83` + character | the two display digits |
| `$A0` | channel changed / back on receive |
| `$A2` | transmitter on (Tx synthesiser settled) |
| `$A4` / `$A6` | squelch closed / open (busy indicator, from `$12.2` / `$12.1`) (inferred) |
| `$A7` | selcall call received |
| `$C0` / `$C1` | fault cleared / fault (`$10` ≠ 0; `$C1` is sent once, `$12.6` = sent) |
| `$E5` | display off (intermittent display, after 0x1F3B seconds) |
| `$AA` | start-up |
| `$E4` | keep-alive poll; the head must answer `$49` (§6.3) |
| `$E7` + 3 bytes | head configuration, from 0x1F10–0x1F12 |
| `$A3` | selcall (sent from `fn_selcall_send`) |
| `$EC` | RAM-dump prefix (`head_ram_dump`, command `$4A`) |

### 6.3 Head keep-alive (FM92R)

Once running, the FM92R checks that the control head is still there, and switches itself off when it isn't. Soft timers count in steps of 64 ticks (≈27 ms).

1. About 1.7 s after start-up (`$5E = $40`, 0x0244), then about every 0.53 s (`head_poll_timer`, 0x051C: `$5E = $13`), the radio is ready to poll.
2. `head_poll_send` (0x0526) sends **`$E4`** if no poll is outstanding, starts a ≈1.5 s timer (`head_poll_arm`, 0x0C73: `$5F = $38`) and sets "waiting" (`$1C.5`).
3. The head answers **`$49`**. `head_cmd_alive` (0x0667) clears "waiting" (`$1C.5`) and "missed" (`$14.3`).
4. If the timer expires while still waiting, `head_poll_check` (0x0534) sets "missed" and allows one more poll. If the timer expires on that one too, it jumps to `power_down_stop`.

So a radio with no head, a dead head or a broken data wire switches itself back off about **3 s** after switching on. This matches VK3BYY's fault-finding note: *"Switches ON (Green lamp on) but turns OFF after a short period: possible control head failure … check microprocessor chip is seated properly in the control head."* A head (or a head emulator) can also switch the radio off simply by not answering.

Not yet known: whether the real head's off button pulses the on/off wire, stops answering, or both. A capture with the on/off wire probed answers that (`../STM900/capture/CAPTURE.md`).

## 7. How the firmware uses the channel slot

FM900_FORMAT.md §4.2 gives the byte layout. On a channel change, `select_channel`
(0x07ED) does the following:

* **Bytes 0–2 (Rx divider):** loaded into the receive synthesiser.
* **Byte 2 bit 7:** channel valid. Empty channels are skipped by up/down and by scanning.
* **Byte 2 bit 6:** injection side, sent to latch `$29` bit 1.
* **Byte 2 bit 5 (VOTE):** handled by `chan_flags_rx`, which sets `$13.6` ("on a vote channel"). While voting hops round the ring, `$50`/`$52` keep the channel the user selected, and channel up/down restart from there.
* **Byte 2 bit 4 (C/R):** community-repeater handling of the CTCSS decoder.
* **Byte 2 bit 3:** VCO band switch, sent to latch `$2C` bit 5.
* **Bytes 3–5 (Tx divider):** loaded into the synthesiser when transmitting.
* **Byte 5 bit 7 clear:** receive-only channel.
* **Byte 5 bits 4–5:** power, `$30` = high, `$20` = medium, `$10` = low, `$00` = use the operator's choice. Only bit 4 reaches the PA switch (latch `$2C` bit 4). The bits also select which 0x1F08–0x1F0F window supervises the PA. This is why FM900.EXE stores 1 W as `$20` on FM92 VHF radios: those have only two power stages.
* **Byte 5 bit 3:** sent to latch `$82` bit 5.
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

**Settings.** Option byte 0x1F34 is copied to RAM `$30` at start-up:

| `$30` bit | Meaning | Set by |
|---|---|---|
| 0 | CTCSS in use | software digit s8 = 1–7 |
| 1 | reverse tone burst (RTB) | s8 = 3, 4 or 7 |
| 2 | CTCSS decode | hardware digit h5 = 2, 5 or 8 |

(FM900_FORMAT.md §4.3.) So a CTCSS radio needs **both** codes set: h5 = 1 (encode only) or 2 (encode and decode) for the hardware, and s8 ≥ 1 for the mode. With s8 = 0 the firmware never sends or decodes a tone, whatever the channels say.

The channel's tone code is slot byte 6 bits 0–5 (1–38, 0 = none), copied to `$34` when the channel is selected. Slot byte 2 bit 4 (C/R, community repeater) is copied to `$1B.5`.

**Tone chip.** `set_ctcss_tone` (0x0D36) looks up the code in a 38-entry table at 0x0E57–0x0E7C and writes the 6-bit value with bit 6 set to `$81`, the CTCSS tone chip (§2). The values are the chip's own tone-select codes, so they are not in code order:

| Code | Tone | `$81` | Code | Tone | `$81` | Code | Tone | `$81` |
|---|---|---|---|---|---|---|---|---|
| 17 Q | 67.0 | `3F` | 13 M | 118.8 | `29` | 28 2 | 180.2 | `11` |
| 18 R | 71.9 | `3D` | 5 E | 123.0 | `28` | 29 3 | 186.2 | `10` |
| 19 S | 74.4 | `3B` | 14 N | 127.3 | `25` | 30 4 | 192.8 | `0D` |
| 20 T | 77.0 | `3C` | 6 F | 131.8 | `24` | 31 5 | 203.5 | `0C` |
| 21 U | 79.7 | `37` | 15 O | 136.5 | `21` | 32 6 | 210.7 | `09` |
| 9 I | 82.5 | `39` | 7 G | 141.3 | `20` | 33 7 | 218.1 | `08` |
| 22 V | 85.4 | `33` | 16 P | 146.2 | `1D` | 34 8 | 225.7 | `05` |
| 1 A | 88.5 | `38` | 8 H | 151.4 | `1C` | 35 9 | 233.6 | `04` |
| 23 W | 91.5 | `2F` | 24 X | 156.7 | `19` | 36 * | 241.8 | `01` |
| 10 J | 94.8 | `35` | 25 Y | 162.2 | `18` | 37 # | 250.3 | `00` |
| 38 = | 97.4 | `2B` | 26 0 | 167.9 | `15` | | | |
| 2 B | 100.0 | `34` | 27 1 | 173.8 | `14` | | | |
| 11 K | 103.5 | `31` | | | | | | |
| 3 C | 107.2 | `30` | | | | | | |
| 4 D | 114.8 | `2C` | | | | | | |
| 12 L | 110.9 | `2D` | | | | | | |

(Letter codes and tones are FM900.EXE's, FM900_FORMAT.md §2.2; the `$81` column is read from the master.)

**Encode (transmit).** When the Tx synthesiser has settled (`tx_synth_settled`, 0x071A, which also sends `$A2` to the head), `ctcss_tx_on` (0x0E2C) turns the tone on if all of these hold:

* CTCSS is fitted (`$30.0`) and the channel has a tone (`$34` bits 0–5 ≠ 0);
* `$11.4` is set, or selcall is sending (`$15.5`).

"On" means `$81` bit 6 = 1 and `$82` bit 1 = 0 (inferred: `$82.1` gates the encoder output; `tx_stop` sets it again via `ctcss_tone_off`, 0x0E0D). `ctcss_tx_watch` (0x0E45) turns the tone off during the transmission if `$11.4` drops (with a reverse burst first, if RTB is armed).

`$11.4` is computed every main-loop pass as **PA7 high AND head command `$46` held** (`$14.0`, §6.2). So on an FM92R the tone is only sent while the head keeps reporting `$46`. PA7 is not traced on a schematic; it is probably the hook switch (inferred). Check this on the radio before relying on it.

**Reverse tone burst.** If RTB is enabled, `ctcss_tx_on` also arms `$15.6`. When both PTTs are released (`$15` = `$40`), `ctcss_burst_start` (0x0E10) keeps the transmitter keyed, clears `$81` bit 6 (inferred: 180° phase reversal) and starts timer `$E9` = 5 (5 × 27 ms ≈ 135 ms). When it runs out, `ctcss_burst_end` (0x0DFA) restores bit 6 and turns the tone off, unless PTT was pressed again. Then the transmitter drops.

**Decode (receive).** `ctcss_decode_task` (0x0DCF) runs twice per main-loop pass while receiving, if CTCSS and decode are both enabled (`$30.0`, `$30.2`) and the channel has a tone:

| Squelch (`$19.4`) | Tone detected (`$82` bit 2 = 0, inferred) | Channel | CTCSS mute `$18.3` | Busy lockout `$16.3` |
|---|---|---|---|---|
| open | yes | any | open | cleared |
| open | no | normal | closed, unless `$11.4` | cleared |
| open | no | C/R | closed | **set** |
| closed | – | normal | closed, unless `$11.4` | cleared |
| closed | – | C/R | closed | unchanged |

* With CTCSS off, or on a channel with no tone, the CTCSS mute and the lockout are both cleared.
* **Monitor.** `$11.4` opens the CTCSS mute on normal channels (inferred: picking up the handset lets you hear the channel). On C/R channels it does not.
* **C/R busy lockout.** On a community-repeater channel, a carrier without your tone sets `$16.3`. `tx_inhibited` (0x06A5) then refuses PTT (`$1B.0` set, no transmission) until your tone is heard or the carrier goes. `$16.3` is also set at start-up on a C/R channel and cleared whenever a channel is loaded.
* **Audio mute.** `squelch_task` keeps the audio muted (latch `$29` bits 2 and 5) while **any** bit of `$18` is set. That includes the CTCSS mute `$18.3`, the selcall mute `$18.2` and the synthesiser-settling bits `$18.0`/`$18.1`. Only with `$18` = 0 can an open squelch (`$19` bits 4–7) unmute.

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
pip install 'capstone==5.0.*'   # 5.0.9 (reports 5.0.7) reproduces the committed listings exactly
python3 tools/mklist.py FM92R     # reads ../fm900/MASTERS/FM92R.BIN, FM92R.ann
python3 tools/mklist.py FM92L
python3 tools/portann.py FM92R FM92RS   # writes FM92RS.ann (+ FM92RS.ann.local) and a report
python3 tools/mklist.py FM92RS
python3 tools/ramxref.py FM92R > FM92R.ram.txt   # RAM cross-reference (§16); --md for a Markdown table
```

* `tools/d6805.py` is a recursive-descent 6805 disassembler that also follows `JMP table,X` jump tables.
* **Capstone bug.** Capstone 5.0.x prints 6805 `BSET`/`BCLR` the wrong way round: it shows opcode `$10+2n` as `bclr` when the manual defines it as `BSET n`. `d6805.py` corrects this. Listings made before this fix (commits before the PC-control notes) had every `bset`/`bclr` inverted.
* The `.ann` files hold routine names (`=addr name`) and per-address comments.
* The FM92L names were transferred from FM92R by aligning the two instruction streams.
* `tools/portann.py SRC DST` does that alignment reproducibly. It aligns normalised instructions (code addresses masked, so moved code still matches), maps RAM/I/O and the `0x1B00+` data area 1:1, and keeps a ported name or comment only if the first 3 instructions at both ends match. It prints what it mapped, what it dropped, and the DST code with no SRC counterpart. Hand-written DST entries go in `DST.ann.local`; never edit the generated `DST.ann`.
* `FM92RS.ann` is generated this way: 156 entries ported, 4 not. Three of those are no longer true in RS. The fourth, `selcall_send_start`, still exists but its first instructions changed, so it is re-added by hand in `FM92RS.ann.local`. The head check compares instructions only, not comment text: comments that name RAM addresses which moved in RS (e.g. the soft-timer comments) are corrected in `.ann.local`, whose entries override ported ones at the same address.

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

## 12. EPROM type, 2716 → 2764 conversion, and bigger EPROMs for more channels

### 12.1 What the firmware and FM900.EXE require

* **Image size.** The image is a full **8 KB (2764)**. Code runs from 0x0100 to 0x15AE, the channel table and config fill 0x1B40/0x1BE8–0x1FEF, and the reset/interrupt vectors are at 0x1FF0–0x1FFF. None of it fits in a 2 KB 2716.
* **FM900.EXE.** Its EPROM menu offers only **2764** (21 V programming) and **2764A** (12.5 V). Both read identically in the radio. A modern **27C64** is a drop-in replacement and draws less current. The CPU bus is slow, so any access-time grade (150–250 ns) is fine.
* **CPU address range.** The CPU is an MC146805E2-class part with a 13-bit address bus (A0–A12). **8 KB is the most it can address**, and every master in `fm900/MASTERS` uses all of it.

### 12.2 The 2716 story

Nothing in these files mentions a 2716. If some FM9x boards were built with a 24-pin 2716 socket, they must have run older or smaller firmware: today's masters physically need 8 KB.

Converting such a board to take a 2764 is the standard 24→28-pin socket job. The 2716 sits in the bottom 24 positions of a 28-pin footprint:

| 28-pin socket pin | 2764 function | what a 2716 board has there (2716 pin) |
|---|---|---|
| 1 | Vpp | – (no pin) |
| 2 | **A12** | – |
| 3–19 | A7–A0, D0–D7, GND | same (1–17) |
| 20 | /CE | /CE (18) |
| 21 | A10 | A10 (19) |
| 22 | /OE | /OE (20) |
| 23 | **A11** | **Vpp (21), tied to +5 V on a read-only board** |
| 24, 25 | A9, A8 | A9, A8 (22, 23) |
| 26 | NC | **+5 V (24)** |
| 27 | /PGM | – |
| 28 | Vcc | – |

The modification is therefore:

1. Fit a 28-pin socket aligned so that its pins 3–26 match the old 1–24.
2. Connect socket pins **28, 1 and 27** to +5 V.
3. **Cut pin 23 away from +5 V** and wire it to the CPU's (latched) **A11**.
4. Wire pin 2 to **A12**.
5. Pin 26 can stay at +5 V, because it is NC on a 2764.

This is generic EPROM practice, not taken from a Philips drawing. Check it against the actual board and the CPU pinout before cutting anything.

### 12.3 Using a 27128 or 27256

The larger parts differ from a 2764 only in what pins 26 and 27 do:

| Pin | 2764 | 27128 | 27256 |
|---|---|---|---|
| 1 | Vpp | Vpp | Vpp |
| 26 | NC | **A13** | **A13** |
| 27 | /PGM | /PGM | **A14** |

The CPU still only addresses 8 KB, so a bigger EPROM can't make one image bigger. The firmware also hard-limits the FM92 to 99 channel slots (FM91: 120). What a bigger part *can* do is hold **several complete 8 KB images** (banks), selected by driving A13 (and A14):

* **27128:** 2 banks, so 2 × 99 channels.
* **27256:** 4 banks, so 4 × 99 = 396 channels.

Each bank must be a complete, valid image: firmware plus that bank's channels and settings. Build each one normally with `fm900gen.py` (each gets its own correct checksums), then concatenate them in bank order (A14 A13 = 00, 01, 10, 11):

```sh
./fm900gen.py build bank0.csv --hw ... --sw ... -o b0.bin
./fm900gen.py build bank1.csv --hw ... --sw ... -o b1.bin
cat b0.bin b1.bin > rom_27128.bin                       # 16 KB
cat b0.bin b1.bin b2.bin b3.bin > rom_27256.bin         # 32 KB
```

**Simplest use, with no modifications:** on a converted board, pin 26 is often still tied to +5 V, which makes a 27128 read its *upper* half. If you just want to use a larger or cheaper EPROM, program the same image into every bank (`cat radio.bin radio.bin > rom.bin`). It then works however A13 and A14 are strapped. Web FPP's Build tab does this for you: pick the part in its **EPROM** menu. A **27C512** works the same way, with A15 on pin 1 (Vpp on the smaller parts, normally tied to +5 V), giving 8 mirrored banks.

#### Option A: external switch (no firmware change)

1. Lift pin 26 (and pin 27 for a 27256) out of the socket, or cut its track.
2. Fit a 10 kΩ pull-up to +5 V on each.
3. Connect a switch to ground: a toggle for a 27128, or a 2-bit rotary/DIP switch for a 27256.

The address lines must never float, which is why the pull-ups are needed.

**Change banks only with the radio switched off.** This is why, from the firmware's point of view:

* **Same code in every bank.** All banks built from the same master have byte-identical code. The CPU won't crash if the bank changes under it, because only the data area changes.
* **RAM checks.** The firmware keeps RAM copies of 0x1F2E, 0x1F32 and 0x1F33–0x1F37 and re-checks them about every 13 ms (`supervision_task` → `chk_ram_config`).
  * If the banks use **different hardware/software codes**, switching while on fails this check. The radio cold-restarts and shuts down; switch it back on.
  * If the codes are **the same**, the radio carries on with the old synthesiser setting and display until the next channel change, while scan lists and limits switch immediately. That works, but is confusing.
* **Tamper checks.** The signature (0x1F65) and option checksum (0x1F66) are valid within each bank, so the tamper checks pass in every bank.
* **Valid channel.** Make sure the radio's current channel exists in every bank (e.g. always program channel 1), or change channel after switching banks.
* **No mixing masters.** Don't mix different masters, or patched and unpatched firmware, in one EPROM unless you only ever switch with the power off.

#### Option B: spare CPU output (FM92R, needs a firmware patch)

On the **FM92R**, CPU port **PB7** is configured as an output (DDRB = `$FE`) but is never used. The code only ever writes the whole port, setting PB7 low at power-on (`$01 ← $22` at 0x01CE) and at power-off (`CLR $01`). On the FM92L the same pin strobes the LED latch, so it is **not spare there**.

Wiring PB7 to EPROM A13, with a 10 kΩ pull-down because the pin floats until the CPU initialises its port, would let the firmware choose the bank:

* **As-is:** every power-up starts in bank 0 and nothing ever selects bank 1, so the extra bank is unusable without a patch.
* **With a small patch,** in the same style as `patch_startup_msg.py`:
  * add a function-key code (e.g. 9 = "bank toggle", assignable with `--keys`);
  * that function flips PB7 and reselects the channel; because the code is identical in both banks, execution continues seamlessly;
  * the power-on port write would be changed to keep the last bank, which survives in RAM while the radio is "off" (in STOP).

You'd have to confirm on the board that the CPU's PB7 pin is accessible and not connected to anything on an FM92R PCB. The external output latches (`$80`–`$86`) may also have spare bits, but without a schematic that can't be determined.

## 13. Future Upgrade Options

These are designed but **not implemented**. Each would be a patch tool in the style of
`patch_startup_msg.py`:

* verify the original bytes;
* write a patched copy of the master;
* put new code in the empty EPROM area 0x15AF–0x1B3F, avoiding the signature-sample bytes 0x15CC, 0x19CC and 0x1ACC;
* use the patched master with `fm900gen.py --master-file`.

All would be untested on hardware until burned.

### 13.1 Duplex / talk-around on/off key (FM92R and FM92L)

**Goal:** one function key that toggles between normal repeater operation and transmitting
on the receive frequency.

* **New function code 9.**
  * Function codes are range-checked at 0x05CC (`CPX #$1B`) before `JMP $05D6,X`, and the table at 0x05D6 has no room to grow.
  * So: redirect the dispatch to a new range check and table in free space that accepts codes 0–9, and allow `9`/`duplex` in `fm900gen.py --keys`.
  * The new function toggles a free RAM flag bit, re-selects the channel (`select_channel`), and shows the state briefly on the display.
* **Transmit frequency** (`load_synth`, 0x0842, Tx path X = 5). When the flag is set, compute the Tx divider from the Rx divider instead of reading bytes 3–5:

  ```
  N_tx = N_rx - IF/step     if the IF offset is positive (bands E, B, T, U)
  N_tx = N_rx + IF/step     if negative (bands A, W1, W2)
  ```

  * Digits are stored as `15 − digit`, so decode the 5 BCD digits, add or subtract the constant with decimal carries, and re-encode.
  * IF/step is a fixed constant per radio: e.g. 21.4 MHz / 5 kHz = 4280, or / 6.25 kHz = 3424. The patch tool would take `--hw`, or band plus step, and bake in the constant.
  * Estimated 60–80 bytes.
* **Check:** C/R / CTCSS behaviour and the PA power windows are unaffected, because power still comes from byte 5.
* **Alternative with no patch:** program pairs of channels (repeater and simplex), ideally 10 apart, and use the `tens` key.

### 13.2 Bank switching from the radio (FM92R only)

**Goal:** select 27128/27256 banks (§12.3) from a function key instead of an external switch.

* **Hardware.**
  * Wire CPU **PB7** to EPROM A13 (pin 26), with a 10 kΩ pull-down.
  * PB7 is already an output (DDRB = `$FE`) and unused in FM92R firmware. It strobes the LEDs on FM92L, so it is not usable there.
  * For 4 banks, A14 would need a second spare output, which hasn't been identified yet.
* **New function code** (e.g. 10 = bank toggle). It flips PB7 with `BSET`/`BCLR 7,$01` and re-selects the channel.
  * Every bank must be built from the **same master with the same hardware/software codes**. Then the code is byte-identical across banks and the RAM option check (`chk_ram_config`) still passes.
  * Each bank must have the current channel programmed (e.g. always channel 1).
* **Keep the bank across power-off.**
  * Patch the power-on write `LDA #$22 ; STA $01` (0x01CE) and the power-down `CLR $01` (0x01B5) so they preserve PB7.
  * Store the bank in a free RAM bit; RAM is retained while the radio is "off" in STOP.
  * On a true cold start, bank 0 is selected (pull-down plus port reset).
* **Display.** Optionally show `b0`/`b1` on the head when switching, reusing the `patch_startup_msg.py` display code.

### 13.3 PC / tablet control through the head interface (FM92R, no firmware change)

**Goal:** a PC or tablet emulates the CU91R control head on the radio's head link.

* **Electrical.**
  * The link is one wire plus ground: ~1200 baud **8E1**, idle high. The radio drives the line (push-pull from the CPU pin) only while it is sending; the rest of the time PB0 is an input.
  * A USB-TTL serial adapter can do it, with its TX through an open-collector transistor (or a diode plus pull-up) onto the wire and its RX also on the wire. You will hear your own transmissions echoed back.
  * The voltage level (5 V logic at the CPU, possibly buffered on the board) and the head-connector pinout must be checked on the hardware.
* **What a PC can read.**
  * The display characters (`$80`/`$82` + ASCII), i.e. the channel number.
  * Status bytes (`$A0`–`$AA`, `$C0`/`$C1`, `$E5`, `$E7`+config) and the `$E4` keep-alive poll.
  * On request (`$4A`), a full RAM dump. That includes live RSSI (`$46`), squelch noise (`$45`), the supply/forward-power reading (`$4A`), the current channel (`$2E`) and all flags, which is useful for a signal meter or logging.
* **What a PC can do.**
  * Send key codes `'1' '2' '4' '7'` to run the four programmable functions (§6.2), e.g. channel up/down, scan, monitor. With `tens`/`units` assigned (`--keys tens,units,…`), it can jump to any channel in about 3–10 key presses.
  * Send PTT press/release: `$44` = press, repeated at least every 1.5 s while transmitting, `$45` = release (§6.2). The same for `$46`/`$47` (hook/monitor), which also gates the CTCSS tone (§7.2).
  * It **must** answer every `$E4` poll with `$49` within about 1.5 s, or the radio switches off after about 3 s (§6.3). Stopping the replies is also a way to switch the radio off.
  * Switching **on** needs the head cable's on/off wire, not a serial byte (§6.1).
  * It **cannot** set an arbitrary frequency: only the programmed channels are reachable, the same as from the head.
* **To confirm first.** Sniff a real head with a logic analyser or a USB-serial adapter in receive-only mode, to check the baud rate, parity, levels and the meaning of the head command bytes (§6.2). Also check the on/off wire's level and pulse width. The radio does not wait for anything from the head at power-up, but it needs `$49` keep-alive replies from then on (§6.3).
* **Software.**
  * A small Python head emulator (pyserial): decode the display and status bytes, and send keys and PTT.
  * Optionally an ESP32 bridge on the wire serving a web page or Bluetooth link for a tablet.
* **Living with a real head.** Listening in parallel with a real head is safe. Sending while the head is connected risks collisions on the single wire, so either disconnect the head or only send when the line is idle.

### 13.4 Other gaps

| Item | Notes |
|---|---|
| **FM93, FM97WP, "92 with 91 PCBs" builds** in `fm900gen.py` | FM900.EXE routines are identified (FM900_FORMAT.md §5). Needs sample jobs to verify against. |
| **Selcall tone programming** in `fm900gen.py` | FM900.EXE selcall editor around 0x113F9. Firmware use of 0x1F67–0x1FA7 is in §7.8 (FM92R) and §15.3 (FM92RS). Without it, a built FM92RS image has no selcall code (§15.4). |
| **Head character set** | Find out which characters the remote head can display, by testing `patch_startup_msg.py` with letters. That would allow messages per channel or per bank. |
| **Spare outputs on the external latches `$80`–`$86`** | Needs a schematic or board inspection; could provide A14 for 4-bank switching. |

## 14. Connectors: control head DIN and microphone

**Source:** WICEN (Vic.) Inc., "FM92 for Packet", <https://www.vic.wicen.org.au/?page_id=631>
(checked 2026-10-21). This is not derived from the firmware.

| Signal | CFA head (5- or 8-pin DIN) | Microphone connector | VicPol head (8-pin DIN) |
|---|---|---|---|
| Tx audio | 1 | 4 | 5 |
| Ground | 2 | 3 | 2 |
| PTT | 3 | 1 | 7 |
| Rx audio | 4 | – | 6 |
| Switched Rx audio | 5 | – | – |
| Tx audio ground | – | 5 | 3 |
| Cradle switch | – | 2 | 1 |

All of these connectors are on the **control head**.

Notes from the source:

* **Ex-Victoria Police (VicPol) heads** already have all the signals on the rear DIN.
* **Ex-CFA heads:** Tx audio and PTT must be wired from the front microphone connector through to the rear DIN. WICEN marks these in red as connections you may need to make. WICEN's digipeaters use the CFA pinout.
* **Mic pin 6** is the microphone connector pin closest to the right edge of the head.
* **TNC wiring.** The same page also gives TNC pinouts:
  * Kantronics 9-pin D: Tx audio 1, Ground 6, PTT 3, Rx audio 5.
  * Tiny-2 / MFJ-1270B 5-pin DIN: Tx audio 1, Ground 2, PTT 3, Rx audio 4.

My own notes:

* **Earlier version.** A version of this table supplied earlier gave VicPol Rx audio as pin 5 (a duplicate of Tx audio) and microphone Rx audio as pin 6. The WICEN source gives VicPol Rx audio = **6** and no microphone Rx-audio pin.
* **Data line not listed.** These are the head's audio/PTT accessory connections. The source does not list the head ↔ radio **serial data line** (the ~1200 baud 8E1 link on CPU PB0, §1 and §13.3), the supply, or the power switch. Those are on the head-to-radio DB-15 cable, not this DIN (wire list in `../STM900/HARDWARE.md` §8; pin numbers still unknown). Identify them before attempting PC/tablet control.
* **PTT:** the firmware senses PTT on CPU PA6 (inferred, §3). Head PTT arrives as a serial command (`$44` press, `$45` release; §6.2).

## 15. FM92RS: the selcall master

FM900.EXE builds a remote-head FM92 from `FM92RS.BIN` instead of `FM92R.BIN` when hardware-code digit h5 is 3, 4 or 5 (selcall fitted; FM900_FORMAT.md §4.1). So a selcall-equipped FM92R runs this firmware. That comes from FM900.EXE's selection logic. It has not been checked against a dump of a real selcall radio, and none of the sample jobs uses selcall (all have h5 = 0 or 1).

FM92RS is FM92R with the selcall decoder replaced and a little extra code. About 93% of the code bytes line up. Everything in §1–§14 applies unless listed here. Addresses are FM92RS, with the FM92R address where it differs.

### 15.1 Outside the code

| Address | FM92R | FM92RS | Notes |
|---|---|---|---|
| 0x0000–0x00FF | | same | |
| 0x1600–0x160D | `00` | code | end of `init_peripherals` (the code grew by about 95 bytes) |
| 0x1BE8–0x1FFF | | same except below | channel table and configuration defaults unchanged |
| 0x1F65 | `1E` | `7E` | firmware signature; FM900.EXE recomputes it anyway (FM900_FORMAT.md §4.3) |
| 0x1FE5–0x1FE6 | `05 0A` | `0C 05` | version byte 12 |
| 0x1FEA–0x1FEF | `80` `0029:` | `00` `01055` | ID string |
| 0x1FFA IRQ vector | 0x0BB1 | 0x0BBA | same ADC routine, moved |

### 15.2 Code changes

| FM92RS | FM92R | Change |
|---|---|---|
| `selcall_decode_task` 0x1145 | 0x1142 | **Rewritten** (§15.3). |
| `selcall_decode_reset` 0x11E3 | none | New. Called from the end of `tx_stop` (0x06FC) to re-arm the decoder after transmitting, if selcall decode is enabled (`$32` bit1 and `$34` bit7). |
| `selcall_call_received` 0x1309 | 0x12E3 | Main loop: FM92R calls a handler for each of `$A3` bits 4, 5 and 6 (0x12E3, 0x12D2, 0x1316). FM92RS keeps only the bit-4 call (§15.3). |
| `tone_chip_write` 0x12EF | 0x12C7 | The low nibble (tone number) is now inverted (`EOR #$0F`) before the write to `$80`. |
| `tone_chip_reset` 0x12FC | inline in `selcall_encode_task` | New: `$80` bit6 on, `$84` = `$7F`, then a strobe on `$80` bit4. FM92R writes `$B0` to `$84` and strobes `$80` bits 6/7. |
| `selcall_encode_task` 0x120D, `selcall_send_start` 0x1275 | 0x11DE, 0x1242 | Same structure, adapted to the new tone chip: the repeat tone is `$0A` instead of `$0E` (as in the decoder), the tone byte is OR'd with `$80` instead of `$50` except for tone 15, the strobes use `$80` bits 4 and 7 instead of 4 and 6, and the inline `$84` = `$B0` set-up became a call to `tone_chip_reset`. |
| `selcall_timeout_task` 0x150B | none | New, called from the main loop when `$30` bit6 is set. When the 1 s timer `$EF` (loaded from 0x1FB6) runs out, it clears the call state and calls `sub_13D8` (inferred: auto-reset of a received call). |
| `init_peripherals` 0x15EB | 0x158C | `$80` starts at `$50` (FM92R `$00`); `$84` = `$7F` (FM92R `$B0`), also kept in `$A4`. |
| `soft_timers`, `uart_bit` | | Three more soft timers (below). Each existing user kept a timer of the same rate but most were renumbered: `vote_task` `$E8` → `$E9`, `main_loop_part2` `$E9` → `$EA`, the alert/handler code `$EB`, `$EC` → `$ED`, `$EE`. `$E7` (selcall encoder) is unchanged. The new decoder uses `$E7`, `$E8` and `$EC`, and the 0x1FB6 timeout uses `$EF`. `$EB` is decremented but never read. |
| `squelch_task`, `set_ctcss_tone`, `scan_list_select` | | Only table addresses that moved. No change in behaviour. |

Soft timers:

| Rate | FM92R | FM92RS |
|---|---|---|
| every odd tick (~0.83 ms), in `uart_bit` | `$55`, `$56`, `$E7`, `$E8` | `$55`, `$56`, `$E7`, `$E8`, `$E9` |
| every 64 ticks (~27 ms) | `$57`–`$61`, `$E9`, `$EA` | `$57`–`$61`, `$EA`, `$EB`, `$EC` |
| every 2,304 ticks (~1 s) | `$63`–`$65`, `$EB`, `$EC` | `$63`–`$65`, `$ED`, `$EE`, `$EF` |

### 15.3 The selcall decoder

**FM92R:** the tone chip at `$80` decodes the tones itself. The firmware reads each received digit from `$80` when bit6 says one is ready, and compares the sequence with four codes at once: the own code (`$D5`), and the codes at 0x1F8D, 0x1F96 and 0x1F9F (individual, group and alarm, inferred). Each mismatch clears one of `$A3` bits 4–7.

**FM92RS (inferred):** the chip is used as a single-tone detector, retuned for each digit:

1. For each digit of the own code (`$D5`,x), load that tone into the chip (`tone_chip_write`). If it is the same as the previous digit, load the repeat tone (`$0A`/`$0B`) instead.
2. Wait for `$80` bit7 (tone present), inside time windows taken from 0x1F84 onwards (timers `$E7`, `$E8`, `$EC`).
3. `$BE` counts the digits left, starting from 0x1F7A. `$C0` is the digit index.
4. When all digits have matched, wait the 0x1F84 hold-off, then flag the call. `selcall_call_received` then:
   * sends `$A7` to the head (inferred: call indicator);
   * loads the `$EF` timeout from 0x1FB6 (master value `$08`; 0x1FB6 is read only by FM92RS);
   * starts an alert (`$80` bit5, timer `$ED` = `$11`), if `$33` bit3 is set;
   * unless `$32` bit7 is clear, sets `$15` bit5, which starts `selcall_encode_task`: an automatic reply (inferred).

So FM92RS recognises **one** code, its own. It no longer reads 0x1F96, 0x1F9F or 0x1F83, and reads 0x1F8D once instead of twice. Its use of 0x1F84 grew from 1 read to 9 (per-digit timing).

### 15.4 What this means for building an FM92RS image

* `fm900gen.py` and Web FPP already select `FM92RS.BIN` for h5 = 3–5, and the generic option bytes (0x1F36, 0x1F37) are set as for FM92R.
* Like FM900.EXE, they then clear the selcall tone memory (0x1F67 = `00`, 0x1F68–70 = `0F`, 0x1F71–79 = `00`, 0x1F7A = `00`, 0x1F84–8C = `00`; FM900_FORMAT.md §4.1). In FM900.EXE the selcall tone editor fills it in afterwards; that editor is not implemented here (§13.4). So an image built today has **no own code and no digit timing**. 0x1F7A = 0 means a zero-length code, so the decoder will not work as intended.
* Until the editor is implemented, the selcall bytes have to come from the radio's current EPROM (read it with the Web FPP Read tab, or a programmer). The tools cannot merge them yet. If you copy 0x1F67–0x1FB6 across by hand, you **must** then recompute the 0x1F64 checksum (FM900_FORMAT.md §4.3). Otherwise `eprom_checksum` fails and the radio sits in a reset loop (§8).

## 16. FM92R RAM map

What each direct-page address is used for. **Bold** = confirmed from several uses. Everything else is inferred from the routines that touch it (names in §6–§7 and the listing), and a `–` means the bit is not used or its role is unknown. Every access, by routine, is in `FM92R.ram.txt`, generated by `tools/ramxref.py FM92R`. Bits are written `$xx.n`.

### 16.1 I/O and fixed areas

| Addr | Use |
|---|---|
| `$00`, `$01`, `$04`, `$05`, `$08`, `$09` | ports A/B, their DDRs, timer (§2, §3) |
| `$02` | read once by `wait_startup` (port C or another input, inferred) |
| `$20` | **power state**: `$11` off, `$99` on (§6.1) |
| `$21`–`$24` | **RAM stub** `LDA/ADD $hhll,X ; RTS` built at run time to index EPROM tables (§2); also scratch |
| `$25`, `$26` | scratch (`bin_to_bcd`, `load_synth`, `head_send`) |
| `$27`, `$28` | **tick counter** (`$28`, §4); `$27` TIMER_ISR scratch |
| `$2F`–`$33` | **option bytes 0x1F33–0x1F37** copied at start-up. `$30` = 0x1F34 (CTCSS bits, §7.2), `$31` = 0x1F35, `$32` = 0x1F36, `$33` = 0x1F37 |
| `$34`, `$35` | **current channel slot bytes 6 and 7** (CTCSS code / selcall bit; vote link) |
| `$36` | key-hold auto-repeat count (`key_hold_handler`) |
| `$37`–`$3D` | **software UART**: bit counter, received byte `$38`, shift registers, 4-byte transmit FIFO `$3D` with pointers `$3B`/`$3C` |
| `$41` | display scratch (`display_digits`) |
| `$42`–`$44` | ADC: start time and channel for the IRQ (§5) |
| `$45`–`$4A` | **ADC results** (§5): `$45` noise, `$46` RSSI, `$47`, `$48`, `$49` squelch pot, `$4A` supply / forward power |
| `$4B`–`$4D` | squelch filter state and hysteresis (`squelch_task`) |
| `$4E` | 8-hour timer, 30-min units (0x1FB5) |
| `$4F` | scan/display mode byte (written by `fn_scan`, `scan_list_select`, `init_peripherals`) (inferred) |
| `$2E` | **current channel** number |
| `$50` | **home channel** while scanning or voting (restored by `scan_restore_channel`) |
| `$51`–`$54` | scan/vote: slot index `$51`, vote channel `$52`, scan-list pointer `$53`/`$54` |
| `$2D` | bits 0–2 = **squelch setting** 0–7; bits 3–7 = synthesiser relock retry count (`synth_relock`) |
| `$29`, `$2A`, `$2C` | **output latch shadows** (§3): `$29.2`/`$29.5` audio mute, `$29.3` follows `$17` ≠ 0, `$29.7` toggled by `latch29_toggle_b7` (beeper, inferred); `$2A.4`/`.6` economiser; `$2C` latch PB4 |
| `$2B` | RAM-config check byte (`chk_ram_config`) |
| `$68` | RAM-config copy, compared with 0x1F32 by `supervision_task` (mismatch: `$10.3`) |

### 16.2 Soft timers

All count down to below zero (bit 7 = expired). Rates in §4.1.

| Timer | Rate | Use |
|---|---|---|
| `$55` | odd tick (~0.83 ms) | synthesiser settle after a load: `$11` (~14 ms), then `tx_synth_settled` / `rx_synth_settled` |
| `$56` | odd tick | squelch / scan dwell (`squelch_open_test`, `scan_task`) |
| `$57`, `$58` | 27 ms | not used outside `soft_timers` (spare) |
| `$59` | 27 ms | key hold / alert-tone toggle |
| `$5A` | 27 ms | head `$46` auto-release, 1.5 s (§6.2) |
| `$5B` | 27 ms | head PTT `$44` auto-release, 1.5 s (§6.2) |
| `$5C` | 27 ms | synth-unlock blanking, 4 × 27 ms (`unlock_blank_start`) |
| `$5D` | 27 ms | key auto-repeat |
| `$5E` | 27 ms | head poll interval (§6.3) |
| `$5F` | 27 ms | head poll reply timeout, 1.5 s (§6.3) |
| `$60` | 27 ms | economiser / scan |
| `$61` | 27 ms | start-up hold-off (`$16.7`), scan, squelch |
| `$62` | 27 ms | prescaler for the 1 s timers |
| `$63` | 1 s | display timeout (0x1F3B) |
| `$64` | 1 s | not used outside `soft_timers` (spare) |
| `$65` | 1 s | squelch / scan (`squelch_open_test`) |
| `$66` | – | prescaler for `$67` |
| `$67` | 10 s | Tx timer and 8-hour timer |
| `$E7`, `$E8` | odd tick | selcall encoder `$E7`; vote dwell `$E8` |
| `$E9`, `$EA` | 27 ms | reverse tone burst `$E9`; selcall decoder `$EA` |
| `$EB`, `$EC` | 1 s | selcall alert `$EB`; selcall resend `$EC` |

### 16.3 Flag bytes

| Bit | `$10` faults (any ≠ 0: `$C1` to head) | `$11` | `$12` head messages pending |
|---|---|---|---|
| 0 | bad byte from the head | **transmitting** | – |
| 1 | – | Tx synth loaded (cleared by `select_channel`) | `$A6` squelch open |
| 2 | ADC IRQ timing | send head config | `$A4` squelch closed |
| 3 | RAM config (`$68` ≠ 0x1F32) | head poll due | – |
| 4 | synthesiser fault (relock retries used up) | **PA7 and head `$46`** (§7.2) | – |
| 5 | window `$47` | synth relock request (set at 0x09A6) | – |
| 6 | window `$48` (blocks Tx) | scanning | `$C1` sent |
| 7 | **PA fault** (Tx power window) | scan state | – |

| Bit | `$13` | `$14` | `$15` Tx requests |
|---|---|---|---|
| 0 | selcall decode digit flag | **head `$46` held** | **mic PTT** (PA6) |
| 1 | `tx_stop` handshake | unlock / window-`$47` fault seen | **head PTT** (`$44`) |
| 2 | – | scan | – |
| 3 | – | **head poll missed** | – |
| 4 | display refresh | unlock blanking (`$5C`) | – |
| 5 | key held | display | selcall sending |
| 6 | **on a vote/scan channel** (home in `$50`) | – | reverse tone burst armed |
| 7 | – | selcall | – |

| Bit | `$16` Tx inhibits | `$17` | `$18` audio mute reasons (any = muted) |
|---|---|---|---|
| 0 | scan | selcall encode | synth settling (Tx load) |
| 1 | – | – | synth settling (Rx load) |
| 2 | Tx timer expired (until PTT is released) | no PTT pressed | **selcall mute** |
| 3 | **C/R busy lockout** (§7.2) | – | **CTCSS mute** (§7.2) |
| 4 | – | – | scan |
| 5 | vote | – | squelch |
| 6 | – | – | economiser |
| 7 | start-up hold-off | – | start-up / channel change / vote |

`tx_inhibited` blocks Tx if `$10.6` is set, if any of `$16` bits 4–7 is set, or if any of `$16` bits 0–3 is set and `$15` bits 4–7 are all clear.

| Bit | `$19` | `$1A` UART | `$1B` | `$1C` |
|---|---|---|---|---|
| 0 | – | **byte received** (runs `head_key_dispatch`) | PTT refused / Tx stopped | – (cleared by scan) |
| 1 | – | sending | **key beep** | Tx synth settle wait (`$55`) |
| 2 | **monitor** (`fn_monitor_toggle`; also set by `squelch_task`) | UART state | – | Rx synth settle wait (`$55`) |
| 3 | – | UART state | **reject beep** | display timer running (`$63`) |
| 4 | **squelch open** | UART state | selcall | – |
| 5 | squelch state (`squelch_task`) | UART state | **C/R channel** | **head poll waiting** |
| 6 | – | UART state | key hold | **Tx timer expired** |
| 7 | – | UART state | key hold | tested before Tx; never set by a bit instruction |

`$1D`, `$1E` bit 1 = display digit enables. `$1F` = scan state (`scan_task`).

### 16.4 External RAM `$A0`–`$EC` (selcall)

`$A0`–`$A4` selcall state flags (`$A3` bits 4–7 = code matches, §15.3); `$BE`–`$C3` encoder/decoder counters and current digit; `$C7`–`$E1` the selcall code buffers (`$CA`/`$D4` = copies of 0x1F67/0x1F7A, checked by `selcall_ram_check`, sum at `$C9`) and display copies (`$CE`/`$CF`, `$DE`–`$E1`). `$E7`–`$EC` are soft timers (§16.2).

Peripherals: `$80` selcall tone chip, `$81` CTCSS tone chip (§7.2), `$82` output latch (bit 1 CTCSS gate, bit 2 tone-detect input, bit 5 set per channel), `$84`–`$86` tone-chip set-up (§2).


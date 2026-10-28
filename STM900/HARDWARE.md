# Original control hardware

This is what an STM32 has to replace or drive. It combines two sources:

* **FM93** = the *Philips FM93 Service Manual*, §3.3 "Central Control" and §3.5 "Local Control". The FM93 uses the same control design as the FM92: a 146805E2 with an external 8 KB EPROM, and the same signalling hybrids.
* **FM92** = the disassembly of the FM92R and FM92L masters (`../firmware/FIRMWARE.md`).

Unconfirmed points are marked **(inferred)**. The manual's schematics and parts lists are scanned images, so pin numbers and the control board's full parts list still have to be read from them.

## 1. Parts the STM32 replaces or talks to

| Ref (FM93) | Part | Job | STM32 |
|---|---|---|---|
| IC408 | MC146805E2 (40-pin DIP) | CPU, 112 bytes of RAM, two 8-bit ports, timer, multiplexed external bus | **Replaced** |
| (EPROM) | 2764 / 27C64, 8 KB | Firmware and channel data (SA No. 99997 "8k EPROM") | **Replaced** (internal flash) |
| (address latch) | not named in the text **(inferred: 74HC373-type)** | Latches the low address byte for the EPROM | Not needed once the EPROM is gone |
| IC405 | hex latch ("latch 2") | Tx/Rx control lines | Kept, driven from port A plus a strobe |
| IC415 | NSC810 RAM / I/O / timer (optional) | Memory-mapped ports for the signalling hybrids, 128 bytes of RAM, timers | Kept and driven over an emulated bus, *or* removed with the hybrids wired straight to the STM32 |
| IC407 | monostable + Schmitt trigger | On/off key and power-up reset | Kept: it drives RESET and PA5 |
| IC401 | permanent 5 V regulator (+5VP) | Always-on supply to IC408, IC407, IC405 and IC415 | Powers the STM32 board through a 3.3 V LDO |
| IC411 | switched 5 V regulator (+5VS) | Everything else | See §3 |
| U402 / U403 | selcall hybrid modules | Selcall encode/decode | Via the NSC810 or STM32 GPIO |
| U405 | CTCSS encoder or encoder/decoder/RTB module | CTCSS | Via the NSC810 or STM32 GPIO; could later be replaced by the STM32 DAC |

## 2. Clock and timing

* FM93 (UHF): 5 MHz crystal XL401 on the 146805E2 oscillator, divided by 5 internally, gives a **1 MHz** bus clock.
* The timer divides by 416, giving the **≈2.4 kHz** foreground interrupt. This matches the 415 µs tick found in the FM92 disassembly.
* Latch 2 is rewritten every **833 µs** (every second tick).
* The keys are scanned every **13.3 ms** (32 ticks), matching the FM92's 16-slot table.
* The CTCSS module needs a **1 MHz clock** input (FM93 manual, U405). Where it comes from isn't stated in the text. If it is the 146805E2's bus clock, the STM32 must supply it **(inferred)**.

## 3. Power: AS keeps the switched supply on

The CPU and the critical CMOS parts sit on +5VP, which is always on. "Off" means the firmware has executed `STOP`.

The switched rail +5VS is enabled by **address-strobe pulses**. AS drives TR404, which charges R435/C432, and that holds TR406/TR405 on and feeds IC411. After the third or fourth AS pulse the rail comes up. When the CPU stops, AS sits at 0 and +5VS turns off.

A replacement CPU must therefore:

* produce a steady AS pulse train whenever the radio is on (otherwise most of the radio has no power);
* hold AS low when it is off;
* draw very little current from +5VP while off.

## 4. Port usage

### Port B

| Pin | FM93 (manual) | FM92 (disassembly) |
|---|---|---|
| PB0 | units display latch strobe | FM92R: serial link to the head. FM92L: display low digit |
| PB1 | tens display latch strobe | FM92R: 1.2 kHz square wave. FM92L: display high digit |
| PB2 | mute detect (input) | strobe for latch `$2A` (ADC mux select) |
| PB3 | latch 2 strobe | strobe for latch `$29` (audio / mute) |
| PB4 | power relay | strobe for latch `$2C` (Tx power, VCO band) |
| PB5 | VHF oscillator frequency switch | synthesiser data strobe |
| PB6 | synthesiser program enable | synthesiser load enable |
| PB7 | indicator latch strobe | FM92L: LED latch strobe |

The two are clearly the same family but **not pin-identical**. The FM92 board must be traced in its own right.

### Port A

* **FM93:** PA0–PA3 are the shared data lines for the display BCD digits, the indicator latch (PA0 red Tx LED, PA1 display blanking, PA2 amber Rx LED, PA3 decimal point) and latch 2. Every 13.3 ms they are briefly switched to inputs to read the keys (active low, through series resistors R511/R513/R514). PA5 tells an on/off reset from a supply-transient reset.
* **FM92:** port A is the data bus to the external latches and the synthesiser. PA6/PA7 are inputs (PTT, hook/monitor **(inferred)**). PA5 senses the power switch.

### Latch 2 (IC405), from the manual

Transmit enable, VCO offset, Rx AF / speaker enable, microphone inhibit, alarm tone, PA enable. Tx on/off timing is done in software.

## 5. Synthesiser: FM93 and FM92 differ

* **FM93:** NJ8822 with a ÷64/65 prescaler, loaded serially. PA0 is the clock (data taken on the falling edge), PA1 is data, and PB6 is the program enable. 28 bits, MSB first: 17 frequency bits, then 11 reference-divider bits. The firmware watches the out-of-lock line and retries up to 16 times (~500 ms) on transmit.
* **FM92:** loaded as 4-bit one's-complemented BCD nibbles with a strobe on PB5 and an enable on PB6, matching the HEF4750/4751 family **(inferred)**.

## 6. The NSC810 and the FM92's `$80`–`$86`

The FM92 firmware reads and writes `$80`, `$81`, `$82` and `$84`–`$86`, and uses external RAM at `$A0`–`$EC`. That fits an NSC810 on the multiplexed bus **(inferred: check the register offsets against the NSC810 data sheet and the board)**:

| Address | NSC810 register | FM92 use |
|---|---|---|
| `$80` | port A data | selcall hybrid (FM93 manual: U402 on NSC810 port A) |
| `$81` | port B data | CTCSS module |
| `$82` | port C data | output latch |
| `$84`–`$86` | data-direction registers A, B, C | tone-chip set-up |
| `$A0`–`$EC` | on-chip RAM **(inferred mapping)** | selcall buffers, extra timers |

The selcall wiring given in the FM93 manual is: PA0–PA3 tone code (output to encode, input to decode), PA4 encode/decode select, PA5 external alarm, PA6 bidirectional. CTCSS module (encoder only): D0–D5 tone select, pin 15 tone gate, pin 17 reverse tone burst (active low), pin 16 decode output (active low).

## 7. Signals an STM32 in the CPU socket must provide

| Group | Count | Direction | Notes |
|---|---|---|---|
| PA0–PA7 | 8 | bidirectional | Latch data, key inputs, PA5 on/off sense |
| PB0–PB7 | 8 | mostly out | Strobes, synthesiser enable, serial link (FM92R) |
| B0–B7 (multiplexed address/data) | 8 | bidirectional | Only needed if the NSC810 stays |
| A8–A12 | 5 | out | Probably unneeded without the EPROM; check the NSC810 chip-select decode |
| AS, DS, R/W | 3 | out | **AS also keeps +5VS on (§3)** |
| RESET | 1 | in | From IC407 |
| IRQ | 1 | in | FM92: ADC comparator, timed against the timer |
| TIMER | 1 | in | Check whether it is used |
| OSC1/OSC2 | 2 | – | The crystal is no longer needed. The 1 MHz to U405 may have to be generated (§2) |
| VDD / VSS | 2 | power | +5VP |

All of these are 5 V CMOS levels; the NSC810 ports driving the hybrids are TTL-compatible.

## 8. Still to find on a real board

1. The FM92 control board's schematic or trace: where AS, DS, R/W, A8–A12 and the NSC810 chip select go, and what the address latch is.
2. The source of U405's 1 MHz clock.
3. The 146805E2 pins actually used (TIMER, NUM).
4. The standby current budget on +5VP.
5. A logic-analyser capture of a working radio: ports, AS/DS, and the synthesiser load. This is the reference trace for the adapter.

# Original control hardware

This is what an STM32 has to replace or drive. It is put together from:

* **FM93**: *Philips FM93 Service Manual* (`../docs/PHILIPS FM93 SERVICE MANUAL.pdf`). §3.3 "Central Control", §3.5 "Local Control", and the schematic **Figure 7.6B, Synthesiser/Control P.C. Board (Control Section)**, on PDF page 54.
* **FM92**: the disassembly of the FM92R and FM92L masters (`../firmware/FIRMWARE.md`).
* **VK2DOT**: *Philips FM92E Conversion to 6 Meters*, Rod McCosker VK2DOT, v3.9, 2007 (`../docs/FM92E-Modification.pdf`). Board photos, connectors, and the FM900 service notes compiled by VK4KCS. Its FM91 schematic page (§42) is blank in this copy.
* **VK3BYY**: *Philips FM92 (FM900) tech notes*, Mark Harrison VK3BYY, 2006 (`../docs/Philips FM92 .pdf`).

Statements not shown directly by a source are marked **(inferred)**.

## 1. The FM92 uses the FM93's control design

The VK2DOT photo of an FM92E synthesiser/control board with its cans off (§16, PDF page 25) shows the same parts, with the **same reference numbers in the silkscreen**, as the FM93 schematic:

| Ref | Part (FM93 schematic) | Seen on the FM92E board |
|---|---|---|
| IC408 | MC146805E2 microcomputer | MC146805E2P, socketed |
| IC409 | 74HC373 address latch | yes |
| IC410, IC414 | 74LS00 quad NAND | 2 × SN74LS00N |
| IC412 | 27C64 EPROM | 28-pin EPROM, socketed |
| IC413 | 74LS260 dual 5-input NOR | yes |
| IC415 | NSC810 RAM / I/O / timer | NSC810AN-3I |
| IC405 | 4174B hex D latch ("latch 2") | **three** MC14174BCP. The FM92 firmware drives three port-A latches (`$29`, `$2A`, `$2C`); the FM93 has one |
| synthesiser | NJ8822 (FM93) | **HEF4751VD** plus a second large IC in the synthesiser can, which supports the FM92's HEF4750/4751 BCD loading **(inferred for the HEF4750)** |

So the bus, decode, power and reset circuitry below (taken from the FM93 schematic) should apply to the FM92. The port-A latches, the synthesiser and the port-B assignments differ (§5, §6).

VK3BYY also notes that both the EPROM and the microprocessor are in **IC sockets**, so an adapter that plugs into the IC408 socket is practical.

## 2. IC408 (MC146805E2) pinout as wired

From Figure 7.6B:

| Pin | Signal | Connection |
|---|---|---|
| 1 | RESET | from IC407 (on/off and power-fail reset, §4) |
| 2 | IRQ | 10 k pull-up R424 to +5VP and a test point; unused on the FM93, which has no A-D. FM92: ADC comparator |
| 3 | LI | grounded |
| 4 | DS | to IC410/IC414 (RD/WR generation, EPROM OE) |
| 5 | R/W | to IC410/IC414 |
| 6 | AS | IC409 latch enable, NSC810 ALE, **and the +5VS power switch (§4)** |
| 7–14 | PA7–PA0 | data to the latches and display; key inputs; SD/SCLK to the synthesiser (FM93) |
| 15–19 | A12–A8 | EPROM A12–A8; IC413 NOR (page-0 decode for the NSC810) |
| 20 | VSS | |
| 21–28 | AD7–AD0 | multiplexed bus to IC409, EPROM data, NSC810 AD0–AD7, IC413 |
| 29–36 | PB7–PB0 | §5 |
| 37 | TIMER | grounded through R429 10 k; the timer runs from the internal clock |
| 38, 39 | OSC2, OSC1 | UHF: crystal XL401 (5 MHz). VHF: an external 5.0 MHz oscillator (XL402, TR409/TR410/TR411, fed from unswitched 13.8 V via D405) drives OSC1 through R431 |
| 40 | VDD | +5VP |

## 3. Address decoding

| Device | Decode | Result |
|---|---|---|
| EPROM IC412 | A0–A7 from IC409 (latched on AS); A8–A12 from the CPU; data on AD0–AD7; OE from DS/R/W through IC410 | The 8 KB image appears at `$0000`–`$1FFF`; the CPU's own RAM and I/O hide `$0000`–`$00FF` |
| NSC810 IC415 | **CE** (active high, pull-up R449) = A8–A12 all low (IC413 NOR) AND AD7, through IC410 and IC414: selected for `$0080`–`$00FF` only. **IO/M̄** (pin 7, pull-up R450) = NOR(AD5, AD6) from the second half of IC413. ALE = AS. RD/WR from DS and R/W through IC414 | `$80`–`$9F` = NSC810 I/O registers; `$A0`–`$FF` = NSC810 RAM |

This confirms the FM92 firmware's use of `$80`–`$86` (NSC810 ports and direction registers) and `$A0`–`$EC` (NSC810 RAM). The NSC810 is optional on the FM92 (the "I/O Exp" hardware option; VK2DOT §34: voting isn't selectable without it).

## 4. Power, reset and the clock

| Part | Job |
|---|---|
| IC401 78L05 → **+5VP** | Always on, from unswitched 13.8 V through D402/R405. Supplies IC408, IC407, IC405 and the NSC810 |
| C427 0.047 F | Super-capacitor on +5VP: memory backup through short supply loss (VK3BYY "Super Cap") |
| Battery pack PCB 3502 349 97190 | Optional battery on +5VP |
| D403 (9V1 zener), TR401/TR402 | Supply monitor feeding the reset logic |
| IC407 4011B | On/off key monostable and power-fail reset → RESET; also drives PA5 so the firmware can tell an on/off press from a supply transient |
| TR404 → R435/C432 → TR406 → TR405 → IC411 LM340-T5 → **+5VS** | AS pulses drive TR404; the integrated pulses hold TR406/TR405 on and feed IC411. No AS pulses = +5VS off. The EPROM, IC409, the 74LS logic and the option modules are on +5VS |
| D404 | Diode linking +5VS and +5VP (direction not legible) |

The bus clock is OSC ÷ 5 = **1 MHz**. The timer divides by 416, giving the **≈2.4 kHz** tick seen in the FM92 disassembly. Latch 2 is rewritten every 833 µs, and the keys are scanned every 13.3 ms.

The CTCSS module U405 needs an "external 1 MHz clock input" (FM93 manual). On the schematic its pin 11 is fed from the NSC810 area, and NSC810 timer 0 has its input (T0 IN, pin 3) and output (T0 OUT, pin 6) wired out. So the 1 MHz is probably NSC810 timer 0 clocked from the bus **(inferred)**.

## 5. Port B

| Pin | FM93 (manual + schematic) | FM92 (disassembly) |
|---|---|---|
| PB0 (36) | units display latch | FM92R: serial link to the head. FM92L: display low digit |
| PB1 (35) | tens display latch | FM92R: 1.2 kHz square wave, very probably the link **clock** (the head cable has a shielded data/clock pair, VK3BYY). FM92L: display high digit |
| PB2 (34) | mute detect (input) | strobe for latch `$2A` (ADC mux select) |
| PB3 (33) | latch 2 (IC405) clock | strobe for latch `$29` (audio / mute) |
| PB4 (32) | power relay | strobe for latch `$2C` (Tx power, VCO band) |
| PB5 (31) | VHF oscillator switch | synthesiser data strobe |
| PB6 (30) | synthesiser program enable (PE) | synthesiser load enable |
| PB7 (29) | indicator latch | FM92L: LED latch strobe |

## 6. Port A, latches and synthesiser

* **FM93:** PA0/PA1 are SCLK/SD to the NJ8822 (28 bits, MSB first, clocked on the falling edge, PE = PB6). PA0–PA3 also carry the display BCD, the indicator latch bits and the latch 2 data, and are switched to inputs every 13.3 ms to read the keys (active low through R511/R513/R514). Latch 2 (IC405, 4174B) outputs: Tx enable, VCO offset, Rx AF enable, microphone inhibit, alarm tone, PA enable.
* **FM92:** port A is the data bus to three 4174B latches and the HEF4750/4751 synthesiser (4-bit one's-complemented BCD, strobe PB5, enable PB6). PA6/PA7 are inputs (PTT, hook/monitor **(inferred)**); PA5 senses the on/off key.

## 7. NSC810 to the option modules

| NSC810 | Module |
|---|---|
| PA0–PA7 (pins 21–28) | U402 selcall hybrid pins 5, 2, 3, 4, 21, 17, 14, 6. PA0–PA3 tone code, PA4 encode/decode, PA5 alarm, PA6 bidirectional |
| PB0–PB5 (pins 29–34) | U405 CTCSS pins 7, 6, 4, 13, 22, 14 = D0–D5 tone select |
| PB6, PB7, PC… | U405 pins 15 (tone gate), 16 (decode out, active low), 17 (RTB, active low); external input / alarm |
| T0 OUT (pin 6) | U405 pin 11, 1 MHz clock **(inferred)** |

The module pins are TTL-compatible.

## 8. Connectors

* **SK407 → front panel SK501 (FM93 local control):** 5 on/off, 7 Rx output, 8 PTT, 9/12 power ground, 11/13/15/17 PA3/PA2/PA1/PA0, 14 Rx PA input, 16 indicator latch, 18 mute adjust, 19 units latch, 20 tens latch.
* **SK405 (FM92):** pins 1 and 3 carry the microphone cradle reed switch (VK2DOT §26).
* **Handset socket (FM92E):** 1 cradle, 2 power ground, 3 microphone ground, 4 speaker, 5 microphone active, 6 Rx audio out, 7 PTT, 8 not used (VK2DOT §32).
* **Remote head cable (FM92R), DB-15:** 6 unshielded wires (power, ground, mute, speaker, PTT, on/off), 2 single shielded (Rx audio in, Rx audio out), 2 shielded pairs (microphone; data/clock) (VK3BYY). The remote head has its own microprocessor.

## 9. What this means for the STM32

* **AS must keep pulsing.** It powers +5VS, latches the NSC810 address (ALE) and feeds IC409. While the radio is on, the STM32 must keep producing AS pulses even when it isn't using the bus.
* **Bus only for the NSC810.** With the EPROM gone, the STM32 needs AD0–AD7, AS, DS and R/W, and must hold A8–A12 low when it addresses `$80`–`$FF`. Alternatively, remove the NSC810 and drive the modules from STM32 GPIO.
* **Logic levels.** The 74LS00, the 74LS260 and the NSC810 bus inputs are TTL-level, so 3.3 V outputs drive them. Port A and port B go to **4000-series CMOS** latches (4174B, 4011B) at 5 V, which need about 3.5 V for a high. Those lines need 5 V buffers (74HCT). The inputs (keys, PTT, IRQ, RESET, PA5) need 5 V-tolerant pins.
* **No clock output needed.** The STM32 replaces the oscillator. The 1 MHz to U405 comes from the NSC810 timer **(inferred)**, so the STM32 must keep the bus timing that clocks it (or generate 1 MHz itself if the NSC810 goes).
* **Standby.** +5VP is backed by a 0.047 F super-cap (and optionally a battery). The STM32's off-state current has to be comparable with a 146805E2 in STOP (a few µA) to keep the same hold-up time.
* **Unused pins.** TIMER (grounded), LI (grounded) and, on the FM93, IRQ.

## 10. Still to find

1. FM92 port-A latch wiring: which 4174B outputs drive what (the three latches `$29`, `$2A` and `$2C`), and the ADC comparator on IRQ. An FM92 schematic or a board trace is needed; the FM91 schematic in VK2DOT §42 is missing from this copy.
2. Confirm that U405's 1 MHz comes from NSC810 T0 OUT, and what drives T0 IN.
3. The FM92R remote-head link: confirm PB0 = data and PB1 = clock on the DB-15, and find the pinout.
4. Measure the standby current on +5VP.
5. A logic-analyser capture of a working FM92: ports, AS/DS, and synthesiser loads. This is the reference trace for the adapter.

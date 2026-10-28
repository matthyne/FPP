# Logic-analyser captures of the FM92R

Captures from a working **FM92R, A band (148–174 MHz)**, taken with PulseView and a 24-channel analyser. They give:

* the wiring facts still missing from `../HARDWARE.md` §10: what each port-A latch bit does, the ADC timing on IRQ, the head link, and whether the NSC810 is fitted;
* a reference trace that the STM900 adapter (and the 6805 emulator) must reproduce.

`fm92cap.py` decodes the saved `.sr` files (Python 3, stdlib only):

```bash
python3 fm92cap.py info  capture.sr          # sample rate, length, activity per channel
python3 fm92cap.py ports capture.sr          # setup A: latches, synth loads, IRQ, head link
python3 fm92cap.py bus   capture.sr --csv bus.csv   # setup B: every bus cycle
python3 -m unittest test_fm92cap             # decoder self-test
```

## 1. Before you start

* **Disconnect the 13.8 V supply before fitting or removing the clip.** The CPU area stays powered while the radio is "off", and it's easy to short 13.8 V or 5 V when the boards are swung out (VK2DOT §7).
* Use a **DIP-40 test clip on IC408** (the MC146805E2, socketed on the synthesiser/control board). It avoids probing pins on a live board.
* Connect the analyser **ground to pin 20 (VSS)** before any signal lead. Watch for ground loops if the PC is mains-earthed and the radio runs from a bench supply.
* The radio is **5 V logic**. Check that your analyser inputs accept 5 V, and set the threshold to about 1.5–2.5 V if it's adjustable.
* **NSC810:** look beside the CPU for a second 40-pin chip marked NSC810 (IC415). Setup B also shows it: with no NSC810, nothing answers at `$80`–`$FF`.
* Optional but useful: read the radio's EPROM into a `.BIN` (it's socketed under the screening can) and keep it with the captures. Web FPP's *Read image* tab shows its channels, so the synthesiser loads can be matched to them.

## 2. Probe maps

Name the channels in PulseView **exactly** as shown; the decoder finds signals by name. Pin numbers are IC408's (`../HARDWARE.md` §2).

### Setup A: ports (20 channels)

| Name | Pin | | Name | Pin |
|---|---|---|---|---|
| PA0 | 14 | | PB0 | 36 |
| PA1 | 13 | | PB1 | 35 |
| PA2 | 12 | | PB2 | 34 |
| PA3 | 11 | | PB3 | 33 |
| PA4 | 10 | | PB4 | 32 |
| PA5 | 9 | | PB5 | 31 |
| PA6 | 8 | | PB6 | 30 |
| PA7 | 7 | | PB7 | 29 |
| AS | 6 | | IRQ | 2 |
| DS | 4 | | RESET | 1 |

Sample rate **4 MHz** or more. Port events take microseconds; the head link runs at about 1200 baud.

### Setup B: full bus (24 channels)

| Name | Pin | | Name | Pin |
|---|---|---|---|---|
| AD0 | 28 | | A8 | 19 |
| AD1 | 27 | | A9 | 18 |
| AD2 | 26 | | A10 | 17 |
| AD3 | 25 | | A11 | 16 |
| AD4 | 24 | | A12 | 15 |
| AD5 | 23 | | AS | 6 |
| AD6 | 22 | | DS | 4 |
| AD7 | 21 | | RW | 5 |

plus **PA0–PA7** (pins 14–7) on the remaining 8 channels. Sample rate **20 MHz** or more (1 MHz bus with short AS/DS pulses). This records every bus cycle: instruction fetches, reads and writes, as a CSV trace.

## 3. Captures to take

Save each as a `.sr` file (PulseView *File → Save*) with the name given. Note anything you did during the capture (for example "pressed channel up at about 2 s").

### Setup A

| File | Trigger | Do |
|---|---|---|
| `a1-poweron.sr` | RESET rising | Power on from the head. Capture ~1 s: start-up, head configuration, the first synthesiser load |
| `a2-chanup.sr` | PB6 rising | Channel up, then channel down |
| `a3-ptt.sr` | PB6 rising, pre-trigger ~50 ms | Press PTT for ~1 s (into a dummy load), release |
| `a4-power.sr` | PB6 rising | PTT on a high-power channel, then on a low-power one (if the radio has one) |
| `a5-mute.sr` | none, ~2 s | Sweep the mute knob slowly from one end to the other |
| `a6-idle.sr` | none, ~2 s | Do nothing: the steady rhythm of latch refreshes, ADC readings and link traffic |
| `a7-poweroff.sr` | none | Power off from the head; AS should stop when the CPU executes STOP |

### Setup B

| File | Trigger | Do |
|---|---|---|
| `b1-poweron.sr` | AS first pulse | Power on: as long a capture as memory allows |
| `b2-idle.sr` | none | ~100 ms of idle running |
| `b3-ptt.sr` | none | Press PTT during the capture |

## 4. Where to put them

Put the files in `STM900/capture/data/` and commit them (or tell me if they are too big for the repo). I'll decode them, fill in `../HARDWARE.md` §10, and update `../../firmware/FIRMWARE.md` where the capture confirms or corrects an **(inferred)** item.

## 5. What the decoder reports

* **Latch writes:** every pulse on PB2 / PB3 / PB4 with port A's value as the pulse ends. The FM92 firmware calls these latches `$2A` (ADC mux), `$29` (audio / mute) and `$2C` (Tx power, VCO band; written inverted).
* **Synthesiser loads:** each window with PB6 high, listing port A at every PB5 strobe and its low nibble (the one's-complemented BCD digits in `FIRMWARE.md` §3.1).
* **IRQ:** each falling edge, with the time since the last latch `$2A` write: the single-slope ADC conversion time for that mux channel.
* **Head link:** 8E1 frames on PB0 at 1200 baud (`--baud` to change). The link is half-duplex on one wire, so bytes from both the radio and the head appear. PB1's average frequency is printed too.
* **Bus:** each cycle's address (AD0–AD7 latched on AS falling, plus A8–A12), data (AD0–AD7 just before DS falls) and R/W. It summarises AS gaps (STOP or WAIT) and all accesses to `$80`–`$FF`.

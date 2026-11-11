# Converting an A-band FM92 (L or R) to 2 m (144–148 MHz)

This guide converts an **A-band** (148–174 MHz) Philips FM92, local (FM92L) or remote-head (FM92R), to the 2 m amateur band.

Many FM92s came out of CFA (about 162–163 MHz) and Victoria Police service and were moved to 2 m this way. Nothing changes in the hardware. You burn a new EPROM, then re-align the radio about 15–20 MHz lower:

1. VCO
2. receiver front end
3. power amplifier (PA)
4. deviation

**Where this comes from.** No published guide covers exactly A-band → 2 m. The steps below come from two sources:

* The programming side: this repository (`fm900gen.py`, Web FPP, `FM900_FORMAT.md`, `firmware/FIRMWARE.md`). The sample job `fm900/JOBS/2MHAM` is an A-band FM92R on 2 m, and the tools rebuild it byte-for-byte.
* The alignment side: two sets of field notes. VK3BYY covers CFA 162 MHz sets taken to 2 m. VK2DOT and VK4KCS cover the FM92E 6 m conversion, which uses the same VCO, TP201 and PA procedures. Where they disagree, both values are given.

See [Sources](#sources).

> ⚠️ **Ferrite slugs break.** Read §5.1 before touching any coil. A slug broken inside a VCO or front-end former can mean replacing the module. In VK4KCS's words: "you may as well throw the radio in the bin".

---

## 1. What you need

* An EPROM programmer and a blank **2764 / 27C64**. A 27128 or 27256 also works: see §3.4.
* A 13.8 V supply that can deliver **at least 8 A**, with heavy leads. With light cable the PLL drops out of lock on key-up.
* A 50 Ω **dummy load** and a power meter.
* A voltmeter, 0–20 V. VK4KCS says an analogue meter is better for peaking.
* A **signal generator** covering 144–148 MHz with FM, ideally 1 kHz tone at 5 kHz deviation (2.5 kHz for a 12.5 kHz set).
* **Insulated tuning tools that fit the slugs exactly**: ceramic or plastic, never metal.
* Optional: a deviation meter, a SINAD meter, a frequency counter.
* The programming software:
  * **Web FPP** in a browser, or
  * `fm900gen.py` (Python 3), or
  * the original DOS FPP. The stock DOS FPP refuses out-of-band frequencies, which is why the "altered" FPP 3.0 circulated. Web FPP and `fm900gen.py` don't refuse them.

---

## 2. Identify the radio before programming anything

Each fact below sets a digit of the 8-digit **hardware code**. A wrong digit gives an image that runs on the wrong frequencies or doesn't run at all (`FM900_FORMAT.md` §3.1).

| Find out | How | Sets | If you get it wrong |
|---|---|---|---|
| **Band** | Label or original EPROM; CFA/VicPol sets around 162 MHz are A-band | h2 = `4` | – |
| **IF: 10.7 or 21.4 MHz** | Printed on the side of the VCO module, under "RF/BW". Early sets are 10.7, later ones 21.4 | h3 | The receiver lands 10.7 MHz off frequency |
| **Local or remote head** | FM92L = controls on the body. FM92R = separate head on a DB-15 cable | h3 odd = L, even = R; this picks the `FM92L` or `FM92R` master | The firmware doesn't match the hardware. An FM92R image also switches the radio off about 3 s after power-up if no head answers its `$E4` poll (`firmware/FIRMWARE.md` §6.3) |
| **Channel spacing: 25 or 12.5 kHz** | Original programming; VHF sets are usually 25 kHz | h3 | Wrong synthesiser step and deviation |
| **Options fitted** | CTCSS board? Selcall? | h5 | Errors, or tones that don't work |

**h3 (control / spacing / IF):**

| | 25 kHz, 10.7 IF | 25 kHz, 21.4 IF | 12.5 kHz, 10.7 IF | 12.5 kHz, 21.4 IF |
|---|---|---|---|---|
| Local (FM92L) | 1 | 3 | 5 | 7 |
| Remote (FM92R) | 2 | 4 | 6 | 8 |

**Typical codes** (h0 = 9 mobile, h1 = 2 FM92, h4 = 0 standard, h7 = 0):

| Radio | Hardware code |
|---|---|
| FM92R, A-band, 25 kHz, 21.4 MHz IF, CTCSS enc/dec fitted | `92440200` |
| FM92R, as above, CTCSS encode only | `92440100` |
| FM92L, A-band, 25 kHz, 21.4 MHz IF, CTCSS enc/dec | `92430200` |
| The repository's 2 m sample (`2MHAM`) | `92440150` |

**Read and keep the original EPROM first.** Do this with Web FPP's **Read** tab or any programmer.

* The image shows what the radio was (decode it to see the old channels).
* It is your way back if something goes wrong.
* If the set has **selcall** (h5 = 3–5), you need it to carry the selcall tone memory across. The tools cannot generate that block yet (`firmware/FIRMWARE.md` §15).

**Check the radio works on its original EPROM before converting it.** These sets are 30–40 years old. Typical faults to clear first:

* dried-out voltage-doubler capacitors
* whiskers inside the VCO or front-end modules
* broken PA joints
* unsoldered ribbon cables

See §10.

---

## 3. Program the 2 m EPROM

### 3.1 Choice: keep A-band coding (recommended) or code it as B-band

The band digit h2 does more than label the radio. It chooses which side of the received signal the local oscillator sits (`FM900_FORMAT.md` §4.2). It also sets the injection-side bit (slot byte 2 bit 6 / byte 5 bit 6), which the firmware sends to a hardware latch (`firmware/FIRMWARE.md` §7).

| | Coded as **A-band** (h2 = 4) | Coded as **B-band** (h2 = 3) |
|---|---|---|
| Rx LO | low side: LO = Rx − IF | high side: LO = Rx + IF |
| Rx LO for 144–148 MHz, 21.4 IF | **122.6–126.6 MHz** | **165.4–169.4 MHz** |
| Rx LO for 144–148 MHz, 10.7 IF | 133.3–137.3 MHz | 154.7–158.7 MHz |
| Tx VCO | 144–148 MHz | 144–148 MHz |
| For comparison: the A-band set on 162 MHz (21.4 IF) | Rx LO ≈ 140.6, Tx ≈ 162 | – |
| Image (Rx ∓ 2 × IF), 21.4 IF | 101.2–105.2 MHz | 186.8–190.8 MHz |
| Verified in this repo | **Yes**: `2MHAM` and the Web FPP 2 m example | Builds fine, but no reference job |

* **Recommended: A-band coding.** It is what the repository's reference job uses, and the radio stays "A-band" as far as any later programmer is concerned. Both VCOs have to be pulled down by roughly 15–20 MHz.
* **B-band coding** is what NERG did with CFA sets (VK3BYY's "NERG3/4" EPROMs).
  * It moves the Rx LO up near where the transmit VCO used to run.
  * It swaps which VCO slug does which job. VK3BYY: "the slug nearest the audio amp (slug F) is the Tx VCO adjustment when the radio is programmed as Band-B".
  * VK3BYY also suggests using the other injection side to dodge image or paging interference. That is a reason to try it if the A-band coding leaves you with an image problem.
  * Exactly which VCO stage the injection-side latch selects is **not documented**. Treat that as an experiment.

The rest of this guide assumes **A-band coding**. If you use B-band coding, everything is the same except that the Rx and Tx roles of the two VCO slugs swap (§5.2).

### 3.2 Software code

The 15-digit software code sets options, not frequencies (`FM900_FORMAT.md` §3.2). Reasonable starting points:

* `110100201000000`, as in `2MHAM`:
  * continuous display
  * variable mute with defeat
  * no economiser
  * Tx power per channel (25/5 W)
  * vacant scan
  * no voting
  * CTCSS per channel
  * no selcall
* `110200201000000`, as in the Web FPP 2 m example: the same with a 3-minute Tx timer. Most hams want s3 = 0.
* s5 = 3 gives operator-selectable power.

On FM92 VHF only two power stages exist: 25 W and "low". FM900.EXE stores "L" as medium, and the tools copy that quirk.

**CTCSS:** set s8 > 0 only if a CTCSS board is fitted *and* h5 says so. VK3BYY found ex-CFA sets had no CTCSS or selcall boards.

### 3.3 Make the image

**Web FPP (easiest).**

1. On the **Radio** tab, choose *Start from an example → "2 m ham channelised, FM92R A-band"*. It loads 96 channels: the 2 m simplex, repeater and high-band repeater channels.
2. Fix the hardware code for your set, e.g. `92430…` for an FM92L, or another IF or spacing.
3. Edit the channels, then **Build** and download the `.bin`.

Web FPP does not warn about frequencies outside 148–174 MHz. That is deliberate.

**`fm900gen.py`.**

```sh
# 2m.csv
ch,rx,tx,power
1,144.000,144.000,H
2,146.500,146.500,H
3,147.975,147.975,H
4,146.700,146.100,H
5,147.025,147.625,L

./fm900gen.py build 2m.csv --hw 92440150 --sw 110300201000000 -o 2m.bin
#   -> master FM92R.BIN, 5 channels (1..5), step 5.00 kHz, IF -21.4 MHz
./fm900gen.py dump 2m.bin --hw 92440150 --step 5
#   slot 1 rxN 24520 (= 122.600 MHz LO)  txN 28800 (= 144.000 MHz)
#   slot 3 rxN 25315 (= 126.575 MHz LO)  txN 29595 (= 147.975 MHz)
```

These commands were run for this guide.

* `IF -21.4 MHz` confirms low-side injection.
* `rxN × 5 kHz` is the Rx LO frequency.
* With `--hw 92340150` (B-band coding) the same file gives `IF +21.4 MHz` and rxN 33080 (165.4 MHz) for 144.000.

**Program the channels you will use for alignment.** You need the **lowest and highest frequencies** you will ever use (e.g. 144.000 and 148.000), plus a mid-band channel. Put them on known channel numbers.

Programming rules (VK3BYY, from DOS-FPP experience):

* Never leave Tx or Rx blank or `000.000` on a channel. For receive-only, Web FPP and `fm900gen.py` accept `X`. They build it as the original does: Tx-enable cleared.
* Keep frequencies on the 5 kHz raster for 25 kHz sets. Off-raster channels force the 6.25 kHz step for the whole radio.

### 3.4 Burn and fit

* Burn to a 2764/27C64, e.g. `minipro -p 2764 -w 2m.bin`.
* For a 27128/27256/27512, pick the part in Web FPP's **EPROM** menu. It mirrors the 8 KB image into every bank, so the A13/A14 strapping doesn't matter (`firmware/FIRMWARE.md` §12).
* **Disconnect DC before** swinging the boards out or pulling the EPROM. The EPROM area is live even when the radio is "off" (VK2DOT §7).
* Fit the EPROM under its shield on the synthesiser/control board, then power up.
  * Channel digits should appear.
  * If only the decimal point lights, the power-up self-test failed. Check the EPROM and re-seat it, then see §10.

---

## 4. Before tuning

* Lids off; note which side each came from. Hinge out the synthesiser/control board, which is the larger one, opposite the antenna socket.
* Feed the antenna socket into the **dummy load** through the power meter, always.
* Volume up, **mute (squelch) fully anticlockwise**.
* On the 2 m channels, expect one or more of these to start with:
  * a **ticking** noise
  * a flickering Rx lamp
  * no unmuted noise
  * a display dot that stays lit after transmit

  These are all signs that the VCO is out of lock (VK3BYY, VK4KCS). They are normal before the VCO has been re-tuned.

---

## 5. VCO alignment

### 5.1 Slug-handling rules (VK3BYY)

* Use a plastic or ceramic tool that fits the slot **exactly**. Never metal.
* The slugs sit in thick anti-vibration grease. **Never force one.** Rock it gently back and forth to free it.
* Don't screw a slug onto the bottom of its former.
* If one cracks, pick the pieces out with a fine pin, or turn it from the other end. As a last resort, refit a clean slug upside down to use its good slot.

### 5.2 Procedure

The steering voltage is on **TP201**, below the VCO module next to the audio power-amp IC. Measure positive on the pin, negative on the case, and don't short the probe to the module can.

1. Select the **highest-frequency** 2 m channel in receive. Adjust the **Rx VCO (main) coil** until TP201 reads about 11.7–12 V (see the table below).
2. Key up into the dummy load on the same channel. Adjust the **Tx VCO (offset) coil** to about the same voltage.
   * The two adjustments interact a little, so repeat steps 1–2.
   * With B-band coding, the slug nearest the audio amp ("F") is the Tx adjustment (VK3BYY).
3. Select the **lowest-frequency** channel. TP201 must stay **above 4 V** on both Rx and Tx.
4. Check that every channel locks: no ticking, Rx noise present with the mute open, no red dot after Tx.

If the VCO can't reach the window:

* **Check the voltage doubler.** It feeds the PLL about 17 V for the steering line. Measure about 17 V at **IC306 pin 8**. If it's low, replace both 10 µF / 50 V electrolytics in the doubler. VK3BYY calls them C342 and C349; VK4KCS calls them C432 and C439. One sits inside the shield and one just outside, often on discoloured PCB.
* **Check VCO module pin 19:** 0 V on receive, about 10 V on transmit (VK2DOT, from an E-band set).
* **Tighten the two VCO mounting screws.**
* VK3BYY: it may not lock if the synthesiser reference is strapped (solder jumpers) for anything other than the expected step.
* A 2 m spread of 4 MHz is narrow compared with the 26 MHz the A-band VCO was designed for, so lack of range is unlikely. If you do run out of range, the remedy goes inside the VCO module: hot-plate work, see VK2DOT §19 and §39. Get advice before trying it.

**VCO voltage targets** (the sources differ; all agree on a 4–12 V working window):

| Source | Target |
|---|---|
| VK3BYY | 12 V on the highest channel, above 4 V on the lowest |
| VK2DOT | about 11.7 V on the highest channel, **not above 12 V**; they saw 5.6–7 V on the lowest |
| VK4KCS | 12 V on Rx, then 12 V on Tx |
| VK2YLD (UHF, single channel) | 10 V; "below 4 V or above 13 V won't be stable" |

---

## 6. Receiver front end

1. Coming down from a 162 MHz alignment, first screw **every Rx front-end slug in by about 4 turns**. Do it gently and don't bottom them out. After that, strong signals should get through (VK3BYY).
2. Feed a signal at the centre of the band, e.g. 146.000 MHz, 1 kHz tone at 5 kHz deviation. Use plenty of level to start with, enough to open the mute. VK2YLD needed about −45 dBm on a badly detuned set.
3. Peak the slugs, starting at **L1 (the centre slug) through L6**. Watch the voltage on test point **"S"** for a maximum (VK3BYY), or listen for the tone (VK4KCS).
4. Keep lowering the generator level so the signal stays slightly noisy while you peak.
5. **Stagger-tune** for 144–148 MHz: alternate the generator between the top and bottom of the band and set the slugs for an even response (VK3BYY).
6. Check:
   * the tone is clear below 1 µV
   * the squelch opens at **< 0.5 µV** with the mute fully anticlockwise (VK4KCS: "< 0.3 µV, buy a lottery ticket")
   * VK2YLD aims for about −120 dBm

If sensitivity stays poor, suspect a failed front-end transistor or whiskers inside the module (§10).

---

## 7. Power amplifier

Always transmit into the dummy load.

1. The PA is under the lid on the antenna side. Moving the tank down by about 15 MHz needs **more inductance**: squeeze the turns of the PA output coil together slightly before tuning (VK3BYY).
2. Key a high-power channel. Adjust the PA trimmers **C111 and C124** for maximum power at the lowest supply current. Power may peak and then fall while current keeps rising; choose the best compromise.
3. Set the **high** level with **R102**, the only pot on the PA board.
   * **Keep it at 25 W or below.** Higher is possible, but the internal regulators may sag. That causes distorted Tx audio and PLL drop-out, and shortens the life of the finals.
   * VK2YLD (UHF) suggests 25–28 W at most.
4. Supply current should stay **below 6.5 A** at 25 W into 50 Ω (VK4KCS). VK3BYY measured about 5 A at 1:1 SWR and over 8 A into a bad load.
5. Set the **low** level on a low-power channel. VK3BYY gives **R402**; VK2DOT and VK4KCS give **R403**. Check the silkscreen on your board.
6. If the set keys up but power collapses, check:
   * Q209 emitter for switched supply on transmit
   * IC201 pin 6 for oscillation. The VK4KCS fixes are 1 nF B–E on Q203, and/or 0.1 µF from IC201 pin 6 to pin 16.

---

## 8. Deviation and audio

* Ex-service sets usually have **low deviation**. With a deviation meter, speak loudly into the microphone and set **R367 (DEV, the limiter)** for a maximum of **5 kHz**, or 2.5 kHz on a 12.5 kHz set.
* Raise R367 before touching R365 (mic sensitivity), otherwise the audio clips (VK3BYY).
* Leave **R371 (MOD balance)** alone without proper test equipment, especially for packet (VK3BYY).
* The microphone's 4.7 µF pre-amp capacitor makes the audio "tinny". Removing it and backing off R365 by about 90° flattens the response (VK2TMF, VK2DOT §35).

---

## 9. Final checks

* Every programmed channel:
  * locks on Rx and Tx
  * transmits on frequency (counter or receiver)
  * receives a weak signal
* Repeater channels: the Tx offset is correct. Fit a CTCSS board for repeaters that need a tone.
* Refit the shields and lids. The VCO and front-end modules must be soldered and screwed to the ground plane.
* Label the EPROM with the hardware and software codes, and keep the job or project file. Web FPP's Read tab can decode a radio's EPROM later, but the channel names are not stored in the radio.

---

## 10. Fault table (field-notes summary)

| Symptom | Likely cause |
|---|---|
| Dead: no lights | Supply polarity or fuses, head cable seating, EPROM or CPU not seated |
| FM92R comes on, then goes off after about 3 s | Head not answering the CPU's `$E4` poll: head cable or head CPU; or an FM92R image in an FM92L |
| Only the decimal point lit, no Rx noise | Power-up self-test failed: bad EPROM or checksum, PA failure, bad SWR |
| Ticking, Rx lamp flickers, can't unmute | VCO out of lock: retune; check the doubler capacitors and VCO screws |
| Some channels work, others don't | VCO range: retune at the band edges |
| Choppy Tx, hum, PLL drops on key-up | Supply or leads too weak (needs more than 5 A, 15 A cable) |
| Deaf receiver, intermittent VCO, crackling | Whiskers inside the module (VK4KCS: open and clean); tighten the module screws |
| Very microphonic on Rx and Tx | VCO ceramic substrate lifted off a post inside the module |

---

## Sources

Local copies, in `docs/`:

* *Philips FM92 (FM900) tech notes*, Mark Harrison VK3BYY, NERG, 2006 (`Philips FM92 .pdf`). CFA 162 MHz → 2 m tune-up: VCO, Rx and PA; trouble-shooting; programming notes.
* *Philips FM92E Conversion to 6 Meters* v3.9, Rod McCosker VK2DOT, 2007 (`FM92E-Modification.pdf`):
  * §4 band plan
  * §19–20 VCO change and tune, TP201, pin 19
  * §34 VK4KCS service notes
  * §35 VK2TMF audio
  * §36 tuning an FM900 (VK4KCS)
  * §37 FPP codes
* *Philips FM93 Service Manual* (`PHILIPS FM93 SERVICE MANUAL.pdf`): control-section schematic, p. 54.

This repository:

* `FM900_FORMAT.md` §3 (codes), §4.2 (IF sign, step, injection bit)
* `firmware/FIRMWARE.md` §6.3 (head keep-alive), §7 (slot bits), §12 (EPROM types), §15 (selcall)
* `fm900/JOBS/2MHAM` (A-band FM92R on 2 m, verified byte-for-byte)

Web:

* VK2YLD, *Philips FM92*: https://vk2yld.info/fm92.htm (U-band → 70 cm retune; VCO 4–13 V limits, front-end peaking)
* VK3JED, *Retro Review: Philips FM92 Transceiver*: https://www.qsl.net/vk3jed/fm92.html (CFA sets about 163 MHz moved to 2 m)
* VK2DOT guide, online copies: https://www.manualslib.com/manual/1812987/Philips-Fm92e.html and https://www.qsl.net/vk2kfj/manuals/FM92E_6m_con2.pdf

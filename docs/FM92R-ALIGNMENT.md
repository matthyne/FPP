# FM92R RX and TX alignment recipe

Nov 26, 2026

## Before you start

Align in this order: VCO, receiver, PA, deviation. Every later step needs the PLL locked first. This recipe is for an FM92R (remote head) and uses an A-band set moved to 2 m (144.000 to 148.000 MHz, centre 146.000) as the worked example; swap in your own band edges for any other band.

It combines the 2 m conversion guide in this repo ([A-BAND-TO-2M.md](A-BAND-TO-2M.md)), pages 130 to 132 of the FM91/FM92 service manual, and the VK3BYY, VK2DOT and VK4KCS field notes. Where they disagree, both values are given. I could not read the factory FM92 Test and Alignment section (the FM91/FM900 service manual and training manual scans are too large to open here), so the limits below come from the service-manual fault-finding pages and the field notes.

**Kit**

- 13.8 V supply, at least 8 A, on heavy leads (15 A cable). Light cable makes the PLL drop out on key-up.
- 50 ohm dummy load and a 25 W power meter.
- Voltmeter, 0 to 20 V. An analogue meter is easier for peaking.
- FM signal generator, 1 kHz tone at 5 kHz deviation (2.5 kHz for a 12.5 kHz set).
- Plastic or ceramic tuning tools that fit the slugs exactly.
- A Marconi 2955 stands in for the deviation meter, SINAD meter, power meter and frequency counter. See Using your test gear.

**Channels to have programmed**

- The lowest and highest frequency you will use (for 2 m: 144.000 and 148.000) plus one mid-band channel, on known channel numbers.
- At least one channel set to low power, so you can set the low level.
- No channel with a blank or 000.000 Tx or Rx frequency; it leaves the VCO unlocked or the Tx spurious.

**Slug rule.** Never force a slug. The ferrite breaks inside the former and a broken VCO or front-end slug can mean replacing the module. Rock a stuck slug gently; the anti-vibration grease is thick.

**Where the sources disagree**

| Item | Source values | Use |
| --- | --- | --- |
| VCO target on highest channel | VK3BYY 12 V; VK2DOT about 11.7 V, not above 12 V; VK4KCS 12 V | Aim 11.7 to 12 V |
| Valid VCO window | Service manual 4 to 13 V; field notes 4 to 12 V | Keep every channel between 4 and 12 V |
| Low-power pot | VK3BYY R402; VK2DOT and VK4KCS R403 | Check the silkscreen on your board |
| Rx front-end slugs | VK2DOT and VK4KCS L1 to L6; the note in the FM900 Modifications doc says 8 slugs | Peak every slug in the can, centre one first |
| PA order | VK2DOT R102 first; VK3BYY trimmers first, then the pot | Trimmers first, R102 last |

## Using your test gear

The 2955 replaces most of the separate instruments, the signal generator is for receiver sweeps, and the analyser is for checking what the transmitter is putting out besides the carrier.

| Step | Instrument | How to use it |
| --- | --- | --- |
| 1 VCO | Spectrum analyser | Only if TP201 will not move. Sniff the VCO with a loose pickup lead. On 2 m with 21.4 MHz IF and A-band coding the Rx LO should be 122.6 to 126.6 MHz, and the Tx VCO at the channel frequency. This shows which way the slug must go. |
| 2 Rx | 2955 or generator, plus 2955 SINAD | Feed the antenna socket at 1 kHz, 3 kHz deviation (25 kHz set). Put the 2955 audio input across the speaker socket with a 4 ohm load, volume up. Lower the level to 12 dB SINAD and peak the slugs for the lowest level that still gives it. Write down the figure at 144, 146 and 148 MHz. |
| 2 Rx | Generator only | Use the by-ear method in Step 2, with the squelch-open test at the end. |
| 3 Tx | 2955 power, frequency error | Key into the 2955 RF IN/OUT N socket, not past it. The manual rates it at 150 W for a limited time (typically 2 minutes at 25 C), so 25 W is in range. Key in short bursts and stop if it shows REMOVE RF INPUT. Read power while peaking C111 and C124, and read frequency error on each band-edge channel. |
| 3 Tx | Spectrum analyser | Never connect the radio straight to the input: 25 W is +44 dBm. Take a sample from a directional coupler or a 40 dB or larger high-power attenuator into the dummy load. After squeezing the PA coil, check the second harmonic (about 292 MHz on 146 MHz) and that nothing else rides near the carrier. |
| 4 Deviation | 2955 audio generator and deviation meter | Feed a 1 kHz tone into the mic input instead of speaking loudly. Full procedure is under Measuring deviation with the 2955 in Step 4. |

## Setup and pre-checks

Put the antenna socket into the dummy load through the power meter and keep it there for the whole procedure.

1. If the set worked on its original EPROM, keep that EPROM safe. Check first that the original frequencies give noise on open squelch and about 25 W out.
2. Disconnect DC before swinging boards out or pulling the EPROM. The EPROM area stays live when the set is switched off.
3. Connect the remote head on its DB-15 cable and make sure it works. An FM92R switches itself off about 3 seconds after power-up if the head does not answer.
4. On the head, turn volume up and the mute (squelch) knob fully anticlockwise.
5. Take both lids off, noting which side each came from. Hinge out the synthesiser/control board (the larger one, opposite the antenna socket) and the receiver board.
6. Set the supply to 13.8 V. Check IC306 pin 8 is about +17 V (the voltage doubler that feeds the VCO steering line). If it is low, replace both 10 uF / 50 V doubler capacitors (C342 and C349 per VK3BYY, C432 and C439 per VK4KCS). The manual also lists IC306 pin 3 and IC303 pin 1 at about +5 V.
7. Power up. On a freshly programmed 2 m set, expect ticking, a flickering Rx lamp, no unmuted noise, and a lit display dot after transmit. That is the VCO out of lock, and the next step fixes it.

## Step 1: Synthesiser and VCO

Get the VCO steering voltage on TP201 between 4 V and 12 V on every channel, on both receive and transmit. TP201 is on the receiver board, below the VCO module beside the audio power-amp IC. Put the meter positive on the pin and negative on the case, and keep the probe off the module can.

1. Select the highest-frequency channel (148.000 on 2 m) in receive. Turn the Rx VCO slug (the MAIN coil) until TP201 reads 11.7 to 12 V, not above 12 V. Before adjustment it usually sits pinned near maximum.
2. Key PTT into the dummy load on the same channel. Turn the Tx VCO slug (the OFFSET coil) until TP201 reads about the same.
3. Repeat 1 and 2. The two slugs interact.
4. Select the lowest-frequency channel (144.000). TP201 must stay above 4 V on both receive and transmit. VK2DOT saw 5.6 to 7 V.
5. Step through every channel. You want no ticking, a steady Rx lamp, noise with the mute open, and no dot in the display after transmit. Switch the set off and on to clear a dot left over from earlier.

If the set is coded as B-band instead of A-band, the Rx and Tx roles swap: the slug nearest the audio amp (slug F) becomes the Tx adjustment.

**Reading TP201 when it will not lock.** The manual says about +16 V means the VCO is too low in frequency for phase lock, and about +1.5 V means too high.

**If you cannot reach the window**

- Check IC306 pin 8 is about 17 V (see setup).
- Check VCO module pin 19: 0 V on receive, about 10 V on transmit (VK2DOT, from an E-band set).
- Tighten the two VCO mounting screws.
- Check the synthesiser reference link: it will not lock if it is strapped for anything other than the step your EPROM expects (25 kHz, or 12.5 kHz with the matching link).
- Tap the case while watching TP201. If the voltage wanders or you hear it in the audio, the VCO is microphonic (lifted ceramic substrate), which needs the module reworked.
- A 4 MHz spread on 2 m is narrow against the 26 MHz an A-band VCO covers, so running out of range is unlikely. If it happens, the fix is inside the module (VK2DOT sections 19 and 39); get advice first.

## Step 2: Receiver

Peak the front-end slugs for lowest noise and highest signal-level reading, then confirm the squelch opens below 0.5 uV with the mute fully anticlockwise. The factory training manual says the only receiver adjustments are the front-end resonators and the mute reference, so there is no IF or discriminator alignment to do.

1. Coming down from a higher band (162 MHz to 2 m), first wind every Rx front-end slug in about 4 turns, gently, without bottoming any. Strong signals should then get through.
2. Feed the centre of the band (146.000 MHz) at 1 kHz tone, 5 kHz deviation, with plenty of level to open the mute.
3. Peak the slugs starting with L1 (the centre one) through L6, watching test point S for maximum voltage, or listening for the tone.
4. Keep lowering the generator so the tone stays just above the hash while you peak, and repeat until the level is under 1 uV.
5. Stagger-tune for the whole band: move the generator between the bottom (144.000) and top (148.000) and set the slugs for an even response.
6. Switch the signal off, mute at minimum, then slowly raise the generator until the set opens. Under 0.5 uV is good. VK4KCS jokes that under 0.3 uV means buy a lottery ticket. VK2YLD aims for about minus 120 dBm.

If sensitivity stays poor, suspect a dead front-end transistor or whiskers inside the module, and tighten the module mounting screws.

I could not read the FM92 step for the mute reference. The FM93 manual presets its receiver-board mute adjust (R251) to mid-position, but check the FM92 designation before touching anything. Leave it alone unless the squelch will not open or will not close.

**Factory checks from the FM92 service manual (25 kHz version, 12.5 kHz in brackets)**

| Check | Condition | Limit |
| --- | --- | --- |
| AF at discriminator, pin 9 of U203 (VHF) | 100 uV, 1 kHz, plus or minus 3 kHz (1.5 kHz) | 380 mV plus or minus 40 (190 plus or minus 20) |
| AF at SK203/SK403 pin 17 | same | 440 mV plus or minus 60 (520 plus or minus 70, as printed) |
| AF at SK203 pin 8 for 3 W into 4 ohm | volume up | 170 mV plus or minus 40, rms |
| Mute noise detector, SK203/403 pin 18 | RF raised until it falls | below 0.1 V, with RF under 2 uV |
| Front-end gain | 20 mV generator | above 500 mV rms at U201 pin 3 (needs a high-impedance RF millivoltmeter) |
| Local oscillator at U201 pin 7 | none | above 600 mV rms |

These are fault-finding limits for when the receiver is deaf or quiet, not a routine step.

## Step 3: Transmitter

Peak the PA for most power at the least supply current, then set the high level to 25 W or below and the low level on a low-power channel. Always transmit into the dummy load.

1. The PA is under the lid on the antenna side. If you moved the set down about 15 to 20 MHz (162 MHz to 2 m), squeeze the turns of the PA output coil together slightly first to add inductance. Skip this on a set still on its own band.
2. Key a high-power channel. Adjust the PA trimmers C111 and C124 for maximum power at the lowest current. Power can peak and then fall while current keeps rising; take the best compromise. Supply current should stay under 6.5 A at 25 W into 50 ohm. VK3BYY measured about 5 A at 1:1 SWR and over 8 A into a bad load.
3. Set the high level with R102, the only pot on the PA board. Keep it at 25 W or below. Higher is possible, but the internal regulators may sag, which distorts Tx audio, drops the PLL and shortens the life of the finals.
4. Key a channel programmed as low power and set the low level with R402 (VK3BYY) or R403 (VK2DOT, VK4KCS) on the synthesiser/control board. VHF FM92s have only two stages: 25 W and low.
5. Check on frequency with a counter or a second receiver on a few channels, including the band edges.
6. Switch off and on, key PTT on a high and a low channel, and confirm no decimal point shows in the display.

**What the display dot means.** The RF monitor (pin 3 of SK401) must sit inside a window for the selected power, otherwise the radio flags a PA fault and shows a dot. The manual gives 2 V plus or minus 0.4 V at 25 W, and valid ranges of 0.85 to 2.5 V for 25 W, 0.25 to 1.6 V for 5 W and 0 to 0.65 V for 1 W. Drive to the PA should be above 20 mW on VHF.

**If the set keys up but power collapses**

- Check the Q209 emitter for the switched supply on transmit.
- Check IC201 pin 6 for oscillation. The VK4KCS fixes are 1 nF base to emitter on Q203, and/or 0.1 uF from IC201 pin 6 to pin 16.
- Check the supply and leads. Choppy Tx or hum on the audio usually means too little current capacity.

## Step 4: Deviation and audio

Set peak deviation with R367 to 5 kHz maximum (2.5 kHz on a 12.5 kHz set). Ex-service sets usually come with low deviation. The training manual confirms R367 is the deviation gain and R365 the mic gain, both on the transmit audio hybrid U301.

1. Connect a deviation meter. Speak loudly into the microphone, counting to 10, and adjust R367 for a 5 kHz maximum.
2. Raise R367 before touching R365 (mic sensitivity). Doing it the other way round clips the audio.
3. Leave R371 (modulation balance) alone without proper test gear, especially for packet. If the audio is tinny, VK2DOT allows only a few degrees anticlockwise, seen from the track side of the synthesiser board, which adds bass and deviation. Large moves can over-deviate.
4. For a stubbornly tinny sound, remove the 4.7 uF electrolytic (C3) in the mic preamp and back R365 off about 90 degrees (anticlockwise with the board in place, clockwise from the component side). That flattens the response (VK2TMF).

Some mics have an amplified insert instead of a discrete preamp, so check which yours has before removing anything.

### Measuring deviation with the 2955

The 2955 reads FM deviation off the transmitter's own signal, so you need one lead from the radio to the 2955 and one from its AF generator to the radio's mic input. Key names below are from the original 2955 operating manual. An A, B or R model may have extra keys; the 2955B datasheet lists a peak-hold function that the original manual does not describe.

**Connections**

- Radio antenna socket to the 2955 RF IN/OUT N socket on short coax. The 2955 absorbs the power, so it replaces the dummy load for this step.
- 2955 AF GEN OUTPUT (BNC, about 5 ohm source) to the radio mic input. Put a 10 uF capacitor in series, and check the mic line for DC with a meter first: the mic preamp may be powered through that line, and the capacitor stops the 2955 loading it. That precaution is mine, not from a source.
- On the 8-pin mic socket on the radio, the FM900 Notes give pin 5 as audio in, pin 3 as mic ground and pin 7 as PTT. Mic connections vary between heads (VK3BYY), so confirm yours before wiring. You still need PTT: use the real mic's switch or ground the PTT line.
- The mic input is deliberately low sensitivity, and the mic carries its own preamp, so the 2955 needs only a small signal.

**Set up the 2955**

1. Press TX. The screen shows TRANSMITTER TEST.
2. Press SELECT until the LED above the N socket lights.
3. Press MOD FM so its LED lights.
4. Press BAND PASS for the 0.3 to 3.4 kHz filter. Press LOW PASS once or twice for the 15 kHz low-pass if you also want to see peaks above the voice band.
5. Press AF GEN, then FREQ, enter 1 kHz and end with the FREQ/LEVEL key. Press LEVEL, enter the starting level and end with FREQ/LEVEL again. The range is 1 mV to 2.55 V up to 5 kHz. Start at 1 mV.
6. Key the radio. The 2955 tunes to the carrier by itself. Deviation shows as three digits with a plus and minus peak bar, and HOLD DISPLAY freezes the reading.

**Set the limiter with R367**

1. Raise the AF level in steps (A INCR then the increment keys, or the VARIABLE control) until the reading stops climbing. That is the limiter working.
2. Go well past that point (about ten times the level) and adjust R367 until the 2955 reads 5.0 kHz, or 2.5 kHz on a 12.5 kHz set.
3. Lower the level and check the deviation falls with it.
4. Sweep the tone from 300 Hz to 3 kHz at the overdriven level. It should never exceed 5 kHz. The FM93 manual makes the same check, so treat it as a cross-check from a different model.
5. Look at the plus and minus peaks. They should be about equal. A big difference means the audio is asymmetric.
6. Repeat on the highest and lowest channels. The FM93 manual repeats this check at both ends on multi-channel sets, and you have moved the VCO.
7. Set R365 afterwards by voice: loud speech should just reach the limit and normal speech sit well below it. That is a rule of thumb, not from the sources.

**Accuracy.** The manual gives the 2955 an accuracy of plus or minus 6 percent at 1 kHz, so a 5.0 kHz reading could be anywhere from 4.7 to 5.3 kHz. If you must stay under 5 kHz, set 4.7 kHz.

**Frequency error at the same time.** With TX selected, press FREQ and enter the channel frequency. The 2955 shows the offset as a plus or minus value. Press AUTO TUNE to lock onto the corrected frequency. Check the band-edge channels.

## Step 5: Final checks and faults

The alignment is done when every programmed channel locks, receives and transmits on frequency.

- [ ] TP201 between 4 V and 12 V on every channel, Rx and Tx
- [ ] No ticking, steady Rx lamp, noise with the mute open
- [ ] Squelch opens under 0.5 uV with the mute fully anticlockwise
- [ ] 25 W or below on high, correct level on low, no display dot after transmit
- [ ] Deviation 5 kHz peak or less (2.5 kHz on 12.5 kHz sets)
- [ ] Repeater channels: Tx offset correct
- [ ] Shields and lids refitted. The VCO and front-end modules must be soldered and screwed to the ground plane
- [ ] EPROM labelled with its hardware and software codes; project file and original EPROM kept

**Faults seen during alignment**

| Symptom | Likely cause |
| --- | --- |
| No lights | Supply polarity or fuses, head cable seating, EPROM or CPU not seated |
| Comes on, then off after about 3 seconds | Head not answering: head cable or head CPU, or an FM92R image fitted in a local-head set |
| Only the decimal point lit, no Rx noise | Power-up self-test failed: bad EPROM or checksum, PA fault, bad SWR |
| Ticking, Rx lamp flickers, cannot unmute | VCO out of lock: retune, check doubler capacitors and VCO screws |
| Some channels work, others do not | VCO range: retune at the band edges |
| Choppy Tx, hum, PLL drops on key-up | Supply or leads too weak |
| Deaf, intermittent, crackling | Whiskers inside a module, or loose module screws |
| Rumbling on Rx and Tx when tapped | VCO ceramic substrate lifted inside the module |

## Sources

- This repo, [A-BAND-TO-2M.md](A-BAND-TO-2M.md): the conversion guide this recipe follows, with VK3BYY, VK2DOT and VK4KCS values.
- Philips FM92 tech notes (VK3BYY, 2006): VCO, receiver, PA and deviation tune-up.
- FM92E Conversion to 6 Meters v3.9 (VK2DOT, 2007): sections 20, 28, 34 to 36.
- FM900 Modifications and FM900-VCO-mods.md: 2 m conversion steps, microphonic VCO test, VK2TMF audio fix.
- Service manual pages 130, 131 and 132: fault-finding limits for TP201, AF levels and the RF monitor.
- FM900 Training Manual: receiver adjustments and the U301 audio hybrid (text extract only).
- FM93 Service Manual, section 4: used only to cross-check the 12 V plus or minus 0.5 V VCO target and the mute preset. It covers a different model.

# STM900

An open-source replacement for the control processor of the Philips FM92 (and FM93) mobile radios. An STM32 board takes the place of the MC146805E2 microcomputer and its 8 KB EPROM, and runs new firmware written in C.

Status: **planning**. Nothing is built yet.

* `HARDWARE.md`: what the original control board does and which signals the STM32 has to provide. It is based on the FM93 service manual and the FM92 disassembly in `../firmware/`.

## Why replace the CPU

No open-source C compiler targets the 6805. An STM32 can be programmed in C (or Rust) with free tools, and gives far more flash, RAM and peripherals. Channels could then be loaded over USB or the serial link instead of burning an EPROM.

## Plan

0. **Survey the board.** Trace the FM92 control board around the CPU and EPROM sockets. Capture a working radio with a logic analyser (ports, AS/DS, synthesiser loads) to get a reference trace. See `HARDWARE.md` §8.
1. **Adapter board, original firmware in emulation.** An STM32 board plugs into the 40-pin CPU socket, and the EPROM socket stays empty. A 6805 emulator on the STM32 runs the original master image and drives the real pins. If the radio works and the traces match stage 0, the hardware is proven. This stage is a test tool only: it runs Philips's code, so it isn't part of the open-source release.
2. **Native C firmware.** Written from the documented behaviour (`../firmware/FIRMWARE.md`), not translated from the disassembly. It sits behind a small hardware layer: latches, synthesiser, ADC timing, serial link, NSC810. The same C also builds on a PC, where it is checked against the 6805 emulator running the original image.
3. **Absorb old parts (optional).** Generate CTCSS with the DAC, decode selcall in software, and use the internal ADC instead of the single-slope comparator ADC.
4. **New features.** Load channels over USB or the head link, using the same configuration block format (`../FM900_FORMAT.md` §4) that `fm900gen.py` and Web FPP build. Web FPP could program a radio directly over WebSerial.

## Hardware notes

* **MCU:** STM32G0B1 or STM32G071 (LQFP48/64) to start with. They have 5 V-tolerant inputs, a low-power stop mode, a DAC and an ADC; the G0B1 adds USB. An STM32L4 is the fallback if standby current is too high.
* **5 V logic:** the radio is 5 V CMOS. Inputs can use the STM32's 5 V-tolerant (FT) pins. Outputs need 74HCT-family buffers, and the multiplexed bus needs a direction-controlled level shifter.
* **AS keeps the switched 5 V rail on.** The STM32 must produce AS pulses while the radio is on (`HARDWARE.md` §3).
* **Standby:** the CPU is powered permanently from +5VP, so the off state must draw microamps.

## Legal

The original firmware is Philips's copyright. The STM900 firmware must be written from the documented behaviour, not translated from the disassembly. The emulation stage, and anything that runs or contains the original image, is for testing only and is not distributed as part of STM900.

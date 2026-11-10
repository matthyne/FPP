# FM92R power-on debug guide

**Symptom:** you press on/off on the remote head and the power relay never pulls in. The switched supply never comes up, and that includes the supply to the head.

This applies to the **FM92R** and to **FM92RS**, the selcall FM92R master. Both have the same power-on code at the same addresses (0x0100–0x025A). The FM92L is the same apart from the power-state byte, which is `$21` instead of `$20`.

Sources: `FIRMWARE.md` §6.1 (reset and power control), §6.3 (head keep-alive), §8 (integrity checks), `FM92R.lst` 0x0100–0x025A, and `../STM900/HARDWARE.md` §4 (power, reset and clock). Pin numbers are for **IC408**, the MC146805E2 CPU.

## 1. What should happen

1. **While "off"**, the CPU sits in `STOP`. Its RAM is kept alive by +5VP (IC401 78L05, which is always on, plus the super-cap C427). `STOP` halts the oscillator, so AS (pin 6) stops pulsing and **+5VS** (EPROM and logic) is down.
2. **You press on/off.** IC407 pulses **RESET** (pin 1) and holds **PA5** (pin 9) high, so the firmware can tell a key press from a supply glitch.
3. **Reset code (0x011B).** The firmware reads PA5 and the power-state byte `$20` (`$11` = off, `$99` = on):

   | PA5 | `$20` | Result |
   |---|---|---|
   | high | `$11` | **switch on**: `$20 ← $99`, set latch `$2A` bit 5 (0x0134), warm start |
   | high | `$99` | switch off (`power_down_stop`) |
   | low | `$11` | stay off (treated as a supply glitch) |
   | low | `$99` | carry on running |
   | either | anything else | **cold start, which ends OFF** |

   `chk_ram_config` (0x013E) also forces a cold start when the RAM copies of 0x1F2E and 0x1F33–0x1F37 don't match the EPROM.
4. **Warm start (0x0252).** Latch `$2A` is written to the hardware: the value goes on port A and PB2 is strobed. It is `$27` when on and `$07` when off. **Bit 5 of this latch is very probably the switched-supply / relay enable (inferred).** It is the only output set at switch-on and cleared at power-down, but no capture has confirmed it yet.
5. **Integrity checks.**
   * 0x025A: the EPROM sum of 0x0100–0x1FFF must be `$FF`. If not, the firmware jumps back to the reset code.
   * Continuously: the 0x1F65 firmware signature and the 0x1F66 option checksum. If either is wrong, the radio stops (`STOP`).
6. **Head keep-alive.** The radio polls the head with `$E4` and the head must answer `$49`. If it doesn't, the radio powers down after about 3 s (`FIRMWARE.md` §6.3).

The relay stays out if any of these steps fails. The rest of this guide finds out which one.

## 2. First: listen to the relay

| What you hear | Meaning | Go to |
|---|---|---|
| Nothing | The firmware never set bit 5, or the relay driver is faulty | §3 onwards |
| A click, then it drops out about 3 s later | Head keep-alive timeout: the head isn't answering `$E4` with `$49`. Look at the data wire or the head's CPU (VK3BYY: "check microprocessor chip is seated properly in the control head") | `FIRMWARE.md` §6.3 |
| A very short blip | The radio switched on, then failed an integrity check | §3.3 |

## 3. Quick checks (meter only)

### 3.1 Press on/off twice

After the RAM has been lost (supply removed, super-cap flat, first connection to power), the first press only does a **cold start**. The cold-start code (0x015C) falls straight into `power_down_stop`, so the radio stays off. The second press should switch it on.

Fitting an EPROM with different option bytes (0x1F2E, 0x1F33–0x1F37) does the same on the first press after the swap.

If *every* press gives a cold start, the RAM isn't being kept between presses. Check +5VP and C427 (§3.2).

### 3.2 Supplies with the radio "off"

* **+5VP** (IC401 output) should be about 5 V while the 13.8 V supply is connected.
* **Super-cap C427** (0.047 F): a dead one loses the RAM over short supply dips.

### 3.3 The EPROM image

Read the EPROM back to a `.BIN` and check it:

```bash
python3 fm900gen.py dump image.bin          # look for: checksum 0x1F64=.. 0x1F65=.. (OK|BAD)
```

`dump` checks 0x1F64 and 0x1F65. To check the 0x1F66 option checksum as well (0x1F33–0x1F37 plus 0x1F66 must sum to 0 mod 256):

```bash
python3 -c "import sys;b=open(sys.argv[1],'rb').read()[:8192];print('1F66', 'OK' if sum(b[0x1F33:0x1F38])+b[0x1F66] & 0xFF == 0 else 'BAD')" image.bin
```

* A **bad 0x1F64** makes the firmware jump back to the reset code after the latch write. Usually PA5 is still high at that point, so the second pass switches the radio off. You get a blip or nothing.
* A **bad 0x1F65 or 0x1F66** stops the radio within milliseconds.
* **Bigger EPROMs (27128/27256/27512):** the CPU only sees 8 KB. Whatever bank A13 and up select must hold a valid image. Either mirror the image into every bank (the Web FPP **EPROM** menu does this), or check how those pins are strapped (`FIRMWARE.md` §12.3).
* **Rule the image out quickly:** program a known-good image, e.g. one of the reference `.BIN`s under `fm900/JOBS/`, or an image built for this radio's hardware code. If the relay then pulls in, the problem is your image.

### 3.4 The on/off wire

On the FM92R the on/off key is in the head, and the signal reaches IC407 over the DB-15 cable. Check that this wire changes level when the key is held (`../STM900/HARDWARE.md` §8; the pin number isn't known yet).

The head may be powered from the relay-switched supply. If so, check whether its on/off key needs that supply to signal at all. If it does, the radio can't be switched on from a dead head, and you would see no RESET pulse.

## 4. Scope or logic probe on IC408

Watch these while you press on/off:

| Probe | Expected | If not |
|---|---|---|
| RESET, pin 1 | A low pulse when the key is pressed | IC407, the DB-15 on/off wire, or the head's key (§3.4) |
| PA5, pin 9 | **High** when RESET is released | The firmware takes it for a supply glitch and stays off. Check IC407 and the supply monitor (D403, TR401/TR402) |
| AS, pin 6 | Pulsing at about 1 MHz after the press | The CPU isn't running (crystal, RESET), or it went straight back into `STOP` (cold start, integrity check) |
| +5VS (IC411 output) | Comes up once AS runs | The TR404 → TR406 → TR405 → IC411 chain (`../STM900/HARDWARE.md` §4) |
| PB2, pin 34 | Strobes shortly after RESET | No strobe means the code never reached 0x0252 |

## 5. Logic-analyser capture (definitive)

Use **Setup A** from `../STM900/CAPTURE.md`: a DIP-40 clip on IC408, channels named as listed there, plus the optional `ONOFF` channel. Take `a1-poweron.sr` (trigger on RESET rising, about 100 ms pre-trigger, capture about 4 s). Then run:

```bash
cd STM900/capture
python3 fm92cap.py ports a1-poweron.sr
```

The output lists the RESET, PA5 and AS power events, every latch `$2A` write, and the `$E4` / `$49` keep-alive traffic.

| Capture shows | Conclusion |
|---|---|
| RESET pulse, PA5 low at release | IC407 / PA5 path. The firmware is behaving correctly by staying off |
| RESET pulse, PA5 high, then AS stops with no `$27` write | Cold start (press again, §3.1) |
| A `$27` write, then a `$07` write soon after and AS stopping | It switched on, then shut down: checksum or signature failure (§3.3), or PA5 still high after a checksum restart |
| A `$27` write, AS running, `$E4` polls with no `$49` replies, power-down about 3 s later | Head keep-alive (`FIRMWARE.md` §6.3) |
| A `$27` write and AS keeps running, but the relay stays out | **The firmware is fine and the fault is hardware.** Go to §6 |

## 6. Hardware: from latch bit 5 to the relay

The firmware's part ends at the 4174B latch strobed by PB2 (latch `$2A`). From there:

1. Check the latch's **bit 5 output** goes high after switch-on. If not, check the latch's PB2 clock and its port-A data input.
2. Check the **relay driver transistor**: base drive, then the collector pulling down.
3. Check the **relay coil** (continuity) and its supply/fuse, and the flyback diode.
4. Check the **relay contacts** under load.

The exact FM92 path from the latch to the relay hasn't been traced yet. The FM93 service manual schematic (`../docs/`, page 54, Fig. 7.6B) is for the FM93: there the relay is on CPU PB4, so it is only a guide. Whatever you find fills a gap in `../STM900/HARDWARE.md` §10 (the port-A latch bit assignments), so please record it there.

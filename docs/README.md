# Reference documents

Third-party service manuals and notes used for the firmware analysis and the STM900 work. They remain the copyright of their authors and publishers. The notes taken from them are in `../firmware/FIRMWARE.md` and `../STM900/HARDWARE.md`, which cite them by section.

| File | Document | Used for |
|---|---|---|
| `PHILIPS FM93 SERVICE MANUAL.pdf` | Philips FM93 Service Manual (85 pages, scanned) | §3.3 central control, §3.5 local control. Schematics are the fold-out pages 42–56; **page 54 is Figure 7.6B, the control section** (146805E2, EPROM, NSC810, decode, power switching) |
| `FM92E-Modification.pdf` | *Philips FM92E Conversion to 6 Meters*, Rod McCosker VK2DOT, v3.9, 2007 (ManualsLib copy) | FM92 board photos (page 25: synthesiser/control board with cans off), connectors, hardware codes, VK4KCS service notes. The FM91 schematic page (§42) is blank in this copy |
| `Philips FM92 .pdf` | *Philips FM92 (FM900) tech notes*, Mark Harrison VK3BYY, 2006 | Head cable wiring, super-cap backup, socketed CPU/EPROM, fault finding, CTCSS letter codes |

The scanned pages have no text layer. To read a schematic, render the page at 300 dpi (for example with PyMuPDF) and crop it.

const REPO = 'https://github.com/matthyne/FPP/blob/main/';

export function HelpPanel() {
  return (
    <div class="panel help">
      <section class="card wide prose">
        <h2>About</h2>
        <p>This builds the 8 KB personality EPROM (2764) for <b>Philips FM91 and FM92</b> mobile radios. It runs entirely in your
          browser; nothing is uploaded. It re-implements the image builder in the DOS <i>FM900 Field Personality Programmer</i>
          (the Original FPP). Its output is byte-identical to the Original FPP on the sample jobs. The factory master images are
          built in.</p>

        <h3>Workflow</h3>
        <ol>
          <li><b>Radio</b>: enter the hardware and software codes from the radio's label, PIRS sheet or old <code>.JOB</code> file.
            The digit menus explain each one.</li>
          <li><b>Channels</b>: enter Rx and Tx frequencies. Leave Tx blank for simplex; type <code>X</code> for receive-only.
            Enter and the arrow keys move between rows. Use <i>Fill range</i> for a run of channels, <i>Channel plans</i> for UHF CB, and
            <i>Import CSV / paste</i> for lists from CHIRP, RepeaterBook, RadioReference or a spreadsheet.</li>
          <li><b>Scan &amp; Keys</b>: set up the scan blocks and, on the FM92, the head's function keys.</li>
          <li><b>Build</b>: download the <code>.BIN</code> and burn it to a 2764 / 27C64. For a 27128, 27256 or 27512, pick it in the <b>EPROM</b> menu: the 8 KB image is repeated in every bank.</li>
        </ol>
        <p>Your work is saved in this browser automatically. Use <b>Save</b> for a project file you can open anywhere, and
          <b> Export JOB/CHL</b> for files the Original FPP can open.</p>

        <h3>Files it opens</h3>
        <ul>
          <li><code>.JOB</code> + <code>.CHL</code> from the Original FPP (select or drop both together)</li>
          <li><code>.csv</code> / <code>.txt</code> channel lists in the <a href={REPO + 'README.md#channel-list-format'}>README format</a></li>
          <li><code>.json</code> projects saved by this page</li>
          <li><code>.BIN</code> EPROM images, opened in <b>Read image</b> to decode back into channels</li>
        </ul>

        <h3>Things to know</h3>
        <ul>
          <li><b>Row order matters.</b> The Original FPP writes scan lists in entry order. Duplicate channel numbers and VOTE channels
            take ring slots from the top of the table, in row order.</li>
          <li>Frequencies outside the radio's nominal band are allowed without a warning, because many radios have been
            re-tuned (e.g. into the amateur bands). Make sure yours actually covers them.</li>
          <li>The synthesiser step comes from the band and spacing. VHF falls back from 5 to 6.25 kHz (or the reverse) if a
            frequency is off-raster.</li>
          <li>On FM92 VHF, L power is stored as M (as the Original FPP does).</li>
          <li><b>Not supported:</b> FM93, FM97WP / waterproof radios, and the selcall tone editor (selcall tones keep their defaults).</li>
        </ul>

        <h3>Enhanced firmware (FM92R)</h3>
        <p>The <b>Firmware</b> menu on the Build tab picks the radio's own program. <b>Standard</b> is the factory master, exactly as
          the Original FPP builds. <b>Enhanced</b> is a modified FM92R firmware: after the channel number has been on the control
          head for 2 s, the head shows the channel's Rx frequency two characters at a time, 0.5 s each, then the channel number
          again, in a loop. 147.450 MHz shows <code>14 47 "7 " " 4" 45 50</code> (the point is shown as a space). It stops while
          transmitting, scanning or showing selcall digits, and whenever the channel changes it starts again.</p>
        <ul>
          <li>Only for the FM92R without selcall (hardware code digit 4 = 4 or 8, digit 6 not 3–5).</li>
          <li>The image carries a table of each channel's frequency, so Read image recognises an enhanced image and loads it back
            with Enhanced selected.</li>
          <li><b>Not factory firmware, and untested on a radio.</b> Keep the original EPROM. If the radio switches itself off after
            a few seconds or keys stop working, go back to Standard.</li>
        </ul>

        <h3>Paths the sample jobs don't cover</h3>
        <p>VOTE rings, duplicate channel numbers, the FM92L and selcall (<code>*S</code>) masters, the VHF 6.25 kHz step, L or S power,
          the VOTE, C/R and SELCALL flags, receive-only channels, and the E, T, U and W2 bands have been checked on thousands of random
          test cases, but not against the Original FPP itself. Before burning one of these, cross-check it in DOSBox:</p>
        <ol>
          <li>Export JOB/CHL here and copy both into <code>fm900/JOBS</code>.</li>
          <li>In the Original FPP, open the job and press F10 so it writes the <code>.BIN</code>.</li>
          <li>Set the same build date here and compare. Only bytes 0x1FE0–0x1FE4 (version and date) may differ.</li>
        </ol>

        <h3>More</h3>
        <ul>
          <li><a href={REPO + 'FM900_FORMAT.md'}>FM900_FORMAT.md</a>: codes, job files and the EPROM layout</li>
          <li><a href={REPO + 'firmware/FIRMWARE.md'}>firmware/FIRMWARE.md</a>: the radio's 68HC05 firmware, EPROM types and connectors</li>
          <li><a href={REPO + 'firmware/fork/README.md'}>firmware/fork/README.md</a>: the enhanced FM92R firmware</li>
        </ul>
      </section>
    </div>
  );
}

import { useMemo, useState } from 'preact/hooks';
import { formatChannels, powerLetter, scanText } from '../core/channels';
import { dump, imageKeys, imageModel, readImage } from '../core/decode';
import { CTCSS_HZ_BY_CODE, F_CR, F_ECON, F_SELCALL, F_VOTE, KEY_FUNCS, MASTER_VERSION, latin1, verifyChecksum } from '../core/fm900';
import { Project, Row, channelToRow } from '../core/project';
import { errMsg } from './App';
import { HexView } from './BuildPanel';
import { download, pickFiles, readBytes } from './files';

const hx = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

export function ReadPanel({ p, img, setImg, load }: {
  p: Project; img: { name: string; data: Uint8Array } | null;
  setImg: (v: { name: string; data: Uint8Array } | null) => void;
  load: (rows: Row[], hw: string, keys: number[] | null) => void;
}) {
  const [hw, setHw] = useState(p.hw);
  const [step, setStep] = useState(0);
  const [keepKeys, setKeepKeys] = useState(false);
  const [view, setView] = useState<'channels' | 'hex' | 'dump'>('channels');

  const open = async () => {
    const [f] = await pickFiles('.bin,.BIN', false);
    if (f) setImg({ name: f.name, data: await readBytes(f) });
  };

  const res = useMemo(() => {
    if (!img) return null;
    try {
      if (!/^\d{8}$/.test(hw)) throw new Error('enter the 8-digit hardware code of the radio');
      return { ok: readImage(img.data, hw, step || undefined) };
    } catch (e) {
      return { err: errMsg(e) };
    }
  }, [img, hw, step]);

  if (!img) {
    return (
      <div class="panel read">
        <section class="card wide empty">
          <h2>Read an EPROM image</h2>
          <p>Open an 8 KB <code>.BIN</code> read from a radio's 2764, or one made by FM900.EXE, to decode it back into a channel list.</p>
          <p><button class="primary" onClick={open}>Open .BIN…</button></p>
          <p class="hint">You can also drop the file anywhere on the page.</p>
        </section>
      </div>
    );
  }

  const d = img.data;
  const size = d.length === 0x2000;
  const id = size ? latin1(d.subarray(0x1FEB, 0x1FF0)) : '';
  const mname = Object.entries(MASTER_VERSION).find(([, v]) => v[1] === id && v[0] === d[0x1FE5])?.[0];
  const model = size ? imageModel(d) : '';
  const fm92 = hw[1] === '2';
  const chans = res?.ok?.channels ?? [];

  return (
    <div class="panel read">
      <section class="card wide">
        <div class="readhead">
          <div>
            <h2>{img.name}</h2>
            {!size ? <p class="msg bad">Expected 8192 bytes, got {d.length}.</p> : (
              <dl>
                <dt>Master</dt><dd class="mono">{mname ?? `unknown (ID "${id}", version ${d[0x1FE5]})`}</dd>
                <dt>Built</dt><dd class="mono">{hx(d[0x1FE2])}/{hx(d[0x1FE3])}/{hx(d[0x1FE4])} <small>DD/MM/YY</small>, programmer {hx(d[0x1FE0])} {hx(d[0x1FE1])}</dd>
                <dt>Checksum</dt><dd class={verifyChecksum(d) ? '' : 'bad'}>{verifyChecksum(d) ? 'OK' : 'BAD'}</dd>
                <dt>Channels</dt><dd>{d[0x1F3F]}–{d[0x1F3E]}</dd>
                {model === '2' && <><dt>Keys 1/2/4/7</dt><dd>{imageKeys(d).map((k) => KEY_FUNCS[k] ?? k).join(', ')}</dd></>}
              </dl>
            )}
          </div>
          <div class="readctl">
            <label class="field">
              <span class="lab">Hardware code <small>(not stored in the image)</small></span>
              <input class="mono" value={hw} maxLength={8} onInput={(e) => setHw((e.target as HTMLInputElement).value.replace(/\D/g, ''))} />
            </label>
            {size && hw[1] && hw[1] !== model && <p class="msg warn">The image looks like an FM9{model}, but the code says FM9{hw[1]}.</p>}
            <label class="field">
              <span class="lab">Synth step</span>
              <select value={step} onChange={(e) => setStep(+(e.target as HTMLSelectElement).value)}>
                <option value={0}>Auto{res?.ok ? ` (${res.ok.step / 100} kHz)` : ''}</option>
                <option value={500}>5 kHz</option><option value={625}>6.25 kHz</option>
                <option value={1250}>12.5 kHz</option><option value={2500}>25 kHz</option>
              </select>
            </label>
            {fm92 && <label class="check"><input type="checkbox" checked={keepKeys} onChange={() => setKeepKeys(!keepKeys)} /> Keep the image's function keys as an override</label>}
            <div class="actions">
              <button onClick={open}>Open another…</button>
              <button onClick={() => res?.ok && download(img.name.replace(/\.bin$/i, '') + '.csv', formatChannels(chans), 'text/csv')} disabled={!res?.ok}>Export CSV</button>
              <button class="primary" disabled={!res?.ok || !chans.length}
                onClick={() => load(chans.map(channelToRow), hw, keepKeys && fm92 ? imageKeys(d) : null)}>Load into project</button>
            </div>
          </div>
        </div>
        {res?.err && <p class="msg bad">{res.err}</p>}
        {res?.ok?.warnings.map((w) => <p class="msg warn">{w}</p>)}
        <p class="hint">Read-back is best effort. The software code can't be recovered (several codes give the same bits), so keep the
          project's SW code or enter the radio's. Scan lists are rebuilt in row order.</p>
      </section>

      {size && res?.ok && (
        <section class="card wide">
          <div class="viewtabs">
            <button class={view === 'channels' ? 'active' : ''} onClick={() => setView('channels')}>Channels ({chans.length})</button>
            <button class={view === 'hex' ? 'active' : ''} onClick={() => setView('hex')}>Hex</button>
            <button class={view === 'dump' ? 'active' : ''} onClick={() => setView('dump')}>Decoded dump</button>
          </div>
          {view === 'channels' && (
            <div class="gridwrap">
              <table class="grid readonly">
                <thead><tr><th>Ch</th><th>Rx MHz</th><th>Tx MHz</th><th>Power</th><th>CTCSS</th><th>Scan</th><th>Flags</th></tr></thead>
                <tbody>
                  {chans.map((c) => (
                    <tr>
                      <td class="mono">{c.num}</td><td class="mono">{c.rx}</td><td class="mono">{c.tx.startsWith('X') ? 'Rx only' : c.tx}</td>
                      <td>{powerLetter(c.flags)}</td>
                      <td>{c.ctcss ? CTCSS_HZ_BY_CODE.get(c.ctcss)?.toFixed(1) : ''}</td>
                      <td>{scanText(c.flags)}</td>
                      <td>{[[F_VOTE, 'VOTE'], [F_ECON, 'ECON'], [F_SELCALL, 'SEL'], [F_CR, 'C/R']].filter(([f]) => c.flags & (f as number)).map(([, l]) => l).join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view === 'hex' && <HexView img={d} fm91={hw[1] === '1'} from={0} to={0x2000} />}
          {view === 'dump' && <pre class="dump">{dump(d, hw, res.ok.step)}</pre>}
        </section>
      )}
    </div>
  );
}

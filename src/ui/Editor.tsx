import { useEffect, useState } from 'react'
import * as A from '../app/store'
import { S, cur, useTopic, type ExportOpts } from '../app/store'
import { Film } from './Film'
import { Left } from './Left'
import { Right } from './Right'
import { StyleBrowser } from './StyleBrowser'
import { Toolbar, Viewer } from './Viewer'
import { Icon, IconBtn, Modal } from './widgets'

function ExportDialog({ onClose }: { onClose: () => void }) {
  const picks = S.photos.filter(p => p.flag === 1).length, folder = A.canExportToFolder()
  const [o, setO] = useState<ExportOpts>({ which: picks ? 'picks' : 'norej', format: 'jpeg', quality: 80, longEdge: 0, sub: 'exports', suffix: '', dest: folder ? 'folder' : 'zip' })
  const [state, setState] = useState<{ run: boolean; i: number; n: number; msg: string }>({ run: false, i: 0, n: 0, msg: '' })
  const set = (k: keyof ExportOpts, v: any) => setO(x => ({ ...x, [k]: v })), count = A.exportList(o.which).length
  const go = async () => {
    setState({ run: true, i: 0, n: count, msg: '' })
    try { const n = await A.runExport({ ...o, quality: o.quality / 100 }, (i, n, name) => setState({ run: true, i, n, msg: name })); setState({ run: false, i: n, n, msg: `Done. ${n} file${n === 1 ? '' : 's'} written${o.dest === 'folder' ? ` to ${S.title}/${o.sub}` : ''}.` }) }
    catch (e: any) { setState(s => ({ ...s, run: false, msg: e.message === 'stopped' ? 'Export stopped.' : 'Export failed: ' + e.message })) }
  }
  return (
    <Modal title="Export" onClose={() => { A.stopExport(); onClose() }}>
      <div className="form">
        <label>Photos</label><select className="sel" value={o.which} onChange={e => set('which', e.target.value)}><option value="picks">Picks ({picks})</option><option value="norej">All except rejects ({S.photos.filter(p => p.flag !== -1).length})</option><option value="sel">Selected ({S.multi.size})</option><option value="all">Everything ({S.photos.length})</option></select>
        <label>Format</label><div className="pair"><select className="sel" value={o.format} onChange={e => set('format', e.target.value)}><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="png">PNG</option></select>{o.format !== 'png' && <><input type="number" className="numbox" min={40} max={100} value={o.quality} onChange={e => set('quality', +e.target.value)} onKeyDown={e => e.stopPropagation()} aria-label="Quality" /><span className="hint">quality</span></>}</div>
        <label>Size</label><select className="sel" value={o.longEdge} onChange={e => set('longEdge', +e.target.value)}><option value={0}>Full resolution</option><option value={4096}>4096 px long edge</option><option value={3000}>3000 px long edge</option><option value={2048}>2048 px long edge</option><option value={1600}>1600 px long edge</option></select>
        <label>Save to</label><select className="sel" value={o.dest} onChange={e => set('dest', e.target.value)}>{folder && <option value="folder">A folder inside {S.title}</option>}<option value="zip">One .zip download</option></select>
        {o.dest === 'folder' && <><label>Folder name</label><input className="textbox" value={o.sub} onChange={e => set('sub', e.target.value.replace(/[\\/]/g, ''))} onKeyDown={e => e.stopPropagation()} /></>}
        <label>File suffix</label><input className="textbox" value={o.suffix} placeholder="none" onChange={e => set('suffix', e.target.value.replace(/[\\/]/g, ''))} onKeyDown={e => e.stopPropagation()} />
      </div>
      <p className="note">Each photo is developed again from its raw file at full resolution, with its crop, masks and adjustments.</p>
      {(state.run || state.msg) && <><div className="bar"><i style={{ transform: `scaleX(${state.n ? state.i / state.n : 0})` }} /></div><p className="note">{state.run ? `${state.i} of ${state.n} · ${state.msg}` : state.msg}</p></>}
      <div className="acts">{state.run ? <button className="btn" onClick={A.stopExport}>Stop</button> : <button className="btn" onClick={onClose}>Close</button>}<button className="btn primary" disabled={state.run || !count} onClick={go}>Export {count} photo{count === 1 ? '' : 's'}</button></div>
    </Modal>
  )
}

function CullDialog({ onClose }: { onClose: () => void }) {
  useTopic('status', 'film'); const [o, setO] = useState({ pickBest: true, rejectBlinks: true, rejectSoft: true, gap: 3 }), n = S.photos.length, ready = S.checked >= n
  const withFaces = S.photos.filter(p => p.cull?.n > 0), box = (k: 'pickBest' | 'rejectBlinks' | 'rejectSoft', label: string, sub: string) => <label className="chk big"><input type="checkbox" checked={o[k]} onChange={e => setO(x => ({ ...x, [k]: e.target.checked }))} /><span>{label}<small>{sub}</small></span></label>
  return (
    <Modal title="Auto cull" onClose={onClose}>
      <p className="note">Photos taken within a few seconds of each other are treated as one burst. Each face is checked for open eyes, whether it is turned to the camera, and focus.</p>
      <div className="stats"><div><b>{withFaces.length}</b>with faces</div><div><b>{withFaces.filter(p => p.cull.blink).length}</b>eyes closed</div><div><b>{withFaces.filter(p => p.cull.soft).length}</b>soft focus</div><div><b>{withFaces.filter(p => p.cull.away).length}</b>looking away</div></div>
      {box('pickBest', 'Pick the best frame of each burst', 'Flags the highest-scoring photo as a pick.')}
      {box('rejectBlinks', 'Reject blinks', 'Only when the same burst has a frame with everyone’s eyes open.')}
      {box('rejectSoft', 'Reject soft focus', 'Only when the same burst has a sharper frame.')}
      <div className="form"><label>Burst gap</label><div className="pair"><input type="number" className="numbox" min={1} max={30} value={o.gap} onChange={e => setO(x => ({ ...x, gap: +e.target.value }))} onKeyDown={e => e.stopPropagation()} /><span className="hint">seconds between frames</span></div></div>
      <p className="note">{ready ? 'Nothing is deleted: this only sets pick and reject flags, and one undo reverses it.' : `Still checking faces: ${S.checked} of ${n}. You can run it now on what is done.`} Tinted glasses and profiles can fool the eye check, so skim the rejects.</p>
      <div className="acts"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { A.autoCull(o); onClose() }}>Run auto cull</button></div>
    </Modal>
  )
}

const KEYS: [string, string][] = [['← →', 'Previous / next photo'], ['P · X · U', 'Pick · reject · unflag'], ['1–5 · 0', 'Star rating · clear'], ['6–9', 'Colour label'], ['S', 'Switch all photos / this photo'], ['L', 'Style browser'], ['G', 'Grid view'], ['Z', 'Fit / 100%'], ['\\', 'Before (hold)'], ['J', 'Clipping warnings'], ['R', 'Crop'], ['W', 'White balance picker'], ['M · ⇧M', 'Linear · radial mask'], ['O', 'Mask overlay'], ['⌘[ · ⌘]', 'Rotate'], ['⌘Z · ⇧⌘Z', 'Undo · redo'], ['⌘C · ⌘V', 'Copy · paste adjustments'], ['⌘A', 'Select all'], ['⌘E', 'Export'], ['Tab', 'Hide panels'], ['scroll · drag', 'Zoom · pan'], ['double-click', 'Reset a slider']]

export default function Editor() {
  useTopic('view', 'status'); const [modal, setModal] = useState<null | 'export' | 'cull' | 'keys'>(null), [ready, setReady] = useState(false), [err, setErr] = useState('')
  useEffect(() => { A.boot().then(() => setReady(true)).catch(e => setErr(String(e.message || e))) }, [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement, tag = t.tagName, k = e.key, mod = e.metaKey || e.ctrlKey
      if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && (t as HTMLInputElement).type !== 'range' && (t as HTMLInputElement).type !== 'checkbox')) return
      if (modal || S.browser) return
      if (mod) {
        const l = k.toLowerCase()
        if (l === 'z') { e.preventDefault(); e.shiftKey ? A.redo() : A.undo() } else if (l === 'a') { e.preventDefault(); A.selectAll() } else if (l === 'c') A.copySettings(); else if (l === 'v') A.pasteSettings()
        else if (l === 'e') { e.preventDefault(); setModal('export') } else if (k === ']') { e.preventDefault(); A.rotate(1) } else if (k === '[') { e.preventDefault(); A.rotate(-1) }
        return
      }
      if (e.altKey) return
      const l = k.toLowerCase()
      if (k === 'ArrowRight' || k === 'ArrowLeft') { if (tag === 'INPUT') return; e.preventDefault(); A.step(k === 'ArrowRight' ? 1 : -1) }
      else if (l === 'p') A.setFlag(1); else if (l === 'x') A.setFlag(-1); else if (l === 'u') A.setFlag(0)
      else if (k >= '0' && k <= '5') A.setRating(+k); else if (k >= '6' && k <= '9') A.setLabel(+k - 5)
      else if (k === '\\') A.toggle('before', true); else if (l === 'z') A.setZoom(S.zoom === 'fit' ? 1 : 'fit'); else if (l === 'g') A.toggle('grid'); else if (l === 'j') A.toggle('clip'); else if (l === 'o') A.toggle('showMask')
      else if (l === 'r') A.setTool(S.tool === 'crop' ? 'select' : 'crop'); else if (l === 'w') A.setTool(S.tool === 'wb' ? 'select' : 'wb'); else if (l === 'v') A.setTool('select')
      else if (l === 'm') { const want = e.shiftKey ? 'radial' : 'linear'; A.setTool(S.tool === want ? 'select' : want) }
      else if (l === 's') A.setScope(S.scope === 'project' ? 'photo' : 'project'); else if (l === 'l' && S.cur) { S.browser = 'looks'; A.emit('view') }
      else if (k === 'Tab') { e.preventDefault(); A.toggle('panels') } else if (k === '?') setModal('keys')
      else if ((k === 'Delete' || k === 'Backspace') && S.maskSel >= 0 && (S.tool === 'linear' || S.tool === 'radial')) A.removeMask(S.maskSel)
      else if (k === 'Escape' || k === 'Enter') { if (S.tool !== 'select') A.setTool('select'); else if (S.grid) A.toggle('grid', false) }
    }
    const up = (e: KeyboardEvent) => { if (e.key === '\\') A.toggle('before', false) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [modal])
  const has = S.photos.length > 0
  return (
    <div id="app" className={(S.grid && has ? 'grid ' : '') + (S.panels ? '' : 'nopanels ') + (has ? 'loaded' : '')} onDragOver={e => e.preventDefault()} onDrop={e => { if (!(e.target as HTMLElement).closest('#viewer')) A.handleDrop(e.nativeEvent) }}>
      <header id="top">
        <div className="brand"><span className="logo" />Autochrome</div>
        {has && <button className="btn" onClick={() => { if (confirm('Close this shoot? Your edits are saved.')) location.reload() }} title="Open another folder"><Icon name="folder" size={14} /> {S.title}</button>}
        <span className="grow" />
        {err && <span className="err">{err}</span>}
        {!ready && !err && <span className="hint">Starting the raw engine…</span>}
        {has && <><IconBtn icon="undo" title="Undo (⌘Z)" onClick={A.undo} disabled={S.hIdx <= 0} /><IconBtn icon="redo" title="Redo (⇧⌘Z)" onClick={A.redo} disabled={S.hIdx >= S.history.length - 1} /></>}
        <IconBtn icon="help" title="Keyboard shortcuts (?)" onClick={() => setModal('keys')} />
        {has && <button className="btn primary" onClick={() => setModal('export')}><Icon name="export" size={14} /> Export</button>}
      </header>
      <Left />
      <main id="center"><Viewer /><Toolbar /></main>
      <Right />
      <Film onAutoCull={() => setModal('cull')} />
      {S.browser && cur() && <StyleBrowser />}
      {modal === 'export' && <ExportDialog onClose={() => setModal(null)} />}
      {modal === 'cull' && <CullDialog onClose={() => setModal(null)} />}
      {modal === 'keys' && <Modal title="Keyboard shortcuts" onClose={() => setModal(null)} wide><dl className="keys">{KEYS.map(([k, d]) => <div key={k}><dt>{k}</dt><dd>{d}</dd></div>)}</dl></Modal>}
    </div>
  )
}

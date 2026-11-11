import { useEffect, useRef, useState } from 'react'
import * as A from '../app/store'
import { S, cur, useTopic } from '../app/store'
import { LABELS } from '../engine/core'
import { Icon, IconBtn } from './widgets'

/* crop rectangle, shown while the crop tool is active (the canvas then shows the whole frame) */
function CropOverlay() {
  const p = cur()!, g = p.crop || { cx: 0.5, cy: 0.5, w: 1, h: 1 }, d = useRef<any>(null)
  const down = (e: React.PointerEvent, h: string | null) => { e.stopPropagation(); const b = (e.currentTarget.closest('#ov') as HTMLElement).getBoundingClientRect(); d.current = { g0: A.beginCropDrag(), x: e.clientX, y: e.clientY, b, h }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  const move = (e: React.PointerEvent) => { const s = d.current; if (s) A.dragCrop(s.g0, s.h, (e.clientX - s.x) / s.b.width, (e.clientY - s.y) / s.b.height) }
  const up = () => { if (d.current) { d.current = null; A.markThumb(p); A.commit('Crop', 'crop') } }
  return (
    <div className="croprect" style={{ left: (g.cx - g.w / 2) * 100 + '%', top: (g.cy - g.h / 2) * 100 + '%', width: g.w * 100 + '%', height: g.h * 100 + '%' }} onPointerDown={e => down(e, null)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {['nw', 'ne', 'sw', 'se'].map(h => <i key={h} className={'h ' + h} onPointerDown={e => down(e, h)} onPointerMove={move} onPointerUp={up} />)}
      <b className="g v1" /><b className="g v2" /><b className="g h1" /><b className="g h2" />
    </div>
  )
}

/* gradient handles for the selected mask, pins for the others */
function MaskOverlay() {
  const p = cur()!, L = S.lay, d = useRef<any>(null), sel = p.masks[S.maskSel]
  const P = (uv: number[]) => A.uvToScreen(uv[0], uv[1])
  const uvAt = (e: React.PointerEvent) => { const b = (e.currentTarget.closest('#ov') as HTMLElement).getBoundingClientRect(); return A.screenToUv(e.clientX - b.left, e.clientY - b.top) }
  const grab = (e: React.PointerEvent, what: string) => { e.stopPropagation(); d.current = { what, start: uvAt(e), m0: JSON.parse(JSON.stringify(sel)) }; (e.currentTarget as Element).setPointerCapture(e.pointerId) }
  const move = (e: React.PointerEvent) => {
    const s = d.current; if (!s || !sel) return; const [u, v] = uvAt(e), du = u - s.start[0], dv = v - s.start[1], m0 = s.m0
    if (s.what === 'a') sel.a = [u, v]; else if (s.what === 'b') sel.b = [u, v]
    else if (s.what === 'mid') { sel.a = [m0.a[0] + du, m0.a[1] + dv]; sel.b = [m0.b[0] + du, m0.b[1] + dv] }
    else if (s.what === 'c') sel.c = [m0.c[0] + du, m0.c[1] + dv]
    else if (s.what === 'rx') sel.r = [Math.max(0.01, Math.abs(u - sel.c[0])), sel.r[1]]
    else if (s.what === 'ry') sel.r = [sel.r[0], Math.max(0.01, Math.abs(v - sel.c[1]))]
    else if (s.what === 'new') { if (sel.type === 'linear') sel.b = [u, v]; else sel.r = [Math.max(0.01, Math.abs(u - sel.c[0])), Math.max(0.01, Math.abs(v - sel.c[1]))] }
    A.touchMask()
  }
  const up = () => {
    const s = d.current; if (!s) return; d.current = null
    if (s.what === 'new' && sel) { if (sel.type === 'linear' && Math.hypot(sel.b[0] - sel.a[0], sel.b[1] - sel.a[1]) < 0.02) sel.b = [sel.a[0], Math.min(1, sel.a[1] + 0.3)]; if (sel.type === 'radial' && sel.r[0] < 0.03) sel.r = [0.2, 0.2]; A.touchMask() }
    A.commit(s.what === 'new' ? 'Add mask' : 'Move mask', 'maskgeo')
  }
  const create = (e: React.PointerEvent) => { if (e.button !== 0) return; e.stopPropagation(); const [u, v] = uvAt(e), i = A.addMask(S.tool as any, u, v); if (i < 0) return; d.current = { what: 'new', start: [u, v], m0: null }; (e.currentTarget as Element).setPointerCapture(e.pointerId) }
  const ev = { onPointerMove: move, onPointerUp: up, onPointerCancel: up }
  let shape: React.ReactNode = null
  if (sel?.type === 'linear') {
    const a = P(sel.a), b = P(sel.b), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len * 2000, ny = dx / len * 2000, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    shape = <>
      <line x1={a[0] - nx} y1={a[1] - ny} x2={a[0] + nx} y2={a[1] + ny} className="ml" /><line x1={b[0] - nx} y1={b[1] - ny} x2={b[0] + nx} y2={b[1] + ny} className="ml dash" /><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="ml thin" />
      <circle cx={a[0]} cy={a[1]} r={7} className="mh" onPointerDown={e => grab(e, 'a')} {...ev} /><circle cx={b[0]} cy={b[1]} r={7} className="mh hollow" onPointerDown={e => grab(e, 'b')} {...ev} /><circle cx={mid[0]} cy={mid[1]} r={6} className="mh pin" onPointerDown={e => grab(e, 'mid')} {...ev} />
    </>
  } else if (sel?.type === 'radial') {
    const pts = Array.from({ length: 64 }, (_, i) => { const t = i / 64 * Math.PI * 2; return P([sel.c[0] + Math.cos(t) * sel.r[0], sel.c[1] + Math.sin(t) * sel.r[1]]).join(',') }).join(' ')
    const c = P(sel.c), rx = P([sel.c[0] + sel.r[0], sel.c[1]]), ry = P([sel.c[0], sel.c[1] + sel.r[1]])
    shape = <><polygon points={pts} className="ml" /><circle cx={c[0]} cy={c[1]} r={7} className="mh pin" onPointerDown={e => grab(e, 'c')} {...ev} /><circle cx={rx[0]} cy={rx[1]} r={6} className="mh" onPointerDown={e => grab(e, 'rx')} {...ev} /><circle cx={ry[0]} cy={ry[1]} r={6} className="mh" onPointerDown={e => grab(e, 'ry')} {...ev} /></>
  }
  return (
    <svg className="masks" width={L.cssW} height={L.cssH} onPointerDown={create} {...ev}>
      {p.masks.map((m, i) => { if (i === S.maskSel) return null; const c = P(m.type === 'linear' ? [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2] : m.c); return <circle key={i} cx={c[0]} cy={c[1]} r={6} className="mh other" onPointerDown={e => { e.stopPropagation(); A.selectMask(i) }} /> })}
      {shape}
    </svg>
  )
}

function OpenPanel() {
  const [dir, setDir] = useState(''), [list, setList] = useState<any>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), file = useRef<HTMLInputElement>(null)
  const browse = (d: string) => A.listServerDir(d).then(l => { setList(l); setDir(l.dir); setErr('') }).catch(e => setErr(e.message))
  useEffect(() => { let last = ''; try { last = localStorage.getItem('autochrome:lastDir') || '' } catch {} browse(last).catch(() => browse('')) }, [])
  const open = (d = dir) => { setBusy(true); A.openServerDir(d).catch(e => { setErr(e.message); setBusy(false) }) }
  return (
    <div className="open">
      <div className="card">
        <h1>Open a shoot</h1>
        <p>Point Autochrome at a folder on this computer, or drop a folder or files anywhere on this window. Photos are developed from the raw data on your machine.</p>
        <form onSubmit={e => { e.preventDefault(); open() }} className="pathrow">
          <input value={dir} onChange={e => setDir(e.target.value)} onKeyDown={e => e.stopPropagation()} placeholder="/Users/you/Pictures/shoot" spellCheck={false} aria-label="Folder path" />
          <button className="btn" type="button" onClick={() => browse(dir)}>Go</button><button className="btn primary" disabled={busy}>{busy ? 'Opening…' : 'Open folder'}</button>
        </form>
        {err && <p className="err">{err}</p>}
        {list && <ul className="dirs">
          {list.parent && <li onClick={() => browse(list.parent)}><Icon name="folder" size={14} /><span>..</span></li>}
          {list.dirs.map((d: string) => <li key={d} onClick={() => browse(list.dir + '/' + d)} onDoubleClick={() => open(list.dir + '/' + d)}><Icon name="folder" size={14} /><span>{d}</span></li>)}
          {!list.dirs.length && <li className="empty">No sub-folders</li>}
        </ul>}
        <div className="foot">
          <span>{list ? (list.files.length ? `${list.files.length} photos in this folder${list.project ? ' · saved edits found' : ''}` : 'No photos directly in this folder') : ''}</span>
          <button className="btn" onClick={() => file.current!.click()}>Add files instead…</button>
          <input ref={file} type="file" multiple hidden onChange={e => { if (e.target.files?.length) A.addFiles(e.target.files); e.target.value = '' }} />
        </div>
      </div>
    </div>
  )
}

export function Toolbar() {
  useTopic('view', 'film', 'status'); const p = cur(), z = S.zoom, tool = (t: typeof S.tool) => () => A.setTool(S.tool === t ? 'select' : t)
  return (
    <div id="toolbar">
      <div className="grp">
        <IconBtn icon="hand" title="Pan and zoom (V)" on={S.tool === 'select'} onClick={() => A.setTool('select')} />
        <IconBtn icon="crop" title="Crop and straighten (R)" on={S.tool === 'crop'} onClick={tool('crop')} />
        <IconBtn icon="dropper" title="White balance picker (W)" on={S.tool === 'wb'} onClick={tool('wb')} />
        <IconBtn icon="linear" title="Linear gradient mask (M)" on={S.tool === 'linear'} onClick={tool('linear')} />
        <IconBtn icon="radial" title="Radial gradient mask (Shift+M)" on={S.tool === 'radial'} onClick={tool('radial')} />
      </div>
      <div className="grp">
        <IconBtn icon="flag" title="Pick (P)" on={p?.flag === 1} onClick={() => A.setFlag(1)} data-tone="ok" />
        <IconBtn icon="reject" title="Reject (X)" on={p?.flag === -1} onClick={() => A.setFlag(-1)} data-tone="bad" />
        <span className="stars" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map(n => <button key={n} className={p && p.rating >= n ? 'on' : ''} title={`${n} star${n > 1 ? 's' : ''} (${n})`} onClick={() => A.setRating(p?.rating === n ? 0 : n)}><Icon name="star" size={14} /></button>)}</span>
        <span className="labels">{LABELS.slice(1).map((c, i) => <button key={i} className={p?.label === i + 1 ? 'on' : ''} style={{ '--c': c } as any} title={`Colour label (${i + 6})`} onClick={() => A.setLabel(i + 1)} />)}</span>
      </div>
      <span className="grow" />
      <span className="msg">{S.flash || (S.busy ? 'Developing…' : S.tool === 'wb' ? 'Click something that should be neutral grey' : S.tool === 'linear' || S.tool === 'radial' ? 'Drag on the photo to place a gradient' : S.tool === 'crop' ? 'Drag the frame, Enter when done' : '')}</span>
      <div className="grp">
        <IconBtn icon="clip" title="Clipping warnings (J)" on={S.clip} onClick={() => A.toggle('clip')} />
        <IconBtn icon="compare" title="Hold to see the unedited photo (\)" on={S.before} onPointerDown={() => A.toggle('before', true)} onPointerUp={() => A.toggle('before', false)} onPointerLeave={() => S.before && A.toggle('before', false)} />
        <select className="sel" value={z === 'fit' ? 'fit' : [0.5, 1, 2].includes(z) ? String(z) : 'x'} onChange={e => A.setZoom(e.target.value === 'fit' ? 'fit' : +e.target.value)} title="Zoom (Z toggles fit and 100%)" aria-label="Zoom">
          <option value="fit">Fit</option><option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option>{z !== 'fit' && ![0.5, 1, 2].includes(z) && <option value="x">{Math.round(z * 100)}%</option>}
        </select>
        <IconBtn icon="grid" title="Grid view (G)" on={S.grid} onClick={() => A.toggle('grid')} />
        <IconBtn icon="panels" title="Hide or show the side panels (Tab)" on={!S.panels} onClick={() => A.toggle('panels')} />
      </div>
    </div>
  )
}

export function Viewer() {
  useTopic('view', 'status'); const canvas = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null), drag = useRef<any>(null), [over, setOver] = useState(false)
  useEffect(() => {
    A.attachView(canvas.current!, box.current!)
    const wheel = (e: WheelEvent) => { if (!S.lay || !S.cur) return; e.preventDefault(); const b = canvas.current!.getBoundingClientRect(); A.wheelZoom(e.deltaY * (e.ctrlKey ? 4 : 1), e.clientX - b.left, e.clientY - b.top) }
    box.current!.addEventListener('wheel', wheel, { passive: false }); return () => box.current?.removeEventListener('wheel', wheel)
  }, [])
  const down = (e: React.PointerEvent) => { if (e.button !== 0 || !S.cur) return; drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  const move = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (!d.moved && Math.hypot(dx, dy) < 4) return; d.moved = true; if (S.tool === 'select') { A.panBy(dx, dy); d.x = e.clientX; d.y = e.clientY } }
  const up = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; if (!d || d.moved || !S.lay) return
    const b = canvas.current!.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; if (x < 0 || y < 0 || x > b.width || y > b.height) return
    if (S.tool === 'wb') A.pickWB(x, y); else if (S.tool === 'select') A.setZoom(S.zoom === 'fit' ? 1 : 'fit', { x, y })
  }
  const p = cur(), has = S.photos.length > 0
  return (
    <div id="viewer" ref={box} className={'tool-' + S.tool + (S.zoom !== 'fit' ? ' zoomed' : '') + (over ? ' over' : '')} onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { setOver(false); A.handleDrop(e.nativeEvent) }}>
      <div id="wrap" style={{ visibility: has ? 'visible' : 'hidden' }}>
        <canvas id="view" ref={canvas} />
        {p && S.lay && <div id="ov" style={{ width: S.lay.cssW, height: S.lay.cssH }}>{S.tool === 'crop' ? <CropOverlay /> : S.tool === 'linear' || S.tool === 'radial' ? <MaskOverlay /> : null}</div>}
      </div>
      {!has && <OpenPanel />}
      {over && <div className="dropmsg">Drop to open</div>}
    </div>
  )
}

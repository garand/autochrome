import { useEffect, useRef, useState } from 'react'
import * as A from '../app/store'
import { DEF, KEYS, S, changedCount, clearOv, commit, cur, curS, isOv, resetKeys, setVal, useTopic } from '../app/store'
import { HSL, ID_CURVE, LOOKS, clamp, clone, curveLut, eq } from '../engine/core'
import { LOOK_CATS } from '../engine/looks'
import * as WB from '../engine/wb'
import { Icon, IconBtn, Section, Seg, Slider } from './widgets'

/* one adjustment bound to a settings key, honouring the shoot / photo scope */
function Adj({ k, label, min = -100, max = 100, step = 1, cls, swatch, show, parse }: { k: string; label: string; min?: number; max?: number; step?: number; cls?: string; swatch?: string; show?: (v: number) => string; parse?: (t: string) => number }) {
  const v = curS()[k]
  return <Slider label={label} value={v} min={min} max={max} step={step} def={DEF[k]} cls={cls} swatch={swatch} show={show} parse={parse} ov={isOv(k)} onClearOv={isOv(k) ? () => clearOv(k) : undefined}
    onChange={x => setVal(k, x)} onCommit={x => commit(`${label} ${step < 1 ? x.toFixed(2) : x}`, k)}
    onReset={() => (S.scope === 'photo' ? clearOv(k) : (setVal(k, DEF[k]), commit('Reset ' + label)))} />
}
const sec = (id: keyof typeof KEYS, title: string) => ({ id, title, count: changedCount(KEYS[id]), onReset: () => resetKeys(KEYS[id], 'Reset ' + title) })

function Histogram() {
  useTopic('view'); const ref = useRef<HTMLCanvasElement>(null), tmp = useRef<HTMLCanvasElement | null>(null), timer = useRef<any>(0)
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const hc = ref.current, src = A.getViewCanvas(); if (!hc || !src || !src.width) return
      const t = (tmp.current ||= Object.assign(document.createElement('canvas'), { width: 160, height: 106 })), tc = t.getContext('2d', { willReadFrequently: true })!
      tc.drawImage(src, 0, 0, 160, 106); const d = tc.getImageData(0, 0, 160, 106).data, R = new Uint32Array(256), G = new Uint32Array(256), B = new Uint32Array(256)
      for (let i = 0; i < d.length; i += 4) { R[d[i]]++; G[d[i + 1]]++; B[d[i + 2]]++ }
      let mx = 1; for (let i = 3; i < 253; i++) mx = Math.max(mx, R[i], G[i], B[i])
      const W = (hc.width = hc.clientWidth * 2), H = (hc.height = hc.clientHeight * 2), c = hc.getContext('2d')!; c.clearRect(0, 0, W, H); c.globalCompositeOperation = 'lighter'
      for (const [arr, col] of [[R, '#c8433d'], [G, '#3d9d48'], [B, '#3c68d8']] as const) { c.fillStyle = col; c.beginPath(); c.moveTo(0, H); for (let i = 0; i < 256; i++) c.lineTo(i / 255 * W, H - Math.min(1, arr[i] / mx) * H * 0.94); c.lineTo(W, H); c.fill() }
    }, 60)
  })
  const p = cur(), m = p?.meta || {}
  return (
    <div className="histo">
      <canvas ref={ref} />
      <button className={'clipbtn' + (S.clip ? ' on' : '')} title="Show clipped highlights and shadows (J)" onClick={() => A.toggle('clip')}><Icon name="clip" size={13} /></button>
      <div className="exif">{p ? [m.iso && 'ISO ' + Math.round(m.iso), m.focal && Math.round(m.focal) + ' mm', m.aperture && 'ƒ/' + (+m.aperture).toFixed(1), m.shutter && (m.shutter >= 1 ? m.shutter + ' s' : '1/' + Math.round(1 / m.shutter) + ' s')].filter(Boolean).map((t, i) => <span key={i}>{t}</span>) : <span>No photo</span>}</div>
    </div>
  )
}

/* Temperature and tint. For raws the sliders read in real units for the current photo (Kelvin and tint from its camera
   data); the stored values are relative to as shot, so a shoot-wide change shifts every photo by the same amount. */
function WhiteBalance() {
  const p = cur(), shot = A.wbShot(p), raw = shot.info.raw
  const lo = raw ? WB.tempForKelvin(shot, WB.K_MIN) : -100, hi = raw ? WB.tempForKelvin(shot, WB.K_MAX) : 100
  const kfmt = (v: number) => { const K = WB.absolute(shot, v, 0).kelvin; return (K >= 10000 ? Math.round(K / 100) * 100 : Math.round(K / 10) * 10) + ' K' }
  const asShot = raw ? `As shot ${kfmt(0)} · tint ${Math.round(shot.tint)}` : 'No camera colour data in this file, so these are relative'
  return <>
    <div className="sub"><span>White balance</span><button className={'mini' + (S.tool === 'wb' ? ' on' : '')} title="Pick a neutral grey or white in the photo (W)" onClick={() => A.setTool(S.tool === 'wb' ? 'select' : 'wb')}><Icon name="dropper" size={14} /></button></div>
    <Adj k="temp" label="Temp" min={Math.floor(lo)} max={Math.ceil(hi)} cls="temp" show={raw ? kfmt : undefined} parse={raw ? t => WB.tempForKelvin(shot, parseFloat(t)) : undefined} />
    <Adj k="tint" label="Tint" min={-150} max={150} cls="tint" show={raw ? v => String(Math.round(shot.tint + v)) : undefined} parse={raw ? t => WB.tintFor(shot, parseFloat(t)) : undefined} />
    <p className="note wbnote" title={raw ? 'Read from the camera\'s white balance and colour matrix' : ''}>{p ? asShot : ''}</p>
  </>
}

function Looks() {
  const s = curS(), [cat, setCat] = useState(() => LOOKS.find(l => l.id === s.look)?.cat || LOOK_CATS[0]), cats = [...LOOK_CATS, ...(LOOKS.some(l => l.cat === 'My LUTs') ? ['My LUTs'] : [])]
  const active = LOOKS.find(l => l.id === s.look)
  const pick = (l: any) => { setVal('look', l.id); commit('Look: ' + l.name) }
  return (
    <Section {...sec('look', 'Look')} extra={<span className="hint">{active && active.id !== 'none' ? active.name : ''}</span>}>
      <div className="lookbar">
        <select className="sel grow" value={cat} onChange={e => setCat(e.target.value)} aria-label="Look category">{cats.map(c => <option key={c}>{c}</option>)}</select>
        <button className="btn" onClick={() => { S.browser = 'looks'; A.emit('view') }} title="See this photo in every look (L)"><Icon name="grid" size={13} /> Browse</button>
      </div>
      <div className="looks" onMouseLeave={() => A.setPreview(null)}>
        <button className={'look' + (s.look === 'none' ? ' on' : '')} onMouseEnter={() => A.setPreview({ s: { look: 'none' } })} onClick={() => pick(LOOKS[0])}><i style={{ background: '#777' }} />None</button>
        {LOOKS.filter(l => l.cat === cat).map(l => <button key={l.id} className={'look' + (s.look === l.id ? ' on' : '')} title={l.sub} onMouseEnter={() => A.setPreview({ s: { look: l.id, lookAmount: Math.max(s.lookAmount, 100) } })} onClick={() => pick(l)}><i style={{ background: l.sw }} />{l.name.replace(/ style$/, '')}</button>)}
      </div>
      <Adj k="lookAmount" label="Amount" min={0} max={100} />
    </Section>
  )
}

function Curve() {
  const s = curS(), ch = S.curveCh, pts: number[][] = s.curve[ch], ref = useRef<HTMLCanvasElement>(null), drag = useRef<number>(-1)
  const COL: Record<string, string> = { m: '#e6e6ea', r: '#e5484d', g: '#46a758', b: '#4b82f5' }
  useEffect(() => {
    const cv = ref.current; if (!cv) return   // section is collapsed
    const W = (cv.width = cv.clientWidth * 2), H = (cv.height = cv.clientHeight * 2), c = cv.getContext('2d')!
    c.clearRect(0, 0, W, H); c.strokeStyle = '#2f2f35'; c.lineWidth = 1
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(i * W / 4, 0); c.lineTo(i * W / 4, H); c.moveTo(0, i * H / 4); c.lineTo(W, i * H / 4); c.stroke() }
    c.strokeStyle = '#3a3a41'; c.beginPath(); c.moveTo(0, H); c.lineTo(W, 0); c.stroke()
    for (const k of ['r', 'g', 'b', 'm']) { if (k !== ch && eq(s.curve[k], ID_CURVE)) continue; const lut = curveLut(s.curve[k]); c.strokeStyle = COL[k]; c.globalAlpha = k === ch ? 1 : 0.35; c.lineWidth = k === ch ? 3 : 2; c.beginPath(); for (let i = 0; i < 256; i++) c[i ? 'lineTo' : 'moveTo'](i / 255 * W, H - lut[i] * H); c.stroke() }
    c.globalAlpha = 1; c.fillStyle = COL[ch]; for (const [x, y] of pts) { c.beginPath(); c.arc(x * W, H - y * H, 7, 0, 7); c.fill(); c.strokeStyle = '#17171a'; c.lineWidth = 2; c.stroke() }
  })
  const pos = (e: React.PointerEvent) => { const b = ref.current!.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, 1 - (e.clientY - b.top) / b.height, b.width] }
  const put = (next: number[][]) => setVal('curve', { ...s.curve, [ch]: next })
  const down = (e: React.PointerEvent) => {
    const [x, y, w] = pos(e); let i = pts.findIndex(p => Math.hypot((p[0] - x) * w, (p[1] - y) * w) < 12)
    if (i < 0) { const next = [...pts.map(p => [...p]), [clamp(x, 0.01, 0.99), clamp(y)]].sort((a, b) => a[0] - b[0]); i = next.findIndex(p => p[0] === clamp(x, 0.01, 0.99)); put(next) }
    drag.current = i; ref.current!.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const i = drag.current; if (i < 0) return; const [x, y] = pos(e), next = pts.map(p => [...p]), end = i === 0 || i === next.length - 1
    if (!end && (y < -0.25 || y > 1.25)) { next.splice(i, 1); drag.current = -1; put(next); commit('Tone curve'); return }
    next[i] = [end ? next[i][0] : clamp(x, next[i - 1][0] + 0.02, next[i + 1][0] - 0.02), clamp(y)]; put(next)
  }
  const up = () => { if (drag.current >= 0) { drag.current = -1; commit('Tone curve', 'curve') } }
  const dbl = (e: React.MouseEvent) => { const b = ref.current!.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = 1 - (e.clientY - b.top) / b.height, i = pts.findIndex(p => Math.hypot((p[0] - x) * b.width, (p[1] - y) * b.width) < 12); if (i > 0 && i < pts.length - 1) { const next = pts.map(p => [...p]); next.splice(i, 1); put(next); commit('Tone curve') } }
  const preset = (name: string, m: number[][]) => { setVal('curve', { ...clone(DEF.curve), m }); commit('Curve: ' + name) }
  return (
    <Section {...sec('curve', 'Tone curve')} defaultOpen={false}>
      <div className="curvebar">
        <Seg value={ch} options={[['m', 'RGB'], ['r', 'R'], ['g', 'G'], ['b', 'B']]} onChange={v => { S.curveCh = v; A.emit('panel') }} />
        <select className="sel" value="" onChange={e => { const v = e.target.value; if (v === 'lin') preset('Linear', [[0, 0], [1, 1]]); if (v === 'med') preset('Medium contrast', [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]]); if (v === 'strong') preset('Strong contrast', [[0, 0], [0.25, 0.16], [0.75, 0.86], [1, 1]]); if (v === 'fade') preset('Faded', [[0, 0.08], [0.25, 0.24], [0.75, 0.78], [1, 0.95]]) }} aria-label="Curve presets">
          <option value="">Presets</option><option value="lin">Linear</option><option value="med">Medium contrast</option><option value="strong">Strong contrast</option><option value="fade">Faded</option>
        </select>
      </div>
      <canvas ref={ref} className="curve" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={dbl} />
      <p className="note">Click to add a point, drag to shape, double-click or drag a point off the box to remove it.</p>
    </Section>
  )
}

function Mixer() {
  const s = curS(), n = S.hslSel, col = HSL.find(h => h[0] === n)![3] as string
  return (
    <Section {...sec('mixer', 'Colour mixer')}>
      <div className="swatches" role="tablist">{HSL.map(([name, , , c]) => { const ch = ['h_', 's_', 'l_'].some(k => s[k + name] !== 0); return <button key={name as string} role="tab" aria-selected={n === name} title={name as string} className={(n === name ? 'on' : '') + (ch ? ' ch' : '')} style={{ '--c': c } as any} onClick={() => { S.hslSel = name as string; A.emit('panel') }} /> })}</div>
      <Adj k={'h_' + n} label="Hue" swatch={col} /><Adj k={'s_' + n} label="Saturation" swatch={col} /><Adj k={'l_' + n} label="Luminance" swatch={col} />
    </Section>
  )
}

function Wheel({ label, hk, sk }: { label: string; hk: string; sk: string }) {
  const s = curS(), ref = useRef<HTMLDivElement>(null), hue = s[hk], sat = s[sk], a = hue * Math.PI / 180, r = sat / 100 * 50
  const set = (e: React.PointerEvent) => { const b = ref.current!.getBoundingClientRect(), dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2), d = Math.min(1, Math.hypot(dx, dy) / (b.width / 2)); setVal(hk, Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360)); setVal(sk, Math.round(d * 100 * (e.shiftKey ? 0.5 : 1))) }
  return (
    <div className="wheelbox">
      <div ref={ref} className={'wheel' + (isOv(sk) || isOv(hk) ? ' ov' : '')} onPointerDown={e => { ref.current!.setPointerCapture(e.pointerId); set(e) }} onPointerMove={e => { if (e.buttons) set(e) }} onPointerUp={() => commit('Grade ' + label.toLowerCase(), hk)}
        onDoubleClick={() => { setVal(sk, 0); setVal(hk, 0); commit('Reset grade ' + label.toLowerCase()) }} title="Drag to tint. Double-click to reset.">
        <i style={{ left: 50 + Math.cos(a) * r + '%', top: 50 + Math.sin(a) * r + '%' }} />
      </div>
      <span>{label}</span><em>{sat ? `${hue}° · ${sat}` : '—'}</em>
    </div>
  )
}

function Masks() {
  const p = cur(), i = S.maskSel, m = p?.masks[i]
  const adj = (k: string, label: string, min: number, max: number, step = 1, cls?: string) => <Slider label={label} value={m.adj[k]} min={min} max={max} step={step} cls={cls} onChange={v => { m.adj[k] = v; A.touchMask() }} onCommit={() => commit('Mask ' + label.toLowerCase(), 'mask' + k)} />
  return (
    <Section id="masks" title="Masks" count={p?.masks.length || 0} extra={<span className="hint">this photo</span>}>
      <div className="btnrow">
        <button className={'btn' + (S.tool === 'linear' ? ' on' : '')} onClick={() => A.setTool(S.tool === 'linear' ? 'select' : 'linear')} title="Drag on the photo to add a linear gradient (M)"><Icon name="linear" size={13} /> Linear</button>
        <button className={'btn' + (S.tool === 'radial' ? ' on' : '')} onClick={() => A.setTool(S.tool === 'radial' ? 'select' : 'radial')} title="Drag on the photo to add a radial gradient (Shift+M)"><Icon name="radial" size={13} /> Radial</button>
        <label className="chk"><input type="checkbox" checked={S.showMask} onChange={e => A.toggle('showMask', e.target.checked)} /> Overlay</label>
      </div>
      {p?.masks.length ? <ul className="masklist">{p.masks.map((k, j) => (
        <li key={j} className={j === i ? 'on' : ''} onClick={() => A.selectMask(j)}>
          <Icon name={k.type} size={13} /><span>{k.type === 'linear' ? 'Linear' : 'Radial'} gradient {j + 1}</span>
          <button className="mini" title={k.on === false ? 'Show' : 'Hide'} onClick={e => { e.stopPropagation(); k.on = k.on === false; A.touchMask(); commit('Toggle mask') }}><Icon name={k.on === false ? 'eyeoff' : 'eye'} size={13} /></button>
          <button className="mini" title="Delete mask" onClick={e => { e.stopPropagation(); A.removeMask(j) }}><Icon name="trash" size={13} /></button>
        </li>))}</ul> : <p className="note">Pick a gradient, then drag on the photo. Use masks to darken a sky, lift a face or warm one side of the frame.</p>}
      {m && <>
        {adj('exposure', 'Exposure', -3, 3, 0.01)}{adj('contrast', 'Contrast', -100, 100)}{adj('saturation', 'Saturation', -100, 100)}{adj('temp', 'Temp', -100, 100, 1, 'temp')}{adj('tint', 'Tint', -100, 100, 1, 'tint')}
        {m.type === 'radial' && <><Slider label="Feather" value={m.feather} min={0} max={100} def={50} onChange={v => { m.feather = v; A.touchMask() }} onCommit={() => commit('Mask feather', 'maskf')} />
          <label className="chk"><input type="checkbox" checked={m.invert} onChange={e => { m.invert = e.target.checked; A.touchMask(); commit('Invert mask') }} /> Invert (affect outside the oval)</label></>}
        {S.multi.size > 1 && <div className="btnrow"><button className="btn" onClick={A.masksToSelected}>Copy masks to selected</button></div>}
      </>}
    </Section>
  )
}

function CropPanel() {
  const p = cur(), g = p?.crop || { angle: 0, aspect: 'orig' }
  return (
    <Section id="crop" title="Crop & rotate" count={p && (p.crop || p.orient.rot || p.orient.flip) ? 1 : 0} onReset={A.resetCrop} extra={<span className="hint">this photo</span>}>
      <div className="btnrow">
        <select className="sel grow" value={g.aspect || 'orig'} onChange={e => A.setAspect(e.target.value)} aria-label="Aspect ratio">
          {[['orig', 'Original'], ['1', '1 : 1'], ['0.8', '4 : 5'], ['0.7143', '5 : 7'], ['0.6667', '2 : 3'], ['0.75', '3 : 4'], ['0.5625', '9 : 16'], ['1.25', '5 : 4'], ['1.5', '3 : 2'], ['1.3333', '4 : 3'], ['1.7778', '16 : 9'], ['free', 'Free']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <IconBtn icon="rotl" title="Rotate left (⌘[)" onClick={() => A.rotate(-1)} /><IconBtn icon="rotr" title="Rotate right (⌘])" onClick={() => A.rotate(1)} /><IconBtn icon="flip" title="Flip horizontally" onClick={A.flipH} on={p?.orient.flip} />
      </div>
      <Slider label="Straighten" value={g.angle || 0} min={-20} max={20} step={0.1} onChange={A.setAngle} onCommit={() => commit('Straighten', 'angle')} />
      <div className="btnrow">
        <button className={'btn' + (S.tool === 'crop' ? ' primary' : '')} onClick={() => A.setTool(S.tool === 'crop' ? 'select' : 'crop')}>{S.tool === 'crop' ? 'Done' : 'Adjust crop'}</button>
        {S.multi.size > 1 && <button className="btn" onClick={A.cropToSelected}>Copy to selected</button>}
      </div>
    </Section>
  )
}

export function Right() {
  useTopic('panel', 'status'); const s = curS(), p = cur(), nOv = p ? Object.keys(p.ov).length : 0, n = S.photos.length
  return (
    <aside id="right">
      <Histogram />
      <div className="scope">
        <Seg accent={S.scope === 'photo'} value={S.scope} options={[['project', 'All photos'], ['photo', S.multi.size > 1 ? `${S.multi.size} selected` : 'This photo']]} onChange={A.setScope} />
        <p>{S.scope === 'project' ? (nOv ? `Sliders edit the whole shoot. This photo has ${nOv} of its own (orange dots).` : 'Sliders edit every photo in the shoot.') : 'Sliders edit only the selected photos. Orange marks a difference from the shoot.'}</p>
      </div>
      <div className="scroll">
        <Section id="auto" title="Auto">
          <label className="chk big"><input type="checkbox" checked={S.proj.autoExposure} onChange={e => A.setAuto('autoExposure', e.target.checked)} /><span>Balance exposure across the shoot<small>Meters every photo for its faces, or the scene, so the set matches. Exposure then works as an offset.</small></span></label>
          <label className="chk big"><input type="checkbox" checked={S.proj.autoWB} onChange={e => A.setAuto('autoWB', e.target.checked)} /><span>Match skin tones<small>Evens white balance between sun and shade using the faces. Tuned on lighter skin; check it.</small></span></label>
          <p className="note">{!n ? 'Open a folder to begin.' : S.analysed < n ? `Metering ${S.analysed} of ${n}…` : `${n} photos metered` + (S.checked < n ? ` · checking faces ${S.checked}/${n}` : ' · faces checked')}</p>
        </Section>
        <Looks />
        <Section {...sec('basic', 'Basic')}>
          <div className="sub"><span>Treatment</span><Seg value={s.bw ? 1 : 0} options={[[0, 'Colour'], [1, 'Black & white']]} onChange={v => { setVal('bw', v); commit(v ? 'Black & white' : 'Colour') }} /></div>
          <WhiteBalance />
          <div className="sub"><span>Tone</span></div>
          <Adj k="exposure" label="Exposure" min={-4} max={4} step={0.01} /><Adj k="contrast" label="Contrast" /><Adj k="highlights" label="Highlights" /><Adj k="shadows" label="Shadows" /><Adj k="whites" label="Whites" /><Adj k="blacks" label="Blacks" />
          <div className="sub"><span>Presence</span></div>
          <Adj k="texture" label="Texture" /><Adj k="clarity" label="Clarity" /><Adj k="dehaze" label="Dehaze" /><Adj k="vibrance" label="Vibrance" /><Adj k="saturation" label="Saturation" />
        </Section>
        <Curve />
        <Mixer />
        <Section {...sec('grade', 'Colour grading')} defaultOpen={false}>
          <div className="wheels"><Wheel label="Shadows" hk="gShHue" sk="gShSat" /><Wheel label="Midtones" hk="gMidHue" sk="gMidSat" /><Wheel label="Highlights" hk="gHiHue" sk="gHiSat" /></div>
          <Adj k="gBalance" label="Balance" />
        </Section>
        <Section {...sec('faces', 'Faces')}>
          <Adj k="faceLight" label="Face light" min={-50} max={100} /><Adj k="skinProtect" label="Protect skin" min={0} max={100} />
          <p className="note">{p?.stats ? `${p.stats.faces.length} face${p.stats.faces.length === 1 ? '' : 's'} found in this photo. ` : ''}Face light lifts faces a touch; Protect skin keeps colour boosts from turning them red or orange.</p>
        </Section>
        <Section {...sec('detail', 'Detail')}>
          <Adj k="sharpen" label="Sharpening" min={0} max={100} /><Adj k="nrLuma" label="Noise reduction" min={0} max={100} /><Adj k="nrColor" label="Colour noise" min={0} max={100} />
          <p className="note">Zoom to 100% to judge these. They are skipped in thumbnails.</p>
        </Section>
        <Section {...sec('effects', 'Effects')}>
          <Adj k="vignette" label="Vignette" /><Adj k="grain" label="Grain" min={0} max={100} /><Adj k="fade" label="Fade" min={0} max={100} />
        </Section>
        <Masks />
        <CropPanel />
      </div>
    </aside>
  )
}

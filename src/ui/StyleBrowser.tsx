import { useEffect, useMemo, useRef, useState } from 'react'
import * as A from '../app/store'
import { DEF, S, cur, curS } from '../app/store'
import { LOOKS, clone } from '../engine/core'
import { LOOK_CATS } from '../engine/looks'
import { Icon, Seg } from './widgets'

/* The current photo rendered in every look (or preset), to pick a starting point by eye. */
export function StyleBrowser() {
  const mode = S.browser!, [cat, setCat] = useState('All'), [tab, setTab] = useState(mode), [size, setSize] = useState(240), refs = useRef(new Map<string, HTMLCanvasElement>()), p = cur(), s = curS()
  const items = useMemo(() => {
    if (tab === 'looks') return LOOKS.filter(l => cat === 'All' || l.cat === cat || l.id === 'none').map(l => ({ id: l.id, name: l.name, sub: l.sub, cat: l.cat, s: { ...s, look: l.id, lookAmount: l.id === 'none' ? s.lookAmount : Math.max(100, s.lookAmount) }, on: s.look === l.id }))
    const all = A.allPresets(); return Object.keys(all).map(n => ({ id: n, name: n, sub: 'Preset', cat: '', s: { ...clone(DEF), ...all[n] }, on: false }))
  }, [tab, cat, S.cur])
  useEffect(() => {
    let i = 0, alive = true
    const run = () => { if (!alive) return; const batch = items.slice(i, i + 10).map(it => ({ canvas: refs.current.get(it.id)!, s: it.s })).filter(t => t.canvas); A.renderTiles(batch, 420); i += 10; if (i < items.length) requestAnimationFrame(run) }
    requestAnimationFrame(run); return () => { alive = false }
  }, [items, p?.mid, p?.t])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key.toLowerCase() === 'l') { e.stopPropagation(); e.preventDefault(); close() } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.stopPropagation(); A.step(e.key === 'ArrowRight' ? 1 : -1) } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true) }, [])
  const close = () => { S.browser = null; A.emit('view') }
  const pick = (it: any) => { if (tab === 'looks') { A.setVal('look', it.id); A.commit('Look: ' + it.name) } else A.applyPreset(it.name, A.allPresets()[it.id]); close() }
  const cats = ['All', ...LOOK_CATS, ...(LOOKS.some(l => l.cat === 'My LUTs') ? ['My LUTs'] : [])]
  return (
    <div id="browser" role="dialog" aria-label="Style browser">
      <header>
        <Seg value={tab} options={[['looks', `Looks (${LOOKS.length - 1})`], ['presets', `Presets (${Object.keys(A.allPresets()).length})`]]} onChange={setTab} />
        {tab === 'looks' && <div className="chips">{cats.map(c => <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>}
        <span className="grow" />
        <span className="hint">{p?.name} · ← → changes photo · applies to {S.scope === 'project' ? 'the whole shoot' : 'this photo'}</span>
        <input type="range" min={150} max={420} value={size} onChange={e => setSize(+e.target.value)} title="Tile size" aria-label="Tile size" style={{ width: 90, '--a': '0%', '--b': (size - 150) / 270 * 100 + '%' } as any} />
        <button className="btn" onClick={close}><Icon name="reject" size={13} /> Close</button>
      </header>
      <div className="tiles" style={{ '--h': size + 'px' } as any}>
        {items.map(it => <button key={tab + it.id} className={'tile' + (it.on ? ' on' : '')} onClick={() => pick(it)} title={it.sub}>
          <canvas ref={el => { if (el) refs.current.set(it.id, el); else refs.current.delete(it.id) }} />
          <span><b>{it.name}</b><small>{tab === 'looks' ? it.cat || 'No look' : it.sub}</small></span>
        </button>)}
      </div>
    </div>
  )
}

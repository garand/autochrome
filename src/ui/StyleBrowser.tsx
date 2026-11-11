import { useEffect, useMemo, useRef, useState } from 'react'
import * as A from '../app/store'
import { S, cur, curS } from '../app/store'
import { allStyles, styleById, styleCats } from '../engine/styles'
import { Icon } from './widgets'

/* The current photo rendered in every style, to pick a starting point by eye. */
export function StyleBrowser() {
  const [cat, setCat] = useState('All'), [size, setSize] = useState(240), refs = useRef(new Map<string, HTMLCanvasElement>()), p = cur()
  const active = styleById(curS().style)?.id ?? 'none', amount = curS().styleAmount || 100
  const items = useMemo(() => { const all = allStyles(); return cat === 'All' ? all : [all[0], ...all.filter(s => s.cat === cat)] }, [cat, S.cur])
  useEffect(() => {
    let i = 0, alive = true; const base = A.settingsOf(p)
    const run = () => { if (!alive) return; const batch = items.slice(i, i + 10).map(it => ({ canvas: refs.current.get(it.id)!, s: { ...base, style: it.id, styleAmount: amount } })).filter(t => t.canvas); A.renderTiles(batch, 420); i += 10; if (i < items.length) requestAnimationFrame(run) }
    requestAnimationFrame(run); return () => { alive = false }
  }, [items, p?.mid, p?.t])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key.toLowerCase() === 'l') { e.stopPropagation(); e.preventDefault(); close() } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.stopPropagation(); A.step(e.key === 'ArrowRight' ? 1 : -1) } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true) }, [])
  const close = () => { S.browser = null; A.emit('view') }
  const pick = (id: string) => { A.setStyle(id); close() }
  return (
    <div id="browser" role="dialog" aria-label="Styles">
      <header>
        <b className="btitle">Styles</b>
        <div className="chips">{['All', ...styleCats()].map(c => <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
        <span className="grow" />
        <span className="hint">{p?.name} · ← → changes photo · applies to {S.scope === 'project' ? 'the whole shoot' : 'this photo'}</span>
        <input type="range" min={150} max={420} value={size} onChange={e => setSize(+e.target.value)} title="Tile size" aria-label="Tile size" style={{ width: 90, '--a': '0%', '--b': (size - 150) / 270 * 100 + '%' } as any} />
        <button className="btn" onClick={close}><Icon name="reject" size={13} /> Close</button>
      </header>
      <div className="tiles" style={{ '--h': size + 'px' } as any}>
        {items.map(it => <button key={it.id} className={'tile' + (it.id === active ? ' on' : '')} onClick={() => pick(it.id)} title={it.sub}>
          <canvas ref={el => { if (el) refs.current.set(it.id, el); else refs.current.delete(it.id) }} />
          <span><b>{it.name}</b><small>{it.cat ? it.cat + (it.sub ? ' · ' + it.sub : '') : it.sub}</small></span>
        </button>)}
      </div>
    </div>
  )
}

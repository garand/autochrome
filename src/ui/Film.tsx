import { Fragment, useEffect, useRef } from 'react'
import * as A from '../app/store'
import { FILTERS, S, isEdited, useTopic, type Photo } from '../app/store'
import { LABELS, stem } from '../engine/core'
import { Icon } from './widgets'

const DRAG = 'application/x-autochrome-photos'   // photos dragged onto a scene (also from the scene board)

function Thumb({ p, io, start }: { p: Photo; io: IntersectionObserver | null; start?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), c = p.cull
  useEffect(() => { const el = ref.current!; if (p.thumb.parentElement !== el) el.prepend(p.thumb); io?.observe(el); return () => io?.unobserve(el) }, [io, p])
  useEffect(() => { if (p.name === S.cur) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) })
  const tip = [p.name, c?.n ? `${c.open}/${c.n} eyes open · ${c.looking}/${c.n} at camera · focus ${Math.round(c.sharp)} · score ${c.score}` : c ? 'no faces' : '', p.error || ''].filter(Boolean).join('\n')
  return (
    <div ref={ref} data-n={p.name} title={tip} draggable={S.scenes.length > 0} onDragStart={e => { e.dataTransfer.setData(DRAG, JSON.stringify(S.multi.has(p.name) ? [...S.multi] : [p.name])); e.dataTransfer.effectAllowed = 'move' }} className={'th' + (start ? ' bstart' : '') + (p.name === S.cur ? ' cur' : '') + (S.multi.has(p.name) ? ' multi' : '') + (p.flag === -1 ? ' rejected' : '') + (p.done ? '' : ' pending')}
      onClick={e => A.select(p.name, e)} onDoubleClick={() => S.grid && A.toggle('grid', false)}>
      <div className="bd">
        {p.flag === 1 && <span className="pick"><Icon name="check" size={10} /></span>}{p.flag === -1 && <span className="rej"><Icon name="reject" size={10} /></span>}
        {p.rating > 0 && <span className="star">★{p.rating}</span>}{isEdited(p) && <span className="ed" title="Has its own adjustments" />}
      </div>
      {c?.n > 0 && <div className="cull">{c.blink && <span className="bad" title="Someone's eyes are closed">blink</span>}{c.soft && <span className="bad" title="Faces are out of focus">soft</span>}{!c.blink && !c.soft && <span className="ok" title="Eyes open and in focus" />}</div>}
      {p.label > 0 && <i className="lab" style={{ background: LABELS[p.label]! }} />}
      <div className="nm">{stem(p.name)}</div>
    </div>
  )
}

export const timeSpan = (list: Photo[]) => {
  const t = list.map(p => p.meta?.time).filter((x): x is number => x != null); if (!t.length) return ''
  const f = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), a = f(Math.min(...t)), b = f(Math.max(...t))
  return a === b ? a : `${a}–${b}`
}
/* one chip per scene: shows only that scene in the filmstrip, so a spot can be worked through on its own */
function Scenes() {
  if (S.scenes.length < 2) return null
  return (
    <div className="chips scenes" role="tablist" aria-label="Scenes">
      <button role="tab" aria-selected={!S.sceneView} className={S.sceneView ? '' : 'on'} onClick={() => A.viewScene(null)} title="Show every scene (N opens the scene board)">All scenes</button>
      {S.scenes.map(sc => {
        const list = A.scenePhotos(sc), edits = Object.keys(sc.ov).length
        return <button key={sc.id} role="tab" aria-selected={S.sceneView === sc.id} className={S.sceneView === sc.id ? 'on' : ''} onClick={() => A.viewScene(S.sceneView === sc.id ? null : sc.id)}
          onDragOver={e => { if ([...e.dataTransfer.types].includes(DRAG)) { e.preventDefault(); e.currentTarget.classList.add('over') } }} onDragLeave={e => e.currentTarget.classList.remove('over')}
          onDrop={e => { const d = e.dataTransfer.getData(DRAG); e.currentTarget.classList.remove('over'); if (d) { e.preventDefault(); e.stopPropagation(); A.movePhotos(JSON.parse(d), sc.id) } }}
          title={[`${sc.name}: ${list.length} photo${list.length === 1 ? '' : 's'}`, timeSpan(list), edits ? `${edits} adjustment${edits === 1 ? '' : 's'} of its own` : ''].filter(Boolean).join(' · ')}>
          {edits > 0 && <i className="sdot" />}{sc.name}<span className="n">{list.length}</span></button>
      })}
    </div>
  )
}

export function Film({ onAutoCull }: { onAutoCull: () => void }) {
  useTopic('film', 'status'); const strip = useRef<HTMLDivElement>(null), io = useRef<IntersectionObserver | null>(null)
  if (!io.current && typeof IntersectionObserver !== 'undefined') io.current = new IntersectionObserver(es => { for (const e of es) { const p = S.byName.get((e.target as HTMLElement).dataset.n!); if (p) A.setVisible(p, e.isIntersecting) } }, { rootMargin: '300px' })
  useEffect(() => { const el = strip.current!; const wheel = (e: WheelEvent) => { if (!S.grid && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault() } }; el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel) }, [])
  const list = A.visiblePhotos(), starts = new Set(A.bursts(3, list).slice(1).map(g => g[0].name)), decided = S.photos.filter(p => p.flag !== 0).length, n = S.photos.length, picks = S.photos.filter(p => p.flag === 1).length, rej = S.photos.filter(p => p.flag === -1).length
  const seps = !S.sceneView && S.scenes.length > 1   // label where each scene begins
  return (
    <footer id="film">
      <div id="stripbar">
        <select className="sel" value={S.filter} onChange={e => A.setFilter(e.target.value)} aria-label="Filter photos">{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <Scenes />
        {n > 1 && <span className="prog" title={`${decided} of ${n} photos have a pick or reject`}><i style={{ transform: `scaleX(${decided / n})` }} /></span>}
        <span className="count">{n ? `${decided} of ${n} decided · ${list.length === n ? n : `${list.length} of ${n}`} photo${n === 1 ? "" : "s"} · ${picks} picked · ${rej} rejected${S.multi.size > 1 ? ` · ${S.multi.size} selected` : ''}` : ''}</span>
        <span className="grow" />
        {n > 0 && <span className="count">{S.analysed < n ? `Metering ${S.analysed}/${n}` : S.checked < n ? `Checking faces ${S.checked}/${n}` : ''}</span>}
        <button className="btn" disabled={!n} onClick={onAutoCull} title="Pick the best frame of each burst using eyes, gaze and focus">Auto cull…</button>
      </div>
      <div id="strip" ref={strip}>{list.map((p, i) => {
        const sc = seps && p.scene !== list[i - 1]?.scene ? A.sceneOf(p) : undefined
        return <Fragment key={p.name}>{sc && <div className="scenesep" title={sc.name} onClick={() => A.viewScene(sc.id)}><span>{sc.name}</span></div>}<Thumb p={p} io={io.current} start={!sc && starts.has(p.name)} /></Fragment>
      })}</div>
    </footer>
  )
}

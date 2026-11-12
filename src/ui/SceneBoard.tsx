import { useEffect, useRef, useState } from 'react'
import * as A from '../app/store'
import { S, useTopic, type Photo, type Scene } from '../app/store'
import { stem } from '../engine/core'
import { timeSpan } from './Film'
import { Icon } from './widgets'

/* The scene board: every scene of the shoot as a card of its photos, to check and fix the automatic grouping.
   Rename a scene by typing over its name, drag photos (the whole selection when you drag a selected one) onto
   another scene or onto New scene, and drag a scene by its handle onto another to merge the two. */

const PHOTOS = 'application/x-autochrome-photos', SCENE = 'application/x-autochrome-scene'
export const isBoardDrag = (e: DragEvent | React.DragEvent) => [...(e.dataTransfer?.types || [])].some(t => t === PHOTOS || t === SCENE)

function Shot({ p, list }: { p: Photo; list: Photo[] }) {
  const ref = useRef<HTMLCanvasElement>(null), sel = S.multi.has(p.name)
  useEffect(() => { A.wantThumb(p); const c = ref.current, t = p.thumb; if (!c || !t?.width) return; if (c.width !== t.width || c.height !== t.height) { c.width = t.width; c.height = t.height } c.getContext('2d')!.drawImage(t, 0, 0) })
  const click = (e: React.MouseEvent) => {
    const i = list.findIndex(q => q.name === S.cur)
    if (e.shiftKey && i >= 0) { const j = list.indexOf(p); A.addToSelection(list.slice(Math.min(i, j), Math.max(i, j) + 1).map(q => q.name)) }   // a range within this scene
    else A.select(p.name, e.metaKey || e.ctrlKey ? e : undefined)
  }
  return (
    <div className={'bshot' + (p.name === S.cur ? ' cur' : '') + (sel ? ' multi' : '') + (p.flag === -1 ? ' rejected' : '')} draggable title={`${p.name}\nDouble-click to open · drag to another scene`}
      onDragStart={e => { const names = sel ? [...S.multi] : [p.name]; e.dataTransfer.setData(PHOTOS, JSON.stringify(names)); e.dataTransfer.effectAllowed = 'move' }}
      onClick={click} onDoubleClick={() => { A.toggle('board', false); A.select(p.name) }}>
      <canvas ref={ref} />
      {p.flag === 1 && <span className="pick"><Icon name="check" size={10} /></span>}
      <span className="nm">{stem(p.name)}</span>
    </div>
  )
}

/* a card that takes dropped photos (and, for a scene, other scenes to merge) */
function useDrop(onPhotos: (names: string[]) => void, onScene?: (id: string) => void) {
  const [over, setOver] = useState(false)
  const ok = (e: React.DragEvent) => [...e.dataTransfer.types].some(t => t === PHOTOS || (onScene && t === SCENE))
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => { if (!ok(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true) },
      onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) },
      onDrop: (e: React.DragEvent) => {
        if (!ok(e)) return; e.preventDefault(); e.stopPropagation(); setOver(false)
        const ph = e.dataTransfer.getData(PHOTOS), sc = e.dataTransfer.getData(SCENE)
        if (ph) onPhotos(JSON.parse(ph)); else if (sc && onScene) onScene(sc)
      },
    },
  }
}

function Card({ sc, list }: { sc: Scene; list: Photo[] }) {
  const d = useDrop(names => A.movePhotos(names, sc.id), from => A.mergeScene(from, sc.id)), edits = Object.keys(sc.ov).length, n = list.length
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { if (list.some(p => p.name === S.cur)) ref.current?.scrollIntoView({ block: 'nearest' }) }, [])
  const others = S.scenes.filter(s => s !== sc)
  return (
    <section ref={ref} className={'bcard' + (d.over ? ' over' : '')} {...d.props}>
      <header>
        <span className="grip" draggable title="Drag onto another scene to merge them" onDragStart={e => { e.dataTransfer.setData(SCENE, sc.id); e.dataTransfer.effectAllowed = 'move' }} />
        <input key={sc.id + sc.name} className="bname" defaultValue={sc.name} aria-label="Scene name" spellCheck={false} size={Math.max(8, sc.name.length + 2)}
          onBlur={e => A.renameScene(sc.id, e.target.value)} onKeyDown={e => { e.stopPropagation(); const t = e.target as HTMLInputElement; if (e.key === 'Enter') t.blur(); if (e.key === 'Escape') { t.value = sc.name; t.blur() } }} />
        <span className="hint">{[`${n} photo${n === 1 ? '' : 's'}`, timeSpan(list), edits ? `${edits} adjustment${edits === 1 ? '' : 's'} of its own` : ''].filter(Boolean).join(' · ')}</span>
        {edits > 0 && <i className="sdot" title="This scene has its own adjustments" />}
        <span className="grow" />
        {others.length > 0 && <select className="sel" value="" onChange={e => e.target.value && A.mergeScene(sc.id, e.target.value)} aria-label={`Merge ${sc.name} into`}>
          <option value="" disabled>Merge into…</option>{others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>}
        <button className="btn" onClick={() => A.selectScene(sc.id)} disabled={n < 2}>Select all</button>
        <button className="btn" onClick={() => A.editScene(sc.id)} title="Open this scene and set the sliders to edit all of its photos">Edit scene</button>
      </header>
      <div className="bshots">{list.map(p => <Shot key={p.name} p={p} list={list} />)}</div>
    </section>
  )
}

function NewScene() {
  const d = useDrop(names => A.movePhotos(names, 'new')), sel = S.multi.size
  return (
    <section className={'bcard bnew' + (d.over ? ' over' : '')} {...d.props}>
      <span>Drop photos here to start a new scene</span>
      {sel > 0 && <button className="btn" onClick={() => A.moveToScene('new')}>New scene from {sel === 1 ? 'the selected photo' : `${sel} selected`}</button>}
    </section>
  )
}

export function SceneBoard() {
  useTopic('film', 'left', 'status', 'thumbs')
  const n = S.photos.length, loose = S.photos.filter(p => !A.sceneOf(p))
  return (
    <div id="board">
      <header>
        <b>Scenes</b>
        <span className="hint">{S.scenes.length ? `${S.scenes.length} scene${S.scenes.length === 1 ? '' : 's'} · ${n} photos` : ''}</span>
        <span className="grow" />
        <span className="hint keys">type a name to rename · drag photos between scenes · drag ⠿ to merge · double-click to open</span>
        <button className="btn" onClick={() => A.findScenes(true)} title="Group the whole shoot again. Scenes keep their names and adjustments where they can.">Regroup</button>
        <button className="btn" onClick={() => A.toggle('board', false)}><Icon name="reject" size={13} /> Close</button>
      </header>
      <div className="bscroll">
        {!S.scenes.length && <div className="fempty">{S.analysed < n ? `Photos are grouped into scenes once they are all metered (${S.analysed} of ${n}).` : 'No scenes yet.'}</div>}
        {S.scenes.map(sc => <Card key={sc.id} sc={sc} list={A.scenePhotos(sc)} />)}
        {loose.length > 0 && S.scenes.length > 0 && (
          <section className="bcard loose">
            <header><b>Not in a scene yet</b><span className="hint">{loose.length} photo{loose.length === 1 ? '' : 's'} still being read, or that could not be read</span></header>
            <div className="bshots">{loose.map(p => <Shot key={p.name} p={p} list={loose} />)}</div>
          </section>
        )}
        {S.scenes.length > 0 && <NewScene />}
      </div>
    </div>
  )
}

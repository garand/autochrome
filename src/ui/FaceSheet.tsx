import { useEffect, useRef } from 'react'
import * as A from '../app/store'
import { FOCUS, S, useTopic, type Photo } from '../app/store'
import { stem } from '../engine/core'
import { Icon } from './widgets'

/* The face sheet: the current burst (or the selected photos) as rows of frames and columns of people, each face
   cropped tight and brightened evenly, with its eyes / focus / gaze checks. Built for group shots, where the
   question is "which frame has everyone's eyes open and sharp?". Arrow keys move between frames, P / X decide,
   clicking a face opens it at 100%. */

function FrameThumb({ p }: { p: Photo }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { const c = ref.current, t = p.thumb; if (!c || !t?.width) return; c.width = t.width; c.height = t.height; c.getContext('2d')!.drawImage(t, 0, 0) })
  return <canvas ref={ref} />
}

const focusOf = (s: number) => (s >= FOCUS.sharp ? 'sharp' : s >= FOCUS.soft ? 'in focus' : 'soft')

function Face({ p, i, small }: { p: Photo; i: number; small: boolean }) {
  const url = p.faceShots?.[i], c = p.cull?.faces?.[i]
  const problems = !c ? [] : !c.found ? ['unclear'] : [!c.open && 'eyes closed', c.sharp < FOCUS.soft && 'soft', !c.looking && 'looking away'].filter(Boolean) as string[]
  const tone = !c ? 'wait' : problems.some(x => x === 'eyes closed' || x === 'soft') ? 'bad' : problems.length ? 'warn' : 'ok'
  const tip = !c ? 'Checking this face…' : !c.found ? 'Could not read this face (profile, covered or too small)' : `${c.open ? 'Eyes open' : 'Eyes closed'} · ${focusOf(c.sharp)} (${Math.round(c.sharp)}) · ${c.looking ? 'at camera' : 'looking away'}${small ? ' · background face, not counted' : ''}\nClick to see it at 100%`
  return (
    <button className={'fface ' + tone + (small ? ' small' : '')} title={tip} onClick={() => A.zoomToFace(p, i)}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="fwait" />}
      <span className="fbadges">{tone === 'ok' ? <b className="fok"><Icon name="check" size={10} /></b> : problems.map(x => <b key={x}>{x}</b>)}</span>
    </button>
  )
}

export function FaceSheet() {
  useTopic('film', 'view', 'status')
  const frames = A.sheetFrames(), { cols, rows, aligned } = A.faceColumns(frames)
  const scored = frames.filter(p => p.cull?.n > 0), rank = (p: Photo) => p.cull.score * 1000 + Math.min(999, p.cull.sharp)
  const best = scored.length > 1 ? scored.reduce((a, b) => (rank(b) > rank(a) ? b : a)) : null
  const curRow = useRef<HTMLDivElement>(null)
  useEffect(() => { curRow.current?.scrollIntoView({ block: 'nearest' }) }, [S.cur])
  const pending = frames.some(p => !p.cull)
  return (
    <div id="faces">
      <header>
        <b>{S.multi.size > 1 ? `${frames.length} selected photos` : frames.length > 1 ? `Burst of ${frames.length} frames` : 'This photo'}</b>
        <span className="hint">{cols ? (aligned ? `${cols} ${cols === 1 ? 'person' : 'people'}` : 'faces listed per frame') : ''}{pending ? ' · checking faces…' : ''}</span>
        <span className="grow" />
        <span className="hint keys">↑ ↓ frames · P pick · X reject · click a face for 100%</span>
        <button className="btn" onClick={() => A.toggle('faces', false)}><Icon name="reject" size={13} /> Close</button>
      </header>
      {!cols ? <div className="fempty">{pending ? 'Looking for faces…' : 'No faces found in these frames. The face sheet is for portraits and group shots; select a few photos to compare them here.'}</div> : (
        <div className="fsheet" style={{ '--cols': cols } as any}>
          {frames.map((p, ri) => {
            const big = Math.max(0, ...(p.cull?.faces || []).map((f: any) => f.px || 0))
            return (
              <div key={p.name} ref={p.name === S.cur ? curRow : undefined} className={'frow' + (p.name === S.cur ? ' cur' : '') + (p.flag === -1 ? ' rejected' : '') + (p.flag === 1 ? ' picked' : '')}>
                <button className="fframe" onClick={e => A.select(p.name, e)} title={p.name}>
                  <FrameThumb p={p} />
                  <span className="fname">{stem(p.name)}</span>
                  <span className="fmeta">
                    {p.flag === 1 && <b className="pick"><Icon name="check" size={10} /> pick</b>}{p.flag === -1 && <b className="rej"><Icon name="reject" size={10} /> reject</b>}
                    {p === best && <b className="best" title="Best frame here: most eyes open, at camera and in focus">best</b>}
                    {p.cull?.n > 0 && <em title="Cull score: eyes open, looking at the camera and focus">{p.cull.score}</em>}
                  </span>
                </button>
                {rows[ri].map((fi, ci) => fi === undefined ? <span key={ci} /> : fi == null
                  ? <div key={ci} className="fface missing" title="This person was not found in this frame (turned away, covered, or out of frame)">not found</div>
                  : <Face key={ci} p={p} i={fi} small={!!big && (p.cull?.faces?.[fi]?.px || 0) < big * 0.45} />)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

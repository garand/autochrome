import * as A from '../app/store'
import { FOCUS, S, cur, dimsOf, useTopic } from '../app/store'
import { LICENSE_URL } from '../samples'
import { Section } from './widgets'

function History() {
  return (
    <Section id="history" title="History" defaultOpen={false} extra={<span className="hint">{S.history.length || ''}</span>}>
      <ul className="list hist">{S.history.map((h, i) => <li key={i} className={i === S.hIdx ? 'on' : i > S.hIdx ? 'future' : ''} onClick={() => A.jump(i)}><span>{h.label}</span></li>).reverse()}</ul>
    </Section>
  )
}

/* the spot this photo was taken at: rename it, edit it as a whole, move photos between spots */
function SceneInfo() {
  const p = cur(), sc = A.sceneOf(p); if (!p || !sc) return null
  const list = A.scenePhotos(sc), n = list.length, edits = Object.keys(sc.ov).length, sel = S.multi.size, many = S.scenes.length > 1
  return (
    <Section id="scene" title="Scene" extra={<button className="mini txt" title="Group the whole shoot into scenes again. Scenes keep their names and adjustments where they can." onClick={e => { e.stopPropagation(); A.findScenes(true) }}>Regroup</button>}>
      <input key={sc.id + sc.name} className="textbox scname" defaultValue={sc.name} aria-label="Scene name" spellCheck={false}
        onBlur={e => A.renameScene(sc.id, e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = sc.name; (e.target as HTMLInputElement).blur() } }} />
      <p className="note">{n} photo{n === 1 ? '' : 's'} · {edits ? `${edits} adjustment${edits === 1 ? '' : 's'} of its own` : 'follows the shoot'}{many ? '' : '. Every photo looks like one spot so far.'}</p>
      <div className="btnrow">
        {many && <button className={'btn' + (S.scope === 'scene' ? ' primary' : '')} onClick={() => A.setScope(S.scope === 'scene' ? 'project' : 'scene')} title="Sliders edit every photo of this scene (S cycles shoot, scene, photo)">{S.scope === 'scene' ? 'Editing scene' : 'Edit scene'}</button>}
        <button className="btn" onClick={() => A.selectScene(sc.id)} disabled={n < 2 || (sel === n && list.every(q => S.multi.has(q.name)))}>Select all {n}</button>
      </div>
      <div className="btnrow">
        <select className="sel grow" value="" onChange={e => { if (e.target.value) A.moveToScene(e.target.value) }} aria-label="Move to scene">
          <option value="" disabled>Move {sel > 1 ? `${sel} selected` : 'this photo'} to…</option>
          {S.scenes.filter(s => s !== sc).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="new">A new scene</option>
        </select>
      </div>
      <div className="btnrow">
        <button className="btn" onClick={A.promoteScene} disabled={!Object.keys(p.ov).length} title="Use this photo's own adjustments for every photo of this scene">Make scene look</button>
        {edits > 0 && <button className="btn" onClick={A.resetScene} title="Drop this scene's adjustments so it follows the shoot">Reset scene</button>}
      </div>
    </Section>
  )
}

const Tick = ({ ok, label }: { ok?: boolean; label: string }) => <span className={'tick ' + (ok == null ? 'na' : ok ? 'ok' : 'bad')} title={label}>{label}</span>
function Info() {
  const p = cur(); if (!p) return null
  const m = p.meta || {}, [W, H] = dimsOf(p), c = p.cull
  return (
    <Section id="info" title="Photo">
      <dl className="meta">
        <dt>File</dt><dd>{p.name}</dd>
        {m.model && <><dt>Camera</dt><dd>{[m.make, m.model].filter(Boolean).join(' ')}</dd></>}
        {p.dim && <><dt>Size</dt><dd>{W} × {H} · {(W * H / 1e6).toFixed(1)} MP</dd></>}
        {m.time && <><dt>Taken</dt><dd>{new Date(m.time * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</dd></>}
        {p.credit && <><dt>By</dt><dd><a href={p.credit.topic} target="_blank" rel="noopener noreferrer" title="Open the Play Raw thread on PIXLS.US">{p.credit.author}</a></dd>
          <dt>Licence</dt><dd><a href={LICENSE_URL[p.credit.license]} target="_blank" rel="noopener noreferrer">{p.credit.license}</a></dd></>}
      </dl>
      <div className="sub"><span>Faces</span>{c?.n ? <em className="score" title="Cull score: eyes open, looking at the camera and focus">{c.score}</em> : null}</div>
      {!c ? <p className="note">Checking faces…</p> : !c.n ? <p className="note">No faces to check in this photo.</p> : (
        <ul className="faces">{c.faces.filter((f: any) => f.found).map((f: any, i: number) => (
          <li key={i}><b>{i + 1}</b><Tick ok={f.open} label={f.open ? 'eyes open' : 'eyes closed'} /><Tick ok={f.looking} label={f.looking ? 'at camera' : 'looking away'} /><Tick ok={f.sharp >= FOCUS.soft} label={f.sharp >= FOCUS.sharp ? 'sharp' : f.sharp >= FOCUS.soft ? 'in focus' : 'soft'} /></li>))}</ul>)}
      <div className="btnrow">
        <button className="btn" onClick={A.copySettings} title="⌘C">Copy</button><button className="btn" onClick={() => A.pasteSettings()} disabled={!S.clipboard} title="⌘V">Paste</button>
        {S.multi.size > 1 && <button className="btn" onClick={A.syncFromCurrent}>Sync {S.multi.size - 1}</button>}
      </div>
      <div className="btnrow"><button className="btn" onClick={A.clearPhoto}>Reset photo</button><button className="btn" onClick={A.promote} title="Use this photo's adjustments for the whole shoot">Make shoot look</button></div>
    </Section>
  )
}

export function Left() {
  useTopic('left', 'history', 'panel', 'film')
  return <aside id="left"><div className="scroll"><Info /><SceneInfo /><History /></div></aside>
}

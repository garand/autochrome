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
  return <aside id="left"><div className="scroll"><Info /><History /></div></aside>
}

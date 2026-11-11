import { useRef, useState } from 'react'
import * as A from '../app/store'
import { FOCUS, PRESETS, S, cur, dimsOf, useTopic } from '../app/store'
import { LICENSE_URL } from '../samples'
import { Icon, Section } from './widgets'

function Presets() {
  const all = A.allPresets(), file = useRef<HTMLInputElement>(null), [naming, setNaming] = useState(false), [name, setName] = useState('')
  const row = (n: string, user: boolean) => (
    <li key={n} onMouseEnter={() => A.setPreview({ replace: true, s: all[n] })} onClick={() => A.applyPreset(n, all[n])}>
      <span>{n}</span>{user && <button className="mini" title="Delete preset" onClick={e => { e.stopPropagation(); A.deletePreset(n) }}><Icon name="trash" size={12} /></button>}
    </li>)
  return (
    <Section id="presets" title="Presets" extra={<>
      <button className="mini" title="See this photo in every preset" onClick={e => { e.stopPropagation(); S.browser = 'presets'; A.emit('view') }}><Icon name="grid" size={13} /></button>
      <button className="mini" title="Save the current adjustments as a preset" onClick={e => { e.stopPropagation(); setNaming(true) }}><Icon name="plus" size={13} /></button></>}>
      {naming && <form className="inline" onSubmit={e => { e.preventDefault(); if (name.trim()) A.savePreset(name.trim()); setNaming(false); setName('') }}>
        <input autoFocus placeholder="Preset name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setNaming(false) }} /><button className="btn primary">Save</button></form>}
      <ul className="list" onMouseLeave={() => A.setPreview(null)}>
        {Object.keys(PRESETS).map(n => row(n, false))}
        {Object.keys(S.userPresets).length > 0 && <li className="head">Yours</li>}
        {Object.keys(S.userPresets).map(n => row(n, true))}
      </ul>
      <div className="btnrow"><button className="btn" onClick={() => file.current!.click()} title="Lightroom .xmp presets and .cube LUTs">Import…</button></div>
      <input ref={file} type="file" hidden multiple accept=".xmp,.cube,.lrtemplate" onChange={e => { A.importFiles([...(e.target.files || [])]); e.target.value = '' }} />
      <p className="note">Hover to preview, click to apply. A preset replaces the adjustments for {S.scope === 'project' ? 'the whole shoot' : 'the selected photos'}.</p>
    </Section>
  )
}

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
  return <aside id="left"><div className="scroll"><Presets /><Info /><History /></div></aside>
}

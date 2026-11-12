import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ICONS } from '../engine/core'

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={(ICONS as any)[name]} /></svg>
}
export function IconBtn({ icon, title, on, onClick, children, ...rest }: { icon?: string; title: string; on?: boolean; onClick?: (e: any) => void; children?: ReactNode } & Record<string, any>) {
  return <button className={'ib' + (on ? ' on' : '') + (children ? ' wide' : '')} title={title} aria-label={title} aria-pressed={on} onClick={onClick} {...rest}>{icon && <Icon name={icon} />}{children}</button>
}
export function Section({ id, title, count, onReset, defaultOpen = true, extra, children }: { id: string; title: string; count?: number; onReset?: () => void; defaultOpen?: boolean; extra?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem('autochrome:sec:' + id); return v == null ? defaultOpen : v === '1' } catch { return defaultOpen } })
  const flip = () => { setOpen(o => { try { localStorage.setItem('autochrome:sec:' + id, o ? '0' : '1') } catch {} return !o }) }
  return (
    <section className={'sec' + (open ? '' : ' closed')}>
      <header onClick={flip}>
        <span className="chev"><Icon name="chevron" size={12} /></span><h3>{title}</h3>
        {count ? <span className="cnt" title={`${count} changed`}>{count}</span> : null}
        <span className="grow" />{extra}
        {onReset && count ? <button className="mini" title={`Reset ${title}`} onClick={e => { e.stopPropagation(); onReset() }}><Icon name="reset" size={13} /></button> : null}
      </header>
      {open && <div className="body">{children}</div>}
    </section>
  )
}
const fmt = (v: number, step: number, signed: boolean) => (step < 1 ? (signed && v > 0 ? '+' : '') + v.toFixed(2) : (signed && v > 0 ? '+' : '') + Math.round(v))
const snap = (v: number, step: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))

/* A DialKit-style slider: the whole row is the control. Drag anywhere on it to scrub (Shift for fine), click the
   number to type, double-click to reset, arrow keys step (Shift x10). Two-way values fill from the centre.
   With onAuto, an A appears on hover and Shift+double-click sets the control automatically (as in Lightroom). */
export function Slider({ label, value, min, max, step = 1, def = 0, cls, ov, ovScene, swatch, show, parse, note, onChange, onCommit, onReset, onClearOv, onAuto }: {
  label: string; value: number; min: number; max: number; step?: number; def?: number; cls?: string; ov?: boolean; swatch?: string
  ovScene?: boolean   // the difference comes from the photo's scene rather than the photo itself
  show?: (v: number) => string; parse?: (text: string) => number   // custom display (e.g. 5200 K) and the reverse for typed values
  note?: string                                                    // a quiet second value, e.g. the auto exposure offset
  onChange: (v: number) => void; onCommit?: (v: number) => void; onReset?: () => void; onClearOv?: () => void
  onAuto?: () => void
}) {
  const signed = min < 0 && max > 0, [text, setText] = useState<string | null>(null), [drag, setDrag] = useState(false), [settle, setSettle] = useState(false)
  const last = useRef(value), d = useRef<{ x: number; v: number; w: number; moved: boolean } | null>(null), box = useRef<HTMLDivElement>(null); last.current = value
  const pct = (x: number) => (Math.min(max, Math.max(min, x)) - min) / (max - min) * 100, p = pct(value), z = signed ? pct(0) : 0
  const label2 = show ? show(value) : fmt(value, step, signed)
  const reset = () => { setSettle(true); setTimeout(() => setSettle(false), 260); if (onReset) onReset(); else { onChange(def); onCommit?.(def) } }
  const typed = () => { if (text == null) return; const v = parse ? parse(text) : parseFloat(text); setText(null); if (!isNaN(v)) { const c = Math.min(max, Math.max(min, v)); onChange(c); onCommit?.(c) } }
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.dval, .dot, .dauto')) return
    d.current = { x: e.clientX, v: value, w: box.current!.getBoundingClientRect().width, moved: false }; box.current!.setPointerCapture(e.pointerId); box.current!.focus()
  }
  const move = (e: React.PointerEvent) => {
    const s = d.current; if (!s) return; const dx = e.clientX - s.x; if (!s.moved && Math.abs(dx) < 3) return
    if (!s.moved) { s.moved = true; setDrag(true) }
    onChange(snap(s.v + dx / s.w * (max - min) * (e.shiftKey ? 0.1 : 1), step, min, max))
  }
  const up = () => { const s = d.current; d.current = null; if (s?.moved) { setDrag(false); onCommit?.(last.current) } }
  const key = (e: React.KeyboardEvent) => {
    const k = e.key, big = e.shiftKey ? 10 : 1
    if (k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); const v = snap(value + (k === 'ArrowRight' || k === 'ArrowUp' ? 1 : -1) * step * big, step, min, max); onChange(v); onCommit?.(v) }
    else if (k === 'Home' || k === 'End') { e.preventDefault(); const v = k === 'Home' ? min : max; onChange(v); onCommit?.(v) }
    else if (k === 'Enter') { e.preventDefault(); setText(show ? show(value) : fmt(value, step, false)) }
    else if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); reset() }
  }
  return (
    <div ref={box} className={'dial' + (cls ? ' ' + cls : '') + (ov ? ' ov' : '') + (ov && ovScene ? ' ovs' : '') + (value !== def ? ' changed' : '') + (drag ? ' dragging' : '') + (settle ? ' settle' : '')}
      role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={label2}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={e => { if ((e.target as HTMLElement).closest('.dval, .dauto')) return; if (e.shiftKey && onAuto) onAuto(); else reset() }} onKeyDown={key} title={'Drag to adjust, Shift for fine. Double-click to reset.' + (onAuto ? ' Shift+double-click for auto.' : '')}>
      <i className="dfill" style={{ left: Math.min(p, z) + '%', width: Math.abs(p - z) + '%' }} />
      {signed && <i className="dzero" style={{ left: z + '%' }} />}
      <i className="dedge" style={{ left: p + '%' }} />
      <span className="dlabel">
        {onClearOv && <i className="dot" title={ovScene ? 'Set for this scene. Click to go back to the shoot value.' : 'Set on this photo only. Click to go back to the value above it.'} onClick={e => { e.stopPropagation(); onClearOv() }} />}
        {swatch && <i className="sw" style={{ background: swatch }} />}{label}
      </span>
      {note && <span className="dnote">{note}</span>}
      {onAuto && text == null && <button className="dauto" tabIndex={-1} title={`Auto ${label.toLowerCase()} (Shift+double-click)`} onClick={e => { e.stopPropagation(); onAuto() }}>A</button>}
      {text != null
        ? <input className="dval editing" autoFocus value={text} onFocus={e => requestAnimationFrame(() => e.target.select())} onChange={e => setText(e.target.value)} onBlur={typed} aria-label={label + ' value'}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { setText(null); box.current?.focus() } }} />
        : <span className="dval" onClick={e => { e.stopPropagation(); setText(show ? show(value) : fmt(value, step, false)) }} title="Click to type a value">{label2}</span>}
    </div>
  )
}

/* A two-value pad (DialKit's XY pad): drag the puck, Shift locks to the axis you started on, double-click resets. */
export function Pad({ x, y, xr, yr, cls, title, onChange, onCommit, onReset, children }: {
  x: number; y: number; xr: [number, number]; yr: [number, number]; cls?: string; title?: string
  onChange: (x: number, y: number) => void; onCommit?: () => void; onReset?: () => void; children?: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null), d = useRef<{ x0: number; y0: number; sx: number; sy: number; lock: 0 | 1 | 2 } | null>(null), [drag, setDrag] = useState(false)
  const px = (x - xr[0]) / (xr[1] - xr[0]) * 100, py = 100 - (y - yr[0]) / (yr[1] - yr[0]) * 100
  const at = (e: React.PointerEvent) => { const b = box.current!.getBoundingClientRect(); return [xr[0] + Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * (xr[1] - xr[0]), yr[0] + Math.min(1, Math.max(0, 1 - (e.clientY - b.top) / b.height)) * (yr[1] - yr[0])] }
  const down = (e: React.PointerEvent) => { if (e.button !== 0) return; box.current!.setPointerCapture(e.pointerId); const [a, b] = at(e); d.current = { x0: e.clientX, y0: e.clientY, sx: x, sy: y, lock: 0 }; setDrag(true); onChange(Math.round(a), Math.round(b)) }
  const move = (e: React.PointerEvent) => {
    const s = d.current; if (!s) return; let [a, b] = at(e)
    if (e.shiftKey) { if (!s.lock) s.lock = Math.abs(e.clientX - s.x0) >= Math.abs(e.clientY - s.y0) ? 1 : 2; if (s.lock === 1) b = s.sy; else a = s.sx } else s.lock = 0
    onChange(Math.round(a), Math.round(b))
  }
  const up = () => { if (d.current) { d.current = null; setDrag(false); onCommit?.() } }
  return (
    <div ref={box} className={'pad' + (cls ? ' ' + cls : '') + (drag ? ' dragging' : '')} title={title} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={onReset}>
      <i className="pcross" style={{ left: (0 - xr[0]) / (xr[1] - xr[0]) * 100 + '%', top: 100 - (0 - yr[0]) / (yr[1] - yr[0]) * 100 + '%' }} />
      <i className="puck" style={{ left: px + '%', top: py + '%' }} />
      {children}
    </div>
  )
}
export function Seg<T extends string | number>({ value, options, onChange, accent }: { value: T; options: [T, string][]; onChange: (v: T) => void; accent?: boolean }) {
  return <div className={'seg' + (accent ? ' accent' : '')} role="tablist">{options.map(([v, l]) => <button key={String(v)} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>
}
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true) }, [onClose])
  return <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className={'dlg' + (wide ? ' wide' : '')} role="dialog" aria-label={title}><h2>{title}<button className="mini" onClick={onClose} title="Close"><Icon name="reject" /></button></h2>{children}</div></div>
}

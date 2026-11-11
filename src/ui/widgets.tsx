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
export function Slider({ label, value, min, max, step = 1, def = 0, cls, ov, swatch, onChange, onCommit, onReset, onClearOv }: {
  label: string; value: number; min: number; max: number; step?: number; def?: number; cls?: string; ov?: boolean; swatch?: string
  onChange: (v: number) => void; onCommit?: (v: number) => void; onReset?: () => void; onClearOv?: () => void
}) {
  const signed = min < 0, [text, setText] = useState<string | null>(null), last = useRef(value); last.current = value
  const p = (value - min) / (max - min) * 100, z = signed ? (0 - min) / (max - min) * 100 : 0
  const reset = () => (onReset ? onReset() : (onChange(def), onCommit?.(def)))
  const typed = () => { if (text == null) return; const v = parseFloat(text); setText(null); if (!isNaN(v)) { const c = Math.min(max, Math.max(min, v)); onChange(c); onCommit?.(c) } }
  return (
    <div className={'row' + (ov ? ' ov' : '') + (value !== def ? ' changed' : '')}>
      <label onDoubleClick={reset} title="Double-click to reset">
        {onClearOv && <i className="dot" title="Set on this photo only. Click to go back to the shoot value." onClick={e => { e.stopPropagation(); onClearOv() }} />}
        {swatch && <i className="sw" style={{ background: swatch }} />}{label}
      </label>
      <input type="range" className={cls} min={min} max={max} step={step} value={value} style={{ '--a': Math.min(p, z) + '%', '--b': Math.max(p, z) + '%' } as any}
        onChange={e => onChange(+e.target.value)} onPointerUp={() => onCommit?.(last.current)} onKeyUp={() => onCommit?.(last.current)} onDoubleClick={reset} aria-label={label} />
      <input className="num" value={text ?? fmt(value, step, signed)} onFocus={e => { setText(fmt(value, step, false)); requestAnimationFrame(() => e.target.select()) }} onChange={e => setText(e.target.value)} onBlur={typed}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur() } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const v = Math.min(max, Math.max(min, value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1))); onChange(v); onCommit?.(v); setText(fmt(v, step, false)) } e.stopPropagation() }} aria-label={label + ' value'} />
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

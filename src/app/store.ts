/* Application state and actions. The engine (decode workers, GPU renderer) is driven from here;
   React components subscribe to topics with useTopic() and call the functions exported as A. */
import { useSyncExternalStore } from 'react'
import wasmUrl from 'libraw-wasm-nothread/dist/libraw.wasm?url'
import { DEF, FULL, HSL, IMG_EXT, KEYS, LOOKS, MASK_ADJ, RAW_EXT, clamp, clone, cropValid, eq, extOf, fixCrop, half2f, lutCache, mapply, mgl, minv, parseCube, stem, texMatrix } from '../engine/core'
import { Renderer, type GpuImage } from '../engine/gl'
import { checkFaces } from '../engine/faces'
import type { Sample } from '../samples'
import { SRGB_SHOT, asShot, neutralise, type WbState } from '../engine/wb'
import { bake, fromSettings, migrate, resolve, setUserStyles, styleById, userStyles, type Style } from '../engine/styles'

/* ------------------------------------------------------------------ topics */
const versions: Record<string, number> = {}, listeners: Record<string, Set<() => void>> = {}
export function emit(...topics: string[]) { for (const t of topics) { versions[t] = (versions[t] || 0) + 1; listeners[t]?.forEach(f => f()) } }
export function useTopic(...topics: string[]) {
  return useSyncExternalStore(
    cb => { for (const t of topics) (listeners[t] ||= new Set()).add(cb); return () => { for (const t of topics) listeners[t].delete(cb) } },
    () => topics.map(t => versions[t] || 0).join(','), () => '')
}
const ALL = ['panel', 'film', 'view', 'history', 'status', 'left']

/* ------------------------------------------------------------------ state */
export interface Photo {
  name: string; kind: 'raw' | 'img'; size: number; load: () => Promise<ArrayBuffer>; read: (off: number, len: number) => Promise<ArrayBuffer>
  ov: Record<string, any>; crop: any; orient: { rot: number; flip: boolean }; masks: any[]; flag: number; rating: number; label: number
  stats: any; meta: any; dim: number[] | null; cull: any; t: any; mid: any; thumb: HTMLCanvasElement
  done?: boolean; analysing?: boolean; queued?: boolean; error?: string; dirty?: boolean; visible?: boolean; midAt?: number
  credit?: Sample   // set for the built-in samples, so the photographer is credited
  faceShots?: string[]   // tight face crops (object URLs), in the order of stats.faces
}
export const S = {
  photos: [] as Photo[], byName: new Map<string, Photo>(), cur: null as string | null, multi: new Set<string>(),
  scope: 'project' as 'project' | 'photo', source: null as any, title: '', key: null as string | null,
  proj: { settings: clone(DEF) as Record<string, any>, autoExposure: true, autoWB: false },
  tool: 'select' as 'select' | 'crop' | 'wb' | 'linear' | 'radial', zoom: 'fit' as 'fit' | number, pan: { x: 0.5, y: 0.5 },
  before: false, grid: false, faces: false, advance: true, clip: false, showMask: false, maskSel: -1, hslSel: 'orange', curveCh: 'm', panels: true, filter: 'all',
  preview: null as null | { s: any }, browser: null as null | 'styles', modal: null as null | string,
  history: [] as { label: string; json: string; key?: string; at: number }[], hIdx: -1, clipboard: null as any,
  analysed: 0, checked: 0, exporting: false, busy: false, lay: null as any, flash: '', lutDir: '',
}
export const cur = () => (S.cur ? S.byName.get(S.cur) : undefined)
/* your settings for a photo (shoot values plus its own overrides), and the plain values the renderer uses */
export const settingsOf = (p?: Photo | null) => ({ ...S.proj.settings, ...(p ? p.ov : {}) })
export const eff = (p?: Photo | null) => resolve(settingsOf(p))
export const curS = () => (S.scope === 'photo' ? settingsOf(cur()) : S.proj.settings)
const targets = () => [...S.multi].map(n => S.byName.get(n)!).filter(Boolean)
const blankPhoto = () => ({ ov: {}, crop: null, orient: { rot: 0, flip: false }, masks: [], flag: 0, rating: 0, label: 0 })
export const dimsOf = (p: Photo) => { const d = p.dim || (p.t ? [p.t.w, p.t.h] : [3, 2]); return p.orient.rot & 1 ? [d[1], d[0]] : d }
export const isEdited = (p: Photo) => Object.keys(p.ov).length > 0 || !!p.crop || p.masks.length > 0 || p.orient.rot !== 0 || p.orient.flip

/* ------------------------------------------------------------------ history + persistence */
function snap() {
  const p: any = {}
  for (const q of S.photos) if (isEdited(q) || q.flag || q.rating || q.label) p[q.name] = { ov: q.ov, crop: q.crop, orient: q.orient, masks: q.masks, flag: q.flag, rating: q.rating, label: q.label }
  return JSON.stringify({ s: S.proj.settings, ae: S.proj.autoExposure, aw: S.proj.autoWB, p })
}
function restore(json: string) {
  const d = JSON.parse(json)
  S.proj.settings = { ...clone(DEF), ...d.s }; S.proj.autoExposure = d.ae; S.proj.autoWB = d.aw
  for (const q of S.photos) { Object.assign(q, clone(blankPhoto()), clone(d.p[q.name] || {})); q.dirty = true; markThumb(q) }
  emit(...ALL); requestRender(); saveSoon()
}
export function commit(label: string, key?: string) {
  const json = snap(), last = S.history[S.hIdx]
  if (last && last.json === json) return
  if (key && last && last.key === key && Date.now() - last.at < 1500 && S.hIdx === S.history.length - 1) { last.json = json; last.label = label; last.at = Date.now() }
  else { S.history.length = S.hIdx + 1; S.history.push({ label, json, key, at: Date.now() }); if (S.history.length > 80) S.history.shift(); S.hIdx = S.history.length - 1 }
  emit('history'); saveSoon()
}
export function jump(i: number) { if (i < 0 || i >= S.history.length || i === S.hIdx) return; S.hIdx = i; restore(S.history[i].json) }
export const undo = () => jump(S.hIdx - 1)
export const redo = () => jump(S.hIdx + 1)

function projectData() {
  const photos: any = {}
  for (const p of S.photos) photos[p.name] = { ov: p.ov, crop: p.crop, orient: p.orient, masks: p.masks, flag: p.flag, rating: p.rating, label: p.label, stats: p.stats, meta: p.meta, dim: p.dim, cull: p.cull }
  return { v: 2, settings: S.proj.settings, autoExposure: S.proj.autoExposure, autoWB: S.proj.autoWB, photos }
}
function applyProject(d: any) {
  if (!d || !d.photos) return
  S.proj.settings = { ...clone(DEF), ...migrate(d.settings) }; S.proj.autoExposure = d.autoExposure !== false; S.proj.autoWB = !!d.autoWB
  for (const p of S.photos) {
    const s = d.photos[p.name]; if (!s) continue
    p.ov = migrate(s.ov) || {}; p.crop = s.crop || null; p.orient = s.orient || { rot: 0, flip: false }; p.masks = s.masks || []; p.flag = s.flag || 0; p.rating = s.rating || 0; p.label = s.label || 0
    if (s.stats && !p.stats) { p.stats = s.stats; p.meta = s.meta || p.meta; p.dim = s.dim || p.dim } if (s.cull && !p.cull) p.cull = s.cull
  }
}
let saveTimer: any = 0
export function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1200) }
async function saveNow() {
  if (!S.key || !S.photos.length) return
  const json = JSON.stringify(projectData())
  try {
    if (S.source?.kind === 'handle' && S.source.writable) { const fh = await S.source.dir.getFileHandle('autochrome-project.json', { create: true }), w = await fh.createWritable(); await w.write(json); await w.close() }
    else localStorage.setItem('autochrome:' + S.key, json)
  } catch (e) { /* saving is best-effort */ }
}

/* ------------------------------------------------------------------ settings */
export function setVal(k: string, v: any) {
  if (S.scope === 'photo') for (const p of targets()) { if (eq(v, S.proj.settings[k])) delete p.ov[k]; else p.ov[k] = v; markThumb(p) }
  else { S.proj.settings[k] = v; for (const p of S.photos) markThumb(p) }
  emit('panel'); requestRender()
}
export function resetKeys(keys: string[], label: string) {
  if (S.scope === 'photo') for (const p of targets()) { for (const k of keys) delete p.ov[k]; markThumb(p) }
  else { for (const k of keys) S.proj.settings[k] = clone(DEF[k]); for (const p of S.photos) markThumb(p) }
  emit('panel', 'film'); requestRender(); commit(label)
}
export function clearOv(k: string) { for (const p of targets()) { delete p.ov[k]; markThumb(p) } emit('panel', 'film'); requestRender(); commit('Use shoot value') }
export const isOv = (k: string) => { const p = cur(); return !!p && k in p.ov }
export const changedCount = (keys: string[]) => { const s = curS(); return keys.filter(k => !eq(s[k], DEF[k])).length }
export function setScope(s: 'project' | 'photo') { S.scope = s; emit('panel') }
/* ------------------------------------------------------------------ styles (see engine/styles.ts) */
export function setStyle(id: string) {
  const st = styleById(id); setVal('style', st ? st.id : 'none'); if (!curS().styleAmount) setVal('styleAmount', 100)
  S.preview = null; emit('film'); commit('Style: ' + (st?.name || 'None'), 'style')
}
const storeStyles = () => { try { localStorage.setItem('autochrome:styles', JSON.stringify(userStyles())) } catch {} }
/* save what you see as a style of your own; the photo does not change because the sliders are folded into it */
export function saveStyle(name: string) {
  const st = bake(name, curS()); setUserStyles([...userStyles().filter(s => s.id !== st.id), st]); storeStyles()
  const fresh = { ...clone(DEF), style: st.id, styleAmount: 100 }
  if (S.scope === 'photo') for (const p of targets()) { p.ov = {}; for (const k in fresh) if (!eq(fresh[k], S.proj.settings[k])) p.ov[k] = clone(fresh[k]); markThumb(p) }
  else { S.proj.settings = fresh; for (const p of S.photos) markThumb(p) }
  emit('left', 'panel', 'film'); requestRender(); commit('Save style ' + name); flash(`Saved style “${name}”`)
}
export function deleteStyle(id: string) {
  setUserStyles(userStyles().filter(s => s.id !== id)); storeStyles()
  if (S.proj.settings.style === id) S.proj.settings.style = 'none'; for (const p of S.photos) if (p.ov.style === id) delete p.ov.style
  for (const p of S.photos) markThumb(p); emit('panel', 'film'); requestRender()
}
function loadStyles() {
  let list: Style[] = []
  try { list = JSON.parse(localStorage.getItem('autochrome:styles') || '[]') } catch {}
  if (!list.length) try { const old = JSON.parse(localStorage.getItem('autochrome:presets') || '{}'); list = Object.entries(old).map(([n, s]: [string, any]) => fromSettings(n, s)) } catch {}
  setUserStyles(list)
}
export function setPreview(pv: typeof S.preview) { if (S.preview === pv) return; S.preview = pv; requestRender() }
export function copySettings() { const p = cur(); if (p) { S.clipboard = clone({ ov: p.ov, crop: p.crop, masks: p.masks }); flash('Copied adjustments') } }
export function pasteSettings(withCrop = false) { if (!S.clipboard) return; for (const p of targets()) { p.ov = clone(S.clipboard.ov); p.masks = clone(S.clipboard.masks); if (withCrop) p.crop = clone(S.clipboard.crop); markThumb(p) } emit('panel', 'film'); requestRender(); commit('Paste adjustments') }
export function syncFromCurrent() { const p = cur(); if (!p) return; for (const q of targets()) if (q !== p) { q.ov = clone(p.ov); q.masks = clone(p.masks); markThumb(q) } emit('film'); commit(`Sync to ${S.multi.size - 1} photos`); flash(`Synced to ${S.multi.size - 1} photos`) }
export function clearPhoto() { for (const p of targets()) { Object.assign(p, clone({ ov: {}, masks: [], crop: null, orient: { rot: 0, flip: false } })); markThumb(p) } S.maskSel = -1; emit('panel', 'film', 'view'); requestRender(); commit('Reset photo') }
export function promote() { const p = cur(); if (!p) return; S.proj.settings = clone(settingsOf(p)); p.ov = {}; for (const q of S.photos) markThumb(q); emit('panel', 'film'); requestRender(); commit('Make shoot look') }
export function setAuto(key: 'autoExposure' | 'autoWB', on: boolean) { S.proj[key] = on; for (const p of S.photos) markThumb(p); emit('panel'); requestRender(); commit(key === 'autoExposure' ? 'Auto exposure' : 'Auto white balance') }
export function flash(msg: string) { S.flash = msg; emit('status'); setTimeout(() => { if (S.flash === msg) { S.flash = ''; emit('status') } }, 3500) }

/* ------------------------------------------------------------------ metering */
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }
function meterGain(st: any) {
  const scene = 0.17 / Math.max(st.geo, 1e-4); let g = scene
  if (st.skin) { g = Math.pow(0.34 / st.skin.y, 0.65) * Math.pow(scene, 0.35); g = Math.min(g, 0.62 / st.skin.max) }
  g = Math.min(g, 0.27 / Math.max(st.median, 1e-4)); g = Math.max(g, 0.12 / Math.max(st.median, 1e-4))
  return clamp(g, 0.2, 24)
}
const skinWB = (st: any) => [clamp(Math.pow(1.8 / st.skin.rg, 0.8), 0.8, 1.7), 1, clamp(Math.pow(0.78 / st.skin.bg, 0.8), 0.5, 1.25)]
let baseEv = 2
/* how far 'Balance exposure across the shoot' moves this photo, in stops (added to the Exposure slider) */
export const autoEvOffset = (p: Photo) => autoFor(p).ev - baseEv
function recomputeBase() { const g = S.photos.filter(p => p.stats).map(p => Math.log2(meterGain(p.stats))); if (g.length) baseEv = median(g) }
/* the photo's as-shot white balance: real camera data for raws, an sRGB / D65 model otherwise */
export const wbShot = (p?: Photo | null): WbState => (p?.meta?.color ? asShot(p.meta.color) : SRGB_SHOT)
export function autoFor(p: Photo) {
  const a = { ev: baseEv, black: 0, wb: [1, 1, 1], shot: wbShot(p) }
  if (p.stats && S.proj.autoExposure) { a.ev = Math.log2(meterGain(p.stats)); a.black = 0.5 * p.stats.p01 }
  if (S.proj.autoWB) {
    let src = p.stats?.skin ? p : null
    if (!src) { const i = S.photos.indexOf(p); for (let d = 1; d <= 10 && !src; d++) for (const q of [S.photos[i - d], S.photos[i + d]]) if (q?.stats?.skin) { src = q; break } }
    if (src) a.wb = skinWB(src.stats)
  }
  return a
}

/* ------------------------------------------------------------------ culling */
export const FOCUS = { soft: 6, sharp: 14 }   // face focus score: below soft = out of focus, above sharp = crisp
function summarise(p: Photo, checks: any[]) {
  const faces = p.stats.faces.map((f: any, i: number) => ({ ...checks[i], sharp: f.sharp, px: f.px }))
  const big = Math.max(0, ...faces.map((f: any) => f.px || 0)), main = faces.filter((f: any) => f.found && f.px >= big * 0.45)
  if (!main.length) return { n: 0, faces }
  const open = main.filter((f: any) => f.open).length, looking = main.filter((f: any) => f.looking).length, sharp = median(main.map((f: any) => f.sharp))
  const focus = clamp(Math.log(Math.max(sharp, 1) / 2) / Math.log(FOCUS.sharp * 2 / 2))
  return { n: main.length, open, looking, sharp, blink: open < main.length, away: looking < main.length, soft: sharp < FOCUS.soft, score: Math.round(100 * (0.45 * open / main.length + 0.2 * looking / main.length + 0.35 * focus)), faces }
}
const faceQ: { p: Photo; crops: Uint8ClampedArray[] }[] = []; let faceBusy = false, facePending: Photo | null = null
const countChecked = () => { S.checked = S.photos.filter(p => p.cull).length }
async function pumpFaces() {
  if (faceBusy) return; faceBusy = true
  while (faceQ.length) {
    const { p, crops } = faceQ.shift()!; facePending = p
    try { p.cull = summarise(p, await checkFaces(crops)) } catch (e) { p.cull = { n: 0, faces: [] } }
    facePending = null; countChecked(); emit('film', 'status', 'left'); saveSoon()
    await new Promise(r => setTimeout(r, 0))
  }
  faceBusy = false
}
/* ------------------------------------------------------------------ culling helpers */
/* photos taken within `gap` seconds of each other, in shoot order */
export function bursts(gap = 3, list: Photo[] = S.photos) {
  const groups: Photo[][] = []; let prev: Photo | null = null
  for (const p of list) { const t = p.meta?.time, pt = prev?.meta?.time; if (prev && t != null && pt != null && Math.abs(t - pt) <= gap) groups[groups.length - 1].push(p); else groups.push([p]); prev = p }
  return groups
}
/* the frames the face sheet shows: the selection if several are selected, else the current photo's burst */
export function sheetFrames() {
  const p = cur(); if (!p) return []
  if (S.multi.size > 1) return S.photos.filter(q => S.multi.has(q.name))
  return bursts(3, visiblePhotos()).find(g => g.includes(p)) || [p]
}
/* line people up across frames: each face goes to the nearest column of the frame with the most faces */
export function faceColumns(frames: Photo[]) {
  if (frames.some(p => p.meta?.time != null) && bursts(3, frames).length > 1) {   // different scenes: people do not correspond, so just list each frame's faces
    const rows = frames.map(p => (p.stats?.faces || []).map((f: any, i: number) => ({ x: f.x, i })).sort((a: any, b: any) => a.x - b.x).map((o: any) => o.i as number | null))
    const cols = Math.max(0, ...rows.map(r => r.length)); return { cols, rows: rows.map(r => [...r, ...Array(cols - r.length).fill(undefined)]), aligned: false }
  }
  const ref = frames.reduce((a, b) => ((b.stats?.faces?.length || 0) > (a.stats?.faces?.length || 0) ? b : a), frames[0])
  const cols: { x: number; y: number }[] = [...(ref?.stats?.faces || [])].map((f: any) => ({ x: f.x, y: f.y })).sort((a, b) => a.x - b.x)
  const rows = frames.map(p => {
    const faces: any[] = p.stats?.faces || [], cells: (number | null)[] = cols.map(() => null)
    const order = faces.map((f, i) => ({ f, i })).sort((a, b) => a.f.x - b.f.x)
    for (const { f, i } of order) {
      let best = -1, bd = 0.18
      cols.forEach((c, k) => { const d = Math.hypot(c.x - f.x, (c.y - f.y) * 0.7); if (cells[k] == null && d < bd) { bd = d; best = k } })
      if (best < 0) { cols.push({ x: f.x, y: f.y }); cells.push(i) } else cells[best] = i
    }
    return cells
  })
  return { cols: cols.length, rows: rows.map(r => [...r, ...Array(cols.length - r.length).fill(null)]), aligned: true }
}
/* after a pick, reject or rating, move on to the next photo (Lightroom's auto-advance) */
function advance() { if (!S.advance) return; const a = visiblePhotos(), i = a.findIndex(q => q.name === S.cur); if (i >= 0 && i < a.length - 1) select(a[i + 1].name) }
export function setAdvance(on: boolean) { S.advance = on; try { localStorage.setItem('autochrome:advance', on ? '1' : '0') } catch {} emit('view') }
let cheered = ''
/* a small acknowledgement when every photo in the shoot has a decision */
function celebrate() {
  const n = S.photos.length, open = S.photos.filter(p => !p.flag).length, key = S.key + ':' + n
  if (n > 1 && open === 0 && cheered !== key) { cheered = key; const picks = S.photos.filter(p => p.flag === 1).length; flash(`Every photo decided: ${picks} pick${picks === 1 ? '' : 's'} from ${n}. Nice work.`) }
}
/* jump to 100% on one face of a photo */
export async function zoomToFace(p: Photo, i: number) {
  const f = p.stats?.faces?.[i]; if (!f) return
  S.faces = false; S.grid = false; if (S.cur !== p.name) await select(p.name)
  const g = p.crop || FULL; S.pan = p.orient.rot ? { x: 0.5, y: 0.5 } : { x: clamp((f.x - (g.cx - g.w / 2)) / g.w), y: clamp((f.y - (g.cy - g.h / 2)) / g.h) }
  S.zoom = 1; if (S.tool === 'crop') setTool('select'); emit('view', 'film', 'panel'); requestRender(); wantFull()
}

export function autoCull(o: { pickBest: boolean; rejectBlinks: boolean; rejectSoft: boolean; gap: number }) {
  const groups = bursts(o.gap)
  let picks = 0, rejects = 0
  for (const g of groups) {
    const scored = g.filter(p => p.cull?.n > 0); if (!scored.length) continue
    const rank = (p: Photo) => p.cull.score * 1000 + Math.min(999, p.cull.sharp)   // focus breaks ties between equally good frames
    const best = scored.reduce((a, b) => (rank(b) > rank(a) ? b : a))
    for (const p of scored) {
      const bad = (o.rejectBlinks && p.cull.blink && !best.cull.blink) || (o.rejectSoft && p.cull.soft && !best.cull.soft)
      if (bad && p !== best) { p.flag = -1; rejects++ }
      else if (o.pickBest && p === best && !(p.cull.soft && o.rejectSoft) && !(p.cull.blink && o.rejectBlinks)) { p.flag = 1; picks++ }
    }
  }
  emit('film', 'status'); commit('Auto cull'); flash(`Auto cull: ${picks} picked, ${rejects} rejected in ${groups.filter(g => g.length > 1).length} bursts`)
  return { picks, rejects }
}

/* ------------------------------------------------------------------ decode pool */
const pool = {
  workers: [] as { w: Worker; busy: boolean }[], queue: [] as any[], seq: 1, pending: new Map<number, any>(),
  async init() {
    const [wasm, cascade] = await Promise.all([fetch(wasmUrl).then(r => r.arrayBuffer()), fetch('/facefinder.bin').then(r => r.arrayBuffer())])
    const n = clamp(Math.floor((navigator.hardwareConcurrency || 4) / 2), 1, 4)
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../engine/decode.worker.ts', import.meta.url), { type: 'module' }), slot = { w, busy: true }
      w.onmessage = e => { const p = this.pending.get(e.data.id); if (!p) return; this.pending.delete(e.data.id); slot.busy = false; e.data.ok ? p.res(e.data.out) : p.rej(new Error(e.data.error)); this.pump() }
      w.onerror = e => console.error('decode worker error', e.message)
      this.workers.push(slot)
      const id = this.seq++; this.pending.set(id, { res() {}, rej(e: any) { console.error(e) } })
      const a = wasm.slice(0), b = cascade.slice(0); w.postMessage({ id, type: 'init', wasm: a, cascade: b }, [a, b])
    }
  },
  run(make: () => Promise<[any, Transferable[]]>, prio = 0, key: string | null = null) { return new Promise<any>((res, rej) => { this.queue.push({ make, prio, key, res, rej }); this.queue.sort((a, b) => b.prio - a.prio); this.pump() }) },
  bump(key: string, prio: number) { const j = this.queue.find(j => j.key === key); if (j) { j.prio = prio; this.queue.sort((a, b) => b.prio - a.prio) } return !!j },
  cancel(pred: (j: any) => boolean) { this.queue = this.queue.filter(j => { if (pred(j)) { j.rej(new Error('cancelled')); return false } return true }) },
  async pump() {
    for (const slot of this.workers) {
      if (slot.busy || !this.queue.length) continue
      const job = this.queue.shift(); slot.busy = true
      try { const [msg, transfer] = await job.make(); const id = this.seq++; msg.id = id; this.pending.set(id, job); slot.w.postMessage(msg, transfer) } catch (e) { slot.busy = false; job.rej(e) }
    }
  },
}
const decodeJob = (p: Photo, half: boolean, want: any) => async (): Promise<[any, Transferable[]]> => { const buf = await p.load(); return [{ type: 'decode', kind: p.kind, buf, half, want }, [buf]] }
function takeResult(p: Photo, r: any) {
  let fresh = false
  if (!p.dim) p.dim = r.half ? [r.w * 2, r.h * 2] : [r.w, r.h]
  if (r.stats && (!p.stats || (r.faceCrops && !p.cull && !faceQ.some(q => q.p === p) && facePending !== p))) { p.stats = r.stats; fresh = true }
  if (r.meta && !p.meta) p.meta = r.meta
  if (r.faceCrops && !p.cull && !faceQ.some(q => q.p === p) && facePending !== p) { if (r.faceCrops.length) { faceQ.push({ p, crops: r.faceCrops }); pumpFaces() } else { p.cull = { n: 0, faces: [] }; countChecked() } }
  if (r.faceShots) { for (const u of p.faceShots || []) if (u) URL.revokeObjectURL(u); p.faceShots = r.faceShots.map((b: Blob | null) => (b ? URL.createObjectURL(b) : '')) }
  if (r.thumb) { p.t = { w: r.thumb.w, h: r.thumb.h, data: r.thumb.data, blur: r.thumbBlur }; markThumb(p) }
  if (r.mid) { p.mid = r.mid; p.midAt = performance.now(); const keep = S.photos.filter(q => q.mid).sort((a, b) => b.midAt! - a.midAt!); for (const q of keep.slice(8)) q.mid = null }
  if (!p.done) { p.done = true; S.analysed++; pool.cancel(j => j.key === 'an:' + p.name) }
  if (fresh) { recomputeBase(); saveSoon(); if (!S.proj.autoExposure || S.proj.autoWB) for (const q of S.photos) markThumb(q); if (p.name === S.cur || !S.proj.autoExposure) requestRender() }
  emit('status', 'film')
}
function analyse(p: Photo, prio: number) {
  if (p.done || p.analysing) return; p.analysing = true
  pool.run(decodeJob(p, true, { stats: true, faces: !p.cull, shots: true, thumb: true }), prio, 'an:' + p.name).then(r => takeResult(p, r))
    .catch(e => { if (e.message !== 'cancelled') { p.error = e.message; if (!p.done) { p.done = true; S.analysed++ } emit('status', 'film') } }).finally(() => { p.analysing = false })
}
const texCache = new Map<string, { img: GpuImage; full: boolean; at: number }>()
function cachePut(name: string, img: GpuImage, full: boolean) {
  const old = texCache.get(name); if (old) view.free(old.img)
  texCache.set(name, { img, full, at: performance.now() }); let cost = 0
  for (const [n, c] of [...texCache.entries()].sort((a, b) => b[1].at - a[1].at)) { cost += c.full ? 4 : 1; if (cost > 8 && n !== S.cur) { view.free(c.img); texCache.delete(n) } }
}
const loading = new Map<string, Promise<any>>()
function loadPixels(p: Photo, full: boolean, prio: number) {
  const c = texCache.get(p.name); if (c && (c.full || !full)) { c.at = performance.now(); return Promise.resolve(c) }
  const key = p.name + (full ? ':full' : ':half'); if (loading.has(key)) { pool.bump(key, prio); return loading.get(key)! }
  const pr = pool.run(decodeJob(p, !full, { stats: !p.stats || !p.cull, faces: !p.cull && !full, thumb: !p.t, mid: true, pixels: true }), prio, key)
    .then(r => { takeResult(p, r); cachePut(p.name, view.upload(r.pixels, r.w, r.h, r.blur), full); return texCache.get(p.name) }).finally(() => loading.delete(key))
  loading.set(key, pr); return pr
}

/* ------------------------------------------------------------------ viewer */
let view: Renderer, work: Renderer, viewerEl: HTMLElement | null = null, renderQueued = false
export function attachView(canvas: HTMLCanvasElement, viewer: HTMLElement) { view = new Renderer(canvas); work = new Renderer(document.createElement('canvas')); viewerEl = viewer; new ResizeObserver(requestRender).observe(viewer) }
export function requestRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render() }) } }
function layout(p: Photo) {
  const [W, H] = dimsOf(p), cropping = S.tool === 'crop', base = cropping ? { ...FULL, angle: p.crop?.angle || 0 } : (p.crop || FULL)
  const pxW = base.w * W, pxH = base.h * H, dpr = window.devicePixelRatio || 1, vW = viewerEl!.clientWidth, vH = viewerEl!.clientHeight, pad = cropping ? 30 : 18
  const fit = Math.min((vW - 2 * pad) / pxW, (vH - 2 * pad) / pxH), z = cropping || S.zoom === 'fit' ? fit : Math.max(fit, (S.zoom as number) / dpr)
  const cssW = Math.min(vW, pxW * z), cssH = Math.min(vH, pxH * z), fw = cssW / (pxW * z), fh = cssH / (pxH * z)
  S.pan.x = clamp(S.pan.x, fw / 2, 1 - fw / 2); S.pan.y = clamp(S.pan.y, fh / 2, 1 - fh / 2)
  const g = { cx: base.cx + (S.pan.x - 0.5) * base.w, cy: base.cy + (S.pan.y - 0.5) * base.h, w: base.w * fw, h: base.h * fh, angle: base.angle }
  const M = texMatrix(g, W, H, p.orient)
  return { W, H, z, fit, dpr, cssW, cssH, fw, fh, M, Minv: minv(M), pxW, pxH, view: [S.pan.x - fw / 2, S.pan.y - fh / 2, fw, fh] }
}
export const screenToUv = (x: number, y: number) => mapply(S.lay.M, x / S.lay.cssW, y / S.lay.cssH)
export const uvToScreen = (u: number, v: number) => { const [a, b] = mapply(S.lay.Minv, u, v); return [a * S.lay.cssW, b * S.lay.cssH] }
function viewSettings(p: Photo) {
  if (S.before) return { ...clone(DEF), sharpen: 0 }
  if (S.preview) return resolve({ ...settingsOf(p), ...S.preview.s })
  return eff(p)
}
function render() {
  const p = cur(); if (!p || !view) return; const c = texCache.get(p.name); if (!c) return
  const L = S.lay = layout(p), cv = view.canvas
  cv.style.width = L.cssW + 'px'; cv.style.height = L.cssH + 'px'
  const k = Math.max(1, L.pxW / 1800)
  view.draw(c.img, viewSettings(p), { m: mgl(L.M), view: L.view, outW: Math.min(L.cssW * L.dpr, view.maxTex), outH: Math.min(L.cssH * L.dpr, view.maxTex), auto: autoFor(p), faces: S.before ? [] : p.stats?.faces, masks: S.before ? [] : p.masks,
    showMask: (S.tool === 'linear' || S.tool === 'radial') && S.showMask ? S.maskSel : -1, clip: S.clip, grainRes: [L.pxW / k, L.pxH / k] })
  emit('view')
}
export const getViewCanvas = () => view?.canvas
export const isFullRes = () => !!(S.cur && texCache.get(S.cur)?.full)

let selToken = 0
export async function select(name: string, ev?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) {
  const p = S.byName.get(name); if (!p) return
  if (ev?.shiftKey && S.cur) { const a = visiblePhotos(), i = a.findIndex(q => q.name === S.cur), j = a.findIndex(q => q.name === name); for (let k = Math.min(i, j); k <= Math.max(i, j); k++) S.multi.add(a[k].name) }
  else if (ev && (ev.metaKey || ev.ctrlKey)) { if (S.multi.has(name) && name !== S.cur) S.multi.delete(name); else S.multi.add(name) }
  else S.multi = new Set([name])
  if (S.cur !== name) { S.maskSel = -1; S.pan = { x: 0.5, y: 0.5 } }
  S.cur = name; S.multi.add(name); S.preview = null
  emit('film', 'panel', 'left', 'view'); const token = ++selToken
  if (texCache.has(name)) render(); else { S.busy = true; emit('status') }
  try { await loadPixels(p, false, 100) } catch (e: any) { if (token === selToken) { S.busy = false; flash(`Could not decode ${name}: ${e.message}`) } return }
  if (token !== selToken) return
  S.busy = false; emit('status', 'left'); render(); wantFull()
  const a = visiblePhotos(), nx = a[a.findIndex(q => q.name === name) + 1]; if (nx) loadPixels(nx, false, 50).catch(() => {})
}
function wantFull() { const p = cur(); if (!p || S.zoom === 'fit' || (S.zoom as number) < 0.6 || isFullRes()) return; const t = selToken; S.busy = true; emit('status'); loadPixels(p, true, 90).then(() => { if (t === selToken) render() }).catch(() => {}).finally(() => { S.busy = false; emit('status') }) }
export const FILTERS: [string, string, (p: Photo) => boolean][] = [
  ['all', 'All photos', () => true], ['picks', 'Picks', p => p.flag === 1], ['norej', 'Hide rejects', p => p.flag !== -1], ['unflagged', 'Unflagged', p => p.flag === 0], ['rejects', 'Rejects', p => p.flag === -1],
  ['r1', '★ and up', p => p.rating >= 1], ['r3', '★★★ and up', p => p.rating >= 3], ['r5', '★★★★★', p => p.rating >= 5], ['edited', 'Edited', isEdited],
  ['good', 'Eyes open, in focus', p => p.cull?.n > 0 && !p.cull.blink && !p.cull.soft], ['blink', 'Eyes closed', p => !!p.cull?.blink], ['soft', 'Soft focus', p => !!p.cull?.soft], ['away', 'Looking away', p => !!p.cull?.away], ['nofaces', 'No faces', p => p.cull && !p.cull.n],
]
export const visiblePhotos = () => { const f = FILTERS.find(f => f[0] === S.filter)![2]; return S.photos.filter(f) }
export function step(d: number) { const a = visiblePhotos(), i = a.findIndex(q => q.name === S.cur), n = a[clamp(i + d, 0, a.length - 1)]; if (n && n.name !== S.cur) select(n.name) }
export function setFilter(f: string) { S.filter = f; emit('film') }

/* zoom / pan */
export function setZoom(z: 'fit' | number, at?: { x: number; y: number }) {
  const L = S.lay
  if (z !== 'fit' && L && at) { const q = [L.view[0] + at.x / L.cssW * L.fw, L.view[1] + at.y / L.cssH * L.fh]; S.pan = { x: q[0], y: q[1] } }
  S.zoom = z; if (z === 'fit') S.pan = { x: 0.5, y: 0.5 }
  if (S.tool === 'crop') setTool('select'); requestRender(); wantFull(); emit('view')
}
export function wheelZoom(dy: number, x: number, y: number) {
  const L = S.lay; if (!L || S.tool === 'crop') return
  const z0 = L.z, z1 = clamp(z0 * Math.exp(-dy * 0.0016), L.fit, 4 / L.dpr)
  if (z1 <= L.fit * 1.005) { if (S.zoom !== 'fit') setZoom('fit'); return }
  const qx = L.view[0] + x / L.cssW * L.fw, qy = L.view[1] + y / L.cssH * L.fh, vW = viewerEl!.clientWidth, vH = viewerEl!.clientHeight
  const fw = Math.min(vW, L.pxW * z1) / (L.pxW * z1), fh = Math.min(vH, L.pxH * z1) / (L.pxH * z1)
  S.pan = { x: qx - (x / L.cssW - 0.5) * fw, y: qy - (y / L.cssH - 0.5) * fh }; S.zoom = z1 * L.dpr
  requestRender(); wantFull()
}
export function panBy(dx: number, dy: number) { const L = S.lay; if (!L) return; S.pan.x -= dx / L.cssW * L.fw; S.pan.y -= dy / L.cssH * L.fh; requestRender() }
export function setTool(t: typeof S.tool) {
  const p = cur(); if (S.tool === 'crop' && t !== 'crop' && p) { if (p.crop && p.crop.w > 0.999 && p.crop.h > 0.999 && !p.crop.angle) p.crop = null; markThumb(p); commit('Crop') }
  S.tool = t; if (t === 'crop') { S.zoom = 'fit'; S.pan = { x: 0.5, y: 0.5 } }
  if (t === 'linear' || t === 'radial') S.showMask = true
  emit('view', 'panel', 'film'); requestRender()
}
export function toggle(k: 'before' | 'grid' | 'faces' | 'clip' | 'showMask' | 'panels', on?: boolean) {
  if (k === 'faces' && (on ?? !S.faces)) S.grid = false; if (k === "grid" && (on ?? !S.grid)) S.faces = false; (S as any)[k] = on ?? !(S as any)[k]; emit('view', 'film', 'panel'); requestRender() }

/* crop + orientation (per photo) */
const ensureCrop = (p: Photo) => (p.crop ||= { ...FULL, aspect: 'orig' })
export function setAspect(a: string) { const p = cur(); if (!p) return; const g = ensureCrop(p), [W, H] = dimsOf(p); g.aspect = a; if (a !== 'free') { const rn = a === 'orig' ? 1 : +a * H / W; if (rn >= 1) { g.w = 1; g.h = 1 / rn } else { g.h = 1; g.w = rn } g.cx = g.cy = 0.5; fixCrop(g, W, H) } if (S.tool !== 'crop') setTool('crop'); else requestRender(); emit('panel', 'view') }
export function setAngle(v: number) { const p = cur(); if (!p) return; const g = ensureCrop(p), [W, H] = dimsOf(p); g.angle = v; fixCrop(g, W, H); markThumb(p); emit('panel', 'view'); requestRender() }
export function rotate(dir: 1 | -1) { for (const p of targets()) { const o = p.orient; o.rot = (o.rot + (o.flip ? -dir : dir) + 4) % 4; const g = p.crop; if (g) { [g.cx, g.cy] = dir === 1 ? [1 - g.cy, g.cx] : [g.cy, 1 - g.cx]; [g.w, g.h] = [g.h, g.w]; if (g.aspect !== 'orig') g.aspect = 'free' } markThumb(p) } emit('panel', 'film', 'view'); requestRender(); commit(dir === 1 ? 'Rotate right' : 'Rotate left') }
export function flipH() { for (const p of targets()) { p.orient.flip = !p.orient.flip; const g = p.crop; if (g) { g.cx = 1 - g.cx; g.angle = -g.angle } markThumb(p) } emit('panel', 'film', 'view'); requestRender(); commit('Flip') }
export function resetCrop() { for (const p of targets()) { p.crop = null; markThumb(p) } emit('panel', 'film', 'view'); requestRender(); commit('Reset crop') }
export function cropToSelected() { const p = cur(); if (!p?.crop) return; for (const q of targets()) if (q !== p) { q.crop = clone(p.crop); q.orient = clone(p.orient); markThumb(q) } emit('film'); commit('Copy crop'); flash(`Crop copied to ${S.multi.size - 1} photos`) }
export function dragCrop(g0: any, handle: string | null, dx: number, dy: number) {
  const p = cur()!, g = p.crop, [W, H] = dimsOf(p)
  if (!handle) { const n = { ...g, cx: g0.cx + dx, cy: g0.cy + dy }; if (!g.angle) fixCrop(n, W, H); if (cropValid(n, W, H)) Object.assign(g, n) }
  else {
    const sx = handle[1] === 'e' ? 1 : -1, sy = handle[0] === 's' ? 1 : -1, ax = g0.cx - sx * g0.w / 2, ay = g0.cy - sy * g0.h / 2
    let w = Math.max(0.05, g0.w + sx * dx), h = Math.max(0.05, g0.h + sy * dy); const rn = g.aspect !== 'free' && g0.w / g0.h
    if (rn) { if (w / rn > h) h = w / rn; else w = h * rn }
    const n = { ...g, w, h, cx: ax + sx * w / 2, cy: ay + sy * h / 2 }
    for (let i = 0; i < 200 && !cropValid(n, W, H); i++) { n.w *= 0.99; n.h *= 0.99; n.cx = ax + sx * n.w / 2; n.cy = ay + sy * n.h / 2 }
    if (cropValid(n, W, H)) Object.assign(g, n)
  }
  emit('view')
}
export const beginCropDrag = () => clone(ensureCrop(cur()!))

/* local adjustments (per photo, up to 4) */
export function addMask(type: 'linear' | 'radial', u: number, v: number) {
  const p = cur(); if (!p) return -1; if (p.masks.length >= 4) { flash('Four masks per photo is the limit'); return -1 }
  p.masks.push(type === 'linear' ? { type, a: [u, v], b: [u, v], adj: { ...MASK_ADJ }, on: true } : { type, c: [u, v], r: [0.01, 0.01], feather: 50, invert: false, adj: { ...MASK_ADJ }, on: true })
  S.maskSel = p.masks.length - 1; emit('panel', 'view'); return S.maskSel
}
export function touchMask() { const p = cur(); if (p) markThumb(p); emit('panel', 'view'); requestRender() }
export function removeMask(i: number) { const p = cur(); if (!p) return; p.masks.splice(i, 1); S.maskSel = Math.min(S.maskSel, p.masks.length - 1); markThumb(p); emit('panel', 'view', 'film'); requestRender(); commit('Delete mask') }
export function selectMask(i: number) { S.maskSel = i; const p = cur(), m = p?.masks[i]; if (m && S.tool !== m.type) S.tool = m.type; S.showMask = true; emit('panel', 'view'); requestRender() }
export function masksToSelected() { const p = cur(); if (!p) return; for (const q of targets()) if (q !== p) { q.masks = clone(p.masks); markThumb(q) } emit('film'); commit('Copy masks') }

/* white balance eyedropper: make the clicked pixel neutral */
export function pickWB(x: number, y: number) {
  const p = cur(); if (!p?.t) return
  const [u, v] = screenToUv(x, y), T = p.t, cx = Math.round(u * (T.w - 1)), cy = Math.round(v * (T.h - 1)); let r = 0, g = 0, b = 0, n = 0
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = cx + i, Y = cy + j; if (X < 0 || Y < 0 || X >= T.w || Y >= T.h) continue; const k = (Y * T.w + X) * 3; r += half2f(T.data[k]); g += half2f(T.data[k + 1]); b += half2f(T.data[k + 2]); n++ }
  if (!n || r <= 0 || g <= 0 || b <= 0) return
  const fix = neutralise(wbShot(p), [r, g, b], autoFor(p).wb); if (!fix) return
  setVal("temp", Math.round(fix.temp)); setVal("tint", Math.round(fix.tint))
  commit('White balance pick'); setTool('select')
}

/* flags */
export function setFlag(v: number) { const many = S.multi.size > 1; for (const p of targets()) p.flag = p.flag === v ? 0 : v; emit('film', 'status', 'view'); commit(v === 1 ? 'Pick' : v === -1 ? 'Reject' : 'Unflag', 'flag'); if (v && !many) advance(); celebrate() }
export function setRating(v: number) { const many = S.multi.size > 1; for (const p of targets()) p.rating = v; emit('film', 'view'); commit('Rating ' + v, 'rating'); if (v && !many) advance() }
export function setLabel(v: number) { for (const p of targets()) p.label = p.label === v ? 0 : v; emit('film', 'view'); commit('Colour label', 'label') }
export function selectAll() { for (const p of visiblePhotos()) S.multi.add(p.name); emit('film', 'panel') }

/* ------------------------------------------------------------------ thumbnails + style tiles */
const dirtyThumbs = new Set<Photo>(); let thumbTimer: any = 0
export function markThumb(p: Photo) { if (!p.t) return; p.dirty = true; if (p.visible) { dirtyThumbs.add(p); if (!thumbTimer) thumbTimer = setTimeout(flushThumbs, 60) } }
export function setVisible(p: Photo, v: boolean) { p.visible = v; if (v) { if (p.dirty) markThumb(p); if (!p.done) pool.bump('an:' + p.name, 10) } }
function flushThumbs() {
  thumbTimer = 0; if (S.exporting) { thumbTimer = setTimeout(flushThumbs, 500); return } const t0 = performance.now()
  for (const p of dirtyThumbs) { dirtyThumbs.delete(p); if (!p.dirty || !p.t) continue; drawThumb(p); if (performance.now() - t0 > 24) break }
  if (dirtyThumbs.size) thumbTimer = setTimeout(flushThumbs, 16)
}
function drawThumb(p: Photo) {
  p.dirty = false; const g = p.crop || FULL, odd = p.orient.rot & 1, W = odd ? p.t.h : p.t.w, Hh = odd ? p.t.w : p.t.h, img = work.upload(p.t.data, p.t.w, p.t.h, p.t.blur)
  const asp = (g.w * W) / (g.h * Hh), H = 200, Wd = Math.max(40, Math.round(H * asp))
  work.draw(img, eff(p), { m: mgl(texMatrix(g, W, Hh, p.orient)), outW: Wd, outH: H, auto: autoFor(p), faces: p.stats?.faces, masks: p.masks, quick: true })
  const cv = p.thumb; if (cv.width !== Wd || cv.height !== H) { cv.width = Wd; cv.height = H } cv.getContext('2d')!.drawImage(work.canvas, 0, 0); work.free(img)
}
/* render the current photo once per settings object into the given canvases (style browser) */
export function renderTiles(tiles: { canvas: HTMLCanvasElement; s: any }[], height = 360) {
  const p = cur(); if (!p) return; const src = p.mid || (p.t && { ...p.t }); if (!src) return
  const g = p.crop || FULL, odd = p.orient.rot & 1, W = odd ? src.h : src.w, Hh = odd ? src.w : src.h, img = work.upload(src.data, src.w, src.h, src.blur)
  const asp = (g.w * W) / (g.h * Hh), Wd = Math.round(height * asp), m = mgl(texMatrix(g, W, Hh, p.orient)), auto = autoFor(p)
  for (const t of tiles) { work.draw(img, resolve(t.s), { m, outW: Wd, outH: height, auto, faces: p.stats?.faces, masks: p.masks, quick: true }); t.canvas.width = Wd; t.canvas.height = height; t.canvas.getContext('2d')!.drawImage(work.canvas, 0, 0) }
  work.free(img)
}

/* ------------------------------------------------------------------ import */
async function findEmbeddedJpeg(p: Photo) {
  const size = p.size || Infinity, headLen = Math.min(size, 1 << 17), head = new DataView(await p.read(0, headLen))
  const sig = head.getUint16(0); if (sig !== 0x4949 && sig !== 0x4d4d) return null
  const le = sig === 0x4949
  const dvAt = async (off: number, len: number) => (off + len <= headLen ? new DataView(head.buffer, off, len) : new DataView(await p.read(off, len)))
  const todo = [head.getUint32(4, le)], seen = new Set<number>(), cands: number[][] = []; let orient = 1, first = true
  while (todo.length && seen.size < 24) {
    const off = todo.shift()!; if (!off || seen.has(off) || off + 2 > size) continue; seen.add(off)
    const n = (await dvAt(off, 2)).getUint16(0, le); if (n > 400) continue
    const dv = await dvAt(off, 2 + n * 12 + 4), t: any = {}
    for (let i = 0; i < n; i++) {
      const b = 2 + i * 12, tag = dv.getUint16(b, le), type = dv.getUint16(b + 2, le), cnt = dv.getUint32(b + 4, le), val = type === 3 ? dv.getUint16(b + 8, le) : dv.getUint32(b + 8, le)
      if (tag === 0x014a) { if (cnt === 1) todo.push(val); else if (cnt < 16) { const s = await dvAt(val, cnt * 4); for (let j = 0; j < cnt; j++) todo.push(s.getUint32(j * 4, le)) } } else t[tag] = { val, cnt }
    }
    if (first && t[0x0112]) orient = t[0x0112].val; first = false
    if (t[0x0201] && t[0x0202]) cands.push([t[0x0201].val, t[0x0202].val])
    else if (t[0x0103] && (t[0x0103].val === 6 || t[0x0103].val === 7) && t[0x0111] && t[0x0117] && t[0x0111].cnt === 1) cands.push([t[0x0111].val, t[0x0117].val])
    todo.push(dv.getUint32(2 + n * 12, le))
  }
  cands.sort((a, b) => a[1] - b[1])   // smallest usable preview first: it only has to fill a thumbnail
  for (const [o, l] of cands) { if (l < 6000 || o + l > size) continue; const buf = await p.read(o, l); if (new DataView(buf).getUint16(0) === 0xffd8) return { blob: new Blob([buf], { type: 'image/jpeg' }), orient } }
  return null
}
const previewQ = { q: [] as Photo[], active: 0, add(p: Photo) { this.q.push(p); this.pump() }, pump() { while (this.active < 3 && this.q.length) { const p = this.q.shift()!; this.active++; quickPreview(p).catch(() => {}).finally(() => { this.active--; this.pump() }) } } }
async function quickPreview(p: Photo) {
  if (p.t) return
  let blob: Blob | null = null, orient = 1
  if (p.kind === 'img') blob = new Blob([await p.load()]); else { const r = await findEmbeddedJpeg(p).catch(() => null); if (r) { blob = r.blob; orient = r.orient } }
  if (!blob) return
  const bmp = await createImageBitmap(blob, { resizeHeight: 400, resizeQuality: 'medium' }); if (p.t) { bmp.close(); return }
  const rot = orient >= 5 && bmp.width > bmp.height ? (orient === 6 || orient === 7 ? 90 : -90) : 0, cv = p.thumb, w = rot ? bmp.height : bmp.width, h = rot ? bmp.width : bmp.height, sc = 200 / h
  cv.width = Math.round(w * sc); cv.height = 200; const ctx = cv.getContext('2d')!
  ctx.save(); ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(rot * Math.PI / 180); ctx.drawImage(bmp, -(rot ? cv.height : cv.width) / 2, -(rot ? cv.width : cv.height) / 2, rot ? cv.height : cv.width, rot ? cv.width : cv.height); ctx.restore(); bmp.close()
}
type Entry = { name: string; size: number; load: () => Promise<ArrayBuffer>; read: (off: number, len: number) => Promise<ArrayBuffer>; credit?: Sample }
const fileEntry = (name: string, get: () => Promise<File>, size = 0): Entry => { let f: File | null = null; const file = async () => (f ||= await get()); return { name, size, load: async () => (await file()).arrayBuffer(), read: async (o, l) => (await file()).slice(o, o + l).arrayBuffer() } }
function reset() {
  pool.cancel(() => true); for (const [, c] of texCache) view.free(c.img); texCache.clear(); faceQ.length = 0
  Object.assign(S, { photos: [], byName: new Map(), cur: null, multi: new Set(), source: null, key: null, title: '', history: [], hIdx: -1, analysed: 0, checked: 0, maskSel: -1, tool: 'select', zoom: 'fit', filter: 'all' })
  S.proj = { settings: clone(DEF), autoExposure: true, autoWB: false }
}
async function addEntries(entries: Entry[], saved?: any) {
  const fresh = entries.filter(e => (RAW_EXT.includes(extOf(e.name)) || IMG_EXT.includes(extOf(e.name))) && !e.name.startsWith('.') && !S.byName.has(e.name))
  if (!fresh.length) { flash('No raw or image files found there'); emit(...ALL); return }
  const rawStems = new Set([...fresh, ...S.photos].filter(e => RAW_EXT.includes(extOf(e.name))).map(e => stem(e.name)))
  for (const e of fresh) {
    const kind = RAW_EXT.includes(extOf(e.name)) ? 'raw' : 'img'; if (kind === 'img' && rawStems.has(stem(e.name))) continue
    const p: Photo = { ...e, kind, ...clone(blankPhoto()), stats: null, meta: null, dim: null, cull: null, t: null, mid: null, thumb: Object.assign(document.createElement('canvas'), { width: 133, height: 200 }) } as Photo
    S.photos.push(p); S.byName.set(p.name, p)
  }
  S.photos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  S.key = (S.title || 'files') + ':' + S.photos.length + ':' + S.photos[0].name
  if (!saved) try { saved = JSON.parse(localStorage.getItem('autochrome:' + S.key) || 'null') } catch {}
  if (saved) applyProject(saved)
  S.checked = S.photos.filter(p => p.cull).length; recomputeBase()
  for (const p of S.photos) if (!p.queued) { p.queued = true; previewQ.add(p); analyse(p, 0) }
  if (!S.history.length) { S.history = [{ label: 'Open', json: snap(), at: Date.now() }]; S.hIdx = 0 }
  emit(...ALL); if (!S.cur) select(S.photos[0].name)
}
/* Folders are always read by the browser from the viewer's own computer; nothing is uploaded.
   Chromium's folder picker gives read/write access, so edits save into the folder and exports go back to it. */
export const canPickFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window
export async function pickFolder() {
  let dir: any
  try { dir = await (window as any).showDirectoryPicker({ id: 'autochrome', mode: 'readwrite' }) }
  catch (e: any) { if (e?.name === 'AbortError') return; throw new Error(e?.name === 'NotAllowedError' ? 'Autochrome needs permission to read that folder.' : e?.message || String(e)) }
  return loadHandleDir(dir, true)
}
/* Built-in samples: entries that stream from /api/sample, so the shoot appears at once and each raw downloads as it is developed. */
export async function openSamples(list: Sample[], title: string) {
  reset(); S.source = { kind: 'files' }; S.title = title
  const url = (s: Sample) => '/api/sample?id=' + s.id
  const get = async (s: Sample, range?: string) => { const r = await fetch(url(s), range ? { headers: { range } } : undefined); if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Could not load ${s.file}`); return r.arrayBuffer() }
  const dup = (s: Sample) => list.filter(x => x.file.toLowerCase() === s.file.toLowerCase()).length > 1   // two threads can share a file name
  await addEntries(list.map(s => ({ name: dup(s) ? `${s.id}_${s.file}` : s.file, size: s.size, credit: s, load: () => get(s), read: (o: number, l: number) => get(s, `bytes=${o}-${o + l - 1}`) })))
}
/* Fallback for browsers without the picker: an <input webkitdirectory> list. Read-only, so edits save in this browser and exports download as a zip. */
export async function openFolderFiles(files: FileList) {
  const top = [...files].filter(f => ((f as any).webkitRelativePath || f.name).split('/').length <= 2)
  const proj = top.find(f => f.name === 'autochrome-project.json'); let saved = null
  if (proj) try { saved = JSON.parse(await proj.text()) } catch {}
  reset(); S.source = { kind: 'files' }; S.title = ((files[0] as any)?.webkitRelativePath || '').split('/')[0] || 'Folder'
  await addEntries(top.filter(f => f !== proj).map(f => fileEntry(f.name, async () => f, f.size)), saved)
}
async function loadHandleDir(dir: any, writable: boolean) {
  reset(); S.source = { kind: 'handle', dir, writable }; S.title = dir.name
  const entries: Entry[] = []; let saved = null
  for await (const [name, h] of dir.entries()) { if (h.kind !== 'file') continue; if (name === 'autochrome-project.json') { try { saved = JSON.parse(await (await h.getFile()).text()) } catch {} } else entries.push(fileEntry(name, () => h.getFile())) }
  await addEntries(entries, saved)
}
export function addFiles(files: FileList | File[]) { if (!S.source) { S.source = { kind: 'files' }; S.title = 'Photos' } return addEntries([...files].map(f => fileEntry(f.name, async () => f, f.size))) }
export async function handleDrop(e: DragEvent) {
  e.preventDefault(); const items = [...(e.dataTransfer?.items || [])].filter(i => i.kind === 'file')
  if (items[0] && (items[0] as any).getAsFileSystemHandle) {
    const hs: any[] = await Promise.all(items.map(i => (i as any).getAsFileSystemHandle()))
    if (hs.length === 1 && hs[0]?.kind === 'directory') { let w = false; try { w = (await hs[0].requestPermission({ mode: 'readwrite' })) === 'granted' } catch {} return loadHandleDir(hs[0], w) }
    const entries: Entry[] = []
    for (const h of hs) { if (!h) continue; if (h.kind === 'file') entries.push(fileEntry(h.name, () => h.getFile())); else for await (const [name, f] of h.entries()) if (f.kind === 'file') entries.push(fileEntry(name, () => f.getFile())) }
    if (!S.source) { S.source = { kind: 'files' }; S.title = 'Dropped files' }
    return addEntries(entries)
  }
  return addFiles(e.dataTransfer!.files)
}

/* ------------------------------------------------------------------ looks: .cube + Lightroom presets */
export function addCube(name: string, text: string) { const id = 'cube:' + name; if (!LOOKS.find(l => l.id === id)) { LOOKS.push({ id, name: name.replace(/\.cube$/i, ''), cat: 'My LUTs', sub: 'Imported .cube', sw: '#888' }); lutCache.set(id, parseCube(text)) } emit('panel'); return id }
async function loadServerLuts() { try { const d = await (await fetch('/api/luts')).json(); S.lutDir = d.dir; for (const f of d.files) try { addCube(f, await (await fetch('/api/luts?name=' + encodeURIComponent(f))).text()) } catch (e) { console.warn('Skipped LUT', f, e) } } catch {} }
/* Map the common Lightroom / Camera Raw preset fields onto our sliders. The two engines are not identical, so this is a close starting point, not a match. */
export function parseXmp(text: string) {
  const num = (k: string) => { const m = new RegExp(`crs:${k}="([+-]?[\\d.]+)"`).exec(text); return m ? +m[1] : null }, out: any = {}
  const put = (k: string, src: string, f = (x: number) => x) => { const v = num(src); if (v != null && v !== 0) out[k] = Math.round(f(v) * 100) / 100 }
  put('exposure', 'Exposure2012'); put('contrast', 'Contrast2012'); put('highlights', 'Highlights2012'); put('shadows', 'Shadows2012'); put('whites', 'Whites2012'); put('blacks', 'Blacks2012')
  put('texture', 'Texture'); put('clarity', 'Clarity2012'); put('dehaze', 'Dehaze'); put('vibrance', 'Vibrance'); put('saturation', 'Saturation')
  put('grain', 'GrainAmount'); put('vignette', 'PostCropVignetteAmount', x => -x); put('nrLuma', 'LuminanceSmoothing'); put('nrColor', 'ColorNoiseReduction'); put('sharpen', 'Sharpness', x => x / 1.5)
  put('gShHue', 'SplitToningShadowHue'); put('gShSat', 'SplitToningShadowSaturation'); put('gHiHue', 'SplitToningHighlightHue'); put('gHiSat', 'SplitToningHighlightSaturation'); put('gMidHue', 'ColorGradeMidtoneHue'); put('gMidSat', 'ColorGradeMidtoneSat'); put('gBalance', 'SplitToningBalance')
  for (const h of HSL) { const n = h[0] as string, N = n[0].toUpperCase() + n.slice(1); put('h_' + n, 'HueAdjustment' + N); put('s_' + n, 'SaturationAdjustment' + N); put('l_' + n, 'LuminanceAdjustment' + N) }
  if (/crs:ConvertToGrayscale="True"/i.test(text) || /crs:Treatment="Black &amp; White"/i.test(text)) out.bw = 1
  const curve = (tag: string) => { const m = new RegExp(`<crs:${tag}>[\\s\\S]*?<rdf:Seq>([\\s\\S]*?)</rdf:Seq>`).exec(text); if (!m) return null; const pts = [...m[1].matchAll(/<rdf:li>\s*(\d+)\s*,\s*(\d+)\s*<\/rdf:li>/g)].map(x => [+x[1] / 255, +x[2] / 255]); return pts.length >= 2 ? pts : null }
  const c = { m: curve('ToneCurvePV2012'), r: curve('ToneCurvePV2012Red'), g: curve('ToneCurvePV2012Green'), b: curve('ToneCurvePV2012Blue') }
  if (c.m || c.r || c.g || c.b) out.curve = { m: c.m || [[0, 0], [1, 1]], r: c.r || [[0, 0], [1, 1]], g: c.g || [[0, 0], [1, 1]], b: c.b || [[0, 0], [1, 1]] }
  return out
}
export async function importFiles(files: File[]) {
  let n = 0
  for (const f of files) {
    if (/\.cube$/i.test(f.name)) { try { const id = addCube(f.name, await f.text()); setVal('style', id); commit('Style: ' + f.name); n++ } catch (e: any) { flash(e.message) } }
    else if (/\.(xmp|lrtemplate)$/i.test(f.name)) { const d = parseXmp(await f.text()); if (Object.keys(d).length) { const st = fromSettings(stem(f.name), d); setUserStyles([...userStyles().filter(s => s.id !== st.id), st]); n++ } }
  }
  storeStyles(); emit('left', 'panel'); if (n) flash(`Imported ${n} file${n > 1 ? 's' : ''}`)
}

/* ------------------------------------------------------------------ export */
function crc32(buf: Uint8Array) { let t = (crc32 as any).t; if (!t) { t = (crc32 as any).t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } } let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function zipStore(files: { name: string; data: Uint8Array }[]) {
  const enc = new TextEncoder(), parts: any[] = [], central: any[] = []; let off = 0
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true); parts.push(h, nm, f.data)
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true); central.push(c, nm); off += 30 + nm.length + f.data.length
  }
  const csize = central.reduce((s, p) => s + p.byteLength, 0), e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true)
  return new Blob([...parts, ...central, e], { type: 'application/zip' })
}
export interface ExportOpts { which: 'picks' | 'norej' | 'sel' | 'all'; format: 'jpeg' | 'webp' | 'png'; quality: number; longEdge: number; sub: string; suffix: string; dest: 'folder' | 'zip' }
export const exportList = (which: string) => (which === 'picks' ? S.photos.filter(p => p.flag === 1) : which === 'sel' ? S.photos.filter(p => S.multi.has(p.name)) : which === 'all' ? S.photos : S.photos.filter(p => p.flag !== -1))
export const canExportToFolder = () => S.source?.kind === 'handle'
export async function runExport(o: ExportOpts, progress: (i: number, n: number, name: string) => void) {
  const list = exportList(o.which); if (!list.length) throw new Error('Nothing to export with that choice')
  S.exporting = true; const zip: { name: string; data: Uint8Array }[] = []; let done = 0, outDir: any = null
  const ext = o.format === 'jpeg' ? 'jpg' : o.format
  try {
    if (o.dest === 'folder' && S.source.kind === 'handle') { if (!S.source.writable) { S.source.writable = (await S.source.dir.requestPermission({ mode: 'readwrite' })) === 'granted'; if (!S.source.writable) throw new Error('No permission to write to that folder') } outDir = await S.source.dir.getDirectoryHandle(o.sub, { create: true }) }
    const job = (p: Photo) => pool.run(decodeJob(p, false, { stats: !p.stats, pixels: true }), 200)
    let next: Promise<any> | null = job(list[0])
    for (let i = 0; i < list.length; i++) {
      if (!S.exporting) throw new Error('stopped')
      const p = list[i]; progress(i, list.length, p.name)
      const pending = next!; next = i + 1 < list.length ? job(list[i + 1]) : null; next?.catch(() => {})
      let r; try { r = await pending } catch (e) { console.warn('Skipped', p.name, e); continue }
      if (!p.dim) p.dim = [r.w, r.h]; if (r.stats && !p.stats) p.stats = r.stats
      const img = work.upload(r.pixels, r.w, r.h, r.blur), g = p.crop || FULL, odd = p.orient.rot & 1, W = odd ? r.h : r.w, H = odd ? r.w : r.h
      let oW = g.w * W, oH = g.h * H; const full = [oW, oH]; if (o.longEdge && Math.max(oW, oH) > o.longEdge) { const s = o.longEdge / Math.max(oW, oH); oW *= s; oH *= s }
      const k = Math.max(1, full[0] / 1800)
      work.draw(img, eff(p), { m: mgl(texMatrix(g, W, H, p.orient)), outW: oW, outH: oH, auto: autoFor(p), faces: p.stats?.faces, masks: p.masks, grainRes: [full[0] / k, full[1] / k] })
      const blob: Blob = await new Promise(res => work.canvas.toBlob(b => res(b!), 'image/' + o.format, o.quality)); work.free(img); r.pixels = null
      const name = stem(p.name) + o.suffix + '.' + ext
      if (outDir) { const fh = await outDir.getFileHandle(name, { create: true }), w = await fh.createWritable(); await w.write(blob); await w.close() }
      else zip.push({ name, data: new Uint8Array(await blob.arrayBuffer()) })
      done++
    }
    if (zip.length) { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(zipStore(zip)), download: (S.title || 'autochrome') + '-export.zip' }); document.body.append(a); a.click(); a.remove() }
  } finally { work.canvas.width = work.canvas.height = 2; S.exporting = false }
  progress(list.length, list.length, ''); return done
}
export const stopExport = () => { S.exporting = false }

/* ------------------------------------------------------------------ boot */
let booted: Promise<void> | null = null
export function boot() {
  return (booted ||= (async () => {
    loadStyles(); try { S.advance = localStorage.getItem('autochrome:advance') !== '0' } catch {}
    await pool.init(); loadServerLuts()
    window.addEventListener('beforeunload', () => { saveNow() })
    ;(window as any).__rs = { S, texCache, select, setVal, autoFor, eff, runExport, autoCull }
  })())
}
export { KEYS, DEF, LOOKS }

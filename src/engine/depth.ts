/* Lens blur analysis from the main thread: runs depth.worker.ts, reports model download / analysis progress, and keeps
   finished maps in IndexedDB so each photo is analysed once. Everything stays on this computer. */

/* image-space map from the worker: R = depth (0 far .. 1 near), G = subject matte, both 0..255 */
export interface DepthMap { w: number; h: number; data: Uint8Array; focus: number; focusUV: number[]; subj: number; area: number; hist: number[]; ep: string; ms?: number; subjectError?: string }
export interface DepthStatus { phase: 'idle' | 'download' | 'prepare' | 'analyse'; label?: string; loaded?: number; total?: number; ep?: string }

export const DEPTH_V = 1   // bump when the analysis changes, so cached maps are redone
export const depthStatus: DepthStatus = { phase: 'idle' }
let listener = () => {}
export const onDepthStatus = (f: () => void) => { listener = f }

let worker: Worker | null = null, seq = 1
const pending = new Map<number, { res: (m: DepthMap) => void; rej: (e: Error) => void }>()
function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = e => {
    const m = e.data
    if (m.type === 'progress') { for (const k of Object.keys(depthStatus)) delete (depthStatus as any)[k]; Object.assign(depthStatus, m); delete (depthStatus as any).type; listener(); return }
    const p = pending.get(m.id); if (!p) return
    pending.delete(m.id); m.ok ? p.res(m.out) : p.rej(new Error(m.error))
  }
  worker.onerror = e => { for (const p of pending.values()) p.rej(new Error(e.message || 'Lens blur analysis failed')); pending.clear(); worker = null }
  return worker
}

/* Can lens blur run at full quality here? The worker uses WebGPU only with 16-bit float shaders (both models are fp16);
   otherwise it falls back to the CPU with depth alone. Checked once, with the reason when it cannot. */
export type GpuCheck = { ok: true } | { ok: false; why: 'insecure' | 'nogpu' | 'noadapter' | 'nof16' }
let gpuCheck: Promise<GpuCheck> | null = null
export function checkWebGpu(): Promise<GpuCheck> {
  return (gpuCheck ||= (async (): Promise<GpuCheck> => {
    if (typeof window !== 'undefined' && !window.isSecureContext) return { ok: false, why: 'insecure' }
    const gpu = (navigator as any).gpu; if (!gpu) return { ok: false, why: 'nogpu' }
    try { const a = await gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!a) return { ok: false, why: 'noadapter' }; return a.features.has('shader-f16') ? { ok: true } : { ok: false, why: 'nof16' } }
    catch { return { ok: false, why: 'noadapter' } }
  })())
}

/* bmp: the photo rendered neutrally in image space (long edge about 1536 px). faces: from the decode worker, in uv */
export function estimateDepth(bmp: ImageBitmap, faces: any[]): Promise<DepthMap> {
  return new Promise((res, rej) => { const id = seq++; pending.set(id, { res, rej }); getWorker().postMessage({ type: 'run', id, bmp, faces: faces.map(f => ({ x: f.x, y: f.y, sx: f.sx, sy: f.sy })) }, [bmp]) })
}

/* depth at an image uv, with the subject flattened onto its own depth, as the renderer sees it */
export function depthAt(m: DepthMap, u: number, v: number) {
  let s = 0, k = 0
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const x = Math.min(m.w - 1, Math.max(0, Math.round(u * m.w - 0.5) + i)), y = Math.min(m.h - 1, Math.max(0, Math.round(v * m.h - 0.5) + j)), o = (y * m.w + x) * 2
    const d = m.data[o] / 255, a = m.data[o + 1] / 255; s += d + (m.subj - d) * a; k++
  }
  return s / k
}

/* ------------------------------------------------------------------ IndexedDB cache (newest 120 photos) */
let dbp: Promise<IDBDatabase> | null = null
const db = () => (dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open('autochrome-depth', 1)
  r.onupgradeneeded = () => { r.result.createObjectStore('maps'); r.result.createObjectStore('meta') }
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
}))
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
export async function loadDepth(key: string): Promise<DepthMap | null> {
  try { const d = await db(), m = await req(d.transaction('maps').objectStore('maps').get(key)); if (m) d.transaction('meta', 'readwrite').objectStore('meta').put(Date.now(), key); return m || null } catch { return null }
}
export async function saveDepth(key: string, m: DepthMap) {
  try {
    const d = await db(), t = d.transaction(['maps', 'meta'], 'readwrite')
    t.objectStore('maps').put(m, key); t.objectStore('meta').put(Date.now(), key)
    const keys = await req(d.transaction('meta').objectStore('meta').getAllKeys()), ats = await req(d.transaction('meta').objectStore('meta').getAll())
    if (keys.length > 120) {
      const old = keys.map((k, i) => [k, ats[i]] as const).sort((a, b) => a[1] - b[1]).slice(0, keys.length - 120), t2 = d.transaction(['maps', 'meta'], 'readwrite')
      for (const [k] of old) { t2.objectStore('maps').delete(k); t2.objectStore('meta').delete(k) }
    }
  } catch { /* the cache is best-effort */ }
}

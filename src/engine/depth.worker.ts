/* Lens blur analysis: the depth of every pixel (Depth Anything V2) and a fine matte of the main subject (BEN2),
   both run on the GPU with ONNX Runtime (WebGPU, or WebAssembly without the subject model where WebGPU is missing).
   The raw model outputs are then cleaned up for the renderer:
     - depth is normalised, upsampled and snapped to the photo's edges with a guided filter
     - the band just outside the subject takes the background's depth, so no sharp rim is left around it
     - parts of the matte at a different depth from the subject (a sign, a tree) are dropped from it
   Output: one RG8 map in image space (R = depth, 0 far .. 1 near; G = subject), the subject's depth and an auto focus. */
// ORT's native WebGPU build (its older JS kernels, JSEP, cannot run BEN2's Cast / MaxPool ceil_mode)
import * as ort from 'onnxruntime-web/webgpu'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { MODELS, modelUrl, type ModelId } from './models'

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.wasm.numThreads = (self as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1
ort.env.logLevel = 'error'

const post = (m: any, transfer: Transferable[] = []) => (self as any).postMessage(m, transfer)
const progress = (phase: string, extra: any = {}) => post({ type: 'progress', phase, ...extra })

/* ------------------------------------------------------------------ models */
interface Plan { ep: 'webgpu' | 'wasm'; depth: ModelId; subject: ModelId | null }
let plan: Promise<Plan> | null = null
function getPlan(force?: Plan) {
  if (force) plan = Promise.resolve(force)
  return (plan ||= (async (): Promise<Plan> => {
    try {
      const a = await (navigator as any).gpu?.requestAdapter({ powerPreference: 'high-performance' })
      if (a && a.features.has('shader-f16')) {
        // ORT's own device would ask for the default limits; take what the GPU really offers
        const L = a.limits, want = ['maxStorageBuffersPerShaderStage', 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ']
        const device = await a.requestDevice({ requiredFeatures: ['shader-f16', ...['subgroups'].filter(f => a.features.has(f))], requiredLimits: Object.fromEntries(want.map(k => [k, L[k]])) })
        ;(ort.env.webgpu as any).device = device
        return { ep: 'webgpu', depth: 'depth-fp16', subject: 'subject-fp16' }
      }
    } catch (e) { console.warn('WebGPU unavailable for lens blur analysis:', e) }
    return { ep: 'wasm', depth: 'depth-q8', subject: null }
  })())
}
const WASM_PLAN: Plan = { ep: 'wasm', depth: 'depth-q8', subject: null }

/* each model downloads once (through the app's server) and is kept in the browser's Cache Storage */
async function fetchModel(id: ModelId, retry = 1): Promise<Uint8Array> {
  const url = modelUrl(id), m = MODELS[id]
  let cache: Cache | undefined
  try { cache = await caches.open('autochrome-models-1') } catch {}
  try { const hit = await cache?.match(url); if (hit) { const b = await hit.arrayBuffer(); if (b.byteLength === m.size) return new Uint8Array(b) } } catch {}
  const res = await fetch(url, retry > 0 ? undefined : { cache: 'reload' })   // a retry skips a truncated copy in the HTTP cache
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error || `Could not download the ${m.name} model (${res.status})`)
  const buf = new Uint8Array(m.size), rd = res.body.getReader(); let off = 0, last = 0
  for (;;) {
    const { done, value } = await rd.read(); if (done) break
    if (off + value.length > buf.length) throw new Error(`The ${m.name} model is larger than expected`)
    buf.set(value, off); off += value.length
    if (performance.now() - last > 100) { last = performance.now(); progress('download', { label: m.name, loaded: off, total: m.size }) }
  }
  if (off !== m.size) { if (retry > 0) return fetchModel(id, retry - 1); throw new Error(`Incomplete download of the ${m.name} model`) }
  progress('download', { label: m.name, loaded: off, total: m.size })
  cache?.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {})
  return buf
}
const sessions = new Map<string, Promise<ort.InferenceSession>>()
function session(id: ModelId, ep: Plan['ep']) {
  const key = id + ':' + ep; let s = sessions.get(key)
  if (!s) {
    s = (async () => { const buf = await fetchModel(id); progress('prepare', { label: MODELS[id].name }); return ort.InferenceSession.create(buf, { executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: 3 }) })()
    s.catch(() => sessions.delete(key)); sessions.set(key, s)
  }
  return s
}

/* ------------------------------------------------------------------ image helpers */
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
function pixels(bmp: ImageBitmap, w: number, h: number) {
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true })!
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h)
  return x.getImageData(0, 0, w, h).data
}
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225]
function tensor(px: Uint8ClampedArray, w: number, h: number) {
  const n = w * h, t = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) t[k * n + i] = (px[i * 4 + k] / 255 - MEAN[k]) / STD[k]
  return new ort.Tensor('float32', t, [1, 3, h, w])
}
function resize(src: Float32Array, sw: number, sh: number, dw: number, dh: number) {
  const out = new Float32Array(dw * dh), fx = sw / dw, fy = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5)), y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), ty = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5)), x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), tx = sx - x0
      const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx, b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx
      out[y * dw + x] = a * (1 - ty) + b * ty
    }
  }
  return out
}
/* box mean with edge replication, separable running sums: O(n) for any radius */
function boxMean(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0
    for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) { tmp[o + x] = s * k; s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)] }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) { out[y * w + x] = s * k; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x] }
  }
  return out
}
/* guided filter (He et al.): p smoothed while following the edges of the guide I */
function guided(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number) {
  const n = w * h, II = new Float32Array(n), Ip = new Float32Array(n)
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; Ip[i] = I[i] * p[i] }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mII = boxMean(II, w, h, r), mIp = boxMean(Ip, w, h, r), a = II, b = Ip
  for (let i = 0; i < n; i++) { const va = mII[i] - mI[i] * mI[i]; a[i] = (mIp[i] - mI[i] * mp[i]) / (va + eps); b[i] = mp[i] - a[i] * mI[i] }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r), q = new Float32Array(n)
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i]
  return q
}
/* min / max filter over a (2r+1) square, van Herk / Gil-Werman: O(n) for any radius */
function morph(src: Float32Array, w: number, h: number, r: number, max: boolean) {
  const f = max ? Math.max : Math.min, k = 2 * r + 1
  const line = (get: (i: number) => number, set: (i: number, v: number) => void, n: number) => {
    const N = n + 2 * r, pad = new Float32Array(N), g = new Float32Array(N), hh = new Float32Array(N)
    for (let i = 0; i < N; i++) pad[i] = get(Math.min(n - 1, Math.max(0, i - r)))
    for (let i = 0; i < N; i++) g[i] = i % k === 0 ? pad[i] : f(g[i - 1], pad[i])
    for (let i = N - 1; i >= 0; i--) hh[i] = i % k === k - 1 || i === N - 1 ? pad[i] : f(hh[i + 1], pad[i])
    for (let x = 0; x < n; x++) set(x, f(hh[x], g[x + 2 * r]))
  }
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) line(i => src[y * w + i], (i, v) => { tmp[y * w + i] = v }, w)
  for (let x = 0; x < w; x++) line(i => tmp[i * w + x], (i, v) => { out[i * w + x] = v }, h)
  return out
}
/* weighted quantile of values in 0..1 through a fine histogram */
function quantile(v: Float32Array, wt: ((i: number) => number) | null, q: number) {
  const B = 2048, hist = new Float64Array(B); let tot = 0
  for (let i = 0; i < v.length; i++) { const w = wt ? wt(i) : 1; if (w <= 0) continue; hist[Math.min(B - 1, Math.max(0, Math.floor(v[i] * B)))] += w; tot += w }
  if (!tot) return -1
  let acc = 0; for (let b = 0; b < B; b++) { acc += hist[b]; if (acc >= q * tot) return (b + 0.5) / B }
  return 1
}

/* ------------------------------------------------------------------ analysis */
async function infer(p: Plan, bmp: ImageBitmap) {
  const W = bmp.width, H = bmp.height
  // depth at the model's native 518 px on the short side, a multiple of 14 on both
  const S = 518, a = Math.max(W, H) / Math.min(W, H), L = Math.max(S, Math.round(S * a / 14) * 14), dw = W >= H ? L : S, dh = W >= H ? S : L
  progress('analyse', { label: 'Finding depth', ep: p.ep })
  const ds = await session(p.depth, p.ep), d = await ds.run({ pixel_values: tensor(pixels(bmp, dw, dh), dw, dh) })
  const dt = d.predicted_depth, [oh, ow] = dt.dims.slice(-2) as number[], raw = Float32Array.from(dt.data as Float32Array); dt.dispose?.()
  let matte: Float32Array | null = null
  let subjectError = ''
  if (p.subject) try {
    progress('analyse', { label: 'Finding the subject', ep: p.ep })
    const ss = await session(p.subject, p.ep), o = await ss.run({ pixel_values: tensor(pixels(bmp, 1024, 1024), 1024, 1024) })
    const al = o.alphas.data as Float32Array, m = new Float32Array(1024 * 1024)
    for (let i = 0; i < m.length; i++) m[i] = clamp01(al[i])
    o.alphas.dispose?.(); matte = resize(m, 1024, 1024, W, H)
  } catch (e: any) { console.warn('Subject model failed; depth only:', e); subjectError = String(e?.message || e) }   // depth alone still works
  return { raw, ow, oh, matte, subjectError }
}

async function analyse(bmp: ImageBitmap, faces: { x: number; y: number; sx: number; sy: number }[]) {
  const t0 = performance.now(), W = bmp.width, H = bmp.height, n = W * H
  let p = await getPlan(), r
  try { r = await infer(p, bmp) }
  catch (e) { if (p.ep !== 'webgpu') throw e; console.warn('WebGPU lens blur analysis failed, using WebAssembly:', e); p = await getPlan(WASM_PLAN); r = await infer(p, bmp) }
  progress('analyse', { label: 'Refining edges', ep: p.ep })
  const { raw, ow, oh, matte, subjectError } = r

  // relative inverse depth -> 0 (far) .. 1 (near), robust to a few extreme pixels
  let D = resize(raw, ow, oh, W, H)
  { let lo = Infinity, hi = -Infinity; for (let i = 0; i < raw.length; i++) { if (raw[i] < lo) lo = raw[i]; if (raw[i] > hi) hi = raw[i] }
    const span = Math.max(1e-6, hi - lo); for (let i = 0; i < n; i++) D[i] = (D[i] - lo) / span
    const q0 = quantile(D, null, 0.005), q1 = quantile(D, null, 0.998), s = Math.max(1e-3, q1 - q0)
    for (let i = 0; i < n; i++) D[i] = clamp01((D[i] - q0) / s) }

  const px = pixels(bmp, W, H), I = new Float32Array(n)
  for (let i = 0; i < n; i++) I[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255
  const long = Math.max(W, H)

  // the subject: its depth, and only the parts of the matte that sit at that depth
  let subj = -1, area = 0, M: Float32Array | null = null, cx = 0, cy = 0
  if (matte) {
    for (let i = 0; i < n; i++) area += matte[i]
    area /= n
    if (area > 0.002) {
      subj = quantile(D, i => (matte[i] > 0.5 ? matte[i] : 0), 0.5)
      const mad = quantile(Float32Array.from(D, (v, i) => (matte[i] > 0.5 ? Math.abs(v - subj) : 2)), i => (matte[i] > 0.5 ? 1 : 0), 0.5)
      const tol = Math.max(0.12, 3 * mad)
      M = new Float32Array(n); let ws = 0
      for (let i = 0; i < n; i++) { const dd = Math.abs(D[i] - subj), k = dd < tol ? 1 : dd > tol * 2 ? 0 : 1 - (dd - tol) / tol; M[i] = matte[i] * k; if (M[i] > 0.5) { cx += (i % W) * M[i]; cy += Math.floor(i / W) * M[i]; ws += M[i] } }
      if (ws > 0) { cx /= ws * W; cy /= ws * H } else { M = null; subj = -1 }
    }
  }

  // just outside the subject the depth model blends subject and background; give that band the background's depth
  if (M) {
    const rr = Math.max(2, Math.round(long * 0.012)), Md = morph(M, W, H, rr, true), De = morph(D, W, H, rr, false)
    for (let i = 0; i < n; i++) { const band = Math.max(0, Md[i] - M[i]); D[i] += (De[i] - D[i]) * band }
  }
  // snap depth edges to the photo's edges
  D = guided(I, D, W, H, Math.max(2, Math.round(long / 220)), 4e-4)
  for (let i = 0; i < n; i++) D[i] = clamp01(D[i])

  // auto focus: the subject, else the biggest face, else the centre of the frame
  let focus: number, fu: number, fv: number
  const big = [...faces].sort((a, b) => b.sx - a.sx)[0]
  const boxMedian = (u: number, v: number, hu: number, hv: number) => { const x0 = Math.max(0, Math.floor((u - hu) * W)), x1 = Math.min(W, Math.ceil((u + hu) * W)), y0 = Math.max(0, Math.floor((v - hv) * H)), y1 = Math.min(H, Math.ceil((v + hv) * H)); return quantile(D, i => { const x = i % W, y = (i / W) | 0; return x >= x0 && x < x1 && y >= y0 && y < y1 ? 1 : 0 }, 0.5) }
  if (subj >= 0) { focus = subj; [fu, fv] = big ? [big.x, big.y] : [cx, cy] }
  else if (big) { focus = boxMedian(big.x, big.y, big.sx * 0.25, big.sy * 0.25); [fu, fv] = [big.x, big.y] }
  else { focus = boxMedian(0.5, 0.5, 0.1, 0.1); [fu, fv] = [0.5, 0.5] }
  if (focus < 0) focus = 0.5
  if (subj < 0) subj = focus

  const data = new Uint8Array(n * 2), hist = new Array(64).fill(0)
  for (let i = 0; i < n; i++) {
    const m = M ? M[i] : 0, d = D[i]
    data[i * 2] = Math.round(d * 255); data[i * 2 + 1] = Math.round(m * 255)
    hist[Math.min(63, Math.floor((d + (subj - d) * m) * 64))]++
  }
  const peak = Math.max(...hist)
  bmp.close()
  return { w: W, h: H, data, focus, focusUV: [fu, fv], subj, area: M ? area : 0, hist: hist.map(v => v / peak), ep: p.ep, subjectError, ms: Math.round(performance.now() - t0) }
}

let chain: Promise<unknown> = Promise.resolve()
self.onmessage = (e: MessageEvent) => {
  const m = e.data
  if (m.type !== 'run') return
  chain = chain.then(async () => {
    try { const out = await analyse(m.bmp, m.faces || []); post({ id: m.id, ok: true, out }, [out.data.buffer]) }
    catch (err: any) { post({ id: m.id, ok: false, error: String(err?.message || err) }) }
    finally { progress('idle') }
  })
}

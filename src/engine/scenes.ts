/* Scene grouping. A shoot often moves between spots (another backdrop, the other side of the street, indoors and
   out) and each spot wants its own small tweaks on top of the shoot's look. Every photo gets a cheap signature from
   its linear thumbnail:
   - the colours in it: a 2D histogram of log(r/g), log(b/g), so reframing the same backdrop changes little;
   - its tonal spread: brightness in stops from the photo's own average, so an exposure change does not split a scene;
   - a coarse layout (4 x 4 cells of brightness and colour), only compared between photos of the same orientation;
   - how bright the place really was, from the exposure settings (raws only): sun, shade and indoors sit stops apart.
   Photos are walked in capture order; a new scene starts when a photo looks unlike the last few of the current one,
   with the bar lowered after a long pause and raised inside a quick run of frames. Scenes that look alike throughout
   (a spot revisited later) are then merged. */
import { half2f } from './core'

const CB = 10, CR = 1.2          // chroma bins per axis over log(r/g), log(b/g) in [-CR, CR]
const TB = 12, T0 = -6, T1 = 4   // tone bins over stops from the photo's mean
const G = 4                      // layout grid
export const SPLIT = 0.3         // distance above which the next photo starts a new scene
export const JOIN = 0.27         // a photo added later joins an existing scene below this distance
const MERGE = 0.2                // two scenes this alike throughout are one spot

export interface Sig { chroma: Float32Array; tone: Float32Array; grid: Float32Array; land: boolean; lv: number | null; t: number | null }

let H2F: Float32Array | null = null
const lut = () => { if (!H2F) { H2F = new Float32Array(65536); for (let i = 0; i < 65536; i++) H2F[i] = half2f(i) } return H2F }

/* soft (linear) binning, so a small shift moves weight between neighbouring bins instead of jumping */
function bin1(x: number, n: number) { const f = Math.min(n - 1, Math.max(0, x - 0.5)), i = Math.min(n - 2, Math.floor(f)); return [i, f - i] as const }

export function signature(T: { w: number; h: number; data: Uint16Array }, meta: any): Sig {
  const { w, h, data } = T, n = w * h, L = lut()
  let top = 0
  for (let i = 0; i < n * 3; i++) { const v = L[data[i]]; if (v > top) top = v }
  const Y = new Float32Array(n), ok = new Uint8Array(n); let logSum = 0, k = 0
  for (let i = 0; i < n; i++) {
    const r = L[data[i * 3]], g = L[data[i * 3 + 1]], b = L[data[i * 3 + 2]], m = Math.max(r, g, b), y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    Y[i] = y; if (m >= top * 0.97 || y <= top * 1e-3) continue
    ok[i] = 1; logSum += Math.log2(y); k++
  }
  const mean = k ? logSum / k : 0, meanY = 2 ** mean
  const chroma = new Float32Array(CB * CB), tone = new Float32Array(TB), cell = new Float32Array(G * G * 4)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const q = j * w + i; if (!ok[q]) continue
    const r = L[data[q * 3]], g = L[data[q * 3 + 1]], b = L[data[q * 3 + 2]], y = Y[q], l = Math.log2(y) - mean
    const [ti, tf] = bin1((l - T0) / (T1 - T0) * TB, TB); tone[ti] += 1 - tf; tone[ti + 1] += tf
    const c = (Math.min(G - 1, (j * G / h) | 0) * G + Math.min(G - 1, (i * G / w) | 0)) * 4
    cell[c] += l; cell[c + 3] += 1
    if (r <= 0 || g <= 0 || b <= 0) continue
    const u = Math.log(r / g), v = Math.log(b / g), wt = Math.min(1, y / (meanY * 0.25))   // dark pixels have noisy colour
    const [ui, uf] = bin1((u + CR) / (2 * CR) * CB, CB), [vi, vf] = bin1((v + CR) / (2 * CR) * CB, CB)
    chroma[vi * CB + ui] += wt * (1 - uf) * (1 - vf); chroma[vi * CB + ui + 1] += wt * uf * (1 - vf)
    chroma[(vi + 1) * CB + ui] += wt * (1 - uf) * vf; chroma[(vi + 1) * CB + ui + 1] += wt * uf * vf
    cell[c + 1] += u * wt; cell[c + 2] += v * wt
  }
  const norm = (a: Float32Array) => { let s = 0; for (const x of a) s += x; if (s > 0) for (let i = 0; i < a.length; i++) a[i] /= s }
  norm(chroma); norm(tone)
  const grid = new Float32Array(G * G * 3).fill(NaN)
  for (let c = 0; c < G * G; c++) { const m = cell[c * 4 + 3]; if (m > 20) { grid[c * 3] = cell[c * 4] / m; grid[c * 3 + 1] = cell[c * 4 + 1] / m; grid[c * 3 + 2] = cell[c * 4 + 2] / m } }
  // scene luminance in stops: the picture's brightness undone by aperture, shutter and ISO
  const N = meta?.aperture, t = meta?.shutter, iso = meta?.iso
  const lv = k && N > 0 && t > 0 && iso > 0 ? mean + Math.log2(N * N / t) - Math.log2(iso / 100) : null
  return { chroma, tone, grid, land: w >= h, lv, t: meta?.time ?? null }
}

const hellinger = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i] * b[i]); return Math.sqrt(Math.max(0, 1 - s)) }
/* 0 for the same picture, around 0.15 for frames of one spot, 0.4 and up for different places */
export function distance(a: Sig, b: Sig) {
  let d = 0.45 * hellinger(a.chroma, b.chroma) + 0.2 * hellinger(a.tone, b.tone), w = 0.65
  if (a.land === b.land) {
    let s = 0, m = 0
    for (let c = 0; c < G * G; c++) {
      const i = c * 3; if (Number.isNaN(a.grid[i]) || Number.isNaN(b.grid[i])) continue
      s += Math.min(1, Math.abs(a.grid[i] - b.grid[i]) / 3 + (Math.abs(a.grid[i + 1] - b.grid[i + 1]) + Math.abs(a.grid[i + 2] - b.grid[i + 2])) * 2); m++
    }
    if (m >= 4) { d += 0.15 * s / m; w += 0.15 }
  }
  if (a.lv != null && b.lv != null) { d += 0.2 * Math.min(1, Math.abs(a.lv - b.lv) / 4); w += 0.2 }
  return d / w
}
/* how far a photo is from a group of photos: its nearest member */
export const nearest = (s: Sig, group: Sig[]) => { let d = Infinity; for (const g of group) d = Math.min(d, distance(s, g)); return d }
const average = (A: Sig[], B: Sig[]) => {
  const pick = (X: Sig[]) => (X.length <= 16 ? X : Array.from({ length: 16 }, (_, i) => X[Math.floor(i * X.length / 16)]))
  const a = pick(A), b = pick(B); let s = 0; for (const x of a) for (const y of b) s += distance(x, y); return s / (a.length * b.length)
}

/* Split photos (already in capture order) into scenes. Returns a scene number per photo, numbered in order of
   first appearance. */
export function groupScenes(sigs: Sig[]): number[] {
  if (!sigs.length) return []
  const groups: Sig[][] = [[sigs[0]]], of = [0]
  for (let i = 1; i < sigs.length; i++) {
    const s = sigs[i], prev = sigs[i - 1], dt = s.t != null && prev.t != null ? Math.abs(s.t - prev.t) : null, cur = groups[groups.length - 1]
    let same = dt != null && dt <= 3   // a burst is always one spot
    if (!same) {
      let bar = SPLIT
      if (dt != null) bar += dt < 60 ? 0.06 : dt > 3600 ? -0.1 : dt > 900 ? -0.05 : 0
      same = nearest(s, cur.slice(-5)) <= bar
    }
    if (same) cur.push(s); else groups.push([s])
    of.push(groups.length - 1)
  }
  // merge scenes that look alike throughout: the same spot visited twice
  const root = groups.map((_, i) => i), find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])))
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const a = find(i), b = find(j); if (a === b) continue
    if (average(groups[i], groups[j]) < MERGE) root[b] = a
  }
  const num = new Map<number, number>()
  return of.map(g => { const r = find(g); if (!num.has(r)) num.set(r, num.size); return num.get(r)! })
}

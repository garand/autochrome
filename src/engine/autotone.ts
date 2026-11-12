/* Auto for the Basic panel: the whole panel at once, or one control at a time.
   This pipeline has its own tone curve (filmic shoulder, its own contrast, whites and blacks), so rather than guess
   from the raw histogram, each control is solved by rendering a small preview through the real renderer and searching
   for the value that makes the result hit a target (all the controls are monotonic, so bisection works):
     exposure    the centre-weighted mid-tone (and the faces, when there are any) to a natural brightness
     highlights  pulled down only when the brightest 2% is near white
     shadows     lifted only when the darkest 8% is crushed
     contrast    the tonal spread towards a natural range, applied at 70%
     whites      the brightest 0.3% just reaching white;   blacks  the darkest 0.3% just reaching black
     dehaze      only when even the darkest pixels are lifted by haze
     clarity     only when local contrast is low; gentle on portraits
     vibrance    only when the colour is muted;  saturation  only when it is very muted
     texture     a touch for scenes without faces (detail cannot be judged from a small preview)
     temp / tint from the scene's light, see autoWhiteBalance() in the store
   Auto for everything starts from zero, as Lightroom does; auto for one control works around the others as they are. */

export interface Look { y: Float32Array; mx: Float32Array; mn: Float32Array; geo: number; face: number | null; std: number; sat: number; local: number }
export type FaceBox = { x0: number; y0: number; x1: number; y1: number }   // output uv, top-down

const pc = (a: Float32Array, q: number) => a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]

/* measurements of a rendered preview: RGBA bytes as read back from WebGL (bottom row first) */
export function lookStats(px: Uint8Array, w: number, h: number, faces: FaceBox[]): Look {
  const n = w * h, y = new Float32Array(n), mx = new Float32Array(n), mn = new Float32Array(n), fy: number[] = []
  let lg = 0, lw = 0, s1 = 0, s2 = 0, sat = 0, sn = 0
  for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) {
    const i = r * w + x, o = i * 4, R = px[o] / 255, G = px[o + 1] / 255, B = px[o + 2] / 255
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, hi = Math.max(R, G, B), lo = Math.min(R, G, B)
    y[i] = Y; mx[i] = hi; mn[i] = lo; s1 += Y; s2 += Y * Y
    const u = (x + 0.5) / w - 0.5, v = 0.5 - (r + 0.5) / h, cw = Math.exp(-(u * u + v * v) * 4)   // centre-weighted
    lg += Math.log(Y + 0.01) * cw; lw += cw
    if (hi > 0.12 && hi < 0.98) { sat += (hi - lo) / hi; sn++ }
    if (faces.length) { const fu = (x + 0.5) / w, fv = 1 - (r + 0.5) / h; if (faces.some(f => fu >= f.x0 && fu <= f.x1 && fv >= f.y0 && fv <= f.y1)) fy.push(Y) }
  }
  // local contrast: mean distance from a 13 px box blur of luma (separable running sums)
  const t = new Float32Array(n), b = new Float32Array(n), R = 6, k = 1 / (2 * R + 1)
  for (let r = 0; r < h; r++) { let s = 0; for (let x = -R; x <= R; x++) s += y[r * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { t[r * w + x] = s * k; s += y[r * w + Math.min(w - 1, x + R + 1)] - y[r * w + Math.max(0, x - R)] } }
  for (let x = 0; x < w; x++) { let s = 0; for (let r = -R; r <= R; r++) s += t[Math.min(h - 1, Math.max(0, r)) * w + x]; for (let r = 0; r < h; r++) { b[r * w + x] = s * k; s += t[Math.min(h - 1, r + R + 1) * w + x] - t[Math.max(0, r - R) * w + x] } }
  let loc = 0; for (let i = 0; i < n; i++) loc += Math.abs(y[i] - b[i])
  fy.sort((a, c) => a - c)
  const mean = s1 / n
  return { y: y.sort(), mx: mx.sort(), mn: mn.sort(), geo: Math.exp(lg / lw) - 0.01, face: fy.length > 20 ? fy[fy.length >> 1] : null, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), sat: sn ? sat / sn : 0, local: loc / n }
}

export const AUTO_KEYS = ['temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation']
const ORDER = ['temp', 'tint', 'exposure', 'highlights', 'shadows', 'contrast', 'whites', 'blacks', 'dehaze', 'clarity', 'texture', 'vibrance', 'saturation']
export interface AutoCtx {
  measure: (s: Record<string, number>) => Look   // render with these Basic values (the rest of the photo's settings as they are)
  wb: { temp: number; tint: number } | null      // the scene's neutral, from the store
  faces: boolean; iso: number; bw: boolean
}
/* the auto values for `keys`, given the photo's current Basic values `cur` */
export function solveAuto(keys: string[], cur: Record<string, number>, ctx: AutoCtx): Record<string, number> {
  const all = keys.length > 1, want = new Set(keys), s: Record<string, number> = {}, out: Record<string, number> = {}
  for (const k of AUTO_KEYS) s[k] = all && want.has(k) ? 0 : cur[k] ?? 0
  const look = (patch: Record<string, number> = {}) => ctx.measure({ ...s, ...patch })
  /* f must grow with the control's value; returns the value where f reaches target */
  const bisect = (k: string, lo: number, hi: number, f: (l: Look) => number, target: number, n = 10) => {
    for (let i = 0; i < n; i++) { const mid = (lo + hi) / 2; if (f(look({ [k]: mid })) < target) lo = mid; else hi = mid }
    return (lo + hi) / 2
  }
  const bright = (l: Look) => (l.face != null ? 0.5 * l.face / 0.5 + 0.5 * l.geo / 0.37 : l.geo / 0.37)
  const solve: Record<string, () => number> = {
    temp: () => (ctx.wb ? ctx.wb.temp : s.temp),
    tint: () => (ctx.wb ? ctx.wb.tint : s.tint),
    exposure: () => Math.round(bisect('exposure', -3.5, 3.5, bright, 1) * 20) / 20,
    highlights: () => (pc(look().y, 0.98) <= 0.9 ? 0 : Math.max(-70, bisect('highlights', -100, 0, l => pc(l.y, 0.98), 0.9))),
    shadows: () => (pc(look().y, 0.08) >= 0.1 ? 0 : Math.min(55, bisect('shadows', 0, 100, l => pc(l.y, 0.08), 0.1))),
    contrast: () => Math.max(-25, Math.min(30, 0.7 * bisect('contrast', -40, 40, l => l.std, 0.21))),
    whites: () => bisect('whites', -40, 40, l => pc(l.mx, 0.997), 0.97),   // a foggy or low-key scene has no true white or black:
    blacks: () => bisect('blacks', -35, 35, l => pc(l.y, 0.003), 0.025),   // the ranges stop them being forced
    dehaze: () => (pc(look().mn, 0.05) <= 0.07 ? 0 : Math.min(40, bisect('dehaze', 0, 60, l => -pc(l.mn, 0.05), -0.05))),
    clarity: () => (look().local >= 0.045 ? 0 : Math.min(ctx.faces ? 8 : 15, bisect('clarity', 0, 40, l => l.local, 0.045))),
    texture: () => (ctx.faces ? 0 : ctx.iso > 1600 ? 4 : 10),
    vibrance: () => (ctx.bw || look().sat >= 0.26 ? 0 : Math.min(25, bisect('vibrance', 0, 50, l => l.sat, 0.26))),
    saturation: () => (ctx.bw || look().sat >= 0.15 ? 0 : 6),
  }
  for (const k of ORDER) {
    if (!want.has(k)) continue
    const v = solve[k](); s[k] = k === 'exposure' ? v : Math.round(v); out[k] = s[k]
  }
  return out
}

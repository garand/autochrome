/* Tinted glasses: find each lens of a pair of glasses from the face mesh, measure what the lens does to the light,
   and hand the renderer what it needs to undo it. The approach follows a careful hand retouch of a real shoot
   (photochromic lenses gone grey outdoors, with green trees reflected in the coating):

     lens       - the clear aperture inside the frame, traced as a closed loop along the frame's inner rim
                  (lensAperture.ts). The correction fades out right at the rim and never reaches the frame: spilling
                  onto clear acetate is what makes a frame look highlighted.
     tint       - a grey / coloured filter, measured as the ratio between skin just outside the lower frame and skin
                  just inside the lens, ray by ray along the lower rim (the two are almost the same skin), and undone
                  as a per-channel gain.
     reflection - a coloured image laid over the lens. It is not subtracted (no single colour can be, and subtracting
                  green leaves magenta). Where a smooth mask says there is reflection, the pixel is rebuilt from the
                  channel the reflection touches least (detail and brightness) with the colour of clean skin inside
                  the same lens, and a nearly neutral colour over the eye itself.

   Everything is measured on the 384px face crop the decode worker cuts (2x the face box, gamma 2.2, scaled so the
   face sits near 0.9) and converted to image space in lensesFor() in the store. */

import { clamp } from './core'
import { findLensApertures } from './lensAperture'

export const NR = 48          // edge radii per lens, evenly spaced in angle (gl.ts reads 48)
const LUMA = [0.2126, 0.7152, 0.0722]
const LIN = new Float32Array(256).map((_, i) => Math.pow(i / 255, 2.2))
const EYES = [[33, 133, 159, 145], [263, 362, 386, 374]]   // outer corner, inner corner, upper lid, lower lid

/* one lens in face-crop pixels: an axis-aligned superellipse in the (ax, up) frame, scaled per angle by R (the inner
   rim), and the eye inside it as an ellipse in the same frame */
export interface Lens { c: number[]; rx: number; ry: number; R: number[]; eye: number[] }
/* gain: undoes the tint. Reflection (all zero when there is none): e = dot(colour, nrm) / luminance is how far a
   colour leans towards the reflection; it counts as reflection from e0 to e1 (after smoothing). There the pixel
   becomes dot(colour, sel) * rho: sel weighs the cleanest channels into a luminance, rho is clean skin's colour at
   unit luminance. */
export interface Glasses { n: number; v: 3; ax: number[]; up: number[]; lens: Lens[]; gain: number[]; nrm: number[]; e: number[]; sel: number[]; rho: number[] }

const luma = (c: number[]) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map(x => x / l) }
const pctl = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] }
const chan = (px: number[][], f: (v: number[]) => number) => [0, 1, 2].map(k => f(px.map(c => c[k])))
const median = (v: number[]) => pctl(v, 0.5)

/* where a ray at angle a reaches t times the lens outline */
function at(g: { ax: number[]; up: number[] }, L: { c: number[]; rx: number; ry: number }, a: number, t: number) {
  const ca = Math.cos(a), sa = Math.sin(a), k = t / Math.cbrt(Math.abs(ca) ** 3 + Math.abs(sa) ** 3)
  return [L.c[0] + (g.ax[0] * L.rx * ca + g.up[0] * L.ry * sa) * k, L.c[1] + (g.ax[1] * L.rx * ca + g.up[1] * L.ry * sa) * k]
}

export function measureGlasses(crop: Uint8ClampedArray, mesh: number[][], N: number): Glasses | null {
  const px = (x: number, y: number) => {   // bilinear, linear light
    x = clamp(x, 0, N - 1.001); y = clamp(y, 0, N - 1.001); const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, o: number[] = [0, 0, 0]
    for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) { const i = ((y0 + dy) * N + x0 + dx) * 4; for (let k = 0; k < 3; k++) o[k] += LIN[crop[i + k]] * w }
    return o
  }
  const m = mesh, ax = norm([m[263][0] - m[33][0], m[263][1] - m[33][1]]); let up = [ax[1], -ax[0]]
  if (up[1] > 0) up = [-up[0], -up[1]]
  const g = { ax, up }, angles = Array.from({ length: NR }, (_, i) => i * 2 * Math.PI / NR)
  // log luminance of the crop, for edge finding
  const LL = new Float32Array(N * N), CA = new Float32Array(N * N), CB = new Float32Array(N * N)   // log luminance, log R/G, log B/G
  for (let i = 0; i < N * N; i++) LL[i] = Math.log(0.2126 * LIN[crop[i * 4]] + 0.7152 * LIN[crop[i * 4 + 1]] + 0.0722 * LIN[crop[i * 4 + 2]] + 1e-3)
  for (let i = 0; i < N * N; i++) { const r = LIN[crop[i * 4]] + 2e-3, gg = LIN[crop[i * 4 + 1]] + 2e-3, b = LIN[crop[i * 4 + 2]] + 2e-3; CA[i] = Math.log(r / gg); CB[i] = Math.log(b / gg) }
  const samp = (A: Float32Array, x: number, y: number) => { x = clamp(x, 0, N - 1.001); y = clamp(y, 0, N - 1.001); const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * N + x0; return (A[i] * (1 - fx) + A[i + 1] * fx) * (1 - fy) + (A[i + N] * (1 - fx) + A[i + N + 1] * fx) * fy }
  const logL = (x: number, y: number) => samp(LL, x, y)
  // start from the mesh: a lens around each eye, a bit wider than the eye and centred a little below it
  const base = EYES.map(([o, i, t, b]) => {
    const ew = Math.hypot(m[o][0] - m[i][0], m[o][1] - m[i][1])
    return { c: [(m[o][0] + m[i][0] + m[t][0] + m[b][0]) / 4 - up[0] * 0.12 * ew, (m[o][1] + m[i][1] + m[t][1] + m[b][1]) / 4 - up[1] * 0.12 * ew], rx: 1.15 * ew, ry: 0.72 * ew }
  })
  if (base.some(L => L.rx < 4)) return null
  const bridge = [(m[133][0] + m[362][0]) / 2, (m[133][1] + m[362][1]) / 2]
  /* The lens outlines: a closed trace of each frame's inner rim (lensAperture.ts), turned into radii per angle
     around the mesh lens, which is what the renderer reads. If the trace fails, fall back to fitting a mirrored
     shape to the edges and snapping each ray to the rim. */
  let Rs: number[][] | null = null
  const traced = findLensApertures(crop, N, mesh)
  if (traced) { const t = traced.polys.map((poly, e) => polyToRadii(poly, base[e], g)); if (t.every(r => r.every(x => x > 0.3 && x < 2.4))) Rs = t }
  if (!Rs) {
    /* then fit the frame. A pair of glasses is symmetric, so both lenses share one shape: width, height, how far the
       lens sits below / above the eye and out towards the temple, and how square its corners are. The best shape runs
       along a brightness edge all the way round, holds the whole eye and leaves the bridge of the nose outside. */
    type Shape = { c: number[]; rx: number; ry: number; p: number }
    const shape = (e: number, sx: number, sy: number, dy: number, dx: number, p: number): Shape => {
      const L = base[e], out = e === 0 ? -1 : 1   // lens 0 is the one on the image-left (landmark 33 side): outward is -ax
      return { c: [L.c[0] + up[0] * dy * L.ry + ax[0] * out * dx * L.rx, L.c[1] + up[1] * dy * L.ry + ax[1] * out * dx * L.rx], rx: L.rx * sx, ry: L.ry * sy, p }
    }
    const on = (F: Shape, a: number, t: number) => { const ca = Math.cos(a), sa = Math.sin(a), k = t / Math.pow(Math.abs(ca) ** F.p + Math.abs(sa) ** F.p, 1 / F.p); return [F.c[0] + (ax[0] * F.rx * ca + up[0] * F.ry * sa) * k, F.c[1] + (ax[1] * F.rx * ca + up[1] * F.ry * sa) * k] as [number, number] }
    const normIn = (F: Shape, x: number, y: number) => { const dx = x - F.c[0], dy = y - F.c[1], u = (dx * ax[0] + dy * ax[1]) / F.rx, v = (dx * up[0] + dy * up[1]) / F.ry; return Math.pow(Math.abs(u) ** F.p + Math.abs(v) ** F.p, 1 / F.p) }
    const FA = Array.from({ length: 24 }, (_, i) => i * 2 * Math.PI / 24)
    const score = (q: number[]) => {
      let sc = 0
      for (let e = 0; e < 2; e++) {
        const F = shape(e, q[0], q[1], q[2], q[3], q[4])
        // soft rules (the mesh is only so precise): the outline holds the whole eye with room below the lower lid
        // (where the tint is measured) and leaves the bridge of the nose outside
        const [o, i, t, b] = EYES[e]
        for (const k of [o, i, t]) sc -= 30 * Math.max(0, normIn(F, m[k][0], m[k][1]) - 0.85)
        sc -= 30 * Math.max(0, normIn(F, m[b][0], m[b][1]) - 0.6)
        sc -= 30 * Math.max(0, 1.05 - normIn(F, bridge[0], bridge[1]))
        // sqrt: an edge that runs all the way round beats a few strong ones (lids, lashes, brows). An edge that is
        // brighter outside (tinted lens against skin, or against a clear frame) counts double one that is darker
        // outside, which inside a lens is usually just the edge of a reflection
        for (const a of FA) { const d = logL(...on(F, a, 1.07)) - logL(...on(F, a, 0.93)); sc += d > 0 ? Math.sqrt(d) : 0.5 * Math.sqrt(-d) }
      }
      return sc
    }
    let best = [1, 1, 0, 0, 3], bs = -Infinity
    for (const p of [2.5, 3.5, 5]) for (let sx = 0.8; sx < 1.65; sx += 0.1) for (let sy = 0.8; sy < 1.75; sy += 0.1) for (let dy = -0.3; dy < 0.31; dy += 0.1) for (let dx = -0.1; dx < 0.41; dx += 0.075) {
      const q = [sx, sy, dy, dx, p], v = score(q); if (v > bs) { bs = v; best = q }
    }
    for (let round = 0, st = 0.05; round < 2; round++, st /= 2) {   // refine around the best
      const b0 = best
      for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) for (const d of [-1, 0, 1]) { const q = [clamp(b0[0] + a * st, 0.8, 1.6), clamp(b0[1] + b * st, 0.8, 1.7), clamp(b0[2] + c * st, -0.3, 0.3), clamp(b0[3] + d * st, -0.1, 0.4), b0[4]], v = score(q); if (v > bs) { bs = v; best = q } }
    }
    /* The fitted outline becomes a radius per angle around the mesh lens (what the renderer reads), then each ray moves
       to the first clear edge going outwards (the inner rim: tinted lens to frame), never the strongest one further out
       (the outside of a clear frame). The part of the lens below the eye is also grown as a region of its own tone
       until the frame stops it; its convex hull follows square corners that no smooth shape fits, but may only push the
       rim out a little, never across the frame. */
    // what the frame looks like: the bridge between the lenses is always frame (median over a small patch)
    const ewAvg = (base[0].rx + base[1].rx) / 2 / 1.15, fr: number[][] = []
    for (let dy = -0.12; dy <= 0.12; dy += 0.06) for (let dx = -0.08; dx <= 0.08; dx += 0.04) { const x = bridge[0] + (ax[0] * dx + up[0] * dy) * ewAvg, y = bridge[1] + (ax[1] * dx + up[1] * dy) * ewAvg; fr.push([samp(LL, x, y), samp(CA, x, y), samp(CB, x, y)]) }
    const frame = chan(fr, median)
    const frameLike = (f: number[]) => Math.exp(-(((f[0] - frame[0]) / 0.25) ** 2 + ((f[1] - frame[1]) / 0.08) ** 2 + ((f[2] - frame[2]) / 0.08) ** 2) / 2)
    const rims = [0, 1].map(e => {
      const B = base[e], F = shape(e, best[0], best[1], best[2], best[3], best[4])
      const fitted = angles.map(a => { let lo = 0.2, hi = 3; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (normIn(F, ...at(g, B, a, mid) as [number, number]) < 1) lo = mid; else hi = mid } return (lo + hi) / 2 })
      // an edge in brightness or in colour, either way: a tinted lens meets a bright frame, a green reflection meets a
      // grey one, skin seen through a clear lens meets a dark one
      const feat = (a: number, t: number) => { const [x, y] = at(g, B, a, t) as [number, number]; return [samp(LL, x, y), samp(CA, x, y), samp(CB, x, y)] }
      const edge = (a: number, t: number) => { const o1 = feat(a, t + 0.02), o2 = feat(a, t + 0.05), i1 = feat(a, t - 0.02), i2 = feat(a, t - 0.05), d = o1.map((v, k) => (v + o2[k] - i1[k] - i2[k]) / 2); return Math.sqrt(d[0] * d[0] + 0.6 * (d[1] * d[1] + d[2] * d[2])) }
      // the rim on each ray: the first place, going out, where the colour changes and what lies beyond looks like the
      // frame while what lies before does not. Reflections and lashes inside the lens never look like the frame. If the
      // frame does not stand out (rimless glasses), fall back to the first strong edge.
      const snapped = fitted.map((R0, j) => {
        const a = angles[j], ts: number[] = [], ds: number[] = [], fs: number[] = []
        for (let t = Math.max(0.6, R0 - 0.3); t <= R0 + 0.25; t += 0.01) {
          ts.push(t); ds.push(edge(a, t))
          fs.push(Math.max(0, (frameLike(feat(a, t + 0.03)) + frameLike(feat(a, t + 0.07))) / 2 - (frameLike(feat(a, t - 0.03)) + frameLike(feat(a, t - 0.07))) / 2))
        }
        const sc = ds.map((d, k) => d * fs[k]), top = Math.max(...sc)
        const pick = (v: number[], mx: number) => { for (let k = 1; k < v.length - 1; k++) if (v[k] >= 0.55 * mx && v[k] >= v[k - 1] && v[k] >= v[k + 1]) return ts[k]; return ts[v.indexOf(mx)] }
        const td = Math.max(...ds); if (td <= 0.07) return NaN   // no edge on this ray: filled in from its neighbours below
        const byEdge = pick(ds, td)
        return top > 0.06 ? Math.min(pick(sc, top), byEdge) : byEdge   // the smaller: a mask a touch small hides, one on the frame shows
      })
      // rays with no edge take the fitted outline scaled like the nearest rays that found one, on either side
      if (snapped.every(isNaN)) return null
      const ratio = snapped.map((r, j) => r / fitted[j]), fill = ratio.map((r, j) => {
        if (!isNaN(r)) return r
        let a = 1, b = 1; while (isNaN(ratio[(j - a + NR) % NR])) a++; while (isNaN(ratio[(j + b) % NR])) b++
        return (ratio[(j - a + NR) % NR] * b + ratio[(j + b) % NR] * a) / (a + b)
      })
      snapped.forEach((_, j) => { snapped[j] = fitted[j] * fill[j] })
      const md = snapped.map((_, j) => median([-1, 0, 1].map(k => snapped[(j + k + NR) % NR])))
      const sm = md.map((_, j) => (md[(j + NR - 1) % NR] + md[j] + md[(j + 1) % NR]) / 3)
      const grown = growLens(LL, N, B, g, angles)
      return sm.map((r, j) => Math.max(r, grown ? Math.min(grown[j], r + 0.04) : 0))
    })
    // the two lenses are mirror images (angle a mirrors to pi - a): neither may reach much past its twin, so a rim that
    // ran onto the frame or the brow on one side is pulled back by the other
    if (!rims[0] || !rims[1]) return null
    const r0 = rims[0], r1 = rims[1], mir = (j: number) => (NR / 2 - j + NR) % NR
    Rs = [r0, r1].map((rim, e) => rim.map((r, j) => clamp(Math.min(r, (e ? r0 : r1)[mir(j)] + 0.06) - 0.5 / base[e].ry, 0.6, 1.6)))   // half a pixel in: inside the rim
  }
  const lens: Lens[] = [], inner: number[][][] = [], rimIn: number[][][][] = [], rimOut: number[][][][] = []
  for (let e = 0; e < 2; e++) {
    const B = base[e], R = Rs[e]
    // the eye: an ellipse around the mesh's eye contour, in the lens frame
    const [o, i, t, b] = EYES[e], ecx = (m[o][0] + m[i][0]) / 2, ecy = (m[o][1] + m[i][1]) / 2
    const ew = Math.hypot(m[o][0] - m[i][0], m[o][1] - m[i][1]), eh = Math.abs((m[t][0] - m[b][0]) * up[0] + (m[t][1] - m[b][1]) * up[1])
    const L: Lens = { ...B, R, eye: [ecx, ecy, 0.6 * ew, Math.max(0.75 * eh, 0.12 * ew)] }
    const I: number[][] = [], RI: number[][][] = [], RO: number[][][] = []
    angles.forEach((a, j) => {
      const r = L.R[j]
      for (let t = 0.1; t < 0.88 * r; t += 0.04) I.push(px(...at(g, L, a, t) as [number, number]))
      if (Math.sin(a) < -0.3) {   // the lower rim: skin just inside the lens and just past the frame, on the same ray
        const ins: number[][] = [], outs: number[][] = []
        for (let t = r - 0.14; t < r - 0.05; t += 0.02) ins.push(px(...at(g, L, a, t) as [number, number]))
        for (let t = r + 0.2; t < r + 0.36; t += 0.02) outs.push(px(...at(g, L, a, t) as [number, number]))
        RI.push(ins); RO.push(outs)
      }
    })
    if (I.length < 20 || RI.length < 3) return null
    lens.push(L); inner.push(I); rimIn.push(RI); rimOut.push(RO)
  }
  // tint: per channel, the median over lower-rim rays of (outside / inside), shared by both lenses
  const ratios: number[][] = []
  for (let e = 0; e < 2; e++) rimIn[e].forEach((ins, j) => { const a = chan(ins, median), b = chan(rimOut[e][j], median); if (luma(a) > 1e-4) ratios.push(b.map((x, k) => x / Math.max(1e-5, a[k]))) })
  const gr = chan(ratios, median), gy = luma(gr), lum = clamp(gy, 1, 4)
  const gain = gr.map(x => clamp(x / gy, 0.8, 1.25) * lum)
  // clean skin inside the lens (after the tint is undone) and how strongly colours lean off its plane
  const ungain = (c: number[]) => c.map((x, k) => x * gain[k])
  const skinPx = rimIn.flat(2).map(ungain), skin = chan(skinPx, median), all = inner.flat().map(ungain)
  let nrm = norm(cross(norm(skin), [1, 1, 1]))
  const lean = (c: number[]) => dot(c, nrm) / (luma(c) + 1e-4)
  const e0 = all.map(lean), m0 = pctl(e0, 0.5)
  if (pctl(e0, 0.97) - m0 < m0 - pctl(e0, 0.03)) nrm = nrm.map(x => -x)   // face the side with the longer tail
  const eAll = all.map(lean), eSkin = median(skinPx.map(lean)), eHi = pctl(eAll, 0.97)
  const rho = skin.map(x => x / Math.max(1e-5, luma(skin)))   // clean skin's colour at unit luminance
  let e: number[] = [0, 0], sel = [0, 0, 0]
  if (eHi - eSkin > 0.03) {
    e = [eSkin + 0.25 * (eHi - eSkin), eSkin + 0.6 * (eHi - eSkin)]
    // the reflection's colour: what the most leaning pixels have on top of a scaled copy of the rest of the lens
    const hiPx = all.filter((_, i) => eAll[i] >= pctl(eAll, 0.9)), loPx = all.filter((_, i) => eAll[i] <= pctl(eAll, 0.5))
    const hiM = chan(hiPx, mean), loM = chan(loPx, mean).map(x => x + 1e-6), sc = Math.min(...hiM.map((h, k) => h / loM[k]))
    const q = hiM.map((h, k) => Math.max(0, h - loM[k] * sc)), rel = q.map((x, k) => x / Math.max(1e-5, skin[k])), worst = Math.max(...rel, 1e-9)
    // brightness and detail come from the channels the reflection touches least (each in skin units), weighted by
    // how clean they are: a green reflection leaves red and blue, and two channels are less noisy than one
    let w = rel.map(r => Math.max(0, 1 - r / worst) ** 2)
    if (w.reduce((x, y) => x + y, 0) < 1e-6) w = rel.map(r => (r === Math.min(...rel) ? 1 : 0))
    const ws = w.reduce((x, y) => x + y, 0); sel = w.map((x, k) => x / ws / rho[k])
  }
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  return {
    n: N, v: 3, ax: ax.map(r3), up: up.map(r3), gain: gain.map(r3), nrm: nrm.map(r3), e: e.map(r3), sel, rho: rho.map(r3),
    lens: lens.map(L => ({ c: L.c.map(r3), rx: r3(L.rx), ry: r3(L.ry), R: L.R.map(r3), eye: L.eye.map(r3) })),
  }
}
/* the part of a lens below the eye, grown from seeds under the eye through pixels of the same tone (in log luminance)
   until the frame stops it; returns its convex hull as a radius per angle, or null if it leaked out past the frame */
function growLens(LL: Float32Array, N: number, B: { c: number[]; rx: number; ry: number }, g: { ax: number[]; up: number[] }, angles: number[]): number[] | null {
  const { ax, up } = g, nrmAt = (x: number, y: number) => { const dx = x - B.c[0], dy = y - B.c[1], u = (dx * ax[0] + dy * ax[1]) / B.rx, v = (dx * up[0] + dy * up[1]) / B.ry; return Math.cbrt(Math.abs(u) ** 3 + Math.abs(v) ** 3) }
  const seeds: number[] = []
  for (let a = -2.3; a <= -0.84; a += 0.24) for (const t of [0.5, 0.6]) { const [x, y] = at(g, B, a, t), xi = Math.round(x), yi = Math.round(y); if (xi >= 0 && yi >= 0 && xi < N && yi < N) seeds.push(yi * N + xi) }
  if (seeds.length < 4) return null
  const tone = pctl(seeds.map(i => LL[i]), 0.5), seen = new Uint8Array(N * N), queue: number[] = [], pts: number[][] = []
  const ok = (i: number) => Math.abs(LL[i] - tone) < 0.3 && nrmAt(i % N, (i / N) | 0) < 1.6
  for (const i of seeds) if (ok(i) && !seen[i]) { seen[i] = 1; queue.push(i) }
  let far = 0
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h], x = i % N, y = (i / N) | 0; pts.push([x, y]); if (nrmAt(x, y) > 1.4) far++
    for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1]) if (j >= 0 && !seen[j] && ok(j) && Math.abs(LL[j] - LL[i]) < 0.12) { seen[j] = 1; queue.push(j) }
  }
  if (pts.length < 30 || far > pts.length * 0.05) return null
  const H = convexHull(pts), inside = (x: number, y: number) => { for (let k = 0; k < H.length; k++) { const p = H[k], q = H[(k + 1) % H.length]; if ((q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]) < 0) return false } return true }
  return angles.map(a => { let lo = 0, hi = 1.8; if (!inside(...at(g, B, a, 0.05) as [number, number])) return 0; for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (inside(...at(g, B, a, mid) as [number, number])) lo = mid; else hi = mid } return lo + 0.5 / B.ry })   // + half a pixel: hull runs through pixel centres
}
/* a closed polygon (crop pixels) as radii per angle around a mesh lens: along each ray, the last point still inside */
export function polyToRadii(poly: number[][], B: { c: number[]; rx: number; ry: number }, g: { ax: number[]; up: number[] }) {
  const inside = (x: number, y: number) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c } return c }
  return Array.from({ length: NR }, (_, j) => {
    const a = j * 2 * Math.PI / NR; let last = 0
    for (let t = 0.05; t <= 2.5; t += 0.005) { if (inside(...at(g, B, a, t) as [number, number])) last = t; else if (last > 0.3) break }
    return last
  })
}
/* counter-clockwise convex hull (monotone chain) */
function convexHull(P: number[][]) {
  const pts = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: number[][] = [], hi: number[][] = []
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p) }
  return lo.slice(0, -1).concat(hi.slice(0, -1))
}
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length)

/* face embeddings (Human's face description model) are stored as base64 int8 to keep the project file small */
export function packEmbedding(v: number[] | Float32Array): string {
  const n = Array.from(v), mx = Math.max(1e-9, ...n.map(Math.abs)), b = new Int8Array(n.length); for (let i = 0; i < n.length; i++) b[i] = Math.round(n[i] / mx * 127)   // scale is dropped on unpack
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i] & 255); return btoa(s)
}
const unpacked = new Map<string, Float32Array>()
export function unpackEmbedding(s: string): Float32Array {
  let v = unpacked.get(s)
  if (!v) { const bin = atob(s); v = new Float32Array(bin.length); let l = 0; for (let i = 0; i < bin.length; i++) { const x = (bin.charCodeAt(i) << 24) >> 24; v[i] = x; l += x * x } l = Math.sqrt(l) || 1; for (let i = 0; i < v.length; i++) v[i] /= l; unpacked.set(s, v) }
  return v
}
export const similarity = (a: string, b: string) => { const x = unpackEmbedding(a), y = unpackEmbedding(b); let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s }

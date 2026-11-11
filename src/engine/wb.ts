/* White balance in real units.

   A raw file records the camera's as-shot white balance multipliers and a colour matrix from XYZ to the camera's
   own colour space. From those we can say which light (a colour temperature on the black-body curve plus a tint
   off it) the camera treated as neutral, and we can re-balance for any other light the way a raw converter would:
   by changing the multipliers in camera space, which becomes a 3x3 matrix once the data is in linear sRGB.

   Settings stay relative so a shoot-wide edit shifts every photo by the same perceived amount:
     temp = warmth in mireds relative to as shot (positive = warmer, i.e. a higher Kelvin setting)
     tint = tint relative to as shot (positive = magenta), in Lightroom-like units (1 unit ~ 1/3000 duv)
   The UI shows the resulting absolute Kelvin and tint for the current photo.

   Files without camera colour data (JPEG, PNG, some raws) are treated as sRGB with a D65 white. */

export type M3 = number[]   // 3x3, row-major
export interface ColorInfo { camXyz: M3; rgbCam: M3; mul: number[]; raw: boolean }
export interface WbState { info: ColorInfo; mired: number; tint: number }   // as-shot

export const K_MIN = 2000, K_MAX = 25000
const XYZ_TO_SRGB: M3 = [3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252]
const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
export const SRGB_INFO: ColorInfo = { camXyz: XYZ_TO_SRGB, rgbCam: I3, mul: [1, 1, 1], raw: false }

const mul3 = (a: M3, b: M3): M3 => { const o = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]; return o }
const apply3 = (m: M3, v: number[]) => [0, 1, 2].map(r => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2])
function inv3(m: M3): M3 | null {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(x => x / det)
}

/* Planckian locus in CIE 1931 xy (Kim et al. cubic spline, 1667-25000 K) */
function planckXY(T: number) {
  T = Math.min(25000, Math.max(1667, T)); const t = 1e3 / T, t2 = t * t, t3 = t2 * t
  const x = T <= 4000 ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.179910 : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390
  const y = T <= 2222 ? -1.1063814 * x ** 3 - 1.34811020 * x * x + 2.18555832 * x - 0.20219683
    : T <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x * x + 2.09137015 * x - 0.16748867
    : 3.0817580 * x ** 3 - 5.87338670 * x * x + 3.75112997 * x - 0.37001483
  return [x, y]
}
const xyToUv = ([x, y]: number[]) => { const d = -2 * x + 12 * y + 3; return [4 * x / d, 6 * y / d] }
const uvToXy = ([u, v]: number[]) => { const d = 2 * u - 8 * v + 4; return [3 * u / d, 2 * v / d] }

/* XYZ (Y = 1) of the light at temperature T with a tint off the black-body curve; +tint is magenta (below the locus) */
function lightXYZ(T: number, tint: number) {
  const uv = xyToUv(planckXY(T)), uv2 = xyToUv(planckXY(1e6 / (1e6 / T - 1)))   // one mired warmer
  let nx = -(uv2[1] - uv[1]), ny = uv2[0] - uv[0]; const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len
  if (ny < 0) { nx = -nx; ny = -ny }                                                // normal pointing to green (+v)
  const duv = -tint / 3000, [x, y] = uvToXy([uv[0] + nx * duv, uv[1] + ny * duv])
  return [x / y, 1, (1 - x - y) / y]
}
/* white balance multipliers (green = 1) that make the given light neutral for this camera */
function mulFor(info: ColorInfo, T: number, tint: number) {
  const n = apply3(info.camXyz, lightXYZ(T, tint)); return [n[1] / n[0], 1, n[1] / n[2]]
}
/* the temperature and tint whose neutral matches the given multipliers (coarse grid, then refine) */
function solve(info: ColorInfo, target: number[]) {
  const lt = [Math.log(target[0] / target[1]), Math.log(target[2] / target[1])]
  const err = (m: number, t: number) => { const k = mulFor(info, 1e6 / m, t); return (Math.log(k[0]) - lt[0]) ** 2 + (Math.log(k[2]) - lt[1]) ** 2 }
  let best = { m: 150, t: 0, e: Infinity }
  for (let m = 40; m <= 600; m += 4) for (let t = -200; t <= 200; t += 5) { const e = err(m, t); if (e < best.e) best = { m, t, e } }
  for (const [dm, dt] of [[2, 2.5], [0.5, 0.5], [0.1, 0.1]]) {
    const c = best
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { const m = c.m + i * dm, t = c.t + j * dt; if (m < 40 || m > 600) continue; const e = err(m, t); if (e < best.e) best = { m, t, e } }
  }
  return { mired: best.m, tint: best.t }
}

/* camera colour data from LibRaw metadata, or null when it is missing or unusable */
export function colorInfoFromLibRaw(cd: any): ColorInfo | null {
  try {
    if (!cd?.cam_mul || !cd?.rgb_cam || !cd?.cam_xyz) return null
    const mul = [cd.cam_mul[0], cd.cam_mul[1], cd.cam_mul[2]]
    const camXyz = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => +cd.cam_xyz[r][c]))
    const rgbCam = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => +cd.rgb_cam[r][c]))
    if (![...mul, ...camXyz, ...rgbCam].every(Number.isFinite) || mul.some(x => x <= 0) || camXyz.every(x => x === 0) || !inv3(rgbCam)) return null
    return { camXyz, rgbCam, mul: [mul[0] / mul[1], 1, mul[2] / mul[1]], raw: true }
  } catch { return null }
}

const shotCache = new WeakMap<ColorInfo, WbState>()
export function asShot(info: ColorInfo): WbState {
  let s = shotCache.get(info); if (!s) { s = { info, ...solve(info, info.mul) }; shotCache.set(info, s) }
  return s
}
export const SRGB_SHOT = asShot(SRGB_INFO)

const clampMired = (m: number) => Math.min(1e6 / K_MIN, Math.max(1e6 / K_MAX, m))
/* absolute temperature and tint for a relative setting */
export function absolute(shot: WbState, temp: number, tint: number) { return { kelvin: 1e6 / clampMired(shot.mired - temp), tint: shot.tint + tint } }
/* relative setting for an absolute temperature / tint */
export const tempForKelvin = (shot: WbState, K: number) => shot.mired - clampMired(1e6 / K)
export const tintFor = (shot: WbState, abs: number) => abs - shot.tint

/* 3x3 matrix (row-major) to apply to the decoded linear-sRGB data, normalised so neutral brightness stays put */
export function wbMatrix(shot: WbState, temp: number, tint: number, extra: number[] = [1, 1, 1]): M3 {
  const { kelvin, tint: t } = absolute(shot, temp, tint), info = shot.info, k = mulFor(info, kelvin, t).map((x, i) => x / info.mul[i])
  const inv = inv3(info.rgbCam) || I3
  let m = mul3(mul3(info.rgbCam, [k[0], 0, 0, 0, k[1], 0, 0, 0, k[2]]), inv)
  m = mul3([extra[0], 0, 0, 0, extra[1], 0, 0, 0, extra[2]], m)
  const w = apply3(m, [1, 1, 1]), nl = 0.2126 * w[0] + 0.7152 * w[1] + 0.0722 * w[2]
  return m.map(x => x / nl)
}

/* the relative setting that makes a sampled linear-sRGB colour (as decoded) neutral */
export function neutralise(shot: WbState, rgb: number[], extra: number[] = [1, 1, 1]) {
  const info = shot.info, inv = inv3(info.rgbCam) || I3
  const cam = apply3(inv, rgb.map((x, i) => x * extra[i]))
  if (cam.some(x => !(x > 0))) return null
  const target = [info.mul[0] * cam[1] / cam[0], 1, info.mul[2] * cam[1] / cam[2]]
  const s = solve(info, target)
  return { temp: shot.mired - s.mired, tint: s.tint - shot.tint }
}

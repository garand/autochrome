/* ============================================================ helpers */
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const el = (tag: string, props: any = {}, ...kids: any[]) => { const e = document.createElement(tag); for (const k in props) { const v = props[k]; if (v == null) continue; if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v; else if (k === 'data') Object.assign(e.dataset, v); else e[k] = v; } for (const c of kids.flat()) if (c != null) e.append(c); return e; };
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const eq = (a, b) => a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));
export const clone = o => JSON.parse(JSON.stringify(o));
export const b64ToBytes = s => { const bin = atob(s.trim()), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export const half2f = h => { const e = (h >> 10) & 31, m = h & 1023; return e === 0 ? m * 2 ** -24 : 2 ** (e - 15) * (1 + m / 1024); };
export function rgb2hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 1e-9) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; } return [h, mx <= 0 ? 0 : d / mx, mx]; }
export function hsv2rgb(h, s, v) { const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }
export const RAW_EXT = ['nef', 'nrw', 'cr2', 'cr3', 'crw', 'arw', 'srf', 'sr2', 'raf', 'dng', 'orf', 'rw2', 'pef', 'srw', 'x3f', 'erf', 'kdc', 'dcr', 'mrw', '3fr', 'iiq', 'rwl', 'mef', 'mos', 'gpr'];
export const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp'];
export const extOf = n => (n.split('.').pop() || '').toLowerCase();
export const stem = n => n.replace(/\.[^.]+$/, '');

/* 3x3 affine matrices, row-major */
export const mmul = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
export const minv = m => { const [a, b, c, d, e, f] = m, det = a * e - b * d; return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det, 0, 0, 1]; };
export const mapply = (m, x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
export const mgl = m => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
export const ORIENT = [[1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 1, 0, -1, 0, 1, 0, 0, 1], [-1, 0, 1, 0, -1, 1, 0, 0, 1], [0, -1, 1, 1, 0, 0, 0, 0, 1]];
export const FLIP = [-1, 0, 1, 0, 1, 0, 0, 0, 1];
export const FULL = { cx: 0.5, cy: 0.5, w: 1, h: 1, angle: 0 };
/* output uv -> crop frame ("virtual" = after 90deg turns / flip) uv. g is a crop rect + straighten angle, W,H the virtual size */
export function cropMatrix(g, W, H) {
  const th = (g.angle || 0) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), Ox = W / 2, Oy = H / 2;
  const a1 = g.w * W, a0 = g.cx * W - Ox - 0.5 * a1, b1 = g.h * H, b0 = g.cy * H - Oy - 0.5 * b1;
  return [c * a1 / W, s * b1 / W, (Ox + c * a0 + s * b0) / W, -s * a1 / H, c * b1 / H, (Oy - s * a0 + c * b0) / H, 0, 0, 1];
}
/* output uv -> real image uv */
export function texMatrix(g, W, H, o) { let m = cropMatrix(g, W, H); if (o && o.flip) m = mmul(FLIP, m); return mmul(ORIENT[o ? o.rot & 3 : 0], m); }
export function cropValid(g, W, H) { const m = cropMatrix(g, W, H), e = 1e-4; for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const [x, y] = mapply(m, u, v); if (x < -e || y < -e || x > 1 + e || y > 1 + e) return false; } return true; }
export function fixCrop(g, W, H) { g.w = clamp(g.w, 0.03, 1); g.h = clamp(g.h, 0.03, 1); if (!g.angle) { g.cx = clamp(g.cx, g.w / 2, 1 - g.w / 2); g.cy = clamp(g.cy, g.h / 2, 1 - g.h / 2); return g; } for (let i = 0; i < 500 && !cropValid(g, W, H); i++) { g.w *= 0.99; g.h *= 0.99; g.cx += (0.5 - g.cx) * 0.02; g.cy += (0.5 - g.cy) * 0.02; } return g; }

/* ============================================================ settings model */
export const HSL = [['red', 0, 22, '#e5484d'], ['orange', 30, 16, '#f08c2e'], ['yellow', 58, 18, '#f2d43d'], ['green', 115, 40, '#46a758'], ['aqua', 180, 28, '#3cc8c8'], ['blue', 235, 32, '#3e7bfa'], ['purple', 280, 24, '#8e4ec6'], ['magenta', 325, 24, '#d6409f']];
export const ID_CURVE = [[0, 0], [1, 1]];
export const DEF = {
  look: 'none', lookAmount: 100, bw: 0,
  temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
  curve: { m: ID_CURVE, r: ID_CURVE, g: ID_CURVE, b: ID_CURVE },
  gShHue: 0, gShSat: 0, gMidHue: 0, gMidSat: 0, gHiHue: 0, gHiSat: 0, gBalance: 0,
  sharpen: 25, nrLuma: 0, nrColor: 0, vignette: 0, grain: 0, fade: 0, faceLight: 0, skinProtect: 50,
};
for (const [n] of HSL) { DEF['h_' + n] = 0; DEF['s_' + n] = 0; DEF['l_' + n] = 0; }
export const KEYS = {
  look: ['look', 'lookAmount'],
  basic: ['bw', 'temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation'],
  curve: ['curve'], mixer: HSL.flatMap(([n]) => ['h_' + n, 's_' + n, 'l_' + n]),
  grade: ['gShHue', 'gShSat', 'gMidHue', 'gMidSat', 'gHiHue', 'gHiSat', 'gBalance'],
  detail: ['sharpen', 'nrLuma', 'nrColor'], effects: ['vignette', 'grain', 'fade'], faces: ['faceLight', 'skinProtect'],
};
export const MASK_ADJ = { exposure: 0, contrast: 0, saturation: 0, temp: 0, tint: 0 };
export const PRESETS = {
  'Neutral': {},
  'Warm fall pop': { look: 'fallpop', contrast: 14, shadows: 14, vibrance: 8, faceLight: 30, skinProtect: 75, vignette: 22, temp: 4 },
  'Dark & moody': { look: 'moody', exposure: -0.25, contrast: 18, shadows: -6, fade: 10, vignette: 34, faceLight: 25, skinProtect: 70 },
  'Bright & airy': { look: 'airy', exposure: 0.25, contrast: -6, highlights: -25, shadows: 30, vignette: -8 },
  'Classic film': { look: 'portra', grain: 28, fade: 6, vignette: 12 },
  'Soft matte': { look: 'matte', contrast: -8, clarity: -10, vignette: 10 },
  'Punchy colour': { look: 'ektar', contrast: 10, clarity: 12, vibrance: 15 },
  'Timeless B&W': { look: 'trix', grain: 35, vignette: 18, clarity: 10 },
};
export const LABELS = [null, '#e5484d', '#f2d43d', '#46a758', '#3e7bfa'];

/* ============================================================ tone curve (monotone cubic) */
export function curveLut(pts, n = 256) {
  const out = new Float32Array(n), P = [...pts].sort((a, b) => a[0] - b[0]), k = P.length;
  if (k < 2) { for (let i = 0; i < n; i++) out[i] = i / (n - 1); return out; }
  const d: number[] = [], m = new Array(k);
  for (let i = 0; i < k - 1; i++) d.push((P[i + 1][1] - P[i][1]) / Math.max(1e-6, P[i + 1][0] - P[i][0]));
  m[0] = d[0]; m[k - 1] = d[k - 2];
  for (let i = 1; i < k - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < k - 1; i++) { if (Math.abs(d[i]) < 1e-9) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1); if (x <= P[0][0]) { out[i] = P[0][1]; continue; } if (x >= P[k - 1][0]) { out[i] = P[k - 1][1]; continue; }
    while (j < k - 2 && x > P[j + 1][0]) j++;
    const h = P[j + 1][0] - P[j][0], t = (x - P[j][0]) / h, t2 = t * t, t3 = t2 * t;
    out[i] = clamp((2 * t3 - 3 * t2 + 1) * P[j][1] + (t3 - 2 * t2 + t) * h * m[j] + (-2 * t3 + 3 * t2) * P[j + 1][1] + (t3 - t2) * h * m[j + 1]);
  }
  return out;
}
export const curveIsId = c => !c || ['m', 'r', 'g', 'b'].every(k => eq(c[k], ID_CURVE));

/* ============================================================ film looks (procedural 3D LUTs) */
import { LOOK_DEFS } from './looks'
export const LOOKS: any[] = LOOK_DEFS as any[];
export const LUT_N = 33;
export function buildLut(p) {
  const N = LUT_N, out = new Uint8Array(N * N * N * 3), S = p.sh || [0, 0, 0], H = p.hi || [0, 0, 0];
  const tone = x => { x = Math.pow(clamp(x), p.mid || 1); x -= (p.contrast || 0) * Math.sin(2 * Math.PI * x) / (2 * Math.PI); const lo = p.lift || 0, hi = 1 - (p.roll || 0); return lo + (hi - lo) * x; };
  let o = 0;
  for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
    let r = ri / (N - 1), g = gi / (N - 1), b = bi / (N - 1);
    if (p.bw) { const y = r * p.bw[0] + g * p.bw[1] + b * p.bw[2]; r = g = b = y; }
    else if (p.hues || p.sat != null) {
      let [h, s, v] = rgb2hsv(r, g, b), dh = 0, ds = 0, dl = 0;
      for (const q of p.hues || []) { const d = Math.abs(((h * 360 - q.c + 540) % 360) - 180), w = Math.exp(-(d * d) / (q.w * q.w)); dh += (q.dh || 0) * w; ds += (q.ds || 0) * w; dl += (q.dl || 0) * w; }
      const sw = smooth(0.03, 0.2, s); h = (h + dh * sw / 360 + 1) % 1; s = clamp(s * (1 + ds * sw) * (p.sat ?? 1)); v = clamp(v * (1 + dl * sw * s));
      [r, g, b] = hsv2rgb(h, s, v);
    }
    if (p.bleach) { const yb = 0.2126 * r + 0.7152 * g + 0.0722 * b; r += (yb - r) * p.bleach; g += (yb - g) * p.bleach; b += (yb - b) * p.bleach; }
    if (p.chGamma) { r = Math.pow(r, p.chGamma[0]); g = Math.pow(g, p.chGamma[1]); b = Math.pow(b, p.chGamma[2]); }
    r = tone(r); g = tone(g); b = tone(b);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b, sh = Math.pow(clamp((0.45 - y) / 0.45), 1.3), hi = Math.pow(clamp((y - 0.5) * 2), 1.3);
    out[o++] = 255 * clamp(r + S[0] * sh + H[0] * hi) + 0.5; out[o++] = 255 * clamp(g + S[1] * sh + H[1] * hi) + 0.5; out[o++] = 255 * clamp(b + S[2] * sh + H[2] * hi) + 0.5;
  }
  return { n: N, data: out };
}
export function parseCube(text) {
  let n = 0; const vals: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim(); if (!t || t[0] === '#') continue;
    if (/^LUT_3D_SIZE/i.test(t)) { n = parseInt(t.split(/\s+/)[1]); continue; }
    if (/^[A-Za-z_]/.test(t)) continue;
    const a = t.split(/\s+/).map(Number); if (a.length >= 3 && a.every(x => !isNaN(x))) vals.push(a[0], a[1], a[2]);
  }
  if (!n || vals.length < n * n * n * 3) throw new Error('Not a valid 3D .cube file');
  const data = new Uint8Array(n * n * n * 3); for (let i = 0; i < data.length; i++) data[i] = 255 * clamp(vals[i]) + 0.5;
  return { n, data };
}
export const lutCache = new Map();
export const getLut = id => { if (!lutCache.has(id)) { const L = LOOKS.find(l => l.id === id); lutCache.set(id, L && L.p ? buildLut(L.p) : L && L.lut ? L.lut : null); } return lutCache.get(id); };

/* ============================================================ icons (16px stroke) */
export const ICONS = {
  folder: 'M1.5 4.5v8h13v-7h-6l-1.5-2h-5.5z', plus: 'M8 3v10M3 8h10', undo: 'M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8h-3', redo: 'M10.5 3.5l3 3-3 3M13.5 6.5h-7a4 4 0 0 0 0 8h3',
  hand: 'M5.5 8V3.5a1 1 0 0 1 2 0V7m0-4.5a1 1 0 0 1 2 0V7m0-3.5a1 1 0 0 1 2 0V8m0-2.5a1 1 0 0 1 2 0v4.5a4.5 4.5 0 0 1-9 0V8.5l-1.6-1.3a1 1 0 0 1 1.3-1.5l1.3 1.3',
  crop: 'M4 1v11h11M1 4h11v11', dropper: 'M10.5 2.2a1.8 1.8 0 0 1 3.3 1.3c-.2.8-1 1.3-1.8 2l1 1-1 1-1-1-5.5 5.5-2.5.5.5-2.5L9 4.5l-1-1 1-1 1 1c.2-.4.3-.9.5-1.3z',
  linear: 'M2 2.5h12v11H2zM2 6h12M2 9h12', radial: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  flag: 'M3.5 14V2.5h8l-1.5 3 1.5 3h-8', reject: 'M4 4l8 8M12 4l-8 8', star: 'M8 1.8l1.9 4 4.3.5-3.2 3 .9 4.3L8 11.4l-3.9 2.2.9-4.3-3.2-3 4.3-.5z',
  grid: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z', compare: 'M8 1.5v13M2 3.5h4.5v9H2zM9.5 3.5H14v9H9.5', clip: 'M8 2 14.5 13.5h-13zM8 6.5v3.5M8 11.8v.4',
  reset: 'M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.5h2.5', eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z', eyeoff: 'M2 2l12 12M4.2 4.9C2.5 6.1 1.5 8 1.5 8S4 12.5 8 12.5c1.2 0 2.3-.4 3.2-.9M6.6 3.7c.4-.1.9-.2 1.4-.2 4 0 6.5 4.5 6.5 4.5s-.6 1.100-1.700 2.200',
  trash: 'M2.5 4.500h11M6 4.500v-2h4v2M4 4.500l.5 9h7l.5-9', rotl: 'M3 6.500h6.500a3.500 3.500 0 0 1 0 7H7M3 6.500l2.500-2.500M3 6.500 5.500 9', rotr: 'M13 6.500H6.500a3.500 3.500 0 0 0 0 7H9M13 6.500l-2.500-2.500M13 6.500 10.500 9', flip: 'M8 1.500v13M6 4 2 12h4zM10 4l4 8h-4z',
  export: 'M8 10V2M5 4.500l3-3 3 3M2.500 9.500v4h11v-4', help: 'M6 6.200a2 2 0 1 1 3 1.700c-.6.4-1 .8-1 1.600M8 11.800v.4M8 1.500a6.500 6.500 0 1 0 0 13 6.500 6.500 0 0 0 0-13z', panels: 'M1.500 2.500h13v11h-13zM5 2.500v11M11 2.500v11',
  chevron: 'M4 6l4 4 4-4', copy: 'M5.500 5.500h8v8h-8zM2.500 10.500v-8h8', check: 'M3 8.500l3.500 3.500 6.500-7.500',
};
export const icon = n => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[n]}"/></svg>`;

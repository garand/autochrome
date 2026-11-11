/* Decode worker: LibRaw (WebAssembly) -> linear 16-bit RGB, plus metering, face detection, per-face
   focus scores and face crops for the culling pass, thumbnails and a mid-size proxy. */
// @ts-ignore - no types shipped for the bare factory
import factory from 'libraw-wasm-nothread/dist/libraw.js'
import { unpackCascade, runCascade, clusterDetections } from './pico'
import { colorInfoFromLibRaw } from './wb'
let lr: any = null, classify: any = null
const HALF = new Uint16Array(65536); // linear uint16 (0..65535 => 0..1) -> IEEE half-float bits
(() => {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (let i = 1; i < 65536; i++) {
    f[0] = i / 65535; const x = u[0];
    const e = ((x >> 23) & 0xff) - 127 + 15, M = (x & 0x7fffff) | 0x800000;
    HALF[i] = e <= 0 ? (14 - e > 24 ? 0 : M >> (14 - e)) : (e << 10) | ((x >> 13) & 0x3ff);
  }
})();
const SRGB2LIN = new Uint16Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; SRGB2LIN[i] = Math.round(65535 * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); }

async function init(msg: any) {
  const mod = await (factory as any)({
    instantiateWasm(imports: any, done: any) { WebAssembly.instantiate(msg.wasm, imports).then((r: any) => done(r.instance, r.module)); return {} },
    print() {}, printErr() {},
  })
  lr = new mod.LibRaw()
  classify = unpackCascade(new Int8Array(msg.cascade))
}

/* box downsample linear RGB16 to long edge <= target. returns {w,h,data:Float32Array rgb} */
function downsample(src, w, h, target) {
  const s = Math.max(1, Math.ceil(Math.max(w, h) / target));
  const tw = Math.floor(w / s), th = Math.floor(h / s), out = new Float32Array(tw * th * 3), n = s * s;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let r = 0, g = 0, b = 0;
    for (let yy = 0; yy < s; yy++) { let i = ((y * s + yy) * w + x * s) * 3; for (let xx = 0; xx < s; xx++, i += 3) { r += src[i]; g += src[i + 1]; b += src[i + 2]; } }
    const o = (y * tw + x) * 3; out[o] = r / n / 65535; out[o + 1] = g / n / 65535; out[o + 2] = b / n / 65535;
  }
  return { w: tw, h: th, data: out };
}
function resizeF(img, target) { // further box-reduce a Float32 rgb image
  const s = Math.max(1, Math.round(Math.max(img.w, img.h) / target));
  if (s === 1) return img;
  const tw = Math.floor(img.w / s), th = Math.floor(img.h / s), out = new Float32Array(tw * th * 3), n = s * s;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let r = 0, g = 0, b = 0;
    for (let yy = 0; yy < s; yy++) { let i = ((y * s + yy) * img.w + x * s) * 3; for (let xx = 0; xx < s; xx++, i += 3) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; } }
    const o = (y * tw + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return { w: tw, h: th, data: out };
}
function blur1(a, w, h, sigma) { // separable gaussian on Float32 single channel
  const r = Math.max(1, Math.ceil(sigma * 2.5)), k = new Float32Array(2 * r + 1); let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); s += a[y * w + xx] * k[i + r]; } t[y * w + x] = s; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); s += t[yy * w + x] * k[i + r]; } o[y * w + x] = s; }
  return o;
}
function lumaMap(img, target, sigma) { // blurred luminance, half-float encoded
  const sm = resizeF(img, target), n = sm.w * sm.h, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.2126 * sm.data[i * 3] + 0.7152 * sm.data[i * 3 + 1] + 0.0722 * sm.data[i * 3 + 2];
  const B = blur1(L, sm.w, sm.h, sigma), out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = HALF[Math.min(65535, Math.max(0, Math.round(B[i] * 65535)))];
  return { w: sm.w, h: sm.h, data: out };
}
function toHalf(img) { const out = new Uint16Array(img.data.length); for (let i = 0; i < out.length; i++) out[i] = HALF[Math.min(65535, Math.max(0, Math.round(img.data[i] * 65535)))]; return out; }
function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]; }

/* Metering: what made the biggest difference on a real shoot was exposing and white-balancing
   for the faces, then guarding the scene so it can't go too dark or blow out. */
function analyse(med: any) {
  const stats: any = {}; // med: ~640px linear Float32 rgb
  const { w, h, data } = med, n = w * h;
  const Y = new Float32Array(n); let geo = 0, wsum = 0;
  for (let i = 0; i < n; i++) {
    const y = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]; Y[i] = y;
    const px = (i % w) / w - 0.5, py = Math.floor(i / w) / h - 0.5, cw = Math.exp(-(px * px + py * py) * 5);
    geo += Math.log(y + 1e-5) * cw; wsum += cw;
  }
  const sorted = Float32Array.from(Y).sort();
  Object.assign(stats, { median: pct(sorted, 0.5), p01: pct(sorted, 0.01), p99: pct(sorted, 0.99), p999: pct(sorted, 0.999), geo: Math.exp(geo / wsum), faces: [] });
  // face detection on an auto-levelled, gamma-encoded grey image
  const hi = Math.max(stats.p99, 1e-4), grey = new Uint8Array(n);
  // a cube-root curve keeps dark, backlit faces from collapsing into a few grey levels
  for (let i = 0; i < n; i++) grey[i] = Math.min(255, 255 * Math.cbrt(Math.min(1, Y[i] / hi)));
  // a fine scan (5% scale steps, 5% shifts): true faces then score in the hundreds once clustered, while
  // foliage and texture stay well under 45 (measured on the sample set), so the cut-off can be generous
  let dets = runCascade({ pixels: grey, nrows: h, ncols: w, ldim: w }, classify, { shiftfactor: 0.05, minsize: Math.max(20, Math.round(Math.max(w, h) * 0.03)), maxsize: Math.round(Math.min(w, h) * 0.95), scalefactor: 1.05 });
  dets = clusterDetections(dets, 0.2).filter(d => d[3] > 45).sort((a, b) => b[3] - a[3]).slice(0, 12);
  const skin: number[][] = [];
  for (const [r, c, s, q] of dets) {
    // sample the central part of the face box, keep the mid-bright pixels (skips hair, glasses, shadow)
    const x0 = Math.max(0, Math.round(c - s * 0.3)), x1 = Math.min(w, Math.round(c + s * 0.3)), y0 = Math.max(0, Math.round(r - s * 0.25)), y1 = Math.min(h, Math.round(r + s * 0.32));
    const px: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.push(y * w + x);
    if (px.length < 12) continue;
    px.sort((a, b) => Y[a] - Y[b]);
    const sel = px.slice(Math.floor(px.length * 0.4), Math.floor(px.length * 0.92));
    const med3 = ch => { const v = sel.map(i => data[i * 3 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const R = med3(0), G = med3(1), B = med3(2);
    // reject detections that clearly aren't skin (foliage / sky false positives)
    if (!(R > G * 0.95 && G > B * 0.55 && R / Math.max(G, 1e-5) < 3.2)) continue;
    stats.faces.push({ x: c / w, y: r / h, s: s / Math.max(w, h), q, sx: s / w, sy: s / h });
    skin.push([R, G, B]);
  }
  if (skin.length) {
    const m = ch => { const v = skin.map(s => s[ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const R = m(0), G = m(1), B = m(2);
    stats.skin = { y: 0.2126 * R + 0.7152 * G + 0.0722 * B, rg: R / G, bg: B / G, max: Math.max(...skin.map(s => 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2])) };
  }
  return stats;
}

/* Per-face culling data from the half-size raw: a focus score (variance of the Laplacian on the face,
   exposure-normalised) and a small sRGB crop that the main thread runs landmark analysis on. */
function faceData(px: Uint16Array, w: number, h: number, f: any) {
  const cx = f.x * w, cy = f.y * h, size = f.sx * w
  const lum = (x: number, y: number) => { const i = (Math.min(h - 1, Math.max(0, y | 0)) * w + Math.min(w - 1, Math.max(0, x | 0))) * 3; return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] }
  // focus: central 62% of the face box at native half-res (subsampled only when the face is huge)
  const reg = size * 0.62, st = Math.max(1, Math.ceil(reg / 320)), n = Math.max(8, Math.floor(reg / st)), L = new Float32Array(n * n)
  const x0 = cx - reg / 2, y0 = cy - reg * 0.45; let hi = 1
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = lum(x0 + i * st, y0 + j * st); L[j * n + i] = v; if (v > hi) hi = v }
  const srt = Float32Array.from(L).sort(), p95 = Math.max(1, srt[Math.floor(srt.length * 0.95)])
  for (let i = 0; i < L.length; i++) L[i] = Math.sqrt(Math.min(1, L[i] / p95))
  let s1 = 0, s2 = 0, m = 0
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const k = j * n + i, d = 4 * L[k] - L[k - 1] - L[k + 1] - L[k - n] - L[k + n]; s1 += d; s2 += d * d; m++ }
  f.sharp = Math.round((s2 / m - (s1 / m) ** 2) * 1e5) / 10; f.px = Math.round(size)
  // crop for landmarks: 2x the face box -> 192px sRGB
  const N = 192, side = size * 2, k = Math.max(1, Math.floor(side / N)), out = new Uint8ClampedArray(N * N * 4), g = 0.9 / p95
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const sx = cx - side / 2 + (i + 0.5) * side / N, sy = cy - side * 0.5 + (j + 0.5) * side / N; let r = 0, gg = 0, b = 0
    for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) { const q = (Math.min(h - 1, Math.max(0, (sy + a) | 0)) * w + Math.min(w - 1, Math.max(0, (sx + c) | 0))) * 3; r += px[q]; gg += px[q + 1]; b += px[q + 2] }
    const o = (j * N + i) * 4, kk = k * k; out[o] = 255 * Math.pow(Math.min(1, r / kk * g), 1 / 2.2); out[o + 1] = 255 * Math.pow(Math.min(1, gg / kk * g), 1 / 2.2); out[o + 2] = 255 * Math.pow(Math.min(1, b / kk * g), 1 / 2.2); out[o + 3] = 255
  }
  return out
}

/* A tight, evenly exposed face crop for the face sheet: about 1.45x the face box, 224px, sRGB, as a small JPEG.
   Each face is brightened to the same level so eyes and focus are easy to judge even in backlit frames. */
const SHOT = 224
async function faceShot(px: Uint16Array, w: number, h: number, f: any): Promise<Blob | null> {
  const size = f.sx * w * 1.45, cx = f.x * w, cy = f.y * h - f.sx * w * 0.04, k = size / SHOT, buf = new Float32Array(SHOT * SHOT * 3), lums: number[] = []
  for (let j = 0; j < SHOT; j++) for (let i = 0; i < SHOT; i++) {
    let r = 0, g = 0, b = 0, n = 0; const sx = cx - size / 2 + i * k, sy = cy - size / 2 + j * k, st = Math.max(1, Math.round(k / 2))
    for (let a = 0; a < k; a += st) for (let c = 0; c < k; c += st) { const x = Math.min(w - 1, Math.max(0, (sx + c) | 0)), y = Math.min(h - 1, Math.max(0, (sy + a) | 0)), q = (y * w + x) * 3; r += px[q]; g += px[q + 1]; b += px[q + 2]; n++ }
    const o = (j * SHOT + i) * 3; buf[o] = r / n; buf[o + 1] = g / n; buf[o + 2] = b / n
    if (Math.abs(i - SHOT / 2) < SHOT * 0.22 && Math.abs(j - SHOT / 2) < SHOT * 0.22) lums.push(0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2])
  }
  lums.sort((a, b) => a - b); const mid = lums[lums.length >> 1] || 1, gain = Math.min(40, Math.max(0.3, 0.32 / (mid / 65535)))
  const out = new Uint8ClampedArray(SHOT * SHOT * 4), enc = (v: number) => { v = v / 65535 * gain; v = v / (1 + v * 0.35); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) }
  for (let i = 0, o = 0; i < buf.length; i += 3, o += 4) { out[o] = enc(buf[i]); out[o + 1] = enc(buf[i + 1]); out[o + 2] = enc(buf[i + 2]); out[o + 3] = 255 }
  try { const cv = new OffscreenCanvas(SHOT, SHOT); cv.getContext('2d')!.putImageData(new ImageData(out, SHOT, SHOT), 0, 0); return await cv.convertToBlob({ type: 'image/jpeg', quality: 0.82 }) } catch { return null }
}

/* capture time from a JPEG's EXIF (DateTimeOriginal + SubSecTimeOriginal), in seconds, so JPEG bursts group too */
function exifTime(buf: ArrayBuffer): number | undefined {
  try {
    const d = new DataView(buf); if (d.getUint16(0) !== 0xffd8) return
    let o = 2
    while (o + 4 < d.byteLength) {
      const m = d.getUint16(o), len = d.getUint16(o + 2)
      if (m === 0xffe1 && d.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = d.getUint16(t) === 0x4949, u16 = (p: number) => d.getUint16(t + p, le), u32 = (p: number) => d.getUint32(t + p, le)
        const str = (p: number, n: number) => { let s = ''; for (let i = 0; i < n; i++) { const c = d.getUint8(t + p + i); if (!c) break; s += String.fromCharCode(c) } return s }
        const tag = (ifd: number, id: number) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === id) return { cnt: u32(e + 4), val: e + 8 } } }
        const ex = tag(u32(4), 0x8769); if (!ex) return
        const exif = u32(ex.val), dt = tag(exif, 0x9003); if (!dt) return
        const m2 = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(str(u32(dt.val), dt.cnt)); if (!m2) return
        const ss = tag(exif, 0x9291), sub = ss ? parseFloat('0.' + str(ss.cnt <= 4 ? ss.val : u32(ss.val), ss.cnt).replace(/\D/g, '')) || 0 : 0   // ASCII up to 4 bytes is stored inline
        return new Date(+m2[1], +m2[2] - 1, +m2[3], +m2[4], +m2[5], +m2[6]).getTime() / 1000 + sub
      }
      if ((m & 0xff00) !== 0xff00 || m === 0xffda) return
      o += 2 + len
    }
  } catch { return }
}

async function decode(job: any) {
  let w: number, h: number, px: Uint16Array, meta: any = {};
  if (job.kind === 'raw') {
    lr.open(new Uint8Array(job.buf), { halfSize: !!job.half, useCameraWb: true, noAutoBright: true, outputBps: 16, outputColor: 1, gamm: [1, 1, 0, 0, 0, 0], highlight: 2, adjustMaximumThr: 0.75, bright: 1, userQual: job.half ? 0 : 3, fbddNoiserd: job.half ? 0 : 1 });
    const m = lr.metadata(true) || {};
    meta = { iso: m.iso_speed, shutter: m.shutter, aperture: m.aperture, focal: m.focal_len, make: m.camera_make || m.make, model: m.camera_model || m.model, time: m.timestamp, color: colorInfoFromLibRaw(m.color_data) };
    const img = lr.imageData();
    if (!img || !img.data) throw new Error('LibRaw could not decode this file');
    w = img.width; h = img.height;
    px = img.data instanceof Uint16Array ? img.data : new Uint16Array(img.data.buffer, img.data.byteOffset, img.data.byteLength >> 1);
    if (img.colors && img.colors !== 3) throw new Error('Unsupported channel count ' + img.colors);
  } else { // jpeg / png / webp etc: decode with the browser, linearise
    const time = exifTime(job.buf)
    const bmp = await createImageBitmap(new Blob([job.buf]));
    let bw = bmp.width, bh = bmp.height;
    if (job.half) { bw >>= 1; bh >>= 1; }
    const cv = new OffscreenCanvas(bw, bh), ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, bw, bh); bmp.close();
    const id = ctx.getImageData(0, 0, bw, bh).data; w = bw; h = bh; px = new Uint16Array(w * h * 3);
    // display-referred sources are scaled down 2 stops so they sit where raw data sits and share one pipeline
    for (let i = 0, o = 0; i < id.length; i += 4, o += 3) { px[o] = SRGB2LIN[id[i]] >> 2; px[o + 1] = SRGB2LIN[id[i + 1]] >> 2; px[o + 2] = SRGB2LIN[id[i + 2]] >> 2; }
    meta = { model: 'Image file', time };
  }
  const med = downsample(px, w, h, 800);
  const out: any = { w, h, meta, half: !!job.half };
  const transfer: any[] = [];
  if (job.want.stats) {
    out.stats = analyse(med);
    if (job.want.faces) { out.faceCrops = out.stats.faces.map((f) => faceData(px, w, h, f)); for (const c of out.faceCrops) transfer.push(c.buffer); }
    if (job.want.shots && out.stats.faces.length) out.faceShots = await Promise.all(out.stats.faces.map((f) => faceShot(px, w, h, f)));
  }
  if (job.want.mid) { out.mid = { w: med.w, h: med.h, data: toHalf(med), blur: lumaMap(med, 128, 3.5) }; transfer.push(out.mid.data.buffer, out.mid.blur.data.buffer); }
  if (job.want.thumb) {
    const t = resizeF(med, 288); out.thumb = { w: t.w, h: t.h, data: toHalf(t) }; out.thumbBlur = lumaMap(med, 40, 1.2);
    transfer.push(out.thumb.data.buffer, out.thumbBlur.data.buffer);
  }
  if (job.want.pixels) {
    out.blur = lumaMap(med, 256, 7); transfer.push(out.blur.data.buffer);
    if (px.buffer.byteLength !== px.byteLength) px = px.slice();   // a view into a bigger buffer: copy so it can be transferred
    for (let i = 0; i < px.length; i++) px[i] = HALF[px[i]];       // in place -> half floats
    out.pixels = px; transfer.push(px.buffer);
  }
  return [out, transfer];
}

async function thumbnail(job: any) { // embedded preview via LibRaw (fallback when the TIFF scan finds nothing)
  lr.open(new Uint8Array(job.buf), { halfSize: true });
  const t = lr.thumbnailData();
  if (!t || !t.data) throw new Error('no embedded preview');
  const data = new Uint8Array(t.data); return [{ format: t.format, w: t.width, h: t.height, data }, [data.buffer]];
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'init') { await init(m); self.postMessage({ id: m.id, ok: true }); return; }
    const [out, transfer] = m.type === 'thumb' ? await thumbnail(m) : await decode(m);
    (self as any).postMessage({ id: m.id, ok: true, out }, transfer);
  } catch (err: any) { self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
};

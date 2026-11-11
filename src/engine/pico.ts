/* pico.js face detector (https://github.com/nenadmarkus/picojs, MIT licence), ported to a typed module. */
export type Classifier = (r: number, c: number, s: number, pixels: Uint8Array, ldim: number) => number
export function unpackCascade(bytes: Int8Array): Classifier {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 8
  const tdepth = dv.getInt32(p, true); p += 4
  const ntrees = dv.getInt32(p, true); p += 4
  const leaves = 1 << tdepth, tcodes = new Int8Array(ntrees * 4 * leaves), tpreds = new Float32Array(ntrees * leaves), thresh = new Float32Array(ntrees)
  for (let t = 0; t < ntrees; t++) {
    tcodes.set(bytes.subarray(p, p + 4 * leaves - 4), t * 4 * leaves + 4); p += 4 * leaves - 4
    for (let i = 0; i < leaves; i++) { tpreds[t * leaves + i] = dv.getFloat32(p, true); p += 4 }
    thresh[t] = dv.getFloat32(p, true); p += 4
  }
  return (r, c, s, pixels, ldim) => {
    r = 256 * r; c = 256 * c
    let root = 0, o = 0
    for (let i = 0; i < ntrees; i++) {
      let idx = 1
      for (let j = 0; j < tdepth; j++) idx = 2 * idx + (pixels[((r + tcodes[root + 4 * idx] * s) >> 8) * ldim + ((c + tcodes[root + 4 * idx + 1] * s) >> 8)] <= pixels[((r + tcodes[root + 4 * idx + 2] * s) >> 8) * ldim + ((c + tcodes[root + 4 * idx + 3] * s) >> 8)] ? 1 : 0)
      o += tpreds[leaves * i + idx - leaves]
      if (o <= thresh[i]) return -1
      root += 4 * leaves
    }
    return o - thresh[ntrees - 1]
  }
}
export function runCascade(image: { pixels: Uint8Array; nrows: number; ncols: number; ldim: number }, classify: Classifier, params: { shiftfactor: number; minsize: number; maxsize: number; scalefactor: number }) {
  const dets: number[][] = []
  for (let scale = params.minsize; scale <= params.maxsize; scale *= params.scalefactor) {
    const step = Math.max(params.shiftfactor * scale, 1) >> 0, offset = (scale / 2 + 1) >> 0
    for (let r = offset; r <= image.nrows - offset; r += step) for (let c = offset; c <= image.ncols - offset; c += step) { const q = classify(r, c, scale, image.pixels, image.ldim); if (q > 0) dets.push([r, c, scale, q]) }
  }
  return dets
}
export function clusterDetections(dets: number[][], iouthreshold: number) {
  dets = dets.sort((a, b) => b[3] - a[3])
  const iou = (a: number[], b: number[]) => { const or = Math.max(0, Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2)), oc = Math.max(0, Math.min(a[1] + a[2] / 2, b[1] + b[2] / 2) - Math.max(a[1] - a[2] / 2, b[1] - b[2] / 2)); return or * oc / (a[2] * a[2] + b[2] * b[2] - or * oc) }
  const used = new Uint8Array(dets.length), out: number[][] = []
  for (let i = 0; i < dets.length; i++) {
    if (used[i]) continue
    let r = 0, c = 0, s = 0, q = 0, n = 0
    for (let j = i; j < dets.length; j++) if (iou(dets[i], dets[j]) > iouthreshold) { used[j] = 1; r += dets[j][0]; c += dets[j][1]; s += dets[j][2]; q += dets[j][3]; n++ }
    out.push([r / n, c / n, s / n, q])
  }
  return out
}

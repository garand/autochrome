/* Per-face culling analysis on the main thread using Human (face mesh + iris, models served from /models).
   Input: the 384px sRGB crops the decode worker cuts around each detected face (FACE_CROP there).
   Output per face: are the eyes open, is the head turned to the camera, is the gaze on the lens, plus an identity
   embedding (to follow one person through a shoot) and the lens measurements for the tinted-glasses fix. */
import { measureGlasses, packEmbedding, type Glasses } from './glasses'
export interface FaceCheck { found: boolean; open?: boolean; facing?: boolean; looking?: boolean; yaw?: number; pitch?: number; id?: string; gl?: Glasses | null }

let human: any = null, loading: Promise<any> | null = null, failed = false
async function load() {
  if (human || failed) return human
  if (!loading) loading = (async () => {
    const mod: any = await import('@vladmandic/human')
    const Human = mod.Human || mod.default
    const h = new Human({
      backend: 'webgl', modelBasePath: '/models/', cacheSensitivity: 0, debug: false, async: true, warmup: 'none',
      filter: { enabled: false },
      face: { enabled: true, detector: { rotation: false, maxDetected: 3, minConfidence: 0.2, return: false }, mesh: { enabled: true }, iris: { enabled: true }, attention: { enabled: false }, emotion: { enabled: false }, description: { enabled: true }, antispoof: { enabled: false }, liveness: { enabled: false } },
      body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: true }, segmentation: { enabled: false },
    })
    await h.load()
    human = h
    return h
  })().catch(e => { failed = true; console.warn('Face analysis unavailable:', e); return null })
  return loading
}
export const faceAnalysisFailed = () => failed

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
/* eye aspect ratio from the 468-point mesh: lid gap / eye width */
function eyeOpen(mesh: number[][], top: number, bottom: number, inner: number, outer: number) { return dist(mesh[top], mesh[bottom]) / Math.max(1e-6, dist(mesh[inner], mesh[outer])) }

export async function checkFaces(crops: Uint8ClampedArray[], size = 384): Promise<FaceCheck[]> {
  const h = await load(); const out: FaceCheck[] = []
  for (const c of crops) {
    if (!h) { out.push({ found: false }); continue }
    try {
      const res = await h.detect(new ImageData(new Uint8ClampedArray(c), size, size))
      // the crop is centred on one face, but a neighbour in a group can be bigger or more confident: take the one in the middle
      const mid = (b: number[]) => Math.hypot(b[0] + b[2] / 2 - size / 2, b[1] + b[3] / 2 - size / 2)
      const f = (res.face || []).filter((x: any) => x.box).sort((p: any, q: any) => mid(p.box) - mid(q.box))[0]
      if (!f || !f.mesh || f.mesh.length < 468) { out.push({ found: false }); continue }
      const earR = eyeOpen(f.mesh, 159, 145, 133, 33), earL = eyeOpen(f.mesh, 386, 374, 362, 263)
      const ang = f.rotation?.angle || { yaw: 0, pitch: 0 }, gaze = f.rotation?.gaze || { strength: 0 }
      const yaw = ang.yaw * 180 / Math.PI, pitch = ang.pitch * 180 / Math.PI
      const facing = Math.abs(yaw) < 28 && Math.abs(pitch) < 26
      let gl: Glasses | null = null; try { gl = measureGlasses(c, f.mesh, size) } catch (e) { console.warn('Glasses measurement failed', e) }
      out.push({ found: true, open: Math.min(earL, earR) > 0.17, facing, looking: facing && gaze.strength < 0.28, yaw: Math.round(yaw), pitch: Math.round(pitch), id: f.embedding?.length ? packEmbedding(f.embedding) : undefined, gl })
    } catch (e) { out.push({ found: false }) }
  }
  return out
}

/* Per-face culling analysis on the main thread using Human (face mesh + iris, models served from /models).
   Input: the 192px sRGB crops the decode worker cuts around each detected face.
   Output per face: are the eyes open, is the head turned to the camera, is the gaze on the lens. */
export interface FaceCheck { found: boolean; open?: boolean; facing?: boolean; looking?: boolean; yaw?: number; pitch?: number }

let human: any = null, loading: Promise<any> | null = null, failed = false
async function load() {
  if (human || failed) return human
  if (!loading) loading = (async () => {
    const mod: any = await import('@vladmandic/human')
    const Human = mod.Human || mod.default
    const h = new Human({
      backend: 'webgl', modelBasePath: '/models/', cacheSensitivity: 0, debug: false, async: true, warmup: 'none',
      filter: { enabled: false },
      face: { enabled: true, detector: { rotation: false, maxDetected: 1, minConfidence: 0.2, return: false }, mesh: { enabled: true }, iris: { enabled: true }, attention: { enabled: false }, emotion: { enabled: false }, description: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } },
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

export async function checkFaces(crops: Uint8ClampedArray[], size = 192): Promise<FaceCheck[]> {
  const h = await load(); const out: FaceCheck[] = []
  for (const c of crops) {
    if (!h) { out.push({ found: false }); continue }
    try {
      const res = await h.detect(new ImageData(new Uint8ClampedArray(c), size, size))
      const f = res.face && res.face[0]
      if (!f || !f.mesh || f.mesh.length < 468) { out.push({ found: false }); continue }
      const earR = eyeOpen(f.mesh, 159, 145, 133, 33), earL = eyeOpen(f.mesh, 386, 374, 362, 263)
      const ang = f.rotation?.angle || { yaw: 0, pitch: 0 }, gaze = f.rotation?.gaze || { strength: 0 }
      const yaw = ang.yaw * 180 / Math.PI, pitch = ang.pitch * 180 / Math.PI
      const facing = Math.abs(yaw) < 28 && Math.abs(pitch) < 26
      out.push({ found: true, open: Math.min(earL, earR) > 0.17, facing, looking: facing && gaze.strength < 0.28, yaw: Math.round(yaw), pitch: Math.round(pitch) })
    } catch (e) { out.push({ found: false }) }
  }
  return out
}

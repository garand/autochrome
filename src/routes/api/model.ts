import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { MODELS, hfUrl, type ModelId } from '../../engine/models'
import { fail, handle } from '../../server/fs'

/* GET /api/model?id=…  ->  one of the lens blur models listed in engine/models.ts.
   Only listed ids are served, so this is not an open proxy. Each file is fetched from Hugging Face at a pinned
   revision once, kept on local disk, and browsers are told to cache it for a year. No photo data is involved:
   the models run in the viewer's browser. */
const CACHE = path.resolve(process.env.AUTOCHROME_MODEL_CACHE || path.join(os.tmpdir(), 'autochrome-models'))
const inflight = new Map<string, Promise<string>>()

async function cached(id: ModelId) {
  const m = MODELS[id], file = path.join(CACHE, `${id}-${m.rev.slice(0, 12)}.onnx`)
  try { if ((await fs.promises.stat(file)).size === m.size) return file } catch {}
  let job = inflight.get(id)
  if (!job) {
    job = (async () => {
      await fs.promises.mkdir(CACHE, { recursive: true })
      const res = await fetch(hfUrl(m))
      if (!res.ok || !res.body) throw new Error(`Hugging Face returned ${res.status} for ${m.name}`)
      const tmp = `${file}.${process.pid}.part`
      await new Promise<void>((ok, bad) => { const w = fs.createWriteStream(tmp); Readable.fromWeb(res.body as any).on('error', bad).pipe(w).on('finish', ok).on('error', bad) })
      const got = (await fs.promises.stat(tmp)).size
      if (got !== m.size) { await fs.promises.rm(tmp, { force: true }); throw new Error(`Incomplete download of ${m.name} (${got} of ${m.size} bytes)`) }
      await fs.promises.rename(tmp, file)
      return file
    })().finally(() => inflight.delete(id))
    inflight.set(id, job)
  }
  return job
}

export const Route = createFileRoute('/api/model')({
  server: {
    handlers: {
      GET: ({ request }) => handle(async () => {
        const id = new URL(request.url).searchParams.get('id') as ModelId
        if (!id || !Object.hasOwn(MODELS, id)) fail(404, 'No such model')
        const file = await cached(id)
        return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
          headers: { 'content-type': 'application/octet-stream', 'content-length': String(MODELS[id].size), 'cache-control': 'public, max-age=31536000, immutable' },
        })
      }),
    },
  },
})

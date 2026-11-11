import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { PIXLS, SAMPLES, type Sample } from '../../samples'
import { fail, handle } from '../../server/fs'

/* GET /api/sample?id=…  ->  the raw file of one curated sample (supports Range).
   Only ids from SAMPLES are served, so this is not an open proxy. Each file is fetched from PIXLS.US once and
   kept on local disk; browsers are told to cache it for a year, so PIXLS.US sees as little traffic as possible. */
const CACHE = path.resolve(process.env.AUTOCHROME_SAMPLE_CACHE || path.join(os.tmpdir(), 'autochrome-samples'))
const inflight = new Map<number, Promise<string>>()

async function cached(s: Sample) {
  const file = path.join(CACHE, `${s.id}-${s.file}`)
  try { if ((await fs.promises.stat(file)).size === s.size) return file } catch {}
  let job = inflight.get(s.id)
  if (!job) {
    job = (async () => {
      await fs.promises.mkdir(CACHE, { recursive: true })
      const res = await fetch(PIXLS + s.src, { headers: { 'user-agent': 'Autochrome sample loader (+https://github.com/garand/autochrome)' } })
      if (!res.ok || !res.body) throw new Error(`PIXLS.US returned ${res.status} for ${s.file}`)
      const tmp = `${file}.${process.pid}.part`
      await new Promise<void>((ok, bad) => { const w = fs.createWriteStream(tmp); Readable.fromWeb(res.body as any).on('error', bad).pipe(w).on('finish', ok).on('error', bad) })
      const got = (await fs.promises.stat(tmp)).size
      if (got !== s.size) { await fs.promises.rm(tmp, { force: true }); throw new Error(`Incomplete download of ${s.file} (${got} of ${s.size} bytes)`) }
      await fs.promises.rename(tmp, file)
      return file
    })().finally(() => inflight.delete(s.id))
    inflight.set(s.id, job)
  }
  return job
}

export const Route = createFileRoute('/api/sample')({
  server: {
    handlers: {
      GET: ({ request }) => handle(async () => {
        const id = Number(new URL(request.url).searchParams.get('id')), s = SAMPLES.find(x => x.id === id)
        if (!s) fail(404, 'No such sample')
        const file = await cached(s)
        const base = { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', 'accept-ranges': 'bytes' }
        const m = /^bytes=(\d+)-(\d+)?$/.exec(request.headers.get('range') || '')
        if (m) {   // used to pull the embedded preview out of a raw without reading all of it
          const start = Number(m[1]), end = Math.min(s.size - 1, m[2] ? Number(m[2]) : s.size - 1)
          if (start > end) fail(416, 'Bad range')
          return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers: { ...base, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${s.size}` } })
        }
        return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...base, 'content-length': String(s.size) } })
      }),
    },
  },
})

import fs from 'node:fs'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { IMG_EXT, RAW_EXT, extOf, fail, handle, safe } from '../../server/fs'

/* GET /api/file?path=…  ->  the bytes of one raw/image file */
export const Route = createFileRoute('/api/file')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, async () => {
        const file = safe(new URL(request.url).searchParams.get('path'))
        if (!RAW_EXT.includes(extOf(file)) && !IMG_EXT.includes(extOf(file))) fail(415, 'Not a raw or image file')
        const st = await fs.promises.stat(file)
        const base = { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' }
        const m = /^bytes=(\d+)-(\d+)?$/.exec(request.headers.get('range') || '')
        if (m) {   // used to pull the embedded preview out of a raw without reading all of it
          const start = Number(m[1]), end = Math.min(st.size - 1, m[2] ? Number(m[2]) : st.size - 1)
          if (start > end) fail(416, 'Bad range')
          return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers: { ...base, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${st.size}` } })
        }
        return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...base, 'content-length': String(st.size) } })
      }),
    },
  },
})

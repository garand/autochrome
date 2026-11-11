import fs from 'node:fs/promises'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { LUT_DIR, fail, handle, json } from '../../server/fs'

/* GET /api/luts           -> names of the .cube files in ./luts (or AUTOCHROME_LUTS)
   GET /api/luts?name=x    -> the text of one of them */
export const Route = createFileRoute('/api/luts')({
  server: {
    handlers: {
      GET: ({ request }) => handle(async () => {
        const name = new URL(request.url).searchParams.get('name')
        if (!name) { let files: string[] = []; try { files = (await fs.readdir(LUT_DIR)).filter(f => /\.cube$/i.test(f)).sort() } catch {} return json({ dir: LUT_DIR, files }) }
        if (path.basename(name) !== name || !/\.cube$/i.test(name)) fail(400, 'Bad LUT name')
        return new Response(await fs.readFile(path.join(LUT_DIR, name), 'utf8'), { headers: { 'content-type': 'text/plain' } })
      }),
    },
  },
})

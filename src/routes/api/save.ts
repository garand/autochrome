import fs from 'node:fs/promises'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { fail, handle, json, safe } from '../../server/fs'

/* POST /api/save?dir=…&kind=project            body: project JSON  -> <dir>/autochrome-project.json
   POST /api/save?dir=…&kind=export&sub=…&name=… body: image bytes   -> <dir>/<sub>/<name>            */
export const Route = createFileRoute('/api/save')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request, async () => {
        const q = new URL(request.url).searchParams, dir = safe(q.get('dir')), body = Buffer.from(await request.arrayBuffer())
        if (q.get('kind') === 'project') { await fs.writeFile(path.join(dir, 'autochrome-project.json'), body); return json({ ok: true }) }
        const name = path.basename(q.get('name') || ''), sub = path.basename(q.get('sub') || 'exports')
        if (!/\.(jpe?g|png|webp)$/i.test(name) || sub.startsWith('.')) fail(400, 'Bad export name')
        const out = path.join(dir, sub)
        await fs.mkdir(out, { recursive: true })
        await fs.writeFile(path.join(out, name), body)
        return json({ ok: true, path: path.join(out, name) })
      }),
    },
  },
})

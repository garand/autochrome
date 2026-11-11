import fs from 'node:fs/promises'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { IMG_EXT, RAW_EXT, ROOT, extOf, handle, json, safe } from '../../server/fs'

/* GET /api/list?dir=…  ->  sub-folders, raw/image files and any saved project for a folder */
export const Route = createFileRoute('/api/list')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, async () => {
        const dir = safe(new URL(request.url).searchParams.get('dir'))
        const entries = await fs.readdir(dir, { withFileTypes: true })
        const dirs: string[] = [], files: { name: string; size: number; mtime: number }[] = []
        for (const e of entries) {
          if (e.name.startsWith('.')) continue
          if (e.isDirectory()) dirs.push(e.name)
          else if (e.isFile() && (RAW_EXT.includes(extOf(e.name)) || IMG_EXT.includes(extOf(e.name)))) { const st = await fs.stat(path.join(dir, e.name)); files.push({ name: e.name, size: st.size, mtime: st.mtimeMs }) }
        }
        dirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        let project = null
        try { project = JSON.parse(await fs.readFile(path.join(dir, 'autochrome-project.json'), 'utf8')) } catch {}
        return json({ root: ROOT, dir, parent: dir === ROOT ? null : path.dirname(dir), name: path.basename(dir), dirs, files, project })
      }),
    },
  },
})

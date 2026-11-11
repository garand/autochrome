/* Server-side file access. Everything is confined to AUTOCHROME_ROOT (default: your home folder) and
   requests are only accepted from this machine unless AUTOCHROME_ALLOW_REMOTE=1 is set. */
import os from 'node:os'
import path from 'node:path'

export const ROOT = path.resolve(process.env.AUTOCHROME_ROOT || os.homedir())
export const LUT_DIR = path.resolve(process.env.AUTOCHROME_LUTS || path.join(process.cwd(), 'luts'))
export const RAW_EXT = ['nef', 'nrw', 'cr2', 'cr3', 'crw', 'arw', 'srf', 'sr2', 'raf', 'dng', 'orf', 'rw2', 'pef', 'srw', 'x3f', 'erf', 'kdc', 'dcr', 'mrw', '3fr', 'iiq', 'rwl', 'mef', 'mos', 'gpr']
export const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp']
export const extOf = (n: string) => (n.split('.').pop() || '').toLowerCase()

export function fail(status: number, message: string): never { throw new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } }) }
export function guard(request: Request) {
  if (process.env.AUTOCHROME_ALLOW_REMOTE === '1') return
  const host = (request.headers.get('host') || '').replace(/:\d+$/, '')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) fail(403, 'Autochrome only serves files to this computer. Set AUTOCHROME_ALLOW_REMOTE=1 to change that.')
}
export function safe(p: string | null) {
  if (!p) return ROOT
  const abs = path.resolve(p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p)
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) fail(403, `That folder is outside ${ROOT}. Start the server with AUTOCHROME_ROOT set to a parent folder to allow it.`)
  return abs
}
export async function handle(request: Request, fn: () => Promise<Response>) {
  try { guard(request); return await fn() } catch (e: any) { if (e instanceof Response) return e; return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: e?.code === 'ENOENT' ? 404 : 500, headers: { 'content-type': 'application/json' } }) }
}
export const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })

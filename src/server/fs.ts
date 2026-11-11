/* Server-side helpers. The server never touches the viewer's photos: folders and files are read by the
   browser on the viewer's own computer. The only thing served from disk is the shared LUT folder. */
import path from 'node:path'

export const LUT_DIR = path.resolve(process.env.AUTOCHROME_LUTS || path.join(process.cwd(), 'luts'))

export function fail(status: number, message: string): never { throw new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } }) }
export async function handle(fn: () => Promise<Response>) {
  try { return await fn() } catch (e: any) { if (e instanceof Response) return e; return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: e?.code === 'ENOENT' ? 404 : 500, headers: { 'content-type': 'application/json' } }) }
}
export const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })

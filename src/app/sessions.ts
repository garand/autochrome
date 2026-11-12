/* Sessions: every shoot you open is remembered in this browser (IndexedDB), so you can close the tab and come back to
   it as you left it: the edits, scenes, flags and undo history, which photo was open, the filter and view. A folder
   is remembered by its handle, so it reopens without picking it again (Chrome may ask once to allow access again);
   samples are remembered by their ids. Loose files have nothing to reopen them by and are not kept as sessions. */

export interface Session {
  id: string; title: string; kind: 'handle' | 'samples'
  dir?: any                 // FileSystemDirectoryHandle (structured-cloneable, so it survives in IndexedDB)
  samples?: string[]        // sample ids
  project: any              // the same data as autochrome-project.json
  history?: { label: string; json: string; key?: string; at: number }[]; hIdx?: number
  ui?: { cur?: string | null; filter?: string; sceneView?: string | null; scope?: string; view?: 'grid' | 'board' | null }
  count: number; picks: number; scenes: number; at: number; cover?: Blob | null
}

let dbp: Promise<IDBDatabase> | null = null
const db = () => (dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open('autochrome-sessions', 1)
  r.onupgradeneeded = () => { r.result.createObjectStore('sessions', { keyPath: 'id' }) }
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
}))
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const store = async (mode: IDBTransactionMode = 'readonly') => (await db()).transaction('sessions', mode).objectStore('sessions')

export async function putSession(s: Session) { try { await req((await store('readwrite')).put(s)) } catch (e) { console.warn('Could not save the session', e) } }
export async function getSession(id: string): Promise<Session | null> { try { return (await req((await store()).get(id))) || null } catch { return null } }
export async function deleteSession(id: string) { try { await req((await store('readwrite')).delete(id)) } catch {} if (lastSession() === id) setLastSession(null) }
/* newest first, without the heavy parts */
export async function listSessions(): Promise<Session[]> {
  try { const all: Session[] = await req((await store()).getAll()); return all.sort((a, b) => b.at - a.at).map(s => ({ ...s, project: null, history: undefined })) } catch { return [] }
}
/* the session to resume when the app opens; cleared when you close a shoot on purpose */
export const lastSession = () => { try { return localStorage.getItem('autochrome:last') } catch { return null } }
export const setLastSession = (id: string | null) => { try { if (id) localStorage.setItem('autochrome:last', id); else localStorage.removeItem('autochrome:last') } catch {} }

/* the session a folder already has: the same folder may have been opened before under the same name */
export async function sessionForDir(dir: any): Promise<Session | null> {
  for (const s of await listSessions()) if (s.kind === 'handle' && s.dir && s.dir.name === dir.name) { try { if (await s.dir.isSameEntry(dir)) return getSession(s.id) } catch {} }
  return null
}
/* access to a remembered folder: read/write, read only, or not yet (Chrome asks again after a restart unless you
   chose to allow it on every visit; asking needs a click, so ask is true only from one) */
export async function folderAccess(dir: any, ask: boolean): Promise<'rw' | 'read' | 'prompt' | 'denied'> {
  try {
    if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return 'rw'
    if (ask && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted') return 'rw'
    const r = await dir.queryPermission({ mode: 'read' }); return r === 'granted' ? 'read' : ask ? 'denied' : r
  } catch { return 'denied' }
}
export const newSessionId = (kind: string) => kind + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

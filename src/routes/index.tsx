import { Suspense, lazy, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

/* The editor is a WebGL + Web Worker app, so it only ever renders in the browser. */
const Editor = lazy(() => import('../ui/Editor'))
export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [client, setClient] = useState(false)
  useEffect(() => setClient(true), [])
  const splash = <div className="splash"><span className="logo" />Autochrome</div>
  return client ? <Suspense fallback={splash}><Editor /></Suspense> : splash
}

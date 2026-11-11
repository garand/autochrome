import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // Human's package "exports" would hand the server build its Node entry (which wants tfjs-node).
    // The app only uses it in the browser, so always resolve the browser bundle.
    alias: { '@vladmandic/human': fileURLToPath(new URL('./node_modules/@vladmandic/human/dist/human.esm.js', import.meta.url)) },
  },
  worker: { format: 'es' },
  plugins: [nitro(), tanstackStart(), viteReact()],
})

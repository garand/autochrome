# Autochrome

A raw developer for whole shoots, built with TanStack Start (React + Vite) and served by a Node server.
Open a folder, get the set balanced automatically, edit everything at once, override single photos, cull with
face checks, export.

## Run it

```bash
npm install
npm run dev        # development, http://127.0.0.1:3000
npm run build
npm start          # production: node .output/server/index.mjs on http://127.0.0.1:3000
```

Use a Chromium browser (Chrome, Edge, Arc). The app needs WebGL2 and Web Workers.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTOCHROME_ROOT` | your home folder | The only tree the server will read from or write to |
| `AUTOCHROME_LUTS` | `./luts` | Folder of `.cube` LUTs to list under Looks > My LUTs |
| `AUTOCHROME_ALLOW_REMOTE` | unset | Set to `1` to accept requests that do not come from this machine |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Where the production server listens |

The server exists to reach your files: it lists a folder, streams the raw files to the browser, and writes
exports and a `autochrome-project.json` next to the photos. It is meant to run on your own computer. It refuses
paths outside `AUTOCHROME_ROOT` and, by default, requests from other hosts. Do not expose it to a network
without putting authentication in front of it.

You can also drop a folder or files onto the window; those are read by the browser directly and exported
to the same folder (Chromium asks for permission) or as a zip.

## How it works

- `src/engine/decode.worker.ts` decodes each raw with LibRaw (WebAssembly) to linear 16-bit RGB, meters it,
  finds faces (pico cascade), scores each face for focus and cuts small face crops.
- `src/engine/gl.ts` is the developer: one WebGL2 fragment shader, used for the viewer, thumbnails, the
  style browser and full-resolution export, so what you see is what is exported.
- `src/engine/faces.ts` runs Human (face mesh + iris) on the face crops for eyes-open / facing / gaze.
- `src/engine/looks.ts` is the look library: procedurally generated 3D LUTs.
- `src/app/store.ts` holds state and actions; `src/ui/*` are the React views.
- `src/routes/api/*` are the server routes (`list`, `file`, `save`, `luts`).

Settings are project-wide with per-photo overrides: a photo stores only the keys that differ from the shoot.
Crop, rotation and masks are always per photo.

## Looks, LUTs and presets

The built-in looks are original emulations written for this app, named for the film stocks and editing
styles they are modelled on. They are not the manufacturers' or any preset vendor's files. To use real
ones, put `.cube` files in `./luts` (or use Presets > Import). Lightroom `.xmp` presets can be imported
too; the common sliders, HSL, colour grading and tone curve are mapped across, which gets close but is not
an exact match because the two engines differ.

## Known limits

- Up to four masks per photo, linear and radial only. No brush, no AI subject masks.
- No lens profile corrections, perspective correction or healing.
- Noise reduction and sharpening are single-pass and simple.
- Output is 8-bit sRGB (JPEG, WebP or PNG); EXIF is not copied to exports.
- Face checks: profiles, tinted glasses and lowered eyes can read as "eyes closed". Focus thresholds
  (`FOCUS` in `src/app/store.ts`) were set on one shoot from one camera; tune them for yours.
- "Match skin tones" is tuned on lighter skin.

## Third-party

LibRaw via `libraw-wasm-nothread` (LGPL-2.1 / CDDL-1.0), Human by Vladimir Mandic (MIT, models in
`public/models`), pico.js face detector (MIT, cascade in `public/facefinder.bin`), TanStack Start, React.

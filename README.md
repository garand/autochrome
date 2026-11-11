# Autochrome

A raw developer for whole shoots that runs in the browser, built with TanStack Start (React + Vite).
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
| `AUTOCHROME_LUTS` | `./luts` | Folder of `.cube` LUTs to list under Looks > My LUTs |
| `AUTOCHROME_SAMPLE_CACHE` | system temp folder | Where the server caches sample raws fetched from PIXLS.US |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Where the production server listens |

Your photos never go to the server. Choose a folder (or drop one onto the window) and the browser reads the
files from your own computer, so the app works the same whether it runs locally or on a host. In Chromium
browsers the folder picker grants read/write access: edits are saved to an `autochrome-project.json` in the
folder and exports can be written straight back into it. Other browsers open the folder read-only, keep edits
in the browser and export a .zip. The server only serves the app and the shared LUT folder.

## Sample photos

The open screen offers sample portraits and landscapes to try the app without your own files. They are raws shared
by photographers on [PIXLS.US Play Raw](https://discuss.pixls.us/c/processing/playraw) under CC BY-SA 4.0 (one CC0),
listed with credits in `src/samples.ts`; each photo's author and licence show in the Photo panel. Portraits are limited
to staged shoots and self-portraits posted for others to edit. The raws are not stored here: `/api/sample` fetches a
listed file from PIXLS.US the first time it is opened, caches it on disk and tells browsers to cache it for a year.
Only the small preview thumbnails in `public/samples/` are in the repo.

## How it works

- `src/engine/decode.worker.ts` decodes each raw with LibRaw (WebAssembly) to linear 16-bit RGB, meters it,
  finds faces (pico cascade), scores each face for focus and cuts small face crops.
- `src/engine/gl.ts` is the developer: one WebGL2 fragment shader, used for the viewer, thumbnails, the
  style browser and full-resolution export, so what you see is what is exported.
- `src/engine/faces.ts` runs Human (face mesh + iris) on the face crops for eyes-open / facing / gaze.
- `src/engine/looks.ts` is the look library: procedurally generated 3D LUTs.
- `src/app/store.ts` holds state and actions; `src/ui/*` are the React views.
- `src/routes/api/luts.ts` lists and serves the shared `.cube` LUTs; `src/routes/api/sample.ts` serves the sample raws.

Settings are project-wide with per-photo overrides: a photo stores only the keys that differ from the shoot.
Crop, rotation and masks are always per photo.

## Styles

A style is a starting point with two optional parts: a colour (a film emulation or LUT) and a finish (changes to
the sliders, such as +14 contrast and +22 vignette). Styles sit underneath your own sliders, so switching styles
keeps your edits and every slider reads 0 at the style's result. One Strength control scales the whole style.
Recipes combine a colour with a finish; the film colours are colour only; Yours holds styles you save (the current
result, folded into one style) or import. See `src/engine/styles.ts`.

The built-in film colours are original emulations written for this app, named for the film stocks and editing
styles they are modelled on. They are not the manufacturers' or any preset vendor's files. To use real ones, put
`.cube` files in `./luts` or import them from the Style section. Lightroom `.xmp` presets import as styles too;
the common sliders, HSL, colour grading and tone curve are mapped across, which gets close but is not an exact
match because the two engines differ.

## White balance

For raw files, Temp and Tint read in Kelvin and absolute tint. Each raw's as-shot multipliers and camera colour
matrix give the light the camera treated as neutral, and changes are made in camera space the way a raw converter
does (`src/engine/wb.ts`). Values are stored relative to as shot, so a shoot-wide change shifts every photo by the
same perceived amount. JPEGs keep a relative scale.

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

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
| `AUTOCHROME_MODEL_CACHE` | system temp folder | Where the server caches the lens blur models fetched from Hugging Face |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Where the production server listens |

Your photos never go to the server. Choose a folder (or drop one onto the window) and the browser reads the
files from your own computer, so the app works the same whether it runs locally or on a host. In Chromium
browsers the folder picker grants read/write access: edits are saved to an `autochrome-project.json` in the
folder and exports can be written straight back into it. Other browsers open the folder read-only, keep edits
in the browser and export a .zip. The server only serves the app and the shared LUT folder.

## Sample photos

The open screen offers 53 sample raws to try the app without your own files, in four groups (portraits, landscapes,
city & night, animals & nature), including a few sets of several frames from one shoot that open together, which are
good for trying culling. They are raws shared by photographers on [PIXLS.US Play Raw](https://discuss.pixls.us/c/processing/playraw)
under CC BY-SA 4.0 (one CC0), mostly chosen from the community's most-liked threads, listed with credits in
`src/samples.ts`; each photo's author and licence show in the Photo panel. People are limited to staged shoots and
self-portraits posted for others to edit: no candid strangers and no children. The raws are not stored here: `/api/sample` fetches a
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

## Culling

- **Face sheet (F):** the current burst (or the selected photos) as rows of frames and columns of people, each face
  cropped tight and evenly brightened, with eyes-open, focus and at-camera checks and the best frame marked. People
  are lined up across the frames of a burst. ↑ ↓ move between frames, P / X decide, clicking a face opens it at 100%.
- **Auto-advance:** after a pick, reject or rating the next photo comes up (toggle in the toolbar).
- **Bursts** are separated in the filmstrip (frames within 3 seconds, from raw metadata or JPEG EXIF), and a progress
  bar shows how many photos have a decision.
- **Auto cull** picks the best frame of each burst and can reject blinks and soft frames.

## Scenes

A shoot often moves between spots: another backdrop, the other side of the street, indoors and out. Once every photo
is metered, Autochrome groups them into scenes by what they look like (the colours in the frame, the tonal spread,
a coarse layout and, for raws, how bright the place really was from the exposure settings) and when they were taken
(a burst is always one spot, a long pause makes a new spot more likely). See `src/engine/scenes.ts`.

- **Settings have three levels:** shoot, scene, photo. Each stores only what differs from the level above, so a scene
  can be warmed or brightened as a whole and still follows later changes to the shoot. The scope switch (S cycles it)
  picks which level the sliders edit; blue dots mark a scene's own values, orange a photo's.
- **Filmstrip:** scene chips show one scene at a time, labels mark where each scene starts, and photos can be dragged
  onto a chip to move them.
- **Scene board (N):** every scene as a card. Type over a name to rename it, drag photos between scenes or onto
  New scene, drag a scene by its handle onto another to merge them. Regroup sorts the whole shoot again, keeping
  names and adjustments where most of a scene's photos go.
- **Adding photos** never reshuffles scenes you have tuned: new photos join the scene they look like, or form new ones.

## Sessions

Every folder or sample set you open is remembered in the browser (IndexedDB, `src/app/sessions.ts`): edits, scenes,
flags, the undo history, and which photo, filter and view you were on. The last shoot reopens by itself when you come
back. Chrome may ask once to allow access to the folder again (Continue on the start screen), unless you chose to
allow it on every visit. Closing a shoot from its title button keeps it under Recent on the start screen. Loose files
(Add files…, or the folder fallback in browsers without the folder picker) have nothing to reopen them by, so they
are not kept as sessions; their edits still save in the browser as before.

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

## Tinted glasses

Photochromic lenses that darken outdoors, tinted lenses and coatings that reflect the trees can be cleared in the
Faces section: click the people wearing them. For each face the lens apertures are traced along the inner rim of the
frame (`src/engine/lensAperture.ts`), so only the glass is corrected, never the frame. Inside them the tint is undone
with a per-channel gain measured from skin just inside and just outside the lower rim; where a smoothed lean towards
the reflection colour shows a reflection, the pixel is rebuilt from the channels the reflection touches least, with
the colour of clean skin from the same lens (nearly neutral over the eye). A marked person is followed through the rest
of the shoot by a face embedding (Human's face description model); in a group each marked person claims only their
best-matching face, and any photo can turn the fix on or off for a face by hand. See `src/engine/glasses.ts`.

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
- Lens blur needs WebGPU with 16-bit floats for the subject model (current Chrome, Edge and Arc). Without it the depth
  model runs on the CPU and there is no subject matte, so subject edges are softer. Depth is relative, so very flat
  scenes or glass and mirrors can be read wrong; check with Visualize depth.
- The glasses fix needs the face mesh to read the eyes, so faces in profile or very small faces are skipped. Blurry
  or very small faces can be outlined a few pixels off, rimless glasses are not handled, sharp reflections of trees
  across the eye are toned down rather than removed, and reflections the colour of skin are left alone.

## Third-party

LibRaw via `libraw-wasm-nothread` (LGPL-2.1 / CDDL-1.0), Human by Vladimir Mandic (MIT, models in
`public/models`), pico.js face detector (MIT, cascade in `public/facefinder.bin`), ONNX Runtime Web (MIT),
Depth Anything V2 Small (Apache-2.0) and BEN2 (MIT) via `onnx-community` on Hugging Face, TanStack Start, React.

/* The built-in look library.
   Every look here is an original, procedurally generated 3D LUT written for this app. They are
   emulations "in the style of" well-known film stocks and popular editing trends, not copies of any
   manufacturer's or preset vendor's files. Real packs can be dropped into ./luts as .cube files.

   p: contrast (S-curve), lift / roll (black + white point), mid (gamma, >1 darker), sat,
      sh / hi ([r,g,b] tint added to shadows / highlights), hues ([{c: centre hue, w: width, dh, ds, dl}]),
      bw ([r,g,b] mix), bleach (0..1 silver retention), chGamma ([r,g,b] per-channel gamma). */
const G = 115, B = 235, O = 30, R = 0, Y = 58, A = 180, M = 325
export const LOOK_CATS = ['Colour negative', 'Slide film', 'Black & white', 'Cinema', 'Camera profiles', 'Portrait & wedding', 'Mood', 'Vintage', 'Landscape & travel']
export const LOOK_DEFS = [
  { id: 'none', name: 'None', cat: '', sub: 'Straight develop', sw: '#777' },

  // ---- colour negative
  { id: 'portra160', name: 'Portra 160 style', cat: 'Colour negative', sub: 'Low contrast, delicate skin', sw: '#ecd0b0', p: { contrast: -0.06, lift: 0.035, roll: 0.03, sat: 0.88, hi: [0.014, 0.006, -0.014], sh: [0, 0.004, 0.01], hues: [{ c: G, w: 40, dh: -10, ds: -0.22 }, { c: B, w: 35, dh: -6, ds: -0.15 }] } },
  { id: 'portra', name: 'Portra 400 style', cat: 'Colour negative', sub: 'Warm skin, soft contrast', sw: '#e9c29a', p: { contrast: -0.03, lift: 0.03, roll: 0.035, sat: 0.93, hi: [0.02, 0.008, -0.02], sh: [0, 0.006, 0.012], hues: [{ c: G, w: 40, dh: -12, ds: -0.2 }, { c: B, w: 35, dh: -8, ds: -0.15 }, { c: R, w: 20, dh: 4 }] } },
  { id: 'portra800', name: 'Portra 800 style', cat: 'Colour negative', sub: 'Richer, warmer, more bite', sw: '#e0a878', p: { contrast: 0.04, lift: 0.03, roll: 0.03, sat: 1.0, hi: [0.026, 0.01, -0.024], sh: [0.004, 0.004, 0.006], hues: [{ c: G, w: 40, dh: -12, ds: -0.12 }, { c: O, w: 18, ds: 0.08 }] } },
  { id: 'gold', name: 'Gold 200 style', cat: 'Colour negative', sub: 'Sunny, saturated warmth', sw: '#f0b540', p: { contrast: 0.08, lift: 0.012, sat: 1.08, hi: [0.03, 0.014, -0.03], sh: [0.01, 0, -0.012], hues: [{ c: G, w: 40, dh: -8 }, { c: Y, w: 20, ds: 0.12 }] } },
  { id: 'colorplus', name: 'ColorPlus 200 style', cat: 'Colour negative', sub: 'Nostalgic drugstore warmth', sw: '#e8a04a', p: { contrast: 0.05, lift: 0.03, roll: 0.02, sat: 1.02, hi: [0.03, 0.012, -0.03], sh: [0.012, 0.002, -0.006], hues: [{ c: R, w: 22, ds: 0.1 }, { c: G, w: 40, dh: -6, ds: -0.08 }] } },
  { id: 'ultramax', name: 'UltraMax 400 style', cat: 'Colour negative', sub: 'Bold colour, snappy', sw: '#e2783a', p: { contrast: 0.12, lift: 0.015, sat: 1.14, hi: [0.022, 0.008, -0.022], sh: [0.004, 0, 0], hues: [{ c: R, w: 22, ds: 0.12 }, { c: B, w: 35, ds: 0.08, dl: -0.06 }] } },
  { id: 'ektar', name: 'Ektar 100 style', cat: 'Colour negative', sub: 'Vivid, crisp, deep blues', sw: '#d9482b', p: { contrast: 0.15, sat: 1.22, hi: [0.008, 0, -0.008], hues: [{ c: B, w: 35, dl: -0.12, ds: 0.1 }, { c: R, w: 22, ds: 0.1 }] } },
  { id: '400h', name: 'Pro 400H style', cat: 'Colour negative', sub: 'Pastel, minty greens', sw: '#bfe0cf', p: { contrast: -0.07, lift: 0.05, roll: 0.02, sat: 0.88, mid: 0.94, sh: [-0.01, 0.012, 0.008], hi: [0.008, 0.008, 0], hues: [{ c: G, w: 42, dh: 12, ds: -0.12, dl: 0.06 }, { c: B, w: 35, dh: -10, ds: -0.1 }] } },
  { id: 'superia', name: 'Superia 400 style', cat: 'Colour negative', sub: 'Punchy greens, cool shadows', sw: '#3f9b6a', p: { contrast: 0.1, sat: 1.05, sh: [-0.006, 0.01, 0.006], hi: [0.01, 0.004, -0.006], hues: [{ c: G, w: 40, dh: 6, ds: 0.12 }, { c: M, w: 25, ds: 0.1 }] } },
  { id: 'c200', name: 'C200 style', cat: 'Colour negative', sub: 'Soft, green-leaning everyday', sw: '#9ec49a', p: { contrast: 0.02, lift: 0.03, roll: 0.02, sat: 0.96, sh: [-0.006, 0.01, 0.002], hi: [0.01, 0.01, -0.004], hues: [{ c: G, w: 40, dh: 8 }, { c: R, w: 22, dh: 3, ds: -0.05 }] } },
  { id: 'vista', name: 'Vista 200 style', cat: 'Colour negative', sub: 'Saturated reds, warm', sw: '#d9503f', p: { contrast: 0.1, lift: 0.015, sat: 1.12, hi: [0.022, 0.006, -0.02], hues: [{ c: R, w: 24, ds: 0.2 }, { c: G, w: 40, dh: -4, ds: 0.05 }] } },
  { id: 'lomo', name: 'Lomo 800 style', cat: 'Colour negative', sub: 'Loud colour, heavy contrast', sw: '#c2452d', p: { contrast: 0.22, lift: 0.01, sat: 1.25, sh: [-0.01, 0.004, 0.016], hi: [0.02, 0.01, -0.016], hues: [{ c: G, w: 40, ds: 0.1, dl: -0.08 }] } },

  // ---- slide
  { id: 'kodachrome', name: 'Kodachrome 64 style', cat: 'Slide film', sub: 'Rich reds, deep contrast', sw: '#b3261e', p: { contrast: 0.2, lift: -0.008, sat: 1.1, hi: [0.012, 0.004, -0.012], hues: [{ c: R, w: 22, ds: 0.15, dl: -0.05 }, { c: B, w: 35, dl: -0.15 }, { c: Y, w: 20, dh: -4 }] } },
  { id: 'ektachrome', name: 'Ektachrome E100 style', cat: 'Slide film', sub: 'Clean, cool, precise', sw: '#3f78c2', p: { contrast: 0.16, sat: 1.08, sh: [-0.006, 0, 0.012], hi: [-0.004, 0, 0.006], hues: [{ c: B, w: 35, ds: 0.12 }, { c: G, w: 40, dh: 4 }] } },
  { id: 'velvia', name: 'Velvia 50 style', cat: 'Slide film', sub: 'Maximum colour', sw: '#1f9d55', p: { contrast: 0.2, sat: 1.38, hues: [{ c: G, w: 40, ds: 0.1, dl: -0.06 }, { c: B, w: 35, ds: 0.1, dl: -0.08 }] } },
  { id: 'provia', name: 'Provia 100F style', cat: 'Slide film', sub: 'Neutral, faithful slide', sw: '#5c8fb0', p: { contrast: 0.12, sat: 1.1, sh: [-0.003, 0, 0.006] } },
  { id: 'astia', name: 'Astia 100F style', cat: 'Slide film', sub: 'Soft slide, gentle skin', sw: '#d7b9a8', p: { contrast: 0.05, lift: 0.01, sat: 1.02, hi: [0.008, 0.002, -0.004], hues: [{ c: O, w: 18, ds: -0.06 }, { c: G, w: 40, dh: 4 }] } },
  { id: 'agfachrome', name: 'Agfachrome style', cat: 'Slide film', sub: 'Warm reds, olive greens', sw: '#a55a2a', p: { contrast: 0.14, sat: 1.06, hi: [0.02, 0.006, -0.018], sh: [0.006, 0, -0.004], hues: [{ c: G, w: 40, dh: -14, ds: -0.1 }, { c: R, w: 22, ds: 0.12 }] } },

  // ---- black & white
  { id: 'trix', name: 'Tri-X 400 style', cat: 'Black & white', sub: 'Gritty, contrasty', sw: '#222', p: { bw: [0.3, 0.55, 0.15], contrast: 0.22, lift: 0.02, roll: 0.02 } },
  { id: 'hp5', name: 'HP5 Plus style', cat: 'Black & white', sub: 'Gentle, open shadows', sw: '#666', p: { bw: [0.25, 0.6, 0.15], contrast: 0.07, lift: 0.035, roll: 0.03 } },
  { id: 'tmax', name: 'T-Max 100 style', cat: 'Black & white', sub: 'Fine, clean, modern', sw: '#555', p: { bw: [0.28, 0.6, 0.12], contrast: 0.13, lift: 0.008 } },
  { id: 'delta3200', name: 'Delta 3200 style', cat: 'Black & white', sub: 'Dark, moody, low-light', sw: '#1a1a1a', p: { bw: [0.33, 0.52, 0.15], contrast: 0.18, lift: 0.05, roll: 0.05, mid: 1.1 } },
  { id: 'acros', name: 'Acros 100 style', cat: 'Black & white', sub: 'Smooth, darker skies', sw: '#444', p: { bw: [0.42, 0.5, 0.08], contrast: 0.14, lift: 0.012, sh: [-0.003, 0, 0.004] } },
  { id: 'panf', name: 'Pan F 50 style', cat: 'Black & white', sub: 'Deep blacks, high acutance', sw: '#111', p: { bw: [0.3, 0.6, 0.1], contrast: 0.26, lift: -0.005 } },
  { id: 'redfilter', name: 'Red filter', cat: 'Black & white', sub: 'Dramatic skies, pale skin', sw: '#5a1e1e', p: { bw: [0.75, 0.25, 0.0], contrast: 0.18, lift: 0.01 } },
  { id: 'sepia', name: 'Warm tone print', cat: 'Black & white', sub: 'Sepia-toned', sw: '#8a6a45', p: { bw: [0.3, 0.58, 0.12], contrast: 0.1, lift: 0.03, roll: 0.04, sh: [0.02, 0.006, -0.012], hi: [0.02, 0.008, -0.02] } },
  { id: 'selenium', name: 'Selenium tone', cat: 'Black & white', sub: 'Cool shadows, neutral whites', sw: '#4a4a5c', p: { bw: [0.3, 0.58, 0.12], contrast: 0.14, lift: 0.02, sh: [-0.004, -0.002, 0.014] } },
  { id: 'cyanotype', name: 'Cyanotype', cat: 'Black & white', sub: 'Prussian blue print', sw: '#1f4e79', p: { bw: [0.3, 0.58, 0.12], contrast: 0.1, lift: 0.03, roll: 0.03, sh: [-0.04, 0, 0.05], hi: [-0.02, 0.004, 0.02] } },

  // ---- cinema
  { id: '800t', name: '800T tungsten style', cat: 'Cinema', sub: 'Teal shadows, amber lights', sw: '#3a8fa3', p: { contrast: 0.06, lift: 0.02, sat: 0.95, sh: [-0.02, 0.006, 0.03], hi: [0.03, 0.004, -0.012], hues: [{ c: B, w: 35, dh: -14 }] } },
  { id: '50d', name: '50D daylight style', cat: 'Cinema', sub: 'Clean, warm, fine grain', sw: '#e3c08a', p: { contrast: 0.06, lift: 0.015, sat: 1.0, hi: [0.016, 0.006, -0.014], sh: [-0.004, 0.002, 0.008], hues: [{ c: G, w: 40, dh: -6, ds: -0.1 }] } },
  { id: '250d', name: '250D motion picture style', cat: 'Cinema', sub: 'Soft filmic daylight', sw: '#c9b28a', p: { contrast: 0.02, lift: 0.03, roll: 0.035, sat: 0.94, hi: [0.014, 0.006, -0.012], sh: [-0.006, 0.004, 0.012], hues: [{ c: G, w: 40, dh: -8, ds: -0.15 }, { c: B, w: 35, dh: -10 }] } },
  { id: '2383', name: 'Print film 2383 style', cat: 'Cinema', sub: 'Theatrical print: dense, warm', sw: '#8c5a2e', p: { contrast: 0.2, lift: 0.012, roll: 0.03, sat: 0.96, mid: 1.06, hi: [0.022, 0.008, -0.02], sh: [-0.012, 0.004, 0.02], hues: [{ c: B, w: 38, dh: -16, ds: -0.1 }, { c: G, w: 40, dh: 8, ds: -0.2 }] } },
  { id: 'tealorange', name: 'Teal & orange', cat: 'Cinema', sub: 'Blockbuster grade', sw: '#f08c2e', p: { contrast: 0.1, sat: 1.05, sh: [-0.03, 0.01, 0.03], hi: [0.035, 0.01, -0.03], hues: [{ c: B, w: 40, dh: -22 }, { c: G, w: 40, dh: 14, ds: -0.25 }] } },
  { id: 'bleach', name: 'Bleach bypass', cat: 'Cinema', sub: 'Silvery, harsh, desaturated', sw: '#7d8286', p: { bleach: 0.55, contrast: 0.26, lift: 0.01, sat: 1.0 } },
  { id: 'eterna', name: 'Eterna cinema style', cat: 'Cinema', sub: 'Flat, muted, gradeable', sw: '#8ea39a', p: { contrast: -0.06, lift: 0.04, roll: 0.04, sat: 0.8, sh: [-0.004, 0.004, 0.006], hues: [{ c: G, w: 40, dh: 6, ds: -0.1 }] } },
  { id: 'noir', name: 'Neo noir', cat: 'Cinema', sub: 'Cold, hard, night city', sw: '#1e2a3a', p: { contrast: 0.22, lift: 0.015, sat: 0.7, mid: 1.12, sh: [-0.02, 0, 0.03], hi: [-0.006, 0.004, 0.012] } },
  { id: 'daynight', name: 'Day for night', cat: 'Cinema', sub: 'Blue moonlight grade', sw: '#25406b', p: { contrast: 0.1, lift: 0.01, sat: 0.55, mid: 1.5, sh: [-0.03, -0.004, 0.04], hi: [-0.03, 0, 0.03] } },
  { id: 'golden', name: 'Golden western', cat: 'Cinema', sub: 'Dusty amber, crushed blues', sw: '#c98a2e', p: { contrast: 0.14, lift: 0.02, sat: 0.9, hi: [0.04, 0.016, -0.04], sh: [0.014, 0.004, -0.012], hues: [{ c: B, w: 38, ds: -0.45 }, { c: G, w: 40, dh: -16, ds: -0.3 }] } },

  // ---- camera profiles
  { id: 'classicchrome', name: 'Classic chrome style', cat: 'Camera profiles', sub: 'Muted documentary colour', sw: '#8a8f7a', p: { contrast: 0.12, lift: 0.01, sat: 0.8, sh: [-0.004, 0.002, 0.006], hues: [{ c: B, w: 38, dh: -10, ds: -0.2, dl: -0.1 }, { c: R, w: 22, ds: -0.12 }, { c: G, w: 40, dh: -6, ds: -0.15 }] } },
  { id: 'classicneg', name: 'Classic negative style', cat: 'Camera profiles', sub: 'Hard contrast, teal-green cast', sw: '#4f8a80', p: { contrast: 0.2, lift: 0.01, sat: 0.9, sh: [-0.014, 0.01, 0.012], hi: [0.016, 0.004, -0.014], hues: [{ c: G, w: 40, dh: 16, ds: -0.1 }, { c: R, w: 22, dh: 5, ds: 0.06 }, { c: B, w: 35, dh: -14 }] } },
  { id: 'nostalgicneg', name: 'Nostalgic negative style', cat: 'Camera profiles', sub: 'Amber highlights, rich shadows', sw: '#c98f4a', p: { contrast: 0.06, lift: 0.02, sat: 1.0, hi: [0.03, 0.014, -0.03], sh: [0.006, 0.002, 0.002], hues: [{ c: R, w: 22, ds: 0.1 }] } },
  { id: 'proneg', name: 'Pro neg style', cat: 'Camera profiles', sub: 'Studio portrait, soft tone', sw: '#d6c2b4', p: { contrast: -0.02, lift: 0.015, sat: 0.9, hues: [{ c: O, w: 18, ds: -0.05 }] } },
  { id: 'vividcam', name: 'Vivid', cat: 'Camera profiles', sub: 'In-camera vivid picture style', sw: '#e0443a', p: { contrast: 0.14, sat: 1.25 } },
  { id: 'portraitcam', name: 'Portrait', cat: 'Camera profiles', sub: 'In-camera portrait style', sw: '#e8c8b8', p: { contrast: 0.0, lift: 0.01, sat: 0.97, hi: [0.008, 0.002, -0.004], hues: [{ c: O, w: 18, dl: 0.04 }] } },
  { id: 'flat', name: 'Flat / log-ish', cat: 'Camera profiles', sub: 'Low contrast base for grading', sw: '#9a9a9a', p: { contrast: -0.14, lift: 0.05, roll: 0.05, sat: 0.82 } },

  // ---- portrait & wedding
  { id: 'airy', name: 'Bright & airy', cat: 'Portrait & wedding', sub: 'Light, soft, muted greens', sw: '#f3ead9', p: { contrast: -0.05, lift: 0.04, sat: 0.95, mid: 0.86, hi: [0.006, 0.004, 0], hues: [{ c: G, w: 42, dh: -10, ds: -0.3, dl: 0.12 }, { c: O, w: 16, ds: -0.06 }] } },
  { id: 'pastel', name: 'Fine-art pastel', cat: 'Portrait & wedding', sub: 'Film-scan pastels, peachy skin', sw: '#f1d9cf', p: { contrast: -0.08, lift: 0.055, roll: 0.02, sat: 0.84, mid: 0.84, hi: [0.012, 0.004, 0], sh: [0, 0.006, 0.008], hues: [{ c: G, w: 42, dh: 10, ds: -0.25, dl: 0.14 }, { c: O, w: 18, dh: -3 }, { c: B, w: 35, ds: -0.2, dl: 0.08 }] } },
  { id: 'truecolor', name: 'Clean & true', cat: 'Portrait & wedding', sub: 'Natural colour, gentle polish', sw: '#cdb8a4', p: { contrast: 0.06, lift: 0.008, sat: 1.02, hi: [0.006, 0.002, -0.004], hues: [{ c: G, w: 40, dh: -4, ds: -0.06 }] } },
  { id: 'earthy', name: 'Warm earthy', cat: 'Portrait & wedding', sub: 'Boho browns, rust, olive', sw: '#a6703c', p: { contrast: 0.08, lift: 0.03, roll: 0.035, sat: 0.9, hi: [0.022, 0.008, -0.022], sh: [0.012, 0.004, -0.008], hues: [{ c: G, w: 42, dh: -22, ds: -0.4, dl: -0.12 }, { c: B, w: 35, ds: -0.5 }, { c: Y, w: 18, dh: -12, ds: -0.1 }, { c: O, w: 16, ds: 0.08 }] } },
  { id: 'moody', name: 'Dark & moody', cat: 'Portrait & wedding', sub: 'Deep, olive greens, warm skin', sw: '#5b4a2e', p: { contrast: 0.13, lift: 0.035, roll: 0.05, sat: 0.94, mid: 1.14, hi: [0.014, 0, -0.016], sh: [0.006, 0, -0.008], hues: [{ c: G, w: 42, dh: -6, ds: -0.3, dl: -0.28 }, { c: B, w: 32, ds: -0.38 }, { c: Y, w: 18, dh: -6, dl: -0.08 }] } },
  { id: 'fallpop', name: 'Fall pop', cat: 'Portrait & wedding', sub: 'Deep greens, glowing oranges', sw: '#d9651f', p: { contrast: 0.12, lift: 0.02, roll: 0.03, sat: 1.0, hi: [0.014, 0.002, -0.014], sh: [0.006, 0, -0.006], hues: [{ c: G, w: 42, dh: -3, ds: 0.1, dl: -0.34 }, { c: O, w: 16, ds: 0.24 }, { c: R, w: 20, ds: 0.2 }, { c: Y, w: 18, dh: -8, ds: 0.16 }, { c: B, w: 32, ds: -0.28 }] } },
  { id: 'goldenhour', name: 'Golden hour', cat: 'Portrait & wedding', sub: 'Honey light, glowing skin', sw: '#f0b45a', p: { contrast: 0.04, lift: 0.025, sat: 1.04, mid: 0.94, hi: [0.034, 0.014, -0.034], sh: [0.012, 0.002, -0.008], hues: [{ c: G, w: 40, dh: -14, ds: -0.15 }] } },
  { id: 'creamy', name: 'Creamy neutral', cat: 'Portrait & wedding', sub: 'Soft whites, quiet colour', sw: '#e8dfd2', p: { contrast: -0.02, lift: 0.03, roll: 0.045, sat: 0.86, hi: [0.012, 0.008, -0.006], hues: [{ c: G, w: 40, ds: -0.2 }] } },
  { id: 'editorial', name: 'Editorial contrast', cat: 'Portrait & wedding', sub: 'Magazine punch, cool neutrals', sw: '#3c4250', p: { contrast: 0.2, lift: 0.005, sat: 0.92, sh: [-0.006, 0, 0.01], hues: [{ c: O, w: 18, ds: -0.06 }] } },

  // ---- mood
  { id: 'matte', name: 'Faded matte', cat: 'Mood', sub: 'Lifted blacks, quiet colour', sw: '#9a948c', p: { contrast: -0.04, lift: 0.085, roll: 0.06, sat: 0.84, sh: [0.004, 0.004, 0.008] } },
  { id: 'forest', name: 'Moody forest', cat: 'Mood', sub: 'Desaturated teal-greens', sw: '#2f4f46', p: { contrast: 0.12, lift: 0.03, roll: 0.04, sat: 0.85, mid: 1.12, sh: [-0.008, 0.006, 0.01], hues: [{ c: G, w: 44, dh: 22, ds: -0.4, dl: -0.2 }, { c: Y, w: 18, dh: 14, ds: -0.4 }, { c: O, w: 16, ds: 0.1 }] } },
  { id: 'coolminimal', name: 'Cool minimal', cat: 'Mood', sub: 'Clean, bluish, restrained', sw: '#b8c6d2', p: { contrast: 0.02, lift: 0.03, sat: 0.8, sh: [-0.008, 0, 0.012], hi: [-0.006, 0, 0.008] } },
  { id: 'cozy', name: 'Cosy warm', cat: 'Mood', sub: 'Brown shadows, candlelight', sw: '#8a5a3a', p: { contrast: 0.06, lift: 0.04, roll: 0.03, sat: 0.92, mid: 1.05, hi: [0.03, 0.012, -0.03], sh: [0.02, 0.006, -0.012], hues: [{ c: B, w: 35, ds: -0.4 }] } },
  { id: 'orangeteal', name: 'Urban orange-teal', cat: 'Mood', sub: 'Street and travel feeds', sw: '#1f8a8a', p: { contrast: 0.14, lift: 0.02, sat: 1.0, sh: [-0.02, 0.008, 0.02], hi: [0.02, 0.006, -0.016], hues: [{ c: G, w: 44, dh: 30, ds: -0.3 }, { c: B, w: 38, dh: -26 }, { c: Y, w: 18, dh: -16 }] } },
  { id: 'blush', name: 'Blush', cat: 'Mood', sub: 'Rosy highlights, soft fade', sw: '#e8b8c0', p: { contrast: -0.02, lift: 0.04, sat: 0.92, hi: [0.022, -0.002, 0.008], sh: [0.006, 0, 0.01], hues: [{ c: G, w: 40, ds: -0.25 }] } },
  { id: 'desert', name: 'Desert dusk', cat: 'Mood', sub: 'Terracotta, mauve shadows', sw: '#c2684a', p: { contrast: 0.08, lift: 0.03, sat: 0.96, hi: [0.03, 0.006, -0.02], sh: [0.01, -0.004, 0.016], hues: [{ c: B, w: 38, dh: 14, ds: -0.2 }, { c: G, w: 40, dh: -20, ds: -0.3 }] } },

  // ---- vintage
  { id: 'seventies', name: '1970s print', cat: 'Vintage', sub: 'Yellowed, soft, warm', sw: '#d8b25a', p: { contrast: -0.02, lift: 0.06, roll: 0.06, sat: 0.9, chGamma: [0.96, 1.0, 1.1], hi: [0.03, 0.02, -0.03], sh: [0.016, 0.004, -0.006] } },
  { id: 'expired', name: 'Expired film', cat: 'Vintage', sub: 'Magenta shadows, green whites', sw: '#a06a8a', p: { contrast: -0.03, lift: 0.07, roll: 0.04, sat: 0.86, sh: [0.02, -0.008, 0.02], hi: [-0.004, 0.016, -0.01] } },
  { id: 'xpro', name: 'Cross process', cat: 'Vintage', sub: 'Yellow-green lights, blue darks', sw: '#b8c23a', p: { contrast: 0.22, sat: 1.15, chGamma: [0.92, 0.9, 1.25], sh: [-0.016, 0, 0.04], hi: [0.02, 0.03, -0.04] } },
  { id: 'instant', name: 'Instant film', cat: 'Vintage', sub: 'Milky blacks, cyan shadows', sw: '#9fc7c2', p: { contrast: 0.0, lift: 0.08, roll: 0.07, sat: 0.86, sh: [-0.016, 0.012, 0.016], hi: [0.02, 0.012, -0.012] } },
  { id: 'kodak80s', name: '1980s snapshot', cat: 'Vintage', sub: 'Red-warm, flash-era colour', sw: '#d0583a', p: { contrast: 0.1, lift: 0.04, roll: 0.03, sat: 1.06, hi: [0.03, 0.006, -0.02], sh: [0.014, 0, 0.004], hues: [{ c: R, w: 24, ds: 0.14 }] } },
  { id: 'autochrome', name: 'Autochrome', cat: 'Vintage', sub: 'Painterly early colour', sw: '#8a7a4a', p: { contrast: -0.06, lift: 0.06, roll: 0.08, sat: 0.66, mid: 1.05, hi: [0.016, 0.01, -0.016], sh: [0.006, 0.004, 0] } },

  // ---- landscape & travel
  { id: 'vividland', name: 'Vivid landscape', cat: 'Landscape & travel', sub: 'Deep skies, lush greens', sw: '#2f8f4a', p: { contrast: 0.14, sat: 1.2, hues: [{ c: B, w: 38, ds: 0.15, dl: -0.14 }, { c: G, w: 42, ds: 0.12 }] } },
  { id: 'autumn', name: 'Autumn glow', cat: 'Landscape & travel', sub: 'Greens pushed to gold and rust', sw: '#c9741f', p: { contrast: 0.1, lift: 0.015, sat: 1.06, hi: [0.02, 0.008, -0.02], hues: [{ c: G, w: 44, dh: -34, ds: 0.05 }, { c: Y, w: 20, dh: -14, ds: 0.2 }, { c: O, w: 16, ds: 0.2 }, { c: R, w: 20, ds: 0.15 }] } },
  { id: 'tropical', name: 'Tropical teal', cat: 'Landscape & travel', sub: 'Aqua water, warm skin', sw: '#2ab7b0', p: { contrast: 0.1, sat: 1.1, hi: [0.012, 0.004, -0.01], hues: [{ c: B, w: 40, dh: -30, ds: 0.1 }, { c: A, w: 28, ds: 0.2 }, { c: G, w: 40, dh: 10 }] } },
  { id: 'nordic', name: 'Nordic', cat: 'Landscape & travel', sub: 'Cold, clear, desaturated', sw: '#7f96a8', p: { contrast: 0.1, lift: 0.02, sat: 0.75, sh: [-0.012, 0, 0.016], hi: [-0.006, 0.002, 0.008], hues: [{ c: O, w: 16, ds: 0.15 }] } },
  { id: 'bluehour', name: 'Blue hour', cat: 'Landscape & travel', sub: 'Indigo shadows, warm lamps', sw: '#2d3f7a', p: { contrast: 0.12, lift: 0.015, sat: 1.05, mid: 1.08, sh: [-0.02, -0.004, 0.036], hi: [0.02, 0.008, -0.01] } },
  { id: 'hdrnat', name: 'Natural HDR', cat: 'Landscape & travel', sub: 'Open shadows, held highlights', sw: '#7fae8a', p: { contrast: -0.02, lift: 0.02, roll: 0.03, sat: 1.12, mid: 0.9 } },
]

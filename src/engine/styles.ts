/* Styles: one idea for what used to be "presets" and "looks".

   A style is a starting point with two optional parts:
     colour  - a film / LUT rendering (the old "look")
     finish  - changes to the sliders, e.g. +14 contrast, +22 vignette (the old "preset")
   A style sits underneath your own sliders. Your sliders are adjustments on top of it, so switching styles never
   throws your edits away, and every slider reads 0 at the style's own result. One Strength dial (0-100%) scales the
   whole style, colour and finish together.

   Settings keep `style` (an id) and `styleAmount`; resolve() turns them into the plain values the renderer uses. */
import { DEF, ID_CURVE, LOOKS, PRESETS, clone, curveIsId, eq } from './core'

export interface Style { id: string; name: string; cat: string; sub?: string; sw?: string; look?: string; lookAmount?: number; finish: Record<string, any>; user?: boolean }

export const RECIPES = 'Recipes', YOURS = 'Yours'
const NOT_FINISH = new Set(['look', 'lookAmount', 'style', 'styleAmount', 'glasses', 'lensBlur', 'bokehShape', 'bokehBoost', 'focusRange'])   // glasses and lens blur: about who and what is in the photo, not a style

const recipeStyles = (): Style[] => Object.entries(PRESETS as Record<string, any>).filter(([n]) => n !== 'Neutral').map(([name, p]) => {
  const { look, lookAmount, ...finish } = p
  const l = LOOKS.find(x => x.id === look)
  return { id: 'recipe:' + name, name, cat: RECIPES, sub: [l && l.id !== 'none' && l.name.replace(/ style$/, '') !== name ? l.name.replace(/ style$/, '') + ' colour' : '', describe(finish)].filter(Boolean).join(' · '), sw: l?.sw, look, lookAmount, finish }
})
const lookStyles = (): Style[] => LOOKS.map(l => ({ id: l.id, name: l.id === 'none' ? 'None' : l.name.replace(/ style$/, ''), cat: l.id === 'none' ? '' : l.cat, sub: l.id === 'none' ? 'The photo as developed, no style' : l.sub, sw: l.sw, look: l.id === 'none' ? undefined : l.id, finish: {} }))

let user: Style[] = []
export const setUserStyles = (list: Style[]) => { user = list }
export const userStyles = () => user
/* every style: None, the recipes, the film / LUT colours, then yours */
export function allStyles(): Style[] { const looks = lookStyles(); return [looks[0], ...recipeStyles(), ...looks.slice(1), ...user] }
export const styleById = (id: string | undefined) => (id && id !== 'none' ? allStyles().find(s => s.id === id) : undefined)
export const styleCats = () => { const seen: string[] = []; for (const s of allStyles()) if (s.cat && !seen.includes(s.cat)) seen.push(s.cat); return seen }

const LABELS: Record<string, string> = { exposure: 'exposure', contrast: 'contrast', highlights: 'highlights', shadows: 'shadows', whites: 'whites', blacks: 'blacks', clarity: 'clarity', texture: 'texture', dehaze: 'dehaze', vibrance: 'vibrance', saturation: 'saturation', vignette: 'vignette', grain: 'grain', fade: 'fade', temp: 'warmth', tint: 'tint', faceLight: 'face light' }
/* a short human summary of a finish, e.g. "+14 contrast, +22 vignette" */
export function describe(finish: Record<string, any>, max = 3) {
  const parts = Object.entries(finish).filter(([k, v]) => LABELS[k] && typeof v === 'number' && v !== DEF[k])
    .sort((a, b) => Math.abs(b[1] - DEF[b[0]]) - Math.abs(a[1] - DEF[a[0]]))
    .map(([k, v]) => { const d = v - DEF[k]; return `${d > 0 ? '+' : ''}${k === 'exposure' ? d.toFixed(2) : Math.round(d)} ${LABELS[k]}` })
  if (finish.bw) parts.unshift('black & white')
  return parts.slice(0, max).join(', ') + (parts.length > max ? '…' : '')
}

const lerpCurve = (pts: number[][], a: number) => pts.map(([x, y]) => [x, x + (y - x) * a])
/* the plain renderer settings for user settings that name a style */
export function resolve(s: Record<string, any>): Record<string, any> {
  const st = styleById(s.style), a = Math.max(0, Math.min(1, (s.styleAmount ?? 100) / 100)), out: Record<string, any> = { ...s }
  out.look = st?.look || 'none'; out.lookAmount = (st?.lookAmount ?? 100) * a
  if (!st || a === 0) return out
  for (const [k, v] of Object.entries(st.finish)) {
    if (NOT_FINISH.has(k) || !(k in DEF)) continue
    if (k === 'bw') { if (v) out.bw = 1; continue }
    if (k === 'curve') { out.curve = { ...s.curve }; for (const ch of ['m', 'r', 'g', 'b']) if (eq(s.curve?.[ch] ?? ID_CURVE, ID_CURVE) && v?.[ch]) out.curve[ch] = lerpCurve(v[ch], a); continue }
    if (/^g(Sh|Mid|Hi)Hue$/.test(k)) { if (!(s[k.replace('Hue', 'Sat')] > 0)) out[k] = v; continue }   // an angle: yours wins once you grade that range
    if (typeof v === 'number' && typeof DEF[k] === 'number') out[k] = (s[k] ?? DEF[k]) + (v - DEF[k]) * a
  }
  return out
}

/* a new style that reproduces these user settings exactly (style, strength and sliders baked together) */
export function bake(name: string, s: Record<string, any>): Style {
  const r = resolve(s), finish: Record<string, any> = {}
  for (const k in DEF) if (!NOT_FINISH.has(k) && !eq(r[k], DEF[k])) finish[k] = clone(r[k])
  if (curveIsId(finish.curve)) delete finish.curve
  const look = r.look && r.look !== 'none' ? r.look : undefined
  return { id: 'user:' + name, name, cat: YOURS, sub: describe(finish) || 'Saved style', sw: LOOKS.find(l => l.id === look)?.sw, look, lookAmount: look ? r.lookAmount : undefined, finish, user: true }
}
/* a style from imported settings (a Lightroom .xmp preset, or a saved preset from before styles existed) */
export function fromSettings(name: string, s: Record<string, any>): Style {
  const { look, lookAmount, style, styleAmount, ...finish } = s
  const l = look && look !== 'none' ? look : undefined
  return { id: 'user:' + name, name, cat: YOURS, sub: describe(finish) || 'Imported', sw: LOOKS.find(x => x.id === l)?.sw, look: l, lookAmount, finish, user: true }
}
/* settings saved before styles existed carry `look` / `lookAmount` directly */
export function migrate(s: Record<string, any> | undefined) {
  if (!s) return s
  if ('look' in s || 'lookAmount' in s) {
    if (s.look && s.look !== 'none' && !s.style) { s.style = s.look; s.styleAmount = s.lookAmount ?? 100 }
    delete s.look; delete s.lookAmount
  }
  return s
}

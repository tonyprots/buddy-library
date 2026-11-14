// Цвет худи под презентацию: при запуске бадди просматривает слайды, находит преобладающий
// насыщенный цвет (акцент деки) и красит худи в него. Серые, почти белые и почти чёрные цвета
// не участвуют: фон и основной текст есть в любой деке и про стиль ничего не говорят.

/** Исходное синее худи: 3D-материал и три тона SVG-рисунка (свет, основа, тень). */
export const defaultHoodie = Object.freeze({
  color: '#1340E0',
  look: Object.freeze({ base: '#1340E0', shade: Object.freeze([.55, .58, .78]), hi: Object.freeze([1.12, 1.12, 1.06]), ol: '#0A1F6E' }),
  svg: Object.freeze(['#5577F0', '#1340E0', '#0A2A9E'])
})

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const hex2 = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
const toHex = ([r, g, b]) => ('#' + hex2(r) + hex2(g) + hex2(b)).toUpperCase()

/** '#rgb', '#rrggbb', 'rgb()/rgba()' в [r, g, b, a]; остальное — null. */
export function parseColor(value) {
  if (typeof value !== 'string') return null
  const s = value.trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(s)
  if (m) return [...m[1]].map(c => parseInt(c + c, 16)).concat(1)
  m = /^#([0-9a-f]{6})$/.exec(s)
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1)
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s)
  if (!m) return null
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  return [+m[1], +m[2], +m[3], clamp(a, 0, 1)]
}

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/** Цвет годится в акцент: заметно насыщенный и не теряется на белом или чёрном. */
export function isAccentColor(rgb) {
  const [r, g, b] = rgb, chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255, l = toHsl(rgb)[2]
  return chroma >= .25 && l >= .18 && l <= .88
}

const BINS = 24

/**
 * Выбор акцента из образцов { color, weight }. Цвета раскладываются по оттенку (24 сектора
 * по 15°), сектор сглаживается соседями — побеждает семейство оттенков, а не одна точная краска.
 * Внутри победившего семейства берётся самая «тяжёлая» точная краска. Слишком мало цвета — null.
 */
export function pickAccent(samples, { minWeight = 120 } = {}) {
  const bins = new Array(BINS).fill(0), exact = new Map()
  let total = 0
  for (const { color, weight } of samples) {
    const rgb = Array.isArray(color) ? color : parseColor(color)
    if (!rgb || !(weight > 0)) continue
    const w = weight * (rgb[3] ?? 1)
    if ((rgb[3] ?? 1) < .35 || !isAccentColor(rgb)) continue
    const bin = Math.floor(toHsl(rgb)[0] / (360 / BINS)) % BINS, key = toHex(rgb)
    bins[bin] += w; total += w
    const e = exact.get(key) || { bin, weight: 0 }; e.weight += w; exact.set(key, e)
  }
  if (total < minWeight) return null
  let best = 0, bestScore = -1
  for (let i = 0; i < BINS; i++) {
    const score = bins[i] + .5 * (bins[(i + BINS - 1) % BINS] + bins[(i + 1) % BINS])
    if (score > bestScore) { bestScore = score; best = i }
  }
  const near = i => i === best || i === (best + 1) % BINS || i === (best + BINS - 1) % BINS
  let color = null, top = -1
  for (const [key, e] of exact) if (near(e.bin) && e.weight > top) { top = e.weight; color = key }
  return color && { color, share: +(bestScore / total).toFixed(3) }
}

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line'])

/**
 * Образцы цвета со всех слайдов, включая скрытые. Текст весит по числу знаков и кеглю, фон — по
 * площади (у скрытого слайда площади нет, берётся средняя карточка), рамка — по толщине, фигуры SVG
 * — фиксированно. Картинки не разбираются.
 */
export function collectColorSamples(stage, getStyle = globalThis.getComputedStyle?.bind(globalThis), slides) {
  const out = []
  if (!stage || typeof getStyle !== 'function') return out
  const nodes = slides ? new Set(slides.flatMap(slide => [slide, ...slide.querySelectorAll('*')])) : stage.querySelectorAll(':scope > .slide, :scope > .slide *')
  for (const el of nodes) {
    if (el.closest?.('[data-buddy-ignore], .buddy')) continue
    let cs
    try { cs = getStyle(el) } catch { continue }
    if (!cs) continue
    let text = 0
    for (const n of el.childNodes || []) if (n.nodeType === 3) text += n.nodeValue.trim().length
    const fs = parseFloat(cs.fontSize) || 16
    if (text) out.push({ color: cs.color, weight: text * (fs / 16) ** 2 })
    const area = (el.offsetWidth || 0) * (el.offsetHeight || 0)
    if (cs.backgroundColor) out.push({ color: cs.backgroundColor, weight: (area || 2500) / 40 })
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = parseFloat(cs[`border${side}Width`])
      if (w >= 1 && cs[`border${side}Style`] !== 'none') out.push({ color: cs[`border${side}Color`], weight: w * 20 })
    }
    if (SHAPES.has(String(el.tagName).toLowerCase())) {
      out.push({ color: cs.fill, weight: 60 })
      const sw = parseFloat(cs.strokeWidth)
      if (sw > 0) out.push({ color: cs.stroke, weight: 20 * sw })
    }
  }
  return out
}

/** Палитра худи из одного цвета: основа с поджатыми насыщенностью и светлотой, свет, тень, контур. */
export function hoodiePalette(color) {
  const rgb = Array.isArray(color) ? color : parseColor(color)
  if (!rgb) throw new TypeError('Hoodie color must be #rgb, #rrggbb or rgb()')
  const [h, s0, l0] = toHsl(rgb), s = clamp(s0, .55, .95), l = clamp(l0, .42, .58)
  const base = toHex(fromHsl(h, s, l))
  return Object.freeze({
    color: base,
    look: Object.freeze({ base, shade: Object.freeze([.62, .56, .64]), hi: Object.freeze([1.1, 1.1, 1.05]),
      ol: toHex(fromHsl(h, s * .9, Math.max(.12, l * .38))) }),
    svg: Object.freeze([toHex(fromHsl(h, s, l + .12)), base, toHex(fromHsl(h, s, l - .17))])
  })
}

/**
 * Итог для опции hoodie: 'auto' — акцент деки или исходное синее, 'default' — всегда синее,
 * цвет — он и есть. Возвращает палитру и откуда она взялась.
 */
export function resolveHoodie(option, stage, getStyle, slides) {
  if (option === 'default') return { source: 'default', ...defaultHoodie }
  if (option !== 'auto') return { source: 'option', ...hoodiePalette(option) }
  const accent = pickAccent(collectColorSamples(stage, getStyle, slides))
  return accent ? { source: 'deck', share: accent.share, ...hoodiePalette(accent.color) } : { source: 'default', ...defaultHoodie }
}

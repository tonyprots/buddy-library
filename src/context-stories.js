import { reachArm } from './new-abilities.js'
import { createStoryPropBuilders } from './context-story-props.js'
import { contextSource, sameContextSource } from './context-source.js'

const entries = [
  ['thinkKeyword', 'Think about an idea', 'Rereads a word or short statement, touches the temple, holds the exact thought and lowers the hands.', 7.6, ['keyword', 'text']],
  ['compareValues', 'Compare values', 'Raises two cards, projects their exact values and folds them away without judging the result.', 9.4, ['values']],
  ['followChart', 'Follow a chart', 'Takes out a light pointer, follows the actual chart points and puts it away.', 10, ['chart']],
  ['chartClimb', 'Climb the bars', 'Climbs two or three accessible bar tops in order, reads their values, descends and returns.', 24, ['bars']],
  ['cardRoute', 'Follow a card route', 'Climbs two or three accessible cards in order, reads each one and returns to the starting point on the floor.', 25, ['route']],
  ['traceFlow', 'Trace a diagram', 'Follows up to three marked links, turning off the beam and smoothly repositioning the pointer between them.', 10.8, ['flow']],
  ['inspectDetail', 'Inspect a detail', 'Raises a magnifying glass, shows an enlarged optical projection of the marked crop and lowers it.', 9.6, ['detail']],
  ['assembleList', 'Assemble a list', 'Takes out cards with the original list items, stacks them in the author\'s order and puts them away.', 11.6, ['list']],
  ['showBeforeAfter', 'Show an image pair', 'Opens the two source images side by side, looks at each and closes the frames.', 10.4, ['images']],
  ['quoteIdea', 'Read a quote', 'Takes out a card, projects the exact wording above it, reads it and folds it away.', 8.8, ['text']]
], clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)),
  smooth = x => (x = clamp(x), x * x * (3 - 2 * x)),
  phase = (t, a, b) => smooth((t - a) / (b - a)),
  windowAt = (t, a, b, c, d) => phase(t, a, b) * (1 - phase(t, c, d)),
  lerp = (a, b, u) => a + (b - a) * u,
  pointMix = (a, b, u) => a.map((value, i) => lerp(value, b[i], u)),
  isPoint = p => Number.isFinite(p?.x) && Number.isFinite(p?.y),
  isBounds = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1],
  targetBounds = p => [p.x - p.width / 2, p.y - p.height / 2, p.x + p.width / 2, p.y + p.height / 2],
  union = boxes => boxes.length ? [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
    Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))] : null

export const storyTechniques = Object.freeze(entries.map(([id, title, description, duration, kinds]) =>
  Object.freeze({ id, title, description, duration, contextKinds: Object.freeze(kinds), requires: 'floor',
    group: 'Slide context', tags: Object.freeze(['context']),
    preset: ['compareValues', 'followChart', 'traceFlow', 'assembleList', 'showBeforeAfter'].includes(id) ? 'superhuman' : 'base' })))
const registry = new Map(storyTechniques.map(entry => [entry.id, entry]))
const thoughtSymbols = {
  memory: 'M-11-11H11V11H-11ZM-6-5H6M-6 0H6M-6 5H3M-16-7H-11M-16 0H-11M-16 7H-11M11-7H16M11 0H16M11 7H16',
  target: 'M0-14A14 14 0 1 0 0 14A14 14 0 1 0 0-14M0-7A7 7 0 1 0 0 7A7 7 0 1 0 0-7M0-2V2M-2 0H2',
  team: 'M-10-5A4 4 0 1 0-10 3A4 4 0 1 0-10-5M10-5A4 4 0 1 0 10 3A4 4 0 1 0 10-5M0-13A4 4 0 1 0 0-5A4 4 0 1 0 0-13M-16 13Q-10 0-4 13M4 13Q10 0 16 13M-7 4Q0-8 7 4',
  chain: 'M-16-7H-7V4H-16ZM-4-7H5V4H-4ZM8-7H17V4H8ZM-9-1H-2M3-1H10',
  link: 'M-2-7L-7-12Q-14-17-16-9Q-17-5-12-1L-5 6Q0 11 5 6M2 7L7 12Q14 17 16 9Q17 5 12 1L5-6Q0-11-5-6M-6-6L6 6',
  cloud: 'M-12 10C-22 9-20-5-11-5C-10-18 8-19 11-6C24-7 25 10 13 10Z',
  rules: 'M-12-15H12V15H-12ZM-7-7L-4-4L0-9M4-6H8M-7 5L-4 8L0 3M4 6H8',
  search: 'M-3-14A10 10 0 1 0-3 6A10 10 0 1 0-3-14M5 3L15 14'
}
let serial = 0

/** Копирование делается при запуске; исходные узлы и их ID остаются неизменными. */
function copyMedia(element, mk, parent, bounds, prefix, media) {
  const [x, y, x2, y2] = bounds
  if (/^svg$/i.test(element?.tagName || '') && element.cloneNode) {
    const clone = element.cloneNode(true), nodes = [clone, ...clone.querySelectorAll('*')], ids = new Map()
    nodes.forEach((node, i) => { const id = node.getAttribute('id'); if (id) ids.set(id, `${prefix}-${i}`) })
    for (const node of nodes) {
      if (/^(script|foreignObject)$/i.test(node.tagName)) { node.remove(); continue }
      for (const attr of Array.from(node.attributes)) {
        if (/^on/i.test(attr.name)) { node.removeAttribute(attr.name); continue }
        let value = attr.value.replace(/url\(\s*['"]?#([^\s)'"#]+)['"]?\s*\)/g,
          (match, id) => ids.has(id) ? `url(#${ids.get(id)})` : match)
        if (value.startsWith('#') && ids.has(value.slice(1))) value = '#' + ids.get(value.slice(1))
        node.setAttribute(attr.name, attr.name === 'id' ? ids.get(attr.value) : value)
      }
    }
    const width = media?.width || element.clientWidth || x2 - x,
      height = media?.height || element.clientHeight || y2 - y,
      viewport = mk('svg', { x, y, width: x2 - x, height: y2 - y,
        viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' }, parent),
      place = (svg, x, y, width, height) => {
        for (const [key, value] of Object.entries({ x, y, width, height })) {
          svg.setAttribute(key, value); svg.style?.setProperty?.(key, value + 'px', 'important')
        }
        for (const [key, value] of Object.entries({ transform: 'none', translate: 'none', rotate: 'none',
          scale: 'none', zoom: '1', position: 'static', inset: 'auto',
          'min-width': '0px', 'min-height': '0px', 'max-width': 'none', 'max-height': 'none' }))
          svg.style?.setProperty?.(key, value, 'important')
        svg.removeAttribute('transform')
      }
    // bounds уже содержат корневое масштабирование. Внешний viewport применяет его один раз;
    // исходный viewBox, letterboxing, paint и дочерние transforms сохраняются внутри clone.
    place(viewport, x, y, x2 - x, y2 - y); place(clone, 0, 0, width, height)
    viewport.appendChild(clone)
    return viewport
  }
  return mk('image', { x, y, width: x2 - x, height: y2 - y, preserveAspectRatio: 'xMidYMid meet',
    href: element?.currentSrc || element?.src || '' }, parent)
}

/** Отдельный проигрыватель десяти историй; в кадрах используются только числовые снимки. */
export function createStoryPlayer(raw, { host, context = () => null } = {}) {
  const { B, W } = raw, { pose, mix, solve, gest, S, mk, custom } = raw.tools,
    rest = pose({ hy: 10, smile: .35 }), owned = new Set(), effects = new Set(),
    measure = document.createElement('canvas').getContext?.('2d'), layouts = new Map(),
    layoutText = (text, width, font) => {
      const key = JSON.stringify([text, width, font])
      if (layouts.has(key)) return layouts.get(key)
      if (measure) measure.font = `400 ${font}px system-ui,sans-serif`
      const size = text => measure ? measure.measureText(text).width : Array.from(text).length * font * .66,
        lines = [''], tokens = String(text).match(/\S+\s*|\s+/gu) || []
      for (const token of tokens) {
        if (size(token.trimEnd()) > width) {
          for (const char of Array.from(token)) {
            const n = lines.length - 1
            if (lines[n] && size(lines[n] + char) > width) lines.push(char)
            else lines[n] += char
          }
        } else {
          const n = lines.length - 1
          if (lines[n] && size((lines[n] + token).trimEnd()) > width) lines.push(token)
          else lines[n] += token
        }
      }
      const result = { lines, height: lines.length * font * 1.35, font }
      if (layouts.size >= 512) layouts.delete(layouts.keys().next().value)
      layouts.set(key, result); return result
    }
  let active = null, dead = false
  raw.tools.registerPropBuilders?.(createStoryPropBuilders)

  const world = p => [B.x + (p[0] * Math.cos(B.yaw) - p[2] * Math.sin(B.yaw)) * S * B.scale,
      B.y + p[1] * S * B.scale],
    local = (k, p) => k.T.map(axis => axis.reduce((sum, value, i) => sum + value * p[i], 0)),
    low = p => Math.max(...solve(p, 1, 0).legs.flatMap(leg => [leg.heel[1], leg.toe[1]])),
    ground = (p, y = W.floor.y) => y - low(p) * S * B.scale,
    floorSpan = x => W.floor.spans.find(([a, b]) => x >= a + 10 && x <= b - 10),
    route = selection => {
      const items = selection.fact.structure?.items
      if (!items || items.length < 2 || items.length > 3) return null
      const margin = Math.max(10, 30 * S * B.scale), result = []
      let from = B.x
      for (const item of items) {
        const bounds = targetBounds(item.target), plat = W.plats.find(p => Math.abs(p.y - bounds[1]) < 7
          && Math.abs(p.x1 - bounds[0]) < 9 && Math.abs(p.x2 - bounds[2]) < 9)
        if (!plat) return null
        const spanAt = wall => plat.spans?.find(([a, b]) => wall.topX >= a && wall.topX <= b && b - a >= 2 * margin),
          walls = W.walls.filter(w => w.plat === plat && w.h <= 360 && w.h > 0 && w.gap <= 175
            && Math.abs(w.x - w.footX) <= 28 * S * B.scale
            && floorSpan(from) && floorSpan(w.footX) === floorSpan(from) && Math.abs(w.footX - from) <= 480 && spanAt(w)),
          wall = walls.sort((a, b) => Math.abs(a.footX - from) - Math.abs(b.footX - from))[0]
        if (!wall) return null
        const span = spanAt(wall)
        result.push({ item, plat, wall, span, margin, x: clamp(wall.topX, span[0] + margin, span[1] - margin), from })
        from = wall.footX
      }
      return Math.abs(from - B.x) <= 480 ? result : null
    },
    valid = selection => selection?.fact && isBounds(selection.bounds),
    can = id => {
      const entry = registry.get(id)
      if (!entry) return 'Unknown context story'
      if (dead) return 'Player has been destroyed'
      if (raw.reduced) return 'Reduced motion'
      if (B.mode !== 'ground' || B.surf?.kind !== 'floor') return 'Requires a standing pose on the floor'
      const source = context(id)
      if (!valid(source) || !entry.contextKinds.includes(source.fact.kind)) return 'No compatible story source'
      const structure = source.fact.structure, items = structure?.items
      if (['thinkKeyword', 'quoteIdea'].includes(id)) return source.fact.text?.length > 0 && source.fact.text.length <= 180
        ? null : 'Requires an exact short statement'
      if (id === 'followChart') return structure?.points?.length >= 2 && structure.points.length <= 64 && structure.points.every(isPoint)
        ? null : 'Requires an explicitly marked chart line'
      if (!Array.isArray(items) || !items.length || items.some(item => typeof item.text !== 'string' || !isBounds(targetBounds(item.target || {}))))
        return 'Source has no measured parts'
      if (id === 'compareValues') return items.length === 2 && items.every(item => typeof item.value === 'string') && items[0].unit === items[1].unit
        ? null : 'Requires two values with the same unit'
      if (id === 'chartClimb' || id === 'cardRoute') {
        const journey = route(source)
        if (!journey) return 'Requires two or three accessible supports with a safe floor route'
        if (id === 'chartClimb' && journey.slice(1).some((part, i) => {
          const previous = journey[i], gap = Math.max(part.plat.x1 - previous.plat.x2, previous.plat.x1 - part.plat.x2, 0)
          return gap > 140 || Math.abs(part.plat.y - previous.plat.y) > 120
        })) return 'The gap or height difference between bars is too large'
        return null
      }
      if (id === 'traceFlow') {
        const ids = new Set(items.map(item => item.id)), edges = structure.edges
        if (edges?.length > 3) return 'Use no more than three diagram links per story'
        return items.length <= 12 && edges?.length > 0
          && edges.every(edge => ids.has(edge.from) && ids.has(edge.to) && edge.points?.length >= 2 && edge.points.every(isPoint))
          ? null : 'Requires nodes and explicit diagram links'
      }
      if (id === 'assembleList') {
        if (items.length > 8) return 'A story can contain up to eight lines'
        const height = items.reduce((sum, item) => sum + Math.max(34, layoutText(item.text, 245, 18).height + 14), 0) + (items.length - 1) * 8
        return height <= Math.min(500, W.floor.y - 160) ? null : 'The list does not fit; shorten its lines or reduce the number of items'
      }
      const parts = source.parts || [], media = part => /^(img|svg)$/i.test(part?.element?.tagName || '') && isBounds(part.bounds)
      if (id === 'showBeforeAfter' || id === 'inspectDetail') {
        const unsupported = parts.find(part => part.media?.copyable === false)
        if (unsupported) return unsupported.media.reason || 'The image cannot be copied accurately into this scene'
      }
      if (id === 'showBeforeAfter') return items.length === 2 && items.every(item => media(parts.find(part => part.id === item.id)))
        ? null : 'Requires an explicitly marked image pair'
      const crop = structure.crop
      if (!(items.length === 1 && media(parts.find(part => part.id === items[0].id)) && isPoint(crop)
        && Number.isFinite(crop.width) && Number.isFinite(crop.height) && crop.width > 0 && crop.height > 0)) return 'Requires a marked image crop'
      return Math.min(244, Math.max(160, Math.max(crop.width, crop.height) * 1.7)) / Math.max(crop.width, crop.height) >= 1.5
        ? null : 'Choose a smaller image crop to magnify'
    }

  function finish(drop = false) {
    const previous = active
    active = null
    for (const state of owned) state.done = true
    for (const effect of effects) { effect.age = effect.life; effect.el?.remove() }
    owned.clear(); effects.clear(); previous?.restore()
    if (drop && previous?.route && B.act === previous.action && B.mode === 'free' && raw.fall) raw.begin(raw.fall(0))
  }

  function create(id) {
    if (can(id)) return null
    finish(true)
    const resolved = context(id), selection = { ...resolved, fact: JSON.parse(JSON.stringify(resolved.fact)),
      bounds: [...resolved.bounds], parts: (resolved.parts || []).map(part => ({ ...part, bounds: [...part.bounds] })) },
      entry = registry.get(id), fact = selection.fact, bounds = [...selection.bounds],
      structure = fact.structure, items = structure?.items || [], paths = id === 'followChart' ? [structure.points]
        : id === 'traceFlow' ? structure.edges.map(edge => edge.points) : [],
      journey = ['chartClimb', 'cardRoute'].includes(id) ? route(selection) : null,
      duration = entry.duration, start = [B.x, B.y], startFace = B.face, ci = startFace > 0 ? 0 : 1, fi = 1 - ci,
      camera = .36, turn = Math.sin(camera * Math.PI / 2), uid = `buddy-story-${++serial}`,
      source = contextSource(selection),
      session = { id, action: null, route: journey, restore: null, source },
      panels = [], original = [bounds[0], bounds[1], bounds[2], bounds[3]],
      show = t => windowAt(t, .6, 1.5, duration - 1.6, duration - .35),
      hold = t => phase(t, 0, .5) * (1 - phase(t, duration - .35, duration - .04)),
      readDuration = .75, walkEnd = 2.3, riseEnd = 3.6, mountEnd = 4.3,
      readEnd = mountEnd + readDuration, offEnd = readEnd + .8, downEnd = offEnd + 1.3, cycle = downEnd + .15,
      routeTime = t => t / (duration - .25) * (.5 + (journey?.length || 0) * cycle + 2),
      pathPoint = t => {
        if (!paths.length) return null
        if (id === 'traceFlow') {
          const position = clamp((t - 2) / (duration - 4.4)) * paths.length,
            index = Math.min(paths.length - 1, Math.floor(position)), f = position - index, points = paths[index],
            redirect = (a, b, u) => {
              const center = [start[0], start[1] - 20], ax = a.x - center[0], ay = a.y - center[1],
                bx = b.x - center[0], by = b.y - center[1], angle = Math.atan2(ay, ax),
                delta = ((Math.atan2(by, bx) - angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI,
                v = smooth(u), radius = lerp(Math.hypot(ax, ay), Math.hypot(bx, by), v)
              return { x: center[0] + Math.cos(angle + delta * v) * radius,
                y: center[1] + Math.sin(angle + delta * v) * radius, index, light: 0, pointing: 0 }
            }
          // Невидимое перенаведение идёт по углу вокруг героя; новой связи на слайде нет.
          if (index > 0 && f < .18) return redirect(paths[index - 1].at(-1), points[0], (.28 + f) / .46)
          if (index < paths.length - 1 && f > .72) return redirect(points.at(-1), paths[index + 1][0], (f - .72) / .46)
          const along = clamp((f - .18) / .5) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(along)),
            a = points[i], b = points[i + 1], v = smooth(along - i)
          return { x: lerp(a.x, b.x, v), y: lerp(a.y, b.y, v), index,
            light: windowAt(f, .18, .25, .62, .70), pointing: windowAt(f, .18, .36, .55, .72) }
        }
        const u = clamp((t - 2) / (duration - 4.4)), index = Math.min(paths.length - 1, Math.floor(u * paths.length)),
          points = paths[index], along = Math.min(points.length - 1, (u * paths.length - index) * (points.length - 1)),
          i = Math.min(points.length - 2, Math.floor(along)), a = points[i], b = points[i + 1], v = smooth(along - i)
        return { x: lerp(a.x, b.x, v), y: lerp(a.y, b.y, v), index }
      },
      reading = t => clamp((t - 2.2) / Math.max(1, duration - 5)),
      aim = (p, arm, target) => reachArm(p, arm, target, turn)
    let action, layer, gaze, thought, quote, lens, cursor, beam, trace, listGroup, flatStylus, flatLens, toolPlaced, dynamicDetail = null
    const sourceMarks = [], projectionLinks = [], listRows = [], flatPanels = [], projectionPlaced = [],
      panelPlaced = [0, 1].map(index => (x, y) => {
        if (active === session && B.act === action) projectionPlaced[index]?.(x, y)
      }),
      stylusPlaced = (x, y, zX, zY) => {
        if (active === session && B.act === action) toolPlaced?.(x + zX * 16, y + zY * 16)
      },
      lensSize = id === 'inspectDetail' ? Math.min(244, Math.max(160, Math.max(structure.crop.width, structure.crop.height) * 1.7)) : 0,
      lensRadius = lensSize / 2 + 6,
      lensPosition = () => {
        const r = lensRadius, box = selection.parts.find(part => part.id === items[0].id).bounds,
          y = clamp(start[1] - 160, r + 20, 720 - r - 20),
          candidates = [clamp(start[0] - r - 85, r + 20, 1280 - r - 20), clamp(start[0] + r + 85, r + 20, 1280 - r - 20), r + 20, 1280 - r - 20],
          cost = x => Math.max(0, Math.min(x + r, box[2]) - Math.max(x - r, box[0]))
            * Math.max(0, Math.min(y + r, box[3]) - Math.max(y - r, box[1])) * 1000 + Math.abs(x - start[0])
        return [candidates.sort((a, b) => cost(a) - cost(b))[0], y]
      }

    const chartPlan = []
    if (id === 'chartClimb') {
      const first = journey[0], last = journey.at(-1)
      let time = 0, topX = first.x
      const segment = (kind, seconds, values) => { chartPlan.push({ kind, from: time, to: time + seconds, ...values }); time += seconds }
      segment('prepare', .4, { part: first, a: start[0], b: start[0] })
      segment('walk', 1.7, { part: first, a: start[0], b: first.wall.footX })
      segment('climb', 1.35, { part: first, a: first.wall.footX, b: first.wall.footX })
      segment('mount', .6, { part: first, a: first.wall.footX, b: first.x })
      segment('read', .8, { part: first, a: first.x, b: first.x })
      for (const [i, next] of journey.slice(1).entries()) {
        const previous = journey[i], side = Math.sign((next.plat.x1 + next.plat.x2) - (previous.plat.x1 + previous.plat.x2)),
          takeoff = side > 0 ? previous.span[1] - previous.margin : previous.span[0] + previous.margin,
          landing = side > 0 ? next.span[0] + next.margin : next.span[1] - next.margin
        segment('topWalk', .8, { part: previous, a: topX, b: takeoff })
        segment('jump', 1.4, { part: previous, next, a: takeoff, b: landing })
        segment('read', .9, { part: next, a: landing, b: landing })
        topX = landing
      }
      segment('topWalk', .8, { part: last, a: topX, b: last.x })
      segment('dismount', .6, { part: last, a: last.x, b: last.wall.footX })
      segment('descend', 1.35, { part: last, a: last.wall.footX, b: last.wall.footX })
      segment('walk', 2, { part: last, a: last.wall.footX, b: start[0] })
      segment('finish', .4, { part: last, a: start[0], b: start[0] })
    }

    function routePose(wall, y, time, topContact) {
      const p = pose({ still: 1, hf: [42, 35], kf: [70, 62], hp: -15, hy: 3 }), k = solve(p, 1, 0)
      for (const i of [0, 1]) {
        const x = Math.max(6, (wall.x - B.x) / ((B.face || 1) * S * B.scale)),
          cy = -29 - 5 * Math.sin(time * 8 + i * Math.PI), ty = (wall.top - y) / (S * B.scale),
          target = local(k, [x, lerp(cy, ty, topContact), i ? -8 : 8]), shoulder = [0, -24.4, i ? -9.2 : 9.2],
          delta = target.map((value, axis) => value - shoulder[axis]), length = Math.hypot(...delta),
          // Согнутый локоть не проходит через сингулярность полного разгибания; зазор меньше толщины ладони.
          grip = length > 27.2 ? shoulder.map((value, axis) => value + delta[axis] * 27.2 / length) : target
        reachArm(p, i, grip, 0)
      }
      return p
    }

    function chartMovement(t) {
      const clock = t / duration * chartPlan.at(-1).to, part = chartPlan.find(part => clock < part.to) || chartPlan.at(-1),
        u = clamp((clock - part.from) / (part.to - part.from)), v = smooth(u), { wall, plat } = part.part,
        p = pose({ still: 1, hp: -10, hy: 3 }), floorY = ground(rest), topY = ground(rest, plat.y), readyY = plat.y + 29.4 * S * B.scale,
        walk = (a, b) => {
          const swing = Math.sin((B.x - a) / 48 * Math.PI * 2) * Math.sin(Math.PI * u)
          p.hf = [18 * swing, -18 * swing]; p.kf = [8 + Math.max(0, -swing) * 18, 8 + Math.max(0, swing) * 18]
          p.sf = [-16 * swing, 16 * swing]; p.ef = [18, 18]; B.face = Math.sign(b - a) || startFace
        }
      B.mode = 'free'; B.surf = W.floor; B.surfY = W.floor.y; B.anchor = null; B.face = -wall.side
      B.x = lerp(part.a, part.b, v)
      if (part.kind === 'walk') { walk(part.a, part.b); B.y = ground(p) }
      else if (part.kind === 'topWalk') { walk(part.a, part.b); B.y = ground(p, plat.y); B.surf = plat; B.surfY = plat.y }
      else if (part.kind === 'jump') {
        const nextY = ground(rest, part.next.plat.y), arc = 48 + Math.abs(nextY - topY) * .2
        B.face = Math.sign(part.b - part.a) || startFace
        B.y = lerp(topY, nextY, v) - 4 * arc * v * (1 - v)
        const flying = pose({ still: 1, hf: [45, 35], kf: [65, 55], sf: [-32, -32], ef: [30, 30], hp: -12 }),
          amount = windowAt(u, 0, .18, .8, 1)
        return mix(rest, flying, amount)
      } else if (part.kind === 'climb' || part.kind === 'descend') {
        const up = part.kind === 'climb'
        B.y = lerp(up ? floorY : readyY, up ? readyY : floorY, v)
        return mix(rest, routePose(wall, B.y, clock, up ? phase(u, .65, 1) : 1 - phase(u, 0, .35)),
          windowAt(u, 0, .15, .88, 1))
      } else if (part.kind === 'mount' || part.kind === 'dismount') {
        const up = part.kind === 'mount'
        B.y = lerp(up ? readyY : topY, up ? topY : readyY, v)
        return mix(rest, routePose(wall, B.y, clock, 1), Math.sin(Math.PI * u) * clamp((wall.x - B.x) * B.face / 10))
      } else if (part.kind === 'read') {
        B.y = topY; B.surf = plat; B.surfY = plat.y
        const read = pose({ still: 1, hp: 25, hy: 8 * Math.sin(clock * 1.5), tl: 5 })
        aim(read, ci, [18, -5, ci ? -8 : 8])
        return mix(rest, read, Math.sin(Math.PI * u))
      } else { B.y = floorY; B.face = startFace; B.mode = 'ground'; return rest }
      return mix(rest, p, Math.sin(Math.PI * u))
    }

    function moveRoute(t) {
      const p = raw.tools.copy(rest), elapsed = Math.max(0, routeTime(t) - .5),
        n = Math.min(journey.length - 1, Math.floor(elapsed / cycle)), part = journey[n],
        u = elapsed - n * cycle, { wall, plat, x, from } = part, outside = wall.footX,
        floorY = ground(rest), readyY = plat.y + 29.4 * S * B.scale, topY = ground(rest, plat.y),
        returning = elapsed >= journey.length * cycle
      const walk = (amount, fade = windowAt(u, 0, .3, walkEnd - .3, walkEnd)) => {
        const swing = Math.sin(amount * Math.PI * 2) * fade
        p.hf = [18 * swing, -18 * swing]; p.kf = [8 + Math.max(0, -swing) * 18, 8 + Math.max(0, swing) * 18]
        p.sf = [-16 * swing, 16 * swing]; p.ef = rest.ef.map(value => lerp(value, 18, fade))
      }
      B.mode = 'free'; B.surf = W.floor; B.surfY = W.floor.y; B.anchor = null
      if (returning) {
        const last = journey.at(-1).wall.footX, v = phase(elapsed, journey.length * cycle, journey.length * cycle + 2)
        B.x = lerp(last, start[0], v); walk((B.x - last) / 48, Math.sin(Math.PI * v)); B.y = ground(p)
        B.face = Math.sign(start[0] - last) || startFace
        if (v === 1) { B.x = start[0]; B.y = floorY; B.face = startFace; B.mode = 'ground'; return rest }
        return p
      }
      B.face = -wall.side
      if (u < walkEnd) {
        B.x = lerp(from, outside, phase(u, 0, walkEnd)); walk((B.x - from) / 48); B.y = ground(p)
        B.face = Math.sign(outside - from) || -wall.side
      } else if (u < riseEnd) {
        B.x = outside; B.y = lerp(floorY, readyY, phase(u, walkEnd, riseEnd))
      } else if (u < mountEnd) {
        const v = phase(u, riseEnd, mountEnd); B.x = lerp(outside, x, v); B.y = lerp(readyY, topY, v)
      } else if (u < readEnd) {
        B.x = x; B.y = topY; B.surf = plat; B.surfY = plat.y
        p.hp = 25; p.hy = Math.sin(u * 2) * 13; p.tl = 5
        aim(p, ci, [18, -5, ci ? -8 : 8])
      } else if (u < offEnd) {
        const v = phase(u, readEnd, offEnd)
        B.x = lerp(x, outside, v); B.y = lerp(topY, readyY, v)
      } else {
        B.x = outside; B.y = lerp(readyY, floorY, phase(u, offEnd, downEnd))
      }
      const climb = u >= walkEnd && u < mountEnd || u >= readEnd
      if (climb && u < downEnd) {
        const topContact = phase(u, riseEnd - .4, riseEnd) * (1 - phase(u, offEnd - .4, offEnd)),
          amount = windowAt(u, walkEnd, walkEnd + .3, riseEnd - .3, riseEnd + .25)
            + windowAt(u, offEnd - .15, offEnd + .35, downEnd - .35, downEnd)
        return mix(rest, routePose(wall, B.y, u, topContact), amount * smooth((wall.x - B.x) * B.face / 12))
      }
      if (u >= downEnd) { B.x = outside; B.y = floorY; return rest }
      if (u >= mountEnd && u < readEnd) return mix(rest, p, Math.sin(Math.PI * (u - mountEnd) / readDuration))
      return p
    }

    function sample(t) {
      if (journey) return id === 'chartClimb' ? chartMovement(t) : moveRoute(t)
      const amount = show(t), p = pose({ still: 1, smile: .35 }), scan = Math.sin(reading(t) * Math.PI * 2)
      if (id === 'thinkKeyword') {
        p.hp = -8; p.hy = 10 * Math.sin(t * 1.4); p.brow = .35
        aim(p, ci, [10, -42, ci ? -6 : 6]); aim(p, fi, [15, -12, fi ? -14 : 14])
      } else if (id === 'compareValues') {
        p.hy = scan * 27; p.hp = 5
        for (const i of [0, 1]) aim(p, i, [14, -1 + Math.sin(t * 1.7 + i * Math.PI), i ? -21 : 21])
      } else if (id === 'followChart' || id === 'traceFlow') {
        const target = pathPoint(t), tilt = target ? clamp((target.y - B.y) / 30, -23, 10) : -10
        B.face = id === 'traceFlow' ? startFace : t < duration - .35 ? Math.sign(target.x - B.x) || startFace : startFace
        p.hp = tilt; p.hy = 7 * scan
        const dx = target.x - B.x, dy = target.y - B.y, length = Math.hypot(dx, dy) || 1,
          armTurn = id === 'traceFlow' ? Math.sin(B.yaw) : turn, k = solve(p, 1, armTurn),
          targetHand = local(k, [id === 'traceFlow' ? Math.max(14, dx / length * 20 * Math.cos(B.yaw)) : dx / length * 20 * Math.cos(B.yaw),
            id === 'traceFlow' ? -4 : -24 + dy / length * 18,
            -dx / length * (id === 'traceFlow' ? 10 : 20) * Math.sin(B.yaw)])
        if (id === 'traceFlow') {
          // Кисть у пояса оставляет место физической указке под лицом;
          // на далёкую цель поворачивается инструмент. Сгиб сохраняет ветвь IK.
          const shoulder = [0, -24.4, ci ? -9.2 : 9.2], delta = targetHand.map((value, axis) => value - shoulder[axis]), distance = Math.hypot(...delta)
          if (distance > 27) targetHand.splice(0, 3, ...shoulder.map((value, axis) => value + delta[axis] * 27 / distance))
        }
        reachArm(p, ci, targetHand, armTurn)
        reachArm(p, fi, [11, -11, fi ? -9 : 9], armTurn)
        if (id === 'traceFlow') {
          for (const key of ['sf', 'sa', 'ef', 'ea']) p[key] = p[key].map((value, i) => lerp(rest[key][i], value, target.pointing))
          p.tl = 5 * Math.sin(t * 1.2); p.brow = .25
        }
      } else if (id === 'inspectDetail') {
        p.hp = -8; p.tl = 9 * phase(t, 2, 3) * (1 - phase(t, 6, 7)); p.hy = 8 * scan
        aim(p, ci, [24, -20, ci ? 6 : -6]); aim(p, fi, [12, -12, fi ? -10 : 10])
      } else if (id === 'assembleList') {
        const u = reading(t) * items.length, lift = Math.sin((u % 1) * Math.PI)
        p.hp = 18; p.hy = 10 * Math.sin(u * Math.PI)
        aim(p, ci, [15, -1 - lift * 3, ci ? -10 : 10]); aim(p, fi, [11, -1, fi ? -15 : 15])
      } else if (id === 'showBeforeAfter') {
        p.hp = 7; p.hy = 24 * scan
        aim(p, ci, [16, -1, ci ? -20 : 20]); aim(p, fi, [16, -1, fi ? -20 : 20])
      } else {
        p.hp = 15 + 3 * Math.sin(t * 2); p.hy = 10 * scan
        aim(p, ci, [19, -1, ci ? -14 : 14]); aim(p, fi, [19, -1, fi ? -14 : 14])
      }
      return mix(rest, p, amount)
    }

    const cleanup = () => { if (active === session) finish(); else restore() },
      restore = () => { B.restore = B.restore.filter(fn => fn !== cleanup); projectionPlaced.length = 0; toolPlaced = null },
      addProp = (name, update) => {
        if (raw.renderer !== 'webgl') return
        const state = raw.tools.prop3(name, (state, k) => {
          if (active !== session || B.act !== action) { state.done = true; return null }
          return update(action.t, k)
        })
        owned.add(state)
      },
      direction = () => [Math.sin(B.yaw + .15), 0, Math.cos(B.yaw + .15)],
      panelCenter = (hand, grip, scale) => {
        const d = direction()
        return [hand[0] + d[2] * grip[0] * scale, hand[1] + grip[1] * scale,
          hand[2] - d[0] * grip[0] * scale]
      },
      panelParams = (t, k, index) => {
        const arm = index ? fi : ci, scale = .6,
          grip = [index ? -20 : 20, -16, 0]
        return { at: k.arms[arm].hand, dir: direction(), grip, k: scale, fade: show(t), fold: 1 - phase(t, 1, 2),
          handContact: { kind: 'support', side: arm, amount: hold(t), near: grip, placed: panelPlaced[index] },
          text: id === 'quoteIdea' ? fact.text : [items[index]?.label, items[index]?.value || items[index]?.text].filter(Boolean).join('\n'), content: false,
          center: panelCenter(k.arms[arm].hand, grip, scale) }
      },
      lensParams = (t, k) => {
        const hand = k.arms[ci].hand, dir = direction(), diagonal = Math.SQRT1_2,
          candidate = [startFace * Math.cos(B.yaw) * diagonal, -diagonal, -startFace * Math.sin(B.yaw) * diagonal],
          dot = candidate.reduce((sum, value, i) => sum + value * dir[i], 0),
          projected = candidate.map((value, i) => value - dir[i] * dot), length = Math.hypot(...projected),
          up = projected.map(value => value / length), scale = 1.6 * show(t)
        return { at: hand, dir, up, grip: [0, -37, 0], k: scale, fade: show(t),
          center: hand.map((value, i) => value + up[i] * 37 * scale) }
      },
      toolParams = (t, k) => {
        const hand = k.arms[ci].hand, palm = world(hand), target = pathPoint(t),
          dx = (target.x - palm[0]) / (S * B.scale), dy = (target.y - palm[1]) / (S * B.scale),
          length = Math.hypot(dx, dy) || 1, dir = [dx * Math.cos(B.yaw) / length, dy / length, -dx * Math.sin(B.yaw) / length]
        return { at: hand, dir, up: Math.abs(dir[1]) > .9 ? [1, 0, 0] : [0, -1, 0], k: 1.4, fade: show(t),
          ...(id === 'traceFlow' ? { handContact: { kind: 'grip', side: ci, amount: hold(t), offset: [1.5, -1.4],
            aimAtW: [target.x, target.y], placed: stylusPlaced } } : {}),
          contact: windowAt(t, 1.6, 2, duration - 2.4, duration - 1.7) * (target.light ?? 1) }
      }
    session.restore = restore
    action = gest(id, duration, id === 'traceFlow'
      ? t => lerp(camera, 1, windowAt(t, .25, 1.6, duration - 1.3, duration - .35)) : camera, t => {
      for (const state of owned) state.ping = true
      const p = sample(t)
      if (['compareValues', 'showBeforeAfter', 'assembleList', 'quoteIdea'].includes(id)) {
        p.handTask = { kind: 'support', amount: [hold(t), hold(t)] }; p.handOpen = [hold(t), hold(t)]
      } else if (id === 'traceFlow') {
        p.handTask = { kind: 'grip', amount: ci ? [0, hold(t)] : [hold(t), 0], axis: toolParams(t, solve(p, 1, Math.sin(B.yaw))).dir }
        p.handFist = ci ? [0, .8 * hold(t)] : [.8 * hold(t), 0]
      }
      p.still = 1; B.cset = 0
      if (!journey && t > duration - 1.4) {
        B.anchor = null; B.x = lerp(B.x, start[0], phase(t, duration - 1.4, duration - .4))
      }
      if (t >= duration - .04) { restore(); for (const state of owned) state.done = true }
      return p
    }, { power: entry.preset === 'superhuman' })

    action.init = () => {
      active = session; session.action = action; B.restore.push(cleanup)
      if (['compareValues', 'showBeforeAfter', 'quoteIdea'].includes(id)) {
        const count = id === 'quoteIdea' ? 1 : 2
        for (let i = 0; i < count; i++) addProp('contextPanel' + i, (t, k) => panelParams(t, k, i))
      }
      if (id === 'assembleList') addProp('contextPanel0', (t, k) => {
        const current = Math.min(items.length - 1, Math.floor(reading(t) * items.length)),
          slot = Math.max(1, duration - 5) / items.length, from = 2.2 + current * slot, to = from + slot
        // Одна карта остаётся в ведущей ладони; новый текст появляется лишь после полного исчезновения.
        return { at: k.arms[ci].hand, dir: direction(), grip: [0, -16, 0], k: .6,
          fade: show(t) * windowAt(t, from + .04, from + .24, to - .24, to - .04),
          handContact: { kind: 'support', side: ci, amount: hold(t), near: [0, -16, 0] },
          text: items[current].text, fold: 0, content: true }
      })
      if (id === 'inspectDetail') addProp('contextLens', lensParams)
      if (paths.length) addProp('contextStylus', toolParams)

      const effect = custom(duration + .2, () => {
        layer = mk('g', { 'data-buddy-story-layer': '', 'data-context-action': id, 'pointer-events': 'none' })
        const textBlock = (parent, text, x, y, width, font = 18, layout = layoutText(text, width, font)) => {
            const node = mk('text', { x, y, 'font-size': font, 'font-family': 'system-ui,sans-serif', fill: '#173d33',
              'data-story-text': String(text) }, parent)
            layout.lines.forEach((line, i) => { mk('tspan', { x, dy: i ? font * 1.35 : 0 }, node).textContent = line })
            return layout.height
          },
          marks = items.length ? items.map(item => id === 'inspectDetail'
            ? [structure.crop.x, structure.crop.y, structure.crop.x + structure.crop.width, structure.crop.y + structure.crop.height]
            : targetBounds(item.target)) : [bounds]
        for (const box of marks) sourceMarks.push(mk('rect', { x: box[0] - 4, y: box[1] - 4, width: box[2] - box[0] + 8,
          height: box[3] - box[1] + 8, rx: 4, fill: 'none', stroke: '#23885c', 'stroke-width': 2, opacity: 0,
          'data-story-source-mark': '' }, layer))
        const linkCount = ['compareValues', 'showBeforeAfter'].includes(id) ? 2 : ['quoteIdea', 'inspectDetail', 'assembleList', 'thinkKeyword'].includes(id) ? 1 : 0
        for (let i = 0; i < linkCount; i++) projectionLinks.push(mk('path', { fill: 'none', stroke: '#23885c',
          'stroke-width': id === 'inspectDetail' ? 2 : 1.5, 'stroke-dasharray': '4 4', opacity: 0,
          'data-story-projection-link': '' }, layer))
        if (id === 'thinkKeyword') {
          const width = clamp(Array.from(fact.text).length * 12 + 68, 190, 360), layout = layoutText(fact.text, width - 68, 20), height = Math.max(66, layout.height + 28),
            symbol = mk('g', { transform: `translate(${-width / 2 + 28} ${-height + 29}) scale(.7)` })
          thought = mk('g', {}, layer); thought.storyBox = [-width / 2, -height, width / 2, 35]
          mk('rect', { x: -width / 2, y: -height, width, height, rx: 18, fill: '#fff', stroke: '#557d6e', 'stroke-width': 1.5 }, thought)
          thought.appendChild(symbol)
          if (thoughtSymbols[fact.concept]) mk('path', { d: thoughtSymbols[fact.concept], fill: 'none', stroke: '#357b57',
            'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-story-concept': fact.concept }, symbol)
          else for (const x of [-9, 0, 9]) mk('circle', { cx: x, cy: 0, r: 2, fill: '#357b57' }, symbol)
          textBlock(thought, fact.text, -width / 2 + 52, -height + 28, width - 68, 20, layout)
          for (const [x, y, r] of [[-18, 11, 6], [-28, 24, 3.5], [-34, 33, 2]])
            mk('circle', { cx: x, cy: y, r, fill: '#fff', stroke: '#557d6e' }, thought)
        }
        if (['compareValues', 'showBeforeAfter'].includes(id)) {
          for (const [i, item] of items.entries()) {
            const group = mk('g', { 'data-story-item': item.id }, layer), width = id === 'showBeforeAfter' ? 180 : 154,
              label = item.label || (id === 'showBeforeAfter' ? item.text : ''),
              labelLayout = label ? layoutText(label, width - 24, 14) : null,
              valueLayout = id === 'compareValues' ? layoutText(item.value, width - 24, 21) : null,
              height = id === 'showBeforeAfter' ? 140 + (labelLayout?.height || 0) : 34 + (labelLayout?.height || 0) + valueLayout.height
            group.storyBox = [-width / 2, -height, width / 2, 0]
            mk('rect', { x: -width / 2, y: -height, width, height, rx: 7, fill: '#f5fff9', stroke: '#5c9277', 'stroke-width': 1.5 }, group)
            if (id === 'showBeforeAfter') {
              const part = selection.parts.find(part => part.id === item.id), media = mk('svg', { x: -width / 2 + 8, y: -height + 8, width: width - 16,
                height: 112, viewBox: `${part.bounds[0]} ${part.bounds[1]} ${part.bounds[2] - part.bounds[0]} ${part.bounds[3] - part.bounds[1]}` }, group)
              copyMedia(part.element, mk, media, part.bounds, `${uid}-image-${i}`, part.media)
              if (labelLayout) textBlock(group, label, -width / 2 + 12, -height + 140, width - 24, 14, labelLayout)
            } else {
              if (labelLayout) textBlock(group, label, -width / 2 + 12, -height + 26, width - 24, 14, labelLayout)
              textBlock(group, item.value, -width / 2 + 12, -height + 26 + (labelLayout?.height || 0), width - 24, 21, valueLayout)
            }
            panels.push(group)
          }
        }
        if (paths.length) {
          beam = mk('path', { fill: 'none', stroke: '#248655', 'stroke-width': 1.4, 'stroke-dasharray': '4 5' }, layer)
          trace = mk('g', {}, layer)
          for (const points of paths) mk('polyline', { points: points.map(p => `${p.x},${p.y}`).join(' '),
            fill: 'none', stroke: '#28b87d', 'stroke-width': id === 'traceFlow' ? 4 : 3, opacity: .38 }, trace)
          cursor = mk('circle', { r: id === 'traceFlow' ? 9 : 5, fill: '#b1ffd9', stroke: '#146943', 'stroke-width': 2 }, layer)
          if (raw.renderer !== 'webgl') flatStylus = mk('path', { fill: 'none', stroke: '#315442', 'stroke-width': 4, 'stroke-linecap': 'round' }, layer)
        }
        if (id === 'inspectDetail') {
          const crop = structure.crop, part = selection.parts.find(part => part.id === items[0].id), defs = mk('defs', {}, layer),
            clip = mk('clipPath', { id: uid + '-lens' }, defs)
          mk('circle', { cx: 0, cy: 0, r: lensSize / 2 }, clip)
          lens = mk('g', {}, layer); lens.storyBox = [-lensRadius, -lensRadius, lensRadius, lensRadius]
          mk('circle', { r: lensRadius - 2, fill: '#f5fff9', stroke: '#4d9270', 'stroke-width': 5 }, lens)
          const viewport = mk('svg', { x: -lensSize / 2, y: -lensSize / 2, width: lensSize, height: lensSize,
            viewBox: `${crop.x} ${crop.y} ${crop.width} ${crop.height}`, 'clip-path': `url(#${uid}-lens)` }, lens)
          // Клип задаётся во внешней системе линзы, viewBox — в координатах исходного слайда.
          viewport.removeAttribute('clip-path')
          const clipped = mk('g', { 'clip-path': `url(#${uid}-lens)` }, lens)
          clipped.appendChild(viewport)
          copyMedia(part.element, mk, viewport, part.bounds, uid + '-crop', part.media)
          if (raw.renderer !== 'webgl') {
            flatLens = { handle: mk('path', { fill: 'none', stroke: '#315442', 'stroke-width': 3 }, layer),
              rim: mk('circle', { r: 17 * 1.6 * S * B.scale, fill: '#b1ffd938', stroke: '#315442', 'stroke-width': 2 }, layer) }
          }
        }
        if (id === 'assembleList') {
          listGroup = mk('g', {}, layer)
          let y = 0
          for (const [i, item] of items.entries()) {
            const row = mk('g', { 'data-story-item': item.id }, listGroup), layout = layoutText(item.text, 245, 18), height = Math.max(34, layout.height + 14)
            mk('rect', { x: -145, y: 0, width: 290, height, rx: 4, fill: '#f5fff9', stroke: '#7ba28d' }, row)
            if (typeof item.checked === 'boolean') {
              mk('rect', { x: -134, y: 8, width: 13, height: 13, fill: 'none', stroke: '#315e48' }, row)
              if (item.checked) mk('path', { d: 'M-132 14l4 4 6-8', fill: 'none', stroke: '#315e48', 'stroke-width': 2 }, row)
            }
            textBlock(row, item.text, typeof item.checked === 'boolean' ? -112 : -134, 25, 245, 18, layout)
            listRows.push({ row, y, height }); y += height + 8
          }
          listGroup.storyHeight = y - 8
        }
        if (id === 'quoteIdea') {
          quote = mk('g', {}, layer)
          const layout = layoutText(fact.text, 320, 18), height = 32 + layout.height
          quote.storyBox = [-180, -height, 180, 0]
          mk('rect', { x: -180, y: -height, width: 360, height, rx: 5, fill: '#fff', stroke: '#527965', 'stroke-width': 1.5 }, quote)
          textBlock(quote, fact.text, -160, -height + 29, 320, 18, layout)
        }
        if (raw.renderer !== 'webgl' && ['compareValues', 'showBeforeAfter', 'quoteIdea'].includes(id)) {
          for (let i = 0; i < (id === 'quoteIdea' ? 1 : 2); i++) flatPanels.push(mk('rect', {
            x: -24, y: -16, width: 48, height: 32, rx: 2, fill: '#c8ffe0', stroke: '#315442', 'stroke-width': 1.5 }, layer))
        }
        return layer
      }, () => {
        if (active !== session || B.act !== action) return
        const t = action.t, visible = show(t), k = B.kk, palm = world(k.arms[ci].hand), boxes = []
        layer.setAttribute('opacity', visible); layer.setAttribute('data-story-phase', t < 2 ? 'prepare' : t > duration - 2 ? 'return' : 'read')
        const currentChart = id === 'chartClimb' ? (chartPlan.find(part => t / duration * chartPlan.at(-1).to < part.to) || chartPlan.at(-1)) : null,
          currentItem = currentChart ? items.findIndex(item => item.id === currentChart.part.item.id)
            : id === 'cardRoute' ? Math.min(items.length - 1, Math.max(0, Math.floor((routeTime(t) - .5) / cycle)))
              : Math.min(items.length - 1, Math.floor(reading(t) * items.length)),
          connect = (index, from, to, amount) => {
            const link = projectionLinks[index]
            if (!link) return
            link.setAttribute('d', `M${from[0]} ${from[1]}Q${(from[0] + to[0]) / 2} ${Math.min(from[1], to[1]) - 12} ${to[0]} ${to[1]}`)
            link.setAttribute('opacity', amount * .7)
          }
        sourceMarks.forEach((mark, i) => {
          const chosen = ['assembleList', 'chartClimb', 'cardRoute'].includes(id) ? i === currentItem
            : panels.length ? i === (Math.sin(t * 1.2) > 0 ? 1 : 0) : true
          mark.setAttribute('opacity', windowAt(t, .4, 1.1, duration - 2, duration - .8) * (chosen ? .5 : .1))
        })
        const place = (node, x, y, scale = 1) => {
          node.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`)
          const b = node.storyBox
          if (b && visible > 0) boxes.push([x + b[0] * scale - 3, y + b[1] * scale - 3, x + b[2] * scale + 3, y + b[3] * scale + 3])
        }
        if (thought) {
          const open = phase(t, 1.4, 2.2) * (1 - phase(t, 5.7, 6.8)),
            result = [lerp(palm[0], B.x + B.face * 65, open), lerp(palm[1], B.y - 88, open)]
          place(thought, ...result, open); connect(0, palm, result, open)
        }
        if (panels.length) for (const [i, panel] of panels.entries()) {
          const side = i ? 1 : -1, expand = phase(t, 1.6, 2.8) * (1 - phase(t, duration - 2.5, duration - 1.3)),
            origin = world(panelParams(t, k, i).center), update = (ox, oy) => {
              const x = lerp(ox, B.x + side * (id === 'showBeforeAfter' ? 104 : 90), expand),
                y = lerp(oy, B.y - 85 - 8 * Math.sin(t * 1.4 + i * Math.PI), expand)
              place(panel, x, y, expand); connect(i, [ox, oy], [x, y], expand)
            }
          update(...origin); projectionPlaced[i] = update
        }
        if (paths.length) {
          const target = pathPoint(t), tool = toolParams(t, k), origin = world(tool.at.map((value, i) => value + 16 * tool.k * tool.dir[i])),
            amount = windowAt(t, 1.6, 2, duration - 2.4, duration - 1.7) * (target.light ?? 1)
          beam.setAttribute('d', `M${origin[0]} ${origin[1]}L${target.x} ${target.y}`); beam.setAttribute('opacity', amount)
          if (id === 'traceFlow') toolPlaced = (x, y) => {
            beam.setAttribute('d', `M${x} ${y}L${target.x} ${target.y}`)
            dynamicDetail = union([...(dynamicDetail ? [dynamicDetail] : []), [x - 5, y - 5, x + 5, y + 5]])
          }
          trace.setAttribute('opacity', amount); cursor.setAttribute('cx', target.x); cursor.setAttribute('cy', target.y); cursor.setAttribute('opacity', amount)
          if (flatStylus) flatStylus.setAttribute('d', `M${palm[0]} ${palm[1]}L${origin[0]} ${origin[1]}`)
          if (amount > 0) boxes.push([Math.min(palm[0], origin[0]) - 5, Math.min(palm[1], origin[1]) - 5,
            Math.max(palm[0], origin[0]) + 5, Math.max(palm[1], origin[1]) + 5])
        }
        if (lens) {
          const rise = phase(t, 1.6, 2.6) * (1 - phase(t, 7.1, 8.2)), [x, y] = lensPosition(),
            origin = world(lensParams(t, k).center),
            result = [lerp(origin[0], x, rise), lerp(origin[1], y, rise)]
          place(lens, ...result, rise); connect(0, origin, [result[0] - Math.sign(x - origin[0]) * lensRadius * .8 * rise,
            result[1] + lensRadius * .45 * rise], rise)
          if (flatLens) {
            flatLens.handle.setAttribute('d', `M${palm[0]} ${palm[1]}L${origin[0]} ${origin[1]}`)
            flatLens.rim.setAttribute('cx', origin[0]); flatLens.rim.setAttribute('cy', origin[1])
          }
        }
        if (listGroup) {
          const amount = reading(t) * items.length, close = phase(t, duration - 2.6, duration - 1.2),
            height = listGroup.storyHeight, y = W.floor.y - height - 130,
            overlap = x => {
              const w = Math.max(0, Math.min(x + 150, original[2]) - Math.max(x - 150, original[0])),
                h = Math.max(0, Math.min(y + height, original[3]) - Math.max(y, original[1]))
              return w * h
            }, candidates = [clamp(B.x - 200, 170, 1110), clamp(B.x + 200, 170, 1110)],
            x = overlap(candidates[0]) <= overlap(candidates[1]) ? candidates[0] : candidates[1]
          listGroup.setAttribute('transform', `translate(${x} ${y})`)
          for (const [i, data] of listRows.entries()) {
            const { row } = data, u = smooth(amount - i) * (1 - close), rowY = y + data.y,
              currentX = lerp(palm[0], x, u), currentY = lerp(palm[1], rowY, u)
            row.setAttribute('opacity', u > 0 ? 1 : 0)
            row.setAttribute('transform', `translate(${currentX - x} ${currentY - y}) scale(${u})`)
            if (u > 0 && visible > 0) boxes.push([currentX - 148 * u, currentY - 3, currentX + 148 * u, currentY + data.height * u + 3])
          }
          connect(0, palm, [x, y + height], (1 - close) * phase(t, 2.1, 2.5))
        }
        if (quote) {
          const open = phase(t, 1.7, 2.8) * (1 - phase(t, 6.7, 7.6)), origin = world(panelParams(t, k, 0).center),
            update = (x, y) => {
              const result = [lerp(x, B.x + B.face * 95, open), lerp(y, B.y - 90, open)]
              place(quote, ...result, open); connect(0, [x, y], result, open)
            }
          update(...origin); projectionPlaced[0] = update
        }
        flatPanels.forEach((node, i) => {
          const params = panelParams(t, k, i), center = world(params.center)
          node.setAttribute('transform', `translate(${center[0]} ${center[1]}) scale(${params.k * S * B.scale})`)
        })
        const look = paths.length ? pathPoint(t) : currentChart ? currentChart.part.item.target
          : journey ? journey[currentItem].item.target
          : panels.length ? { x: B.x + Math.sign(Math.sin(t * 1.2)) * 95, y: B.y - 130 }
            : { x: (original[0] + original[2]) / 2, y: (original[1] + original[3]) / 2 }
        gaze.x = look.x; gaze.y = look.y
        dynamicDetail = union(boxes)
        if (t >= duration - .04) finish()
      })
      effects.add(effect)
      gaze = { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2, z: 0,
        active: () => active === session && B.act === action }
      raw.mind?.().look(gaze, duration)
    }
    const travel = journey?.flatMap(part => [[part.wall.footX - 110, part.plat.y - 130, part.x + 110, W.floor.y + 30]]) || [],
      body = union([[start[0] - 160, start[1] - 170, start[0] + 160, W.floor.y + 30], ...travel])
    action.canvasBounds = Object.freeze(body)
    action.frameBounds = Object.freeze(union([body, bounds]))
    action.detailBounds = () => active === session && B.act === action && dynamicDetail ? [...dynamicDetail] : null
    return action
  }

  return Object.freeze({ can, create,
    refresh() {
      if (!active) return false
      if (B.act !== active.action) { finish(); return false }
      const selection = context(active.id), old = active.source,
        unchanged = valid(selection) && sameContextSource(selection, old)
      if (unchanged) return false
      const moving = !!active.route
      finish(true)
      if (!moving || B.mode === 'ground') raw.run(['idle'])
      return true
    },
    reset() { finish(true) }, destroy() { if (!dead) { finish(true); layouts.clear(); dead = true } } })
}

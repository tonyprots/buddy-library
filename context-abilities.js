import { createContextPropBuilders } from './context-props.js'
import { reachArm } from './new-abilities.js'
import { contextSource, sameContextSource } from './context-source.js'

const entries = [
  ['laptopNotes', 'Записать в ноутбук', 'Садится, раскрывает ноутбук на коленях, записывает выбранный факт и закрывает экран.', 8.6, ['text', 'number', 'keyword']],
  ['thinkNumber', 'Обдумать число', 'Перечитывает точное число с единицей, показывает его в облачке мысли и возвращается к слайду.', 7.2, ['number']],
  ['hologramObject', 'Спроецировать объект', 'Связывает кольцо с выбранным изображением, поднимает его проекцию и сворачивает её обратно.', 7.8, ['object']],
  ['hologramKeyword', 'Спроецировать понятие', 'Выводит из кольца объёмный образ выбранного понятия и точное слово со слайда.', 8, ['keyword']],
  ['traceFocus', 'Подчеркнуть факт', 'Находит выбранную цель, проводит световое подчёркивание и возвращает руку.', 6, ['number', 'text', 'keyword', 'object', 'card']],
  ['peekCard', 'Выглянуть из-за карточки', 'Подходит, прячется за карточкой, выглядывает над кромкой и возвращается на пол.', 9.2, ['card']],
  ['perchRead', 'Прочитать с карточки', 'Взбирается по доступной кромке, читает карточку и спускается тем же путём.', 12.8, ['card']]
], concepts = new Set(['memory', 'target', 'team', 'chain', 'link', 'cloud', 'rules', 'search']),
  clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)),
  smooth = x => (x = clamp(x), x * x * (3 - 2 * x)),
  phase = (t, a, b) => smooth((t - a) / (b - a)),
  lerp = (a, b, u) => a + (b - a) * u,
  mixPoint = (a, b, u) => a.map((value, i) => lerp(value, b[i], u))

export const contextTechniques = Object.freeze(entries.map(([id, title, description, duration, kinds]) =>
  Object.freeze({ id, title, description, duration, contextKinds: Object.freeze(kinds), requires: 'floor',
    group: 'Контекст слайда', tags: Object.freeze(['context']),
    preset: id.startsWith('hologram') ? 'superhuman' : 'base' })))

const registry = new Map(contextTechniques.map(item => [item.id, item])),
  conceptPaths = Object.freeze({
    memory: 'M-16-59H13V-22H-16ZM-9-51H7M-9-44H7M-9-37H3M8-59V-47L3-51L-2-47V-59',
    target: 'M0-64A24 24 0 1 0 0-16A24 24 0 1 0 0-64M0-55A15 15 0 1 0 0-25A15 15 0 1 0 0-55M0-46A6 6 0 1 0 0-34A6 6 0 1 0 0-46',
    team: 'M-19-48A6 6 0 1 0-19-36A6 6 0 1 0-19-48M0-58A7 7 0 1 0 0-44A7 7 0 1 0 0-58M19-48A6 6 0 1 0 19-36A6 6 0 1 0 19-48M-27-24Q-19-40-10-24M-10-24Q0-49 10-24M10-24Q19-40 27-24',
    chain: 'M-29-48H-12V-33H-29ZM-8-48H9V-33H-8ZM13-48H30V-33H13ZM-17-40H-3M4-40H18',
    link: 'M-3-48L-10-55Q-20-62-25-51Q-28-45-21-39L-9-28Q-1-21 6-28M3-32L10-25Q20-18 25-29Q28-35 21-41L9-52Q1-59-6-52M-10-48L10-32',
    cloud: 'M-23-28C-38-30-35-49-20-49C-19-68 9-71 15-53C34-56 42-29 22-28Z',
    rules: 'M-24-63H24V-18H-24ZM-17-52L-13-48L-6-57M-1-53H16M-17-36L-13-32L-6-41M-1-37H16',
    search: 'M-4-61A19 19 0 1 0-4-23A19 19 0 1 0-4-61M10-28L27-11'
  })
let nextLayer = 0

/** Копия SVG живёт в собственном пространстве ID, исходный DOM не меняется. */
function copyImage(element, mk, parent, prefix) {
  if (element?.tagName?.toLowerCase() === 'svg' && element.cloneNode) {
    const clone = element.cloneNode(true), nodes = [clone, ...clone.querySelectorAll('*')], ids = new Map()
    nodes.forEach((node, index) => { const id = node.getAttribute('id'); if (id) ids.set(id, `${prefix}-${index}`) })
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
    clone.setAttribute('x', -48); clone.setAttribute('y', -72)
    clone.setAttribute('width', 96); clone.setAttribute('height', 72)
    parent.appendChild(clone)
    return clone
  }
  return mk('image', { x: -48, y: -72, width: 96, height: 72, preserveAspectRatio: 'xMidYMid meet',
    href: element?.currentSrc || element?.src || element?.getAttribute?.('href') || '' }, parent)
}

export function createContextPlayer(raw, { host, context = () => null } = {}) {
  const { B, W } = raw, { pose, copy, mix, gest, solve, S, mk, custom } = raw.tools,
    props = new Set(), effects = new Set(), rest = pose({ hy: 16, smile: .5 })
  let dead = false, active = null
  raw.tools.registerPropBuilders?.(createContextPropBuilders)

  const worldPoint = point => [B.x + (point[0] * Math.cos(B.yaw) - point[2] * Math.sin(B.yaw)) * S * B.scale,
      B.y + point[1] * S * B.scale],
    bodyPoint = (k, point) => point.map((_, axis) => k.T[0][axis] * point[0] + k.T[1][axis] * point[1] + k.T[2][axis] * point[2]),
    bodyTarget = (k, point) => k.T.map(axis => axis.reduce((sum, value, i) => sum + value * point[i], 0)),
    low = k => Math.max(...k.legs.flatMap(leg => [leg.heel[1], leg.toe[1]])),
    groundY = p => W.floor.y - low(solve(p, 1, 0)) * S * B.scale,
    valid = selection => selection?.fact && Array.isArray(selection.bounds) && selection.bounds.length === 4
      && selection.bounds.every(Number.isFinite) && selection.bounds[2] > selection.bounds[0] && selection.bounds[3] > selection.bounds[1],
    floorSpan = x => W.floor.spans.find(([a, b]) => x >= a + 9 && x <= b - 9),
    route = selection => {
      const [x1, y1, x2] = selection.bounds,
        plat = W.plats.find(p => Math.abs(p.y - y1) < 7 && Math.abs(p.x1 - x1) < 9 && Math.abs(p.x2 - x2) < 9)
      if (!plat?.spans?.some(([a, b]) => b - a >= 28)) return null
      const margin = Math.max(9, 28 * S * B.scale),
        safeSpan = wall => plat.spans.find(([a, b]) => wall.topX >= a && wall.topX <= b && b - a >= 2 * margin),
        walls = W.walls.filter(w => (w.plat === plat || Math.abs(w.top - plat.y) < 3 && Math.abs(w.plat?.x1 - plat.x1) < 3)
        && w.h <= 700 && w.gap <= 175 && floorSpan(w.footX) && floorSpan(B.x) === floorSpan(w.footX))
        .filter(safeSpan)
      const wall = walls.sort((a, b) => Math.abs(a.footX - B.x) - Math.abs(b.footX - B.x))[0]
      if (!wall) return null
      const span = safeSpan(wall)
      return { plat, wall, x: clamp(wall.topX, span[0] + margin, span[1] - margin) }
    },
    can = id => {
      const entry = registry.get(id)
      if (!entry) return 'Неизвестный контекстный приём'
      if (dead) return 'Проигрыватель отключён'
      if (raw.reduced) return 'Движение сокращено'
      if (B.surf?.kind !== 'floor' || B.mode !== 'ground') return 'Нужна стойка на полу'
      const selection = context(id)
      if (!valid(selection) || !entry.contextKinds.includes(selection.fact.kind)) return 'На слайде нет подходящего факта'
      if (id === 'hologramKeyword' && !concepts.has(selection.fact.concept)) return 'Для понятия не задан подготовленный образ'
      if (id === 'hologramObject' && !/^(img|svg)$/i.test(selection.element?.tagName || '')) return 'Нужно изображение или SVG'
      if ((id === 'peekCard' || id === 'perchRead') && !route(selection)) return 'Нет безопасной кромки и пути к выбранной карточке'
      return null
    }

  function finish(drop = false) {
    const previous = active
    active = null
    for (const state of props) state.done = true
    for (const effect of effects) { effect.age = effect.life; effect.el.remove() }
    props.clear(); effects.clear()
    previous?.restore?.()
    if (drop && previous?.moving && B.act === previous.action && B.mode === 'free' && raw.fall)
      raw.begin(raw.fall(0))
  }

  function create(id) {
    if (can(id)) return null
    finish(true)
    const selection = context(id), entry = registry.get(id), { fact, element, bounds } = selection,
      card = id === 'peekCard' || id === 'perchRead' ? route(selection) : null,
      duration = entry.duration, source = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      thoughtWidth = clamp(String(fact.text).length * 12 + 32, 150, 360),
      start = [B.x, B.y], startFace = B.face, ci = startFace > 0 ? 0 : 1, fi = 1 - ci,
      camera = id === 'laptopNotes' ? .35 : .3,
      turn = Math.sin(camera * Math.PI / 2), uid = `buddy-context-${++nextLayer}`,
      session = { action: null, moving: !!card, restore: null, id,
        source: contextSource(selection) },
      aim = (settings, first, second) => {
        const p = pose({ smile: .6, still: 1, ...settings })
        first && reachArm(p, ci, [first[0], first[1], first[2] ?? (ci ? -9 : 9)], turn)
        second && reachArm(p, fi, [second[0], second[1], second[2] ?? (ci ? 9 : -9)], turn)
        return p
      },
      contactArm = (p, i, target, cameraTurn) => {
        const shoulder = [0, -24.4, i ? -9.2 : 9.2], delta = target.map((value, axis) => value - shoulder[axis]),
          // Запас сгиба убирает резкий поворот локтя на границе полной
          // досягаемости; при близком хвате исходная цель сохраняется точно.
          reach = Math.min(1, 26 / Math.hypot(...delta))
        reachArm(p, i, delta.map((value, axis) => shoulder[axis] + value * reach), cameraTurn)
      },
      laptopAnchor = (t, k) => {
        const knees = k.legs[0].knee.map((value, i) => (value + k.legs[1].knee[i]) / 2),
          lap = [knees[0], knees[1] - 2, 0], carry = bodyPoint(k, [5, -4, 8]),
          placed = phase(t, .7, 1.8) * (1 - phase(t, 6.8, 7.7))
        return mixPoint(carry, lap, placed)
      },
      conceptAnchor = k => {
        const palm = k.arms[ci].hand, scale = S * B.scale,
          // Образ не закрывает голову: самый широкий объём занимает до40
          // единиц по обе стороны центра, ещё20 оставлены голове и зазору.
          clearance = raw.renderer === 'webgl' ? 60 * scale : 30 + 19 * scale,
          shift = Math.max(0, (worldPoint(k.head)[0] - worldPoint(palm)[0]) * startFace + clearance) / scale
        return [palm[0] + startFace * Math.cos(B.yaw) * shift, palm[1] - 4,
          palm[2] - startFace * Math.sin(B.yaw) * shift]
      },
      sample = t => {
        if (id === 'laptopNotes') {
          const seated = phase(t, .25, 1.6) * (1 - phase(t, 7.55, 8.4)),
            p = mix(rest, pose({ hf: [140, 140], kf: [96, 96], tl: 10, hp: 22, still: 1 }), seated),
            k = solve(p, 1, turn), anchor = laptopAnchor(t, k), typing = phase(t, 2.8, 3.1) * (1 - phase(t, 5.8, 6.1))
          for (const i of [0, 1]) {
            const target = [anchor[0] + (i ? 2.898 : -1.386), anchor[1] - 1.365 - typing * .55 * Math.max(0, Math.sin(t * 14 + i * Math.PI)), i ? -6.552 : 6.552]
            reachArm(p, i, bodyTarget(k, target), turn)
          }
          p.still = 1
          return t < .6 ? mix(rest, p, phase(t, .15, .6)) : t > 7.8 ? mix(p, rest, phase(t, 7.8, duration)) : p
        }
        if (id === 'thinkNumber') {
          const p = aim({ hp: 16, brow: .35, hy: 10 }, [12, -38, ci ? -6 : 6], [8, -19, fi ? -10 : 10]),
            u = phase(t, .65, 1.5) * (1 - phase(t, 5.8, 6.8))
          p.hp += 4 * Math.sin(t * 2) * u
          return mix(rest, p, u)
        }
        if (id.startsWith('hologram')) {
          const p = aim({ hp: -16, hy: 3, brow: .35 }, [25, -24, ci ? -9 : 9], [12, -22, fi ? -5 : 5]),
            u = phase(t, .5, 1.5) * (1 - phase(t, duration - 1.6, duration - .25))
          return mix(rest, p, u)
        }
        if (id === 'traceFocus') {
          const target = [27, clamp(-24 + (source[1] - B.y) / Math.max(40, Math.abs(source[0] - B.x)) * 19, -38, -12), ci ? -8 : 8],
            p = aim({ hp: source[1] < B.y - 30 ? -18 : 15, hy: 2 }, target),
            u = phase(t, .4, 1.3) * (1 - phase(t, 4.7, 5.7))
          return mix(rest, p, u)
        }
        return rest
      }
    let action, layer, line, highlight, thought, projection, notebook, underline, gaze, previousClip, ownClip

    function movement(t) {
      const { wall, plat } = card, side = wall.side, wallX = wall.x + side * 12, targetX = card.x,
        floor = groundY(rest), top = plat.y, approachEnd = 1.6,
        stance = pose({ still: 1, hp: -14, hy: 4, smile: .7 }), walk = u => {
          const cycle = u * Math.abs(wallX - start[0]) / 32, swing = Math.sin(cycle * Math.PI * 2),
            moving = phase(u, 0, .18) * (1 - phase(u, .8, 1)),
            step = pose({ ...stance, hf: [14 * swing, -14 * swing],
              kf: [5 + 12 * Math.max(0, -swing), 5 + 12 * Math.max(0, swing)],
              sf: [-10 * swing, 10 * swing], ef: [18, 18] })
          return mix(stance, step, moving)
        }
      let p = stance
      B.mode = 'free'; B.anchor = null; B.face = t < approachEnd ? Math.sign(wallX - start[0]) || startFace : -side
      if (t < approachEnd) { const u = phase(t, 0, approachEnd); B.x = lerp(start[0], wallX, u); p = walk(u); B.y = groundY(p) }
      else if (id === 'peekCard') {
        const rise = phase(t, 2.1, 3.4) * (1 - phase(t, 5.7, 7.1)),
          emergeY = top + 17 * S * B.scale,
          crouch = phase(t, 1.6, 2.1) * (1 - phase(t, 6.6, 7.1)),
          // Перехват начинается после прохода плеча через дальнюю ось IK,
          // отпускание заканчивается до обратного прохода при спуске.
          contact = phase(t, 3.1, 3.7) * (1 - phase(t, 5.6, 6))
        p = mix(stance, pose({ hp: 7, hy: 22 + 8 * Math.sin(t * 2), hf: [30, 26], kf: [40, 36] }), crouch)
        B.x = lerp(wallX, targetX, phase(t, 1.6, 2.2)); B.y = lerp(groundY(p), emergeY, rise)
        const grip = copy(p)
        for (const i of [0, 1]) contactArm(grip, i, [15, (top - 1 - B.y) / (S * B.scale), i ? -9 : 9], turn)
        p = mix(p, grip, contact)
        if (t > 7.1) { const u = phase(t, 7.1, 8.9); B.x = lerp(targetX, start[0], u); p = walk(1 - u); B.y = groundY(p) }
      } else {
        const up = phase(t, 2, 4.4), mount = phase(t, 4.4, 5.3), down = phase(t, 8.5, 10.7),
          dismount = phase(t, 7.6, 8.5), onTopY = top - low(solve(rest, 1, turn)) * S * B.scale
        B.x = lerp(wallX, targetX, mount * (1 - dismount))
        B.y = lerp(lerp(floor, top + 24, up), onTopY, mount)
        if (t >= 7.6) B.y = lerp(lerp(onTopY, top + 24, dismount), floor, down)
        const climbing = phase(t, 1.6, 2) * (1 - phase(t, 4.25, 4.75))
            + phase(t, 8.1, 8.6) * (1 - phase(t, 10.25, 10.7)),
          holding = phase(t, 4.15, 4.6) * (1 - phase(t, 4.85, 5.3))
            + phase(t, 7.6, 8.05) * (1 - phase(t, 8.15, 8.6)),
          reading = phase(t, 4.85, 5.3) * (1 - phase(t, 7.6, 8.05)),
          profile = phase(t, 1.6, 2) * (1 - phase(t, 4.8, 5.3))
            + phase(t, 7.6, 8.1) * (1 - phase(t, 10.2, 10.7)),
          s = Math.sin(t * 8), climbPose = pose({ ...stance, hf: [38 + 12 * s, 38 - 12 * s], kf: [65, 65], hp: t < 5 ? -24 : 18 }),
          holdPose = pose({ ...stance, hf: [62, 52], kf: [92, 82] }),
          readPose = pose({ ...stance, hp: 27, hy: 2, tl: 7 }), k = solve(holdPose, 1, 0),
          // Хват скользит внутрь верхней грани и остаётся впереди плеча:
          // фиксированная worldX=wall.x меняла ветку IK при пересечении кромки.
          gripX = clamp(B.x + B.face * 10, plat.x1 + 2, plat.x2 - 2),
          x = (gripX - B.x) / (B.face * S * B.scale), y = (top - B.y) / (S * B.scale)
        B.cam = camera * (1 - profile)
        for (const i of [0, 1]) {
          reachArm(climbPose, i, [22, -30 - 6 * Math.sin(t * 8 + i * Math.PI), i ? -8 : 8], 0)
          contactArm(holdPose, i, bodyTarget(k, [x, y, i ? -8 : 8]), 0)
        }
        reachArm(readPose, ci, [12, -35, ci ? -8 : 8], turn)
        p = mix(mix(mix(stance, climbPose, climbing), holdPose, holding), readPose, reading)
        if (t >= 5.3 && t < 7.6) { B.surf = plat; B.surfY = plat.y }
        if (t > 10.7) { const u = phase(t, 10.7, 12.5); B.x = lerp(wallX, start[0], u); p = walk(1 - u); B.y = groundY(p) }
      }
      if (t >= duration - .25) {
        const u = phase(t, duration - .25, duration - .04)
        B.x = lerp(B.x, start[0], u); B.y = lerp(B.y, floor, u)
        if (u === 1) { B.mode = 'ground'; B.surf = W.floor; B.surfY = W.floor.y; B.anchor = null; B.face = startFace }
        return mix(p, rest, u)
      }
      return p
    }

    const add = (name, update) => {
      if (raw.renderer !== 'webgl') return
      const state = raw.tools.prop3(name, (state, k) => {
        if (active !== session || B.act !== action) { state.done = true; return null }
        return update(action.t, k)
      })
      props.add(state)
    }, cleanup = () => { if (active === session) finish(); else restore() }, restore = () => {
      if (ownClip && host?.style.clipPath === ownClip) {
        previousClip === undefined ? delete host.style.clipPath : host.style.clipPath = previousClip
      }
      B.restore = B.restore.filter(fn => fn !== cleanup)
    }
    session.restore = restore
    action = gest(id, duration, camera, t => {
      for (const state of props) state.ping = true
      B.cset = id === 'laptopNotes' ? 4 : 0
      const p = card ? movement(t) : sample(t)
      p.still = 1
      if (t >= duration - .04) { restore(); for (const state of props) state.done = true }
      return p
    }, { power: entry.preset === 'superhuman' })
    action.init = () => {
      active = session; session.action = action
      B.restore.push(cleanup)
      if (id === 'peekCard') {
        previousClip = host?.style.clipPath
        ownClip = `path(evenodd, "M0 0H1280V720H0Z M${bounds[0]} ${bounds[1]}H${bounds[2]}V${bounds[3]}H${bounds[0]}Z")`
        if (host) { host.style.clipPath = ownClip; ownClip = host.style.clipPath }
      }
      if (id === 'laptopNotes') add('contextLaptop', (t, k) => ({ at: laptopAnchor(t, k), dir: [-1, 0, 0], k: .42,
        open: phase(t, 1.9, 2.7) * (1 - phase(t, 6.1, 6.75)), text: String(fact.text),
        typing: phase(t, 2.8, 3.1) * (1 - phase(t, 5.8, 6.1)), t,
        fade: phase(t, .6, .85) * (1 - phase(t, 7.65, 7.95)) }))
      if (id.startsWith('hologram')) {
        add('contextRing', (t, k) => ({ at: k.arms[ci].wrist, k: 1, pulse: .6 + .3 * Math.sin(t * 6),
          beamEnd: id === 'hologramKeyword' ? conceptAnchor(k).map((v, i) => v - k.arms[ci].wrist[i] - (i === 1 ? 12 : 0)) : null,
          beam: phase(t, 1.6, 2.5) * (1 - phase(t, duration - 2, duration - .9)),
          fade: phase(t, .7, 1.2) * (1 - phase(t, duration - .8, duration - .3)), t }))
        if (id === 'hologramKeyword') add('contextConcept', (t, k) => ({
          at: conceptAnchor(k), concept: fact.concept,
          dir: [Math.sin(B.yaw + .15), 0, Math.cos(B.yaw + .15)],
          progress: phase(t, 2, 3.2) * (1 - phase(t, duration - 2.2, duration - 1)),
          k: phase(t, 2, 3.2) * (1 - phase(t, duration - 2.2, duration - 1)), t }))
      }
      const effect = custom(duration + .1, () => {
        layer = mk('g', { 'data-buddy-context-layer': '', 'data-context-action': id, 'pointer-events': 'none', opacity: 0 })
        highlight = mk('rect', { x: bounds[0] - 5, y: bounds[1] - 5, width: bounds[2] - bounds[0] + 10,
          height: bounds[3] - bounds[1] + 10, rx: 5, fill: 'none', stroke: '#29be79', 'stroke-width': 2 }, layer)
        line = mk('path', { fill: 'none', stroke: '#29be79', 'stroke-width': 2, 'stroke-dasharray': '5 4' }, layer)
        underline = mk('path', { fill: 'none', stroke: '#46db9c', 'stroke-width': 6, 'stroke-linecap': 'round' }, layer)
        thought = mk('g', {}, layer)
        const width = thoughtWidth
        mk('rect', { x: -width / 2, y: -50, width, height: 58, rx: 15, fill: '#fff', stroke: '#83a493', 'stroke-width': 1.4 }, thought)
        mk('circle', { cx: -startFace * 14, cy: 18, r: 6, fill: '#fff', stroke: '#83a493' }, thought)
        mk('circle', { cx: -startFace * 22, cy: 29, r: 3, fill: '#fff', stroke: '#83a493' }, thought)
        mk('text', { x: 0, y: -13, 'text-anchor': 'middle', 'font-size': Math.min(24, (width - 24) / Math.max(1, String(fact.text).length) * 1.55),
          'font-family': 'system-ui,sans-serif', 'font-weight': 650, fill: '#173d33' }, thought).textContent = String(fact.text)
        projection = mk('g', {}, layer)
        if (id === 'hologramObject') copyImage(element, mk, projection, uid)
        else if (id === 'hologramKeyword') {
          mk('circle', { cx: 0, cy: -40, r: 24, fill: '#b1ffd9', stroke: '#25976b', 'stroke-width': 2 }, projection)
          mk('path', { d: conceptPaths[fact.concept], fill: 'none', stroke: '#25976b', 'stroke-width': 2,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-context-concept': fact.concept }, projection)
          mk('text', { x: 0, y: -78, 'text-anchor': 'middle', 'font-size': 20, 'font-family': 'system-ui,sans-serif', fill: '#126943' }, projection).textContent = String(fact.text)
        }
        notebook = mk('g', { opacity: 0 }, layer)
        if (id === 'laptopNotes' && raw.renderer === 'svg') {
          mk('rect', { x: -34, y: -43, width: 68, height: 43, rx: 2, fill: '#f3fbf7', stroke: '#718096', 'stroke-width': 2 }, notebook)
          mk('path', { d: 'M-34 0H34L42 16H-42ZM-25 5H25M-28 10H28', fill: '#c7d0db', stroke: '#718096', 'stroke-width': 1.5 }, notebook)
          const text = mk('text', { x: -29, y: -32, fill: '#173d33', 'font-family': 'system-ui,sans-serif', 'font-size': 6 }, notebook),
            chars = Array.from(String(fact.text)), count = Math.ceil(chars.length / 19)
          for (let i = 0; i < count; i++) mk('tspan', { x: -29, dy: i ? 7 : 0 }, text).textContent = chars.slice(i * 19, (i + 1) * 19).join('')
        }
        return layer
      }, effect => {
        if (active !== session || B.act !== action) { finish(); return }
        const t = action.t, k = B.kk, palm = worldPoint(k.arms[ci].hand),
          projected = id === 'hologramKeyword' ? worldPoint(conceptAnchor(k)) : palm,
          show = phase(t, .4, .8) * (1 - phase(t, duration - .7, duration - .2)),
          target = id === 'laptopNotes' ? worldPoint(laptopAnchor(t, k)) : palm,
          connect = phase(t, .7, 1.7) * (1 - phase(t, duration - 2, duration - .8)),
          end = mixPoint(source, target, connect)
        layer.setAttribute('opacity', show)
        layer.setAttribute('data-context-phase', t < 1.6 ? 'prepare' : t < duration - 2 ? 'hold' : 'return')
        highlight.setAttribute('opacity', card ? .1 : connect * .55)
        line.setAttribute('d', `M${source[0]} ${source[1]}Q${(source[0] + end[0]) / 2} ${Math.min(source[1], end[1]) - 30} ${end[0]} ${end[1]}`)
        line.setAttribute('opacity', id === 'peekCard' || id === 'perchRead' ? 0 : connect)
        if (gaze) {
          const look = t < 1.6 || id === 'traceFocus' || id === 'perchRead' ? source : id === 'laptopNotes' ? target
            : id === 'thinkNumber' ? [B.x + B.face * 30, B.y - 70] : [projected[0], palm[1] - 35]
          gaze.x = look[0]; gaze.y = look[1]
        }
        const thoughtScale = id === 'thinkNumber' ? phase(t, 1.6, 2.4) * (1 - phase(t, 5.4, 6.3)) : 0
        thought.setAttribute('transform', `translate(${B.x + B.face * 30} ${B.y - 58}) scale(${thoughtScale})`)
        const projectionScale = id.startsWith('hologram') ? phase(t, 2, 3.2) * (1 - phase(t, duration - 2.2, duration - 1)) : 0
        projection.setAttribute('transform', `translate(${projected[0]} ${palm[1] - 8}) scale(${projectionScale})`)
        if (id === 'hologramKeyword' && raw.renderer === 'webgl') for (const glyph of [...projection.children].slice(0, 2)) glyph.setAttribute('opacity', 0)
        const trace = id === 'traceFocus' ? phase(t, 1.5, 2.7) * (1 - phase(t, 4.1, 5.1)) : 0
        underline.setAttribute('d', `M${bounds[0]} ${bounds[3] + 6}H${lerp(bounds[0], bounds[2], trace)}`)
        underline.setAttribute('opacity', trace > 0 ? 1 : 0)
        if (id === 'laptopNotes' && raw.renderer === 'svg') {
          const anchor = worldPoint(laptopAnchor(t, k)), visible = phase(t, .6, .9) * (1 - phase(t, 7.5, 8))
          notebook.setAttribute('transform', `translate(${anchor[0]} ${anchor[1]}) scale(${S * B.scale * .42})`)
          notebook.setAttribute('opacity', visible)
        }
        if (t >= duration - .04) { effect.age = effect.life; finish() }
      })
      effects.add(effect)
      gaze = { x: source[0], y: source[1], z: 0, active: () => active === session && B.act === action }
      raw.mind?.().look(gaze, duration)
    }
    const bodyBounds = card ? [Math.min(start[0], card.wall.footX, card.x) - 75, Math.min(bounds[1] - 90, start[1] - 100),
      Math.max(start[0], card.wall.footX, card.x) + 75, W.floor.y + 20] : [start[0] - 115, W.floor.y - 185, start[0] + 115, W.floor.y + 25]
    action.canvasBounds = Object.freeze(bodyBounds)
    action.detailBounds = () => {
      if (active !== session || B.act !== action) return null
      const t = action.t
      if (id === 'thinkNumber') {
        const scale = phase(t, 1.6, 2.4) * (1 - phase(t, 5.4, 6.3)), x = B.x + B.face * 30, y = B.y - 58
        return scale > 0 ? [x - thoughtWidth / 2 * scale, y - 51 * scale,
          x + thoughtWidth / 2 * scale, y + 33 * scale] : null
      }
      if (!id.startsWith('hologram') || !B.kk) return null
      const scale = phase(t, 2, 3.2) * (1 - phase(t, duration - 2.2, duration - 1))
      if (!scale) return null
      const keyword = id === 'hologramKeyword', palm = worldPoint(B.kk.arms[ci].hand),
        projected = keyword ? worldPoint(conceptAnchor(B.kk)) : palm,
        halfWidth = keyword ? Math.max(49, Array.from(String(fact.text)).length * 10) : 49
      return [projected[0] - halfWidth * scale, palm[1] - 8 - (keyword ? 102 : 73) * scale,
        projected[0] + halfWidth * scale, palm[1] - 8 + scale]
    }
    action.frameBounds = Object.freeze([clamp(Math.min(bodyBounds[0], bounds[0] - 12), 0, 1280), clamp(Math.min(bodyBounds[1], bounds[1] - 12), 0, 720),
      clamp(Math.max(bodyBounds[2], bounds[2] + 12), 0, 1280), clamp(Math.max(bodyBounds[3], bounds[3] + 12), 0, 720)])
    return action
  }

  return Object.freeze({ can, create,
    refresh() {
      if (!active) return false
      if (B.act !== active.action) { finish(); return false }
      const current = context(active.id), previous = active.source,
        unchanged = valid(current) && sameContextSource(current, previous)
      if (unchanged) return false
      finish(); raw.run(['idle']); return true
    },
    reset() { finish(true) }, destroy() { if (!dead) { finish(true); dead = true } } })
}

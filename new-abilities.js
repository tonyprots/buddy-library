import { createAbilityPropBuilders } from './ability-props.js'

const entries = [
  ['salute', 'Приветствовать', 'Поворачивается к залу, поднимает открытую ладонь и приветствует коротким кивком.', 3.6],
  ['bow', 'Поклониться', 'Прикладывает руку к груди, переносит вес и делает спокойный поклон.', 4],
  ['present', 'Представить содержимое', 'Сначала смотрит на слайд, затем раскрывает ладони и приглашает зрителей посмотреть.', 4.8],
  ['thumbsUp', 'Одобрить', 'Поднимает настоящий большой палец, кивает и опускает руку.', 4.2],
  ['spotlight', 'Подсветить главное', 'Достаёт фонарик, наводит свет на содержимое и убирает фонарик.', 6.4],
  ['celebrate', 'Выпустить конфетти', 'Приседает, хлопает над головой и следит за разлетающимися бумажными конфетти.', 5.8],
  ['energyOrb', 'Собрать сферу', 'Выращивает большое энергетическое ядро, поднимает его над ладонями и осторожно гасит.', 6.8],
  ['forcePush', 'Силовой толчок', 'Готовится всем телом, резко выталкивает волну двумя ладонями и гасит отдачу.', 5.4],
  ['sonicPulse', 'Позвать через зал', 'Подносит ладони ко рту, зовёт «Эй!», машет в зал и прислушивается к ответу.', 5.6],
  ['energyBow', 'Энергетический лук', 'Поднимает объёмный лук, натягивает тетиву, выпускает стрелу и провожает её взглядом.', 6.6],
  ['orbit', 'Запустить орбиту', 'Подымает маленькую объёмную систему, запускает спутники и возвращает её в ладонь.', 6.8],
  ['comet', 'Поймать комету', 'Замечает летящую комету, ловит её с отдачей, остужает камень и отпускает его на пол.', 6.8],
  ['rain', 'Раскрыть зонт', 'Достаёт сложенный зонт, раскрывает купол над головой, пережидает дождь и складывает его.', 7.8],
  ['snow', 'Поймать снежинку', 'Подставляет ладонь под объёмный кристалл, рассматривает его и сдувает в сторону.', 7],
  ['starcatch', 'Поймать звезду', 'Встречает падающую звезду ладонью, амортизирует, показывает её и отпускает вверх.', 6.8],
  ['forceWall', 'Выставить силовую стену', 'Ставит щит, упирается обеими руками, принимает видимый удар и убирает защиту.', 6.4],
  ['timeBubble', 'Остановить время', 'Замедляет летящие осколки, рассматривает застывшие предметы и возвращает им скорость.', 7.4]
]

const gestures = new Set(['salute', 'bow', 'present', 'thumbsUp', 'sonicPulse', 'celebrate']),
  ordinaryProps = new Set(['spotlight', 'rain'])

export const extraTechniques = Object.freeze(entries.map(([id, title, description, duration]) =>
  Object.freeze({ id, title, description, duration,
    group: gestures.has(id) ? 'Жесты' : ordinaryProps.has(id) ? 'Реквизит' : 'Суперхьюман',
    requires: 'floor', preset: gestures.has(id) || ordinaryProps.has(id) ? 'base' : 'superhuman' })))

const registry = new Map(extraTechniques.map(item => [item.id, item])),
  quiet = new Set(['salute', 'bow', 'present', 'thumbsUp', 'sonicPulse']),
  clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n)),
  smooth = n => (n = clamp(n), n * n * (3 - 2 * n)),
  out = n => 1 - Math.pow(1 - clamp(n), 3),
  lerp = (a, b, t) => a + (b - a) * t,
  vec = (a, b, u) => a.map((value, i) => lerp(value, b[i], u)),
  between = (t, a, b) => smooth((t - a) / (b - a)),
  windowAt = (t, a, b, c, d) => between(t, a, b) * (1 - between(t, c, d)),
  radians = Math.PI / 180,
  degrees = 180 / Math.PI,
  starCatchDistance = 75

/** Двухзвенная рука: цель в осях корпуса, локоть опускается естественно под кисть. */
export function reachArm(p, index, target, turn = 0) {
  const side = index ? -1 : 1, upper = 14, fore = 12.5 + 4.4 * .55,
    delta = [target[0], target[1] + 24.4, target[2] - side * 9.2],
    distance = clamp(Math.hypot(...delta), .7, upper + fore - .15),
    direction = delta.map(value => value / (Math.hypot(...delta) || 1)),
    hint = [-.22, 1, side * .2], dot = hint.reduce((sum, value, i) => sum + value * direction[i], 0),
    bend = hint.map((value, i) => value - direction[i] * dot), length = Math.hypot(...bend) || 1,
    cosine = clamp((upper * upper + distance * distance - fore * fore) / (2 * upper * distance), -1, 1),
    sine = Math.sqrt(1 - cosine * cosine),
    elbow = direction.map((value, i) => upper * (value * cosine + bend[i] / length * sine)),
    wrist = direction.map((value, i) => (value * distance - elbow[i]) / fore),
    sf = Math.atan2(elbow[0], elbow[1]) * degrees,
    sa = Math.asin(clamp(elbow[2] / upper * side, -1, 1)) * degrees,
    flex = Math.atan2(wrist[0], wrist[1]) * degrees,
    abd = Math.asin(clamp(wrist[2] * side, -1, 1)) * degrees
  let ef = flex - sf
  if (ef < -180) ef += 360
  if (ef > 180) ef -= 360
  p.sf[index] = sf
  p.sa[index] = sa
  p.ef[index] = ef
  p.ea[index] = abd - sa + turn * .5 * clamp(ef - 10, 0, 110)
  return p
}

/** Каждый номер имеет собственную постановку и 3D-реквизит в мире персонажа. */
export function createAbilityPlayer(raw, { host } = {}) {
  const { B, W } = raw, { pose, mix, gest, solve, S } = raw.tools,
    stage = host?.parentElement, owned = new Set(), flatOwned = new Set()
  let dead = false
  raw.tools.registerPropBuilders?.(createAbilityPropBuilders)

  const bodyPoint = (k, target) => target.map((_, axis) =>
      k.T[0][axis] * target[0] + k.T[1][axis] * target[1] + k.T[2][axis] * target[2]),
    worldPoint = point => [B.x + (point[0] * Math.cos(B.yaw) - point[2] * Math.sin(B.yaw)) * S * B.scale,
      B.y + point[1] * S * B.scale],
    box = (points, radius = 24) => {
      const all = points.filter(Boolean).map(point => point.length === 2 ? point : worldPoint(point))
      return [Math.min(...all.map(p => p[0])) - radius, Math.min(...all.map(p => p[1])) - radius,
        Math.max(...all.map(p => p[0])) + radius, Math.max(...all.map(p => p[1])) + radius]
    },
    finish = () => {
      for (const state of owned) state.done = true
      for (const effect of flatOwned) { effect.age = effect.life; effect.el.remove() }
      owned.clear(); flatOwned.clear()
    },
    focus = () => {
      const slide = stage?.querySelector(':scope > .slide.on') || stage?.querySelector(':scope > .slide'),
        element = ['[data-buddy-focus]', '[data-buddy-target]', 'h1', 'h2', 'img', 'video']
          .map(selector => slide?.querySelector(selector)).find(node => node?.getBoundingClientRect().width > 0)
      if (!element) return [B.x + B.face * 130, B.y - 110]
      const rect = element.getBoundingClientRect(), bounds = stage.getBoundingClientRect(), scale = bounds.width / 1280 || 1
      return [(rect.left + rect.width / 2 - bounds.left) / scale, (rect.top + rect.height / 2 - bounds.top) / scale]
    }

  function choreography(id, duration, focusPoint) {
    const ci = B.face > 0 ? 0 : 1, fi = 1 - ci, side = ci ? -1 : 1,
      camera = id === 'present' ? .35 : id === 'energyOrb' ? .12 : quiet.has(id) ? .6 : id === 'energyBow' || id === 'comet' ? .24 : .38,
      turn = Math.sin(camera * Math.PI / 2), near = z => side * z, startX = B.x, startY = B.y,
      aim = (settings = {}, leading, trailing) => {
        const p = pose({ smile: .5, ...settings })
        leading && reachArm(p, ci, [leading[0], leading[1], near(leading[2] ?? 9)], turn)
        trailing && reachArm(p, fi, [trailing[0], trailing[1], near(trailing[2] ?? -9)], turn)
        return p
      },
      rest = pose({ hy: 16, smile: .55 }),
      chest = [13, -23, 8], palm = [23, -24, 9], low = [8, -8, 10],
      prepare = aim({ hf: [9, -5], kf: [14, 7], tl: 8, hp: 5 }, [12, -15, 8], [12, -15, -8])
    let frames
    switch (id) {
      case 'salute':
        frames = [[0, rest], [.3, aim({ hy: 24, hp: -3 }, chest)], [.55, aim({ hy: 26, hp: -3 }, [15, -23, 24])],
          [.85, aim({ hy: 28 }, [3, -43, 24])],
          [1.55, aim({ hy: 30, hp: 7, smile: .9 }, [3, -43, 24])],
          [2.2, aim({ hy: 24, hp: 0 }, [10, -31, 24])], [2.55, aim({ hy: 22, hp: 0 }, [10, -19, 24])],
          [2.9, aim({ hy: 20 }, chest)], [duration, rest]]
        break
      case 'bow':
        frames = [[0, rest], [.6, aim({ hy: 24 }, chest)], [1.3, aim({ tl: 32, hp: 18, hf: [7, 7], kf: [10, 10] }, chest)],
          [2.1, aim({ tl: 32, hp: 20, lid: .45 }, chest)], [3, aim({ hy: 24, smile: .9 }, chest)], [duration, rest]]
        break
      case 'present':
        const dy = focusPoint[1] - (B.y - 24 * S * B.scale),
          dx = Math.max(30, Math.abs(focusPoint[0] - B.x)),
          targetHand = [27, clamp(-24 + dy / dx * 22, -34, -12), 10]
        frames = [[0, rest], [.5, aim({ hp: -12, hy: 2 }, chest)], [1.15, aim({ tl: 6, ts: -4, hp: -8 }, targetHand, [14, -18, -10])],
          [2.3, aim({ hy: 2, smile: .9 }, targetHand, [14, -18, -10])],
          [3.4, aim({ hy: 5, hp: -5 }, targetHand, [14, -17, -10])], [duration, rest]]
        break
      case 'thumbsUp':
        frames = [[0, rest], [.65, aim({ hy: 24 }, chest)], [1.1, aim({ hy: 28, smile: 1 }, [17, -27, 11])],
          [1.8, aim({ hy: 28, hp: 9, smile: 1 }, [17, -27, 11])], [2.5, aim({ hy: 24, hp: 0 }, [17, -27, 11])],
          [3.4, aim({ hy: 18 }, chest)], [duration, rest]]
        break
      case 'spotlight':
        frames = [[0, rest], [.45, aim({ tl: 14, hp: 15 }, [3, -7, 10])], [1.1, aim({ hp: 8 }, [16, -21, 11], [10, -19, -6])],
          [1.9, aim({ hp: -20, hy: 2, tl: 5 }, [25, -28, 11], [18, -25, -3])],
          [4.3, aim({ hp: -15, tl: 4 }, [25, -28, 11], [18, -25, -3])],
          [5.1, aim({ hp: 10 }, [16, -21, 11])], [5.75, aim({ tl: 12 }, [3, -7, 10])], [duration, rest]]
        break
      case 'celebrate':
        frames = [[0, rest], [.45, prepare], [.85, aim({ kf: [26, 26], hf: [18, 18], tl: 14, smile: .8 }, [17, -20, 1], [17, -20, -1])],
          [1.25, aim({ hf: [-4, -4], kf: [2, 2], tl: -6, hp: -22, mouth: .6 }, [9, -48, 1], [9, -48, -1])],
          [1.8, aim({ hp: -28, hy: 12, smile: 1 }, [11, -44, 20], [11, -44, -20])],
          [3.8, aim({ hp: -22, hy: 22, smile: 1 }, [15, -32, 20], [15, -32, -20])], [duration, rest]]
        break
      case 'energyOrb':
        frames = [[0, rest], [.5, prepare], [1.1, aim({ tl: 7, hp: 14, brow: -.2 }, [15, -22, 1], [15, -22, -1])],
          [2.2, aim({ tl: 3, hp: -12, mouth: .2 }, [28, -24, 12], [26, -21, -12])],
          [3.3, aim({ tl: -4, hp: -15, smile: .8 }, [28, -24, 12], [26, -21, -12])],
          [4.3, aim({ hp: -9 }, [28, -24, 12], [26, -21, -12])],
          [5.55, aim({ tl: 8, hp: 17 }, [15, -22, 1], [15, -22, -1])], [6.1, prepare], [duration, rest]]
        break
      case 'forcePush':
        frames = [[0, rest], [.55, prepare], [1.2, aim({ tl: -13, hf: [8, -15], kf: [20, 7], hp: 2, brow: -.4 }, [8, -20, 8], [8, -20, -8])],
          [1.65, aim({ tl: 16, hf: [22, -13], kf: [25, 9], mouth: .4, brow: -.5 }, [28, -24, 8], [28, -24, -8])],
          [2.15, aim({ tl: 9, hf: [18, -9], kf: [20, 7] }, [26, -24, 8], [26, -24, -8])],
          [3.15, aim({ tl: -4, hp: -4 }, [17, -19, 10], [17, -19, -10])], [duration, rest]]
        break
      case 'sonicPulse':
        frames = [[0, rest], [.5, aim({ hp: -8 }, chest)], [1.1, aim({ tl: -5, hp: -8, mouth: .3 }, [13, -28, 5], [13, -28, -5])],
          [2.4, aim({ tl: 8, hp: -3, mouth: .85, brow: .5 }, [14, -28, 5], [14, -28, -5])],
          [2.65, aim({ hp: -3, hy: 20, mouth: .3, smile: .9 }, [15, -28, 24])],
          [3, aim({ hp: -3, hy: 28, mouth: .2, smile: .9 }, [3, -43, 24])],
          [4.2, aim({ ts: 4, hp: 7, hy: 25, brow: .6 }, [3, -35, 24])],
          [4.5, aim({ ts: 4, hp: 7, hy: 25, brow: .6 }, [3, -35, 24])],
          [4.9, aim({ hp: 7, hy: 22, smile: .6 }, [10, -19, 24])], [duration, rest]]
        break
      case 'energyBow':
        frames = [[0, rest], [.5, prepare], [1.15, aim({ tl: 3, hp: -6 }, [25, -27, 5], [22, -27, 5])],
          [2.5, aim({ tl: -5, ts: -7, hf: [13, -10], kf: [18, 8], hp: -4, brow: -.4 }, [27, -28, 5], [10, -28, 5])],
          [2.95, aim({ tl: -5, ts: -7, hp: -4, lid: .25, brow: -.4 }, [27, -28, 5], [10, -28, 5])],
          [3.1, aim({ tl: 4, ts: 3, hp: -7 }, [27, -28, 5], [11, -25, 8])],
          [3.8, aim({ tl: 4, hp: -13 }, [24, -27, 5], [9, -18, 10])],
          [5.2, aim({ hp: 8, hy: 15 }, [15, -19, 10])], [duration, rest]]
        break
      case 'orbit':
        frames = [[0, rest], [.6, prepare], [1.3, aim({ hp: 15 }, [21, -22, 11], [13, -18, -5])],
          [2.6, aim({ hp: -28, hy: 4 }, [12, -48, 14], [18, -35, -9])],
          [4.5, aim({ hp: -25, hy: 8, smile: .85 }, [12, -48, 14], [18, -35, -9])],
          [5.6, aim({ hp: 16 }, [18, -20, 10], [16, -20, -3])], [duration, rest]]
        break
      case 'comet':
        frames = [[0, rest], [.35, aim({ hp: -19, hy: 0, brow: .7, mouth: .25 }, chest)],
          [.95, aim({ tl: -7, hf: [17, -12], kf: [22, 7], hp: -7, brow: .5 }, [27, -23, 10], [20, -20, -5])],
          [1.3, aim({ tl: -5, hf: [19, -12], kf: [24, 7] }, [28, -23, 8], [26, -21, -4])],
          [1.56, aim({ tl: -14, hf: [26, -17], kf: [32, 12], mouth: .75, brow: .6 }, [27, -19, 8], [25, -19, -2])],
          [2.2, aim({ tl: -5, hf: [16, -9], kf: [18, 7], hp: 17, mouth: .3 }, [28, -19, 8], [27, -19, -2])],
          [3.25, aim({ tl: 4, hp: 23, mouth: .55, brow: .2 }, [28, -19, 8], [27, -20, -3])],
          [4.2, aim({ hp: 18, tl: 7 }, [24, -18, 12], [13, -18, -7])],
          [4.7, aim({ hp: 26, tl: 9 }, [22, -16, 14])],
          [5.15, aim({ hp: 28, tl: -5, hf: ci ? [0, -22] : [-22, 0], kf: ci ? [2, 42] : [42, 2] }, [16, -14, 13])],
          [5.5, aim({ hp: 22, tl: -9, hf: ci ? [0, 46] : [46, 0], kf: ci ? [2, 6] : [6, 2] }, [15, -18, 13])],
          [5.85, aim({ hp: 9, hy: 4, smile: .9, hf: ci ? [0, 20] : [20, 0], kf: ci ? [2, 25] : [25, 2] }, [14, -19, 13])],
          [6.25, aim({ hp: 5, hy: 26, smile: .9 }, chest)], [duration, rest]]
        break
      case 'rain':
        frames = [[0, rest], [.6, aim({ hp: -22, mouth: .2, brow: .6 }, chest)],
          [1.1, aim({ tl: 13, hp: 13 }, [3, -7, 12])],
          [1.7, aim({ hp: -6 }, [18, -27, 12])], [2.25, aim({ hp: -15 }, [24, -30, 12])],
          [3.1, aim({ hp: -19, hy: 6 }, [24, -30, 12])], [4.4, aim({ hy: 25, smile: .8 }, [24, -30, 12])],
          [5.5, aim({ hp: -25 }, [24, -30, 12])], [6.15, aim({ hp: 1 }, [18, -27, 12])],
          [7.1, aim({ tl: 12, hp: 12 }, [3, -7, 12])], [duration, rest]]
        break
      case 'snow':
        frames = [[0, rest], [.55, aim({ hp: -24, brow: .4 }, chest)],
          [1.35, aim({ hp: -12 }, [28, -15, 4])], [2.2, aim({ hp: 17 }, [28, -12, 4])],
          [3.2, aim({ hp: 15, tl: 5 }, [26, -10, 4])], [3.85, aim({ hp: 10, mouth: .15, tl: -3 }, [27, -10, 4])],
          [4.2, aim({ hp: 13, mouth: .65, tl: 6 }, [28, -14, 3])],
          [5.3, aim({ hp: -12, hy: 2 }, [27, -14, 4])], [duration, rest]]
        break
      case 'starcatch':
        frames = [[0, rest], [.5, aim({ hp: -28, brow: .5 }, chest)],
          [1.15, aim({ tl: -5, hp: -20, hf: [8, -5], kf: [12, 5] }, [30, -40, 3])],
          [1.9, aim({ tl: -3, hp: -13 }, [30, -39, 3])],
          [2.2, aim({ tl: 8, hf: [17, 6], kf: [22, 10], hp: 7 }, [27, -10, 4])],
          [2.9, aim({ hp: 15, hy: 17, smile: .9 }, [22, -3, 4])],
          [4.2, aim({ hp: 4, hy: 28, smile: 1 }, [22, -3, 4])],
          [5.1, aim({ hp: -22 }, [22, -3, 4])], [5.7, aim({ hp: -30 }, [22, -3, 4])], [duration, rest]]
        break
      case 'forceWall':
        frames = [[0, rest], [.5, prepare], [1.2, aim({ tl: 8, hf: [18, -12], kf: [25, 7], brow: -.3 }, [26, -28, 9], [26, -28, -9])],
          [2.05, aim({ tl: 5, hf: [21, -15], kf: [29, 9] }, [26, -28, 9], [26, -28, -9])],
          [2.35, aim({ tl: -16, hf: [29, -17], kf: [35, 12], mouth: .6 }, [21, -27, 9], [21, -27, -9])],
          [3.2, aim({ tl: 5, hf: [19, -10], kf: [24, 8] }, [26, -28, 9], [26, -28, -9])],
          [4.7, aim({ tl: 4, hp: 8 }, [15, -24, 3], [15, -24, -3])], [duration, rest]]
        break
      case 'timeBubble':
        frames = [[0, rest], [.6, prepare], [1.4, aim({ tl: 6, hp: -9 }, [19, -25, 17], [19, -25, -17])],
          [1.9, aim({ tl: -2, hp: 5, brow: -.2 }, [28, -27, 17], [28, -27, -17])],
          [3.1, aim({ tl: 9, hp: 7, hy: 10 }, [27, -27, 11], [20, -24, -16])],
          [4.3, aim({ tl: 5, hp: -6, hy: 21 }, [23, -23, 14], [20, -24, -16])],
          [5.1, aim({ tl: 3, hp: 5 }, [15, -24, 3], [15, -24, -3])],
          [5.5, aim({ tl: 8, hp: -3 }, [28, -27, 17], [28, -27, -17])], [duration, rest]]
        break
    }
    const sample = t => {
      for (let i = 0; i < frames.length - 1; i++) {
        if (t <= frames[i + 1][0]) return mix(frames[i][1], frames[i + 1][1],
          smooth((t - frames[i][0]) / (frames[i + 1][0] - frames[i][0])))
      }
      return mix(rest, rest, 0)
    }
    return { ci, fi, side, camera, sample, startX, startY }
  }

  function create(id) {
    if (dead || raw.reduced || !registry.has(id) || B.surf?.kind !== 'floor' || B.mode !== 'ground') return null
    finish()
    const focusPoint = id === 'spotlight' || id === 'present' ? focus() : null
    if (focusPoint && Math.abs(focusPoint[0] - B.x) > 20) B.face = Math.sign(focusPoint[0] - B.x)
    const { duration } = registry.get(id), scene = choreography(id, duration, focusPoint),
      { ci, fi } = scene, props = [],
      gaze = { x: B.x + B.face * 60, y: B.y - 35, z: quiet.has(id) ? 2000 : 0,
        active: () => !dead && B.act === action },
      predict = (time, radius, offsetX = 0) => {
        const yaw = B.face > 0 ? scene.camera * Math.PI / 2 : Math.PI - scene.camera * Math.PI / 2,
          k = solve(scene.sample(time), Math.cos(yaw) >= 0 ? 1 : -1, Math.sin(yaw)),
          hand = k.arms[ci].hand, feet = Math.max(...k.legs.flatMap(leg => [leg.heel[1], leg.toe[1]])),
          hipY = W.floor.y - feet * S * B.scale
        return [scene.startX + ((hand[0] + offsetX) * Math.cos(yaw) - hand[2] * Math.sin(yaw)) * S * B.scale,
          hipY + (hand[1] - radius) * S * B.scale]
      },
      watch = point => { gaze.x = point[0]; gaze.y = point[1]; gaze.z = 0 }
    let contact = null, departure = null, snowPoint = null, action
    const heldCenter = []
    const add = (name, update) => {
      const state = raw.tools.prop3?.(name, (st, k) => {
        if (dead || B.act !== action) { st.done = true; return null }
        const data = update(action.t, k)
        if (id === 'snow' && data) snowPoint = data.atW || (data.at && worldPoint(data.at))
        return data && (data.fade == null || data.fade > .001) && (data.k == null || data.k > .001) ? data : null
      }) || { ping: true }
      owned.add(state); props.push(state); return state
    },
      grip = (k, index = ci, offset = [0, 0, 0]) => k.arms[index].hand.map((v, i) => v + offset[i]),
      common = (at, extras = {}) => ({ at, t: action.t, k: 1, fade: 1, ...extras }),
      front = (k, z = 15) => [k.head[0], k.head[1], k.head[2] + z * B.face],
      facing = () => [Math.sin(B.yaw), 0, Math.cos(B.yaw)],
      shown = (t, a, b, c, d) => windowAt(t, a, b, c, d),
      held = (k, index = ci, radius = 5) => grip(k, index, [0, -radius, 0]),
      handContact = (data, amount = 1, kind = 'support') => ({ ...data,
        handContact: { kind, side: ci, amount, out: heldCenter } }),
      releasedAt = fallback => heldCenter.length ? heldCenter.slice() : fallback

    if (id === 'spotlight') add('abilityFlashlight', (t, k) => {
      const hand = grip(k), head = worldPoint(hand), dx = focusPoint[0] - head[0], dy = focusPoint[1] - head[1],
        localTarget = [hand[0] + dx / (Math.cos(B.yaw) * S * B.scale || .2),
          hand[1] + dy / (S * B.scale), hand[2]],
        distance = Math.hypot(...localTarget.map((value, i) => value - hand[i]))
      return common(hand, { grip: [0, 0, -3], to: localTarget, beam: shown(t, 1.4, 1.85, 4.35, 4.7),
        beamLength: clamp(distance - 6.4, 12, 8000), beamRadius: 38, k: shown(t, .65, .9, 5.7, 6),
        box: box([head, focusPoint], 16) })
    })
    if (id === 'spotlight' && raw.tools.custom && raw.tools.mk) {
      const effect = raw.tools.custom(duration, () => {
        const g = raw.tools.mk('g', { 'pointer-events': 'none' })
        for (const size of [1, .78, .53]) raw.tools.mk('ellipse', {
          cx: focusPoint[0], cy: focusPoint[1], rx: 25 * size, ry: 18 * size, fill: '#ffce54', opacity: .09
        }, g)
        return g
      }, o => {
        if (dead || B.act !== action) { o.age = o.life; o.el.remove(); return }
        o.el.setAttribute('opacity', shown(action.t, 1.6, 1.95, 4.35, 4.7))
      })
      effect.el.setAttribute('opacity', 0)
      flatOwned.add(effect)
    }
    if (id === 'celebrate') add('abilityConfetti', (t, k) => {
      if (!contact && t >= 1.23) contact = worldPoint(bodyPoint(k, [6, -48, 0]))
      const origin = contact || worldPoint(bodyPoint(k, [6, -48, 0]))
      return { atW: origin, floorDrop: Math.max(0, (W.floor.y - origin[1]) / (S * B.scale)),
        t: Math.max(0, t - 1.23), fade: shown(t, 1.22, 1.3, 5.05, 5.65),
        box: box([[scene.startX - 140, W.floor.y - 110], [scene.startX + 140, W.floor.y + 4]], 4) }
    })
    if (id === 'energyOrb') add('abilityOrb', (t, k) => {
      const a = grip(k), b = grip(k, fi), lift = between(t, 1.1, 2.2) * (1 - between(t, 4.8, 5.6)),
        offset = bodyPoint(k, [11 * lift, -26 * lift, 0]), centre = a.map((v, i) => (v + b[i]) / 2 + offset[i])
      watch(worldPoint(centre))
      return common(centre, { radius: 18, charge: shown(t, 1, 2.2, 4.9, 5.65), k: shown(t, .95, 1.25, 5.5, 5.85) * 1.55,
        to: front(k), box: box([centre, a, b], 45) })
    })
    if (id === 'forcePush') add('abilityForceWave', (t, k) => {
      const release = 1.63, u = clamp((t - release) / 1.8), at = bodyPoint(k, [29, -24, 0])
      if (t >= release && !departure) departure = worldPoint(at)
      const location = departure ? { atW: [departure[0] + B.face * u * 65, departure[1]] } : { at }
      return { ...location, t, k: 1, kind: 'push', spread: u,
        dir: [1, 0, 0], fade: Math.sin(Math.PI * u), box: box([location.atW || at], 55) }
    })
    if (id === 'sonicPulse' && raw.tools.custom && raw.tools.mk) {
      const effect = raw.tools.custom(duration, () => {
        const g = raw.tools.mk('g', { 'pointer-events': 'none', opacity: 0 })
        raw.tools.mk('path', { d: 'M4 12L0 25L14 15Z', fill: '#fff', stroke: '#64738a', 'stroke-width': .7 }, g)
        raw.tools.mk('rect', { x: 0, y: 0, width: 31, height: 19, rx: 6, fill: '#fff', stroke: '#64738a', 'stroke-width': .7 }, g)
        raw.tools.mk('text', { x: 15.5, y: 13.5, 'text-anchor': 'middle', 'font-family': 'system-ui, sans-serif',
          'font-size': 11, 'font-weight': 650, fill: '#20252f' }, g).textContent = 'Эй!'
        return g
      }, o => {
        if (dead || B.act !== action) { o.age = o.life; o.el.remove(); return }
        o.el.setAttribute('transform', `translate(${B.x + B.face * 14},${B.y - 48})`)
        o.el.setAttribute('opacity', shown(action.t, 1.25, 1.5, 2.45, 2.8))
      })
      flatOwned.add(effect)
    }
    if (id === 'forcePush') add('abilityCrate', t => {
      const elapsed = Math.max(0, t - 2.35), hop = Math.sin(Math.PI * clamp(elapsed / .85)),
        start = scene.startX + B.face * 68, exit = B.face > 0 ? 1328 : -48,
        point = [lerp(start, exit, elapsed / 2.65), W.floor.y - hop * 16]
      if (point[0] < -28 || point[0] > 1308) return null
      return { atW: point, t, k: 1.6 * between(t, .05, .3), tilt: -B.face * hop * .25,
        box: box([point], 18) }
    })
    if (id === 'energyBow') {
      add('abilityBow', (t, k) => common(grip(k), { dir: bodyPoint(k, [1, 0, 0]),
        draw: between(t, 1.15, 2.5) * (1 - out((t - 3) / .15)),
        k: shown(t, .6, 1.1, 5, 5.55), box: box([grip(k), grip(k, fi)], 24) }))
      add('abilityArrow', (t, k) => {
        const travel = Math.max(0, t - 3.02), rear = grip(k, fi), direction = bodyPoint(k, [1, 0, 0]),
          at = rear.map((value, i) => value + direction[i] * 13.6)
        if (t < 3.02) { watch(worldPoint(grip(k))); return common(at, { dir: direction,
          fade: shown(t, 1.05, 1.25, 3.65, 3.95), box: box([at], 18) }) }
        if (!departure) departure = worldPoint(at)
        const flying = [departure[0] + B.face * travel * 600, departure[1] - travel * 4]
        watch(flying)
        return { atW: flying, t, dir: [1, 0, 0], speed: clamp(travel * 3),
          fade: flying[0] >= -28 && flying[0] <= 1308 ? 1 : 0, box: box([flying], 20) }
      })
    }
    if (id === 'orbit') add('abilityOrbit', (t, k) => {
      const palm = worldPoint(held(k, ci, 8)), above = [scene.startX + B.face * 8, W.floor.y - 85],
        lift = between(t, 1.3, 2.6) * (1 - between(t, 5.05, 5.9)),
        at = vec(palm, above, lift), integral = u => Math.pow(clamp(u), 3) - .5 * Math.pow(clamp(u), 4),
        clock = t < 2.5 ? .8 * integral((t - 1.7) / .8)
          : t < 4.45 ? .4 + t - 2.5 : .4 + 1.95 + .95 * (clamp((t - 4.45) / .95) - integral((t - 4.45) / .95))
      watch(at)
      return { atW: at, t, speed: 1, clock, radius: 1.1,
        k: shown(t, 1.1, 1.5, 5.35, 5.9) * lerp(.65, 2.7, lift), box: box([at], 48) }
    })
    if (id === 'comet') add('abilityComet', (t, k) => {
      const hand = grip(k, ci, [4, -4, 0]), h = worldPoint(hand), catchAt = 1.32
      if (t < catchAt) {
        if (!contact) contact = predict(catchAt, 4, 4)
        const u = clamp((t - .55) / (catchAt - .55)), flight = u * u,
          x = contact[0] + B.face * 170 * (1 - flight), y = contact[1] - 54 * (1 - flight)
        watch([x, y])
        return handContact({ atW: [x, y], dir: [-1, .32, 0], up: [0, 0, 1], t, heat: 1, tail: shown(t, .5, .65, 1.35, 1.65),
          fade: t < .5 ? 0 : 1, box: box([[x, y], [x + B.face * 28, y - 10]], 20) }, between(t, catchAt - .2, catchAt))
      }
      if (t < 4.55) {
        const joined = vec(contact, h, between(t, catchAt, catchAt + .13))
        watch(joined)
        return handContact({ atW: joined, dir: [-1, .32, 0], up: [0, 0, 1], t, spin: catchAt, k: 1, heat: 1 - between(t, 2.45, 3.75),
          tail: 1 - between(t, catchAt, 1.8), box: box([joined], 28) })
      }
      if (!departure) departure = releasedAt(h)
      const fall = t - 4.55, floor = W.floor.y - 3,
        landedAt = 4.55 + Math.sqrt(Math.max(0, floor - departure[1]) / 105), kickAt = Math.max(5.48, landedAt + .1),
        kick = Math.max(0, t - kickAt), exit = B.face > 0 ? 1310 : -30,
        initialX = departure[0] + B.face * Math.min(fall, kickAt - 4.55) * 7,
        x = initialX + (exit - initialX) * kick / Math.max(.25, 6.5 - kickAt),
        freeY = departure[1] + 105 * fall * fall,
        y = t < landedAt ? freeY : floor - Math.abs(Math.sin((t - landedAt) * 12)) * 2 * Math.exp(-(t - landedAt) * 5)
      if (x < -16 || x > 1296) return null
      watch([x, y])
      const release = between(t, 4.55, 4.85)
      return { atW: [x, y], side: departure[2], dir: [lerp(-1, Math.sin(kick * 14), release), lerp(.32, 1, release), 0], up: [0, 0, 1], t, spin: catchAt + kick * 10,
        heat: 0, tail: 0, fade: 1, box: box([[x, y]], 12) }
    })
    if (id === 'rain') add('abilityUmbrella', (t, k) => {
      const hand = grip(k), handWorld = worldPoint(hand)
      if (t < 3.4 || t > 5) watch([handWorld[0], handWorld[1] - 48])
      else { gaze.x = B.x; gaze.y = B.y - 35; gaze.z = 2000 }
      const open = shown(t, 1.8, 2.55, 5.65, 6.25)
      return common(hand, { dir: [1, .35 * (1 - open), 0], up: [0, -1, 0], open,
        rain: shown(t, 1.1, 1.8, 5.1, 5.6), dropLength: Math.max(65, (W.floor.y - handWorld[1]) / S + 22),
        k: shown(t, .8, 1.1, 6.8, 7.25), box: box([hand], 66) })
    })
    if (id === 'snow') add('abilitySnowflake', (t, k) => {
      const hand = held(k, ci, 3), h = worldPoint(hand)
      if (t < 2.1) {
        if (!contact) contact = predict(2.1, 3)
        const u = clamp((t - .45) / 1.65), x = contact[0] + B.face * 13 * Math.sin((1 - u) * 2),
          y = lerp(contact[1] - 67, contact[1], u)
        watch([x, y])
        return handContact({ atW: [x, y], dir: facing(), t, spin: t * .6, melt: 0,
          fade: shown(t, .35, .65, 6, 6.5), box: box([[x, y]], 14) }, between(t, 1.9, 2.1))
      }
      if (t < 4.1) { watch(h); return handContact(common(hand, { dir: facing(), t, melt: 0, spin: .3, box: box([hand], 15) })) }
      if (!departure) departure = releasedAt(h)
      const u = t - 4.1, x = departure[0] + B.face * (u * 65 + 6 * Math.sin(u * 5)),
        y = departure[1] - 16 * Math.sin(u) + u * 5
      return { atW: [x, y], side: departure[2], dir: facing(), t, spin: u * 2, supportOrientation: 1 - between(t, 4.1, 4.35), melt: between(t, 5.1, 6.35),
        fade: 1 - between(t, 5.8, 6.5), box: box([[x, y]], 16) }
    })
    if (id === 'snow' && raw.tools.custom && raw.tools.mk && raw.tools.mouth) {
      const effect = raw.tools.custom(duration, () => {
        const g = raw.tools.mk('g', { 'pointer-events': 'none', 'data-snow-breath': 'true', opacity: 0 })
        for (let i = 0; i < 3; i++) raw.tools.mk('path', { fill: 'none', stroke: '#78abc4',
          'stroke-width': 1.2, 'stroke-linecap': 'round' }, g)
        return g
      }, o => {
        if (dead || B.act !== action) { o.age = o.life; o.el.remove(); return }
        const t = action.t, opacity = shown(t, 4.02, 4.1, 4.36, 4.62)
        o.el.setAttribute('opacity', opacity)
        if (!opacity) return
        // FX выполняется после draw3d: heldCenter уже содержит настоящий контакт этого кадра.
        const mouth = raw.tools.mouth(), target = t < 4.1 && heldCenter.length ? heldCenter : snowPoint || raw.tools.hands()[ci],
          dx = target[0] - mouth[0], dy = target[1] - mouth[1], length = Math.hypot(dx, dy) || 1,
          width = Math.min(6, length * .22), pulse = .8 + .2 * Math.sin((t - 4.02) * 20)
        for (let i = 0; i < 3; i++) {
          const bend = (i - 1) * width * pulse
          o.el.children[i].setAttribute('d', `M${mouth[0].toFixed(3)} ${mouth[1].toFixed(3)}Q${((mouth[0] + target[0]) / 2 - dy / length * bend).toFixed(3)} ${((mouth[1] + target[1]) / 2 + dx / length * bend).toFixed(3)} ${target[0].toFixed(3)} ${target[1].toFixed(3)}`)
        }
      })
      flatOwned.add(effect)
    }
    if (id === 'starcatch') add('abilityStar', (t, k) => {
      const hand = held(k, ci, 10.5), h = worldPoint(hand)
      if (t < 1.9) {
        if (!contact) contact = predict(1.9, 10.5)
        const u = clamp((t - .25) / 1.65), point = [contact[0] + B.face * starCatchDistance * (1 - u), lerp(-18, contact[1], u * u)]
        watch(point)
        return handContact({ atW: point, t, k: 1.5,
          dir: facing(), spin: (1 - u) * 2, fade: t < .25 ? 0 : 1, box: box([point], 20) }, between(t, 1.7, 1.9))
      }
      if (t < 5.05) { watch(h); return handContact(common(hand, { k: 1.5,
        dir: facing(), spin: .3 * Math.sin(t), box: box([hand], 22) })) }
      if (!departure) departure = releasedAt(h)
      const u = (t - 5.05) / 1.5, x = departure[0] + B.face * 12 * u,
        y = departure[1] - (departure[1] + 40) * (.3 * u + .7 * u * u)
      if (y < -24) return null
      watch([x, y])
      return { atW: [x, y], side: departure[2], dir: facing(), t, k: 1.5, spin: u * 2, supportOrientation: 1 - between(t, 5.05, 5.3),
        fade: 1, box: box([[x, y]], 18) }
    })
    if (id === 'forceWall') add('abilityForceWall', (t, k) => {
      const a = grip(k), b = grip(k, fi), at = a.map((v, i) => (v + b[i]) / 2)
      return handContact(common(at, { dir: [1, 0, 0], impact: Math.sin(Math.PI * clamp((t - 2.13) / .65)),
        t, k: shown(t, .8, 1.25, 4.2, 4.95), fade: 1, box: box([at], 50) }), shown(t, .8, 1.25, 4.2, 4.95), 'press')
    })
    if (id === 'forceWall') add('abilityComet', (t, k) => {
      const a = grip(k), b = grip(k, fi), centre = worldPoint(a.map((v, i) => (v + b[i]) / 2))
      if (!departure && t >= 1.45) departure = centre
      const hit = 2.16, origin = departure || centre, approach = clamp((t - 1.45) / (hit - 1.45)), rebound = Math.max(0, t - hit),
        point = t < hit ? [origin[0] + B.face * 110 * (1 - approach * approach), origin[1] - 15 * (1 - approach)]
          : [origin[0] + B.face * (3 + rebound * 80), origin[1] - 55 * rebound + 85 * rebound * rebound]
      watch(point)
      return { atW: point, dir: t < hit ? [-1, .1, 0] : [1, -.25, 0], t, k: .55, heat: .2, tail: .25,
        fade: shown(t, 1.43, 1.53, 3.1, 3.5), box: box([point], 20) }
    })
    if (id === 'timeBubble') add('abilityTimeBubble', (t, k) => {
      const centre = [scene.startX, W.floor.y - 30],
        frozen = shown(t, 1.5, 1.9, 5, 5.5),
        elapsed = t < 1.5 ? t : t < 5 ? 1.5 + (t - 1.5) * .025 : 1.5875 + (t - 5)
      if (!contact) contact = centre
      watch(contact)
      return { atW: contact, t: elapsed, freeze: frozen, radius: 52, fragmentScale: 2.2,
        k: shown(t, .05, .25, 6.2, 6.8), box: box([contact], 110) }
    })

    action = gest(id, duration, scene.camera, (t, current) => {
      if (!current.gazeStarted) { current.gazeStarted = true; const mind = raw.mind?.(); mind?.look(null); mind?.look(gaze, duration + .1) }
      for (const state of props) { state.ping = true; if (t >= duration - .05) state.done = true }
      const p = scene.sample(t), hands = [0, 0]
      if (id === 'snow') {
        const breath = shown(t, 3.88, 4.05, 4.36, 4.62)
        p.mouth = lerp(p.mouth, .5, breath); p.smile = lerp(p.smile, 0, breath)
      }
      if (id === 'present' || id === 'spotlight') watch(focusPoint)
      if (id === 'energyOrb') p.handOpen = [.65, .65]
      if (id === 'sonicPulse') {
        hands[ci] = shown(t, .6, 1, 4.4, 5); hands[fi] = shown(t, .6, 1, 2.45, 3)
        p.handOpen = hands
      }
      if (id === 'thumbsUp') p.handShape = { kind: 'thumbsUp', side: ci, amount: shown(t, .7, 1.1, 2.6, 3.2) }
      if (id === 'salute' || id === 'present') { hands[ci] = shown(t, .4, .85, duration - 1, duration - .45); p.handOpen = hands }
      if (id === 'salute') p.handFacing = hands
      if (id === 'forcePush' || id === 'forceWall' || id === 'timeBubble') p.handOpen = [shown(t, .6, 1.1, duration - 1.5, duration - .7), shown(t, .6, 1.1, duration - 1.5, duration - .7)]
      if (id === 'comet') {
        // Optional handOpen не входит в инерцию суставов: раскрываем пальцы
        // из показанной позы, а с .25s сохраняем прежние catch/hold/release.
        hands[ci] = 1 - shown(t, 1.3, 1.6, 4, 4.55); hands[fi] = .5;
        if (t < .25) {
          current.cometOpenFrom ??= [0, 1].map(i => clamp(B.pose.handOpen?.[i] || 0));
          const entry = between(t, 0, .25);
          for (let i = 0; i < 2; i++) hands[i] = lerp(current.cometOpenFrom[i], hands[i], entry);
        }
        p.handOpen = hands;
      }
      if (id === 'comet' || id === 'snow' || id === 'starcatch') {
        const end = id === 'comet' ? 4.55 : id === 'snow' ? 4.1 : 5.05,
          amount = shown(t, 0, .5, end, end + .45);
        hands[ci] = Math.max(hands[ci], .82 * amount); p.handOpen = hands;
        const weights = [0, 0]; weights[ci] = amount;
        p.handTask = { kind: 'support', amount: weights };
      }
      if (id === 'forceWall') {
        const amount = shown(t, .55, 1.15, 4.3, 4.9);
        p.handTask = { kind: 'press', amount: [amount, amount] };
      }
      if (id === 'energyBow' || id === 'rain' || id === 'spotlight') { hands[ci] = shown(t, .8, 1.2, duration - 1.1, duration - .5); p.handFist = hands }
      return p
    }, { power: registry.get(id).preset === 'superhuman' })
    // Смысловой путь известен до первого кадра; вылетевшие за сцену предметы больше не обновляются.
    const floor = W.floor.y, start = scene.startX, sidePoint = distance => start + B.face * distance,
      base = [start - 55, floor - 105, start + 55, floor + 8],
      paths = {
        spotlight: box([[start, floor - 45], focusPoint], 36),
        celebrate: [start - 150, floor - 125, start + 150, floor + 12],
        energyOrb: [Math.min(start - 62, sidePoint(48) - 62), floor - 134, Math.max(start + 62, sidePoint(48) + 62), floor + 24],
        forcePush: box([[start, floor - 55], [B.face > 0 ? 1308 : -28, floor]], 32),
        energyBow: box([[start, floor - 60], [B.face > 0 ? 1308 : -28, floor - 30]], 24),
        orbit: [start - 90, floor - 155, start + 90, floor + 24],
        comet: box([[sidePoint(190), floor - 100], [B.face > 0 ? 1296 : -16, floor]], 30),
        rain: [start - 90, floor - 135, start + 90, floor + 50],
        snow: box([[start, floor - 120], [sidePoint(220), floor - 30]], 24),
        starcatch: box([[sidePoint(starCatchDistance + 20), -24], [start, floor]], 24),
        forceWall: box([[start, floor - 90], [sidePoint(240), floor + 45]], 30),
        timeBubble: [start - 115, floor - 145, start + 115, floor + 85]
      }, path = paths[id] || base,
      bounds = [Math.min(base[0], path[0]), Math.min(base[1], path[1]), Math.max(base[2], path[2]), Math.max(base[3], path[3])]
    action.canvasBounds = Object.freeze(bounds)
    action.frameBounds = Object.freeze([Math.max(0, bounds[0]), Math.max(0, bounds[1]), Math.min(1280, bounds[2]), Math.min(720, bounds[3])])
    return action
  }

  return Object.freeze({
    create,
    can(id) {
      if (!registry.has(id)) return 'Неизвестная дополнительная способность'
      if (dead) return 'Проигрыватель отключён'
      return B.surf?.kind !== 'floor' || B.mode !== 'ground' ? 'Нужна стойка на полу' : null
    },
    play(id) {
      const action = create(id)
      if (!action) return false
      B.queue = []
      raw.begin(action)
      return true
    },
    destroy() { if (dead) return; dead = true; finish() }
  })
}

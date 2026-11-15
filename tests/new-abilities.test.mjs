import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createAbilityPlayer, extraTechniques, reachArm } from '../src/new-abilities.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

function fixture(face = 1) {
  const core = runtimeFixture(face), { raw } = core, props = new Map(), history = [], registrations = []
  let builders = {}, handShapeSeen = false
  raw.tools.registerPropBuilders = factory => {
    registrations.push(factory); builders = { ...builders, ...factory({ THREE: {}, U: .0215 }) }; return 1
  }
  raw.tools.prop3 = (name, update) => {
    assert.equal(typeof builders[name], 'function', `${name}: существует настоящий 3D-builder`)
    const state = { ping: true, miss: 0 }, record = { name, state, update, params: null, visibleSeen: false, updates: 0 }
    props.set(name, record); history.push(record); return state
  }
  const updateProps = (dt = 0) => {
    for (const [name, record] of props) {
      const { state } = record
      state.miss = state.ping ? 0 : state.miss + dt; state.ping = false
      if (state.done || state.miss > .2) { props.delete(name); continue }
      record.params = record.update(state, raw.B.kk)
      if (record.params) {
        record.updates++
        record.visibleSeen ||= (record.params.fade ?? 1) > .05 && (record.params.k ?? 1) > .05
        numericGeometry(record.params, name)
        for (const key of ['fade', 'charge', 'heat', 'tail', 'open', 'rain', 'melt', 'freeze', 'draw', 'speed', 'impact', 'spread'])
          if (key in record.params) assert.ok(record.params[key] >= 0 && record.params[key] <= 1, `${name}: ${key} нормирован`)
        for (const key of ['at', 'atW', 'box', 'dir', 'to', 'up', 'grip']) if (key in record.params)
          assert.ok(Array.isArray(record.params[key]) && record.params[key].every(Number.isFinite), `${name}: ${key} задаётся числовыми координатами`)
        if (record.params.box) assert.ok(record.params.box[0] <= record.params.box[2] && record.params.box[1] <= record.params.box[3])
        if ('k' in record.params) {
          const limit = name === 'abilityOrbit' ? 3 : 2
          assert.ok(record.params.k >= 0 && record.params.k <= limit, `${name}: масштаб реквизита ограничен`)
        }
      }
    }
  }, player = createAbilityPlayer(raw, { host: core.host }),
    advance = (seconds, each, fps = 60) => {
      const dt = 1 / fps
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        raw.step(dt, fps); validPose(raw.B.pose, raw.B.act.name); updateProps(dt)
        handShapeSeen ||= raw.B.pose.handShape?.kind === 'thumbsUp' && raw.B.pose.handShape.amount > .9
        each?.(raw.B.act.t)
      }
    },
    params = name => { updateProps(); return props.get(name)?.params },
    worldPoint = point => [raw.B.x + (point[0] * Math.cos(raw.B.yaw) - point[2] * Math.sin(raw.B.yaw)) * raw.tools.S * raw.B.scale,
      raw.B.y + point[1] * raw.tools.S * raw.B.scale],
    centre = name => { const p = params(name); return p?.atW || (p?.at && worldPoint(p.at)) }
  return { ...core, player, props, history, registrations, advance, params, centre, get handShapeSeen() { return handShapeSeen },
    close() { player.destroy(); updateProps(); core.close() } }
}

const channels = ['rot', 'tl', 'ts', 'hp', 'hy', 'mouth', 'smile', 'lid', 'brow'],
  paired = ['sf', 'sa', 'ef', 'ea', 'hf', 'ha', 'kf', 'ka', 'af'],
  distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]))

function numericGeometry(value, path = '') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value) && Math.abs(value) < 100000, `${path}: конечная геометрия разумного масштаба`)
  else if (Array.isArray(value)) value.forEach((part, index) => numericGeometry(part, `${path}[${index}]`))
  else if (value && typeof value === 'object') for (const [key, part] of Object.entries(value)) numericGeometry(part, `${path}.${key}`)
}

function validPose(pose, id) {
  for (const key of channels) assert.ok(Number.isFinite(pose[key]) && Math.abs(pose[key]) <= 720, `${id}: канал ${key}`)
  for (const key of paired) {
    assert.equal(pose[key].length, 2)
    assert.ok(pose[key].every(value => Number.isFinite(value) && Math.abs(value) <= 360), `${id}: парный канал ${key}`)
  }
  for (const key of ['handOpen', 'handFist']) if (pose[key]) {
    assert.equal(pose[key].length, 2)
    assert.ok(pose[key].every(value => value >= 0 && value <= 1), `${id}: ${key} нормирован`)
  }
  if (pose.handShape) {
    assert.equal(pose.handShape.kind, 'thumbsUp')
    assert.ok([0, 1].includes(pose.handShape.side))
    assert.ok(pose.handShape.amount >= 0 && pose.handShape.amount <= 1)
  }
}

test('все номера завершаются с конечной позой и очищают 3D-реквизит в обе стороны', () => {
  const ids = new Set()
  for (const entry of extraTechniques) {
    assert(!ids.has(entry.id), 'Идентификаторы приёмов уникальны')
    ids.add(entry.id)
    assert(entry.duration > 0 && entry.duration <= 10)
    for (const facing of [-1, 1]) {
      const f = fixture(facing)
      try {
        assert.equal(f.registrations.length, 1, 'Builders регистрируются один раз при подключении')
        assert.equal(f.player.play(entry.id), true)
        assert.equal(f.raw.B.act.power, entry.preset === 'superhuman', `${entry.id}: плащ определяется пресетом способности`)
        f.advance(entry.duration + .3)
        assert.equal(f.raw.B.act.name, 'idle', `${entry.id}: вернулся в спокойную стойку`)
        assert.equal(f.props.size, 0, `${entry.id}: 3D-реквизит освобождён`)
        assert.equal(f.raw.B.fxs.length, 0, `${entry.id}: SVG-эффекты не оставлены`)
        assert.ok(f.history.length <= 3, `${entry.id}: реквизит не пересоздаётся каждый кадр`)
        if (!['salute', 'bow', 'present', 'thumbsUp', 'sonicPulse'].includes(entry.id)) {
          assert.ok(f.history.length > 0, `${entry.id}: объёмный реквизит действительно создаётся`)
          assert.ok(f.history.every(record => record.visibleSeen && record.updates > 3), `${entry.id}: реквизит виден в ходе номера`)
        }
        if (entry.id === 'thumbsUp') assert.ok(f.handShapeSeen, 'Жест действительно меняет форму кисти')
      } finally { f.close() }
    }
  }
})

test('план номера заранее вмещает весь реквизит и не меняется во время действия', () => {
  for (const entry of extraTechniques) for (const face of [-1, 1]) {
    const f = fixture(face)
    try {
      const action = f.player.create(entry.id), planned = [...action.canvasBounds]
      assert.ok(action.frameBounds[0] >= 0 && action.frameBounds[1] >= 0
        && action.frameBounds[2] <= 1280 && action.frameBounds[3] <= 720)
      f.raw.begin(action)
      f.advance(entry.duration, () => {
        for (const record of f.props.values()) if (record.params?.box) {
          const b = record.params.box
          assert.ok(b[0] >= planned[0] - .01 && b[1] >= planned[1] - .01 && b[2] <= planned[2] + .01 && b[3] <= planned[3] + .01,
            `${entry.id}, ${record.name}: ${b.join(',')} вне резерва ${planned.join(',')}`)
        }
      }, 30)
      assert.deepEqual(action.canvasBounds, planned, 'Резерв не растёт в полёте')
    } finally { f.close() }
  }
})

test('звезда, ящик и пнутая комета уходят за край без исчезновения в середине сцены', () => {
  for (const face of [-1, 1]) {
    for (const [id, prop, time, axis] of [['starcatch', 'abilityStar', 6.4, 'top'],
      ['forcePush', 'abilityCrate', 4.8, 'side'], ['comet', 'abilityComet', 6.3, 'side']]) {
      const f = fixture(face)
      try {
        f.player.play(id); f.advance(time)
        const params = f.params(prop)
        assert.ok(params, `${id}: предмет ещё виден перед выходом`)
        assert.equal(params.fade ?? 1, 1, `${id}: выход не подменён растворением`)
        if (axis === 'top') assert.ok(params.atW[1] < 130)
        else assert.ok(face > 0 ? params.atW[0] > 1150 : params.atW[0] < 130)
        f.advance(id === 'forcePush' ? .5 : .35)
        assert.equal(f.params(prop), null, `${id}: после выхода нет 3D-данных и лишнего P.box`)
      } finally { f.close() }
    }
    const f = fixture(face)
    try {
      f.player.play('comet'); f.advance(5.48, null, 1000)
      const ball = f.centre('abilityComet'), b = f.raw.B, toe = b.kk.legs[face > 0 ? 0 : 1].toe,
        foot = [b.x + (toe[0] * Math.cos(b.yaw) - toe[2] * Math.sin(b.yaw)) * f.raw.tools.S, b.y + toe[1] * f.raw.tools.S]
      assert.ok(distance(ball, foot) < 3.5, 'Комета начинает выкат в контакте с носком')
    } finally { f.close() }
  }
})

test('оклик виден в SVG без 3D-реквизита и плаща, а прерывание удаляет облачко', () => {
  for (const face of [-1, 1]) {
    const f = fixture(face)
    try {
      assert.equal(f.player.play('sonicPulse'), true)
      f.advance(1.8)
      assert.equal(f.history.length, 0, 'Оклик не создаёт объёмные волны')
      assert.equal(f.raw.B.act.power, false, 'Оклик не включает плащ')
      const effect = f.raw.B.fxs.find(item => item.el.children.some(child => child.tagName === 'TEXT' && child.textContent === 'Hey!'))
      assert.ok(effect, 'Облачко с окликом действительно создано')
      assert.ok(effect.el.parentNode, 'Облачко находится в SVG-сцене')
      assert.ok(Number(effect.el.getAttribute('opacity')) > .9, 'Оклик виден в фазе обращения к залу')
      f.raw.begin(f.raw.MAKE.wave()); f.advance(.05)
      assert.equal(effect.el.parentNode, null, 'Прерывание удаляет облачко из сцены')
      assert.ok(!f.raw.B.fxs.includes(effect), 'Прерванный эффект удалён из планировщика')
    } finally { f.close() }
  }
})

test('прерывание и destroy удаляют только собственный 3D-реквизит', () => {
  const f = fixture()
  try {
    f.player.play('rain'); f.advance(1)
    const umbrella = f.history.find(record => record.name === 'abilityUmbrella')
    assert.ok(umbrella?.params)
    f.player.play('salute'); f.advance(.05)
    assert.ok(umbrella.state.done)
    assert.ok(!f.props.has('abilityUmbrella'))
    f.player.play('orbit'); f.advance(1)
    const foreign = { ping: true, miss: 0 }
    f.props.set('foreign', { state: foreign, update: () => ({ at: [0, 0, 0], k: 1 }) })
    f.player.destroy(); f.player.destroy(); f.params('foreign')
    assert.deepEqual([...f.props.keys()], ['foreign'])
    assert.equal(foreign.done, undefined)
    assert.equal(f.player.play('rain'), false)
  } finally { f.close() }
})

test('нет старта в воздухе, при reduced motion и для неизвестного id; create не запускает действие', () => {
  const f = fixture()
  try {
    const previous = f.raw.B.act
    assert(f.player.create('salute')); assert.equal(f.raw.B.act, previous)
    f.raw.B.mode = 'free'; assert(f.player.can('rain')); assert.equal(f.player.play('rain'), false)
    f.raw.B.mode = 'ground'
    const reduced = createAbilityPlayer({ ...f.raw, reduced: true })
    assert.equal(reduced.play('rain'), false); reduced.destroy()
    assert(f.player.can('unknown')); assert.equal(f.player.create('unknown'), null)
  } finally { f.close() }
})

test('reachArm достигает целевой кисти настоящим решателем при развороте и наклоне корпуса', () => {
  const f = fixture(), targets = [[23, -24, 9], [13, -23, 8], [5, -40, 12], [9, -48, 1], [14, -37, 5], [27, -28, 5]]
  try {
    for (const index of [0, 1]) for (const turn of [0, .4, 1]) for (const tilt of [0, 15]) for (const target of targets) {
      const desired = [target[0], target[1], target[2] * (index ? -1 : 1)],
        pose = f.raw.tools.pose({ tl: tilt, ts: -4 }), solved = f.raw.tools.solve(reachArm(pose, index, desired, turn), 1, turn),
        expected = desired.map((_, axis) => solved.T[0][axis] * desired[0] + solved.T[1][axis] * desired[1] + solved.T[2][axis] * desired[2])
      assert.ok(distance(solved.arms[index].hand, expected) < .05,
        `Кисть ${index}, turn=${turn}, tl=${tilt}, цель ${desired}: ошибка ${distance(solved.arms[index].hand, expected)}`)
    }
  } finally { f.close() }
})

test('свободный полёт предметов до ловли и после выпуска не привязан к перемещению тела', () => {
  const cases = [['comet', 'abilityComet', .9, 4.9], ['snow', 'abilitySnowflake', 1.3, 4.5],
    ['starcatch', 'abilityStar', 1.1, 5.4], ['energyBow', 'abilityArrow', null, 3.4]]
  for (const [id, prop, before, after] of cases) for (const time of [before, after].filter(value => value !== null)) {
    const f = fixture()
    try {
      f.player.play(id); f.advance(time)
      const initial = f.params(prop)?.atW
      assert.ok(initial, `${id} в фазе ${time} использует координаты мира`)
      f.raw.B.x += 80; f.raw.B.y -= 30; f.raw.B.yaw += .4
      assert.deepEqual(f.params(prop)?.atW, initial, `${id}: летящий предмет не двигается вместе с телом`)
    } finally { f.close() }
  }
})

test('при ловле кометы, снежинки и звезды нет скачка между миром и ладонью', () => {
  for (const [id, prop, catchAt] of [['comet', 'abilityComet', 1.32], ['snow', 'abilitySnowflake', 2.1], ['starcatch', 'abilityStar', 1.9]]) {
    for (const face of [-1, 1]) {
      const f = fixture(face), samples = []
      try {
        f.player.play(id)
        // Падение с верхнего края даёт несколько пикселей за 1/240 с; стык проверяем на 1 кГц,
        // чтобы прежний допуск 2,5 px отличал скачок контакта от быстрого свободного движения.
        f.advance(catchAt + .08, () => {
          const time = f.raw.B.act.t
          if (time >= catchAt - .04) { const centre = f.centre(prop); if (centre) samples.push(centre) }
        }, 1000)
        assert.ok(samples.length > 10)
        const jumps = samples.slice(1).map((point, index) => distance(point, samples[index]))
        assert.ok(Math.max(...jumps) < 2.5, `${id}, face=${face}: скачок ${Math.max(...jumps).toFixed(2)}px при ловле`)
      } finally { f.close() }
    }
  }
})

test('пойманные предметы следуют ладони, пока их снова не отпустили', () => {
  for (const [id, prop, time] of [['comet', 'abilityComet', 2.4], ['snow', 'abilitySnowflake', 2.8], ['starcatch', 'abilityStar', 3]]) {
    const f = fixture()
    try {
      f.player.play(id); f.advance(time)
      const held = f.centre(prop)
      assert.ok(held)
      f.raw.B.x += 80; f.raw.B.y -= 30
      const moved = f.centre(prop)
      assert.ok(distance(moved, [held[0] + 80, held[1] - 30]) < .01, `${id}: предмет остаётся в ладони после ловли`)
    } finally { f.close() }
  }
})

test('фонарик достигает далёкой приоритетной цели при развороте и масштабировании сцены', () => {
  for (const [focusX, initialFace, scale] of [[100, 1, 1], [1150, -1, .5]]) {
    const f = fixture(initialFace), left = 37, top = 51, focusY = 110,
      element = (x, y, width = 120, height = 60) => ({ getBoundingClientRect: () => ({
        left: left + (x - width / 2) * scale, top: top + (y - height / 2) * scale,
        width: width * scale, height: height * scale
      }) }),
      focus = element(focusX, focusY), lowerPriority = element(focusX < 640 ? 1180 : 80, 210)
    f.stage.getBoundingClientRect = () => ({ left, top, width: 1280 * scale, height: 720 * scale })
    f.slide.querySelector = selector => selector === '[data-buddy-focus]' ? focus
      : selector === '[data-buddy-target]' || selector === 'h1' ? lowerPriority : null
    try {
      assert.equal(f.player.play('spotlight'), true)
      f.advance(2.5)
      const prop = f.params('abilityFlashlight')
      assert.ok(prop?.beam > .99, 'Проверяется включённый луч')
      assert.equal(f.raw.B.face, Math.sign(focusX - f.raw.B.x), 'Персонаж повернулся к приоритетной цели')
      const sourceDistance = distance(prop.at, prop.to),
        projectedTarget = [f.raw.B.x + (prop.to[0] * Math.cos(f.raw.B.yaw) - prop.to[2] * Math.sin(f.raw.B.yaw)) * f.raw.tools.S * f.raw.B.scale,
          f.raw.B.y + prop.to[1] * f.raw.tools.S * f.raw.B.scale]
      assert.ok(distance(projectedTarget, [focusX, focusY]) < 1e-6,
        'Локальная 3D-цель проецируется на data-buddy-focus, а не на менее приоритетный заголовок')
      assert.ok(prop.beamLength > 360, 'Дальняя цель требует луча длиннее прежнего ограничения')
      assert.ok(Math.abs(sourceDistance - prop.beamLength - 6.4) < 1e-6,
        'Конус от края фонарика доходит до цели без обрезания по длине')
    } finally { f.close() }
  }
})

test('прерывание номера убирает его цель взгляда, сохраняя независимые цели', () => {
  const f = fixture()
  try {
    f.player.play('rain'); f.advance(1)
    const mind = f.raw.mind(), point = mind.queue.find(item => typeof item.p?.active === 'function')?.p
    assert.ok(point, 'Сначала номер действительно управляет взглядом')
    const independent = { x: 100, y: 150, z: 0 }
    mind.look(independent, 5)
    f.raw.begin(f.raw.MAKE.wave()); f.advance(.05)
    assert.ok(!mind.queue.some(item => item.p === point), 'Прерванная цель удалена из очереди')
    assert.notEqual(mind._want, point, 'Глаза больше не следуют старому предмету')
    assert.ok(mind.queue.some(item => item.p === independent), 'Цель без привязки к номеру сохраняется')
  } finally { f.close() }
})

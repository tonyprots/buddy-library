import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { createBuddy } from '../../src/index.js'
import { runtimeFixture } from '../support/runtime-fixture.mjs'

const rows = [], G = 9.81 * 100 / 1.75 * .45,
  launch = raw => raw.launchParachute ? raw.launchParachute(440) : (raw.B.forceChute = true, raw.B.passPlats = true, raw.drop(440), true),
  feet = raw => raw.B.kk.legs.flatMap(g => [g.heel, g.toe]).map(p => raw.B.y + p[1] * raw.tools.S * raw.B.scale),
  hands = raw => raw.B.kk.arms.map(a => [a.hand[0], a.hand[1], a.hand[2]].map(v => v * raw.tools.S)),
  nodes = root => [root, ...root.children.flatMap(nodes)]

after(() => {
  if (process.env.BUDDY_PARACHUTE_LAUNCH_REPORT)
    writeFileSync(process.env.BUDDY_PARACHUTE_LAUNCH_REPORT, JSON.stringify({ rows }, null, 2) + '\n', { flag: 'wx' })
})

test('публичный play запускает парашют с пола без синхронного телепорта', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false })
    buddy.pause(); buddy.reset(); buddy.progress(1)
    const before = buddy.experimental.B.y
    assert.equal(buddy.can('parachute'), null)
    assert.equal(buddy.play('parachute'), true)
    assert.equal(buddy.experimental.B.y, before, 'play не переносит таз на будущую вершину')
    assert.equal(buddy.experimental.B.mode, 'ground')
    const framing = buddy.framing()
    assert.ok(framing.planned && framing.planned[1] <= 170 && framing.planned[3] >= 700)
    assert.equal(framing.detail, null, 'Будущий путь не является видимым реквизитом')
    buddy.reset()
    const block = new f.stage.constructor('img')
    block.closest = () => null; block.hasAttribute = name => block.getAttribute(name) !== null
    block.getBoundingClientRect = () => ({ left: 0, top: 300, right: 1280, bottom: 560, width: 1280, height: 260 })
    f.slide.querySelectorAll = selector => selector === '*' ? [block] : []
    buddy.rescan()
    assert.match(buddy.can('parachute'), /corridor/u)
    const refusedY = buddy.experimental.B.y
    assert.throws(() => buddy.play('parachute'), /corridor/u)
    assert.equal(buddy.experimental.B.y, refusedY)
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

for (const face of [-1, 1]) for (const fps of [30, 60, 120, 240, 480]) test(`подготовка, баллистика и handoff парашюта: ${face}/${fps}Hz`, () => {
  const f = runtimeFixture(face), { raw } = f, b = raw.B, dt = 1 / fps,
    row = { face, fps, maxArmStep: 0, maxHandStep: 0, maxContactError: 0, flight: [] }
  try {
    raw.step(dt, fps)
    let priorPose = structuredClone(b.pose), priorHands = hands(raw), previousY = b.y, handoff = false, grounded = 0, apexHeld = false
    launch(raw)
    for (let n = 0; n < fps * 5; n++) {
      const previousAction = b.act.name
      raw.step(dt, fps)
      const p = b.pose, currentHands = hands(raw)
      row.maxArmStep = Math.max(row.maxArmStep, ...['sf', 'sa', 'ef', 'ea'].flatMap(k => p[k].map((v, i) => Math.abs(v - priorPose[k][i]))))
      row.maxHandStep = Math.max(row.maxHandStep, ...currentHands.map((p, i) => Math.hypot(...p.map((v, j) => v - priorHands[i][j]))))
      if (b.mode === 'ground') {
        grounded++; row.maxContactError = Math.max(row.maxContactError, Math.abs(Math.max(...feet(raw)) - 700))
      } else if (b.act.name !== 'chute') {
        if (!row.flight.length) assert.ok(Math.abs(b.y - previousY) < (fps < 60 ? 520 / fps : 1e-9), 'Отрыв начинается с фактической последней высоты таза на полу; 30Hz содержит два внутренних шага')
        row.flight.push([b.act.t, b.x, b.y])
      }
      if (b.act.name !== 'chute') assert.equal(raw.frameBounds().detail, null)
      if (b.act.name === 'chute') {
        handoff = true; row.handoffY = b.y; row.handoffAt = n * dt
        assert.notEqual(previousAction, 'chute')
        const substepTravel = fps < 60 ? G / 60 ** 2 + 1e-9 : 1e-9
        assert.ok(Math.abs(b.y - 260) < substepTravel, 'Передача на вершине 700−440; 30Hz может включать первый внутренний шаг спуска')
        assert.ok(Math.abs(b.y - previousY) < substepTravel, 'Поза на вершине показана до lazy-конструкции купола')
        assert.ok(nodes(f.host).some(node => node.getAttribute('data-buddy-parachute-canopy') === 'svg'))
        break
      }
      apexHeld ||= Math.abs(b.y - 260) < 1e-9
      previousY = b.y; priorPose = structuredClone(p); priorHands = currentHands
    }
    row.groundDuration = grounded * dt; rows.push(row)
    assert.ok(handoff && (apexHeld || fps < 60) && row.flight.length > fps)
    assert.ok(row.groundDuration >= .3 && row.groundDuration <= .35, 'Видимая подготовка длится 0,3–0,35 с')
    assert.ok(row.maxArmStep < 960 / fps && row.maxHandStep < 300 / fps, 'Нет скачка рук при приседе, отрыве и раскрытии: ' + JSON.stringify({ ...row, flight: undefined }))
    assert.ok(row.maxContactError < 1e-7)
    const expectedAscent = Math.sqrt(2 * (row.flight[0][2] - 260) / G), actualAscent = row.flight.at(-1)[0] - row.flight[0][0]
    assert.ok(Math.abs(actualAscent - expectedAscent) <= dt + 1e-9, 'Скорость и длительность определены фактической высотой старта и G')
    const flight = row.flight.filter((p, i) => i > 1 && i < row.flight.length - 2)
    for (let i = 1; i < flight.length - 1; i++) {
      const acceleration = (flight[i + 1][2] - 2 * flight[i][2] + flight[i - 1][2]) / dt ** 2
      assert.ok(Math.abs(acceleration - G) < 1e-5, 'Равномерная гравитация, без eased-пути')
      assert.ok(Math.abs(flight[i][1] - flight[0][1]) < 1e-9, 'Полёт строго вертикальный')
    }
    raw.step(12, fps)
    assert.equal(b.act.name, 'idle'); assert.ok(Math.abs(Math.max(...feet(raw)) - 700) < 1e-7)
  } finally { f.close() }
})

test('парашют идёт к свободному коридору, а недоступный коридор даёт отказ без мутации', () => {
  const f = runtimeFixture(), { raw } = f, b = raw.B
  try {
    raw.W.ob = [{ x1: 520, x2: 760, y1: 300, y2: 560 }]
    const start = b.x
    assert.equal(raw.availability('parachute'), null)
    assert.equal(launch(raw), true)
    assert.equal(b.x, start); assert.equal(b.mode, 'ground')
    assert.equal(b.act.name, 'walk', 'Под препятствием сначала идёт по полу')
    const framing = raw.frameBounds()
    assert.ok(framing.planned && framing.detail === null)
    for (let n = 0; n < 120 * 35 && b.mode === 'ground'; n++) raw.step(1 / 120, 120)
    assert.equal(b.mode, 'free'); assert.ok(b.x < 410 || b.x > 870, 'Тело и купол находятся сбоку от преграды')
    raw.reset(); raw.W.ob = [{ x1: 0, x2: 1280, y1: 300, y2: 560 }]
    const before = { x: b.x, y: b.y, action: b.act, queue: b.queue }
    assert.match(raw.availability('parachute'), /corridor/u)
    assert.equal(launch(raw), false)
    assert.deepEqual({ x: b.x, y: b.y, action: b.act, queue: b.queue }, before)
  } finally { f.close() }
})

test('отмена подготовки и полёта не оставляет отложенного парашюта', () => {
  for (const time of [.15, .8, 2.3]) for (const reset of [false, true]) {
    const f = runtimeFixture(), { raw } = f
    try {
      launch(raw); raw.step(time, 120)
      if (reset) raw.reset()
      else raw.run(['wave'])
      const y = raw.B.y
      raw.step(1 / 120, 120)
      assert.ok(Math.abs(raw.B.y - y) < 8, 'Отмена не телепортирует тело')
      raw.step(15, 120)
      assert.equal(raw.B.act.name, 'idle'); assert.equal(raw.B.queue.length, 0)
      assert.equal(raw.B.forceChute, false); assert.equal(raw.B.passPlats, false)
      assert.ok(!nodes(f.host).some(node => node.getAttribute('data-buddy-parachute-canopy') === 'svg'))
    } finally { f.close() }
  }
})

test('запуск сохраняет текущий масштаб и опору, а скорость учитывает фактическую высоту таза', () => {
  for (const scale of [.5, 1.8]) {
    const f = runtimeFixture(), { raw } = f, b = raw.B
    try {
      b.scale = b.scaleT = scale; raw.step(.1, 120)
      const y = b.y
      assert.equal(launch(raw), true)
      assert.equal(b.scale, scale); assert.equal(b.y, y)
      for (let n = 0; n < 120 * 5 && b.act.name !== 'chute'; n++) {
        raw.step(1 / 120, 120)
        assert.equal(b.scale, scale)
        if (b.mode === 'ground') assert.ok(Math.abs(Math.max(...feet(raw)) - 700) < 1e-7)
      }
      assert.equal(b.act.name, 'chute'); assert.ok(Math.abs(b.y - 260) < 1e-9)
    } finally { f.close() }
  }
})

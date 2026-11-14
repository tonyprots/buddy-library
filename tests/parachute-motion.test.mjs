import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'
import { createPreviewCamera } from '../camera.js'

const nodes = root => [root, ...root.children.flatMap(nodes)],
  worldPoints = raw => {
    const { B, tools } = raw, project = point => [
      B.x + (point[0] * Math.cos(B.yaw) - point[2] * Math.sin(B.yaw)) * tools.S * B.scale,
      B.y + point[1] * tools.S * B.scale
    ]
    return [...B.kk.arms.map(arm => project(arm.hand)), ...B.kk.legs.flatMap(leg => [project(leg.heel), project(leg.toe)])]
  }

test('автокамера заранее вмещает парашют, затем приближается без потери персонажа', () => {
  for (const mode of ['auto', 'closeup']) for (const face of [-1, 1]) {
    const f = runtimeFixture(face), camera = createPreviewCamera({ mode }), viewport = { width: 1045, height: 540 }
    try {
      const { raw } = f
      raw.step(1 / 60)
      camera.update({ ...viewport, ...raw.frameBounds() })
      raw.B.forceChute = true; raw.drop(440)
      let scale = 0
      for (let i = 0; i < 180; i++) {
        const framing = raw.frameBounds(), bounds = framing.planned
        if (i === 0) assert.ok(bounds && bounds[1] < 200 && bounds[3] >= raw.W.floor.y, 'Первый кадр заранее включает путь появления')
        const frame = camera.update({ ...viewport, ...framing })
        scale = frame.scale
        for (const box of [bounds, framing.actor, framing.props].filter(Boolean)) {
          assert.ok(box[1] * frame.scale + frame.y >= -.01, 'Верх виден при запуске и раскрытии')
          assert.ok(box[3] * frame.scale + frame.y <= viewport.height + .01, 'Посадка видна')
        }
        raw.step(1 / 120, 120)
      }
      assert.ok(scale > 1.8, 'Путь появления не удерживает слишком мелкий план на всём спуске')
    } finally { f.close() }
  }
})

test('парашют ловит пересечённую платформу даже при большой начальной скорости', () => {
  for (const fps of [30, 60, 120]) {
    const f = runtimeFixture()
    try {
      const { raw } = f, plat = { kind: 'plat', y: 500, x1: 300, x2: 1000, spans: [[320, 980]] }
      raw.W.plats = [plat]
      Object.assign(raw.B, { x: 640, y: 470, forceChute: true })
      raw.begin(raw.fall(3000))
      for (let i = 0; i < fps && raw.B.mode !== 'ground'; i++) raw.step(1 / fps, fps)
      assert.equal(raw.B.surf, plat, `Платформа не пропущена при ${fps} Hz`)
      assert.ok(Math.abs(Math.max(...worldPoints(raw).slice(2).map(point => point[1])) - plat.y) < .01)
    } finally { f.close() }
  }
})

test('вход, управляемый спуск и посадка парашюта непрерывны в обе стороны', () => {
  for (const face of [-1, 1]) for (const fps of [30, 60, 120]) {
    const f = runtimeFixture(face)
    try {
      const { raw } = f
      raw.B.forceChute = true; raw.drop(440)
      let previous, priorPose, maxHandSpeed = 0, maxAngleSpeed = 0, landed = false
      for (let i = 0; i < fps * 12; i++) {
        raw.step(1 / fps, fps)
        const points = worldPoints(raw), pose = raw.B.pose
        if (previous) points.slice(0, 2).forEach((point, arm) => {
          maxHandSpeed = Math.max(maxHandSpeed, Math.hypot(...point.map((value, axis) => value - previous[arm][axis])) * fps)
        })
        if (priorPose) for (const key of ['sf', 'sa', 'ef', 'ea', 'hf', 'kf']) pose[key].forEach((value, limb) => {
          const delta = Math.abs(value - priorPose[key][limb]) % 360
          maxAngleSpeed = Math.max(maxAngleSpeed, Math.min(delta, 360 - delta) * fps)
        })
        if (raw.B.mode === 'ground') {
          landed = true
          assert.ok(Math.abs(Math.max(...points.slice(2).map(point => point[1])) - raw.W.floor.y) < .01)
        }
        previous = points
        priorPose = Object.fromEntries(['sf', 'sa', 'ef', 'ea', 'hf', 'kf'].map(key => [key, [...pose[key]]]))
        if (landed && raw.B.act.name === 'idle') break
      }
      assert.ok(landed)
      assert.equal(raw.B.act.name, 'idle')
      assert.ok(maxHandSpeed < 360, `Кисть: ${maxHandSpeed.toFixed(2)} px/с при ${fps} Hz, face ${face}`)
      assert.ok(maxAngleSpeed < 720, `Сустав: ${maxAngleSpeed.toFixed(2)}°/с при ${fps} Hz, face ${face}`)
    } finally { f.close() }
  }
})

test('SVG-парашют видим, стропы доходят до рук и реквизит очищается после посадки или прерывания', () => {
  const f = runtimeFixture()
  try {
    const { raw, host } = f
    raw.B.forceChute = true; raw.drop(440); raw.step(1)
    const canopy = nodes(host).find(node => node.getAttribute('data-buddy-parachute-canopy') === 'svg'),
      cords = nodes(host).filter(node => node.getAttribute('data-buddy-parachute-cord') !== null)
    assert.ok(canopy?.parentNode && canopy.getAttribute('d')?.includes('C'), 'Настоящий купол нарисован в SVG fallback')
    assert.equal(cords.length, 6)
    assert.ok(cords.every(node => /^M[-.\d]+ [-.\d]+L[-.\d]+ [-.\d]+$/u.test(node.getAttribute('d'))), 'Шесть натянутых строп имеют реальные координаты')
    const hands = raw.tools.hands()
    cords.forEach((node, i) => {
      const endpoint = node.getAttribute('d').split('L')[1].split(' ').map(Number), expected = hands[i < 3 ? 0 : 1]
      assert.ok(Math.hypot(endpoint[0] - expected[0], endpoint[1] - expected[1]) < .01, 'Стропа закреплена в отображаемой кисти')
    })
    raw.step(8)
    assert.equal(raw.B.act.name, 'idle')
    assert.ok(!host.contains(canopy), 'Купол удалён после посадки')
    raw.B.forceChute = true; raw.drop(440); raw.step(1)
    const interrupted = nodes(host).find(node => node.getAttribute('data-buddy-parachute-canopy') === 'svg')
    raw.run(['wave']); raw.step(.3)
    assert.ok(!host.contains(interrupted), 'Прерванный купол удалён; новое безопасное падение может раскрыть собственный')
    raw.step(10)
    assert.ok(!nodes(host).some(node => node.getAttribute('data-buddy-parachute-canopy') === 'svg'))
  } finally { f.close() }
})

test('после посадки стропы отпускаются вместе с руками, а купол опадает сбоку без пересечения головы', () => {
  for (const face of [-1, 1]) {
    const f = runtimeFixture(face)
    try {
      const { raw, host } = f
      raw.B.forceChute = true; raw.drop(440)
      for (let i = 0; i < 600 && raw.B.mode !== 'ground'; i++) raw.step(1 / 60)
      const canopy = nodes(host).find(node => node.getAttribute('data-buddy-parachute-canopy') === 'svg'),
        cords = nodes(host).filter(node => node.getAttribute('data-buddy-parachute-cord') !== null)
      assert.equal(cords.filter(node => node.getAttribute('d')).length, 6, 'В момент касания руки ещё держат стропы')
      let slackSeen = false, minClearance = Infinity, flatWidth = null
      for (let i = 0; i < 150 && host.contains(canopy); i++) {
        raw.step(1 / 60)
        slackSeen ||= cords.some(node => node.getAttribute('d')?.includes('Q'))
        const box = raw.frameBounds().detail, b = raw.B, head = b.kk.head,
          headX = b.x + (head[0] * Math.cos(b.yaw) - head[2] * Math.sin(b.yaw)) * raw.tools.S * b.scale,
          headY = b.y + head[1] * raw.tools.S * b.scale, radius = 12 * raw.tools.S * b.scale
        if (box && box[3] >= headY - radius && box[1] <= headY + radius) {
          const clearance = Math.max(box[0] - headX, headX - box[2]) - radius
          minClearance = Math.min(minClearance, clearance)
          assert.ok(clearance > 1, 'Вся ткань находится сбоку от головы до спуска на её высоту')
          flatWidth = box[2] - box[0]
        }
      }
      assert.ok(slackSeen, 'Перед исчезновением стропы видимо провисают')
      assert.ok(Number.isFinite(minClearance), 'Купол действительно опустился ниже уровня головы')
      assert.ok(flatWidth < 45, 'Опавший купол сжимается в компактную ткань, а не расширяется в тарелку')
      assert.equal(raw.B.act.name, 'idle')
    } finally { f.close() }
  }
})

test('хват закрывается до натяжения строп и плавно открывается при отпускании', () => {
  for (const face of [-1, 1]) {
    const f = runtimeFixture(face)
    try {
      const { raw, host } = f
      raw.B.forceChute = true; raw.drop(440)
      let prior = [0, 0], fullGripSamples = 0, maxStep = 0, released = false
      for (let i = 0; i < 1200; i++) {
        raw.step(1 / 120, 120)
        const b = raw.B, grip = b.pose.handFist || [0, 0], cords = nodes(host).filter(node => node.getAttribute('data-buddy-parachute-cord') !== null)
        maxStep = Math.max(maxStep, ...grip.map((value, i) => Math.abs(value - prior[i])))
        if (b.act.name === 'chute' && b.mode === 'free' && b.act.t > .3 && cords.some(node => node.getAttribute('d'))) {
          assert.deepEqual(grip, [1, 1], 'Натянутые стропы держат две сомкнутые кисти')
          fullGripSamples++
        }
        if (b.mode === 'ground' && b.act.name === 'chute' && grip.every(value => value === 0)) released = true
        prior = grip
        if (b.act.name === 'idle') break
      }
      assert.ok(fullGripSamples > 200 && released)
      assert.ok(maxStep < .08, 'Нет мгновенного сжатия или раскрытия кисти')
      assert.equal(raw.B.pose.handFist, undefined, 'Канал не переходит в idle')
    } finally { f.close() }
  }
})

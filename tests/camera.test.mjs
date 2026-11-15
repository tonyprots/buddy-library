import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPreviewCamera, fitFrame, unionBounds } from '../src/camera.js'

test('кадр вмещает предмет и персонажа с полями на широком и узком экране', () => {
  const bounds = unionBounds([610, 650, 670, 710], [700, 0, 780, 160])
  for (const [width, height] of [[960, 540], [320, 360]]) {
    const frame = fitFrame(bounds, width, height)
    assert.ok(bounds[0] * frame.scale + frame.x >= 35.99)
    assert.ok(bounds[2] * frame.scale + frame.x <= width - 35.99)
    assert.ok(bounds[1] * frame.scale + frame.y >= 35.99)
    assert.ok(bounds[3] * frame.scale + frame.y <= height - 35.99)
  }
})

test('ручной общий план сохраняется при смене действия и размера персонажа', () => {
  const camera = createPreviewCamera({ mode: 'overview' }), viewport = { width: 960, height: 540 }
  const first = camera.update({ ...viewport, actor: [620, 650, 660, 710] })
  const second = camera.update({ ...viewport, actor: [400, 380, 700, 710], planned: [0, 0, 1280, 720] })
  assert.deepEqual(second, first)
  assert.equal(camera.mode, 'overview')
})

test('автокадр включает цель, а явный крупный план следует за персонажем', () => {
  const viewport = { width: 960, height: 540 }, actor = [620, 650, 660, 710], target = [80, 80, 400, 200],
    camera = createPreviewCamera(), automatic = camera.update({ ...viewport, actor, context: target })
  assert.ok(automatic.bounds[0] <= target[0] && automatic.bounds[3] >= actor[3])
  camera.setMode('closeup'); camera.reset()
  const closeup = camera.update({ ...viewport, actor, context: target })
  assert.ok(closeup.scale > automatic.scale)
  assert.deepEqual(closeup.bounds, actor)
})

test('предмет за краем слайда не заставляет камеру удаляться бесконечно', () => {
  const camera = createPreviewCamera(), frame = camera.update({ width: 960, height: 540,
    actor: [620, 650, 660, 710], props: [2000, -900, 2200, -700] })
  assert.deepEqual(frame.bounds, [620, 650, 660, 710])
  assert.ok(frame.scale > 1)
})

test('крупный план сохраняет облачко целиком, не включая удалённый источник', () => {
  const actor = [620, 650, 660, 710], detail = [560, 570, 740, 635]
  for (const [width, height] of [[960, 540], [320, 360]]) {
    const camera = createPreviewCamera({ mode: 'closeup' }),
      frame = camera.update({ width, height, actor, detail, context: [80, 80, 400, 200] })
    assert.deepEqual(frame.bounds, unionBounds(actor, detail))
    assert.ok(detail[0] * frame.scale + frame.x >= 0 && detail[2] * frame.scale + frame.x <= width)
    assert.ok(detail[1] * frame.scale + frame.y >= 0 && detail[3] * frame.scale + frame.y <= height)
  }
})


test('первый кадр расширения сразу вмещает уже видимую цель', () => {
  const camera = createPreviewCamera(), viewport = { width: 960, height: 540 }, actor = [610, 650, 670, 710]
  camera.update({ ...viewport, actor })
  const bounds = unionBounds(actor, [50, 0, 500, 500]), frame = camera.update({ ...viewport, actor, props: [50, 0, 500, 500] })
  assert.ok(bounds[0] * frame.scale + frame.x >= 0)
  assert.ok(bounds[1] * frame.scale + frame.y >= 0)
  assert.ok(bounds[2] * frame.scale + frame.x <= viewport.width)
  assert.ok(bounds[3] * frame.scale + frame.y <= viewport.height)
})

test('будущий путь и цель плавно отдаляют камеру, сохраняя текущую фигуру в кадре', () => {
  for (const targetKind of ['planned', 'context']) for (const hz of [60, 120]) {
    const camera = createPreviewCamera(), viewport = { width: 960, height: 540 },
      actor = [610, 650, 670, 710], planned = [50, 0, 670, 710], dt = 1 / hz,
      before = camera.update({ ...viewport, actor, dt }),
      target = fitFrame(unionBounds(actor, planned), viewport.width, viewport.height, { maxScale: 2.25 }),
      first = camera.update({ ...viewport, actor, [targetKind]: planned, dt }),
      expected = target.scale + (before.scale - target.scale) * (1 + 11 * dt) * Math.exp(-11 * dt)
    assert.ok(Math.abs(first.scale - expected) < 1e-10, 'Первый шаг следует той же пружине, а не мгновенному fit')
    let frame = first
    for (let n = 0; n < hz * 1.5; n++) {
      frame = camera.update({ ...viewport, actor, [targetKind]: planned, dt })
      assert.ok(actor[0] * frame.scale + frame.x >= -1e-7 && actor[2] * frame.scale + frame.x <= viewport.width + 1e-7)
      assert.ok(actor[1] * frame.scale + frame.y >= -1e-7 && actor[3] * frame.scale + frame.y <= viewport.height + 1e-7)
    }
    assert.ok(Math.abs(frame.scale - target.scale) < .0001)
    camera.reset()
    assert.equal(camera.update({ ...viewport, actor, [targetKind]: planned, reducedMotion: true }).scale, target.scale)
  }
})

test('разворот цели и resize не выносят видимую фигуру и реквизит за viewport', () => {
  const camera = createPreviewCamera()
  for (let n = 0; n < 360; n++) {
    const width = n < 120 || n >= 240 ? 960 : 320, height = n < 120 ? 540 : 360,
      x = 640 + 260 * Math.sin(n / 24), y = 560 + 90 * Math.cos(n / 30),
      actor = [x - 24, y - 40, x + 24, y + 40], props = [x + 30, y - 90, x + 75, y - 45],
      bounds = unionBounds(actor, props), frame = camera.update({ width, height, actor, props,
        planned: n % 100 < 50 ? [0, 0, 1280, 720] : null, dt: n === 120 ? 0 : 1 / 120 })
    assert.ok(bounds[0] * frame.scale + frame.x >= -1e-7)
    assert.ok(bounds[2] * frame.scale + frame.x <= width + 1e-7)
    assert.ok(bounds[1] * frame.scale + frame.y >= -1e-7)
    assert.ok(bounds[3] * frame.scale + frame.y <= height + 1e-7)
  }
})

test('после ухода большой цели автокамера приближается с плавным началом без обратного хода', () => {
  for (const hz of [60, 120]) {
    const camera = createPreviewCamera(), viewport = { width: 960, height: 540 },
      actor = [620, 650, 660, 710], large = [0, 0, 1280, 720], dt = 1 / hz,
      before = camera.update({ ...viewport, actor, planned: large, dt }),
      first = camera.update({ ...viewport, actor, dt })
    assert.ok(first.scale > before.scale)
    assert.ok(first.scale / before.scale < 1.04, 'В первом кадре нет скачка скорости zoom')
    let previous = first
    for (let i = 0; i < hz; i++) {
      const frame = camera.update({ ...viewport, actor, dt })
      assert.ok(frame.scale >= previous.scale && frame.scale <= 2.25, 'Без обратного хода и overshoot')
      previous = frame
    }
    assert.ok(Math.abs(previous.scale - 2.25) < .001)
    const same = camera.update({ ...viewport, actor, dt })
    assert.ok(Math.abs(same.scale - previous.scale) < .0001)
    camera.reset()
    assert.deepEqual(camera.update({ ...viewport, actor, reducedMotion: true, dt }).scale, 2.25)
  }
})

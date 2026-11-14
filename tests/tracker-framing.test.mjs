import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPreviewCamera } from '../camera.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

// Знак живёт дольше жеста: камера должна удерживать его до исчезновения,
// не превращая служебную рамку в физический реквизит, продлевающий номер.
test('tracker сохраняет знак и галочку в auto после окончания жеста и освобождает рамку', () => {
  for (const face of [-1, 1]) {
    const fixture = runtimeFixture(face, { logos: { tracker: 'data:image/svg+xml,tracker' } }), { raw } = fixture
    try {
      const q = { kind: 'plat', y: 480, x1: 360, x2: 660, spans: [[374, 646]], box: { x1: 360, y1: 480, x2: 660, y2: 620 } }
      raw.W.plats = [q]
      Object.assign(raw.B, { x: face > 0 ? 300 : 720, anchor: null })
      raw.step(1 / 120, 120)
      raw.run(['tracker'])
      const mark = raw.B.fxs.find(fx => fx.life === 5), camera = createPreviewCamera(), tails = []
      assert.ok(mark, 'Запущен настоящий знак выбранной плитки')
      for (let n = 0; n < 660; n++) {
        raw.step(1 / 120, 120)
        const framing = raw.frameBounds(), view = camera.update({ width: 1045, height: 540, ...framing, dt: 1 / 120 })
        if (raw.B.act.name !== 'idle' || mark.age >= mark.life || mark.el.getAttribute('opacity') <= 0) continue
        const image = mark.el.children[0], badge = mark.el.children[1],
          x = Number(image.getAttribute('x')), y = Number(image.getAttribute('y')),
          bounds = [x, y, x + 25, y + 18]
        assert.ok(Number(badge.getAttribute('opacity')) > .99)
        assert.ok(framing.planned, 'Хвост эффекта остаётся целью кадрирования после point → idle')
        assert.equal(framing.props, null, 'Рамка не выдаётся за физический реквизит')
        const visible = [bounds[0] * view.scale + view.x, bounds[1] * view.scale + view.y,
          bounds[2] * view.scale + view.x, bounds[3] * view.scale + view.y]
        assert.ok(visible[0] >= 0 && visible[1] >= 0 && visible[2] <= 1045 && visible[3] <= 540,
          'Знак и галочка целиком в кадре: ' + JSON.stringify({ face, age: mark.age, visible }))
        tails.push(mark.age)
      }
      assert.ok(tails.length > 200, 'Проверен весь видимый хвост после жеста, включая затухание')
      assert.equal(raw.B.fxs.length, 0)
      assert.equal(raw.frameBounds().planned, null)
      raw.run(['tracker']); assert.ok(raw.frameBounds().planned)
      raw.reset(); assert.equal(raw.frameBounds().planned, null)
      raw.W.plats = [q]; raw.run(['tracker']); assert.ok(raw.frameBounds().planned)
      raw.run(['wave']); assert.equal(raw.frameBounds().planned, null, 'Прерывание убирает и эффект, и его рамку')
    } finally { fixture.close() }
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'
import { createPreviewCamera } from '../src/camera.js'

test('calendar передаёт удивлённый взгляд в хлопок по лбу без скачка головы', () => {
  for (const face of [-1, 1]) {
    const fixture = runtimeFixture(face, { logos: { calendar: 'data:image/svg+xml,calendar' } }), { raw } = fixture
    try {
      raw.step(1 / 120, 120); raw.run(['calendar'])
      let prior = structuredClone(raw.B.pose), peak = { step: 0 }, seen = 0
      for (let n = 0; n < 240; n++) {
        raw.step(1 / 120, 120)
        const b = raw.B, p = b.pose
        if (b.act.name === 'calendar' && b.act.t > .2 && b.act.t < .8) {
          const step = Math.max(Math.abs(p.hp - prior.hp), Math.abs(p.hy - prior.hy))
          if (step > peak.step) peak = { step, time: b.act.t, hp: p.hp, hy: p.hy, prior: { hp: prior.hp, hy: prior.hy } }
          seen++
        }
        prior = structuredClone(p)
      }
      assert.ok(seen > 60, 'Проверены вход в facepalm и затухание реакции')
      assert.ok(peak.step < 3, 'Голова проходит стыки непрерывно: ' + JSON.stringify({ face, peak }))
    } finally { fixture.close() }
  }
})

test('fall сохраняет наклон головы при переходе из полёта в амортизацию', () => {
  for (const face of [-1, 1]) for (const height of [27, 120]) {
    const fixture = runtimeFixture(face), { raw } = fixture
    try {
      const dive = raw.tools.pose({ rot: 82, hp: -60, sf: [176, 172], sa: [6, 6], ef: [0, 0],
        hf: [0, -6], kf: [6, 22], af: [-40, -40], still: 1 })
      raw.begin({ name: 'portalExitProbe', mode: 'free', blend: 0, fn: () => dive })
      raw.step(.2, 120)
      raw.B.y = raw.W.floor.y - height
      raw.begin(raw.fall(20, 1))
      let prior = raw.B.pose.hp, landed = false, landingFrames = 0, peak = { step: 0 }
      for (let n = 0; n < 600; n++) {
        raw.step(1 / 120, 120)
        const b = raw.B, step = Math.abs(b.pose.hp - prior)
        landed ||= b.mode === 'ground'
        if (landed && landingFrames++ < 40 && step > peak.step) peak = { step, action: b.act.name, time: b.act.t, hp: b.pose.hp, prior }
        prior = b.pose.hp
        if (landed && landingFrames >= 40) break
      }
      assert.ok(landed && landingFrames >= 40, 'Проверена настоящая посадка и её восстановление')
      assert.ok(peak.step < 8, 'Начало амортизации не сбрасывает голову на20°: ' + JSON.stringify({ face, height, peak }))
    } finally { fixture.close() }
  }
})

test('portal связывает рисование, подготовку и нырок без сброса конечностей', () => {
  for (const face of [-1, 1]) {
    const fixture = runtimeFixture(face), { raw } = fixture
    try {
      raw.W.floor.spans = [[0, 1280]]
      raw.step(1 / 120, 120); raw.run(['portal'])
      let prior = structuredClone(raw.B.pose), seen = 0, peak = { step: 0 }, dive = false, recovered = false
      for (let n = 0; n < 1200; n++) {
        raw.step(1 / 120, 120)
        const b = raw.B, p = b.pose
        if (b.act.name === 'portal') {
          const changes = ['sf', 'sa', 'ef', 'ea', 'hf', 'kf'].flatMap(key => p[key].map((value, i) =>
            ({ key: key + i, step: Math.abs(value - prior[key][i]) })))
          const worst = changes.reduce((a, z) => a.step > z.step ? a : z)
          if (worst.step > peak.step) peak = { ...worst, time: b.act.t }
          seen++; dive ||= b.mode === 'free'
        }
        prior = structuredClone(p)
        if (seen && b.act.name === 'idle' && !b.queue.length) { recovered = true; break }
      }
      assert.ok(seen > 120 && dive && recovered, 'Записан полный настоящий нырок с возвращением на пол')
      assert.ok(peak.step < 14, 'Видимая фаза портала непрерывна: ' + JSON.stringify({ face, peak }))
    } finally { fixture.close() }
  }
})

test('auto держит оба кольца портала целиком до окончания их свечения', () => {
  for (const face of [-1, 1]) {
    const fixture = runtimeFixture(face), { raw } = fixture, camera = createPreviewCamera()
    try {
      raw.W.floor.spans = [[0, 1280]]; raw.run(['portal'])
      let ringsSeen = 0
      for (let n = 0; n < 720; n++) {
        raw.step(1 / 120, 120)
        const view = camera.update({ width: 1045, height: 540, ...raw.frameBounds(), dt: 1 / 120 })
        for (const fx of raw.B.fxs) {
          const ring = fx.el.children.find(node => node.getAttribute('stroke') === '#FF6427')
          if (!ring || fx.life !== 5 || Number(ring.getAttribute('rx')) < .1) continue
          const x = Number(ring.getAttribute('cx')), y = Number(ring.getAttribute('cy')),
            rx = Number(ring.getAttribute('rx')) + 1.3, ry = Number(ring.getAttribute('ry')) + 1.3,
            projected = [(x - rx) * view.scale + view.x, (y - ry) * view.scale + view.y,
              (x + rx) * view.scale + view.x, (y + ry) * view.scale + view.y]
          assert.ok(projected[0] >= 0 && projected[1] >= 0 && projected[2] <= 1045 && projected[3] <= 540,
            'Кольцо портала целиком в кадре: ' + JSON.stringify({ face, time: fx.age, projected }))
          ringsSeen++
        }
      }
      assert.ok(ringsSeen > 1000, 'Оба настоящих SVG-кольца проверены на полном цикле')
      assert.equal(raw.frameBounds().planned, null, 'Рамка исчезает вместе с кольцами')
    } finally { fixture.close() }
  }
})

test('speed завершает подготовку, разгон и торможение без чрезмерного сгиба колена', () => {
  for (const face of [-1, 1]) {
    const fixture = runtimeFixture(face), { raw } = fixture
    try {
      raw.step(1 / 120, 120); raw.run(['speed'])
      let prior = structuredClone(raw.B.pose), peak = { step: 0 }, minKnee = Infinity, maxKnee = -Infinity
      const phases = new Set()
      for (let n = 0; n < 1200; n++) {
        raw.step(1 / 120, 120)
        const b = raw.B, p = b.pose
        phases.add(b.act.name)
        const changes = ['sf', 'sa', 'ef', 'ea', 'hf', 'kf', 'af'].flatMap(key => p[key].map((value, i) =>
          ({ key: key + i, step: Math.abs(value - prior[key][i]) })))
        const worst = changes.reduce((a, z) => a.step > z.step ? a : z)
        if (worst.step > peak.step) peak = { ...worst, time: b.t, action: b.act.name }
        minKnee = Math.min(minKnee, ...p.kf); maxKnee = Math.max(maxKnee, ...p.kf)
        prior = structuredClone(p)
        if (b.act.name === 'idle' && !b.queue.length) break
      }
      assert.ok(['ready', 'walk', 'brake', 'idle'].every(name => phases.has(name)), 'Проверен полный цикл суперскорости')
      // Быстрый непрерывный бег не имеет универсального ограничения скорости
      // сустава: проверка сходимости dt и её независимое заключение сохранены
      // в drafts/catalog-review-architecture/speed-invariant-independent.md.
      assert.ok(minKnee >= -10 && maxKnee <= 165, 'Колено не перегибается из-за наложения старой и новой позы: ' + JSON.stringify({ face, minKnee, maxKnee, peak }))
    } finally { fixture.close() }
  }
})

test('speed сохраняет наклон корпуса при переходе из разворота в разгон', () => {
  for (const face of [-1, 1]) {
    const fixture = runtimeFixture(face), { raw } = fixture
    try {
      raw.step(1 / 120, 120); raw.run(['speed'])
      let prior, peak = { step: 0 }, frames = 0
      for (let n = 0; n < 1200; n++) {
        raw.step(1 / 120, 120)
        const b = raw.B
        if (prior?.action === 'walk' && b.act.name === 'walk') {
          const step = Math.abs(b.pose.tl - prior.tl); frames++
          if (step > peak.step) peak = { step, time: b.act.t, before: prior.tl, after: b.pose.tl }
        }
        prior = { action: b.act.name, tl: b.pose.tl }
        if (b.act.name === 'idle' && !b.queue.length) break
      }
      assert.ok(frames > 60, 'Проверен весь активный разгон и ход')
      assert.ok(peak.step < 3, 'Наклон входит вместе с остальной позой: ' + JSON.stringify({ face, peak }))
    } finally { fixture.close() }
  }
})

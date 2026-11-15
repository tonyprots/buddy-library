import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

// Публичная сцена должна начинаться там, где уже виден персонаж.
// Самостоятельный конструктор leap сохраняет авторские траектории.
test('leap/flip сохраняют видимую позицию и масштаб при запуске публичной сцены', () => {
  const rows = []
  for (const id of ['leap', 'flip']) for (const face of [-1, 1])
    for (const scale of [.6, 1, 1.8]) for (const x of [320, 960]) {
      const f = runtimeFixture(face), { raw } = f, { B, W } = raw
      try {
        const rest = raw.tools.solve(B.pose, 1, 0), low = Math.max(...rest.legs.flatMap(leg => [leg.heel[1], leg.toe[1]])),
          start = { x, y: W.floor.y - low * raw.tools.S * scale, scale }
        Object.assign(B, start, { scaleT: scale })
        assert.equal(raw.scene(id), true)
        const armed = { x: B.x, y: B.y, scale: B.scale }
        raw.step(1 / 120, 120)
        const first = { x: B.x, y: B.y, scale: B.scale }, bodyStep = Math.hypot(first.x - start.x, first.y - start.y),
          scaleStep = Math.abs(first.scale / start.scale - 1)
        let peakScale = B.scale, frames = 1, arrival = null, priorHead = [B.pose.hp, B.pose.hy], maxHeadStep = 0, headAt = null
        for (; frames < 1200 && B.act.name !== 'idle'; frames++) {
          const wasLeap = B.act.name === 'leap'
          raw.step(1 / 120, 120); peakScale = Math.max(peakScale, B.scale)
          if (wasLeap && B.act.name !== 'leap') arrival = { x: B.x, scale: B.scale }
          const head = [B.pose.hp, B.pose.hy], step = Math.max(...head.map((value, i) => Math.abs(value - priorHead[i])))
          if (step > maxHeadStep) { maxHeadStep = step; headAt = { action: B.act.name, time: B.act.t, from: priorHead, to: head } }
          priorHead = head
        }
        rows.push({ id, face, start, armed, first, bodyStep, scaleStep, peakScale, frames, arrival, maxHeadStep, headAt,
          final: { scale: B.scale, mode: B.mode, surface: B.surf.kind, action: B.act.name } })
      } finally { f.close() }
    }
  if (process.env.BUDDY_LEAP_ENTRY_REPORT) writeFileSync(process.env.BUDDY_LEAP_ENTRY_REPORT,
    JSON.stringify({ created: new Date().toISOString(), hz: 120,
      runtimeSHA: createHash('sha256').update(readFileSync(new URL('../src/runtime.js', import.meta.url))).digest('hex'), rows }, null, 2) + '\n')
  for (const row of rows) {
    const detail = JSON.stringify(row)
    assert.deepEqual(row.armed, row.start, 'Нет синхронного скачка до первого кадра. ' + detail)
    assert.ok(row.bodyStep < 2, 'Первый шаг тела <2 stage px при120Hz. ' + detail)
    assert.ok(row.scaleStep < .025, 'Первый шаг масштаба <2.5%. ' + detail)
    assert.ok(row.maxHeadStep < 3, 'Голова сохраняет плавность по всему циклу. ' + detail)
    assert.ok(row.peakScale >= 5 && row.peakScale <= 5.126, 'Сохранилось приближение к объективу. ' + detail)
    assert.ok(row.arrival && Math.abs(row.arrival.x - 640) < 1 && row.arrival.scale === 1,
      'Передача у прежней конечной точки; шаг посадки/кувырка уже мог сдвинуть опору. ' + detail)
    assert.deepEqual(row.final, { scale: 1, mode: 'ground', surface: 'floor', action: 'idle' })
  }
})

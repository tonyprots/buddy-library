import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

// Переход от усаживания ко сну не добавляет осанку «сонный» одним кадром.
test('nap плавно переходит к сонной осанке при разном исходном возбуждении', () => {
  const rows = []
  for (const face of [-1, 1]) for (const fps of [60, 120]) for (const arousal of [.1, .4, .9]) {
    const f = runtimeFixture(face), { raw } = f
    try {
      raw.mind().a = arousal; raw.mind().look(null)
      raw.step(.25, fps); raw.run(['nap'])
      const frames = [], row = { face, fps, arousal, maxAngleStep: 0, worst: null }
      let previous = null
      for (let n = 0; n < fps * 4; n++) {
        raw.step(1 / fps, fps)
        const current = { t: raw.B.act.t, hp: raw.B.pose.hp, tl: raw.B.pose.tl, arousal: raw.mind().a }
        if (previous && current.t > 2.2 && current.t < 3.3) {
          const step = Math.max(Math.abs(current.hp - previous.hp), Math.abs(current.tl - previous.tl))
          if (step > row.maxAngleStep) { row.maxAngleStep = step; row.worst = { previous, current } }
        }
        frames.push(current); previous = current
      }
      row.finalArousal = raw.mind().a; row.frames = frames; rows.push(row)
    } finally { f.close() }
  }
  if (process.env.BUDDY_NAP_REPORT)
    writeFileSync(process.env.BUDDY_NAP_REPORT, JSON.stringify({ rows }, null, 2) + '\n')
  for (const row of rows) {
    assert.ok(row.maxAngleStep * row.fps < 120, 'Нет однокадрового добавления сутулости: ' + JSON.stringify({ ...row, frames: undefined }))
    assert.ok(row.finalArousal < .11, 'Сон сохраняет низкий уровень возбуждения')
  }
})

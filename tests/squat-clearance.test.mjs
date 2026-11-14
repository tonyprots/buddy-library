import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'
import { segmentDistance } from './support/segment-distance.mjs'

test('предплечья в полном squats не пересекают голени/колени при обеих сторонах и направлениях взгляда', () => {
  const cases = []
  for (const face of [-1, 1]) for (const gaze of [null, { x: 100, y: 100 }, { x: 1180, y: 650 }]) {
    const f = runtimeFixture(face)
    try {
      f.raw.run(['squats'])
      if (gaze) f.raw.mind().look(gaze, 10)
      let worst = { distance: Infinity }, frames = 0
      for (let n = 0; n < 1200; n++) {
        f.raw.step(1 / 120, 120)
        if (f.raw.B.act.name !== 'squats') break
        frames++
        const k = f.raw.B.kk
        for (let arm = 0; arm < 2; arm++) for (let leg = 0; leg < 2; leg++) {
          const distance = segmentDistance(k.arms[arm].elbow, k.arms[arm].wrist, k.legs[leg].knee, k.legs[leg].ankle)
          if (distance < worst.distance) worst = { distance, time: (n + 1) / 120, arm, leg }
        }
      }
      cases.push({ face, gaze, frames, worst, final: f.raw.B.act.name })
    } finally { f.close() }
  }
  if (process.env.SQUAT_CLEARANCE_REPORT) writeFileSync(process.env.SQUAT_CLEARANCE_REPORT, JSON.stringify(cases, null, 2) + '\n')
  for (const c of cases) {
    assert.ok(c.frames > 120 && c.final === 'idle', 'Наблюдён весь цикл и восстановление')
    assert.ok(c.worst.distance >= 6, JSON.stringify(c))
  }
})

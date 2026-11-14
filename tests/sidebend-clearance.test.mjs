import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'
import { segmentDistance } from './support/segment-distance.mjs'

test('нижняя рука в полном sideBend проходит вне бедра и корпуса при обеих сторонах и взглядах', () => {
  const cases = []
  for (const face of [-1, 1]) for (const gaze of [null, { x: 100, y: 100 }, { x: 1180, y: 650 }]) {
    const f = runtimeFixture(face)
    try {
      f.raw.run(['sideBend'])
      if (gaze) f.raw.mind().look(gaze, 10)
      let thigh = Infinity, core = Infinity, handStep = 0, frames = 0, previous = null
      for (let n = 0; n < 1500; n++) {
        f.raw.step(1 / 120, 120)
        if (f.raw.B.act.name !== 'sideBend') break
        frames++
        const k = f.raw.B.kk
        for (const [i, arm] of k.arms.entries()) {
          for (const leg of k.legs) thigh = Math.min(thigh,
            segmentDistance(arm.elbow, arm.hand, leg.hip, leg.knee))
          core = Math.min(core, segmentDistance(arm.elbow, arm.hand, k.pel, k.shC))
          if (previous) handStep = Math.max(handStep, Math.hypot(...arm.hand.map((v, j) => v - previous[i][j])))
        }
        previous = k.arms.map(arm => arm.hand)
      }
      cases.push({ face, gaze, frames, thigh, core, handStep, final: f.raw.B.act.name })
    } finally { f.close() }
  }
  if (process.env.SIDEBEND_CLEARANCE_REPORT) writeFileSync(process.env.SIDEBEND_CLEARANCE_REPORT,
    JSON.stringify(cases, null, 2) + '\n')
  for (const c of cases) {
    assert.ok(c.frames > 600 && c.final === 'idle', 'Наблюдён весь цикл и восстановление')
    assert.ok(c.thigh >= 6 && c.core >= 10, JSON.stringify(c))
    assert.ok(c.handStep < 3, 'Вход, смена стороны и выход без скачка кисти: ' + JSON.stringify(c))
  }
})

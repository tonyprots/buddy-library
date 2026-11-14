import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

test('hulk связывает ветви осмотра и flex без скачка локтя, головы и кисти', () => {
  const cases = []
  for (const face of [-1, 1]) for (const gaze of [null, { x: 100, y: 100 }, { x: 1180, y: 650 }]) {
    const f = runtimeFixture(face)
    try {
      f.raw.run(['hulk'])
      if (gaze) f.raw.mind().look(gaze, 10)
      let previous = null, frames = 0
      const windows = [2.6, 3.2, 4.05, 4.6].map(at => ({ at, angle: 0, hand: 0, channel: '', time: 0 }))
      for (let n = 0; n < 950; n++) {
        f.raw.step(1 / 120, 120)
        const b = f.raw.B
        if (b.act.name !== 'hulk') break
        frames++
        const next = { pose: structuredClone(b.pose), hands: b.kk.arms.map(a => a.hand.slice()) }
        if (previous) for (const w of windows) if (Math.abs(b.act.t - w.at) < .25) {
          for (const key of ['sf', 'sa', 'ef', 'ea', 'hf', 'kf', 'hp', 'hy']) {
            const values = Array.isArray(next.pose[key]) ? next.pose[key] : [next.pose[key]],
              prior = Array.isArray(previous.pose[key]) ? previous.pose[key] : [previous.pose[key]]
            for (let j = 0; j < values.length; j++) {
              const delta = Math.abs(values[j] - prior[j])
              if (delta > w.angle) Object.assign(w, { angle: delta, channel: key + j, time: b.act.t })
            }
          }
          for (let i = 0; i < 2; i++) w.hand = Math.max(w.hand,
            Math.hypot(...next.hands[i].map((v, j) => v - previous.hands[i][j])))
        }
        previous = next
      }
      cases.push({ face, gaze, frames, windows, final: f.raw.B.act.name })
    } finally { f.close() }
  }
  if (process.env.BUDDY_HULK_REPORT) writeFileSync(process.env.BUDDY_HULK_REPORT, JSON.stringify(cases, null, 2) + '\n')
  for (const c of cases) {
    assert.ok(c.frames > 750 && c.final === 'idle', 'Наблюдён полный hulk и восстановление')
    for (const w of c.windows) {
      assert.ok(w.angle < 5, 'Угол шага1/120s должен оставаться<5°: ' + JSON.stringify({ face: c.face, gaze: c.gaze, ...w }))
      assert.ok(w.hand < 6, 'Кисть не перескакивает между ветвями: ' + JSON.stringify(w))
    }
  }
})

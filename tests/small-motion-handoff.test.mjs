import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

for (const id of ['sideBend', 'kick']) test(id + ': смена фазы не сбрасывает локальный сустав одним кадром', () => {
  for (const face of [-1, 1]) {
    const f = runtimeFixture(face), { raw } = f
    try {
      raw.run([id])
      const channel = id === 'kick' ? 'af/tl' : 'ef', readPose = p => id === 'kick' ? [...p.af, p.tl] : [...p.ef]
      let previous = readPose(raw.B.pose), peak = { step: 0 }, checked = 0
      for (let n = 0; n < 1600; n++) {
        raw.step(1 / 120, 120)
        const b = raw.B, values = readPose(b.pose), inWindow = id === 'kick' ? b.act.t > .25 && b.act.t < 1.3 : b.act.t > 1 && b.act.t < 5
        if (b.act.name === id && inWindow) {
          const step = Math.max(...values.map((value, i) => Math.abs(value - previous[i])))
          if (step > peak.step) peak = { step, time: b.act.t, values: [...values], previous }
          checked++
        }
        previous = [...values]
        if (b.act.name === 'idle' && !b.queue.length) break
      }
      assert.ok(checked > 50)
      assert.ok(peak.step < 3, 'Локальная поза передаётся непрерывно: ' + JSON.stringify({ id, face, channel, peak }))
    } finally { f.close() }
  }
})

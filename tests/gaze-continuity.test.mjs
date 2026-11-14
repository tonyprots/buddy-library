import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

test('вес внимания меняется плавно между неподвижной позой, способностью и полётом', () => {
  const reports = []
  for (const kind of ['still', 'power', 'air']) {
    const f = runtimeFixture(), { raw } = f, frames = []
    try {
      raw.mind().look({ x: 640, y: -1000, z: 1000 }, 60)
      raw.step(2)
      raw.begin(raw.tools.gest('attentionProbe', 3, .4, (time, action) => {
        const quiet = time >= .5 && time < 1.5
        action.power = kind === 'power' && quiet
        raw.B.mode = kind === 'air' && quiet ? 'free' : 'ground'
        return raw.tools.pose({ still: kind === 'still' && quiet ? 1 : 0 })
      }))
      let previous = { hp: raw.B.pose.hp, hy: raw.B.pose.hy }, maxStep = 0
      for (let i = 0; i < 324; i++) {
        raw.step(1 / 120, 120)
        const { hp, hy } = raw.B.pose, step = Math.max(Math.abs(hp - previous.hp), Math.abs(hy - previous.hy))
        maxStep = Math.max(maxStep, step)
        frames.push({ time: (i + 1) / 120, hp, hy, step, mode: raw.B.mode, still: raw.B.pose.still || 0,
          power: !!raw.B.act.power, attention: [raw.mind().hp.x, raw.mind().hy.x] })
        previous = { hp, hy }
      }
      reports.push({ kind, maxStep, frames })
    } finally { f.close() }
  }
  if (process.env.BUDDY_GAZE_REPORT) writeFileSync(process.env.BUDDY_GAZE_REPORT, JSON.stringify(reports, null, 2) + '\n')
  for (const row of reports) assert.ok(row.maxStep < 3, `${row.kind}: голова не перескакивает при смене веса внимания (${row.maxStep}°/120Hz)`)
})

test('сидячие жесты сохраняют движение головы при входе в отдых и подъёме', () => {
  const reports = []
  for (const id of ['sitRest', 'sitLean']) for (const face of [-1, 1]) for (const gaze of [null, { x: 640, y: 100, z: 2000 }]) {
    const f = runtimeFixture(face), { raw } = f, frames = []
    try {
      raw.seed(14); raw.mind().look(gaze, 30)
      raw.run([id])
      let previous = raw.B.pose, maxStep = 0
      for (let i = 0; i < 2400; i++) {
        raw.step(1 / 120, 120)
        const p = raw.B.pose, step = Math.max(Math.abs(p.hp - previous.hp), Math.abs(p.hy - previous.hy))
        frames.push({ time: (i + 1) / 120, action: raw.B.act.name, hp: p.hp, hy: p.hy, step })
        maxStep = Math.max(maxStep, step); previous = p
        if (raw.B.act.name === 'idle') break
      }
      reports.push({ id, face, gaze, maxStep, frames })
    } finally { f.close() }
  }
  if (process.env.BUDDY_SEATED_REPORT) writeFileSync(process.env.BUDDY_SEATED_REPORT, JSON.stringify(reports, null, 2) + '\n')
  for (const row of reports) assert.ok(row.maxStep < 4, `${row.id}/${row.face}: ${row.maxStep}°/120Hz`)
})

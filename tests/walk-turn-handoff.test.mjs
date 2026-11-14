import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

test('разворот переходит в шаг без рывка колена, потери опоры и движения после остановки', () => {
  const started = Date.now(), cases = [], sourceSHA = createHash('sha256')
    .update(readFileSync(new URL('../runtime.js', import.meta.url))).digest('hex')
  for (const id of ['stroll', 'stumble']) for (const face of [-1, 1]) {
    const f = runtimeFixture(face), { raw } = f, samples = []
    try {
      assert.ok(raw.run([id]))
      let previous = raw.B.pose.kf, maxEntryKneeStep = 0, maxFootFloorError = 0
      for (let i = 0; i < 1800; i++) {
        raw.step(1 / 120, 120)
        const b = raw.B, time = (i + 1) / 120, k = b.kk, sc = raw.tools.S * b.scale,
          foot = Math.max(...k.legs.flatMap(leg => [leg.heel[1], leg.toe[1]])) * sc + b.y,
          kneeStep = Math.max(...b.pose.kf.map((value, side) => Math.abs(value - previous[side])))
        if (time <= .65) maxEntryKneeStep = Math.max(maxEntryKneeStep, kneeStep)
        maxFootFloorError = Math.max(maxFootFloorError, Math.abs(foot - b.surfY))
        samples.push({ time, action: b.act.name, actionTime: b.act.t, x: b.x, y: b.y, yaw: b.yaw,
          velocity: b.vx, drive: b.drive, mode: b.mode, kf: b.pose.kf, kneeStep, footFloor: foot - b.surfY })
        previous = b.pose.kf
        if (b.act.name === 'idle') break
      }
      const completed = raw.B.act.name === 'idle', endX = raw.B.x
      raw.step(.5, 120)
      cases.push({ id, face, maxEntryKneeStep, maxFootFloorError, completed, endVelocity: raw.B.vx, endDrive: raw.B.drive,
        endMovement: Math.abs(raw.B.x - endX), queue: raw.B.queue.length, samples })
    } finally { f.close() }
  }
  const report = { startedUTC: new Date(started).toISOString(), finishedUTC: new Date().toISOString(),
    durationMs: Date.now() - started, sourceSHA,
    method: 'Настоящий runtime, именованные stroll/stumble, seed14, обе стороны, 120Hz; DOM/SVG fixture без браузера.',
    thresholds: { maxEntryKneeStepDegrees: 4, maxFootFloorErrorStagePx: 1e-6 }, cases }
  if (process.env.BUDDY_WALK_TURN_REPORT) writeFileSync(process.env.BUDDY_WALK_TURN_REPORT,
    JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  for (const row of cases) {
    assert.ok(row.maxEntryKneeStep < 4, `${row.id}/${row.face}: колено ${row.maxEntryKneeStep}°/120Hz при выходе из разворота`)
    assert.ok(row.maxFootFloorError < 1e-6, `${row.id}/${row.face}: опора ${row.maxFootFloorError} stagepx`)
    assert.ok(row.completed && row.queue === 0 && row.endVelocity === 0 && row.endDrive === false,
      `${row.id}/${row.face}: номер завершён и движение остановлено`)
  }
})

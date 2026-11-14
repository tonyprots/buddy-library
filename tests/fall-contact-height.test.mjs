import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { runtimeFixture } from './support/runtime-fixture.mjs'

const rows = []
after(() => {
  if (process.env.BUDDY_FALL_CONTACT_REPORT)
    writeFileSync(process.env.BUDDY_FALL_CONTACT_REPORT, JSON.stringify(rows, null, 2) + '\n', { flag: 'wx' })
})

for (const fps of [120, 240, 480]) test(`intro fall: поза касается настоящей карточки без коррекции высоты на ${fps}Hz`, () => {
  const fixture = runtimeFixture(-1), { raw } = fixture, b = raw.B,
    // DOMRect из исходной деки с загруженным Formular,1280×720,DPR2:
    // drafts/transition-quality/independent-intro-5409/native-dom-land.json.
    land = { kind: 'plat', x1: 64, x2: 578.671875, y: 211.6875, rad: 0,
      spans: [[94, 548.671875]], box: { x1: 64, x2: 578.671875, y1: 211.6875, y2: 597.625 } }
  try {
    raw.progress(0); raw.W.plats = [land]; raw.W.walls = []
    Object.assign(b, { x: 383.0965625, y: -70, face: -1, scale: 1, scaleT: 1, queue: [], alpha: 1, alphaT: 1 })
    const action = raw.fall(60, 1.5, 1), original = action.fn
    let collision = null
    action.fn = (a, dt) => {
      const wasFree = b.mode === 'free', p = original(a, dt)
      if (wasFree && b.mode === 'ground') {
        const k = raw.tools.solve(p, Math.cos(b.yaw) >= 0 ? 1 : -1, Math.sin(b.yaw)),
          footLow = Math.max(...k.legs.flatMap(g => [g.heel[1], g.toe[1]]))
        collision = { actionTime: a.t, rootY: b.y, pose: structuredClone(p),
          actualFootY: b.y + footLow * raw.tools.S * b.scale }
      }
      return p
    }
    raw.begin(action); raw.plan([() => raw.MAKE.wave()])
    for (let n = 0; n < fps * 2 && !collision; n++) raw.step(1 / fps, fps)
    assert.ok(collision, 'Проверена реальная граница free→ground')
    assert.equal(b.surf, land); assert.equal(raw.state().level, 0)
    assert.equal(b.act.name, 'fall'); assert.equal(b.queue.length, 1, 'Wave ещё ждёт окончания амортизации')
    const row = { fps, collision, surfaceY: land.y, afterFrameRootY: b.y,
      footErrorPx: collision.actualFootY - land.y, rootCorrectionPx: b.y - collision.rootY }
    rows.push(row)
    // Порог0,03px допускает малые life/MIND поправки отображаемой позы,
    // но различает измеренную постоянную ошибку~0,24px от изменения за dt.
    assert.ok(Math.abs(row.footErrorPx) < .03 && Math.abs(row.rootCorrectionPx) < .03,
      'Падение ставит фактическую стопу на опору; groundSolve не чинит другую высоту: ' + JSON.stringify(row))
  } finally { fixture.close() }
})

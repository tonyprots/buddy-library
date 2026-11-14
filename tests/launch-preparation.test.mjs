import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { runtimeFixture } from './support/runtime-fixture.mjs'

function fixture(id, face, board) {
  const f = runtimeFixture(face, { logos: board ? { telemost: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' } : {} })
  if (id !== 'fly') {
    const card = new f.host.constructor('div'), style = getComputedStyle
    card.closest = () => null; card.hasAttribute = name => card.getAttribute(name) !== null
    card.getBoundingClientRect = () => ({ left: 360, top: 420, right: 660, bottom: 620, width: 300, height: 200 })
    f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
    globalThis.getComputedStyle = node => node === card
      ? { backgroundColor: 'rgb(210,220,240)', borderTopWidth: '0', borderTopLeftRadius: '18' } : style(node)
    f.raw.rescan(); f.raw.W.walls = f.raw.W.walls.filter(w => w.side === -face)
  }
  Object.assign(f.raw.B, { x: id === 'fly' ? face > 0 ? 190 : 1066 : face > 0 ? 340 : 680, anchor: null })
  return f
}

// Инвариант: видимая подготовка сохраняет промежуточные позы рук и ног,
// а переход к полёту не подменяет CROUCH на PUSH в одном кадре.
test('fly/climb/web: видимая подготовка без телепорта рук и ног, ±120Hz', () => {
  const rows = []
  for (const [id, board] of [['fly', false], ['fly', true], ['climb', false], ['web', false]]) for (const face of [-1, 1]) {
    const f = fixture(id, face, board), { raw } = f, { B } = raw, poses = createHash('sha256'),
      row = { id, board, face, maxArmStep: 0, maxAllAngleStep: 0, maxHandStep: 0, maxFootStep: 0, maxBodyStep: 0,
        maxGroundFloorGap: 0, minAlpha: 1, windowFrames: 0, bodyPath: [] }
    try {
      assert.equal(raw.availability(id), null)
      raw.run([id])
      let active = false, prior
      for (let n = 0; n < 3600; n++) {
        raw.step(1 / 120, 120)
        if (B.act.name === (id === 'fly' ? 'fly' : 'climb')) active = true
        else if (active) { row.endedAt = prior.t + 1 / 120; row.finalMode = B.mode; break }
        if (!active) continue
        const t = B.act.t, p = B.pose, sc = raw.tools.S * B.scale,
          project = v => [B.x + (v[0] * Math.cos(B.yaw) - v[2] * Math.sin(B.yaw)) * sc, B.y + v[1] * sc],
          hands = B.kk.arms.map(a => project(a.hand)), feet = B.kk.legs.flatMap(g => [project(g.heel), project(g.toe)]),
          frame = { t, x: B.x, y: B.y, yaw: B.yaw, mode: B.mode, pose: structuredClone(p), hands, feet },
          inWindow = id === 'fly' ? t <= .8 : t >= .5 && t <= 1.05
        row.bodyPath.push([t, B.x, B.y, B.yaw, B.mode, B.scale, B.face])
        poses.update(JSON.stringify([t, p]))
        if (row.airborneAt == null && B.mode === 'free') { row.airborneAt = t; row.flightFace = B.face }
        if (inWindow) {
          row.windowFrames++; row.minAlpha = Math.min(row.minAlpha, B.alpha)
          if (B.mode === 'ground') row.maxGroundFloorGap = Math.max(row.maxGroundFloorGap, Math.abs(Math.max(...feet.map(v => v[1])) - B.surfY))
          if (prior) {
            const arm = Math.max(...['sf', 'sa', 'ef', 'ea'].flatMap(key => p[key].map((v, i) => Math.abs(v - prior.pose[key][i])))),
              all = Math.max(arm, ...['rot', 'tl', 'hp', 'hy'].map(key => Math.abs(p[key] - prior.pose[key])),
                ...['hf', 'ha', 'kf', 'ka', 'af'].flatMap(key => p[key].map((v, i) => Math.abs(v - prior.pose[key][i])))),
              step = (now, before) => Math.max(...now.map((v, i) => Math.hypot(v[0] - before[i][0], v[1] - before[i][1])))
            if (arm > row.maxArmStep) { row.maxArmStep = arm; row.armPeak = { before: prior, after: frame } }
            row.maxAllAngleStep = Math.max(row.maxAllAngleStep, all)
            row.maxHandStep = Math.max(row.maxHandStep, step(hands, prior.hands))
            row.maxFootStep = Math.max(row.maxFootStep, step(feet, prior.feet))
            row.maxBodyStep = Math.max(row.maxBodyStep, Math.hypot(B.x - prior.x, B.y - prior.y))
          }
        }
        prior = frame
      }
      assert.ok(row.endedAt && row.windowFrames > 30)
      row.poseSHA256 = poses.digest('hex')
      rows.push(row)
    } finally { f.close() }
  }
  if (process.env.BUDDY_LAUNCH_PREP_REPORT) writeFileSync(process.env.BUDDY_LAUNCH_PREP_REPORT, JSON.stringify({ rows }, null, 2) + '\n')
  for (const row of rows) {
    const detail = JSON.stringify({ ...row, bodyPath: undefined, armPeak: undefined })
    assert.equal(row.flightFace, row.face, 'Реальный полёт направлен в требуемую сторону. ' + detail)
    assert.ok(row.minAlpha > .999, 'Подготовка остаётся видимой. ' + detail)
    assert.ok(row.maxArmStep < 12 && row.maxAllAngleStep < 14, 'Нет мгновенной смены позы. ' + detail)
    assert.ok(row.maxHandStep < 4 && row.maxFootStep < 4, 'Конечности не телепортируют. ' + detail)
    assert.ok(row.maxGroundFloorGap < 1e-7, 'Подготовка сохраняет нижнюю подошву на полу. ' + detail)
  }
})

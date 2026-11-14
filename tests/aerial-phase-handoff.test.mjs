import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { runtimeFixture } from './support/runtime-fixture.mjs'

// Инвариант: смена воздушной фазы не переносит кисти относительно таза
// и не поворачивает всё тело в новую ориентацию за один120Hzкадр.
for (const id of ['web', 'finale']) test(id + ': воздушные фазы сохраняют непрерывность тела и рук', () => {
  const rows = []
  for (const face of [-1, 1]) {
    const f = runtimeFixture(face), card = new f.host.constructor('div'), style = getComputedStyle,
      { raw } = f, { B } = raw
    card.closest = () => null
    card.hasAttribute = name => card.getAttribute(name) !== null
    card.getBoundingClientRect = () => ({ left: 360, top: 420, right: 660, bottom: 620, width: 300, height: 200 })
    f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
    if (id === 'finale') {
      card.setAttribute('data-buddy-like', '')
      f.slide.querySelector = selector => selector === '[data-buddy-fly]' ? card : null
    }
    globalThis.getComputedStyle = node => node === card
      ? { backgroundColor: 'rgb(210,220,240)', borderTopWidth: '0', borderTopLeftRadius: '18' } : style(node)
    raw.rescan()
    if (id === 'web') raw.W.walls = raw.W.walls.filter(wall => wall.side === -face)
    Object.assign(B, { x: face > 0 ? 340 : 680, anchor: null })
    const row = { face, id, frames: 0, maxRotationStep: 0, maxRelativeHandStep: 0, path: [] }
    let prior, active = false
    try {
      raw.run([id])
      for (let n = 0; n < 4800; n++) {
        raw.step(1 / 120, 120)
        if (B.act.name !== (id === 'web' ? 'climb' : 'finale')) { if (active) break; continue }
        active = true; row.frames++
        const current = { t: B.act.t, rotation: B.pose.rot,
          hands: B.kk.arms.map(arm => [(arm.hand[0] * Math.cos(B.yaw) - arm.hand[2] * Math.sin(B.yaw)) * raw.tools.S,
            arm.hand[1] * raw.tools.S]) }
        row.path.push([current.t, B.x, B.y, B.face, B.mode])
        if (prior && (id === 'finale' || current.t >= 1.8 && current.t <= 2.4)) {
          const rotation = Math.abs(current.rotation - prior.rotation),
            hands = Math.max(...current.hands.map((hand, i) => Math.hypot(...hand.map((v, j) => v - prior.hands[i][j]))))
          if (rotation > row.maxRotationStep) { row.maxRotationStep = rotation; row.rotationAt = current.t }
          if (hands > row.maxRelativeHandStep) { row.maxRelativeHandStep = hands; row.handAt = current.t }
        }
        prior = current
      }
      assert.ok(active && row.frames > 240 && B.act.name !== (id === 'web' ? 'climb' : 'finale'), 'Наблюдён весь номер')
      rows.push(row)
    } finally { f.close() }
  }
  if (process.env.BUDDY_AERIAL_HANDOFF_REPORT) writeFileSync(process.env.BUDDY_AERIAL_HANDOFF_REPORT.replace('.json', '-' + id + '.json'), JSON.stringify({ rows }, null, 2) + '\n')
  for (const row of rows) {
    const message = JSON.stringify({ ...row, path: undefined })
    assert.ok(row.maxRotationStep < 12, 'Поворот тела без скачка. ' + message)
    assert.ok(row.maxRelativeHandStep < 6, 'Кисти относительно таза без скачка. ' + message)
  }
})

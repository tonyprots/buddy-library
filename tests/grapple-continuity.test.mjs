import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

// Один настоящий разобранный блок; измеряются все стыки выстрела, подтяга и выхода.
test('grapple непрерывно поднимается с обеих сторон блока и сохраняет опору при выходе', () => {
  const rows = []
  for (const face of [-1, 1]) for (const top of [420, 470]) {
    const f = runtimeFixture(face), card = new f.host.constructor('div'), style = getComputedStyle,
      { raw } = f, frames = []
    try {
      card.closest = () => null; card.hasAttribute = name => card.getAttribute(name) !== null
      card.getBoundingClientRect = () => ({ left: 360, top, right: 660, bottom: top + 180, width: 300, height: 180 })
      f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
      globalThis.getComputedStyle = node => node === card
        ? { backgroundColor: 'rgb(210,220,240)', borderTopWidth: '0', borderTopLeftRadius: '18' } : style(node)
      raw.rescan(); Object.assign(raw.B, { x: face > 0 ? 300 : 720, anchor: null })
      raw.step(1 / 120, 120)
      assert.equal(raw.availability('grapple'), null); raw.run(['grapple'])
      let previous = null, started = false
      for (let n = 0; n < 1440; n++) {
        raw.step(1 / 120, 120)
        const b = raw.B, k = b.kk, scale = raw.tools.S * b.scale,
          project = p => [b.x + (p[0] * Math.cos(b.yaw) - p[2] * Math.sin(b.yaw)) * scale, b.y + p[1] * scale],
          row = { t: b.act.t, action: b.act.name, mode: b.mode, x: b.x, y: b.y, face: b.face, surface: b.surf.kind,
            surfaceY: b.surfY, angles: ['sf', 'sa', 'ef', 'ea', 'hf', 'kf'].flatMap(key => b.pose[key]),
            hands: k.arms.map(arm => project(arm.hand)), feet: k.legs.flatMap(leg => [project(leg.heel), project(leg.toe)]) }
        started ||= b.act.name === 'grapple'
        if (previous) {
          const distance = (a, z) => Math.max(...a.map((p, i) => Math.hypot(p[0] - z[i][0], p[1] - z[i][1])))
          row.angleStep = Math.max(...row.angles.map((a, i) => Math.abs(a - previous.angles[i])))
          row.bodyStep = Math.hypot(row.x - previous.x, row.y - previous.y)
          row.handStep = distance(row.hands, previous.hands); row.footStep = distance(row.feet, previous.feet)
        }
        frames.push(row); previous = row
        if (started && b.act.name === 'idle') break
      }
      assert.ok(started); assert.equal(frames.at(-1).action, 'idle'); assert.equal(frames.at(-1).surface, 'plat')
      assert.ok(frames.filter(frame => frame.action === 'grapple' && frame.t < .5).every(frame => frame.face === face))
      const peaks = Object.fromEntries(['angleStep', 'bodyStep', 'handStep', 'footStep'].map(key =>
        [key, frames.filter(frame => frame[key] != null).reduce((a, z) => a[key] > z[key] ? a : z)]))
      rows.push({ face, top, peaks, frames })
    } finally { f.close() }
  }
  if (process.env.BUDDY_GRAPPLE_REPORT) writeFileSync(process.env.BUDDY_GRAPPLE_REPORT, JSON.stringify({ rows }, null, 2) + '\n')
  for (const row of rows) {
    const detail = JSON.stringify({ face: row.face, top: row.top, peaks: row.peaks })
    assert.ok(row.peaks.angleStep.angleStep < 12, 'Без смены позы ног одним кадром. ' + detail)
    assert.ok(row.peaks.bodyStep.bodyStep < 4, 'Без скачка таза на стыке подъёма. ' + detail)
    assert.ok(row.peaks.handStep.handStep < 6 && row.peaks.footStep.footStep < 6, 'Конечности проходят стыки непрерывно. ' + detail)
  }
})

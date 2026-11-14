import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRuntime } from '../runtime.js'
import { createAbilityPlayer } from '../new-abilities.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

test('звезда падает сверху, весь путь в резерве и native DPR2 помещается при CSS3.75 без роста caps', () => {
  const source = createRuntime.toString(), start = source.indexOf('  function canvasRatio('), end = source.indexOf('  function resizeCanvas(', start),
    constants = source.match(/const canvasPixelLimit = ([^,]+), supersamplingPixelBudget = ([^;]+);/),
    rows = []
  assert.ok(start >= 0 && end > start && constants)
  assert.equal(Number(constants[1]), 8.4e6, 'Лимит не увеличен ради исправления пути')
  for (const face of [-1, 1]) {
    const f = runtimeFixture(face), { raw } = f, props = new Map()
    raw.tools.prop3 = (name, update) => { const state = { ping: true }; props.set(name, { state, update }); return state }
    const player = createAbilityPlayer(raw, { host: f.host })
    try {
      const action = player.create('starcatch'), planned = [...action.canvasBounds], initialX = raw.B.x,
        w = Math.ceil((planned[2] - planned[0]) / 16) * 16, h = Math.ceil((planned[3] - planned[1]) / 16) * 16,
        g3 = { ss: 2, pr: 0, maxDimension: 16384, framedFxUntil: 0 },
        validBounds = bounds => Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite)
          && bounds[2] >= bounds[0] && bounds[3] >= bounds[1],
        ratio = new Function('G3', 'B', 'W', 'validBounds', 'canvasPixelLimit', 'supersamplingPixelBudget', 'canvasInUse',
          'return (' + source.slice(start, end) + ')')(
          g3, raw.B, raw.W, validBounds, Number(constants[1]), Number(constants[2]), () => true)(w, h, 7.5),
        flight = [], row = { face, planned, rounded: [w, h], ratio, pixels: Math.floor(w * ratio) * Math.floor(h * ratio), frames: 0 }
      raw.begin(action)
      for (let frame = 0; frame < 1000; frame++) {
        raw.step(1 / 120, 120); row.frames++
        for (const [name, record] of props) {
          if (record.state.done || raw.B.act.name !== 'starcatch') continue
          const p = record.update(record.state, raw.B.kk), t = raw.B.act.t
          if (!p || name !== 'abilityStar') continue
          const b = p.box
          assert.ok(b[0] >= planned[0] - .01 && b[1] >= planned[1] - .01 && b[2] <= planned[2] + .01 && b[3] <= planned[3] + .01, 'Полная траектория предмета внутри исходного резерва')
          assert.equal(p.k, 1.5, 'Размер звезды сохранён')
          if (p.atW && t < 1.7) flight.push({ t, x: p.atW[0], y: p.atW[1] })
        }
        assert.deepEqual(action.canvasBounds, planned, 'В полёте резерв не растёт')
        if (raw.B.act.name === 'idle') break
      }
      assert.ok(flight.length > 100)
      const first = flight[0], last = flight.at(-1), du = (last.t - first.t) / 1.65,
        distance = (first.x - last.x) / du * face,
        u1 = (first.t - .25) / 1.65, u2 = (last.t - .25) / 1.65,
        initialY = (first.y * u2 * u2 - last.y * u1 * u1) / (u2 * u2 - u1 * u1)
      assert.ok(Math.abs(distance - 75) < 1e-7, 'Длина входа согласована с резервом')
      assert.ok(Math.abs(initialY + 18) < 1e-7, 'Начало остаётся выше верхнего края, Y−18')
      assert.ok(Math.abs(first.x - initialX) > 60 && first.y < 0)
      assert.equal(w, 176); assert.equal(h, 784); assert.equal(ratio, 7.5)
      assert.ok(row.pixels <= 8.4e6); assert.equal(g3.densityLimit, 'none')
      assert.ok(row.frames >= 815 && row.frames <= 820); assert.equal(raw.B.act.name, 'idle')
      rows.push({ ...row, distance, initialY })
    } finally { player.destroy(); f.close() }
  }
  if (process.env.BUDDY_STAR_FOV_REPORT) writeFileSync(process.env.BUDDY_STAR_FOV_REPORT, JSON.stringify({ rows,
    method: 'Полный120Hz SVG numeric path; actual canvasRatio из runtime в изоляции. Не браузер/native density measurement.' }, null, 2) + '\n')
})

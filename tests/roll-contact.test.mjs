import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

// Инвариант: объём головы, шеи и плеч в кувырке остаётся над настоящим полом,
// включая squash вокруг стоп. Нулевой контакт стоп этого не гарантирует.
function rollContact(face, fps, scale = 1) {
  const fixture = runtimeFixture(face), { raw } = fixture, { B, W } = raw, S = raw.tools.S,
    source = { kind: 'plat', y: W.floor.y - 330, x1: 400, x2: 800, spans: [[410, 790]] },
    rest = raw.tools.solve(raw.tools.pose(), 1, 0),
    feetLow = k => Math.max(...k.legs.flatMap(leg => [leg.heel[1], leg.toe[1]])),
    frames = []
  try {
    W.floor.spans = [[0, 1280]]; W.plats = [source]
    Object.assign(B, { x: 640, y: source.y - feetLow(rest) * S * scale, surf: source,
      surfY: source.y, mode: 'ground', anchor: null, face, cam: .4,
      scale, scaleT: scale, yaw: face > 0 ? .4 * Math.PI / 2 : Math.PI - .4 * Math.PI / 2, yawV: 0 })
    raw.begin(raw.jumpTo(640 + face * 100, W.floor, { apex: 8, roll: true }))
    let sawRoll = false
    for (let i = 0; i < fps * 8; i++) {
      raw.step(1 / fps, fps)
      if (B.act.name === 'roll') {
        sawRoll = true
        const k = B.kk, sc = S * B.scale, fy = feetLow(k), sy = 1 + B.sq * .45,
          worldY = localY => B.y + (fy + (localY - fy) * sy) * sc,
          parts = { head: worldY(k.head[1] + 7.2), neck: worldY(k.neckTop[1] + 2.6),
            shoulder0: worldY(k.arms[0].sh[1] + 4.2), shoulder1: worldY(k.arms[1].sh[1] + 4.2) },
          penetration = Object.fromEntries(Object.entries(parts).map(([key, y]) => [key, y - B.surfY]))
        frames.push({ time: (i + 1) / fps, rot: B.pose.rot, cset: B.cset, contact: B.footId,
          floor: B.surfY, y: B.y, squash: sy, parts, penetration })
      }
      if (sawRoll && B.act.name === 'idle') break
    }
    assert.ok(frames.length > 10 && frames.some(f => f.rot > 150 && f.rot < 210), 'Пройден перевёрнутый участок настоящего roll')
    const worst = frames.flatMap(f => Object.entries(f.penetration).map(([part, value]) => ({ part, value, time: f.time, rot: f.rot })))
      .reduce((a, b) => a.value > b.value ? a : b)
    return { face, fps, scale, worst, frames }
  } finally { fixture.close() }
}

test('кувырок после падения сохраняет объём головы, шеи и плеч над полом в обе стороны', () => {
  const cases = []
  for (const fps of [24, 60]) for (const face of [-1, 1]) for (const scale of [.5, 1, 2]) cases.push(rollContact(face, fps, scale))
  if (process.env.ROLL_CONTACT_REPORT) {
    mkdirSync(dirname(process.env.ROLL_CONTACT_REPORT), { recursive: true })
    writeFileSync(process.env.ROLL_CONTACT_REPORT, JSON.stringify({ date: new Date().toISOString(),
      runtimeSHA: createHash('sha256').update(readFileSync(new URL('../src/runtime.js', import.meta.url))).digest('hex'),
      invariant: 'Нижняя граница объёмов головы radius7.2, шеи radius2.6 и плеч radius4.2 после render-squash не ниже пола более чем на 0.15 px сцены.', cases }, null, 2) + '\n')
  }
  for (const c of cases) assert.ok(c.worst.value <= .15,
    `face=${c.face}, fps=${c.fps}, scale=${c.scale}: ${JSON.stringify(c.worst)}`)
})

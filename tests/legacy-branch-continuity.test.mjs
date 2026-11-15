import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

const dt = 1 / 120, cardTop = 420, angleKeys = ['sf', 'sa', 'ef', 'ea', 'hf', 'kf'], cases = []

// Одна настоящая карточка: анализатор сам создаёт её стены и поверхность.
function fixture(id, face) {
  const f = runtimeFixture(face), card = new f.host.constructor('div'), style = getComputedStyle,
    priorWindow = globalThis.window
  card.closest = () => null
  card.hasAttribute = name => card.getAttribute(name) !== null
  card.getBoundingClientRect = () => ({ left: 360, top: cardTop, right: 660, bottom: 620, width: 300, height: 200 })
  f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
  if (id === 'finale') f.slide.querySelector = selector => selector === '[data-buddy-fly]' ? card : null
  globalThis.getComputedStyle = node => node === card
    ? { backgroundColor: 'rgb(210,220,240)', borderTopWidth: '0', borderTopLeftRadius: '18' } : style(node)
  globalThis.window = { BUDDY_LOGOS: {} }
  f.raw.rescan()
  // У обычного climb выбор кромки случайный: оставляем одну из настоящих
  // найденных стен, чтобы две fixture проверяли разные физические стороны.
  if (id !== 'finale') f.raw.W.walls = f.raw.W.walls.filter(wall => wall.side === -face)
  Object.assign(f.raw.B, { x: face > 0 ? 340 : 680, anchor: null })
  return { ...f, close() { f.close(); priorWindow === undefined ? delete globalThis.window : globalThis.window = priorWindow } }
}

function trajectory(id, face) {
  const f = fixture(id, face), { B, W } = f.raw, frames = [], startY = B.y
  try {
    assert.equal(f.raw.availability(id), null, 'Номер доступен на настоящей проанализированной сцене')
    f.raw.run([id])
    let previous = null, started = false, ended = false
    for (let n = 0; n < 3600; n++) {
      f.raw.step(dt, 120)
      const active = id === 'web' ? B.act.name === 'climb' : B.act.name === id
      if (active) started = true
      if (started && !active) { ended = true; break }
      if (!active) continue
      const project = p => [B.x + (p[0] * Math.cos(B.yaw) - p[2] * Math.sin(B.yaw)) * f.raw.tools.S * B.scale,
        B.y + p[1] * f.raw.tools.S * B.scale],
        frame = { time: B.act.t, x: B.x, y: B.y, face: B.face, mode: B.mode, surface: B.surf.kind, surfaceY: B.surfY,
          pose: structuredClone(B.pose), hands: B.kk.arms.map(arm => project(arm.hand)),
          feet: B.kk.legs.flatMap(leg => [project(leg.heel), project(leg.toe)]) }
      if (previous) {
        const checkedAngles = id === 'climb' ? ['hf', 'ha', 'kf', 'ka', 'af'] : angleKeys,
          angles = checkedAngles.flatMap(key => frame.pose[key].map((value, index) =>
          ({ channel: key + index, delta: Math.abs(value - previous.pose[key][index]) }))),
          step = (points, prior) => Math.max(...points.map((p, i) => Math.hypot(p[0] - prior[i][0], p[1] - prior[i][1])))
        frame.angle = angles.reduce((a, b) => a.delta > b.delta ? a : b)
        frame.handStep = step(frame.hands, previous.hands)
        frame.footStep = step(frame.feet, previous.feet)
        frame.bodyStep = Math.hypot(frame.x - previous.x, frame.y - previous.y)
      }
      assert.ok([frame.x, frame.y, ...frame.hands.flat(), ...frame.feet.flat()].every(Number.isFinite))
      frames.push(frame); previous = frame
    }
    assert.ok(started && ended, id + ': наблюдён завершившийся номер в ограниченном цикле')
    if (id !== 'finale') assert.equal(frames.at(120).face, face, 'Подъём действительно сыгран с нужной стороны карточки')
    const selected = frames.filter(frame => frame.angle && (id === 'finale' ? frame.time >= .2 && frame.time <= .5
      : id === 'web' ? frame.time >= .825 - 1e-9 && frame.time <= 1.05
        : frame.time >= 9.3 && frame.time <= 9.65 && frame.y >= cardTop - 10 && frame.y <= cardTop + 35))
    assert.ok(selected.length > 8, 'Физическое окно нужной ветви действительно наблюдалось')
    const peak = key => selected.reduce((a, b) => a[key] > b[key] ? a : b),
      preparation = id === 'finale' ? frames.filter(frame => frame.time < .3 && frame.mode === 'ground') : [],
      landmarks = (id === 'finale' ? [.15, .2916666667, .3, .5] : id === 'web' ? [.825, .8333333333, 1] : [9.35, 9.3583333333, 9.6])
        .map(at => frames.reduce((a, b) => Math.abs(a.time - at) < Math.abs(b.time - at) ? a : b)),
      result = { id, face, frames: frames.length, startY, final: { action: B.act.name, mode: B.mode, surface: B.surf.kind },
        actionEndedAfter: frames.at(-1).time + dt, airborneAt: frames.find(frame => frame.mode === 'free')?.time,
        bodyPathSha: createHash('sha256').update(JSON.stringify(frames.map(frame => [frame.time, frame.x, frame.y]))).digest('hex'),
        landmarks: landmarks.map(frame => ({ time: frame.time, x: frame.x, y: frame.y, mode: frame.mode })),
        preparation: preparation.length ? { frames: preparation.length,
          maxAngle: Math.max(...preparation.filter(frame => frame.angle).map(frame => frame.angle.delta)),
          maxBodyStep: Math.max(...preparation.filter(frame => frame.angle).map(frame => frame.bodyStep)),
          maxNearestFloorGap: Math.max(...preparation.map(frame => Math.abs(Math.max(...frame.feet.map(p => p[1])) - frame.surfaceY))),
          maxPenetration: Math.max(0, ...preparation.flatMap(frame => frame.feet.map(p => p[1] - frame.surfaceY))) } : null,
        window: { from: selected[0]?.time, to: selected.at(-1)?.time, frames: selected.length },
        maxAngle: selected.reduce((a, b) => a.angle.delta > b.angle.delta ? a : b),
        maxHand: peak('handStep'), maxFoot: peak('footStep') }
    return result
  } finally { f.close() }
}

for (const id of ['web', 'climb', 'finale']) test(id + ': локальная смена ветви не телепортирует конечности при 120 Hz', () => {
  const rows = [-1, 1].map(face => trajectory(id, face))
  cases.push(...rows)
  if (process.env.BUDDY_LEGACY_BRANCH_REPORT) writeFileSync(process.env.BUDDY_LEGACY_BRANCH_REPORT,
    JSON.stringify({ created: new Date().toISOString(), fps: 120,
      runtimeSha: createHash('sha256').update(readFileSync(new URL('../src/runtime.js', import.meta.url))).digest('hex'), cases }, null, 2) + '\n')
  for (const row of rows) {
    const detail = JSON.stringify({ id, face: row.face, maxAngle: { time: row.maxAngle.time, ...row.maxAngle.angle },
      maxHand: { time: row.maxHand.time, step: row.maxHand.handStep, bodyStep: row.maxHand.bodyStep },
      maxFoot: { time: row.maxFoot.time, step: row.maxFoot.footStep, bodyStep: row.maxFoot.bodyStep } })
    assert.ok(row.maxAngle.angle.delta < 12, 'Угловой шаг конечности < 12° за 1/120 s. ' + detail)
    assert.ok(row.maxHand.handStep < 6, 'Кисть проходит < 6 stage px за 1/120 s. ' + detail)
    assert.ok(row.maxFoot.footStep < 6, 'Стопа проходит < 6 stage px за 1/120 s. ' + detail)
    if (id === 'finale') {
      assert.ok(row.preparation.frames > 30 && row.preparation.maxAngle < 12, 'Подготовка целиком не переносит рывок раньше окна')
      assert.ok(row.preparation.maxNearestFloorGap < 1e-7 && row.preparation.maxPenetration < 1e-7, 'Подготовка сохраняет настоящий контакт стоп с полом')
      assert.ok(Math.abs(row.airborneAt - .3) < 1e-7, 'Полёт начинается в прежний момент .3 s')
    }
  }
})

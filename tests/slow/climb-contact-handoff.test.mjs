import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { runtimeFixture } from '../support/runtime-fixture.mjs'

const rates = [120, 240, 480], limbs = ['hands', 'elbows', 'feet'],
  distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  // До исправления IK: прежние путь таза и длительность при 120 Hz.
  bodyWaypoints = [[2, 922.35, 614.2384615384607], [4, 922.35, 564.2136476426721],
    [6, 922.35, 514.1888337468835], [8, 922.35, 464.1640198511079], [9, 922.35, 440.7],
    [10, 927.6923999999995, 425.56560000000076], [11, 947.710637712477, 402.2741439198698]]

function capture(face, hz) {
  const f = runtimeFixture(face), card = new f.host.constructor('div'), style = getComputedStyle,
    { raw } = f, { B } = raw, left = face > 0 ? 930 : 50,
    row = { face, hz, peakAngle: { step: 0 }, steps: {}, frames: 0, path: [] }
  card.closest = () => null
  card.hasAttribute = name => card.getAttribute(name) !== null
  card.getBoundingClientRect = () => ({ left, top: 420, right: left + 300, bottom: 620, width: 300, height: 200 })
  f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
  globalThis.getComputedStyle = node => node === card
    ? { backgroundColor: 'rgb(210,220,240)', borderTopWidth: '0', borderTopLeftRadius: '24' } : style(node)
  try {
    raw.rescan(); raw.seed(14); raw.step(1 / hz, hz); raw.run(['climb'])
    let active = false, prior
    for (let n = 0; n < 60 * hz; n++) {
      raw.step(1 / hz, hz)
      if (B.act.name !== 'climb') { if (active) break; continue }
      active = true; row.frames++
      const project = p => [(p[0] * Math.cos(B.yaw) - p[2] * Math.sin(B.yaw)) * raw.tools.S * B.scale + B.x,
        p[1] * raw.tools.S * B.scale + B.y],
        current = { t: B.act.t, x: B.x, y: B.y, face: B.face, pose: structuredClone(B.pose),
          hands: B.kk.arms.map(a => project(a.hand)), elbows: B.kk.arms.map(a => project(a.elbow)),
          feet: B.kk.legs.flatMap(g => [project(g.heel), project(g.toe)]) }
      assert.ok([current.t, current.x, current.y, ...limbs.flatMap(key => current[key].flat()),
        ...['sf', 'ef', 'hf', 'kf'].flatMap(key => current.pose[key])].every(Number.isFinite), 'Конечные координаты и углы')
      assert.equal(current.face, face, 'Настоящее направление всего подъёма')
      row.path.push(current)
      if (prior && current.t > 1.5) {
        for (const key of ['sf', 'ef', 'hf', 'kf']) for (let i = 0; i < 2; i++) {
          const step = Math.abs((current.pose[key][i] - prior.pose[key][i] + 540) % 360 - 180)
          if (step > row.peakAngle.step) row.peakAngle = { step, key, side: i, t: current.t }
        }
        for (const key of limbs) for (const relative of [false, true]) {
          const point = (r, p) => relative ? [p[0] - r.x, p[1] - r.y] : p,
            step = Math.max(...current[key].map((p, i) => distance(point(current, p), point(prior, prior[key][i])))),
            name = key + (relative ? 'Relative' : 'World')
          row.steps[name] = Math.max(row.steps[name] || 0, step)
        }
      }
      prior = current
    }
    assert.ok(active && row.frames > hz * 5 && B.act.name === 'idle', 'Полный подъём до завершения')
    assert.equal(B.mode, 'ground')
    assert.equal(B.surf.kind, 'plat')
    assert.equal(B.surf.y, 420)
    assert.ok(B.x > left && B.x < left + 300, 'Правильная противоположная площадка')
    row.duration = prior.t
    if (hz === 120) {
      assert.ok(Math.abs(row.duration - 11.15) < 1e-8, 'Прежняя длительность подъёма')
      for (const [time, x, y] of bodyWaypoints) {
        const sample = row.path.reduce((a, b) => Math.abs(a.t - time) < Math.abs(b.t - time) ? a : b)
        assert.ok(distance([face > 0 ? sample.x : 1280 - sample.x, sample.y], [x, y]) < 1e-7,
          'Прежний путь таза при t=' + time)
      }
    }
    return row
  } finally { f.close() }
}

// Фазы сравниваются по реальной позиции таза: y на стене, x при выходе наверх.
// Общий actionTime отличается на несколько dt из-за дискретных границ фаз.
function phaseCurve(row, phase) {
  const path = row.path, wallX = path[Math.floor(path.length / 2)].x,
    last = path.findLastIndex(p => Math.abs(p.x - wallX) < 1e-6)
  if (phase === 'mantle') return path.slice(last).map(p => ({ ...p, coordinate: p.x * row.face }))
  const vertical = path.slice(0, last).filter(p => Math.abs(p.x - wallX) < 1e-6),
    top = Math.min(...vertical.map(p => p.y))
  return vertical.filter(p => p.y > top + 5).reverse().map(p => ({ ...p, coordinate: p.y }))
}

function interpolate(curve, coordinate, key) {
  const at = Math.max(1, curve.findIndex(p => p.coordinate >= coordinate)), a = curve[at - 1], b = curve[at],
    weight = (coordinate - a.coordinate) / (b.coordinate - a.coordinate)
  return a[key].map((p, i) => p.map((v, j) => v + (b[key][i][j] - v) * weight))
}

test('лазанье сохраняет путь и непрерывный контакт при уменьшении dt', () => {
  const rows = rates.flatMap(hz => [-1, 1].map(face => capture(face, hz))), convergence = []
  for (const row of rows) {
    const detail = JSON.stringify({ face: row.face, hz: row.hz, steps: row.steps, peakAngle: row.peakAngle })
    // Исходное null→weight1 включение IK давало 12 px даже при dt→0.
    // Это широкий guard телепорта, а не художественная норма скорости.
    for (const [name, step] of Object.entries(row.steps)) assert.ok(step < 6, name + ': ' + detail)
  }
  for (const face of [-1, 1]) {
    const [coarse, medium, fine] = rates.map(hz => rows.find(r => r.hz === hz && r.face === face))
    for (const key of limbs) for (const suffix of ['World', 'Relative']) {
      const name = key + suffix
      assert.ok(fine.steps[name] < coarse.steps[name] * .8, 'Разрыв не исчезает при dt/4: ' + name)
    }
    for (const phase of ['wall', 'mantle']) {
      const curves = [coarse, medium, fine].map(row => phaseCurve(row, phase)),
        lo = Math.max(...curves.map(c => c[0].coordinate)), hi = Math.min(...curves.map(c => c.at(-1).coordinate))
      assert.ok(hi > lo)
      for (const key of limbs) {
        const errors = curves.slice(1).map((curve, i) => {
          let error = 0
          for (let n = 5; n <= 95; n++) {
            const coordinate = lo + (hi - lo) * n / 100, a = interpolate(curves[i], coordinate, key), b = interpolate(curve, coordinate, key)
            error = Math.max(error, ...a.map((point, j) => distance(point, b[j])))
          }
          return error
        })
        convergence.push({ face, phase, key, errors })
        assert.ok(errors[1] <= errors[0] * .8 + .05 && errors[1] < .5,
          'Фазовая сходимость ' + JSON.stringify({ face, phase, key, errors }))
      }
    }
  }
  if (process.env.BUDDY_CLIMB_HANDOFF_REPORT) writeFileSync(process.env.BUDDY_CLIMB_HANDOFF_REPORT,
    JSON.stringify({ rows, convergence, limits: ['Углы записаны диагностически: acos у полного разгибания не задаёт универсальную границу15°.',
      'Model oracle не заменяет native приёмку заметного локтевого рывка.'] }, null, 2) + '\n', { flag: 'wx' })
})

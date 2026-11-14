import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

const dt = 1 / 60, keys = ['rot', 'tl', 'ts', 'hp', 'sf', 'sa', 'ef', 'ea', 'hf', 'ha', 'kf', 'ka', 'af'],
  variants = [
    { id: 'ordinary', options: { apex: 18 } },
    { id: 'quick', options: { apex: 18, quick: true } },
    { id: 'flip', options: { apex: 20, flip: -360 } },
    { id: 'roll', options: { apex: 8, roll: true }, height: 330 }
  ],
  clone = p => Object.fromEntries(keys.map(key => [key, Array.isArray(p[key]) ? [...p[key]] : p[key]])),
  angleDelta = (a, b) => {
    let max = 0, at
    for (const key of keys) for (const [i, value] of (Array.isArray(a[key]) ? a[key] : [a[key]]).entries()) {
      const other = Array.isArray(b[key]) ? b[key][i] : b[key], difference = Math.abs(value - other) % 360,
        delta = Math.min(difference, 360 - difference)
      if (delta > max) { max = delta; at = { key, i, from: other, to: value } }
    }
    return { max, at }
  }

function trajectory(variant, face, targetDelta = 0) {
  const f = runtimeFixture(face), { raw } = f, { B, W } = raw, S = raw.tools.S,
    start = variant.height ? { kind: 'plat', y: W.floor.y - variant.height, x1: 400, x2: 800, spans: [[410, 790]] } : W.floor,
    target = targetDelta ? { kind: 'plat', y: start.y + targetDelta, x1: 350, x2: 1000, spans: [[360, 990]] } : variant.height ? W.floor : start,
    rest = raw.tools.pose(), restLow = Math.max(...raw.tools.solve(rest, 1, 0).legs.flatMap(leg => [leg.heel[1], leg.toe[1]])),
    frames = [], transitions = []
  try {
    W.floor.spans = [[0, 1280]]; W.plats = [start, target].filter(surface => surface.kind === 'plat')
    Object.assign(B, { x: 640, y: start.y - restLow * S, surf: start, surfY: start.y, mode: 'ground', anchor: null, face,
      cam: .4, yaw: face > 0 ? .4 * Math.PI / 2 : Math.PI - .4 * Math.PI / 2, yawV: 0 })
    const tx = 640 + face * (variant.id === 'flip' ? -6 : 100), action = raw.jumpTo(tx, target, variant.options), fn = action.fn
    let lastRaw, lastJumpRaw, jumpStageCompletedAt, fullCycleIdleAt, landedAt, airborneAt, prior
    action.fn = (a, frameDt) => {
      const p = fn(a, frameDt)
      if (p) { lastRaw = clone(p); lastJumpRaw = lastRaw }
      else if (jumpStageCompletedAt == null) jumpStageCompletedAt = W.time
      return p
    }
    raw.begin(action)
    for (let frame = 0; frame < 600; frame++) {
      raw.step(dt, 60)
      const k = B.kk, project = p => [B.x + (p[0] * Math.cos(B.yaw) - p[2] * Math.sin(B.yaw)) * S * B.scale,
        B.y + p[1] * S * B.scale],
        feet = k.legs.flatMap(leg => [project(leg.heel), project(leg.toe)]), hands = k.arms.map(arm => project(arm.hand)),
        current = { frame, time: (frame + 1) * dt, act: B.act.name, mode: B.mode, x: B.x, y: B.y,
          pose: clone(B.pose), rawPose: lastRaw, feet, hands, targetY: target.y,
          footError: B.mode === 'ground' && B.cset === 0 ? Math.max(...feet.map(p => p[1])) - B.surfY : null,
          contact: B.footId, surface: B.surf.kind }
      if (B.mode === 'free' && airborneAt == null) airborneAt = current.time
      if (airborneAt != null && B.mode === 'ground' && landedAt == null) landedAt = current.time
      if (prior) {
        const joints = angleDelta(current.pose, prior.pose), rawJoints = angleDelta(current.rawPose, prior.rawPose),
          step = (now, before) => Math.max(...now.map((p, i) => Math.hypot(p[0] - before[i][0], p[1] - before[i][1])))
        Object.assign(current, { jointStep: joints.max, jointAt: joints.at, rawJointStep: rawJoints.max,
          bodyStep: Math.hypot(current.x - prior.x, current.y - prior.y), handStep: step(hands, prior.hands), footStep: step(feet, prior.feet) })
        if (current.act !== prior.act || current.mode !== prior.mode) transitions.push({ frame, time: current.time,
          from: prior.act + '/' + prior.mode, to: current.act + '/' + current.mode,
          jointStep: current.jointStep, bodyStep: current.bodyStep, handStep: current.handStep, footStep: current.footStep })
      }
      frames.push(current); prior = current
      if (jumpStageCompletedAt != null && B.act.name === 'idle' && fullCycleIdleAt == null) fullCycleIdleAt = current.time
      if (fullCycleIdleAt != null && current.time > fullCycleIdleAt + .6) break
    }
    const worst = key => {
      const frame = frames.filter(frame => frame[key] != null).reduce((a, b) => a[key] > b[key] ? a : b)
      return { value: frame[key], frame: frame.frame, time: frame.time, act: frame.act, mode: frame.mode, joint: frame.jointAt }
    }, result = { id: variant.id, face, targetDelta, airborneAt, landedAt,
      jumpStageCompletedAt: jumpStageCompletedAt == null ? null : jumpStageCompletedAt - (W.time - frames.at(-1).time),
      fullCycleIdleAt, observedUntil: frames.at(-1).time,
      jumpStageExitPoseError: angleDelta(lastJumpRaw, rest), final: { x: B.x, targetX: tx, y: B.y, surface: B.surf.kind, act: B.act.name },
      maxJoint: worst('jointStep'), maxRawJoint: worst('rawJointStep'), maxBody: worst('bodyStep'),
      maxHand: worst('handStep'), maxFoot: worst('footStep'), transitions, frames }
    return result
  } finally { f.close() }
}

test('прыжки ordinary/quick/flip/roll в обе стороны проходят полный цикл 60 Hz с настоящими контактами', () => {
  const cases = []
  for (const variant of variants) for (const face of [-1, 1]) for (const targetDelta of variant.id === 'roll' ? [0] : [0, -70, 120]) {
    const result = trajectory(variant, face, targetDelta), { frames } = result
    assert.ok(frames.every(f => [f.x, f.y, ...Object.values(f.pose).flat(), ...f.feet.flat(), ...f.hands.flat()].every(Number.isFinite)))
    assert.ok(result.airborneAt != null && result.landedAt > result.airborneAt)
    assert.equal(result.final.act, 'idle')
    assert.ok(frames.filter(f => f.footError != null).every(f => Math.abs(f.footError) < 1e-7), 'Опорная стопа совпадает с реальной поверхностью')
    if (variant.id === 'roll') assert.ok(frames.some(f => f.act === 'roll'), 'После большого перепада действительно включается кувырок')
    cases.push(result)
  }
  if (process.env.JUMP_MOTION_REPORT) {
    mkdirSync(dirname(process.env.JUMP_MOTION_REPORT), { recursive: true })
    writeFileSync(process.env.JUMP_MOTION_REPORT, JSON.stringify({ date: new Date().toISOString(), fps: 60,
      fieldSemantics: { jumpStageCompletedAt: 'Окончание jumpTo, включая передачу кувырку.', fullCycleIdleAt: 'Первый idle после всех дочерних действий.', jumpStageExitPoseError: 'Последняя собственная поза jumpTo относительно STAND; при roll это поза передачи.', observedUntil: 'Конец наблюдения, не ранее 0.6 s после первого idle.' },
      functionSha: createHash('sha256').update(readFileSync(new URL('../runtime.js', import.meta.url), 'utf8')
        .split('  function jumpTo(')[1].split('\n  function leap(')[0]).digest('hex'), cases,
      cheer: [-1, 1].map(face => trajectory({ id: 'cheer', options: { apex: 14, arms: 'V', cam: .9 } }, face)) }, null, 2) + '\n')
  }
})

test('quick завершает собственное восстановление позы перед передачей следующему действию', () => {
  for (const face of [-1, 1]) for (const targetDelta of [0, -70, 120]) {
    const result = trajectory(variants[1], face, targetDelta)
    assert.ok(result.jumpStageExitPoseError.max < 2, `face=${face}, Δy=${targetDelta}: обрыв позы ${JSON.stringify(result.jumpStageExitPoseError)}`)
  }
})

test('подготовка и группировка не возвращают прежние рывки рук, кувырок принимает позу без резкого сгиба', () => {
  for (const face of [-1, 1]) {
    for (const variant of variants.slice(0, 3)) {
      const result = trajectory(variant, face), preparation = result.frames.filter(f => f.time < result.airborneAt && f.jointStep != null)
      assert.ok(Math.max(...preparation.map(f => f.jointStep)) < 14)
      assert.ok(Math.max(...preparation.map(f => f.handStep)) < 5)
      if (variant.id === 'flip') assert.ok(result.maxJoint.value < 16, 'Группировка распределена по полёту')
    }
    const roll = trajectory(variants[3], face).frames.filter(f => f.act === 'roll')
    assert.ok(Math.max(...roll.map(f => f.jointStep)) < 20)
    assert.ok(Math.max(...roll.map(f => f.handStep)) < 4)
  }
})

test('прыжок с руками V сохраняет позу на стыке полёта и приземления', () => {
  for (const face of [-1, 1]) {
    const result = trajectory({ id: 'cheer', options: { apex: 14, arms: 'V', cam: .9 } }, face)
    assert.ok(result.maxJoint.value < 16, JSON.stringify(result.maxJoint))
    assert.ok(result.maxHand.value < 6, JSON.stringify(result.maxHand))
  }
})

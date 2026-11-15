import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from '../support/runtime-fixture.mjs'

test('wave разворачивает широкую сторону ладони к аудитории без изменения локтя и утечки twist', async () => {
  const rows = []
  for (const face of [-1, 1]) {
    const f = runtimeFixture(face), previous = document, context = new Proxy({}, { get: () => () => {} })
    let maxWristStep = 0
    try {
      globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
      const { Buddy3D, THREE: T } = await import('../../src/vendor.js'), rig = Buddy3D.create({ outline: false })
      await rig.loaded
      globalThis.document = previous
      const bones = new Map()
      rig.root.traverse(o => { if (o.isBone) bones.set(o.name, o) })
      const side = face > 0 ? 0 : 1, suffix = side === 0 ? 'L' : 'R',
        wp = name => bones.get(name + suffix).getWorldPosition(new T.Vector3()),
        snapshot = () => ['UpperArmL', 'LowerArmL', 'UpperArmR', 'LowerArmR', 'Wrist' + (side ? 'L' : 'R')]
          .map(name => bones.get(name).quaternion.toArray())
      f.raw.run(['wave'])
      let previousWrist
      for (let n = 0; n < 180; n++) {
        f.raw.step(1 / 60)
        const b = f.raw.B, rest = { ...b.pose }, viewer = new T.Vector3(Math.cos(b.yaw), 0, Math.sin(b.yaw))
        delete rest.handFacing
        rig.pose(b.kk, rest, { yaw: b.yaw })
        const baseline = snapshot(), wristPosition = wp('Wrist')
        rig.pose(b.kk, b.pose, { yaw: b.yaw })
        assert.deepEqual(snapshot(), baseline, 'Локоть, предплечье и дальняя кисть сохраняют прежние кватернионы')
        assert.ok(wp('Wrist').distanceTo(wristPosition) < 1e-10, 'Сустав запястья не перемещается')
        const wrist = bones.get('Wrist' + suffix).getWorldQuaternion(new T.Quaternion())
        if (previousWrist) maxWristStep = Math.max(maxWristStep, previousWrist.angleTo(wrist))
        previousWrist = wrist
        if ([47, 71, 95, 125].includes(n)) {
          // Curl пальцев в rest направлен вниз: палмарная сторона противоположна Index×Pinky.
          const w = wp('Wrist'), normal = wp('Index1').sub(w).cross(wp('Pinky1').sub(w)).normalize().negate()
          rows.push({ face, time: (n + 1) / 60, yaw: b.yaw, normal: normal.toArray(), viewer: viewer.toArray(), dot: normal.dot(viewer) })
        }
        if (!b.pose.handFacing) {
          const q = bones.get('Wrist' + suffix).quaternion.toArray()
          rig.pose(b.kk, rest, { yaw: b.yaw })
          assert.deepEqual(bones.get('Wrist' + suffix).quaternion.toArray(), q, 'Другие действия сохраняют исходную кисть')
        }
      }
      rows.push({ face, maxWristStep, finalAction: f.raw.B.act.name, finalFacing: f.raw.B.pose.handFacing || [0, 0] })
    } finally { globalThis.document = previous; f.close() }
  }
  if (process.env.WAVE_FACING_REPORT) writeFileSync(process.env.WAVE_FACING_REPORT, JSON.stringify(rows, null, 2) + '\n')
  for (const row of rows) {
    if ('dot' in row) assert.ok(row.dot > .8, JSON.stringify(row))
    else {
      assert.ok(row.maxWristStep < .35, 'Нет однокадрового разворота запястья')
      assert.equal(row.finalAction, 'idle')
      assert.deepEqual(row.finalFacing, [0, 0])
    }
  }
})

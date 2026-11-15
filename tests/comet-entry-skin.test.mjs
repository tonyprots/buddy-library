import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { runtimeFixture } from './support/runtime-fixture.mjs'
import { createAbilityPlayer } from '../src/new-abilities.js'
import { palmGeometry } from './support/palm-geometry.mjs'

test('comet: настоящие пальцы входят из показанного handOpen без скачка при public player.play', async () => {
  const boot = runtimeFixture(), doc = document, ctx = new Proxy({}, { get: () => () => {} }), rows = []
  try {
    globalThis.document = { createElement: () => ({ getContext: () => ctx }) }
    const { Buddy3D, THREE: T } = await import('../src/vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded; globalThis.document = doc
    const geometry = palmGeometry(rig, T), fingers = [...geometry.bones].filter(([name]) => /^(Index|Middle|Ring|Pinky)/.test(name)),
      read = raw => {
        const b = raw.B, p = b.pose, k = raw.tools.solve(p, Math.cos(b.yaw) >= 0 ? 1 : -1, Math.sin(b.yaw)),
          fy = Math.max(...k.legs.flatMap(g => [g.heel[1], g.toe[1]])), sc = raw.tools.S * b.scale, sq = b.sq * .8
        rig.pose(k, p, { head: 1.5, yaw: b.yaw }); rig.place(b.x, b.y + fy * sc, fy, sc, [1 - sq * .55, 1 + sq], b.yaw)
        return { vertices: geometry.hands.flatMap(h => h.vertices.map(({ mesh, index }) => mesh.applyBoneTransform(index,
          new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index)).applyMatrix4(mesh.matrixWorld))),
          fingers: fingers.map(([, bone]) => bone.quaternion.clone()) }
      }
    for (const face of [-1, 1]) for (const initial of [null, [.2, .8], [2, -.5]]) {
      const f = runtimeFixture(face), raw = f.raw, player = createAbilityPlayer(raw, { host: f.host })
      try {
        raw.step(1 / 120, 120)
        if (initial) raw.B.pose.handOpen = initial
        const startPose = structuredClone(raw.B.pose), prior = read(raw), row = { face, initial, firstSkinStep: 0, firstFingerStep: 0, maxSkinStep: 0, maxFingerStep: 0 }
        assert.equal(player.play('comet'), true)
        assert.deepEqual(raw.B.pose, startPose, 'Construction/play не меняет уже показанную позу')
        let before = prior
        for (let n = 1; n <= 30; n++) {
          raw.step(1 / 120, 120)
          const after = read(raw), skin = Math.max(...after.vertices.map((v, i) => Math.hypot(v.x - before.vertices[i].x, v.y - before.vertices[i].y))),
            finger = Math.max(...after.fingers.map((q, i) => q.angleTo(before.fingers[i]) * 180 / Math.PI))
          row.maxSkinStep = Math.max(row.maxSkinStep, skin); row.maxFingerStep = Math.max(row.maxFingerStep, finger)
          if (n === 1) { row.firstSkinStep = skin; row.firstFingerStep = finger }
          before = after
        }
        rows.push(row)
      } finally { player.destroy(); f.close() }
    }
  } finally { globalThis.document = doc; boot.close() }
  if (process.env.BUDDY_COMET_ENTRY_REPORT) writeFileSync(process.env.BUDDY_COMET_ENTRY_REPORT, JSON.stringify(rows, null, 2) + '\n')
  assert.ok(rows.every(row => row.firstSkinStep < .2 && row.firstFingerStep < 3 && row.maxFingerStep < 3),
    'Actual skin frame1 и локальные фаланги .25s имеют промежуточные позы: ' + JSON.stringify(rows))
})

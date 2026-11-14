import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { runtimeFixture } from './support/runtime-fixture.mjs'
import { palmPatch } from './support/render-origin-geometry.mjs'
import { meshDistance } from './support/mesh-distance.mjs'

test('lightning: origin находится в центре настоящей skin-пясти, не на Wrist/cuff proxy', async () => {
  const boot = runtimeFixture(), doc = document, ctx = new Proxy({}, { get: () => () => {} }), rows = []
  try {
    globalThis.document = { createElement: () => ({ getContext: () => ctx }) }
    const { Buddy3D, THREE: T } = await import(process.env.BUDDY_ANCHOR_VENDOR || '../vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded; globalThis.document = doc
    const patches = palmPatch(rig, T), bones = new Map()
    rig.root.traverse(o => { if (o.isBone) bones.set(o.name, o) })
    for (const face of [-1, 1]) {
      const f = runtimeFixture(face)
      try {
        f.raw.B.x = face > 0 ? 190 : 1066; f.raw.run(['lightning'])
        for (const at of [1.15, 1.4, 2.1]) {
          while (f.raw.B.act.t < at) f.raw.step(1 / 120, 120)
          const { B, tools } = f.raw, p = B.pose, k = tools.solve(p, Math.cos(B.yaw) >= 0 ? 1 : -1, Math.sin(B.yaw)),
            fy = Math.max(...k.legs.flatMap(g => [g.heel[1], g.toe[1]])), sc = tools.S * B.scale, sq = B.sq * .8,
            out = { eyesW: [[0, 0], [0, 0]], handsW: [[0, 0], [0, 0]], palmsW: [], eyeOn: [false, false] }
          rig.pose(k, p, { head: 1.5, yaw: B.yaw }); rig.place(B.x, B.y + fy * sc, fy, sc, [1 - sq * .55, 1 + sq], B.yaw)
          // Before-vendor игнорирует новый канал: исходный bone proxy остаётся RED-точкой.
          for (const suffix of ['L', 'R']) {
            const wp = name => bones.get(name + suffix).getWorldPosition(new T.Vector3()),
              q = wp('Index1').add(wp('Pinky1')).multiplyScalar(.25).add(wp('Wrist').multiplyScalar(.5))
            out.palmsW.push([q.x, -q.y, q.z])
          }
          rig.renderAnchors(out, true)
          for (const [side, read] of patches.entries()) {
            const patch = read(), point = new T.Vector3(out.palmsW[side][0], -out.palmsW[side][1], out.palmsW[side][2]),
              gap = meshDistance(T, [point], [patch.mesh]), centerDistance = point.distanceTo(patch.center)
            rows.push({ face, at, yaw: B.yaw, side, gap, centerDistance, palmRadius: patch.radius, triangles: patch.triangles })
          }
        }
      } finally { f.close() }
    }
  } finally { globalThis.document = doc; boot.close() }
  if (process.env.BUDDY_PALM_ORIGIN_REPORT) writeFileSync(process.env.BUDDY_PALM_ORIGIN_REPORT, JSON.stringify(rows, null, 2) + '\n')
  assert.ok(rows.every(row => row.gap < 1e-8 && row.centerDistance < row.palmRadius * .3),
    'Источник должен лежать на actual skin-пясти около её центра: ' + JSON.stringify(rows))
})

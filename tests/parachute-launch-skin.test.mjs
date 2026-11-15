import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { runtimeFixture } from './support/runtime-fixture.mjs'

test('подготовка парашюта сохраняет реальную подошву GLB у пола без скачка при отрыве', async () => {
  const f = runtimeFixture(), previous = document, context = new Proxy({}, { get: () => () => {} }), rows = []
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../src/vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded; globalThis.document = previous
    const meshes = [], point = new T.Vector3()
    rig.root.traverse(o => { if (o.isSkinnedMesh && /Feet/u.test(o.name + o.parent.name)) meshes.push(o) })
    assert.ok(meshes.reduce((n, mesh) => n + mesh.geometry.attributes.position.count, 0) > 100)
    for (const face of [-1, 1]) for (const fps of [120, 240, 480]) {
      f.raw.reset()
      Object.assign(f.raw.B, { face, yaw: face > 0 ? .4 * Math.PI / 2 : Math.PI - .4 * Math.PI / 2, cam: .4, yawV: 0 })
      f.raw.launchParachute()
      const row = { face, fps, groundSamples: 0, minGap: Infinity, maxGap: -Infinity, maxReleaseStep: 0 }
      let previousBottom
      for (let n = 0; n < fps * .37; n++) {
        f.raw.step(1 / fps, fps)
        const b = f.raw.B, k = b.kk, fy = Math.max(...k.legs.flatMap(g => [g.heel[1], g.toe[1]])), sc = f.raw.tools.S * b.scale,
          sq = b.sq * .45
        rig.pose(k, b.pose, { head: 1.5, yaw: b.yaw })
        rig.place(b.x, b.y + fy * sc, fy, sc, [1 - sq * .55, 1 + sq], b.yaw)
        let bottom = -Infinity
        for (const mesh of meshes) for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          point.fromBufferAttribute(mesh.geometry.attributes.position, i)
          mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld)
          bottom = Math.max(bottom, -point.y)
        }
        if (b.mode === 'ground') {
          row.groundSamples++; row.minGap = Math.min(row.minGap, 700 - bottom); row.maxGap = Math.max(row.maxGap, 700 - bottom)
        } else if (previousBottom != null) row.maxReleaseStep = Math.max(row.maxReleaseStep, Math.abs(bottom - previousBottom))
        previousBottom = bottom
      }
      rows.push(row)
      assert.ok(row.groundSamples > fps * .3)
      // У исходной обуви есть отступ skin от proxy до ~1px. Проверяем
      // настоящие вершины, а не выдаём точный proxy-контакт за точный skin.
      assert.ok(row.minGap > -1 && row.maxGap < .1, JSON.stringify(row))
      assert.ok(row.maxReleaseStep < 520 / fps, 'Нет дополнительной коррекции skin при смене ground→free: ' + JSON.stringify(row))
    }
    if (process.env.BUDDY_PARACHUTE_SKIN_REPORT)
      writeFileSync(process.env.BUDDY_PARACHUTE_SKIN_REPORT, JSON.stringify({ limits: 'CPU rig.pose/place + все вершины двух настоящих skinned shoe meshes; без GPU/FPS. Сохранён исходный skin offset обуви от proxy, допускается до1px.', rows }, null, 2) + '\n', { flag: 'wx' })
  } finally { globalThis.document = previous; f.close() }
})

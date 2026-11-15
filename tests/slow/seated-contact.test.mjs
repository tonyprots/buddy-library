import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from '../support/runtime-fixture.mjs'
import { createContextPlayer } from '../../src/context-abilities.js'

test('сидячие позы опираются тазом и настоящими подошвами GLB на одну плоскость', async () => {
  const started = Date.now(), f = runtimeFixture(), previous = document,
    context = new Proxy({}, { get: () => () => {} }), cases = [],
    sha = file => createHash('sha256').update(readFileSync(new URL('../../src/' + file, import.meta.url))).digest('hex'),
    sourceSHA = { runtime: sha('runtime.js'), vendor: sha('vendor.js'), contextAbilities: sha('context-abilities.js') }
  let player
  try {
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../../src/vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded
    globalThis.document = previous
    const stand = f.raw.tools.pose(), meshes = [], groups = [], point = new T.Vector3(),
      components = ['getX', 'getY', 'getZ', 'getW']
    rig.pose(f.raw.tools.solve(stand, 1, 0), stand, { head: 1.5, yaw: 0 })
    rig.root.traverse(object => { if (object.isMesh && object.geometry?.attributes.position) meshes.push(object) })
    for (const mesh of meshes) {
      const feet = /Feet/.test(mesh.name + mesh.parent.name), pants = /LightBlue/.test(mesh.userData.n || '') && !feet,
        index = mesh.geometry.attributes.skinIndex, weight = mesh.geometry.attributes.skinWeight,
        selected = { pelvis: [], rearUpperPants: [], sole: [] }
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        if (feet && mesh.userData.n === 'White') selected.sole.push(i)
        if (!pants || !index || !weight) continue
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld)
        if (point.y < -.16 || point.y > .12) continue // Отсекаем голени по настоящей rest-геометрии.
        let hip = 0, upper = 0
        for (let j = 0; j < 4; j++) {
          const name = mesh.skeleton.bones[index[components[j]](i)]?.name || '', amount = weight[components[j]](i)
          if (/^(Hips|Body)$/u.test(name)) hip += amount
          if (/^(Hips|Body|UpperLeg[LR])$/u.test(name)) upper += amount
        }
        if (hip >= .5) selected.pelvis.push(i)
        if (upper >= .5 && point.z <= .015) selected.rearUpperPants.push(i)
      }
      if (Object.values(selected).some(values => values.length)) groups.push({ mesh, selected })
    }
    const counts = Object.fromEntries(['pelvis', 'rearUpperPants', 'sole'].map(kind => [kind,
      groups.reduce((sum, group) => sum + group.selected[kind].length, 0)]))
    assert.ok(Object.values(counts).every(value => value > 50), 'Выборки настоящего таза, задней части брюк и подошв непусты')
    player = createContextPlayer(f.raw, { host: f.host, context: () => ({
      fact: { id: 'seat-source', kind: 'text', text: 'Память команды' }, element: f.slide, bounds: [130, 180, 460, 230] }) })
    for (const id of ['sitRest', 'sitLean', 'nap', 'laptopNotes']) for (const face of [-1, 1]) {
      const times = id === 'nap' ? [3, 4.5, 6] : id === 'laptopNotes' ? [1.8, 3, 4.5, 6, 7.5] : [1.8, 3, 4.5, 6]
      for (const scale of id === 'laptopNotes' ? [.5, 1, 1.8] : [1]) for (const time of times) {
        f.raw.reset(); f.raw.seed(14)
        Object.assign(f.raw.B, { face, scale, scaleT: scale, cam: .4,
          yaw: face > 0 ? .4 * Math.PI / 2 : Math.PI - .4 * Math.PI / 2, yawV: 0, anchor: null })
        if (id === 'laptopNotes') f.raw.begin(player.create(id))
        else assert.ok(f.raw.run([id]))
        f.raw.step(time, 120)
        const b = f.raw.B, k = b.kk, sc = f.raw.tools.S * b.scale,
          fy = Math.max(...k.legs.flatMap(leg => [leg.heel[1], leg.toe[1]])),
          bottom = { pelvis: -Infinity, rearUpperPants: -Infinity, sole: -Infinity }
        assert.ok(b.pose.still, id + ': измеряется настоящая фаза удержания, а не приседание/подъём')
        assert.ok(Math.abs(b.sq) < 1e-4, 'В удержании отсутствует transient squash')
        rig.pose(k, b.pose, { head: 1.5, yaw: b.yaw })
        rig.place(b.x, b.y + fy * sc, fy, sc, [1, 1], b.yaw)
        for (const { mesh, selected } of groups) for (const [kind, indices] of Object.entries(selected)) for (const i of indices) {
          mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld)
          bottom[kind] = Math.max(bottom[kind], -point.y)
        }
        cases.push({ id, face, scale, time, hf: b.pose.hf, kf: b.pose.kf, yaw: b.yaw, bottom,
          proxySeatY: b.y + k.seat[1] * sc, floor: b.surfY,
          pelvisSoleGap: bottom.sole - bottom.pelvis, upperPantsSoleGap: bottom.sole - bottom.rearUpperPants, selectedVertices: counts })
      }
    }
    const report = { startedUTC: new Date(started).toISOString(), finishedUTC: new Date().toISOString(), durationMs: Date.now() - started,
      sourceSHA, limits: 'Настоящие GLB skinning/pose/place без GPU. Вершины таза отделены rest-позицией и весами костей; ноги не считаются тазом.',
      thresholds: { minGapStagePx: -.5, maxGapStagePx: .4 }, cases }
    if (process.env.BUDDY_SEATED_CONTACT_REPORT) writeFileSync(process.env.BUDDY_SEATED_CONTACT_REPORT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    const failed = cases.filter(row => [row.pelvisSoleGap, row.upperPantsSoleGap].some(gap => gap < -.5 || gap > .4))
    assert.deepEqual(failed.map(row => ({ id: row.id, face: row.face, time: row.time, pelvisSoleGap: row.pelvisSoleGap,
      upperPantsSoleGap: row.upperPantsSoleGap })), [], 'Нет зазора или сильного проникновения между тазом/верхом брюк и настоящими подошвами')
  } finally { globalThis.document = previous; player?.destroy(); f.close() }
})

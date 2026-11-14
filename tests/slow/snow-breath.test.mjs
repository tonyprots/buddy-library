import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { createAbilityPlayer } from '../../new-abilities.js'
import { runtimeFixture } from '../support/runtime-fixture.mjs'

const target = mouth => ({ eyesW: [[0, 0], [0, 0]], handsW: [[0, 0], [0, 0]], eyeOn: [true, true],
  ...(mouth ? { mouthW: [0, 0, 0] } : {}) }),
  distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]))

test('рот WebGL совпадает с front skin shader-рта при Head/Neck skinning без изменения прежних anchors', async () => {
  const f = runtimeFixture(), previous = document, context = new Proxy({}, { get: () => () => {} })
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../../vendor.js'), rig = Buddy3D.create({ outline: false }), other = Buddy3D.create({ outline: false })
    await Promise.all([rig.loaded, other.loaded])
    globalThis.document = previous
    let mesh, head
    rig.root.traverse(o => {
      if (o.isSkinnedMesh && o.material?.uniforms?.uMouthC === rig.face.uMouthC) mesh = o
      if (o.isBone && o.name === 'Head') head = o
    })
    assert.ok(mesh && head)
    const center = rig.face.uMouthC.value, rest = rig.face.uRestM.value, a = mesh.geometry.attributes.position,
      index = mesh.geometry.index, origin = new T.Vector3(center.x, center.y, 10), direction = new T.Vector3(0, 0, -1)
    let nearest = null
    for (let i = 0; i < index.count; i += 3) {
      const ids = [0, 1, 2].map(j => index.getX(i + j)),
        points = ids.map(id => new T.Vector3().fromBufferAttribute(a, id).applyMatrix4(rest)),
        edge1 = points[1].clone().sub(points[0]), edge2 = points[2].clone().sub(points[0]),
        cross = direction.clone().cross(edge2), determinant = edge1.dot(cross)
      if (Math.abs(determinant) < 1e-12) continue
      const offset = origin.clone().sub(points[0]), u = offset.dot(cross) / determinant,
        q = offset.clone().cross(edge1), v = direction.dot(q) / determinant,
        depth = edge2.dot(q) / determinant
      if (u < 0 || v < 0 || u + v > 1 || depth < 0) continue
      const hit = origin.clone().addScaledVector(direction, depth)
      if (!nearest || hit.z > nearest.hit.z) nearest = { ids, hit, weights: new T.Vector3(1 - u - v, u, v) }
    }
    assert.ok(nearest, 'Центр shader-рта пересекает настоящий front skin')
    const out = target(true),
      mouthIdentity = out.mouthW, rows = []
    for (const face of [-1, 1]) for (const [scale, squash, headScale] of [[.4, [1, 1], 1], [1, [.8, 1.2], 1.5], [3.4, [1.1, .9], 1.15]]) {
      const p = f.raw.tools.pose({ hp: 19, hy: -28, tl: 7, mouth: .5 }), yaw = face > 0 ? .6 : Math.PI - .6,
        k = f.raw.tools.solve(p, face, Math.sin(yaw)), legacy = target(false)
      rig.pose(k, p, { head: headScale, yaw }); rig.place(400, 500, 30, scale, squash, yaw)
      const matrices = [], readMatrices = () => {
        const values = []; rig.root.traverse(o => { if (o.isBone) values.push(...o.matrixWorld.elements) }); return values
      }
      matrices.push(...readMatrices())
      rig.renderAnchors(out); rig.renderAnchors(legacy)
      const skin = new T.Vector3(),
        weights = [nearest.weights.x, nearest.weights.y, nearest.weights.z]
      mesh.skeleton.update()
      for (const [j, id] of nearest.ids.entries()) skin.addScaledVector(mesh.applyBoneTransform(id,
        new T.Vector3().fromBufferAttribute(a, id)).applyMatrix4(mesh.matrixWorld), weights[j])
      assert.ok(distance(out.mouthW, [skin.x, -skin.y, skin.z]) < 1e-5, `Anchor остаётся на настоящем skinned triangle: ${JSON.stringify({ out: out.mouthW, skin: [skin.x, -skin.y, skin.z], face, scale, weights: nearest.ids.map(id => [0, 1, 2, 3].map(j => [mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(id, j)].name, mesh.geometry.attributes.skinWeight.getComponent(id, j)])) })}`)
      assert.deepEqual({ eyesW: out.eyesW, eyeOn: out.eyeOn, handsW: out.handsW }, legacy)
      assert.equal('mouthW' in legacy, false, 'Optional output не добавляется старым потребителям')
      assert.equal(out.mouthW, mouthIdentity, 'Выходной буфер переиспользуется')
      assert.deepEqual(readMatrices(), matrices, 'Чтение anchors не меняет позу и матрицы костей')
      const snapshot = structuredClone(out)
      other.pose(k, p, { head: 2, yaw: yaw + .5 }); other.place(800, 200, 30, 2, [1.1, .8], yaw + .5)
      other.renderAnchors(target(true)); rig.renderAnchors(out)
      assert.deepEqual(out, snapshot, 'Другой экземпляр не меняет привязки первого')
      rows.push({ face, scale, skinError: distance(out.mouthW, [skin.x, -skin.y, skin.z]) })
    }
    if (process.env.BUDDY_SNOW_REPORT) writeFileSync(process.env.BUDDY_SNOW_REPORT, JSON.stringify({ rows,
      maxSkinError: Math.max(...rows.map(row => row.skinError)) }, null, 2) + '\n', { flag: 'wx' })
    rig.dispose?.(); other.dispose?.()
  } finally { globalThis.document = previous; f.close() }
})

function snowFixture(face) {
  const f = runtimeFixture(face), { raw } = f, records = []
  raw.tools.registerPropBuilders = () => 1
  raw.tools.prop3 = (name, update) => { const state = { ping: true }; records.push({ name, update, state }); return state }
  const player = createAbilityPlayer(raw, { host: f.host }), action = player.create('snow')
  let crystal = null
  action.afterRender = () => {
    for (const record of records) {
      const p = record.update(record.state, raw.B.kk)
      if (!p) continue
      crystal = p.atW?.slice() || [raw.B.x + (p.at[0] * Math.cos(raw.B.yaw) - p.at[2] * Math.sin(raw.B.yaw)) * raw.tools.S * raw.B.scale,
        raw.B.y + p.at[1] * raw.tools.S * raw.B.scale]
      if (p.handContact) {
        crystal = [crystal[0] + 2, crystal[1] - 1]
        p.handContact.out.splice(0, p.handContact.out.length, ...crystal, 3)
      }
    }
  }
  raw.begin(action)
  const breath = () => raw.B.fxs.find(o => o.el.getAttribute('data-snow-breath') === 'true')
  return { ...f, player, action, breath, get crystal() { return crystal },
    close() { player.destroy(); f.close() } }
}

test('снежинка получает короткий выдох от SVG-рта текущего кадра к actual prop в момент release', () => {
  for (const face of [-1, 1]) {
    const f = snowFixture(face)
    try {
      assert.equal(typeof f.raw.tools.mouth, 'function')
      let seen = 0, atRelease = false
      for (let i = 0; i < 660; i++) {
        f.raw.step(1 / 120, 120)
        const t = f.action.t, effect = f.breath()
        assert.ok(effect, 'Выдох имеет собственный очищаемый FX')
        const opacity = Number(effect.el.getAttribute('opacity'))
        if (t < 4.02 || t > 4.62) { assert.equal(opacity, 0); continue }
        if (opacity < .01) continue
        const paths = effect.el.children
        assert.equal(paths.length, 3)
        for (const path of paths) {
          const numbers = path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number), mouth = f.raw.tools.mouth()
          assert.ok(distance(numbers.slice(0, 2), mouth.slice(0, 2)) < .015, 'Источник совпадает с текущим SVG mouth')
          assert.ok(distance(numbers.slice(-2), f.crystal.slice(0, 2)) < .015, 'Конец совпадает с actual snow prop')
        }
        if (Math.abs(t - 4.1) < .01) { atRelease = opacity > .8; assert.ok(f.raw.B.pose.mouth > .35); assert.ok(Math.abs(f.raw.B.pose.smile * 1.1 - .15) < .05, 'Shader mouth нейтрален в момент выдоха') }
        seen++
      }
      assert.ok(seen > 30 && seen < 90, 'Короткий читаемый выдох')
      assert.ok(atRelease, 'Выдох максимален при отпускании в 4.1 s')
      const effect = f.breath()
      f.raw.begin(f.raw.MAKE.wave()); for (let i = 0; i < 3; i++) f.raw.step(1 / 120, 120)
      assert.equal(effect.el.parentNode, null)
      assert.ok(!f.raw.B.fxs.includes(effect), 'Прерывание очищает scheduler')
    } finally { f.close() }
  }
})

test('destroy удаляет выдох, а SVG mouth следует настоящему рисунку после масштаба и squash', () => {
  const f = snowFixture(1)
  try {
    f.raw.B.scale = f.raw.B.scaleT = 1.7; f.raw.B.sq = .12
    for (let i = 0; i < 500; i++) f.raw.step(1 / 120, 120)
    const mouth = f.raw.tools.mouth(), nodes = [], visit = n => { nodes.push(n); n.children?.forEach(visit) }
    visit(f.host)
    const drawn = nodes.find(n => n.tagName === 'ELLIPSE' && n.getAttribute('fill') === '#6E2F22' && n.parentNode.parentNode.getAttribute('transform')),
      group = drawn.parentNode, transform = group.parentNode.getAttribute('transform').match(/-?\d+(?:\.\d+)?/g).map(Number),
      [x, by, sx, sy, , minusFeet] = transform,
      expected = [x + Number(drawn.getAttribute('cx')) * sx, by + (Number(drawn.getAttribute('cy')) + minusFeet) * sy]
    assert.ok(distance(mouth.slice(0, 2), expected) < .04)
    const effect = f.breath(); f.player.destroy(); f.raw.step(1 / 120, 120)
    assert.equal(effect.el.parentNode, null)
    assert.ok(!f.raw.B.fxs.includes(effect))
  } finally { f.close() }
})

test('SVG без 3D сохраняет источник текущего кадра, а reset удаляет выдох', () => {
  for (const face of [-1, 1]) {
    const f = runtimeFixture(face), player = createAbilityPlayer(f.raw, { host: f.host })
    try {
      assert.equal(player.play('snow'), true)
      for (let i = 0; i < 505; i++) f.raw.step(1 / 120, 120)
      const effect = f.raw.B.fxs.find(o => o.el.getAttribute('data-snow-breath') === 'true'),
        numbers = effect.el.children[0].getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number)
      assert.ok(Number(effect.el.getAttribute('opacity')) > .9)
      assert.ok(distance(numbers.slice(0, 2), f.raw.tools.mouth().slice(0, 2)) < .015)
      f.raw.reset()
      assert.equal(effect.el.parentNode, null)
      assert.ok(!f.raw.B.fxs.includes(effect))
    } finally { player.destroy(); f.close() }
  }
})

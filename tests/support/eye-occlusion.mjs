import assert from 'node:assert/strict'
import { palmGeometry } from './palm-geometry.mjs'

function weightsAt(point, a, b, c) {
  const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
  if (Math.abs(d) < 1e-12) return null
  const u = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / d,
    v = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / d
  return u >= 0 && v >= 0 && u + v <= 1 ? [u, v, 1 - u - v] : null
}

/**
 * Проверяет кисти перед настоящей поверхностью глазного glyph в ортографической камере Бадди.
 * Создавать сразу после rig.loaded, до первой pose/place. После pose/place вызывать read().
 * 21 внутренняя точка каждого эллипса uEyeC/uEyeR привязана barycentric к head skin triangles;
 * в кадре скиннятся те же вершины лица и кистей, проверяются XY и интерполированная Z.
 * Это регрессионный guard видимости, не полный pixel rasterizer или тест mesh penetration.
 * Blink не отключает guard: проверяется свободная область glyph даже при закрытом веке.
 * read({ propRoots }) дополнительно проверяет видимые triangles физического реквизита.
 */
export function createEyeOcclusionProbe(rig, T) {
  const geometry = palmGeometry(rig, T), head = geometry.bones.get('Head'), face = rig.face,
    inverseHead = head.matrixWorld.clone().invert(), headPosition = head.getWorldPosition(new T.Vector3()),
    normals = face.uEyeC.value.map(point => new T.Vector3(point.x, 0, point.z - headPosition.z)
      .transformDirection(inverseHead)), meshes = [], glyphs = []
  rig.root.traverse(mesh => {
    if (mesh.isSkinnedMesh && mesh.material?.uniforms?.uEyeC === face.uEyeC) meshes.push(mesh)
  })
  assert.equal(meshes.length, 1, 'Нужен единственный FACE skin mesh с настоящими uEyeC/uEyeR')
  const faceMesh = meshes[0], index = faceMesh.geometry.index, rest = faceMesh.geometry.attributes.position,
    positions = Array.from({ length: rest.count }, (_, i) => new T.Vector3().fromBufferAttribute(rest, i)
      .applyMatrix4(face.uRestM.value)), faceTriangles = []
  for (let i = 0; i < index.count; i += 3) faceTriangles.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)])
  for (const [eye, center] of face.uEyeC.value.entries()) {
    const points = []
    let origin
    for (const y of [-.8, -.4, 0, .4, .8]) for (const x of [-.8, -.4, 0, .4, .8]) {
      if (x * x + y * y > .81) continue
      const target = new T.Vector3(center.x + x * face.uEyeR.value.x, center.y + y * face.uEyeR.value.y, 0)
      let nearest = null
      for (const triangle of faceTriangles) {
        const points = triangle.map(i => positions[i]), weights = weightsAt(target, ...points)
        if (!weights) continue
        const z = points.reduce((sum, point, i) => sum + point.z * weights[i], 0)
        if (!nearest || z > nearest.z) nearest = { triangle, weights, z }
      }
      assert.ok(nearest, `Точка glyph ${eye}:${x},${y} должна попадать на настоящий head skin`)
      points.push(nearest)
      if (x === 0 && y === 0) origin = nearest
    }
    assert.equal(points.length, 21)
    assert.ok(origin, 'Центр shader glyph должен иметь собственную skin-привязку')
    glyphs.push({ points, origin })
  }
  const hands = geometry.hands.map(hand => {
    const selected = new Map(), triangles = []
    for (const { mesh, index } of hand.vertices) {
      if (!selected.has(mesh)) selected.set(mesh, new Set())
      selected.get(mesh).add(index)
    }
    for (const [mesh, vertices] of selected) {
      const index = mesh.geometry.index
      for (let i = 0; i < index.count; i += 3) {
        const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
        if (triangle.every(i => vertices.has(i))) triangles.push({ mesh, triangle })
      }
    }
    assert.ok(triangles.length > 0, 'Нужны настоящие skin triangles кисти')
    return { side: hand.side, selected, triangles }
  }), anchors = { eyesW: [[0, 0], [0, 0]], handsW: [[0, 0], [0, 0]], eyeOn: [true, true] }
  return {
    glyphSamplesPerEye: 21,
    geometry: { glyphSamples: glyphs.map(glyph => glyph.points.length), handTriangles: hands.map(hand => hand.triangles.length) },
    read({ propRoots = [] } = {}) {
      rig.root.updateMatrixWorld(true)
      const cached = new Map(), hits = [], propHits = [], eyes = [],
        vertex = (mesh, i) => {
          if (!cached.has(mesh)) { mesh.skeleton?.update(); cached.set(mesh, new Map()) }
          const points = cached.get(mesh)
          if (!points.has(i)) {
            const point = new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i)
            if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, point)
            points.set(i, point.applyMatrix4(mesh.matrixWorld))
          }
          return points.get(i)
        }, currentHands = hands.map(hand => {
          const min = new T.Vector3(Infinity, Infinity, Infinity), max = new T.Vector3(-Infinity, -Infinity, -Infinity)
          for (const [mesh, indices] of hand.selected) for (const i of indices) {
            const point = vertex(mesh, i)
            min.min(point); max.max(point)
          }
          return { ...hand, bounds: { min, max } }
        }), propTriangles = []
      function collectProp(mesh) {
        if (!mesh.visible) return
        if (mesh.geometry) {
          const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
          if (material?.opacity === undefined || material.opacity > .1) {
            const index = mesh.geometry.index, count = index?.count ?? mesh.geometry.attributes.position.count
            for (let i = 0; i < count; i += 3) propTriangles.push({ mesh,
              triangle: [0, 1, 2].map(offset => index ? index.getX(i + offset) : i + offset) })
          }
        }
        for (const child of mesh.children) collectProp(child)
      }
      for (const prop of propRoots) if (prop) collectProp(prop)
      rig.renderAnchors(anchors)
      for (const [eye, { points: probes, origin }] of glyphs.entries()) {
        // uEyeC — координата маски в vR до skinning. Независимый oracle
        // интерполирует actual skin vertices, как и остальные 21 glyph samples.
        const center = origin.triangle.reduce((sum, i, j) => sum.addScaledVector(vertex(faceMesh, i), origin.weights[j]), new T.Vector3()),
          visible = normals[eye].clone().transformDirection(head.matrixWorld).z > .05,
          state = { eye, visible, center: [center.x, -center.y, center.z], samples: visible ? probes.length : 0, occluded: 0, propOccluded: 0 }
        assert.ok(Math.hypot(center.x - anchors.eyesW[eye][0], center.y + anchors.eyesW[eye][1]) < 1e-6,
          'Eye anchor должен совпадать с независимым центром shader-маски на actual skin')
        assert.equal(visible, anchors.eyeOn[eye])
        if (visible) for (const [sample, probe] of probes.entries()) {
          const point = probe.triangle.reduce((sum, i, j) => sum.addScaledVector(vertex(faceMesh, i), probe.weights[j]), new T.Vector3())
          let covered = false
          for (const hand of currentHands) {
            const { min, max } = hand.bounds
            if (point.x < min.x || point.x > max.x || point.y < min.y || point.y > max.y || max.z <= point.z) continue
            for (const { mesh, triangle } of hand.triangles) {
              const points = triangle.map(i => vertex(mesh, i)), weights = weightsAt(point, ...points)
              if (!weights) continue
              const z = points.reduce((sum, p, i) => sum + p.z * weights[i], 0), depth = z - point.z
              if (depth <= 1e-5) continue
              covered = true
              hits.push({ eye, sample, hand: hand.side, point: [point.x, -point.y, point.z], depth })
              break
            }
          }
          if (covered) state.occluded++
          for (const { mesh, triangle } of propTriangles) {
            const points = triangle.map(i => vertex(mesh, i)), weights = weightsAt(point, ...points)
            if (!weights) continue
            const depth = points.reduce((sum, p, i) => sum + p.z * weights[i], 0) - point.z
            if (depth <= 1e-5) continue
            state.propOccluded++
            propHits.push({ eye, sample, mesh: mesh.name, point: [point.x, -point.y, point.z], depth })
            break
          }
        }
        eyes.push(state)
      }
      return { eyes, hits, propHits, occludedSamples: eyes.reduce((sum, eye) => sum + eye.occluded, 0),
        propOccludedSamples: eyes.reduce((sum, eye) => sum + eye.propOccluded, 0) }
    }
  }
}

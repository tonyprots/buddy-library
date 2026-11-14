/** Координата shader-маски на настоящем skin-треугольнике: vR интерполируется до skinning. */
export function shaderSurface(rig, T, center) {
  let mesh
  rig.root.traverse(o => { if (o.isSkinnedMesh && o.material?.uniforms?.uEyeC) mesh = o })
  const a = mesh.geometry.attributes.position, index = mesh.geometry.index, count = index ? index.count : a.count,
    points = Array.from({ length: a.count }, (_, i) => new T.Vector3().fromBufferAttribute(a, i).applyMatrix4(rig.face.uRestM.value))
  let front = -Infinity, ref
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j), [a, b, c] = ids.map(j => points[j]),
      den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
    if (Math.abs(den) < 1e-12) continue
    const u = ((b.y - c.y) * (center.x - c.x) + (c.x - b.x) * (center.y - c.y)) / den,
      v = ((c.y - a.y) * (center.x - c.x) + (a.x - c.x) * (center.y - c.y)) / den
    if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue
    const z = a.z * u + b.z * v + c.z * (1 - u - v)
    if (z > front) { front = z; ref = { ids, weights: [u, v, 1 - u - v] } }
  }
  if (!ref) throw new Error('Shader-маска не попала на skin головы')
  return () => ref.ids.reduce((sum, index, i) => sum.addScaledVector(mesh.applyBoneTransform(index,
    new T.Vector3().fromBufferAttribute(a, index)).applyMatrix4(mesh.matrixWorld), ref.weights[i]), new T.Vector3())
}

/** Вся внутренняя skin-поверхность пясти; тестирует расстояние до mesh, не формулу anchor. */
export function palmPatch(rig, T) {
  const bones = new Map(), meshes = []
  rig.root.traverse(o => { if (o.isBone) bones.set(o.name, o); if (o.isSkinnedMesh && o.material?.uniforms?.uSkin?.value) meshes.push(o) })
  return ['L', 'R'].map(suffix => {
    const wp = name => bones.get(name + suffix).getWorldPosition(new T.Vector3()), wrist = wp('Wrist'), along = wp('Middle1').sub(wrist),
      normal = wp('Index1').sub(wrist).cross(wp('Pinky1').sub(wrist)).normalize(), inward = new T.Vector3(0, 0, suffix === 'L' ? -1 : 1).cross(along),
      triangles = [], names = new Set(['Wrist', 'Index1', 'Middle1', 'Ring1', 'Pinky1'].map(name => name + suffix))
    if (normal.dot(inward) < 0) normal.negate()
    for (const mesh of meshes) {
      const a = mesh.geometry.attributes, index = mesh.geometry.index, count = index ? index.count : a.position.count
      for (let i = 0; i < count; i += 3) {
        const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j)
        if (!ids.every(id => {
          const influences = [0, 1, 2, 3].map(j => ({ name: mesh.skeleton.bones[a.skinIndex.getComponent(id, j)].name, weight: a.skinWeight.getComponent(id, j) }))
          return names.has(influences.reduce((best, part) => part.weight > best.weight ? part : best).name)
        })) continue
        const normals = ids.map(id => new T.Vector3().fromBufferAttribute(a.normal, id).transformDirection(mesh.matrixWorld))
        if (normals.reduce((sum, n) => sum.add(n), new T.Vector3()).dot(normal) > 0) triangles.push({ mesh, ids })
      }
    }
    return () => {
      const points = triangles.flatMap(({ mesh, ids }) => ids.map(id => mesh.applyBoneTransform(id,
        new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, id)).applyMatrix4(mesh.matrixWorld))), center = new T.Vector3()
      let area = 0
      for (let i = 0; i < points.length; i += 3) {
        const [a, b, c] = points.slice(i, i + 3), weight = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2
        center.addScaledVector(a.clone().add(b).add(c).multiplyScalar(1 / 3), weight); area += weight
      }
      center.multiplyScalar(1 / area)
      return { triangles: triangles.length, center, radius: Math.max(...points.map(v => v.distanceTo(center))), mesh: {
        matrixWorld: new T.Matrix4(), geometry: { index: null, attributes: { position: { count: points.length,
          getX: i => points[i].x, getY: i => points[i].y, getZ: i => points[i].z } } }
      } }
    }
  })
}

/** Минимум point→triangle для настоящих мировых точек и конечных mesh-поверхностей. */
export function meshDistance(T, points, meshes) {
  const ab = new T.Vector3(), ac = new T.Vector3(), ap = new T.Vector3(), bp = new T.Vector3(), cp = new T.Vector3(),
    a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), near = new T.Vector3()
  function closest(p) {
    ab.copy(b).sub(a); ac.copy(c).sub(a); ap.copy(p).sub(a)
    const d1 = ab.dot(ap), d2 = ac.dot(ap)
    if (d1 <= 0 && d2 <= 0) return near.copy(a)
    bp.copy(p).sub(b); const d3 = ab.dot(bp), d4 = ac.dot(bp)
    if (d3 >= 0 && d4 <= d3) return near.copy(b)
    const vc = d1 * d4 - d3 * d2
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return near.copy(a).addScaledVector(ab, d1 / (d1 - d3))
    cp.copy(p).sub(c); const d5 = ab.dot(cp), d6 = ac.dot(cp)
    if (d6 >= 0 && d5 <= d6) return near.copy(c)
    const vb = d5 * d2 - d1 * d6
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return near.copy(a).addScaledVector(ac, d2 / (d2 - d6))
    const va = d3 * d6 - d5 * d4
    if (va <= 0 && d4 >= d3 && d5 >= d6) return near.copy(b).addScaledVector(cp.copy(c).sub(b), (d4 - d3) / (d4 - d3 + d5 - d6))
    const scale = 1 / (va + vb + vc)
    return near.copy(a).addScaledVector(ab, vb * scale).addScaledVector(ac, vc * scale)
  }
  let nearest = Infinity
  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes.position, index = mesh.geometry.index, count = index ? index.count : positions.count,
      vertex = (i, out) => out.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld)
    for (let i = 0; i < count; i += 3) {
      vertex(i, a); vertex(i + 1, b); vertex(i + 2, c)
      for (const p of points) nearest = Math.min(nearest, closest(p).distanceToSquared(p))
    }
  }
  return Math.sqrt(nearest)
}

import assert from 'node:assert/strict'

/** AABB видимой геометрии и настоящего face skin после pose/place/prop, в пикселях сцены. */
export function propGeometry(rig, T) {
  const heads = [], point = new T.Vector3()
  rig.root.traverse(mesh => {
    if (mesh.isSkinnedMesh && mesh.material?.uniforms?.uEyeC === rig.face.uEyeC) heads.push(mesh)
  })
  assert.equal(heads.length, 1)
  function bounds(root, skinned = false, descend = true) {
    const box = [Infinity, Infinity, -Infinity, -Infinity]
    function visit(mesh) {
      if (!mesh.visible) return
      if (mesh.geometry) {
        if (skinned) mesh.skeleton.update()
        const positions = mesh.geometry.attributes.position
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i)
          if (skinned) mesh.applyBoneTransform(i, point)
          point.applyMatrix4(mesh.matrixWorld)
          box[0] = Math.min(box[0], point.x); box[1] = Math.min(box[1], -point.y)
          box[2] = Math.max(box[2], point.x); box[3] = Math.max(box[3], -point.y)
        }
      }
      if (descend) for (const child of mesh.children) visit(child)
    }
    visit(root); return box
  }
  const separation = (head, prop) => Math.max(prop[0] - head[2], head[0] - prop[2], prop[1] - head[3], head[1] - prop[3])
  return { bounds, readPieces(root) {
    rig.root.updateMatrixWorld(true)
    const head = bounds(heads[0], true), pieces = []
    function visit(mesh) {
      if (!mesh.visible) return
      if (mesh.geometry) {
        const prop = bounds(mesh, false, false)
        pieces.push({ name: mesh.name, prop, gap: separation(head, prop) })
      }
      for (const child of mesh.children) visit(child)
    }
    visit(root)
    const closest = pieces.reduce((a, b) => a.gap < b.gap ? a : b)
    return { head, ...closest, pieces: pieces.length }
  }, read(root) {
    rig.root.updateMatrixWorld(true)
    const head = bounds(heads[0], true), prop = bounds(root),
      gap = separation(head, prop)
    return { head, prop, gap }
  } }
}

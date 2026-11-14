export function palmGeometry(rig, T) {
  const bones = new Map(), meshes = [], body = [], hands = []
  rig.root.traverse(o => { if (o.isBone) bones.set(o.name, o); if (o.isSkinnedMesh && o.material?.uniforms?.uSkin?.value) meshes.push(o); if (o.isSkinnedMesh && o.material?.uniforms?.uBase) body.push(o) })
  const wp = name => bones.get(name).getWorldPosition(new T.Vector3())
  for (const side of ['L', 'R']) {
    const wrist = wp('Wrist' + side), along = wp('Middle1' + side).sub(wrist), length = along.length(),
      normal = wp('Index1' + side).sub(wrist).cross(wp('Pinky1' + side).sub(wrist)).normalize(),
      inward = new T.Vector3(0, 0, side === 'L' ? -1 : 1).cross(along), vertices = [], palm = []
    along.normalize(); if (normal.dot(inward) < 0) normal.negate()
    for (const mesh of meshes) {
      const a = mesh.geometry.attributes, selected = new Set(mesh.skeleton.bones.map((b, i) => /^(Wrist|Index|Middle|Ring|Pinky|Thumb)/.test(b.name) && b.name.endsWith(side) ? i : -1))
      selected.delete(-1)
      for (let i = 0; i < a.position.count; i++) {
        let weight = 0
        for (let j = 0; j < 4; j++) if (selected.has(a.skinIndex.getComponent(i, j))) weight += a.skinWeight.getComponent(i, j)
        if (weight < .75) continue
        const p = new T.Vector3().fromBufferAttribute(a.position, i).applyMatrix4(mesh.matrixWorld), distance = p.clone().sub(wrist).dot(along), ref = { mesh, index: i }
        vertices.push(ref)
        if (distance >= length * .08 && distance <= length * .8) palm.push(ref)
      }
    }
    hands.push({ side, vertices, palm, normal: normal.applyQuaternion(bones.get('Wrist' + side).getWorldQuaternion(new T.Quaternion()).invert()) })
  }
  return {
    bones, hands,
    bodyFloor() {
      let low = Infinity, meshName = '', boneWeights = []
      const point = new T.Vector3()
      for (const mesh of body) {
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          point.fromBufferAttribute(mesh.geometry.attributes.position, i); mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld)
          if (point.y < low) { low = point.y; meshName = mesh.name; boneWeights = [];
            for (let j = 0; j < 4; j++) boneWeights.push([mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(i, j)].name, mesh.geometry.attributes.skinWeight.getComponent(i, j)])
          }
        }
      }
      return { gap: low + 700, mesh: meshName, boneWeights }
    },
    read() {
      rig.root.updateMatrixWorld(true)
      for (const mesh of meshes) mesh.skeleton.update()
      return hands.map(h => {
        const transform = ref => ref.mesh.applyBoneTransform(ref.index, new T.Vector3().fromBufferAttribute(ref.mesh.geometry.attributes.position, ref.index)).applyMatrix4(ref.mesh.matrixWorld),
          palm = h.palm.map(transform), skin = h.vertices.map(transform), center = palm.reduce((a, b) => a.add(b), new T.Vector3()).multiplyScalar(1 / palm.length),
          normal = h.normal.clone().transformDirection(bones.get('Wrist' + h.side).matrixWorld)
        return { side: h.side, palm, skin, center, normal }
      })
    }
  }
}

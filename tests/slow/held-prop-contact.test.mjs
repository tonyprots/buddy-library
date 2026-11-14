import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from '../support/runtime-fixture.mjs'
import { palmGeometry } from '../support/palm-geometry.mjs'

// Инвариант: настоящий предмет касается лицевой стороны реальной ладони,
// ориентация кисти фазирована, а выключенный канал не меняет другие кости.
test('четыре удерживаемых предмета: actual GLB контакт ладоней в обе стороны120Hz', async () => {
  const startedAtUTC = new Date().toISOString(), boot = runtimeFixture(), previous = document,
    context = new Proxy({}, { get: () => () => {} }), rows = []
  let rig
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../../vendor.js')
    const { createAbilityPlayer } = await import(process.env.BUDDY_HELD_ABILITY || '../../new-abilities.js')
    rig = Buddy3D.create({ outline: false }); await rig.loaded; globalThis.document = previous
    const geometry = palmGeometry(rig, T), roots = new Map(), solids = new Map(), point = new T.Vector3(), headRefs = [],
      plain = p => { const q = { ...p }; delete q.handTask; return q },
      boneState = () => [...geometry.bones.values()].map(b => [b.name, ...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()]),
      originState = () => ['UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'WristL', 'WristR'].map(name => geometry.bones.get(name).getWorldPosition(new T.Vector3()).toArray()),
      projects = (objects, normal) => {
        let min = Infinity, max = -Infinity
        for (const object of objects) {
          const a = object.geometry.attributes.position
          for (let i = 0; i < a.count; i++) { point.fromBufferAttribute(a, i).applyMatrix4(object.matrixWorld); const d = point.dot(normal); min = Math.min(min, d); max = Math.max(max, d) }
        }
        return { min, max }
      },
      primary = (name, root) => {
        if (solids.get(name)) return solids.get(name)
        if (name === 'abilityComet') return [root.children[1].children[0]]
        if (name === 'abilityForceWall') return [root.children[0].children[0]]
        const objects = []; root.traverse(o => { if (o.isMesh && o.material?.uniforms?.uBase) objects.push(o) }); return objects
      },
      ab = new T.Vector3(), ac = new T.Vector3(), ap = new T.Vector3(), bp = new T.Vector3(), cp = new T.Vector3(),
      closest = (p, a, b, c, out) => {
        ab.copy(b).sub(a); ac.copy(c).sub(a); ap.copy(p).sub(a)
        const d1 = ab.dot(ap), d2 = ac.dot(ap)
        if (d1 <= 0 && d2 <= 0) return out.copy(a)
        bp.copy(p).sub(b); const d3 = ab.dot(bp), d4 = ac.dot(bp)
        if (d3 >= 0 && d4 <= d3) return out.copy(b)
        const vc = d1 * d4 - d3 * d2
        if (vc <= 0 && d1 >= 0 && d3 <= 0) return out.copy(a).addScaledVector(ab, d1 / (d1 - d3))
        cp.copy(p).sub(c); const d5 = ab.dot(cp), d6 = ac.dot(cp)
        if (d6 >= 0 && d5 <= d6) return out.copy(c)
        const vb = d5 * d2 - d1 * d6
        if (vb <= 0 && d2 >= 0 && d6 <= 0) return out.copy(a).addScaledVector(ac, d2 / (d2 - d6))
        const va = d3 * d6 - d5 * d4
        if (va <= 0 && d4 >= d3 && d5 >= d6) return out.copy(b).addScaledVector(cp.copy(c).sub(b), (d4 - d3) / (d4 - d3 + d5 - d6))
        const denominator = 1 / (va + vb + vc)
        return out.copy(a).addScaledVector(ab, vb * denominator).addScaledVector(ac, vc * denominator)
      },
      cases = { comet: ['abilityComet', 1.8, 4.35], snow: ['abilitySnowflake', 2.2, 4], starcatch: ['abilityStar', 2.1, 4.9], forceWall: ['abilityForceWall', 1.3, 4.1] }
    assert.ok(closest(new T.Vector3(.2, .2, 3), new T.Vector3(), new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3()).distanceTo(new T.Vector3(.2, .2, 0)) < 1e-12)
    if (process.env.BUDDY_HELD_HEAD !== '0') rig.root.traverse(mesh => {
      if (!mesh.geometry?.attributes.position) return
      const a = mesh.geometry.attributes
      if (mesh.isSkinnedMesh) {
        for (let i = 0; i < a.position.count; i++) {
          let weight = 0
          for (let j = 0; j < 4; j++) if (mesh.skeleton.bones[a.skinIndex.getComponent(i, j)].name === 'Head') weight += a.skinWeight.getComponent(i, j)
          if (weight > .5) headRefs.push({ mesh, index: i })
        }
      } else {
        let parent = mesh.parent
        while (parent && parent.name !== 'Head') parent = parent.parent
        if (parent) for (let i = 0; i < a.position.count; i++) headRefs.push({ mesh, index: i })
      }
    })
    for (const [id, [name, from, to]] of Object.entries(cases).filter(([id]) => !process.env.BUDDY_HELD_PROP_IDS || process.env.BUDDY_HELD_PROP_IDS.split(',').includes(id))) for (const face of [-1, 1]) {
      const f = runtimeFixture(face), { raw } = f, props = new Map()
      raw.tools.registerPropBuilders = factory => {
        if (roots.size) return 0
        return rig.registerPropBuilders(kit => Object.fromEntries(Object.entries(factory(kit)).map(([name, make]) => [name, () => {
          const prop = make(); roots.set(name, prop.g); solids.set(name, prop.contactMeshes); return prop
        }])))
      }
      raw.tools.prop3 = (name, update) => { const state = { ping: true, miss: 0 }; props.set(name, { state, update }); return state }
      // Регистрируем builders один раз; новый player не перерегистрирует их в общем риге.
      if (rows.length) raw.tools.registerPropBuilders = () => 0
      const player = createAbilityPlayer(raw, { host: f.host }), ci = face > 0 ? 0 : 1,
        row = { id, face, frames: 0, heldFrames: 0, minNormal: 1, minGap: Infinity, maxGap: -Infinity,
          maxWristStep: 0, zeroChecks: 0, originsExact: true, maxPropStep: 0, maxHeldPropStep: 0, maxSurfaceDistance: 0, surfaceChecks: 0, seams: [], minHeadGap: null, headFrames: 0 },
        prior = [null, null]
      let lastCenter = null, lastPropTime = null, lastRotation = null
      try {
        assert.equal(player.play(id), true)
        const planned = [...raw.B.act.canvasBounds]
        for (let frame = 0; frame < 1200; frame++) {
          raw.step(1 / 120, 120)
          const b = raw.B, p = b.pose, t = b.act.t, options = { yaw: b.yaw, head: 1.5 - .35 * Math.max(0, -Math.cos(p.rot * Math.PI / 180)) }
          row.frames++
          rig.pose(b.kk, plain(p), options); const beforeOrigins = originState()
          rig.pose(b.kk, p, options); assert.deepEqual(originState(), beforeOrigins)
          for (let side = 0; side < 2; side++) {
            const q = geometry.bones.get('Wrist' + (side ? 'R' : 'L')).getWorldQuaternion(new T.Quaternion())
            if (prior[side] && prior[side].angleTo(q) > row.maxWristStep) {
              row.maxWristStep = prior[side].angleTo(q); row.maxWristAt = { t, side, task: p.handTask, action: b.act.name }
            }
            prior[side] = q
          }
          if (frame % 60 === 0) {
            rig.pose(b.kk, plain(p), options); const absent = boneState()
            rig.pose(b.kk, { ...plain(p), handTask: { kind: 'support', amount: [0, 0] } }, options)
            assert.deepEqual(boneState(), absent); row.zeroChecks++
          }
          rig.pose(b.kk, p, options); rig.place(b.x, b.y, 0, raw.tools.S * b.scale, [1, 1], b.yaw)
          const hands = geometry.read()
          for (const [propName, record] of props) {
            if (record.state.done || b.act.name !== id) { rig.prop(propName, null); continue }
            const params = record.update(record.state, b.kk); rig.prop(propName, params)
            if (propName !== name || !params) continue
            const root = roots.get(name); root.updateMatrixWorld(true)
            const center = root.getWorldPosition(new T.Vector3()), rotation = root.getWorldQuaternion(new T.Quaternion())
            if (lastCenter) {
              const step = center.distanceTo(lastCenter)
              if (step > row.maxPropStep) { row.maxPropStep = step; row.maxPropAt = { t, action: b.act.name, params: structuredClone(params) } }
              if (b.act.name === id && t > from + 1 / 120 && t <= to) row.maxHeldPropStep = Math.max(row.maxHeldPropStep, step)
              for (const boundary of ({ comet: [1.32, 4.55], snow: [2.1, 4.1], starcatch: [1.9, 5.05], forceWall: [1.25, 4.2] })[id])
                if (lastPropTime < boundary && t >= boundary) row.seams.push({ boundary, time: t, distance3d: step,
                  screenStep: Math.hypot(center.x - lastCenter.x, center.y - lastCenter.y), rotationStep: lastRotation.angleTo(rotation) })
            }
            lastCenter = center; lastPropTime = t; lastRotation = rotation
            if (headRefs.length && (id === 'starcatch' || id === 'snow')) {
              const bounds = (objects, refs) => {
                const box = [Infinity, Infinity, -Infinity, -Infinity], visit = (mesh, index) => {
                  point.fromBufferAttribute(mesh.geometry.attributes.position, index)
                  if (refs && mesh.isSkinnedMesh) mesh.applyBoneTransform(index, point)
                  point.applyMatrix4(mesh.matrixWorld); box[0] = Math.min(box[0], point.x); box[1] = Math.min(box[1], point.y); box[2] = Math.max(box[2], point.x); box[3] = Math.max(box[3], point.y)
                }
                if (refs) for (const { mesh, index } of refs) visit(mesh, index)
                else for (const mesh of objects) for (let i = 0; i < mesh.geometry.attributes.position.count; i++) visit(mesh, i)
                return box
              }, head = bounds(null, headRefs), prop = bounds(primary(name, root)),
                gap = Math.max(head[0] - prop[2], prop[0] - head[2], head[1] - prop[3], prop[1] - head[3])
              row.headFrames++
              assert.ok(prop[0] >= planned[0] - .01 && prop[2] <= planned[2] + .01 && -prop[3] >= planned[1] - .01 && -prop[1] <= planned[3] + .01, 'Настоящая геометрия предмета внутри исходного FOV-резерва')
              if (row.minHeadGap == null || gap < row.minHeadGap) { row.minHeadGap = gap; row.minHeadAt = { t, head, prop } }
            }
            if (b.act.name === id && t >= from && t <= to) {
              const normal = id === 'forceWall' ? new T.Vector3(0, 0, 1).transformDirection(root.parent.parent.matrixWorld) : new T.Vector3(0, 1, 0),
                extent = projects(primary(name, root), normal)
              for (const side of id === 'forceWall' ? [0, 1] : [ci]) {
                const h = hands[side], palmMax = Math.max(...h.palm.map(v => v.dot(normal))), gap = extent.min - palmMax
                row.minNormal = Math.min(row.minNormal, h.normal.dot(normal)); row.minGap = Math.min(row.minGap, gap); row.maxGap = Math.max(row.maxGap, gap)
                if (frame % 60 === 0) {
                  let nearest = Infinity
                  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), near = new T.Vector3()
                  for (const mesh of primary(name, root)) {
                    const positions = mesh.geometry.attributes.position, index = mesh.geometry.index,
                      count = index ? index.count : positions.count,
                      vertex = (i, out) => out.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld)
                    for (let i = 0; i < count; i += 3) {
                      vertex(i, a); vertex(i + 1, b); vertex(i + 2, c)
                      for (const skin of h.palm) nearest = Math.min(nearest, closest(skin, a, b, c, near).distanceToSquared(skin))
                    }
                  }
                  row.maxSurfaceDistance = Math.max(row.maxSurfaceDistance, Math.sqrt(nearest)); row.surfaceChecks++
                }
              }
              row.heldFrames++
            }
          }
          if (b.act.name === 'idle') break
        }
        row.final = raw.B.act.name; row.finalHandTask = raw.B.pose.handTask || null; rows.push(row)
      } finally { player.destroy(); f.close() }
    }
  } finally { globalThis.document = previous; rig?.dispose?.(); boot.close() }
  const report = { startedAtUTC, endedAtUTC: new Date().toISOString(), hz: 120,
    hashes: Object.fromEntries(['runtime.js', 'vendor.js', 'new-abilities.js', 'ability-props.js'].map(name => [name, createHash('sha256').update(readFileSync(new URL('../../' + name, import.meta.url))).digest('hex')])),
    method: 'Node direct-call actual GLB skin/prop geometry; без WebGL, browser FPS и GPU-time.', rows }
  if (process.env.BUDDY_HELD_PROP_REPORT) writeFileSync(process.env.BUDDY_HELD_PROP_REPORT, JSON.stringify(report, null, 2) + '\n')
  for (const row of rows) {
    const detail = JSON.stringify(row)
    assert.ok(row.heldFrames > 150, detail); assert.equal(row.final, 'idle'); assert.equal(row.finalHandTask, null)
    assert.ok(row.minNormal > .98, 'Лицевая ладонь направлена в опору/щит. ' + detail)
    assert.ok(row.minGap >= -.05 && row.maxGap < .45, 'Касание реальных поверхностей без проникновения/зазора. ' + detail)
    assert.ok(row.maxWristStep < .5, 'Нет скачка кватерниона кисти. ' + detail)
    assert.ok(row.maxHeldPropStep < .5, 'Устойчивая опора не перескакивает между крайними вершинами. ' + detail)
    assert.equal(row.seams.length, 2)
    assert.ok(row.seams.every(s => s.distance3d < 1 && s.screenStep < 1 && s.rotationStep < .2), 'Ловля/отпускание не переключают позицию или ориентацию скачком. ' + detail)
    assert.ok(row.surfaceChecks >= 3 && row.maxSurfaceDistance < .75, 'Реальная ладонь достигает поверхности предмета, не только её бесконечной плоскости. ' + detail)
    if (row.minHeadGap != null) {
      assert.ok(row.headFrames >= 500, detail)
      assert.ok(row.minHeadGap > .75, 'Голова и предмет имеют видимый зазор во всём видимом интервале полёта/ловли/удержания/отпускания. ' + detail)
    }
  }
})

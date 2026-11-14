import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from '../support/runtime-fixture.mjs'
import { storyFixture } from '../support/story-fixture.mjs'
import { palmGeometry } from '../support/palm-geometry.mjs'
import { propGeometry } from '../support/prop-geometry.mjs'
import { meshDistance } from '../support/mesh-distance.mjs'

// Инвариант: карточка лежит на реальной лицевой ладони, указка проходит
// внутри согнутых пальцев; wrist/finger-канал не меняет body IK и лицо открыто весь цикл.
test('пять context props: actual GLB хват в обе стороны, 120 Hz', async () => {
  const startedAtUTC = new Date().toISOString(), boot = runtimeFixture(), previous = document,
    ctx = new Proxy({}, { get: (_, name) => name === 'measureText' ? text => ({ width: text.length * 30 }) : () => {} }),
    rows = [], roots = new Map(), solids = new Map()
  let rig
  try {
    globalThis.document = { createElement: () => ({ getContext: () => ctx }) }
    const { Buddy3D, THREE: T } = await import('../../vendor.js')
    rig = Buddy3D.create({ outline: false }); await rig.loaded; globalThis.document = previous
    const geometry = palmGeometry(rig, T), head = propGeometry(rig, T), v = new T.Vector3(),
      originState = () => ['UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'WristL', 'WristR']
        .map(name => geometry.bones.get(name).getWorldPosition(new T.Vector3()).toArray()),
      bare = p => { const q = { ...p }; delete q.handTask; delete q.handFist; delete q.handOpen; return q },
      vertices = meshes => meshes.flatMap(mesh => {
        const a = mesh.geometry.attributes.position, points = []
        for (let i = 0; i < a.count; i++) points.push(new T.Vector3().fromBufferAttribute(a, i).applyMatrix4(mesh.matrixWorld))
        return points
      }),
      register = factory => rig.registerPropBuilders(kit => Object.fromEntries(Object.entries(factory(kit)).map(([name, make]) => [name, () => {
        const it = make(); roots.set(name, it.g); solids.set(name, it.contactMeshes); return it
      }])))
    let registered = false
    for (const id of ['compareValues', 'showBeforeAfter', 'assembleList', 'quoteIdea', 'traceFlow']
      .filter(id => !process.env.BUDDY_CONTEXT_GRIP_IDS || process.env.BUDDY_CONTEXT_GRIP_IDS.split(',').includes(id))) for (const face of [-1, 1]) {
      const f = storyFixture(id, face, factory => { if (registered) return 0; registered = true; return register(factory) }),
        { raw } = f, ci = face > 0 ? 0 : 1,
        row = { id, face, frames: 0, contactFrames: 0, minNormal: 1, maxGripOffset: 0, maxFiniteContactGap: 0,
          maxWristStep: 0, maxPropStep: 0, maxVisiblePropStep: 0, minHeadGap: Infinity, headFrames: 0, minFist: 1,
          minSurfaceGap: Infinity, maxSurfaceGap: -Infinity, originsExact: true, fingers: {}, placedChecks: 0, quietCallbackChecks: 0 },
        priorQ = [null, null], priorCenters = new Map(), priorFades = new Map(), nodes = () => {
          const result = [], visit = node => { result.push(node); for (const child of node.children || []) visit(child) }
          visit(f.host); return result
        }
      try {
        const createElement = document.createElement
        document.createElement = tag => tag === 'canvas' ? { getContext: () => ctx } : createElement(tag)
        if (id === 'assembleList' && process.env.BUDDY_CONTEXT_LIST_ITEMS) {
          const count = +process.env.BUDDY_CONTEXT_LIST_ITEMS
          assert.ok(Number.isInteger(count) && count >= 1 && count <= 8)
          f.selection.fact.structure.items = Array.from({ length: count }, (_, i) => ({
            ...f.selection.fact.structure.items[0], id: 'list-' + i, text: 'Пункт ' + (i + 1) }))
        }
        f.start()
        for (let n = 0; n < Math.ceil(f.entry.duration * 120) + 40; n++) {
          raw.step(1 / 120, 120)
          const b = raw.B, p = b.pose, t = b.act.t, options = { yaw: b.yaw, head: 1.5 - .35 * Math.max(0, -Math.cos((p.rot || 0) * Math.PI / 180)) }
          rig.pose(b.kk, bare(p), options); const origins = originState()
          rig.pose(b.kk, p, options); assert.deepEqual(originState(), origins)
          for (let side = 0; side < 2; side++) {
            const q = geometry.bones.get('Wrist' + (side ? 'R' : 'L')).getWorldQuaternion(new T.Quaternion())
            if (priorQ[side]) {
              const step = priorQ[side].angleTo(q)
              if (step > row.maxWristStep) { row.maxWristStep = step; row.maxWristAt = { t, side } }
            }
            priorQ[side] = q
          }
          const fy = Math.max(...b.kk.legs.flatMap(leg => [leg.heel[1], leg.toe[1]])), scale = raw.tools.S * b.scale
          rig.place(b.x, b.y + fy * scale, fy, scale, [1 + b.sq * .2, 1 - b.sq * .2], b.yaw)
          const hands = geometry.read()
          for (const rec of f.props) {
            if (rec.state.done || b.act.name !== id) { rig.prop(rec.name, null); continue }
            const params = rec.update(rec.state, b.kk)
            rig.prop(rec.name, params)
            if (!params) continue
            const root = roots.get(rec.name); root.updateMatrixWorld(true)
            if (params.fade > .001 && params.handContact?.placed) {
              if (id === 'traceFlow') {
                const tip = root.localToWorld(new T.Vector3(0, 0, 16 * Buddy3D.U)),
                  beam = nodes().find(node => node.tagName === 'PATH' && node.getAttribute('stroke') === '#248655'),
                  start = beam.getAttribute('d').match(/^M([^ ]+) ([^L]+)/).slice(1).map(Number)
                assert.ok(Math.hypot(start[0] - tip.x, start[1] + tip.y) < 1e-8, 'SVG-луч начинается на actual-tip в том же frame')
              } else {
                const links = nodes().filter(node => node.getAttribute('data-story-projection-link') != null),
                  index = rec.name === 'contextPanel1' ? 1 : 0, origin = root.getWorldPosition(new T.Vector3()),
                  start = links[index].getAttribute('d').match(/^M([^ ]+) ([^Q]+)/).slice(1).map(Number)
                assert.ok(Math.hypot(start[0] - origin.x, start[1] + origin.y) < 1e-8, 'SVG-проекция исходит из actual panel в том же frame')
              }
              row.placedChecks++
              if (n % 60 === 0) {
                let calls = 0
                rig.prop(rec.name, { ...params, handContact: { ...params.handContact, amount: 0, placed: () => calls++ } })
                rig.prop(rec.name, { ...params, fade: 0, handContact: { ...params.handContact, placed: () => calls++ } })
                rig.propsOn(false)
                rig.prop(rec.name, { ...params, handContact: { ...params.handContact, placed: () => calls++ } })
                rig.propsOn(true)
                assert.equal(calls, 0, 'Zero, невидимый prop и выключенная группа не вызывают placed')
                rig.prop(rec.name, params); row.quietCallbackChecks += 3
              }
            }
            if (params.fade > .001) {
              const clearance = head.readPieces(root)
              if (clearance.gap < row.minHeadGap) { row.minHeadGap = clearance.gap; row.minHeadAt = { t, ...clearance } }
              row.headFrames++
            }
            const center = root.getWorldPosition(new T.Vector3()), prior = priorCenters.get(rec.name)
            if (prior) {
              const step = center.distanceTo(prior)
              if (step > row.maxPropStep) { row.maxPropStep = step; row.maxPropAt = { t, name: rec.name } }
              if (params.fade > .001 && priorFades.get(rec.name) > .001) row.maxVisiblePropStep = Math.max(row.maxVisiblePropStep, step)
            }
            priorCenters.set(rec.name, center); priorFades.set(rec.name, params.fade)
            if (params.fade < .999) continue
            const side = params.handContact?.side ?? (id === 'assembleList' ? ci : rec.name === 'contextPanel1' ? 1 - ci : ci), h = hands[side]
            if (id === 'traceFlow') {
              row.minFist = Math.min(row.minFist, p.handFist?.[ci] || 0)
              const suffix = side ? 'R' : 'L', a = geometry.bones.get('Middle1' + suffix).getWorldPosition(new T.Vector3()),
                grip = geometry.bones.get('Middle2' + suffix).getWorldPosition(new T.Vector3()).add(a).multiplyScalar(.5),
                shaftCenter = root.localToWorld(new T.Vector3(0, 0, 0))
              row.maxGripOffset = Math.max(row.maxGripOffset, shaftCenter.distanceTo(grip))
              if (n % 60 === 0) for (const digit of ['Index', 'Middle', 'Ring', 'Pinky']) {
                let nearest = Infinity, minRadial = Infinity, maxRadial = -Infinity
                const points = []
                for (const ref of geometry.hands[side].vertices) {
                  const a = ref.mesh.geometry.attributes
                  let weight = 0
                  for (let j = 0; j < 4; j++) if (ref.mesh.skeleton.bones[a.skinIndex.getComponent(ref.index, j)].name.startsWith(digit)) weight += a.skinWeight.getComponent(ref.index, j)
                  if (weight < .5) continue
                  v.fromBufferAttribute(a.position, ref.index); ref.mesh.applyBoneTransform(ref.index, v); v.applyMatrix4(ref.mesh.matrixWorld)
                  points.push(v.clone()); root.worldToLocal(v)
                  if (v.z < -14 * Buddy3D.U || v.z > 12 * Buddy3D.U) continue
                  const radial = Math.hypot(v.x, v.y), gap = Math.abs(radial - 1.1 * Buddy3D.U) * Math.abs(root.getWorldScale(new T.Vector3()).x)
                  nearest = Math.min(nearest, gap); minRadial = Math.min(minRadial, radial / Buddy3D.U); maxRadial = Math.max(maxRadial, radial / Buddy3D.U)
                }
                const result = row.fingers[digit] ||= { checks: 0, maxNearestGap: 0, maxFiniteSurfaceGap: 0, minRadial: Infinity, maxRadial: -Infinity }
                result.checks++; result.maxNearestGap = Math.max(result.maxNearestGap, nearest)
                result.maxFiniteSurfaceGap = Math.max(result.maxFiniteSurfaceGap, meshDistance(T, points, [root.getObjectByName('stylus-shaft')]))
                result.minRadial = Math.min(result.minRadial, minRadial); result.maxRadial = Math.max(result.maxRadial, maxRadial)
              }
            } else {
              row.minNormal = Math.min(row.minNormal, h.normal.y)
              const meshes = solids.get(rec.name) || root.children.flatMap(half => half.children.filter(mesh => mesh.geometry && !/panel-body|panel-content/.test(mesh.name))),
                solid = vertices(meshes), low = Math.min(...solid.map(point => point.y)),
                palm = h.palm.reduce((a, b) => b.y > a.y ? b : a), gap = low - palm.y,
                finiteGap = Math.sqrt(Math.min(...solid.map(point => point.distanceToSquared(palm))))
              row.minSurfaceGap = Math.min(row.minSurfaceGap, gap); row.maxSurfaceGap = Math.max(row.maxSurfaceGap, gap)
              row.maxFiniteContactGap = Math.max(row.maxFiniteContactGap, finiteGap)
            }
            row.contactFrames++
          }
          row.frames++
          if (b.act.name === 'idle') break
        }
        row.final = raw.B.act.name; rows.push(row)
      } finally { f.close() }
    }
  } finally { globalThis.document = previous; rig?.dispose?.(); boot.close() }
  const report = { startedAtUTC, endedAtUTC: new Date().toISOString(), hz: 120,
    method: 'Node direct-call actual GLB skin+solid geometry. Не WebGL, FPS или GPU-time.',
    hashes: Object.fromEntries(['context-stories.js', 'context-story-props.js', 'vendor.js', 'runtime.js'].map(name =>
      [name, createHash('sha256').update(readFileSync(new URL('../../' + name, import.meta.url))).digest('hex')])), rows }
  if (process.env.BUDDY_CONTEXT_GRIP_REPORT) writeFileSync(process.env.BUDDY_CONTEXT_GRIP_REPORT, JSON.stringify(report, null, 2) + '\n')
  for (const row of rows) {
    const detail = JSON.stringify(row)
    assert.ok(row.contactFrames > 150, detail); assert.equal(row.final, 'idle', detail)
    if (row.id !== 'assembleList') assert.ok(row.placedChecks > 500 && row.quietCallbackChecks > 10, detail)
    if (row.id === 'traceFlow') {
      assert.ok(row.minFist > .6, 'Пальцы действительно согнуты вокруг рукояти. ' + detail)
      assert.ok(row.maxGripOffset < 1.5, 'Указка в полости согнутых пальцев у реальных фаланг. ' + detail)
      for (const digit of Object.values(row.fingers)) assert.ok(digit.checks > 10 && digit.maxFiniteSurfaceGap < .3 && digit.minRadial > .95,
        'Настоящий skin каждого из четырёх пальцев достигает конечной mesh-рукояти без глубокого пересечения. ' + detail)
    } else {
      assert.ok(row.minNormal > .98, 'Карточку поддерживает лицевая ладонь. ' + detail)
      assert.ok(row.minSurfaceGap >= -.05 && row.maxSurfaceGap < .2, 'Реальный нижний край касается skin ладони. ' + detail)
      assert.ok(row.maxFiniteContactGap < .2, 'Skin касается конечной поверхности нижней рейки. ' + detail)
    }
    assert.ok(row.maxWristStep < .5, 'Нет скачка кисти. ' + detail)
    if (row.id === 'assembleList') assert.ok(row.maxVisiblePropStep < .25, 'Видимая физическая карточка движется непрерывно в одной ладони. ' + detail)
    assert.ok(row.minHeadGap > .5, 'Каждая видимая твёрдая часть оставляет лицо открытым весь цикл. ' + detail)
  }
})

test('placed callbacks завершённой истории больше не меняют отсоединённые SVG', () => {
  for (const id of ['compareValues', 'quoteIdea', 'traceFlow']) {
    const f = storyFixture(id)
    try {
      f.start()
      for (let n = 0; n < 180; n++) f.raw.step(1 / 60, 60)
      const callbacks = f.props.map(rec => rec.update(rec.state, f.raw.B.kk)?.handContact?.placed).filter(Boolean),
        nodes = [], visit = node => { nodes.push(node); for (const child of node.children || []) visit(child) }
      visit(f.host); assert.ok(callbacks.length)
      f.player.reset()
      const before = nodes.map(node => JSON.stringify(node.attributes))
      for (const callback of callbacks) callback(900, 200, 2, 3)
      assert.deepEqual(nodes.map(node => JSON.stringify(node.attributes)), before)
      assert.ok(f.props.every(rec => rec.state.done), 'Завершённые props больше не попадут в render callback')
      const layers = nodes.filter(node => node.getAttribute('data-buddy-story-layer') != null)
      assert.equal(layers.length, 1); assert.equal(layers[0].parentNode, null)
    } finally { f.close() }
  }
})

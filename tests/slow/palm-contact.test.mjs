import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from '../support/runtime-fixture.mjs'
import { palmGeometry } from '../support/palm-geometry.mjs'
import { createRuntime } from '../../src/runtime.js'
import { resolveBrand } from '../../src/brand.js'

test('clap и handstand: реальные ладони сохраняют контакт и плавность в полном цикле120Hz', async () => {
  const startedAtUTC = new Date().toISOString(), f = runtimeFixture(), previous = document, context = new Proxy({}, { get: () => () => {} }), cases = []
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../../src/vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded; globalThis.document = previous
    const geometry = palmGeometry(rig, T), boneList = [...geometry.bones.values()], plain = p => { const q = { ...p }; delete q.handContact; delete q.handContactAmount; return q },
      boneState = () => boneList.map(b => [b.name, ...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()]),
      origins = () => ['UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'WristL', 'WristR'].map(name => geometry.bones.get(name).getWorldPosition(new T.Vector3()).toArray())
    // Подставляем настоящий риг только в pre-ground hook; DOM остаётся SVG-заглушкой, WebGL/FPS не заявляются.
    const hook = 'const supportRig = G3 && G3.rig;'
    assert.ok(createRuntime.toString().includes(hook))
    const factory = new Function('qaRig', 'resolveBrand', 'let instanceId = 0; return ' + createRuntime.toString().replace(hook, 'const supportRig = qaRig;'))(rig, resolveBrand)
    f.raw.destroy(); f.raw = factory({ deck: f.stage, host: f.host, autonomous: false, renderer: 'svg' })
    f.raw.manual(true); f.raw.seed(14); f.raw.progress(1); f.raw.rescan(); f.raw.reset()
    for (const id of ['clap', 'handstand', 'wave'].filter(id => !process.env.BUDDY_PALM_IDS || process.env.BUDDY_PALM_IDS.split(',').includes(id))) for (const face of [-1, 1]) {
      f.raw.reset(); Object.assign(f.raw.B, { face, cam: .4, yaw: face > 0 ? .4 * Math.PI / 2 : Math.PI - .4 * Math.PI / 2 }); f.raw.run([id])
      const row = { id, face, frames: 0, contactFrames: 0, minPalmGap: Infinity, maxClosedGap: 0, maxClosedSkinGap: 0, maxContactVertexGap: 0, minSkinGap: Infinity, minFloorGap: Infinity, minBodyFloorGap: Infinity, maxHoldGap: 0, minDown: 1, maxWristStep: 0, maxWeightStep: 0, zeroChecks: 0, noOriginMovement: true }
      let prior = null, priorWeight = 0, priorX = null, priorSupport = null
      row.maxXStep = 0; row.supportTransfers = []
      const callsAtStart = rig.handContactMetrics.calls
      for (let n = 0; n < 1000; n++) {
        f.raw.step(1 / 120, 120)
        const b = f.raw.B, p = b.pose, t = b.act.t, weight = p.handContactAmount || 0,
          options = { yaw: b.yaw, head: 1.5 - .35 * Math.max(0, -Math.cos(p.rot * Math.PI / 180)) }
        row.frames++; row.maxWeightStep = Math.max(row.maxWeightStep, Math.abs(weight - priorWeight)); priorWeight = weight
        if (priorX != null) row.maxXStep = Math.max(row.maxXStep, Math.abs(b.x - priorX))
        if (id === 'handstand' && priorSupport !== b.footId) row.supportTransfers.push({ t, from: priorSupport, to: b.footId, xStep: priorX == null ? 0 : b.x - priorX })
        priorX = b.x; priorSupport = b.footId
        // Same upper limbs and origins, before placing the actor. The contact channel moves Wrist orientation only.
        rig.pose(b.kk, plain(p), options); const baselineOrigins = origins()
        rig.pose(b.kk, p, options); assert.deepEqual(origins(), baselineOrigins)
        const now = ['L', 'R'].map(s => geometry.bones.get('Wrist' + s).getWorldQuaternion(new T.Quaternion()))
        if (prior) for (let i = 0; i < 2; i++) row.maxWristStep = Math.max(row.maxWristStep, prior[i].angleTo(now[i]))
        prior = now
        if (n % 40 === 0) {
          rig.pose(b.kk, plain(p), options); const absent = boneState()
          rig.pose(b.kk, { ...plain(p), handContact: 'floor', handContactAmount: 0 }, options); assert.deepEqual(boneState(), absent)
          if (id === 'wave') { rig.pose(b.kk, p, options); assert.deepEqual(boneState(), absent) }
          row.zeroChecks++
        }
        rig.pose(b.kk, p, options); rig.place(b.x, b.y, 0, f.raw.tools.S * b.scale, [1, 1], b.yaw)
        const h = geometry.read(), line = h[1].center.clone().sub(h[0].center).normalize(),
          gap = Math.min(...h[1].palm.map(v => v.dot(line))) - Math.max(...h[0].palm.map(v => v.dot(line))),
          skinGap = Math.min(...h[1].skin.map(v => v.dot(line))) - Math.max(...h[0].skin.map(v => v.dot(line)))
        if (id === 'clap' && b.act.name === id && t > .3 && t < 2.1) {
          row.minPalmGap = Math.min(row.minPalmGap, gap); row.minSkinGap = Math.min(row.minSkinGap, skinGap)
          const o = (1 + Math.sin(t * 2 * Math.PI * 3.4)) / 2
          if (o < .002) {
            row.contactFrames++; row.maxClosedGap = Math.max(row.maxClosedGap, gap); row.maxClosedSkinGap = Math.max(row.maxClosedSkinGap, skinGap)
            let nearest = Infinity
            for (const a of h[0].skin) for (const b of h[1].skin) nearest = Math.min(nearest, a.distanceToSquared(b))
            row.maxContactVertexGap = Math.max(row.maxContactVertexGap, Math.sqrt(nearest))
            assert.ok(h[0].normal.dot(h[1].normal) < -.99)
          }
        }
        if (id === 'handstand' && b.act.name === id) {
          if (process.env.BUDDY_PALM_BODY !== '0') {
            const body = geometry.bodyFloor()
            if (body.gap < row.minBodyFloorGap) { row.minBodyFloorGap = body.gap; row.minBodyAt = { t, rot: p.rot, mesh: body.mesh } }
          }
          const floorGap = h.map(a => Math.min(...a.skin.map(v => v.y)) + 700)
          if (Math.min(...floorGap) < row.minFloorGap) { row.minFloorGap = Math.min(...floorGap); row.minFloorAt = { t, weight, rot: p.rot, floorGap } }
          if (t >= 2.4 && t <= 3.9) {
            row.contactFrames++; row.maxHoldGap = Math.max(row.maxHoldGap, ...floorGap)
            row.minDown = Math.min(row.minDown, ...h.map(a => -a.normal.y))
          }
        }
        if (b.act.name === 'idle') break
      }
      row.final = f.raw.B.act.name; row.finalContact = f.raw.B.pose.handContact || null; row.supportCalls = rig.handContactMetrics.calls - callsAtStart; cases.push(row)
    }
  } finally { globalThis.document = previous; f.raw.destroy(); f.close() }
  if (process.env.BUDDY_PALM_REPORT) writeFileSync(process.env.BUDDY_PALM_REPORT, JSON.stringify({ startedAtUTC, endedAtUTC: new Date().toISOString(), cases }, null, 2) + '\n')
  for (const c of cases) {
    assert.equal(c.final, 'idle'); assert.equal(c.finalContact, null); assert.ok(c.zeroChecks > 3)
    if (c.id === 'handstand') assert.ok(c.supportCalls > 700); else assert.equal(c.supportCalls, 0)
    assert.ok(c.maxWristStep < .5, JSON.stringify(c))
    if (c.id === 'clap') { assert.ok(c.contactFrames >= 6); assert.ok(c.minSkinGap >= -.02 && c.maxClosedSkinGap <= .1 && c.maxContactVertexGap <= .5, JSON.stringify(c)) }
    if (c.id === 'handstand') { assert.ok(c.contactFrames >= 170); assert.ok(c.minDown > .99); assert.ok(c.minFloorGap >= -.02 && c.maxHoldGap <= .45, JSON.stringify(c)); if (process.env.BUDDY_PALM_BODY !== '0') assert.ok(c.minBodyFloorGap >= -.02, JSON.stringify(c)) }
  }
})

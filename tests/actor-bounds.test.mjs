import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import * as runtime from '../src/runtime.js'
import { resolveBrand } from '../src/brand.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

const origins = JSON.parse(await readFile(new URL('./support/fixtures/actor-framing-poses.json', import.meta.url), 'utf8'))
assert.equal(origins.cases.length, 4, 'Четыре исходные позы leap/flip обеих сторон')
assert.equal(new Set(origins.cases.map(p => p.id)).size, 4)
let setupPromise
const harness = () => setupPromise ??= setup()
after(async () => { const f = await setupPromise?.catch(() => null); f?.close() })

async function setup() {
  const f = runtimeFixture(), saved = document, context = new Proxy({ measureText: text => ({ width: text.length * 20 }) }, { get: (o, k) => o[k] ?? (() => {}) })
  let raw
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../src/vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded; globalThis.document = saved; f.raw.destroy()
    const marker = 'rescan, B, W, MAKE, LEVELS, leap, fall, jumpTo, begin, plan,'
    assert.ok(runtime.createRuntime.toString().includes(marker), 'Тестовый доступ к актуальному private actorEnvelope')
    // Только test-export существующей функции; её код/формула не переписываются.
    const factory = new Function('resolveBrand', ...Object.keys(runtime), 'let instanceId=0; return ' + runtime.createRuntime.toString()
      .replace(marker, 'actorEnvelope, ' + marker))(resolveBrand, ...Object.values(runtime)), host = new f.host.constructor('div')
    f.stage.appendChild(host); raw = factory({ deck: f.stage, host, autonomous: false, renderer: 'svg' })
    raw.manual(true); raw.progress(1); raw.rescan()
    const meshes = [], point = new T.Vector3()
    let totalVertices = 0, headVertices = 0
    rig.root.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes.position) return
      meshes.push(o); totalVertices += o.geometry.attributes.position.count
      if (!o.isSkinnedMesh) return
      const a = o.geometry.attributes
      for (let i = 0; i < a.position.count; i++) {
        let weight = 0
        for (let j = 0; j < 4; j++) if (o.skeleton.bones[a.skinIndex.getComponent(i, j)].name === 'Head') weight += a.skinWeight.getComponent(i, j)
        if (weight >= .5) headVertices++
      }
    })
    assert.ok(meshes.length >= 2 && totalVertices > 1000 && headVertices > 100, 'Непустые настоящие тело, голова и волосы актуального asset')
    function measure(label, p, { x = 640, y = 450, yaw = Math.PI / 2, scale = 1, squash = 0 } = {}) {
      const k = raw.tools.solve(p, Math.cos(yaw) >= 0 ? 1 : -1, Math.sin(yaw)),
        fy = Math.max(...k.legs.flatMap(g => [g.heel[1], g.toe[1]])), sc = raw.tools.S * scale,
        sq = [1 - squash * .8 * .55, 1 + squash * .8], head = 1.5 - .35 * Math.max(0, -Math.cos((p.rot || 0) * Math.PI / 180)),
        bounds = raw.actorEnvelope(k, p, x, y, yaw, sc, sq), actual = [Infinity, Infinity, -Infinity, -Infinity]
      rig.pose(k, p, { yaw, head }); rig.place(x, y + fy * sc, fy, sc, sq, yaw); rig.root.updateMatrixWorld(true)
      let vertices = 0
      for (const mesh of meshes) {
        let visible = true
        for (let parent = mesh; parent; parent = parent.parent) if (!parent.visible) visible = false
        if (!visible) continue
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          point.fromBufferAttribute(mesh.geometry.attributes.position, i)
          if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, point)
          point.applyMatrix4(mesh.matrixWorld); const py = -point.y
          assert.ok(Number.isFinite(point.x) && Number.isFinite(py), label + ': конечные actual vertices')
          actual[0] = Math.min(actual[0], point.x); actual[1] = Math.min(actual[1], py)
          actual[2] = Math.max(actual[2], point.x); actual[3] = Math.max(actual[3], py); vertices++
        }
      }
      assert.ok(vertices > 1000, 'Проверено настоящее видимое тело')
      return { label, bounds, actual, vertices,
        excess: [bounds[0] - actual[0], bounds[1] - actual[1], actual[2] - bounds[2], actual[3] - bounds[3]] }
    }
    return { raw, measure, close() { raw.destroy(); f.close() } }
  } catch (error) { globalThis.document = saved; raw?.destroy(); f.close(); throw error }
}

function contained(rows) {
  const failed = rows.filter(r => Math.max(...r.excess) > .05)
  assert.deepEqual(failed.slice(0, 8), [], 'Все оси actor bounds содержат actual GLB vertices, включая волосы, пальцы и обувь')
}

test('четыре исходные leap/flip позы: весь actual asset входит в actor bounds', async () => {
  const f = await harness()
  contained(origins.cases.map(({ id, pose, ...placement }) => f.measure(id, pose, placement)))
})

test('whole actor: 120 простых pose/yaw/rot/scale/squash комбинаций', async () => {
  const f = await harness(), poses = [{}, { hp: -45 }, { hp: 45 }, { hy: -70 }, { hy: 70 }, { tl: 30, ts: 18, hp: -20, hy: 45 }], rows = []
  let i = 0
  for (const settings of poses) for (const rot of [0, 90, 180, 270]) for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4, Math.PI]) {
    rows.push(f.measure('broad:' + i, f.raw.tools.pose({ ...settings, rot }), {
      yaw, scale: [.5, 1, 5.105423930726611][i % 3], squash: [-.2, 0, .2][i++ % 3] }))
  }
  assert.equal(rows.length, 120); contained(rows)
})

test('whole actor: 120 arm/open/fist/facing комбинаций', async () => {
  const f = await harness(), arms = [{ sf: [0, 0], sa: [90, 90], ef: [0, 0] }, { sf: [90, 90], ef: [0, 0] },
      { sf: [160, 150], ef: [10, 12], sa: [24, 24] }],
    hands = [{}, { handOpen: [1, 1] }, { handFist: [1, 1] }, { handOpen: [1, 1], handFacing: [1, 1] }], rows = []
  let i = 0
  for (const arm of arms) for (const hand of hands) for (const rot of [0, 180]) for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4, Math.PI])
    rows.push(f.measure('hand:' + i++, f.raw.tools.pose({ ...arm, ...hand, rot }), { yaw }))
  assert.equal(rows.length, 120); contained(rows)
})

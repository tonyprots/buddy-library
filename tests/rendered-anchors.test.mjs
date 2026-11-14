import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'
import { shaderSurface } from './support/render-origin-geometry.mjs'

const target = () => ({ eyesW: [[0, 0], [0, 0]], handsW: [[0, 0], [0, 0]], eyeOn: [true, true] })

test('WebGL: eye origin совпадает со skin-маской, legacy hand anchors стабильны', async () => {
  const f = runtimeFixture(), previous = document, context = new Proxy({}, { get: () => () => {} }), rows = []
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import(process.env.BUDDY_ANCHOR_VENDOR || '../vendor.js'),
      rig = Buddy3D.create({ outline: false }), other = Buddy3D.create({ outline: false })
    await Promise.all([rig.loaded, other.loaded])
    globalThis.document = previous
    assert.equal(typeof rig.renderAnchors, 'function', 'У настоящего рига есть мостик экранных привязок')
    const bones = new Map(), out = target(), independent = target(), identity = out.eyesW[0]
    rig.root.traverse(o => { if (o.isBone) bones.set(o.name, o) })
    const eyeSurface = rig.face.uEyeC.value.map(center => shaderSurface(rig, T, center)), errors = []
    for (const face of [-1, 1]) for (const [head, scale, squash] of [[1, .4, [1, 1]], [1.5, 1, [.8, 1.2]], [1.15, 3.4, [1.1, .9]]]) {
      const p = f.raw.tools.pose({ hp: 24, hy: -31, tl: 17, ts: 8, sf: [90, 60], ef: [35, 70] }),
        yaw = face > 0 ? .45 : Math.PI - .45,
        k = f.raw.tools.solve(p, face, Math.sin(yaw))
      rig.pose(k, p, { head, yaw }); rig.place(360, 470, 30, scale, squash, yaw)
      assert.equal(rig.renderAnchors(out), true)
      for (let i = 0; i < 2; i++) {
        const eye = eyeSurface[i](), suffix = i ? 'R' : 'L',
          wp = name => bones.get(name + suffix).getWorldPosition(new T.Vector3()),
          palm = wp('Index1').add(wp('Pinky1')).multiplyScalar(.25).add(wp('Wrist').multiplyScalar(.5))
        errors.push({ face, head, scale, squash, eye: i, error: Math.hypot(out.eyesW[i][0] - eye.x, out.eyesW[i][1] + eye.y) })
        assert.ok(Math.hypot(out.handsW[i][0] - palm.x, out.handsW[i][1] + palm.y) < 1e-8)
      }
      const snapshot = structuredClone(out)
      other.pose(k, p, { head: 2 }); other.place(950, 100, 30, 2, [1, 1], yaw + 1)
      other.renderAnchors(independent); rig.renderAnchors(out)
      assert.deepEqual(out, snapshot, 'Второй экземпляр не меняет точки первого')
      assert.equal(out.eyesW[0], identity, 'Массивы результата переиспользуются')
      rows.push({ face, head, scale, squash, anchors: structuredClone(out) })
    }
    if (process.env.BUDDY_EYE_GEOMETRY_REPORT) writeFileSync(process.env.BUDDY_EYE_GEOMETRY_REPORT, JSON.stringify(errors, null, 2) + '\n')
    assert.ok(errors.every(row => row.error < 1e-8), 'Eye origin совпадает с actual skinned shader-mask, а не Head-bone proxy: ' + JSON.stringify(errors))
  } finally { globalThis.document = previous; f.close() }
  if (process.env.BUDDY_ANCHOR_REPORT) writeFileSync(process.env.BUDDY_ANCHOR_REPORT, JSON.stringify(rows, null, 2) + '\n')
})

test('SVG fallback и laser/lightning используют точки текущего кадра после render', () => {
  for (const id of ['laser', 'lightning']) for (const face of [-1, 1]) {
    const f = runtimeFixture(face)
    try {
      f.raw.run([id])
      const nodes = []
      const visit = node => { nodes.push(node); for (const child of node.children || []) visit(child) }
      for (let i = 0; i < 190; i++) {
        f.raw.step(1 / 120, 120)
        if (f.raw.B.act.t < 1.15 || f.raw.B.act.t > 1.9) continue
        nodes.length = 0; visit(f.host)
        const lines = nodes.filter(n => n.tagName === (id === 'laser' ? 'LINE' : 'POLYLINE') &&
          n.getAttribute('stroke') === (id === 'laser' ? '#FF3B1F' : '#FFC400'))
        assert.ok(lines.length, 'FX наблюдается')
        if (id === 'lightning') {
          const h = f.raw.tools.hands(), start = lines[0].getAttribute('points')?.split(' ')[0].split(',').map(Number)
          if (!start) continue
          assert.ok(Math.hypot(start[0] - (h[0][0] + h[1][0]) / 2, start[1] - (h[0][1] + h[1][1]) / 2) < .015,
            'Источник молнии следует текущей середине ладоней')
        } else for (const line of lines) {
          const eye = [+line.getAttribute('x1'), +line.getAttribute('y1')]
          assert.ok(eye.every(Number.isFinite), 'SVG fallback сохраняет настоящие конечные координаты')
        }
      }
    } finally { f.close() }
  }
})

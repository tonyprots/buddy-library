import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import * as runtimeModule from '../runtime.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'
import { palmGeometry } from './support/palm-geometry.mjs'

function fixture(id, face) {
  const f = runtimeFixture(face), Node = f.host.constructor, card = new Node('div'), icon = new Node('svg'), style = getComputedStyle,
    left = id === 'finale' ? (face > 0 ? 800 : 280) : (face > 0 ? 790 : 290), top = id === 'finale' ? 300 : 430,
    rect = (x, y, width, height) => ({ left: x, top: y, right: x + width, bottom: y + height, width, height })
  card.closest = icon.closest = () => null
  card.hasAttribute = name => card.getAttribute(name) !== null
  card.getBoundingClientRect = () => rect(left, top, 200, id === 'finale' ? 230 : 200)
  icon.getBoundingClientRect = () => rect(face > 0 ? 920 : 312, 340, 48, 48)
  icon.cloneNode = () => new Node('svg')
  f.slide.querySelectorAll = selector => selector === '*' ? (id === 'construct' ? [icon] : [card])
    : selector === 'svg, img' ? [icon] : []
  if (id === 'finale') {
    card.setAttribute('data-buddy-like', '')
    f.slide.querySelector = selector => selector === '[data-buddy-fly]' ? card : null
  }
  globalThis.getComputedStyle = node => node === card
    ? { backgroundColor: 'rgb(210,220,240)', borderTopWidth: '0', borderTopLeftRadius: '18' } : style(node)
  f.raw.rescan(); f.raw.B.anchor = null
  return f
}

test('legacy construct/grapple/finale/parachute используют настоящую сомкнутую кожу пальцев и большой палец', async () => {
  const startedAtUTC = new Date().toISOString(), previous = globalThis.document, context = new Proxy({}, { get: () => () => {} }), rows = []
  let rig
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../vendor.js')
    rig = Buddy3D.create({ outline: false }); await rig.loaded
    globalThis.document = previous
    const geometry = palmGeometry(rig, T), anchors = { eyesW: [[0, 0], [0, 0]], handsW: [[0, 0], [0, 0]], eyeOn: [true, true] },
      put = (b, unit) => {
        const k = b.kk, fy = Math.max(...k.legs.flatMap(leg => [leg.heel[1], leg.toe[1]])), scale = b.scale * unit
        rig.pose(k, b.pose, { head: 1.5, yaw: b.yaw }); rig.place(b.x, b.y + fy * scale, fy, scale, [1, 1], b.yaw)
        rig.renderAnchors(anchors)
      }, points = refs => refs.map(ref => {
        const p = new T.Vector3().fromBufferAttribute(ref.mesh.geometry.attributes.position, ref.index)
        ref.mesh.applyBoneTransform(ref.index, p); return p.applyMatrix4(ref.mesh.matrixWorld)
      }), refsFor = (side, pattern) => geometry.hands[side].vertices.filter(ref => {
        const a = ref.mesh.geometry.attributes
        let weight = 0
        for (let i = 0; i < 4; i++) if (pattern.test(ref.mesh.skeleton.bones[a.skinIndex.getComponent(ref.index, i)].name))
          weight += a.skinWeight.getComponent(ref.index, i)
        return weight >= .75
      })
    for (const id of ['construct', 'grapple', 'finale', 'parachute']) for (const face of [-1, 1]) {
      const f = fixture(id, face)
      try {
        if (id === 'parachute') { f.raw.B.forceChute = true; f.raw.drop(440) }
        else assert.equal(f.raw.run([id]), true, id + ': настоящий номер запущен')
        f.raw.step(id === 'finale' ? 4.2 : 1.1, 60)
        const b = f.raw.B, side = b.face > 0 ? 0 : 1, suffix = side ? 'R' : 'L'
        assert.equal(b.act.name, id === 'parachute' ? 'chute' : id)
        put(b, f.raw.tools.S)
        const fingerRefs = ['Index', 'Middle', 'Ring', 'Pinky'].map(name => refsFor(side, new RegExp('^' + name + '[123]' + suffix + '$'))),
          actual = fingerRefs.map(points), thumbRefs = refsFor(side, new RegExp('^Thumb[123]' + suffix + '$')),
          actualThumb = points(thumbRefs), actualSkin = geometry.read()[side].skin,
          gripPoint = [0, 0], gripAvailable = runtimeModule.legacyHandPoint?.(rig, side, gripPoint) || false,
          expectedPose = { ...b.pose, handOpen: [0, 0], handFist: side ? [0, 1] : [1, 0] }
        if (id === 'finale') expectedPose.handShape = { kind: 'thumbsUp', side, amount: 1 }
        put({ ...b, pose: expectedPose }, f.raw.tools.S)
        const expected = fingerRefs.map(points), expectedThumb = points(thumbRefs),
          skinErrors = actual.map((vertices, digit) => Math.max(...vertices.map((v, i) => v.distanceTo(expected[digit][i])))),
          thumbError = Math.max(...actualThumb.map((v, i) => v.distanceTo(expectedThumb[i]))),
          thumbAboveFingers = Math.max(...actualThumb.map(p => p.y)) - Math.max(...actual.flat().map(p => p.y)),
          skinBounds = [Math.min(...actualSkin.map(p => p.x)), Math.min(...actualSkin.map(p => -p.y)),
            Math.max(...actualSkin.map(p => p.x)), Math.max(...actualSkin.map(p => -p.y))]
        rows.push({ id, requestedFace: face, actualFace: b.face, side, time: b.act.t, fingerSkinVertices: fingerRefs.map(refs => refs.length),
          maxFingerSkinErrorFromClosed: skinErrors, thumbSkinError: thumbError, thumbAboveFingers, gripAvailable,
          gripPoint: gripAvailable ? gripPoint : null, skinBounds,
          fist: b.pose.handFist || null, shape: b.pose.handShape || null })
      } finally { f.close() }
    }
  } finally { previous === undefined ? delete globalThis.document : globalThis.document = previous }
  if (process.env.BUDDY_LEGACY_HAND_REPORT) writeFileSync(process.env.BUDDY_LEGACY_HAND_REPORT, JSON.stringify({ startedAtUTC,
    finishedAtUTC: new Date().toISOString(), runtimeSha: createHash('sha256').update(readFileSync(new URL('../runtime.js', import.meta.url))).digest('hex'),
    vendorSha: createHash('sha256').update(readFileSync(new URL('../vendor.js', import.meta.url))).digest('hex'), rows }, null, 2) + '\n')
  for (const row of rows) {
    assert.ok(row.fingerSkinVertices.every(count => count > 20), 'Измерены настоящие skin vertices всех четырёх пальцев')
    assert.ok(row.maxFingerSkinErrorFromClosed.every(error => error < .05), 'Четыре пальца сомкнуты на настоящем GLB: ' + JSON.stringify(row))
    assert.ok(row.thumbSkinError < .05, 'Настоящая кожа большого пальца соответствует кулаку или thumbs-up: ' + JSON.stringify(row))
    if (row.id === 'finale') {
      assert.ok(row.thumbSkinError < .05 && row.thumbAboveFingers > .15, 'Большой палец выделен вверх над сомкнутыми пальцами: ' + JSON.stringify(row))
    } else {
      assert.ok(row.gripAvailable, 'Есть posed/placed привязка к пальцевой части, а не к запястью')
      assert.ok(row.gripPoint[0] >= row.skinBounds[0] - .4 && row.gripPoint[0] <= row.skinBounds[2] + .4
        && row.gripPoint[1] >= row.skinBounds[1] - .4 && row.gripPoint[1] <= row.skinBounds[3] + .4,
      'Центр кольца/рукояти лежит в проекции сомкнутой кожи кисти: ' + JSON.stringify(row))
    }
  }
})

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { createAbilityPlayer } from '../../src/new-abilities.js'
import { runtimeFixture } from '../support/runtime-fixture.mjs'
import { palmGeometry } from '../support/palm-geometry.mjs'

test('приветствие оставляет глаза открытыми, зов держит ладони ниже глаз возле рта', async () => {
  const fixture = runtimeFixture(), { raw } = fixture, previous = document,
    context = new Proxy({}, { get: () => () => {} }), cases = []
  let player
  try {
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../../src/vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded
    globalThis.document = previous
    const geometry = palmGeometry(rig, T), anchors = { eyesW: [[0, 0], [0, 0]], handsW: [[0, 0], [0, 0]], eyeOn: [true, true] }
    raw.tools.registerPropBuilders = () => 1
    player = createAbilityPlayer(raw, { host: fixture.host })
    for (const id of ['salute', 'sonicPulse']) for (const face of [-1, 1])
      for (const time of id === 'salute' ? [1, 1.3, 1.6, 1.8, 2, 2.125, 2.2, 2.4, 2.6, 2.8] : [1.25, 1.8, 2.3]) {
        raw.reset(); raw.seed(14)
        Object.assign(raw.B, { face, yaw: face > 0 ? .6 * Math.PI / 2 : Math.PI - .6 * Math.PI / 2, yawV: 0 })
        raw.begin(player.create(id)); raw.step(time, 120)
        const b = raw.B, k = b.kk, scale = raw.tools.S * b.scale,
          fy = Math.max(...k.legs.flatMap(leg => [leg.heel[1], leg.toe[1]]))
        rig.pose(k, b.pose, { head: 1.5, yaw: b.yaw })
        rig.place(b.x, b.y + fy * scale, fy, scale, [1, 1], b.yaw); rig.renderAnchors(anchors)
        const palms = geometry.read(), visibleEyes = anchors.eyesW.filter((_, i) => anchors.eyeOn[i]),
          eyeX = visibleEyes.reduce((sum, p) => sum + p[0], 0) / visibleEyes.length,
          eyeY = visibleEyes.reduce((sum, p) => sum + p[1], 0) / visibleEyes.length,
          bounds = palms.map(hand => [Math.min(...hand.palm.map(p => p.x)), Math.min(...hand.palm.map(p => -p.y)),
            Math.max(...hand.palm.map(p => p.x)), Math.max(...hand.palm.map(p => -p.y))]),
          skinBounds = palms.map(hand => [Math.min(...hand.skin.map(p => p.x)), Math.min(...hand.skin.map(p => -p.y)),
            Math.max(...hand.skin.map(p => p.x)), Math.max(...hand.skin.map(p => -p.y))]),
          ci = face > 0 ? 0 : 1, palm = palms[ci], leading = skinBounds[ci],
          eyeCovered = leading[0] <= Math.max(...visibleEyes.map(p => p[0])) + .3
            && leading[2] >= Math.min(...visibleEyes.map(p => p[0])) - .3
            && leading[1] <= eyeY + 3 && leading[3] >= eyeY - 5.5
        cases.push({ id, face, time, eyes: structuredClone(anchors.eyesW), visibleEyes: structuredClone(visibleEyes), bounds, skinBounds,
          eyeCovered, leadingPalmOffset: [palm.center.x - eyeX, -palm.center.y - eyeY],
          palmVerticalOffsets: palms.map(hand => -hand.center.y - eyeY) })
      }
    if (process.env.BUDDY_GREETING_REPORT)
      writeFileSync(process.env.BUDDY_GREETING_REPORT, JSON.stringify({ cases }, null, 2) + '\n', { flag: 'wx' })
    assert.deepEqual(cases.filter(row => row.id === 'salute' && row.eyeCovered), [], 'Приветствующая ладонь не закрывает видимые глаза')
    assert.deepEqual(cases.filter(row => row.id === 'sonicPulse' && row.palmVerticalOffsets.some(y => y < .3)), [],
      'При зове центры обеих ладоней ниже глаз, возле рта')
  } finally { globalThis.document = previous; player?.destroy(); fixture.close() }
})

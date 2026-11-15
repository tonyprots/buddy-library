import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from '../support/runtime-fixture.mjs'

test('shadowbox плавно сжимает настоящие пальцы обеих рук, не меняя запястья, и отпускает их к idle', async () => {
  const rows = []
  for (const face of [-1, 1]) {
    const f = runtimeFixture(face), previousDocument = document,
      context = new Proxy({}, { get: () => () => {} })
    try {
      globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
      const { Buddy3D } = await import('../../src/vendor.js'), rig = Buddy3D.create({ outline: false })
      await rig.loaded
      globalThis.document = previousDocument
      const bones = new Map()
      rig.root.traverse(o => { if (o.isBone) bones.set(o.name, o) })
      f.raw.run(['shadowbox'])
      let maxAmountStep = 0, previous = [0, 0], activeSamples = 0, testedBones = 0
      for (let n = 0; n < 450; n++) {
        f.raw.step(1 / 120, 120)
        const b = f.raw.B, p = b.pose, amounts = p.handFist || [0, 0], rest = { ...p }
        delete rest.handFist
        for (const side of [0, 1]) maxAmountStep = Math.max(maxAmountStep, Math.abs(amounts[side] - previous[side]))
        previous = amounts
        if (b.act.name === 'shadowbox' && b.act.t > .4 && b.act.t < 2.7) {
          activeSamples++
          assert.deepEqual(amounts, [1, 1], 'Во время джебов обе кисти собраны в кулак')
          rig.pose(b.kk, rest)
          const baseline = new Map([...bones].map(([name, bone]) => [name, bone.quaternion.clone()]))
          rig.pose(b.kk, p)
          for (const suffix of ['L', 'R']) {
            for (const name of ['UpperArm', 'LowerArm', 'Wrist'])
              assert.deepEqual(bones.get(name + suffix).quaternion.toArray(), baseline.get(name + suffix).toArray(),
                'Канал пальцев не меняет плечо, локоть или запястье: ' + name + suffix)
            for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) for (const phalanx of [1, 2, 3]) {
              const name = finger + phalanx + suffix, angle = bones.get(name).quaternion.angleTo(baseline.get(name))
              assert.ok(angle > .3, 'Настоящая фаланга согнута: ' + name)
              testedBones++
            }
            const name = 'Thumb2' + suffix
            assert.ok(bones.get(name).quaternion.angleTo(baseline.get(name)) > .45, 'Большой палец закрывает кулак')
          }
        }
      }
      rows.push({ face, activeSamples, testedBones, maxAmountStep, finalAction: f.raw.B.act.name,
        finalFist: f.raw.B.pose.handFist || [0, 0] })
      assert.ok(activeSamples > 200 && testedBones > 4800)
      assert.ok(maxAmountStep < .05, 'Нет однокадрового схлопывания пальцев')
      assert.equal(f.raw.B.act.name, 'idle')
      assert.deepEqual(f.raw.B.pose.handFist || [0, 0], [0, 0])
    } finally { globalThis.document = previousDocument; f.close() }
  }
  if (process.env.SHADOWBOX_FIST_REPORT) writeFileSync(process.env.SHADOWBOX_FIST_REPORT, JSON.stringify(rows, null, 2) + '\n')
})

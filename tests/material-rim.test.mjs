import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

test('Только синий худи получает rim цвета ткани; остальные материалы сохраняют прежний тёплый rim', async () => {
  const f = runtimeFixture(), previous = document, context = new Proxy({}, { get: () => () => {} })
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import(process.env.BUDDY_RIM_VENDOR || '../src/vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded
    globalThis.document = previous
    const materials = new Set(), warm = new T.Color('#FFE7D2').multiplyScalar(.32), blue = new T.Color('#1340E0')
    rig.root.traverse(o => { for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.uniforms?.uBase) materials.add(m) })
    let hood = 0, preserved = 0
    for (const m of materials) {
      const u = m.uniforms, isHood = u.uBase.value.equals(blue)
      assert.equal(u.uClothRim?.value, isHood ? 1 : 0)
      assert.deepEqual(u.uRimCol.value.toArray(), warm.toArray(), 'Прежний тёплый цвет общего rim не меняется')
      assert.ok(m.fragmentShader.includes('mix(uRimCol, materialRim, uClothRim)'))
      assert.ok(m.fragmentShader.includes('.32 * (.85 * base + .15 * vec3(.08))'))
      if (isHood) hood++
      else preserved++
    }
    assert.ok(hood > 0, 'Проверены настоящие материалы худи')
    assert.ok(preserved >= 5, 'Проверены остальные настоящие материалы персонажа')
    for (const m of materials) m.dispose()
  } finally { globalThis.document = previous; f.close() }
})

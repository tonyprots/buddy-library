import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStoryPropBuilders } from '../context-story-props.js'

async function fixture(run) {
  const previous = globalThis.document
  globalThis.document = { createElement() {
    const drawn = [], context = new Proxy({ measureText: text => ({ width: [...text].length * 40 }),
      fillText: text => drawn.push(text) }, { get: (target, key) => target[key] ?? (() => {}) })
    return { width: 0, height: 0, drawn, getContext: () => context }
  } }
  try {
    const { Buddy3D, THREE: T } = await import('../vendor.js'), rig = Buddy3D.create({ outline: false }), roots = new Map()
    await rig.loaded
    assert.equal(rig.registerPropBuilders(kit => Object.fromEntries(Object.entries(createStoryPropBuilders(kit))
      .map(([name, factory]) => [name, () => { const prop = factory(); roots.set(name, prop.g); return prop }]))), 6)
    assert.equal(roots.size, 0, 'регистрация не создаёт ни геометрии, ни текстур')
    await run({ rig, roots, T, U: Buddy3D.U })
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

function inventory(roots) {
  const objects = new Set(), geometries = new Set(), materials = new Set(), textures = new Set()
  for (const root of roots.values()) root.traverse(object => {
    objects.add(object)
    if (object.geometry) {
      geometries.add(object.geometry)
      assert.ok(object.geometry.attributes.position.array.every(Number.isFinite))
    }
    if (object.material) {
      materials.add(object.material)
      if (object.material.map) textures.add(object.material.map)
    }
  })
  return { objects, geometries, materials, textures }
}

test('независимые физические карточки сохраняют точный текст и складываются настоящими половинами', async () => {
  await fixture(({ rig, roots, U }) => {
    const texts = ['−18% ошибок', '4,2× быстрее', 'Сначала проверим на примере.', 'Пример без придуманной галочки']
    for (const [i, text] of texts.entries()) rig.prop('contextPanel' + i,
      { at: [0, 0, 0], text, dir: [0, 0, 1], fade: .4 })
    const canvases = new Set()
    for (const [i, text] of texts.entries()) {
      const root = roots.get('contextPanel' + i), screens = []
      root.traverse(object => { if (object.name === 'panel-content') screens.push(object) })
      assert.equal(root.userData.text, text)
      assert.equal(screens.length, 2)
      assert.equal(screens[0].material.map.image, screens[1].material.map.image, 'две половины делят один canvas')
      assert.equal(screens[0].material.map.repeat.x, .5)
      assert.deepEqual(screens.map(screen => screen.material.map.offset.x), [0, .5])
      assert.equal(screens[0].material.map.image.drawn.join(''), text, 'переносы не сокращают и не заменяют источник')
      assert.ok(screens.every(screen => Math.abs(screen.material.opacity - .4 * .8) < 1e-8))
      canvases.add(screens[0].material.map.image)
      const version = screens[0].material.map.version
      rig.prop('contextPanel' + i, { at: [0, 0, 0], text, fold: 1 })
      assert.ok(root.getObjectByName('panel-left').rotation.y > 1.5)
      assert.ok(root.getObjectByName('panel-right').rotation.y < -1.5)
      assert.equal(screens[0].material.map.version, version, 'складывание не перерисовывает точный текст')
      const body = root.getObjectByName('panel-left').children[0].geometry
      body.computeBoundingBox()
      assert.ok(Math.abs((body.boundingBox.max.x - body.boundingBox.min.x) / U - 24) < .1,
        'каждая физическая половина занимает половину согласованной ширины с допуском скругления')
      rig.prop('contextPanel' + i, { at: [0, 0, 0], content: false, text })
      assert.ok(screens.every(screen => !screen.visible), 'image overlay получает открытую рамку без чужого текста')
    }
    assert.equal(canvases.size, 4, 'четыре карточки содержат независимые источники')
  })
})

test('физические хваты совпадают с кистью, tip с целью; обновления не строят объекты и dispose освобождает текстуры', async () => {
  await fixture(({ rig, roots, T, U }) => {
    const at = [15, -30, 9], dir = [.3, 0, Math.sqrt(1 - .3 ** 2)],
      cases = [['contextPanel0', [0, -16, 0]], ['contextLens', [0, -37, 0]], ['contextStylus', [0, 0, 0]]]
    for (const [name, grip] of cases) {
      rig.prop(name, { at, dir, grip, k: 1.5, text: 'Точное значение' })
      const root = roots.get(name)
      root.updateMatrixWorld(true)
      const actual = root.localToWorld(new T.Vector3(...grip.map(value => value * U))),
        expected = root.parent.localToWorld(new T.Vector3(at[2] * U, -at[1] * U, at[0] * U))
      assert.ok(actual.distanceTo(expected) < 1e-8, name + ': реальная точка хвата находится на кисти')
      if (name === 'contextStylus') {
        const tip = root.localToWorld(new T.Vector3(0, 0, 16 * U)),
          target = root.parent.localToWorld(new T.Vector3((at[2] + dir[2] * 24) * U,
            -at[1] * U, (at[0] + dir[0] * 24) * U))
        assert.ok(tip.distanceTo(target) < 1e-8, 'tip действительно лежит на wrist + 16 × k × dir')
      }
    }
    const lens = roots.get('contextLens'), handle = lens.getObjectByName('lens-handle')
    assert.equal(handle.geometry.parameters.height, 23 * U)
    assert.ok(handle.position.y - 11.5 * U <= -37 * U && handle.position.y + 11.5 * U >= -37 * U)
    for (const i of [1, 2, 3]) rig.prop('contextPanel' + i, { at, text: 'Строка ' + i })
    const before = inventory(roots)
    for (let i = 0; i < 30; i++) for (const name of roots.keys()) rig.prop(name,
      { at, dir, text: 'Точная строка ' + i, fold: i / 30, focus: i / 30, contact: i / 30, fade: .7 })
    const after = inventory(roots)
    for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], key + ' переиспользуются')
    for (const name of roots.keys()) rig.prop(name, null)
    assert.ok([...roots.values()].every(root => !root.visible))
    const disposed = { geometries: 0, materials: 0, textures: 0 }
    for (const key of Object.keys(disposed)) for (const resource of before[key])
      resource.addEventListener('dispose', () => disposed[key]++)
    for (const geometry of before.geometries) geometry.dispose()
    for (const material of before.materials) material.dispose()
    for (const key of Object.keys(disposed)) assert.equal(disposed[key], before[key].size, key + ' освобождены')
    for (const material of before.materials) material.dispose()
    assert.equal(disposed.textures, before.textures.size, 'повторный dispose материала не освобождает текстуру второй раз')
  })
})

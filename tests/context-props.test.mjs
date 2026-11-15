import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createContextPropBuilders } from '../src/context-props.js'

const conceptNames = ['memory', 'target', 'team', 'chain', 'link', 'cloud', 'rules', 'search']

function canvasStub() {
  const drawn = [], context = new Proxy({
    measureText: text => ({ width: [...text].length * 29 }),
    fillText: text => drawn.push(text)
  }, { get: (target, key) => target[key] ?? (() => {}) })
  return { width: 0, height: 0, drawn, getContext: () => context }
}

async function fixture(run) {
  const previous = globalThis.document, canvases = []
  globalThis.document = { createElement() { const canvas = canvasStub(); canvases.push(canvas); return canvas } }
  try {
    const { Buddy3D, THREE: T } = await import('../src/vendor.js'), rig = Buddy3D.create({ outline: false }), roots = new Map()
    await rig.loaded
    const before = canvases.length
    assert.equal(rig.registerPropBuilders(kit => Object.fromEntries(
      Object.entries(createContextPropBuilders(kit)).map(([name, builder]) => [name, () => {
        const prop = builder(); roots.set(name, prop.g); return prop
      }])
    )), 3)
    assert.equal(roots.size, 0, 'регистрация не создаёт 3D-объекты')
    assert.equal(canvases.length, before, 'регистрация не создаёт даже canvas экрана')
    await run({ rig, roots, T, U: Buddy3D.U })
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

function resources(roots) {
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

function bounds(root, T, U) {
  root.updateMatrixWorld(true)
  const inverse = new T.Matrix4().copy(root.matrixWorld).invert(), min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity], point = new T.Vector3()
  function visit(object, visible) {
    visible &&= object.visible
    if (!visible) return
    if (object.geometry) {
      const positions = object.geometry.attributes.position
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).applyMatrix4(inverse)
        point.toArray().forEach((value, axis) => { min[axis] = Math.min(min[axis], value / U); max[axis] = Math.max(max[axis], value / U) })
      }
    }
    for (const child of object.children) visit(child, visible)
  }
  visit(root, true)
  return max.map((value, axis) => value - min[axis])
}

test('ноутбук раскрывается настоящим шарниром и показывает точный текст без пересоздания экрана', async () => {
  await fixture(({ rig, roots, T, U }) => {
    const text = 'Доход +17%\nНовая команда'
    rig.prop('contextLaptop', { at: [0, 0, 0], open: 0, text })
    const laptop = roots.get('contextLaptop'), hinge = laptop.getObjectByName('laptop-hinge'),
      screen = laptop.getObjectByName('laptop-screen'), texture = screen.material.map,
      keys = laptop.children.filter(object => object.name === 'laptop-key')
    assert.equal(keys.length, 44, 'клавиатура имеет отдельные объёмные клавиши')
    assert.ok(bounds(laptop, T, U)[1] < 7, 'закрытая крышка ложится на основание')
    assert.equal(screen.userData.text, text)
    assert.deepEqual(texture.image.drawn, text.split('\n'), 'строки источника доходят до canvas без замены или сокращения')
    const version = texture.version
    rig.prop('contextLaptop', { at: [0, 0, 0], open: 1, text, typing: 1, t: 1 })
    assert.equal(texture.version, version, 'неизменный текст не загружается в GPU каждый кадр')
    assert.equal(screen.material.map, texture)
    assert.ok(hinge.rotation.x < 0, 'экран слегка откинут от клавиатуры')
    assert.ok(bounds(laptop, T, U)[1] > 46, 'экран имеет настоящую высоту над основанием')
    const normal = new T.Vector3(0, 0, 1).transformDirection(hinge.matrixWorld)
    assert.ok(normal.z > .9, 'лицевая сторона открытого экрана смотрит в +z')
    rig.prop('contextLaptop', { at: [0, 0, 0], open: 1, text: 'Точная новая строка', fade: .3 })
    assert.equal(screen.userData.text, 'Точная новая строка')
    assert.equal(texture.version, version + 1)
    assert.ok(Math.abs(screen.material.opacity - .3) < 1e-8)
    let disposed = 0
    texture.addEventListener('dispose', () => disposed++)
    screen.material.dispose(); screen.material.dispose()
    assert.equal(disposed, 1, 'dispose материала экрана освобождает его текстуру ровно один раз')
  })
})

test('восемь голограмм крупные и объёмные, кольцо остаётся на кисти, ресурсы переиспользуются и очищаются', async () => {
  await fixture(({ rig, roots, T, U }) => {
    for (const concept of conceptNames) {
      rig.prop('contextConcept', { at: [0, 0, 0], concept, progress: 1, fade: .4 })
      const root = roots.get('contextConcept'), size = bounds(root, T, U),
        active = root.children.filter(object => object.visible)
      assert.equal(active.length, 1)
      assert.equal(active[0].name, 'concept-' + concept)
      assert.ok(size[1] >= 40 && size[1] <= 70, `${concept}: высота ${size[1]} сравнима с героем`)
      assert.ok(size[0] >= 35 && size[0] <= 78, `${concept}: читаемая ширина ${size[0]}`)
      assert.ok(size[2] > 4, `${concept}: это объём, а не плоская картинка`)
      active[0].traverse(object => {
        if (object.material?.uniforms?.uOpacity) assert.ok(object.material.uniforms.uOpacity.value <= .4,
          'лениво созданная геометрия учитывает затухание уже на первом кадре')
      })
    }
    rig.prop('contextRing', { at: [0, 0, 0], pulse: 1, beam: 0 })
    const ring = roots.get('contextRing'), band = ring.getObjectByName('ring-band')
    assert.ok(bounds(ring, T, U)[0] < 18, 'кольцо имеет размер кисти, отдельно от большой голограммы')
    assert.equal(band.position.length(), 0, 'кольцо центрировано на точке кисти')
    rig.prop('contextRing', { at: [0, 0, 0], pulse: 1, beam: 1 })
    assert.ok(bounds(ring, T, U)[1] >= 38, 'световая связь действительно поднимается к голограмме')
    const beam = ring.getObjectByName('ring-projection'), destination = [42, -16, 0]
    rig.prop('contextRing', { at: [0, 0, 0], beam: 1, beamEnd: destination })
    ring.updateMatrixWorld(true)
    const tip = beam.localToWorld(new T.Vector3(0, 38 * U, 0))
    assert.ok(tip.distanceTo(new T.Vector3(destination[2] * U, -destination[1] * U, destination[0] * U)) < 1e-8,
      'Луч заканчивается в заданной точке образа')
    rig.prop('contextRing', { at: [0, 0, 0], beam: 1 })
    assert.ok(beam.quaternion.angleTo(new T.Quaternion()) < 1e-8 && beam.scale.y === 1,
      'Без конечной точки сохранён прежний вертикальный луч')
    rig.prop('contextLaptop', { at: [0, 0, 0], text: 'Контекст', open: 1 })
    const before = resources(roots)
    for (let i = 0; i < 24; i++) {
      rig.prop('contextConcept', { at: [0, 0, 0], concept: conceptNames[i % 8], progress: i / 24, t: i / 6 })
      rig.prop('contextRing', { at: [0, 0, 0], pulse: i / 24, beam: i / 24, t: i / 6 })
      rig.prop('contextLaptop', { at: [0, 0, 0], text: 'Контекст', open: i / 24, typing: 1, t: i / 6 })
    }
    const after = resources(roots)
    for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], `${key} переиспользуются`)
    for (const name of roots.keys()) rig.prop(name, null)
    assert.ok([...roots.values()].every(root => !root.visible), 'прерывание скрывает каждый контекстный prop')
    const counts = { geometries: 0, materials: 0, textures: 0 }
    for (const key of Object.keys(counts)) for (const resource of before[key]) {
      resource.addEventListener('dispose', () => counts[key]++)
    }
    // Та же граница владения, что runtime.dispose3d(): геометрии и материалы из scene.traverse.
    for (const geometry of before.geometries) geometry.dispose()
    for (const material of before.materials) material.dispose()
    for (const key of Object.keys(counts)) assert.equal(counts[key], before[key].size, `${key} освобождены`)
  })
})

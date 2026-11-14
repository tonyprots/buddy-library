import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAbilityPropBuilders } from '../ability-props.js'

test('объёмный реквизит переиспользует меши и материалы, скрывается и освобождает ресурсы', async () => {
  const previous = globalThis.document, context = new Proxy({}, { get: () => () => {} })
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
  try {
    const { Buddy3D } = await import('../vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded
    const builtRoots = [], rootsByName = new Map(), createdMaterials = []
    assert.equal(rig.registerPropBuilders(kit => {
      const builders = createAbilityPropBuilders({ ...kit, material(...args) {
        const material = kit.material(...args); createdMaterials.push(material); return material
      } })
      return Object.fromEntries(Object.entries(builders).map(([name, factory]) => [name, () => {
        const prop = factory(); builtRoots.push(prop.g); rootsByName.set(name, prop.g); return prop
      }]))
    }), 14)
    assert.throws(() => rig.registerPropBuilders(createAbilityPropBuilders))
    const names = ['abilityComet', 'abilityOrb', 'abilityBow', 'abilityArrow', 'abilityUmbrella', 'abilitySnowflake',
      'abilityStar', 'abilityOrbit', 'abilityCrate', 'abilityForceWall', 'abilityTimeBubble', 'abilityForceWave', 'abilityFlashlight', 'abilityConfetti']
    // Все builders действительно создают 3D-геометрию, а не DOM/SVG-наклейку.
    for (const name of names) rig.prop(name, { at: [20, -30, 0], t: 0, fade: 1, open: 1, rain: 1 })
    const objects = new Set(), geometries = new Set(), materials = new Set()
    rig.root.traverse(object => {
      objects.add(object)
      if (object.geometry) {
        geometries.add(object.geometry)
        const positions = object.geometry.attributes.position.array
        assert.ok(positions.every(Number.isFinite), `${object.uuid}: конечные координаты`)
      }
      if (object.material) materials.add(object.material)
    })
    assert.equal(builtRoots.length, names.length)
    for (const material of createdMaterials) {
      assert.ok(materials.has(material.m), 'основной материал достижим обходом сцены для dispose')
      if (material.o) assert.ok(materials.has(material.o), 'контур достижим обходом сцены для dispose')
    }
    for (let i = 0; i <= 24; i++) {
      for (const name of names) rig.prop(name, { at: [20, -30, 0], t: i / 4, fade: i % 4 ? 1 : .3,
        open: i / 24, rain: 1, draw: i / 24, tail: 1 - i / 24, spread: i / 24, impact: i / 24,
        melt: i / 24, freeze: i / 24, beamLength: 360, beamRadius: 24, kind: i % 2 ? 'sonic' : 'push' })
    }
    rig.root.traverse(object => {
      assert.ok(objects.has(object), 'кадры не создают новые Object3D')
      if (object.geometry) assert.ok(geometries.has(object.geometry), 'геометрия переиспользуется')
      if (object.material) assert.ok(materials.has(object.material), 'материалы переиспользуются')
    })
    rig.prop('abilityOrbit', { at: [20, -30, 0], t: 5, speed: 3, clock: 2 })
    const orbitState = () => {
      const values = []
      rootsByName.get('abilityOrbit').traverse(object => values.push(...object.position.toArray(), ...object.quaternion.toArray()))
      return values
    }, stopped = orbitState()
    rig.prop('abilityOrbit', { at: [20, -30, 0], t: 100, speed: 0, clock: 2 })
    assert.deepEqual(orbitState(), stopped, 'явные часы сохраняют фазу при остановке, не перематывая планеты')

    // Масштаб эффектов — часть их читаемости: крупная сфера и пузырь задаются независимо от кистей.
    rig.prop('abilityOrb', { at: [0, 0, 0], radius: 14, charge: 1, t: 0 })
    assert.ok(Math.abs(rootsByName.get('abilityOrb').getObjectByName('orb-shell').scale.x - 14 / 6) < 1e-8)
    rig.prop('abilityTimeBubble', { at: [0, 0, 0], radius: 52, fragmentScale: 2.2, freeze: 1, clock: 2 })
    const timeRoot = rootsByName.get('abilityTimeBubble')
    assert.ok(Math.abs(timeRoot.getObjectByName('time-shell').scale.x - 52 / 18) < 1e-8)
    assert.ok(timeRoot.children.some(object => object.isMesh && object.scale.x > 2), 'фрагменты крупнее независимо от оболочки')

    rig.prop('abilityBow', { at: [0, 0, 0], dir: [1, 0, 0], draw: 1 })
    const bowRoot = rootsByName.get('abilityBow')
    assert.ok(bowRoot.getObjectByName('bow-tip-1').position.z < 0, 'концы дуги позади рукояти по направлению выстрела')
    assert.ok(bowRoot.getObjectByName('bow-string-upper').position.z < -10 * Buddy3D.U, 'натянутая тетива идёт назад к герою')

    rig.prop('abilityUmbrella', { at: [0, 0, 0], open: 0 })
    const folded = rootsByName.get('abilityUmbrella').getObjectByName('folded-cloth')
    assert.ok(folded.visible && folded.children.length >= 8, 'сложенный зонт сохраняет ткань и складки')
    assert.ok(folded.children.some(object => object.geometry?.parameters.radiusBottom > 2 * Buddy3D.U), 'свёрток толще голого древка')
    assert.ok(folded.children.some(object => object.geometry?.parameters.radiusBottom >= 3.4 * Buddy3D.U), 'тканевый свёрток остаётся заметным на слайде')
    assert.ok(folded.children.some(object => object.geometry?.parameters.radiusBottom >= 3.4 * Buddy3D.U
      && object.position.y >= 37 * Buddy3D.U), 'закрытая ткань поднята вместе с куполом')
    rig.prop('abilityUmbrella', { at: [0, 0, 0], open: 1 })
    const canopy = rootsByName.get('abilityUmbrella').getObjectByName('canopy'),
      panels = canopy.children.filter(object => object.isMesh && object.geometry?.type === 'SphereGeometry'
        && object.geometry.parameters.radius > 20 * Buddy3D.U)
    assert.equal(panels.length, 8)
    assert.ok(panels.every(object => {
      object.geometry.computeBoundingBox()
      return object.position.y + object.geometry.boundingBox.min.y > 31 * Buddy3D.U
    }), 'нижняя кромка купола поднята над хватом, а не только его вершина')

    rig.prop('abilityCrate', { at: [0, 0, 0], tilt: .25 })
    const crate = rootsByName.get('abilityCrate').getObjectByName('crate-body')
    assert.equal(crate.position.y, 0, 'наклон не переносит нижнюю точку привязки')
    assert.equal(crate.rotation.x, .25)

    const confetti = rootsByName.get('abilityConfetti')
    assert.ok(confetti.children.length >= 80 && confetti.children.length <= 100)
    rig.prop('abilityConfetti', { at: [0, 0, 0], t: 1.4 })
    const xs = confetti.children.map(object => object.position.x / Buddy3D.U),
      triangles = confetti.children.reduce((sum, object) => sum + object.geometry.index.count / 3, 0)
    assert.ok(Math.max(...xs) - Math.min(...xs) > 115, 'праздничная туча шире фигуры')
    assert.ok(triangles <= 2000, 'больше бумаги не требует тяжёлой геометрии')
    rig.prop('abilityConfetti', { at: [0, 0, 0], t: 3.8, floorDrop: 110, fade: 1 })
    const settled = confetti.children.map(object => object.position.toArray())
    assert.ok(confetti.children.every(object => object.visible && object.scale.x === 1
      && Math.abs(object.position.y / Buddy3D.U + 110) < 1), 'вся бумага лежит на полу до начала уборки')
    rig.prop('abilityConfetti', { at: [0, 0, 0], t: 4.1, floorDrop: 110, fade: .4 })
    assert.deepEqual(confetti.children.map(object => object.position.toArray()), settled, 'бумага затухает уже после приземления')

    rig.prop('abilityTimeBubble', { at: [0, 0, 0], radius: 52, freeze: 0, clock: 3.8 })
    const shards = timeRoot.children.filter(object => object.isMesh)
    assert.ok(shards.every(object => !object.visible), 'исходная группа осколков покинула пузырь после возобновления времени')
    rig.prop('abilityTimeBubble', { at: [0, 0, 0], radius: 52, freeze: 0, clock: 4.5 })
    assert.ok(shards.every(object => !object.visible), 'нового входящего цикла осколков не возникает')

    rig.prop('abilityForceWave', { at: [0, 0, 0], kind: 'sonic', spread: .35 })
    const fronts = [0, 1, 2].map(i => rootsByName.get('abilityForceWave').getObjectByName('sonic-front-' + i))
    assert.ok(fronts.every(object => object.visible))
    assert.ok(fronts[0].position.z > fronts[1].position.z && fronts[1].position.z > fronts[2].position.z)
    assert.ok(fronts[0].scale.x > fronts[1].scale.x && fronts[1].scale.x > fronts[2].scale.x)
    rig.prop('abilityForceWave', { at: [0, 0, 0], kind: 'sonic', spread: 1 })
    assert.ok(fronts.every(object => !object.visible), 'звуковые фронты расходятся и исчезают')

    for (const name of names) rig.prop(name, null)
    assert.ok(builtRoots.every(group => !group.visible), 'прерывание скрывает все объекты')
    let geometryDisposals = 0, materialDisposals = 0
    for (const geometry of geometries) { geometry.addEventListener('dispose', () => geometryDisposals++); geometry.dispose() }
    for (const material of materials) { material.addEventListener('dispose', () => materialDisposals++); material.dispose() }
    assert.equal(geometryDisposals, geometries.size)
    assert.equal(materialDisposals, materials.size)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})

test('thumbsUp использует настоящие кости и не меняет другую кисть или старые позы', async () => {
  const previous = globalThis.document, context = new Proxy({}, { get: () => () => {} })
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
  try {
    const { Buddy3D, THREE: T } = await import('../vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded
    const bones = new Map()
    rig.root.traverse(object => { if (object.isBone) bones.set(object.name, object) })
    const k = {
      T: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], hS: [0, 0, 1], hU: [0, -1, 0], hF: [1, 0, 0],
      arms: [-1, 1].map(side => ({ sh: [0, -24, side * 9], elbow: [10, -12, side * 9], wrist: [10, 0, side * 9] })),
      legs: [-1, 1].map(side => ({ hip: [0, 0, side * 5.6], knee: [0, 20.5, side * 5.6], ankle: [0, 40, side * 5.6],
        heel: [-3.2, 43.2, side * 5.6], toe: [8.4, 43.2, side * 5.6] }))
    }, p = { rot: 0 }, indices = ['Index1L', 'Index2L', 'Index1R', 'Index2R'],
      snapshot = () => indices.map(name => bones.get(name).quaternion.toArray())
    rig.pose(k, p)
    const baseline = snapshot()
    rig.pose(k, { ...p, handOpen: [0, 0], handFist: [0, 0] })
    assert.deepEqual(snapshot(), baseline)
    rig.pose(k, { ...p, handShape: { kind: 'thumbsUp', side: 0, amount: 1 } })
    assert.notDeepEqual(snapshot()[0], baseline[0])
    assert.deepEqual(snapshot().slice(2), baseline.slice(2))
    rig.root.updateMatrixWorld(true)
    const direction = bones.get('Thumb2L').getWorldPosition(new T.Vector3())
      .sub(bones.get('Thumb1L').getWorldPosition(new T.Vector3())).normalize()
    assert.ok(direction.y > .99, 'большая фаланга направлена вверх')
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})

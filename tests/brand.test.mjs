import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBuddy } from '../src/index.js'
import { resolveBrand } from '../src/brand.js'
import { brand as y360, logos } from '../src/presets/y360.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

const withBuddy = async (options, run) => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', ...options })
    buddy.pause()
    await run(buddy, f)
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
}, nodes = node => [node, ...node.children.flatMap(nodes)],
  images = f => nodes(f.stage).map(node => node.getAttribute('href')).filter(Boolean)

test('бренд включает номера без дополнительных флагов; цвет и снимок не зависят от дальнейшей мутации входа', async () => {
  const brand = { logo: './main.svg', products: ['./one.svg', './two.svg'], accent: '#3e8c74' }
  await withBuddy({ brand }, (buddy, f) => {
    assert.equal(buddy.mode, 'show')
    assert.equal(buddy.presets.brand, true)
    assert.equal(buddy.presets.y360, false)
    assert.equal(buddy.hoodie.source, 'brand')
    assert.equal(buddy.brand.accent, '#3E8C74')
    brand.products.push('./unexpected.svg'); brand.logo = './other.svg'
    assert.deepEqual(buddy.brand.products, ['./one.svg', './two.svg'])
    assert.equal(buddy.brand.logo, './main.svg')
    assert.throws(() => buddy.brand.products.push('./mutation.svg'), TypeError)
    buddy.setMode('manual'); buddy.reset(); buddy.play('shield'); buddy.step(1)
    assert.deepEqual(new Set(images(f)), new Set(['./one.svg', './two.svg']))
    assert.ok(nodes(f.stage).some(node => node.getAttribute('stroke') === '#3E8C74'))
  })
  await withBuddy({ brand, hoodie: 'default' }, buddy => assert.equal(buddy.hoodie.source, 'default'))
})

test('неизвестный или пустой бренд оставляет обычного героя; цвет без знаков не включает фирменные номера', async () => {
  const warn = console.warn, warnings = []
  console.warn = message => warnings.push(message)
  try {
    for (const brand of [undefined, null, {}, { products: [] }, { accent: '#3e8c74' }])
      await withBuddy({ brand }, buddy => {
        assert.equal(buddy.presets.brand, false)
        assert.equal(buddy.mode, 'show')
        assert.ok(buddy.can('disk'))
      })
    assert.deepEqual(warnings, [])
  } finally { console.warn = warn }
})

test('главный знак без продуктов и набор только с продуктами исполняют все фирменные роли без NaN', async () => {
  for (const brand of [{ logo: './main.svg', products: [] }, { products: ['./only.svg'] }])
    await withBuddy({ brand, mode: 'manual' }, (buddy, f) => {
      const card = new f.stage.constructor('img')
      card.closest = () => null
      card.getBoundingClientRect = () => ({ left: 360, top: 420, right: 660, bottom: 620, width: 300, height: 200 })
      f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
      for (const id of ['disk', 'mail', 'calendar', 'tracker', 'fire', 'shield', 'fly']) {
        buddy.reset(); buddy.progress(1); buddy.rescan()
        assert.equal(buddy.can(id), null, id)
        assert.equal(buddy.play(id), true, id)
        const seen = new Set()
        for (let frame = 0; frame < 720; frame++) {
          buddy.step(1 / 60)
          assert.ok(Number.isFinite(buddy.state().x) && Number.isFinite(buddy.state().y), id)
          for (const image of images(f)) seen.add(image)
        }
        if (id !== 'shield' && !(id === 'fire' && !brand.logo))
          assert.ok(seen.has(brand.logo || brand.products[0]), id)
      }
    })
})

test('орбита использует произвольное число продуктов; роли могут переопределяться', async () => {
  const products = Array.from({ length: 9 }, (_, i) => './product-' + i + '.svg')
  await withBuddy({ brand: { products, roles: { disc: './disc.svg' } }, mode: 'manual' }, (buddy, f) => {
    buddy.play('shield'); buddy.step(1)
    assert.deepEqual(new Set(images(f)), new Set(products))
    buddy.reset(); buddy.play('disk'); buddy.step(1)
    assert.ok(images(f).includes('./disc.svg'))
  })
})

test('старый набор Я360 и новый пример сохраняют точные изображения и роли', () => {
  const legacy = resolveBrand(null, logos)
  assert.deepEqual(y360, legacy)
  assert.equal(y360.roles.disc, logos.disk)
  assert.equal(y360.roles.message, logos.mail)
  assert.equal(y360.roles.reminder, logos.calendar)
  assert.equal(y360.roles.mark, logos.tracker)
  assert.equal(y360.roles.board, logos.telemost)
  assert.equal(y360.logo, logos.y360)
  assert.equal(y360.products.length, 6)
})

test('явное отключение пресета убирает знаки и номера, но сохраняет акцент', async () => {
  await withBuddy({ brand: { logo: './main.svg', products: ['./one.svg'], accent: '#3e8c74' }, presets: { brand: false }, mode: 'manual' }, (buddy, f) => {
    assert.ok(buddy.can('disk'))
    buddy.play('shield'); buddy.step(1)
    assert.deepEqual(images(f), [])
    assert.equal(buddy.hoodie.source, 'brand')
  })
})

test('неверный набор отклоняется до создания персонажа', async () => {
  for (const brand of [false, [], { products: 'wrong' }, { products: [null] }, { logo: '' },
    { logo: 'javascript:alert(1)' }, { accent: 'orange' }, { accent: 'rgba(0,0,0,.5)' }, { roles: [] }])
    await assert.rejects(withBuddy({ brand }, () => {}), TypeError)
})

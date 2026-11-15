import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBuddy } from '../src/index.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

test('пресет без файла знаков предупреждает один раз и использует нейтральный реквизит', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement, warn = console.warn, warnings = []
  globalThis.HTMLElement = f.stage.constructor
  console.warn = message => warnings.push(message)
  let buddy
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', mode: 'manual', presets: { y360: true } })
    assert.equal(warnings.length, 1)
    const card = new f.stage.constructor('img')
    card.closest = () => null
    card.getBoundingClientRect = () => ({ left: 360, top: 420, right: 660, bottom: 620, width: 300, height: 200 })
    f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
    for (const id of ['disk', 'mail', 'calendar', 'tracker']) {
      buddy.reset(); buddy.progress(1); buddy.rescan()
      assert.equal(buddy.can(id), null)
      assert.equal(buddy.play(id), true)
      const visit = node => [node, ...node.children.flatMap(visit)]
      let images = []
      for (let frame = 0; frame < 600 && !images.length; frame++) {
        buddy.step(1 / 60)
        images = f.stage.children.flatMap(visit).filter(node => node.getAttribute('href'))
      }
      assert.ok(images.length > 0, id)
      assert.ok(images.every(node => !node.getAttribute('href').includes('base64')))
    }
    assert.equal(warnings.length, 1, 'Предупреждение не повторяется на каждом номере')
  } finally {
    buddy?.destroy(); f.close(); console.warn = warn
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('размер сцены проверяется в логических координатах, без влияния CSS scale', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement, warn = console.warn, warnings = []
  globalThis.HTMLElement = f.stage.constructor
  console.warn = message => warnings.push(message)
  let buddy
  try {
    for (const [width, height, count] of [[1280, 720, 0], [1600, 900, 1]]) {
      f.stage.offsetWidth = width; f.stage.offsetHeight = height
      f.stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: width / 2, bottom: height / 2, width: width / 2, height: height / 2 })
      buddy = await createBuddy({ stage: f.stage, renderer: 'svg', mode: 'manual' })
      assert.equal(warnings.length, count)
      buddy.destroy()
    }
  } finally {
    buddy?.destroy(); f.close(); console.warn = warn
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

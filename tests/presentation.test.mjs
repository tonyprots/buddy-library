import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBuddy } from '../src/index.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

test('чужие классы и вложенные слайды сохраняют навигацию, контекст и прогресс', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement, observers = [],
    slides = [new f.host.constructor('article'), new f.host.constructor('article')]
  let active = 0, buddy
  for (const [i, slide] of slides.entries()) slide.classList.contains = name => name === 'is-active' && i === active
  f.stage.querySelectorAll = selector => selector === '.pages > article' ? slides : []
  f.stage.querySelector = () => null
  globalThis.HTMLElement = f.stage.constructor
  globalThis.MutationObserver = class { constructor(fn) { observers.push(fn) } observe() {} disconnect() {} }
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', slideSelector: '.pages > article', activeClass: 'is-active' })
    buddy.pause()
    assert.equal(buddy.experimental.W.n, 2)
    assert.equal(buddy.state().level, 0)
    active = 1
    for (const observer of observers) observer([{ target: slides[1], type: 'attributes', attributeName: 'class' }])
    buddy.rescan()
    assert.equal(buddy.experimental.W.idx, 1)
    assert.equal(buddy.state().level, 3)
    assert.equal(buddy.experimental.W.progress, 1)
    assert.equal(buddy.context().available, true)
    assert.ok(slides.every(slide => !slide.classList.contains('slide') && !slide.classList.contains('on')))
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('неверные настройки слайдов отклоняются до подключения', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  try {
    for (const options of [{ slideSelector: '' }, { activeClass: 'two classes' }, { activeClass: '' }])
      await assert.rejects(async () => { const buddy = await createBuddy({ stage: f.stage, renderer: 'svg', ...options }); buddy.destroy() }, TypeError)
  } finally {
    f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

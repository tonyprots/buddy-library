import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'

// availability() не обещает номер, от которого планировщик откажется: на пустом слайде крюк и паутина
// называют причину, а там, где «можно», run() действительно начинает номер.
function withCard(f, rect) {
  const card = new f.host.constructor('div'), style = getComputedStyle
  card.closest = () => null; card.hasAttribute = name => card.getAttribute(name) !== null
  card.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top })
  f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
  globalThis.getComputedStyle = node => node === card
    ? { backgroundColor: 'rgb(210,220,240)', borderTopWidth: '0', borderTopLeftRadius: '18' } : style(node)
  f.raw.rescan(); f.raw.step(1 / 120, 120)
}

test('пустой слайд: крюк и паутина объясняют отказ, а не обещают номер', () => {
  const f = runtimeFixture()
  try {
    f.raw.rescan(); f.raw.step(1 / 120, 120)
    assert.match(f.raw.availability('grapple'), /grappling-hook/)
    assert.match(f.raw.availability('web'), /thread/)
    assert.equal(f.raw.run(['grapple']), false)
    assert.equal(f.raw.run(['web']), false)
  } finally { f.close() }
})

test('есть подходящий блок: «можно» означает, что номер начался', () => {
  for (const id of ['grapple', 'web']) {
    const f = runtimeFixture(1)
    try {
      withCard(f, { left: 360, top: 470, right: 660, bottom: 650 })
      Object.assign(f.raw.B, { x: 300, anchor: null }); f.raw.step(1 / 120, 120)
      assert.equal(f.raw.availability(id), null, id)
      assert.notEqual(f.raw.run([id]), false, id)
      let seen = false
      for (let n = 0; n < 1200 && !seen; n++) { f.raw.step(1 / 120, 120); seen = f.raw.B.act?.name === id || f.raw.B.act?.name === 'climb' }
      assert.ok(seen, id)
    } finally { f.close() }
  }
})

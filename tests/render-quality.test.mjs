import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

test('импорт сборки не перезаписывает Three.js приложения', async () => {
  const previous = globalThis.window, sentinel = {}
  globalThis.window = { THREE: sentinel }
  try {
    const vendor = await import('../src/vendor.js')
    assert.equal(globalThis.window.THREE, sentinel)
    assert.equal(globalThis.window.BUDDY_GLB, undefined)
    assert.equal(globalThis.window.Buddy3D, undefined)
    assert.equal(typeof vendor.THREE.WebGLRenderer, 'function')
    assert.equal(typeof vendor.Buddy3D.create, 'function')
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})

test('разные риги сохраняют независимые viewport, прозрачность, оттенок и капсулы AO', async () => {
  const source = await readFile(new URL('../src/vendor.js', import.meta.url), 'utf8'),
    context = new Proxy({}, { get: () => () => {} }),
    document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }

  // VM выполняет тот же модуль без экспортной декларации; возвращается его локальный namespace.
  const vendor = runInNewContext(source.replace('export const { THREE, Buddy3D } = window', 'window'),
    { document, atob, TextDecoder, TextEncoder, URL, AbortController, console, setTimeout, clearTimeout }),
    first = vendor.Buddy3D.create({ outline: false }), second = vendor.Buddy3D.create({ outline: false })
  // Загрузка модели не нужна для управления viewport: первые команды приходят до ready.
  first.viewport(320, 400, 2.5)
  second.viewport(800, 640, 1.25)
  first.tint(.8)
  first.opacity(.4)
  assert.equal(first.G.uRes.value.x, 320)
  assert.equal(second.G.uRes.value.x, 800)
  assert.equal(first.G.uPx.value, 2.5)
  assert.equal(second.G.uPx.value, 1.25)
  assert.equal(second.G.uTint.value, 0)
  assert.equal(second.G.uOpacity.value, 1)
  assert.notEqual(first.G.uCapA.value[0], second.G.uCapA.value[0])
  first.G.uCapA.value[0].x = 123
  assert.equal(second.G.uCapA.value[0].x, 0)

  await Promise.all([first.loaded, second.loaded])
  assert.ok(first.root.children.length > 0)
  assert.ok(second.root.children.length > 0)
})

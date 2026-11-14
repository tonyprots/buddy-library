import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRuntime } from '../runtime.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

function fixture(withBrand = true) {
  const f = runtimeFixture(), Node = f.host.constructor, brand = new Node('div'), avatar = new Node('span'), text = new Node('span'),
    query = f.stage.querySelector.bind(f.stage), host = new Node('div')
  let right = 219.375
  f.raw.destroy(); f.stage.appendChild(host)
  brand.getBoundingClientRect = () => ({ left: 45, top: 662, right, bottom: 700, width: right - 45, height: 38 })
  avatar.getBoundingClientRect = () => ({ left: 45, top: 662, right: 83, bottom: 700, width: 38, height: 38 })
  text.getBoundingClientRect = () => ({ left: 97, top: 670, right, bottom: 693, width: right - 97, height: 23 })
  brand.querySelector = s => s === '[data-perch]' ? avatar : s === '[data-perch-text]' ? text : null
  f.stage.querySelector = s => s === '.brand' ? withBrand ? brand : null : query(s)
  const raw = createRuntime({ deck: f.stage, host, renderer: 'svg', autonomous: false })
  raw.manual(true); raw.rescan()
  return { raw, grow(value) { right = value }, close() { raw.destroy(); f.close() } }
}

test('подпись вне .slide учитывается до построения разрешённого пола', () => {
  const f = fixture(), { raw } = f
  try {
    assert.equal(raw.W.ob.length, 0, 'Подпись специально вне scanner активного слайда')
    assert.equal(raw.W.brandX2, 219.375)
    assert.ok(raw.W.floor.spans.length > 0)
    assert.ok(raw.W.floor.spans.every(([a]) => a >= raw.W.brandX2 + 18), 'Пол начинается после измеренной подписи')
    assert.equal(raw.W.logo.kind, 'logo'); assert.equal(raw.W.logo.y, 663, 'Явная опора аватарки сохранена')
    f.grow(290); raw.rescan()
    assert.equal(raw.W.brandX2, 290)
    assert.ok(raw.W.floor.spans.every(([a]) => a >= raw.W.brandX2 + 18), 'Повторный rescan использует новую ширину в том же вызове')
  } finally { f.close() }
})

test('начальная стойка находится на разрешённом полу за полосой подписи', () => {
  const f = fixture(), { raw } = f
  try {
    assert.equal(raw.B.mode, 'ground')
    assert.ok(raw.W.floor.spans.some(([a, z]) => raw.B.x >= a && raw.B.x <= z))
    assert.ok(raw.B.x >= raw.W.brandX2 + 18, 'Исходный x не остаётся внутри запретной полосы подписи')
  } finally { f.close() }
})

test('сцена без подписи создаёт валидную наземную стойку', () => {
  const f = fixture(false), { raw } = f
  try {
    assert.equal(raw.W.brandX2, 0); assert.equal(raw.W.logo, null)
    assert.equal(raw.B.mode, 'ground'); assert.ok(Number.isFinite(raw.B.x))
    assert.ok(raw.W.floor.spans.some(([a, z]) => raw.B.x >= a && raw.B.x <= z))
  } finally { f.close() }
})

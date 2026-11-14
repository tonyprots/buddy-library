import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStoryPlayer } from '../context-stories.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

class Style {
  constructor(text = '') { this.values = new Map(); this.parse(text) }
  parse(text) { this.values.clear(); for (const pair of text.split(';')) {
    const colon = pair.indexOf(':'); if (colon > 0) this.values.set(pair.slice(0, colon).trim(), pair.slice(colon + 1).trim())
  } }
  setProperty(key, value) { this.values.set(key, String(value)) }
  getPropertyValue(key) { return this.values.get(key) || '' }
  get cssText() { return [...this.values].map(([key, value]) => `${key}:${value}`).join(';') }
}

class SvgNode {
  constructor(tag, attributes = {}) {
    this.tagName = tag; this.attrs = new Map(Object.entries(attributes)); this.children = []
    this.style = new Style(attributes.style); this.clientWidth = 100; this.clientHeight = 80
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value: name === 'style' ? this.style.cssText : value })) }
  setAttribute(key, value) { this.attrs.set(key, String(value)); if (key === 'style') this.style.parse(String(value)) }
  getAttribute(key) { return this.attrs.get(key) ?? null }
  removeAttribute(key) { this.attrs.delete(key) }
  appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null }
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]) }
  cloneNode() { const copy = new SvgNode(this.tagName, Object.fromEntries(this.attributes.map(a => [a.name, a.value])))
    for (const child of this.children) copy.appendChild(child.cloneNode()); return copy }
  get outerHTML() { return JSON.stringify([this.tagName, this.attributes, this.children.map(child => child.outerHTML)]) }
}

test('scale(2) применяется один раз; исходный letterbox, paint и дочерние transforms сохраняются', () => {
  const f = runtimeFixture(), svg = new SvgNode('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'xMidYMid meet',
    transform: 'scale(2)', style: 'transform:scale(2);width:100px;height:80px;position:absolute;left:120px;fill:#315e48' }),
    group = new SvgNode('g', { transform: 'translate(7 3)' }), shape = new SvgNode('rect', { width: '20', height: '10', fill: '#84d9b1' })
  group.appendChild(shape); svg.appendChild(group)
  const original = svg.outerHTML, items = ['before', 'after'].map((id, i) => ({ id, text: id,
    target: { x: 300 + i * 260, y: 260, width: 200, height: 160 } })),
    selection = { fact: { id: 'images', kind: 'images', text: 'Пара', structure: { items } }, element: { tagName: 'DIV' },
      bounds: [200, 180, 660, 340], parts: items.map(item => ({ id: item.id, element: svg,
        bounds: [item.target.x - 100, 180, item.target.x + 100, 340],
        media: { width: 100, height: 80, copyable: true } })) },
    player = createStoryPlayer(f.raw, { host: f.host, context: () => selection })
  try {
    const action = player.create('showBeforeAfter'); assert.ok(action); f.raw.begin(action); f.raw.step(4, 60)
    const nodes = [], visit = node => { nodes.push(node); for (const child of node.children || []) visit(child) }
    visit(f.host)
    const copies = nodes.filter(node => node instanceof SvgNode && node.tagName === 'svg')
    assert.equal(copies.length, 2)
    for (const copy of copies) {
      const viewport = copy.parentNode
      assert.equal(viewport.getAttribute('viewBox'), '0 0 100 80')
      assert.equal(viewport.getAttribute('width'), '200'); assert.equal(viewport.getAttribute('height'), '160')
      assert.equal(viewport.getAttribute('preserveAspectRatio'), 'none')
      assert.equal(copy.getAttribute('viewBox'), '0 0 100 100')
      assert.equal(copy.getAttribute('preserveAspectRatio'), 'xMidYMid meet')
      assert.equal(copy.style.getPropertyValue('transform'), 'none')
      assert.equal(copy.getAttribute('transform'), null)
      assert.equal(copy.style.getPropertyValue('width'), '100px')
      assert.equal(copy.style.getPropertyValue('height'), '80px')
      assert.equal(copy.style.getPropertyValue('fill'), '#315e48')
      assert.equal(copy.children[0].getAttribute('transform'), 'translate(7 3)')
      assert.equal(copy.children[0].children[0].getAttribute('fill'), '#84d9b1')
    }
    assert.equal(svg.outerHTML, original, 'источник не меняется ради нормализации копии')
  } finally { player.destroy(); f.close() }
})

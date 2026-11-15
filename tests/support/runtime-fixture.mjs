import { createRuntime } from '../../src/runtime.js'

/** Настоящие позы, решатель и модельное время; заглушены DOM и браузерный планировщик. */
export function runtimeFixture(face = 1, { logos = {} } = {}) {
  class Node {
    constructor(tag = 'g') {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.style = {}
      this.classList = { contains: () => false }
    }
    setAttribute(key, value) { this.attributes[key] = String(value) }
    getAttribute(key) { return this.attributes[key] ?? null }
    get parentElement() { return this.parentNode ?? null }
    addEventListener() {}
    removeEventListener() {}
    removeAttribute(key) { delete this.attributes[key] }
    appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child }
    append(...children) { for (const child of children) this.appendChild(child) }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); for (const child of children) this.appendChild(child) }
    querySelectorAll() { return [] }
    querySelector() { return null }
    getBoundingClientRect() { return { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 } }
    contains(node) { return node === this || this.children.some(child => child.contains(node)) }
  }
  const slide = new Node('section'), stage = new Node('div'), host = new Node('div'), previous = new Map(),
    globals = {
      document: { hidden: false, createElementNS: (_, tag) => new Node(tag), createElement: tag => new Node(tag),
        createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({}), addEventListener() {}, removeEventListener() {} },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      MutationObserver: class { observe() {} disconnect() {} }, NodeFilter: { SHOW_TEXT: 4 },
      requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {},
      getComputedStyle: () => ({ backgroundColor: 'rgba(0,0,0,0)', borderTopWidth: '0', fontSize: '16' })
    }
  slide.classList.contains = name => name === 'on'
  stage.querySelectorAll = selector => selector === ':scope > .slide' ? [slide] : []
  stage.querySelector = selector => /\.slide/.test(selector) ? slide : null
  stage.appendChild(host)
  for (const [name, value] of Object.entries(globals)) { previous.set(name, globalThis[name]); globalThis[name] = value }
  const raw = createRuntime({ deck: stage, host, logos, autonomous: false, renderer: 'svg' })
  raw.manual(true); raw.seed(14); raw.progress(1); raw.rescan(); raw.reset()
  raw.B.face = face; raw.B.cam = .4; raw.B.yaw = face > 0 ? .4 * Math.PI / 2 : Math.PI - .4 * Math.PI / 2
  return { raw, host, stage, slide, close() {
    raw.destroy()
    for (const [name, value] of previous) value === undefined ? delete globalThis[name] : globalThis[name] = value
  } }
}

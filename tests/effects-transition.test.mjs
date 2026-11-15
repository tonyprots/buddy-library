import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const effectsURL = process.env.BUDDY_EFFECTS_SOURCE ? pathToFileURL(resolve(process.env.BUDDY_EFFECTS_SOURCE))
  : new URL('../src/effects.js', import.meta.url), { attachDeckEffects } = await import(effectsURL)

function fixture({ reduced = false, attach = attachDeckEffects, keyboard = false } = {}) {
  let now = 0, serial = 0, randomSeed = 14, reducedValue = reduced
  const motionListeners = new Set(), inputListeners = new Map()
  const timers = new Map(), rafs = new Map(), animations = [], nodes = [], commits = [], originals = new Map(),
    noop = () => {}, context = node => new Proxy({ arcs: [], arc(...args) { this.arcs.push(args) },
      createRadialGradient: () => ({ addColorStop: noop }) }, { get: (object, key) => object[key] ?? noop })
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag; this.className = ''; this.children = []; this.dataset = {}; this.attrs = new Map()
      this.style = { setProperty(key, value) { this[key] = value } }
      this.classList = { add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' ').trim() },
        remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' ') },
        contains: name => this.className.split(' ').includes(name) }
      nodes.push(this)
    }
    appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child }
    append(...children) { for (const child of children) this.appendChild(child) }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null }
    setAttribute(key, value) { this.attrs.set(key, String(value)) }
    hasAttribute(key) { return this.attrs.has(key) }
    removeAttribute(key) { this.attrs.delete(key) }
    querySelectorAll(selector) { return selector === ':scope > .slide' ? this.children.filter(n => n.classList.contains('slide')) : [] }
    querySelector(selector) {
      if (selector === 'h1') return this.children.find(n => n.tagName === 'h1') || null
      if (selector === '.buddy') return this.children.find(n => n.classList.contains('buddy')) || null
      return null
    }
    cloneNode() { const copy = new Node(this.tagName); copy.className = this.className; copy.textContent = this.textContent
      for (const child of this.children) copy.append(child.cloneNode()); return copy }
    getBoundingClientRect() { return this.tagName === 'h1' ? { left: 100, top: 120, width: 900, height: 130 }
      : { left: 0, top: 0, width: 1280, height: 720 } }
    getContext() { return this.ctx ||= context(this) }
    getAnimations() { return animations.filter(a => !a.cancelled) }
    animate(keyframes, options) {
      const animation = { node: this, keyframes, options, start: now, paused: false, cancelled: false,
        pause() { this.paused = true }, play() { this.paused = false; this.start = now },
        cancel() { this.cancelled = true } }
      animations.push(animation); return animation
    }
  }
  const deck = new Node(), cover = new Node('section'), title = new Node('h1'), next = new Node('section'), host = new Node()
  cover.className = 'slide cover on'; title.textContent = 'Точная обложка'; cover.append(title)
  next.className = 'slide'; host.className = 'buddy'; deck.append(cover, next, host)
  const globals = {
    document: { createElement: tag => new Node(tag), fonts: { ready: Promise.resolve() } },
    location: { search: '' }, devicePixelRatio: 1, performance: { now: () => now },
    requestAnimationFrame: fn => { const id = ++serial; rafs.set(id, fn); return id },
    cancelAnimationFrame: id => rafs.delete(id),
    setTimeout: (fn, ms = 0) => { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id },
    clearTimeout: id => timers.delete(id), setInterval: () => ++serial, clearInterval: noop,
    addEventListener: (type, callback) => { if (!inputListeners.has(type)) inputListeners.set(type, new Set()); inputListeners.get(type).add(callback) },
    removeEventListener: (type, callback) => inputListeners.get(type)?.delete(callback),
    getComputedStyle: () => ({ transform: 'none' }),
    matchMedia: () => ({ addEventListener: (_, fn) => motionListeners.add(fn), removeEventListener: (_, fn) => motionListeners.delete(fn) })
  }
  for (const [name, value] of Object.entries(globals)) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }) }
  const originalRandom = Math.random
  Math.random = () => ((randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0) / 4294967296)
  const buddy = { experimental: { B: { x: 640, y: 650 } }, get reducedMotion() { return reducedValue } },
    effects = attach({ stage: deck, buddy, keyboard, show(index) {
      if (index === 1) {
        const crack = nodes.find(node => node.classList.contains('fx-crackcv') && node.parentNode)
        commits.push({ at: now, crackRadius: Math.max(0, ...(crack?.ctx?.arcs || []).map(arc => arc[2])) })
      }
      cover.classList.remove('on'); next.classList.remove('on'); [cover, next][index].classList.add('on')
    } }),
    tick = time => {
      now = time
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn() }
      const callbacks = [...rafs.values()]; rafs.clear(); callbacks.forEach(fn => fn(now))
      for (const animation of [...animations]) if (!animation.cancelled && !animation.paused && !animation.finished
        && now - animation.start >= animation.options.duration) { animation.finished = true; animation.onfinish?.() }
    }, advance = (until, step = 16) => { while (now + step < until) tick(now + step); tick(until) }
  return { effects, deck, nodes, commits, timers, rafs, animations, tick, advance,
    key(code) { for (const callback of inputListeners.get('keydown') || []) callback({ code }) },
    setReduced(value) { reducedValue = value; for (const fn of motionListeners) fn({ matches: value }) },
    async arm() { effects.armIntro(); await Promise.resolve(); await Promise.resolve(); tick(now); assert.ok(effects.glass?.n) },
    close() { effects.destroy(); Math.random = originalRandom
      for (const [name, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name] } }
}

test('длинный кадр не оставляет трещины позади compositor-таймлайна взрыва', async () => {
  const results = []
  for (const blocked of [false, true]) {
    const f = fixture()
    try {
      await f.arm()
      const shardGeometrySHA = createHash('sha256').update(JSON.stringify({
        shards: f.nodes.filter(n => n.classList.contains('fx-shard')).map(n => n.style.cssText),
        animations: f.animations.map(a => ({ keyframes: a.keyframes, options: a.options })) })).digest('hex')
      f.effects.go(1, 0)
      f.advance(448)
      if (blocked) f.tick(832)
      f.advance(1100)
      assert.equal(f.commits.length, 1)
      results.push({ ...f.commits[0], shardGeometrySHA })
    } finally { f.close() }
  }
  if (process.env.BUDDY_TRANSITION_REPORT) writeFileSync(process.env.BUDDY_TRANSITION_REPORT,
    JSON.stringify({ date: new Date().toISOString(), effectsSHA: createHash('sha256')
      .update(readFileSync(effectsURL)).digest('hex'),
    results: results.map((result, i) => ({ blocked: !!i, ...result })) }, null, 2))
  assert.equal(results[0].crackRadius, 1500)
  assert.equal(results[1].crackRadius, 1500,
    `WAAPI уже переключает слайд в ${results[1].at} мс, трещины дошли лишь до ${results[1].crackRadius}px`)
})

test('задержавшийся второй удар остаётся началом волны и общего WAAPI-clock', async () => {
  const f = fixture()
  try {
    await f.arm(); f.effects.go(1, 0); f.advance(96); f.tick(700)
    const crack = f.nodes.find(node => node.classList.contains('fx-crackcv') && node.parentNode),
      radius = Math.max(...crack.ctx.arcs.map(arc => arc[2]))
    assert.ok(radius <= 70, 'Волна не стартовала раньше фактического второго удара')
    f.advance(1250); assert.equal(f.commits.length, 0)
    f.advance(1300); assert.equal(f.commits.length, 1)
    assert.ok(f.commits[0].at >= 1260)
    assert.equal(f.commits[0].crackRadius, 1500)
  } finally { f.close() }
})

test('retrigger и destroy не оставляют стекло, таймеры или собственные анимации', async () => {
  const f = fixture()
  try {
    await f.arm(); f.effects.go(1, 0); f.advance(200)
    await f.arm(); assert.equal(f.commits.length, 1, 'Незавершённый первый переход завершён один раз')
    f.effects.go(1, 0); f.advance(1500)
    assert.equal(f.commits.length, 2)
    f.effects.destroy()
    assert.equal(f.deck.hasAttribute('data-buddy-effects'), false)
    assert.equal(f.rafs.size, 0); assert.equal(f.timers.size, 0)
    assert.ok(f.animations.every(a => a.cancelled))
    assert.ok(f.nodes.filter(n => /^fx-/.test(n.className)).every(n => !n.parentNode))
  } finally { f.close() }
})

test('повтор intro освобождает ownership старого стекла, destroy — все собственные ресурсы', async () => {
  const source = readFileSync(effectsURL, 'utf8'), marker = '  return Object.freeze({\n    armIntro',
    probe = `  return Object.freeze({
    qaResources() {
      const connected = node => { for (let at = node; at; at = at.parentNode) if (at === deck) return true; return false; };
      return { nodes: nodes.size, detached: [...nodes].filter(node => !connected(node)).length,
        timers: timers.size, intervals: intervals.size, raf: framesPending.size, parts: parts.length };
    },
    armIntro`
  assert.equal(source.split(marker).length, 2, 'Проба добавляется только в известную точку копии исходника')
  const { attachDeckEffects: instrumented } = await import('data:text/javascript;base64,' + Buffer.from(source.replace(marker, probe)).toString('base64')),
    f = fixture({ attach: instrumented, keyboard: true })
  try {
    for (let i = 0; i < 3; i++) {
      await f.arm()
      const resources = f.effects.qaResources()
      assert.equal(resources.detached, 0, 'Owned Set не удерживает прошлые отсоединённые поддеревья')
      assert.ok(resources.nodes <= f.effects.glass.n * 2 + 4, 'Память ограничена текущими осколками, тенями и четырьмя служебными узлами')
    }
    for (let i = 0; i < 3; i++) {
      if (i) await f.arm()
      f.effects.go(1, 0); f.advance((i + 1) * 8000)
      assert.equal(f.effects.glass, null, 'Нормальный переход завершён')
      assert.deepEqual(f.effects.qaResources(), { nodes: 2, detached: 0, timers: 0, intervals: 0, raf: 0, parts: 0 },
        'Завершение интро освобождает стекло, flash и ring без ожидания следующего armIntro')
    }
    for (let i = 0; i < 3; i++) f.key('KeyT') // none → push → clean → iris
    f.advance(26000)
    for (let i = 0; i < 3; i++) {
      f.effects.go(i % 2, 1 - i % 2); f.advance(28000 + i * 2000)
      assert.deepEqual(f.effects.qaResources(), { nodes: 2, detached: 0, timers: 0, intervals: 0, raf: 0, parts: 0 },
        'Диафрагма освобождает overlay и ring после каждого перехода')
    }
    await f.arm(); f.setReduced(true); await Promise.resolve()
    assert.deepEqual(f.effects.qaResources(), { nodes: 2, detached: 0, timers: 0, intervals: 0, raf: 0, parts: 0 },
      'Reduced motion освобождает transient ownership')
    f.setReduced(false); await Promise.resolve(); await f.arm()
    f.effects.go(1, 0); f.advance(200)
    f.effects.destroy(); f.effects.destroy()
    assert.deepEqual(f.effects.qaResources(), { nodes: 0, detached: 0, timers: 0, intervals: 0, raf: 0, parts: 0 })
    assert.ok(f.nodes.filter(node => node.tagName === 'canvas' && /^fx-/.test(node.className))
      .every(node => node.width === 0 && node.height === 0), 'Освобождены backing stores собственных canvas')
  } finally { f.close() }
})

test('reduced motion переключает слайд без стекла и разлёта', () => {
  const f = fixture({ reduced: true })
  try {
    assert.equal(f.effects.armIntro(), false)
    assert.equal(f.effects.glass, null)
    f.effects.go(1, 0)
    assert.equal(f.commits.length, 1)
    assert.equal(f.animations.length, 0)
    assert.equal(f.deck.classList.contains('fx-intro'), false)
    assert.equal(f.deck.classList.contains('fx-armed'), false)
  } finally { f.close() }
})

test('живое включение reduced motion запрещает следующий разлом', () => {
  const f = fixture()
  try {
    f.setReduced(true)
    assert.equal(f.effects.armIntro(), false)
    assert.equal(f.effects.glass, null)
    f.effects.go(1, 0)
    assert.equal(f.commits.length, 1)
    assert.equal(f.animations.length, 0)
  } finally { f.close() }
})

test('живое включение reduced motion завершает удар один раз и очищает движение', async () => {
  const f = fixture()
  try {
    await f.arm(); f.effects.go(1, 0); f.advance(200)
    f.setReduced(true); await Promise.resolve()
    assert.equal(f.commits.length, 1)
    assert.equal(f.effects.glass, null)
    assert.ok(f.animations.every(animation => animation.cancelled))
    assert.equal(f.timers.size, 0); assert.equal(f.rafs.size, 0)
    assert.equal(f.deck.classList.contains('fx-intro'), false)
    f.advance(3000)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createRuntime } from '../runtime.js'

// Геометрия и время движений проверяются на настоящем ядре, без WebGL и браузерного планировщика.
function fixture(count = 1) {
  class Node {
    constructor(tag = 'g') { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.style = {}; this.classList = { contains: () => false }; }
    setAttribute(key, value) { this.attributes[key] = String(value) }
    getAttribute(key) { return this.attributes[key] ?? null }
    removeAttribute(key) { delete this.attributes[key] }
    appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); for (const child of children) this.appendChild(child) }
    querySelectorAll() { return [] }
    querySelector() { return null }
    getBoundingClientRect() { return { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 } }
    contains(node) { return node === this || this.children.some(child => child.contains(node)) }
  }
  let current = 0
  const mutations = []
  const slides = Array.from({ length: count }, () => new Node('section')), deck = new Node('div'), host = new Node('div'),
    previous = new Map(), names = ['document', 'matchMedia', 'MutationObserver', 'NodeFilter', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'getComputedStyle'],
    observer = class {
      constructor(fn) { this.fn = fn; this.targets = new Set(); mutations.push(this) }
      observe(target) { this.targets.add(target) }
      disconnect() { this.targets.clear() }
    }, globals = {
      document: { hidden: false, createElementNS: (_, tag) => new Node(tag), createElement: tag => new Node(tag),
        createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({}), addEventListener() {}, removeEventListener() {} },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      MutationObserver: observer, NodeFilter: { SHOW_TEXT: 4 },
      requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {},
      getComputedStyle: () => ({ backgroundColor: 'rgba(0,0,0,0)', borderTopWidth: '0', fontSize: '16' })
    }
  for (const [i, slide] of slides.entries()) slide.classList.contains = name => name === 'on' && current === i
  deck.querySelectorAll = selector => selector === ':scope > .slide' ? slides : []
  for (const name of names) { previous.set(name, globalThis[name]); globalThis[name] = globals[name] }
  const raw = createRuntime({ deck, host, autonomous: false, renderer: 'svg' })
  raw.manual(true); raw.seed(14); raw.progress(1); raw.rescan(); raw.reset()
  return { raw, host, show(index) { current = index }, flushMutation() {
    for (const observer of mutations) if (observer.targets.has(slides[current]))
      observer.fn([{ target: slides[current], type: 'attributes', attributeName: 'class' }])
  }, close() {
    raw.destroy()
    for (const [name, value] of previous) value === undefined ? delete globalThis[name] : globalThis[name] = value
  } }
}

const finitePose = raw => {
  for (const [name, value] of Object.entries(raw.B.pose))
    if (name !== 'still') assert.ok([].concat(value).every(Number.isFinite), `Нечисловой канал ${name}`)
  for (const name of ['x', 'y', 'yaw', 'yawV', 'scale', 'sq', 'sqV']) assert.ok(Number.isFinite(raw.B[name]), `Нечисловое состояние ${name}`)
}

test('смена слайда очищает память прежней площадки и паузу подъёма', () => {
  const f = fixture(2)
  try {
    f.raw.B.topSurf = { kind: 'plat' }; f.raw.B.topSince = f.raw.W.time; f.raw.B.downAt = f.raw.W.time
    f.show(1); f.raw.rescan()
    assert.equal(f.raw.B.topSurf, null)
    // пауза снята; крюку на пустом слайде мешает уже только геометрия, а не пауза
    assert.doesNotMatch(f.raw.availability('grapple') ?? '', /пауза/)
    assert.equal(f.raw.availability('climb'), null)
  } finally { f.close() }
})

test('приветствие раскрывает ближнюю ладонь и возвращает пальцы в покой без скачка', () => {
  for (const face of [-1, 1]) {
    const f = fixture()
    try {
      f.raw.B.face = face; f.raw.run(['wave'])
      const side = face > 0 ? 0 : 1
      let previous = 0, peak = 0, maxStep = 0
      for (let frame = 0; frame < 180; frame++) {
        f.raw.step(1 / 60)
        const open = f.raw.B.pose.handOpen || [0, 0]
        assert.equal(open[1 - side], 0, 'Вторая кисть остаётся в покое')
        peak = Math.max(peak, open[side]); maxStep = Math.max(maxStep, Math.abs(open[side] - previous)); previous = open[side]
      }
      assert.ok(peak > .95, 'Видимая зрителю ладонь раскрыта во время махания')
      assert.ok(maxStep < .1, 'Пальцы раскрываются и закрываются плавно')
      assert.equal(previous, 0, 'После приветствия не остаётся раскрытая кисть')
    } finally { f.close() }
  }
})

test('зевок прикрывает рот ближней рукой и оставляет вторую руку опущенной', () => {
  const rows = []
  for (const face of [-1, 1]) for (const time of [.8, 1.4, 2.1]) {
    const f = fixture()
    try {
      f.raw.B.face = face; f.raw.seed(14); f.raw.run(['yawn']); f.raw.step(time, 120)
      const side = face > 0 ? 0 : 1, k = f.raw.B.kk,
        distance = Math.hypot(...k.arms[side].hand.map((value, axis) => value - k.head[axis])),
        otherDrop = k.arms[1 - side].hand[1] - k.shC[1]
      rows.push({ face, time, distance, otherDrop, mouth: f.raw.B.pose.mouth })
    } finally { f.close() }
  }
  for (const row of rows) {
    assert.ok(row.distance < 15, `Кисть у лица, а не над плечом: ${JSON.stringify(row)}`)
    assert.ok(row.otherDrop > 10, 'Вторая рука расслаблена вдоль тела')
    assert.ok(row.mouth > .4, 'Открытый рот сохраняет смысл зевка')
  }
})

test('reset из перевёрнутой позы возвращает стойку без старой угловой инерции', () => {
  const f = fixture()
  try {
    f.raw.run(['handstand']); f.raw.step(3)
    assert.ok(f.raw.B.pose.rot > 150, 'Сначала действительно стоит на руках')
    f.raw.reset()
    assert.ok(Math.abs(f.raw.B.pose.rot) < 1, 'Сброс не смешивается с перевёрнутой позой')
    assert.ok(Math.abs(f.raw.B.yawV) < 1)
    assert.ok(f.raw.B.y > 665 && f.raw.B.y < 690)
    finitePose(f.raw)
  } finally { f.close() }
})

test('прерывание очищает изменение размера, цвета, прозрачности и портал', () => {
  const f = fixture()
  try {
    for (const id of ['hulk', 'shrink', 'smoke', 'portal', 'clone']) {
      f.raw.reset(); f.raw.run([id]); f.raw.step(2)
      f.raw.run(['wave'])
      for (const name of ['scale', 'scaleT', 'alpha', 'alphaT']) assert.equal(f.raw.B[name], 1, `${id}: ${name}`)
      for (const name of ['tint', 'tintT', 'jitter']) assert.equal(f.raw.B[name], 0, `${id}: ${name}`)
      assert.equal(f.raw.B.clip, null); assert.equal(f.raw.B.clone, null)
      assert.equal(f.raw.B.fxs.length, 0)
      finitePose(f.raw)
    }
  } finally { f.close() }
})

test('destroy освобождает ссылки на временные эффекты и очередь', () => {
  for (const id of ['smoke', 'lightning', 'portal']) {
    const f = fixture()
    try {
      f.raw.run([id, 'wave']); f.raw.step(.6)
      assert.ok(f.raw.B.fxs.length > 0, `${id}: эффекты действительно созданы`)
      f.raw.destroy()
      assert.equal(f.raw.B.fxs.length, 0, `${id}: эффекты не удерживаются отключённым экземпляром`)
      assert.equal(f.raw.B.queue.length, 0, `${id}: очередь освобождена`)
      assert.equal(f.raw.B.act, null, `${id}: замыкание старого действия освобождено`)
      f.raw.destroy()
    } finally { f.close() }
  }
})

test('прерывание полёта сохраняет высоту и сначала завершает падение', () => {
  const f = fixture()
  try {
    assert.ok(f.raw.scene('leap')); f.raw.step(.35)
    const height = f.raw.B.y
    f.raw.run(['wave'])
    assert.equal(f.raw.B.act.name, 'fall')
    assert.equal(f.raw.B.y, height, 'Нет мгновенного перемещения на пол')
    f.raw.step(12)
    assert.equal(f.raw.B.mode, 'ground')
    assert.equal(f.raw.B.surf.kind, 'floor')
    finitePose(f.raw)
  } finally { f.close() }
})

test('низкая частота кадров ручного прогона сохраняет кинематику 60 Гц', () => {
  const states = []
  for (const fps of [1, 10, 60]) {
    const f = fixture()
    try {
      f.raw.run(['dance']); f.raw.step(3, fps)
      finitePose(f.raw)
      states.push({ pose: f.raw.B.pose, x: f.raw.B.x, y: f.raw.B.y, yaw: f.raw.B.yaw, sq: f.raw.B.sq })
    } finally { f.close() }
  }
  assert.deepEqual(states[0], states[2]); assert.deepEqual(states[1], states[2])
})

test('серия дробных step сохраняет переданную длительность без округления к кадрам', () => {
  for (const frames of [24, 120]) {
    const f = fixture()
    try {
      f.raw.run(['dance'])
      const start = f.raw.W.time
      for (let index = 0; index < frames; index++) f.raw.step(1 / frames)
      assert.ok(Math.abs(f.raw.W.time - start - 1) < 1e-10,
        `${frames} вызовов step(1/${frames}) должны продвинуть модель на одну секунду`)
      assert.ok(Math.abs(f.raw.B.act.t - 1) < 1e-10, 'Время действия совпадает с модельным временем')
      finitePose(f.raw)
    } finally { f.close() }
  }
})

test('обычные действия завершаются с конечной позой; повторы не накапливают углы', () => {
  const f = fixture(), ids = ['wave', 'clap', 'point', 'cheer', 'dance', 'stroll', 'jog', 'hop', 'stumble',
    'stretch', 'squats', 'jacks', 'toeTouch', 'sideBend', 'shadowbox', 'kick', 'sitRest', 'sitLean',
    'handstand', 'backflip', 'popcorn', 'read', 'note']
  try {
    for (const id of ids) {
      f.raw.reset(); f.raw.run([id]); f.raw.step(26)
      finitePose(f.raw)
      assert.equal(f.raw.B.mode, 'ground', `${id}: вернулся на опору`)
      assert.equal(f.raw.B.act.name, 'idle', `${id}: действие завершено`)
      assert.ok(Math.abs(f.raw.B.pose.hp) < 70, `${id}: голова не накапливает наклон`)
      assert.equal(f.raw.B.scale, 1)
    }
  } finally { f.close() }
})

test('способности на свободном полу возвращают обычные масштаб, цвет и видимость', () => {
  const f = fixture(), ids = ['levitate', 'shield', 'laser', 'shrink', 'smoke', 'lightning', 'fire',
    'ice', 'portal', 'speed', 'clone', 'fly', 'hulk']
  try {
    for (const id of ids) {
      f.raw.reset(); f.raw.run([id]); f.raw.step(30)
      finitePose(f.raw)
      assert.equal(f.raw.B.mode, 'ground', `${id}: вернулся на пол`)
      assert.equal(f.raw.B.act.name, 'idle', `${id}: действие завершено`)
      assert.equal(f.raw.B.scale, 1, `${id}: исходный масштаб`)
      assert.ok(f.raw.B.alpha > .999, `${id}: исходная видимость`)
      assert.ok(f.raw.B.tint < .001, `${id}: исходный цвет`)
      assert.equal(f.raw.B.clip, null); assert.equal(f.raw.B.clone, null)
      assert.equal(f.raw.B.fxs.length, 0, `${id}: временные эффекты исчезли`)
    }
  } finally { f.close() }
})

test('синхронная смена слайда до команды не ждёт MutationObserver и не сбрасывает новую команду позже', () => {
  const f = fixture(2)
  try {
    assert.equal(f.raw.W.idx, 0)
    f.show(1); f.raw.ensureWorld()
    assert.equal(f.raw.W.idx, 1)
    assert.equal(f.raw.W.li, 3, 'Смелость соответствует новому слайду')
    f.raw.run(['wave'])
    f.flushMutation()
    assert.equal(f.raw.B.act.name, 'wave', 'Поздний observer не сбрасывает начавшийся жест')
    f.show(0); f.raw.rescan()
    assert.equal(f.raw.W.idx, 0, 'Явный rescan тоже синхронизирует навигацию')
  } finally { f.close() }
})

test('отказ геометрического планировщика не считается запущенной командой', () => {
  const f = fixture()
  try {
    assert.ok(f.raw.availability('pullups'), 'Пустой слайд не имеет кромки для подтягиваний')
    assert.ok(f.raw.availability('tracker'), 'Пустой слайд не имеет плитки для отметки готовности')
    assert.equal(f.raw.run(['pullups']), false)
    assert.equal(f.raw.B.act.name, 'idle', 'Запасная стойка не выдаётся за запущенный приём')
    assert.equal(f.raw.run(['wave']), true)
    assert.equal(f.raw.B.act.name, 'wave')
  } finally { f.close() }
})

test('постановочная сцена очищает цвет и эффекты прерванной способности', () => {
  const f = fixture()
  try {
    f.raw.run(['hulk', 'wave']); f.raw.step(2)
    assert.ok(f.raw.B.tint > 0, 'Сначала способность действительно меняет цвет')
    assert.equal(f.raw.scene('leap'), true)
    assert.equal(f.raw.B.tint, 0); assert.equal(f.raw.B.tintT, 0)
    assert.equal(f.raw.B.fxs.length, 0)
    assert.equal(f.raw.B.queue.length, 0, 'Предыдущая очередь не исполняется после новой сцены')
    assert.equal(f.raw.B.act.name, 'leap')
    finitePose(f.raw)
  } finally { f.close() }
})

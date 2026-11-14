import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { techniques } from '../index.js'
import { createPreviewCamera } from '../camera.js'
import { logos as y360Logos } from '../presets/y360.js'

/** Выполняет настоящий модуль стенда; браузерные элементы и библиотека заменены по их интерфейсу. */
async function demo() {
  class Element {
    constructor() {
      this.dataset = {}; this.attributes = {}; this.children = []; this.options = []; this.listeners = new Map()
      this.style = {}; this.value = ''; this.checked = false; this.textContent = ''
      const classes = new Set()
      this.classList = { add: name => classes.add(name), contains: name => classes.has(name),
        toggle: (name, on) => { on ? classes.add(name) : classes.delete(name) } }
    }
    getBoundingClientRect() { return { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 } }
    setAttribute(name, value) { this.attributes[name] = String(value) }
    append(...children) { this.children.push(...children) }
    add(option) { this.options.push(option) }
    get selectedOptions() { return (this.options.length ? this.options : this.children).filter(option => option.value === this.value) }
    replaceChildren(...children) { this.children = children }
    addEventListener(type, fn) { this.listeners.set(type, fn) }
    closest() { return this.dataset.id ? this : null }
  }
  const elements = new Map(), element = id => {
    if (!elements.has(id)) elements.set(id, new Element())
    return elements.get(id)
  }, names = ['empty', 'platforms', 'stairs', 'finale', 'image', 'numbers', 'divider', 'context-text', 'context-keywords', 'context-cards',
    'context-values', 'context-images', 'context-chart', 'context-bars', 'context-route', 'context-flow', 'context-list', 'context-detail', 'intro'],
    slides = names.map(name => { const slide = new Element(); slide.dataset.scene = name; return slide }),
    stage = element('stage'), brand = new Element(), conceptElement = new Element(), created = [], played = []
  let selectedSource = null, contextRevision = 0
  stage.children = [...slides, brand]
  stage.querySelectorAll = () => stage.children.filter(node => node.dataset.scene)
  stage.querySelector = selector => selector.includes('demo-concept') ? conceptElement : brand
  stage.insertBefore = (child, before) => {
    stage.children = stage.children.filter(node => node !== child)
    stage.children.splice(stage.children.indexOf(before), 0, child)
  }
  stage.prepend = child => { stage.children = [child, ...stage.children.filter(node => node !== child)] }
  slides[0].classList.add('on')
  element('scene').value = 'empty'
  element('scene').options = names.map(value => ({ value, textContent: value }))
  const activeScene = () => slides.find(slide => slide.classList.contains('on'))?.dataset.scene,
    createBuddy = async options => {
      const buddy = { presets: { ...options.presets }, logos: options.logos, paused: false, reducedMotion: false, act: 'idle', dead: false,
        progress() {}, rescan() { contextRevision++ }, setReactions() {}, setProfile() {},
        context() {
          const kind = { numbers: 'number', 'context-text': 'text', 'context-keywords': 'keyword', 'context-cards': 'card',
            'context-values': 'values', 'context-images': 'images', 'context-chart': 'chart', 'context-bars': 'bars',
            'context-route': 'route', 'context-flow': 'flow', 'context-list': 'list', 'context-detail': 'detail' }[activeScene()],
            facts = kind ? [{ id: 'source:' + kind, kind, text: kind === 'number' ? '42%' : 'Контекст', priority: 400,
              concept: element('contextConcept').value || 'memory', target: {x:400,y:300,width:200,height:80},reason:'Метка' }] : []
          if (kind === 'keyword') facts.push({ id: 'source:object', kind: 'object', text:'Облако',priority:390,target:{x:900,y:300,width:160,height:160},reason:'Метка' })
          return { facts, selectedId: selectedSource, measures: contextRevision, available: true, reason: 'Автовыбор' }
        },
        selectContext(id) { selectedSource = id },
        sequence(ids) { return this.play(ids.at(-1)) },
        framing() { return { actor: [610, 650, 670, 710], props: null, planned: null } },
        intelligence: { state: () => ({ measures: 1, analysis: null }), inspect: () => ({ analysis: null, candidates: [], world: null, verdict: { reason: 'Выключено' }, last: {} }) }, reset() { this.act = 'idle'; selectedSource = null; contextRevision++ }, autoplay() {}, setMode(id) { this.mode = id; this.profile = id === 'show' ? 'show' : 'live' },
        pause() { this.paused = true }, resume() { this.paused = false }, step() {}, say() {},
        destroy() { this.dead = true },
        can(id) {
          if (['disk', 'mail', 'tracker', 'calendar'].includes(id) && !this.presets.y360) return 'Пресет выключен'
          if (id === 'tracker' && activeScene() !== 'platforms') return 'Нет плитки'
          const metadata = techniques.find(item => item.id === id), snapshot = this.context()
          if (metadata?.contextKinds && !snapshot.facts.some(fact => (!selectedSource || fact.id === selectedSource) && metadata.contextKinds.includes(fact.kind))) return 'No compatible source'
          return null
        },
        play(id) {
          const reason = this.can(id)
          if (reason) throw new Error(reason)
          this.act = id; played.push({ id, scene: activeScene(), preset: this.presets.y360 }); return true
        },
        state() { return { act: this.act, x: 640, y: 680, renderer: 'svg', paused: this.paused, surf: 'floor', level: 3 } }
      }
      created.push(buddy); return buddy
    }, html = await readFile(new URL('../index.html', import.meta.url), 'utf8'),
    source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .+ from .+\n/gm, ''),
    controller = () => ({ pause() {}, resume() {}, destroy() {} }),
    context = { document: { getElementById: element, createElement: () => new Element() },
      techniques, createBuddy, createPreviewCamera, y360Logos, attachSlideIntelligence: controller, attachDeckEffects: controller,
      Option: class { constructor(text, value) { this.textContent = text; this.value = value } },
      ResizeObserver: class { observe() {} }, requestAnimationFrame: () => 0, setTimeout, console }
  runInNewContext(source, context)
  const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)) },
    click = id => {
      const button = element('list').children.find(node => node.dataset?.id === id)
      assert.ok(button, `${id}: приём доступен в каталоге`)
      element('list').listeners.get('click')({ target: button })
    }, update = () => runInNewContext('update(1000)', context)
  await settle()
  return { element, created, played, click, settle, update, activeScene }
}

test('клик на диск, письмо и готовность включает Я360 и запускает выбранный номер', async () => {
  const d = await demo()
  assert.equal(d.created[0].presets.y360, false, 'Начальная настройка библиотеки остаётся выключенной')
  assert.equal(Object.keys(d.created[0].logos).length, 0)
  for (const id of ['disk', 'mail', 'tracker']) {
    d.click(id); await d.settle(); d.update()
    assert.deepEqual(d.played.at(-1), { id, scene: id === 'tracker' ? 'platforms' : 'empty', preset: true })
    assert.equal(d.element('y360').checked, true)
    assert.equal(d.created.at(-1).logos, y360Logos, 'Стенд явно передал отдельный набор изображений')
    assert.match(d.element('status').textContent, /Y360 example enabled/)
  }
  assert.equal(d.created.length, 2, 'Пресет подключается один раз, не при каждом клике')
  assert.notEqual(d.element('overview').attributes['aria-pressed'], 'true', 'Автокадр не заменяется ручным режимом при выборе номера')
})

test('ручное выключение Я360 сохраняется до следующего явного запуска фирменного номера', async () => {
  const d = await demo()
  d.click('disk'); await d.settle()
  const count = d.played.length
  d.element('y360').checked = false
  await d.element('y360').listeners.get('change')(); await d.settle(); d.update()
  assert.equal(d.created.at(-1).presets.y360, false)
  assert.equal(d.played.length, count, 'Выключение не запускает выключенный приём заново')
  assert.match(d.element('status').textContent, /Y360 example is off/)
  d.click('mail'); await d.settle()
  assert.equal(d.played.at(-1).id, 'mail')
  assert.equal(d.created.at(-1).presets.y360, true)
})

test('картинка и явный общий план сохраняются при жесте, фонарике и ловле звезды', async () => {
  const d = await demo()
  d.element('scene').value = 'image'
  await d.element('scene').listeners.get('change')()
  for (const id of ['yawn', 'present', 'spotlight']) {
    d.click(id); await d.settle()
    assert.equal(d.played.at(-1).scene, 'image')
  }
  assert.equal(d.element('zoom').attributes['aria-pressed'], 'false', 'Выбранный общий план сохраняется')
  d.click('starcatch'); await d.settle()
  assert.equal(d.element('zoom').attributes['aria-pressed'], 'false', 'Падение звезды начинается в общем плане')
})

test('быстрый выбор другого номера во время подключения не возвращает старый выбор', async () => {
  const d = await demo()
  d.click('disk'); d.click('mail'); await d.settle()
  assert.equal(d.played.at(-1).id, 'mail')
  assert.equal(d.created.filter(buddy => !buddy.dead).length, 1)
  assert.equal(d.element('title').textContent, techniques.find(item => item.id === 'mail').title)
})


test('ручной крупный план не сбрасывается сменой приёма', async () => {
  const d = await demo()
  d.element('zoom').listeners.get('click')()
  for (const id of ['yawn', 'starcatch', 'celebrate']) { d.click(id); await d.settle() }
  assert.equal(d.element('zoom').attributes['aria-pressed'], 'true')
  assert.equal(d.element('overview').attributes['aria-pressed'], 'false')
})


test('ручной номер сохраняет выбранный режим самостоятельной жизни', async () => {
  const d = await demo()
  d.element('mode').value = 'companion'
  d.element('mode').listeners.get('change')()
  d.click('yawn'); await d.settle()
  assert.equal(d.element('mode').value, 'companion')
  assert.equal(d.played.at(-1).id, 'yawn')
})


test('новый числовой номер готовит источник и не сбрасывает ручной план', async () => {
  const d = await demo()
  d.element('zoom').listeners.get('click')()
  d.click('thinkNumber'); await d.settle(); d.update()
  assert.equal(d.activeScene(), 'numbers')
  assert.equal(d.played.at(-1).id, 'thinkNumber')
  assert.equal(d.element('zoom').attributes['aria-pressed'], 'true')
  assert.match(d.element('contextSummary').textContent, /42%/)
})

test('ручной несовместимый факт не заменяется другим; подбор истории использует выбранный объект', async () => {
  const d = await demo()
  d.element('scene').value = 'context-keywords'
  d.element('scene').listeners.get('change')()
  d.element('contextSource').value = 'source:object'
  d.element('contextSource').listeners.get('change')()
  const count = d.played.length
  d.click('hologramKeyword'); await d.settle(); d.update()
  assert.equal(d.played.length, count)
  assert.equal(d.activeScene(), 'context-keywords')
  assert.match(d.element('status').textContent, /source/i)
  d.element('contextPlay').listeners.get('click')(); await d.settle()
  assert.equal(d.played.at(-1).id, 'hologramObject')
  assert.equal(d.element('group').value, 'Slide context')
  assert.equal(d.created.at(-1).context().selectedId, 'source:object')
})

test('структурные истории готовят совместимый источник, а подбор сохраняет ручной выбор и камеру', async () => {
  const cases = [['compareValues', 'values'], ['showBeforeAfter', 'images'], ['followChart', 'chart'],
    ['chartClimb', 'bars'], ['cardRoute', 'route'], ['traceFlow', 'flow'], ['assembleList', 'list'], ['inspectDetail', 'detail']]
  for (const [id, kind] of cases) {
    const d = await demo()
    d.element('zoom').listeners.get('click')()
    d.click(id); await d.settle(); d.update()
    assert.equal(d.played.at(-1).id, id)
    assert.equal(d.created.at(-1).context().facts[0].kind, kind)
    const scene = d.activeScene()
    d.element('contextSource').value = 'source:' + kind
    d.element('contextSource').listeners.get('change')()
    d.element('contextPlay').listeners.get('click')(); await d.settle()
    assert.equal(d.played.at(-1).id, id)
    assert.equal(d.activeScene(), scene)
    assert.equal(d.created.at(-1).context().selectedId, 'source:' + kind)
    assert.equal(d.element('zoom').attributes['aria-pressed'], 'true')
  }
})

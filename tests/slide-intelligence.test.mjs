import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySlideEvidence, createReactionPolicy, attachSlideIntelligence, autoplayProfiles } from '../slide-intelligence.js'

test('общая политика фильтрует и семантическую реакцию, и фоновые номера', () => {
  const d = director({ profile: 'show', autoplay: true, attrs: { 'data-buddy-react': 'dance' }, allowAutomatic: id => id === 'wave' })
  try {
    d.advance(180000)
    assert.ok(d.actions.length > 0)
    assert.ok(d.actions.every(action => action.id === 'wave'))
  } finally { d.close() }
})

function director(options = {}) {
  let time = 0, serial = 0
  const timers = new Map(), previous = new Map(), actions = [], looks = [], listeners = new Map(), mutationCallbacks = [],
    element = (attrs = {}, text = '') => ({
      textContent: text, hidden: false, parentElement: null, style: {}, nodeType: 1,
      getAttribute: key => attrs[key] ?? null, hasAttribute: key => key in attrs,
      setAttribute: (key, value) => { attrs[key] = value },
      classList: { contains: key => (attrs.class || '').split(' ').includes(key) },
      querySelector: () => null, querySelectorAll: () => [], closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      events: new Map(),
      addEventListener(name, fn) { this.events.set(name, fn) }, removeEventListener(name) { this.events.delete(name) }
    }),
    slide = element({ 'data-buddy-scene': 'content', ...options.attrs }), stage = element(),
    heading = element({}, 'Результат'), brand = element(), perch = element(), brandText = element({}, 'Digital Review'),
    buddyState = { act: 'idle', queue: 0, visible: true, busy: false, surf: 'floor' },
    buddy = { paused: false, reducedMotion: false, state: () => ({ ...buddyState }),
      can: id => options.can?.(id) ?? null,
      play(id) { actions.push({ id, at: time }); if (options.notifyOnPlay) controller.activity(); return true },
      lookAt(point) { looks.push(point) } },
    globals = {
      performance: { now: () => time }, setTimeout(fn, delay = 0) { const id = ++serial; timers.set(id, { fn, at: time + delay }); return id },
      clearTimeout: id => timers.delete(id),
      document: { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
      getComputedStyle: node => ({ display: 'block', visibility: 'visible', opacity: '1', fontSize: '48', ...node.style }),
      MutationObserver: class {
        constructor(callback) { this.callback = callback; mutationCallbacks.push(this) }
        observe(_target, options) { this.options = options }
        disconnect() {}
      }, ResizeObserver: undefined,
      matchMedia: () => ({ addEventListener: (name, fn) => listeners.set(`motion:${name}`, fn),
        removeEventListener: name => listeners.delete(`motion:${name}`) })
    }
  stage.querySelector = selector => selector === '.brand' ? brand : selector.includes('.slide') ? slide : null
  stage.querySelectorAll = selector => selector === ':scope > .slide' ? [slide] : []
  slide.querySelector = selector => selector === 'h1, h2' ? heading : null
  brand.querySelector = selector => selector === '[data-perch]' ? perch : selector === '[data-perch-text]' ? brandText : null
  for (const [name, value] of Object.entries(globals)) { previous.set(name, globalThis[name]); globalThis[name] = value }
  const controller = attachSlideIntelligence({ stage, buddy, ...options }),
    advance = ms => {
      const end = time + ms
      let iterations = 0
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        assert.ok(iterations++ < 10000, 'Планировщик не зациклен')
        time = next[1].at; timers.delete(next[0]); next[1].fn()
      }
      time = end
    }
  return { controller, buddy, buddyState, actions, looks, timers, stage, slide, element, advance,
    mutate(records) {
      for (const observer of mutationCallbacks) {
        const accepted = records.filter(record => !record.attributeName || !observer.options.attributeFilter
          || observer.options.attributeFilter.includes(record.attributeName))
        if (accepted.length) observer.callback(accepted)
      }
    },
    input(target, type = 'change') { stage.events.get(type)?.({ target }) },
    visibility(hidden) { document.hidden = hidden; listeners.get('visibilitychange')?.() },
    reduced(on) { buddy.reducedMotion = on; listeners.get('motion:change')?.() },
    close() {
      controller.destroy()
      assert.equal(timers.size, 0, 'Все таймеры контроллера сняты')
      for (const [name, value] of previous) value === undefined ? delete globalThis[name] : globalThis[name] = value
    } }
}

test('явная роль и запрет важнее эвристик', () => {
  assert.equal(classifySlideEvidence({ declared: 'image', finale: true, largeNumber: true }).kind, 'image')
  assert.equal(classifySlideEvidence({ declared: 'finale', disabled: true }).kind, 'off')
  assert.equal(classifySlideEvidence({ declared: 'invalid', imageCoverage: .4 }).kind, 'image')
})

test('классификатор различает финал, перебивку, обложку, изображение и число', () => {
  for (const heading of ['Спасибо', 'Спасибо за внимание!', 'Вопросы?', 'Thank you'])
    assert.equal(classifySlideEvidence({ heading }).kind, 'finale')
  assert.equal(classifySlideEvidence({ heading: 'Как спасибо превращается в продукт' }).kind, 'content')
  assert.equal(classifySlideEvidence({ divider: true, imageCoverage: .7 }).kind, 'divider')
  assert.equal(classifySlideEvidence({ cover: true, largeNumber: true }).kind, 'title')
  assert.equal(classifySlideEvidence({ imageCoverage: .299, largeNumber: true }).kind, 'number')
  assert.equal(classifySlideEvidence({ imageCoverage: .3, largeNumber: true }).kind, 'image')
  assert.equal(classifySlideEvidence().kind, 'content')
})

test('тихое окно запрещает реакцию даже при свободном персонаже', () => {
  const policy = createReactionPolicy(), slide = {}
  policy.begin(slide, 1000)
  const verdict = policy.verdict(4999)
  assert.equal(verdict.ready, false)
  assert.equal(verdict.wait, 1)
  assert.equal(policy.verdict(5000).ready, true)
})

test('реакция не перебивает действие и не догоняет пропущенный момент', () => {
  const policy = createReactionPolicy()
  policy.begin({}, 0)
  assert.equal(policy.verdict(5000, { busy: true }).ready, false)
  assert.equal(policy.verdict(5000, { busy: true }).wait, 750)
  assert.equal(policy.verdict(20001).expired, true)
  assert.equal(policy.verdict(20001).ready, false)
})

test('пауза, скрытая вкладка и reduced-motion не расходуют реакцию', () => {
  const policy = createReactionPolicy()
  policy.begin({}, 0)
  for (const flag of ['paused', 'hidden', 'reduced'])
    assert.equal(policy.verdict(5000, { [flag]: true }).ready, false)
  assert.equal(policy.state().consumed, false)
  assert.equal(policy.verdict(5000).ready, true)
})

test('одна реакция на посещение и глобальная пауза между разными слайдами', () => {
  const policy = createReactionPolicy(), first = {}, second = {}
  policy.begin(first, 0)
  policy.consume(5000)
  assert.equal(policy.verdict(6000).ready, false)
  policy.begin(second, 7000)
  assert.equal(policy.verdict(12000).ready, false)
  assert.equal(policy.verdict(12000).wait, 13000)
  assert.equal(policy.verdict(25000).ready, true)
})

test('повторный визит не повторяет номер, даже когда общая пауза закончилась', () => {
  const policy = createReactionPolicy({ staleMs: 120000 }), slide = {}
  policy.begin(slide, 0); policy.consume(5000)
  policy.begin(slide, 30000)
  assert.equal(policy.verdict(35000).wait, 60000)
  assert.equal(policy.verdict(95000).ready, true)
})

test('skip не тратит глобальный бюджет для других слайдов', () => {
  const policy = createReactionPolicy()
  policy.begin({}, 0); policy.skip()
  assert.equal(policy.state().lastReaction, null)
  policy.begin({}, 1000)
  assert.equal(policy.verdict(5000).ready, true)
})

test('настройки времени валидируются до подключения наблюдателей', () => {
  for (const name of ['quietMs', 'cooldownMs', 'revisitMs', 'staleMs', 'debounceMs'])
    for (const value of [-1, Infinity, NaN]) assert.throws(() => createReactionPolicy({ [name]: value }), RangeError)
})

test('профили задают разный ритм и репертуар; seed воспроизводит выбор без подряд идущих повторов', () => {
  const run = profile => {
    const f = director({ profile, seed: 42, autoplay: true, reactions: false })
    try {
      f.advance(600000)
      const allowed = new Set(autoplayProfiles[profile].actions), actions = [...f.actions]
      assert.ok(actions.length > 3)
      assert.ok(actions.every(item => allowed.has(item.id)))
      for (let i = 1; i < actions.length; i++) {
        assert.notEqual(actions[i].id, actions[i - 1].id)
        assert.ok(actions[i].at - actions[i - 1].at >= autoplayProfiles[profile].cooldownMs)
      }
      return actions
    } finally { f.close() }
  }, calm = run('calm'), live = run('live'), show = run('show')
  assert.deepEqual(run('show'), show)
  assert.ok(show.length > live.length && live.length > calm.length)
  assert.ok(!calm.some(item => ['hulk', 'fly', 'comet', 'energyOrb'].includes(item.id)))
  assert.ok(new Set(show.map(item => item.id)).size > 10, 'Шоу сохраняет разнообразие каталога')
})

test('реакции и самостоятельные действия включаются независимо; оба off не оставляют таймеров', () => {
  const f = director({ attrs: { 'data-buddy-scene': 'title', 'data-buddy-react': 'wave' }, autoplay: false, reactions: true })
  try {
    f.advance(6000)
    assert.equal(f.actions[0]?.id, 'wave')
    assert.equal(f.controller.state().last.source, 'semantic')
    f.controller.setReactions(false)
    assert.equal(f.timers.size, 0)
    f.advance(120000); assert.equal(f.actions.length, 1)
    f.controller.setAutoplay(true); f.advance(60000)
    assert.ok(f.actions.length > 1)
    assert.equal(f.controller.state().last.source, 'ambient')
    f.controller.setAutoplay(false)
    assert.equal(f.timers.size, 0)
  } finally { f.close() }
})

test('собственный play контроллера не считается ручным и не меняет seeded ритм', () => {
  const run = notifyOnPlay => {
    const f = director({ profile: 'show', seed: 7, autoplay: true, notifyOnPlay,
      attrs: { 'data-buddy-scene': 'title' } })
    try {
      f.advance(120000)
      return { actions: [...f.actions], policy: f.controller.state().policy, next: f.controller.state().nextAmbientAt }
    } finally { f.close() }
  }
  assert.deepEqual(run(true), run(false))
})

test('ручной номер получает cooldown и пропускает текущую реакцию; занятое действие не перебивается', () => {
  const f = director({ attrs: { 'data-buddy-scene': 'title' }, profile: 'show', autoplay: true })
  try {
    f.advance(1000); f.controller.activity(); f.buddyState.act = 'hulk'; f.buddyState.busy = true
    f.advance(60000)
    assert.equal(f.actions.length, 0)
    assert.equal(f.controller.state().policy.consumed, true)
    f.buddyState.act = 'idle'; f.buddyState.busy = false
    f.advance(1)
    assert.equal(f.actions.length, 0, 'Пропущенный ambient не запускается сразу после номера')
    f.advance(30000)
    assert.ok(f.actions.length > 0)
    const count = f.actions.length
    f.controller.activity(); f.advance(13999)
    assert.equal(f.actions.length, count, 'Ручное действие защищено полной паузой профиля')
  } finally { f.close() }
})

test('пауза, hidden, reduced и смена профиля не прерывают номер и не копят показы', () => {
  const f = director({ profile: 'show', autoplay: true, reactions: false })
  try {
    f.controller.pause(); f.advance(120000)
    assert.equal(f.actions.length, 0)
    f.controller.resume(); f.advance(1)
    assert.equal(f.actions.length, 0)
    f.visibility(true); f.advance(120000)
    assert.equal(f.actions.length, 0)
    f.visibility(false); f.advance(1)
    assert.equal(f.actions.length, 0)
    f.reduced(true); f.advance(120000)
    assert.equal(f.actions.length, 0)
    f.reduced(false); f.advance(500)
    assert.equal(f.actions.length, 0)
    f.controller.setProfile('calm')
    assert.equal(f.controller.state().profile, 'calm')
    f.advance(44999); assert.equal(f.actions.length, 0)
    f.advance(10000); assert.ok(f.actions.length > 0)
  } finally { f.close() }
})

test('inspect читает распознанные цели, опору Digital Review и реальные отказы без повторного DOM-сканирования', () => {
  const world = { walls: [], plats: [], floor: [[200, 1000]], logo: [[20, 150]] },
    f = director({ attrs: { 'data-buddy-scene': 'title', 'data-buddy-react': 'wave' }, autoplay: false, reactions: false,
      can: () => 'Нужна стойка на полу', world: () => world })
  try {
    const before = f.controller.state().measures, first = f.controller.inspect()
    assert.equal(first.analysis.brand.text, 'Digital Review')
    assert.equal(first.analysis.brand.surface, 'avatar')
    assert.ok(first.analysis.brand.techniques.includes('logo'))
    assert.equal(first.candidates[0]?.reason, 'Нужна стойка на полу')
    assert.equal(first.verdict.ready, false)
    assert.deepEqual(first.world.logo, [[20, 150]])
    assert.throws(() => first.world.logo[0][0] = 999, TypeError)
    assert.throws(() => first.analysis.targets.push({}), TypeError)
    for (let i = 0; i < 10; i++) f.controller.inspect()
    assert.equal(f.controller.state().measures, before)
    assert.equal(world.logo[0][0], 20)
    assert.equal(f.timers.size, 0)
  } finally { f.close() }
})

test('анализ DOM сохраняет масштаб цели и не принимает скрытое или игнорируемое медиа за сюжет', () => {
  const f = director({ attrs: { 'data-buddy-scene': null }, reactions: false })
  try {
    const media = f.element(), explicit = f.element()
    f.stage.getBoundingClientRect = () => ({ left: 30, top: 40, width: 640, height: 360 })
    media.getBoundingClientRect = () => ({ left: 100, top: 120, width: 500, height: 200 })
    explicit.getBoundingClientRect = () => ({ left: 230, top: 140, width: 100, height: 50 })
    f.slide.querySelectorAll = selector => selector === 'img, video, svg, canvas' ? [media] : []
    f.slide.querySelector = selector => selector === '[data-buddy-focus]' ? explicit : null
    f.controller.refresh()
    const first = f.controller.inspect().analysis
    assert.equal(first.kind, 'image')
    assert.equal(first.target.kind, 'explicit')
    assert.deepEqual([first.target.x, first.target.y, first.target.width, first.target.height], [500, 250, 200, 100])
    media.closest = selector => selector.includes('data-buddy-ignore') ? media : null
    f.controller.refresh()
    assert.equal(f.controller.state().analysis.kind, 'content')
    media.closest = () => null; media.parentElement = f.element(); media.parentElement.style.display = 'none'
    f.controller.refresh()
    assert.equal(f.controller.state().analysis.kind, 'content')
  } finally { f.close() }
})

test('числовой контекст выбирает нейтральную короткую историю и не повторяет её ambient-номером', () => {
  const fact = { id: 'errors', kind: 'number', text: '42%', reason: 'Выделенный источник', priority: 330,
    target: { x: 640, y: 300, width: 200, height: 80 } },
    contextTechniques = ['thinkNumber', 'traceFocus'].map(id => ({ id, contextKinds: ['number'] })),
    slideContext = { refresh() {}, invalidate() {}, snapshot: () => ({ available: true, facts: [fact], selectedId: null, reason: fact.reason, measures: 1 }),
      resolve: id => contextTechniques.some(item => item.id === id) ? { fact, element: {}, bounds: [540, 260, 740, 340] } : null },
    f = director({ attrs: { 'data-buddy-scene': 'number' }, autoplay: true, slideContext, contextTechniques })
  try {
    f.advance(6000)
    assert.ok(['thinkNumber', 'traceFocus'].includes(f.actions[0]?.id))
    assert.equal(f.controller.state().last.context.text, '42%')
    assert.equal(f.controller.state().last.reason, fact.reason)
    f.advance(180000)
    assert.equal(f.actions.filter(item => ['thinkNumber', 'traceFocus'].includes(item.id)).length, 1)
  } finally { f.close() }
})

test('камерный transform сцены не инвалидирует контекст каждый кадр, а layout-стиль инвалидирует', () => {
  let invalidations = 0
  const slideContext = { refresh() {}, invalidate() { invalidations++ }, snapshot: () => null },
    f = director({ reactions: false, autoplay: false, slideContext })
  try {
    for (let i = 0; i < 20; i++) {
      f.stage.setAttribute('style', `transform:translate(${i}px,10px) scale(2);transform-origin:0 0`)
      f.mutate([{ target: f.stage, attributeName: 'style' }])
    }
    assert.equal(invalidations, 0)
    assert.equal(f.timers.size, 0)
    f.stage.setAttribute('style', 'width:1000px;transform:scale(2)')
    f.mutate([{ target: f.stage, attributeName: 'style' }])
    assert.equal(invalidations, 1)
    f.advance(200)
    assert.equal(f.timers.size, 0)
  } finally { f.close() }
})

test('изменения SVG и responsive IMG инвалидируют проекцию, а собственные эффекты не трогают кэш', () => {
  let invalidations = 0
  const slideContext = { refresh() {}, invalidate() { invalidations++ }, snapshot: () => null },
    f = director({ reactions: false, autoplay: false, slideContext })
  try {
    const source = f.element(), ownEffect = f.element(),
      attributes = ['href', 'xlink:href', 'd', 'fill', 'viewBox', 'stop-color', 'srcset', 'sizes',
        'data-buddy-points', 'data-buddy-crop', 'data-buddy-from', 'data-buddy-step', 'data-buddy-checked']
    source.closest = selector => selector === '.slide' ? f.slide : null
    ownEffect.closest = selector => selector === '.buddy' ? ownEffect : null
    const measures = f.controller.state().measures
    for (const attributeName of attributes) f.mutate([{ target: source, attributeName }])
    assert.equal(invalidations, attributes.length, 'Каждое изменение исходника помечает кэш грязным')
    f.advance(200)
    assert.equal(f.controller.state().measures, measures + 1, 'Серия изменений объединяется в один пересчёт')
    f.mutate(Array.from({ length: 100 }, () => ({ target: ownEffect, attributeName: 'd' })))
    assert.equal(invalidations, attributes.length, 'Кадровая анимация собственного SVG игнорируется')
    assert.equal(f.timers.size, 0)
  } finally { f.close() }
})

test('живой checkbox обновляет структуру по input/change и снимает обработчики при destroy', () => {
  let invalidations = 0
  const slideContext = { refresh() {}, invalidate() { invalidations++ }, snapshot: () => null },
    f = director({ reactions: false, autoplay: false, slideContext })
  try {
    const checkbox = f.element(), own = f.element()
    checkbox.closest = selector => selector === '.slide' ? f.slide : null
    own.closest = selector => selector === '.buddy' ? own : null
    f.input(checkbox, 'input'); f.input(checkbox, 'change')
    assert.equal(invalidations, 2)
    f.advance(200)
    assert.equal(f.timers.size, 0)
    f.input(own); assert.equal(invalidations, 2)
    f.controller.destroy()
    assert.equal(f.stage.events.has('input'), false)
    assert.equal(f.stage.events.has('change'), false)
  } finally { f.close() }
})

test('разные равноприоритетные структуры не выбираются случайно ни semantic, ни ambient', () => {
  let selected = null
  const entries = [{ id: 'compareValues', contextKinds: ['values'] }, { id: 'traceFlow', contextKinds: ['flow'] }],
    facts = [{ id: 'pair', kind: 'values', priority: 440, text: 'Пара', reason: 'Авторская структура' },
      { id: 'flow', kind: 'flow', priority: 440, text: 'Связи', reason: 'Авторская структура' }],
    slideContext = { refresh() {}, invalidate() {}, snapshot: () => ({ available: true, facts, selectedId: selected, reason: '', measures: 1 }),
      resolve(id) {
        const index = entries.findIndex(item => item.id === id), fact = facts[index]
        return fact && (!selected || selected === fact.id) ? { fact, element: {}, bounds: [100, 100, 300, 300] } : null
      } },
    f = director({ profile: 'live', autoplay: true, slideContext, contextTechniques: entries,
      can: id => entries.some(item => item.id === id) ? null : 'Нет условий' })
  try {
    f.advance(180000)
    assert.equal(f.actions.length, 0, 'Равные источники не становятся случайной историей')
    selected = 'pair'; f.controller.refresh(); f.advance(180000)
    assert.deepEqual(f.actions.map(item => item.id), ['compareValues'], 'Явный выбор разрешает одну историю')
  } finally { f.close() }
})

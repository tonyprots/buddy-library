import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeSlideContext, createSlideContext, extractContextNumbers, matchContextConcepts } from '../slide-context.js'

function fixture() {
  let reads = 0
  class Element {
    constructor(tag, text = '', attrs = {}, box = { left: 100, top: 100, width: 300, height: 80 }) {
      this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = attrs; this.children = []; this.style = {}; this.box = box
      this.childNodes = text ? [{ nodeType: 3, nodeValue: text }] : []
    }
    get id() { return this.attrs.id || '' }
    get textContent() { return this.childNodes.map(node => node.nodeType === 3 ? node.nodeValue : node.textContent).join('') }
    getAttribute(name) { return this.attrs[name] ?? null }
    hasAttribute(name) { return name in this.attrs }
    matches(selector) {
      return selector.split(',').some(part => {
        const token = part.trim(), attr = /^(?:([a-z]+))?\[([^=\]]+)(?:="([^"]*)")?\]$/iu.exec(token)
        if (attr) return (!attr[1] || this.tagName.toLowerCase() === attr[1].toLowerCase())
          && this.hasAttribute(attr[2]) && (attr[3] === undefined || this.getAttribute(attr[2]) === attr[3])
        if (token.startsWith('.')) return token.slice(1).split('.').every(name => (this.attrs.class || '').split(' ').includes(name))
        return this.tagName.toLowerCase() === token.toLowerCase()
      })
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null }
    querySelectorAll(selector) {
      if (selector.startsWith(':scope > ')) return this.children.filter(child => child.matches(selector.slice(9)))
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)])
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
    append(child) { child.parentElement = this; this.children.push(child); this.childNodes.push(child); return child }
    contains(element) { return element === this || this.children.some(child => child.contains(element)) }
    getBoundingClientRect() { reads++; return this.box }
  }
  const stage = new Element('div', '', {}, { left: 0, top: 0, width: 1280, height: 720 }),
    slide = stage.append(new Element('section', '', { class: 'slide on' })), previous = globalThis.getComputedStyle,
    make = (...args) => new Element(...args), techniques = [
      { id: 'thinkNumber', contextKinds: ['number'] }, { id: 'hologramKeyword', contextKinds: ['keyword'] },
      { id: 'laptopNotes', contextKinds: ['text', 'number', 'keyword'] },
      { id: 'hologramObject', contextKinds: ['object'] }, { id: 'peekCard', contextKinds: ['card'] },
      { id: 'traceFocus', contextKinds: ['number', 'text', 'keyword', 'object', 'card'] }
    ]
  globalThis.getComputedStyle = element => ({ display: 'block', visibility: 'visible', opacity: '1', fontSize: '48', ...element.style })
  return { stage, slide, make, techniques, get reads() { return reads }, close() {
    previous === undefined ? delete globalThis.getComputedStyle : globalThis.getComputedStyle = previous
  } }
}

test('числа сохраняют точное написание знака, разделителей и единиц без выводов об успехе', () => {
  for (const text of ['−18%', '4,2×', '1 000 ₽', '+18.5%', '$100', '1\u00a0000 ₽', '42 %', '1000 руб.',
    '1,2 млн ₽', '250 тыс. руб.', '3 млн рублей', '12 мс', '5 с', '300 ms'])
    assert.deepEqual(extractContextNumbers(text), [text])
  assert.deepEqual(extractContextNumbers('Ошибки: 42%.'), ['42%'])
  assert.deepEqual(extractContextNumbers('Без изменений: −18% ошибок, 4,2× задержки'), ['−18%', '4,2×'])
  for (const text of ['abc42%', '18.4kilometers', '2026-11-10', '12:30', '42%x']) assert.deepEqual(extractContextNumbers(text), [])
})

test('восемь образов имеют строгие границы слов и исключают отрицания до и после понятия', () => {
  for (const [text, concept] of [['Память', 'memory'], ['target', 'target'], ['Команда', 'team'], ['workflow', 'chain'],
    ['Интеграция API', 'link'], ['cloud', 'cloud'], ['Инструкции', 'rules'], ['Поиск', 'search']])
    assert.equal(matchContextConcepts(text)[0]?.concept, concept)
  for (const text of ['memoryless contextless', 'APIary', 'России Ростов', 'командировка облачность',
    'Нет памяти', 'без контекста', 'память не нужна', 'no memory', 'cloud is not needed'])
    assert.deepEqual(matchContextConcepts(text), [])
  assert.deepEqual(matchContextConcepts('Нет памяти. Правила').map(item => item.concept), ['rules'])
})

test('скрытые источники, подпись, собственный слой и скрытые дети не попадают в факты', () => {
  const f = fixture()
  try {
    const heading = f.slide.append(f.make('h2', '42% ошибок')),
      hidden = heading.append(f.make('strong', ' облако'))
    hidden.style.display = 'none'
    for (const attrs of [{ 'data-buddy-ignore': '' }, { class: 'brand' }, { class: 'buddy' }, { 'aria-hidden': 'true' }]) {
      const parent = f.slide.append(f.make('div', '', attrs)); parent.append(f.make('strong', 'Память 55%'))
    }
    const result = analyzeSlideContext(f.slide, f.stage)
    assert.deepEqual(result.facts.filter(item => item.kind === 'number').map(item => item.text), ['42%'])
    assert.ok(!result.facts.some(item => item.kind === 'keyword'))
    assert.ok(!JSON.stringify(result).includes('55'))
    assert.throws(() => result.facts.push({}), TypeError)
    assert.ok(result.facts.every(item => !('element' in item)))
  } finally { f.close() }
})

test('авторский маркер приоритетнее focus и заголовка; ручной выбор проверяет совместимость и сохраняет ID', () => {
  const f = fixture()
  let manager
  try {
    f.slide.append(f.make('h2', '12%'))
    f.slide.append(f.make('strong', '24%', { 'data-buddy-focus': '' }))
    f.slide.append(f.make('strong', '−18%', { 'data-buddy-context': 'number', 'data-buddy-context-id': 'author-value' }))
    manager = createSlideContext({ stage: f.stage, techniques: f.techniques })
    assert.equal(manager.resolve('thinkNumber').fact.text, '−18%')
    const number = manager.snapshot().facts.find(item => item.text === '24%' && item.kind === 'number')
    manager.select(number.id)
    assert.equal(manager.resolve('thinkNumber').fact.id, number.id)
    assert.equal(manager.resolve('hologramKeyword'), null)
    manager.refresh()
    assert.equal(manager.snapshot().selectedId, number.id)
    assert.throws(() => manager.select('unknown'), RangeError)
    assert.equal(manager.snapshot().selectedId, number.id)
    manager.select(null)
    assert.equal(manager.resolve('thinkNumber').fact.text, '−18%')
  } finally { manager?.destroy(); f.close() }
})

test('равные кандидаты требуют выбора; повторные resolve/snapshot не измеряют DOM', () => {
  const f = fixture()
  let manager
  try {
    f.slide.append(f.make('h2', '42%')); f.slide.append(f.make('h2', '63%'))
    manager = createSlideContext({ stage: f.stage, techniques: f.techniques })
    assert.equal(manager.resolve('thinkNumber'), null)
    const source = manager.snapshot().facts.find(item => item.kind === 'number')
    manager.select(source.id)
    const reads = f.reads, measures = manager.snapshot().measures
    for (let i = 0; i < 50; i++) { manager.resolve('thinkNumber'); manager.snapshot() }
    assert.equal(f.reads, reads)
    assert.equal(manager.snapshot().measures, measures)
    manager.invalidate(); manager.snapshot()
    assert.equal(manager.snapshot().measures, measures + 1)
    manager.destroy()
    assert.equal(manager.resolve('thinkNumber'), null)
    assert.equal(manager.snapshot().available, false)
  } finally { manager?.destroy(); f.close() }
})

test('координаты масштабируются в сцену; объект и карточка остаются разными видами фактов', () => {
  const f = fixture()
  let manager
  try {
    f.stage.box = { left: 30, top: 40, width: 640, height: 360 }
    const image = f.slide.append(f.make('img', '', { alt: 'Лист с заметками', 'data-buddy-focus': '' },
      { left: 230, top: 140, width: 100, height: 50 }))
    f.slide.append(f.make('div', 'Карточка задачи', { 'data-buddy-context': 'card' }))
    manager = createSlideContext({ stage: f.stage, techniques: f.techniques })
    const object = manager.resolve('hologramObject')
    assert.equal(object.element, image)
    assert.deepEqual(object.bounds, [400, 200, 600, 300])
    assert.equal(object.fact.text, 'Лист с заметками')
    assert.equal(manager.resolve('peekCard').fact.kind, 'card')
  } finally { manager?.destroy(); f.close() }
})

test('смена слайда сбрасывает ручной источник; разметка concept задаёт подготовленный образ', () => {
  const f = fixture()
  let manager
  try {
    f.slide.append(f.make('h2', 'Память', { 'data-buddy-context': 'keyword', 'data-buddy-concept': 'memory' }))
    manager = createSlideContext({ stage: f.stage, techniques: f.techniques })
    const first = manager.resolve('hologramKeyword')
    manager.select(first.fact.id)
    f.slide.attrs.class = 'slide'
    const next = f.stage.append(f.make('section', '', { class: 'slide on' }))
    next.append(f.make('h2', 'Облако', { 'data-buddy-context': 'keyword', 'data-buddy-concept': 'cloud' }))
    assert.equal(manager.snapshot().selectedId, null)
    assert.equal(manager.resolve('hologramKeyword').fact.concept, 'cloud')
  } finally { manager?.destroy(); f.close() }
})

test('блочные дети и BR разделяют фразы, а inline единица остаётся рядом с числом', () => {
  const f = fixture()
  try {
    const number = f.slide.append(f.make('h2', '42')); number.append(f.make('span', '%'))
    const card = f.slide.append(f.make('div', '', { 'data-buddy-context': 'card' }))
    card.append(f.make('h3', 'Пример')); card.append(f.make('p', 'Посмотрим'))
    const phrase = f.slide.append(f.make('p', 'Первая', { 'data-buddy-context': 'text' }))
    phrase.append(f.make('br')); phrase.append(f.make('span', 'вторая'))
    const facts = analyzeSlideContext(f.slide, f.stage).facts
    assert.ok(facts.some(item => item.kind === 'number' && item.text === '42%'))
    assert.ok(facts.some(item => item.kind === 'card' && item.text === 'Пример Посмотрим'))
    assert.ok(facts.some(item => item.kind === 'text' && item.text === 'Первая вторая'))
  } finally { f.close() }
})

test('маркер образа не возвращает отрицание в словарь, а цитата требует явного выбора автора', () => {
  const f = fixture()
  try {
    f.slide.append(f.make('h2', 'Память не должна использоваться ни при каких обстоятельствах',
      { 'data-buddy-context': 'keyword', 'data-buddy-concept': 'memory' }))
    const code = f.slide.append(f.make('code', 'cloud'))
    assert.equal(analyzeSlideContext(f.slide, f.stage).facts.filter(item => item.kind === 'keyword').length, 0)
    code.attrs['data-buddy-context'] = 'keyword'
    assert.deepEqual(analyzeSlideContext(f.slide, f.stage).facts.filter(item => item.kind === 'keyword').map(item => item.concept), ['cloud'])
  } finally { f.close() }
})

test('событийное обновление публикует новый источник до уведомления действующего номера', () => {
  const f = fixture(), seen = []
  let manager
  try {
    const source = f.slide.append(f.make('h2', '42%'))
    manager = createSlideContext({ stage: f.stage, techniques: f.techniques,
      onRefresh: () => seen.push(manager.resolve('thinkNumber')?.fact.text ?? null) })
    manager.snapshot()
    source.childNodes[0].nodeValue = '−18%'
    manager.invalidate(); manager.snapshot()
    source.style.display = 'none'
    manager.invalidate(); manager.snapshot()
    assert.deepEqual(seen, ['42%', '−18%', null])
  } finally { manager?.destroy(); f.close() }
})

test('пары значений явные, точные и сопоставимы только при одинаковой единице', () => {
  const f = fixture()
  try {
    const pair = f.slide.append(f.make('div', '', { 'data-buddy-context': 'values', 'data-buddy-context-id': 'pair' })),
      first = pair.append(f.make('strong', '−18%', { 'data-buddy-item': 'before', 'aria-label': 'Было' })),
      second = pair.append(f.make('strong', '+42%', { 'data-buddy-item': 'after', 'data-buddy-label': 'Стало' })),
      values = () => analyzeSlideContext(f.slide, f.stage).facts.find(item => item.kind === 'values')
    assert.deepEqual(values().structure.items.map(item => [item.id, item.value, item.unit]), [['before', '−18%', '%'], ['after', '+42%', '%']])
    assert.deepEqual(values().structure.items.map(item => item.label), ['Было', 'Стало'])
    assert.throws(() => values().structure.items.push({}), TypeError)
    second.childNodes[0].nodeValue = '42 ₽'; assert.equal(values(), undefined)
    const issue = analyzeSlideContext(f.slide, f.stage).issues[0]
    assert.equal(issue.kind, 'values'); assert.match(issue.reason, /units/u)
    assert.throws(() => issue.reason = 'Другое', TypeError)
    first.childNodes[0].nodeValue = '18'; second.childNodes[0].nodeValue = '42'
    assert.deepEqual(values().structure.items.map(item => item.unit), ['', ''])
    first.childNodes[0].nodeValue = '1,2 млн ₽'; second.childNodes[0].nodeValue = '2,4 млн ₽'
    assert.equal(values().structure.items[0].value, '1,2 млн ₽')
    second.childNodes[0].nodeValue = '2400 тыс. ₽'; assert.equal(values(), undefined, 'Масштабы не приравниваются без авторского соответствия')
    first.childNodes[0].nodeValue = '1\u00a0000 ₽'; second.childNodes[0].nodeValue = '2\u00a0000 ₽'
    assert.equal(values().structure.items[0].value, '1\u00a0000 ₽', 'Внутренний пробел исходного числа сохранён')
    second.childNodes[0].nodeValue = '18% и 42%'; assert.equal(values(), undefined, 'Внутри элемента нет угадывания нужного числа')
  } finally { f.close() }
})

test('график берёт только явно помеченную SVG линию и переводит её настоящую матрицу в сцену', () => {
  const f = fixture()
  try {
    f.stage.box = { left: 30, top: 40, width: 640, height: 360 }
    const svg = f.slide.append(f.make('svg', '', { 'data-buddy-context': 'chart' })),
      line = svg.append(f.make('polyline', '', { 'data-buddy-chart-line': '', points: '100,300 200,250 400,100' }))
    line.getScreenCTM = () => ({ a: .5, b: 0, c: 0, d: .5, e: 30, f: 40 })
    const chart = () => analyzeSlideContext(f.slide, f.stage).facts.find(item => item.kind === 'chart')
    assert.deepEqual(chart().structure.points, [{ x: 100, y: 300 }, { x: 200, y: 250 }, { x: 400, y: 100 }])
    assert.deepEqual(chart().structure.items, [])
    delete line.attrs['data-buddy-chart-line']; assert.equal(chart(), undefined)
    line.attrs['data-buddy-chart-line'] = ''; line.attrs['data-buddy-points'] = '[[100,200],["200",300]]'
    assert.equal(chart(), undefined, 'Числовые строки не выдаются за координаты')
    line.attrs['data-buddy-points'] = '[[100,200],[100,200]]'; assert.equal(chart(), undefined)
    line.attrs['data-buddy-points'] = '[[100,200],[1281,300]]'; assert.equal(chart(), undefined)
    line.attrs['data-buddy-points'] = '[[100,200],[300,400]]'
    assert.deepEqual(chart().structure.points, [{ x: 100, y: 200 }, { x: 300, y: 400 }])
  } finally { f.close() }
})

test('path графика дискретизируется в пределах64 точек, закрытые и разорванные пути не угадываются', () => {
  const f = fixture()
  try {
    const svg = f.slide.append(f.make('svg', '', { 'data-buddy-context': 'chart' })),
      path = svg.append(f.make('path', '', { 'data-buddy-chart-line': '', d: 'M100 200L300 100' }))
    path.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    path.getTotalLength = () => 100; path.getPointAtLength = length => ({ x: 100 + length * 2, y: 200 - length })
    const chart = () => analyzeSlideContext(f.slide, f.stage).facts.find(item => item.kind === 'chart')
    assert.equal(chart().structure.points.length, 64)
    assert.deepEqual(chart().structure.points.at(-1), { x: 300, y: 100 })
    path.attrs.d += 'Z'; assert.equal(chart(), undefined)
    path.attrs.d = 'M100 200L300 100M400 200L500 100'; assert.equal(chart(), undefined)
  } finally { f.close() }
})

test('матрица SVG калибруется по viewport при пропущенном WebKit CSS scale, сохраняя viewBox и nested transforms', () => {
  const f = fixture()
  try {
    f.stage.box = { left: 100, top: 40, width: 960, height: 540 }
    const svg = f.slide.append(f.make('svg', '', { 'data-buddy-context': 'chart' },
      { left: 362.5, top: 257.5, width: 570, height: 225 })),
      line = svg.append(f.make('polyline', '', { 'data-buddy-chart-line': '', points: '50,235 210,145 370,190 540,70 710,95' })),
      points = () => analyzeSlideContext(f.slide, f.stage).facts.find(item => item.kind === 'chart')?.structure.points
    svg.clientWidth = 760; svg.clientHeight = 300
    svg.viewBox = { baseVal: { x: 0, y: 0, width: 760, height: 300 } }
    svg.preserveAspectRatio = { baseVal: { align: 6, meetOrSlice: 1 } }
    line.ownerSVGElement = svg
    let rootMatrix = { a: 1, b: 0, c: 0, d: 1, e: 362.5, f: 257.5 }, matrix = rootMatrix
    svg.getScreenCTM = () => rootMatrix; line.getScreenCTM = () => matrix
    assert.deepEqual(points(), [{ x: 400, y: 525 }, { x: 560, y: 435 }, { x: 720, y: 480 }, { x: 890, y: 360 }, { x: 1060, y: 385 }])
    rootMatrix = matrix = { a: .75, b: 0, c: 0, d: .75, e: 362.5, f: 257.5 }
    assert.deepEqual(points(), [{ x: 400, y: 525 }, { x: 560, y: 435 }, { x: 720, y: 480 }, { x: 890, y: 360 }, { x: 1060, y: 385 }], 'Согласованный Chromium CTM не меняется')
    svg.clientWidth = 200; svg.clientHeight = 100; svg.box = { left: 325, top: 190, width: 150, height: 75 }
    svg.viewBox.baseVal = { x: 0, y: 0, width: 100, height: 100 }
    line.attrs.points = '10,10 30,10'
    rootMatrix = { a: 1, b: 0, c: 0, d: 1, e: 362.5, f: 190 }
    matrix = { a: 0, b: 1, c: -1, d: 0, e: 422.5, f: 210 }
    assert.deepEqual(points(), [{ x: 400, y: 230 }, { x: 400, y: 250 }], 'Letterbox и поворот внутренней группы сохраняются')
    svg.preserveAspectRatio.baseVal = { align: 10, meetOrSlice: 2 }
    line.attrs.points = '10,60 90,90'
    rootMatrix = matrix = { a: 2, b: 0, c: 0, d: 2, e: 325, f: 115 }
    assert.deepEqual(points(), [{ x: 320, y: 220 }, { x: 480, y: 280 }], 'slice с xMaxYMax сохраняет исходную область')
    svg.style.transform = 'matrix(0,1,-1,0,0,0)'
    const rejected = analyzeSlideContext(f.slide, f.stage)
    assert.ok(!rejected.facts.some(item => item.kind === 'chart'))
    assert.match(rejected.issues[0].reason, /rotation|skew|reflection/iu)
  } finally { f.close() }
})

test('столбцы и маршрут сохраняют реальные контейнеры и явный порядок частей для геометрического решателя', () => {
  const f = fixture()
  let manager
  try {
    const route = f.slide.append(f.make('div', '', { 'data-buddy-context': 'route' })),
      second = route.append(f.make('article', 'Второй', { 'data-buddy-item': 'b', 'data-buddy-step': '2' })),
      first = route.append(f.make('article', 'Первый', { 'data-buddy-item': 'a', 'data-buddy-step': '1' }))
    manager = createSlideContext({ stage: f.stage, techniques: [{ id: 'cardRoute', contextKinds: ['route'] }] })
    const resolved = manager.resolve('cardRoute')
    assert.deepEqual(resolved.fact.structure.items.map(item => item.id), ['a', 'b'])
    assert.equal(resolved.parts[0].element, first); assert.equal(resolved.parts[1].element, second)
    assert.ok(Object.isFrozen(resolved.parts) && Object.isFrozen(resolved.parts[0].bounds))
    const reads = f.reads
    for (let i = 0; i < 20; i++) manager.resolve('cardRoute')
    assert.equal(f.reads, reads)
    first.style.display = 'none'; assert.equal(manager.resolve('cardRoute'), null, 'Скрытая часть не остаётся разрешённым источником')
    first.style.display = 'block'; second.attrs['data-buddy-step'] = '1'
    manager.invalidate(); assert.equal(manager.resolve('cardRoute'), null)
    route.attrs['data-buddy-context'] = 'bars'; first.attrs['data-buddy-bar'] = 'a'; second.attrs['data-buddy-bar'] = 'b'
    second.attrs['data-buddy-step'] = '2'; first.attrs['data-buddy-value'] = '20%'; second.attrs['data-buddy-value'] = '40%'
    assert.deepEqual(analyzeSlideContext(f.slide, f.stage).facts.find(item => item.kind === 'bars').structure.items.map(item => item.value), ['20%', '40%'])
  } finally { manager?.destroy(); f.close() }
})

test('схема имеет только явные связи между существующими узлами и точные пути', () => {
  const f = fixture()
  try {
    const flow = f.slide.append(f.make('div', '', { 'data-buddy-context': 'flow' })),
      a = flow.append(f.make('div', 'Источник', { 'data-buddy-node': 'a' })),
      b = flow.append(f.make('div', 'Результат', { 'data-buddy-node': 'b' })),
      structure = () => analyzeSlideContext(f.slide, f.stage).facts.find(item => item.kind === 'flow')
    assert.equal(structure(), undefined, 'Близость узлов не создаёт связь')
    const edge = flow.append(f.make('polyline', '', { 'data-buddy-from': 'a', 'data-buddy-to': 'b', 'data-buddy-points': '[[100,100],[300,100]]' }))
    assert.deepEqual(structure().structure.edges, [{ from: 'a', to: 'b', points: [{ x: 100, y: 100 }, { x: 300, y: 100 }] }])
    edge.attrs['data-buddy-to'] = 'missing'; assert.equal(structure(), undefined)
    assert.match(analyzeSlideContext(f.slide, f.stage).issues[0].reason, /node/u)
    edge.attrs['data-buddy-to'] = 'b'; b.style.display = 'none'; assert.equal(structure(), undefined)
    b.style.display = 'block'; b.attrs['data-buddy-node'] = 'a'; assert.equal(structure(), undefined)
    assert.equal(a.textContent, 'Источник')
  } finally { f.close() }
})

test('список повторяет реальное checked, слова о готовности сами не создают галочку', () => {
  const f = fixture()
  try {
    const list = f.slide.append(f.make('ul', '', { 'data-buddy-context': 'list' })),
      first = list.append(f.make('li', 'Готово', { 'data-buddy-item': 'a' })),
      checkbox = first.append(f.make('input', '', { type: 'checkbox' })),
      second = list.append(f.make('li', 'Завершено', { 'data-buddy-item': 'b' })),
      items = () => analyzeSlideContext(f.slide, f.stage).facts.find(item => item.kind === 'list').structure.items
    checkbox.checked = false
    const old = items()
    assert.equal(old[0].checked, false); assert.equal(old[1].checked, undefined)
    checkbox.checked = true; assert.equal(items()[0].checked, true); assert.equal(old[0].checked, false)
    second.attrs['data-buddy-checked'] = 'false'; assert.equal(items()[1].checked, false)
    second.attrs['data-buddy-checked'] = 'true'; assert.equal(items()[1].checked, true)
  } finally { f.close() }
})

test('пара изображений и область детали требуют явных частей, crop лежит внутри настоящего изображения', () => {
  const f = fixture()
  try {
    const source = f.slide.append(f.make('div', '', { 'data-buddy-context': 'images' })),
      first = source.append(f.make('img', '', { 'data-buddy-item': 'before', alt: 'Было' })),
      second = source.append(f.make('img', '', { 'data-buddy-item': 'after', alt: 'Стало' })),
      fact = kind => analyzeSlideContext(f.slide, f.stage).facts.find(item => item.kind === kind)
    assert.deepEqual(fact('images').structure.items.map(item => item.text), ['Было', 'Стало'])
    second.style.display = 'none'; assert.equal(fact('images'), undefined)
    source.attrs['data-buddy-context'] = 'detail'; source.attrs['data-buddy-crop'] = '[120,120,60,40]'
    assert.deepEqual(fact('detail').structure.crop, { x: 120, y: 120, width: 60, height: 40 })
    assert.deepEqual(fact('detail').target, { x: 150, y: 140, width: 60, height: 40 })
    source.attrs['data-buddy-crop'] = '[90,120,60,40]'; assert.equal(fact('detail'), undefined)
    assert.match(analyzeSlideContext(f.slide, f.stage).issues.find(item => item.kind === 'detail').reason, /crop/u)
    source.attrs['data-buddy-crop'] = '[120,120,0,40]'; assert.equal(fact('detail'), undefined)
    first.tagName = 'DIV'; assert.equal(fact('detail'), undefined)
  } finally { f.close() }
})

test('неполная, вложенная или слишком длинная структура не дополняется и не обрезается', () => {
  const f = fixture()
  try {
    const route = f.slide.append(f.make('div', '', { 'data-buddy-context': 'route' }))
    for (let i = 0; i < 9; i++) route.append(f.make('article', `Этап ${i}`, { 'data-buddy-item': `s${i}`, 'data-buddy-step': String(i + 1) }))
    assert.ok(!analyzeSlideContext(f.slide, f.stage).facts.some(item => item.kind === 'route'))
    const flow = f.slide.append(f.make('div', '', { 'data-buddy-context': 'flow' }))
    flow.append(f.make('div', 'Вложенный', { 'data-buddy-node': 'nested' }))
    route.append(flow)
    assert.ok(!analyzeSlideContext(f.slide, f.stage).facts.some(item => item.kind === 'route'))
  } finally { f.close() }
})

test('SVG copy marker измеряется при анализе, запрещает root rotation/skew/reflection и не попадает в публичный факт', () => {
  const f = fixture()
  let manager, matrixReads = 0, viewportReads = 0, matrix = { a: .5, b: 0, c: 0, d: .75, e: 30, f: 40 }
  try {
    const images = f.slide.append(f.make('div', '', { 'data-buddy-context': 'images' })),
      first = images.append(f.make('svg', '', { 'data-buddy-item': 'before', viewBox: '0 0 100 100' })),
      second = images.append(f.make('svg', '', { 'data-buddy-item': 'after' }))
    first.getScreenCTM = () => { matrixReads++; return matrix }
    second.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    Object.defineProperty(first, 'clientWidth', { get() { viewportReads++; return 150 } })
    Object.defineProperty(first, 'clientHeight', { get() { viewportReads++; return 100 } })
    const child = first.append(f.make('g', '', { transform: 'rotate(30) scale(-1 1)' }))
    manager = createSlideContext({ stage: f.stage, techniques: [{ id: 'showBeforeAfter', contextKinds: ['images'] }] })
    const initial = manager.resolve('showBeforeAfter')
    assert.deepEqual(initial.parts[0].media, { width: 150, height: 100, copyable: true, reason: null })
    assert.ok(Object.isFrozen(initial.parts[0].media))
    assert.equal(child.getAttribute('transform'), 'rotate(30) scale(-1 1)', 'Внутренние authored transforms не ограничиваются')
    assert.ok(!JSON.stringify(manager.snapshot()).includes('copyable'), 'Внутренний marker не меняет публичный fact')
    const reads = [matrixReads, viewportReads]
    for (let i = 0; i < 50; i++) { manager.resolve('showBeforeAfter'); manager.snapshot() }
    assert.deepEqual([matrixReads, viewportReads], reads, 'Повторные resolve/snapshot не читают матрицу или viewport')
    for (const unsupported of [
      { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 },
      { a: 1, b: .2, c: 0, d: 1, e: 0, f: 0 },
      { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 }
    ]) {
      matrix = unsupported; manager.refresh()
      const media = manager.resolve('showBeforeAfter').parts[0].media
      assert.equal(media.copyable, false)
      assert.match(media.reason, /rotation|reflection|skew/iu)
    }
    matrix = { a: 2, b: 1e-13, c: -1e-13, d: 3, e: 100, f: 200 }; manager.refresh()
    assert.equal(manager.resolve('showBeforeAfter').parts[0].media.copyable, true, 'Положительное масштабирование и числовой шум разрешены')
    matrix = null; manager.refresh()
    assert.equal(manager.resolve('showBeforeAfter').parts[0].media.copyable, false, 'Неопределимая матрица не выдаётся за точную копию')
  } finally { manager?.destroy(); f.close() }
})

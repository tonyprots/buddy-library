import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseColor, pickAccent, hoodiePalette, collectColorSamples, resolveHoodie, defaultHoodie, isAccentColor } from '../outfit.js'
import { createBuddy } from '../index.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

// Мини-сцена: элементы с текстом, фоном и рамкой, стили отдаёт карта, а не браузер.
function deck(items) {
  const els = items.map(({ text = '', w = 0, h = 0, tag = 'div', ignored = false }) => ({
    tagName: tag, offsetWidth: w, offsetHeight: h,
    childNodes: text ? [{ nodeType: 3, nodeValue: text }] : [],
    closest: sel => (ignored && sel.includes('data-buddy-ignore') ? {} : null)
  }))
  const styles = new Map(els.map((el, i) => [el, { fontSize: '16px', borderTopWidth: '0', ...items[i].style }]))
  return { stage: { querySelectorAll: () => els }, getStyle: el => styles.get(el) }
}

test('parseColor понимает hex и rgb/rgba, остальное отвергает', () => {
  assert.deepEqual(parseColor('#f60'), [255, 102, 0, 1])
  assert.deepEqual(parseColor('#FF6427'), [255, 100, 39, 1])
  assert.deepEqual(parseColor('rgba(19, 64, 224, 0.5)'), [19, 64, 224, .5])
  assert.deepEqual(parseColor('rgb(19 64 224 / 50%)'), [19, 64, 224, .5])
  assert.equal(parseColor('orange'), null)
  assert.equal(parseColor(undefined), null)
})

test('серые, почти белые и почти чёрные цвета акцентом не считаются', () => {
  assert.equal(isAccentColor([242, 242, 247]), false)   // фон карточек
  assert.equal(isAccentColor([26, 24, 23]), false)      // основной текст
  assert.equal(isAccentColor([254, 238, 231]), false)   // персиковая подложка
  assert.equal(isAccentColor([255, 100, 39]), true)
})

test('оранжевая дека даёт оранжевое худи, синяя — синее', () => {
  const orange = pickAccent([
    { color: 'rgb(26, 24, 23)', weight: 5000 }, { color: 'rgb(242, 242, 247)', weight: 9000 },
    { color: 'rgb(204, 68, 9)', weight: 400 }, { color: 'rgb(255, 100, 39)', weight: 300 },
    { color: 'rgb(83, 112, 210)', weight: 150 }
  ])
  assert.equal(orange.color, '#CC4409')
  const blue = pickAccent([
    { color: '#1a1817', weight: 5000 }, { color: '#2f5bff', weight: 600 }, { color: '#4a6cf0', weight: 300 },
    { color: '#ff6427', weight: 200 }
  ])
  assert.equal(blue.color, '#2F5BFF')
})

test('семейство оттенков сильнее одной точной краски: два близких синих перевешивают один оранжевый', () => {
  const r = pickAccent([{ color: '#ff6427', weight: 500 }, { color: '#2f5bff', weight: 300 }, { color: '#3b4fe0', weight: 300 }])
  assert.match(r.color, /^#(2F5BFF|3B4FE0)$/)
})

test('без заметного цвета акцента нет', () => {
  assert.equal(pickAccent([{ color: '#1a1817', weight: 9000 }, { color: '#f2f2f7', weight: 9000 }]), null)
  assert.equal(pickAccent([{ color: '#ff6427', weight: 20 }]), null)
  assert.equal(pickAccent([{ color: 'rgba(255, 100, 39, 0.1)', weight: 5000 }]), null)
})

test('палитра худи: светлота и насыщенность поджаты, свет светлее основы, тень и контур темнее', () => {
  const lum = hex => parseColor(hex).slice(0, 3).reduce((a, v) => a + v, 0)
  for (const c of ['#FF6427', '#CC4409', '#2F5BFF', '#FFE16A', '#0A1F6E', '#3E8C74']) {
    const p = hoodiePalette(c)
    assert.equal(p.look.base, p.color)
    assert.equal(p.svg[1], p.color)
    assert.ok(lum(p.svg[0]) > lum(p.svg[1]) && lum(p.svg[1]) > lum(p.svg[2]), c)
    assert.ok(lum(p.look.ol) < lum(p.svg[2]), c)
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.look))
  }
  assert.throws(() => hoodiePalette('оранжевый'), TypeError)
})

test('сбор образцов: текст по кеглю, фон по площади, рамки и фигуры SVG; data-buddy-ignore пропускается', () => {
  const { stage, getStyle } = deck([
    { text: 'Заголовок', style: { color: 'rgb(204, 68, 9)', fontSize: '32px' } },
    { w: 200, h: 100, style: { backgroundColor: 'rgb(47, 91, 255)' } },
    { style: { borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: 'rgb(255, 100, 39)' } },
    { tag: 'path', style: { fill: 'rgb(255, 100, 39)', strokeWidth: '0' } },
    { text: 'спрятано', ignored: true, style: { color: 'rgb(0, 200, 0)' } }
  ])
  const samples = collectColorSamples(stage, getStyle)
  assert.ok(samples.some(s => s.color === 'rgb(204, 68, 9)' && s.weight === 9 * 4))
  assert.ok(samples.some(s => s.color === 'rgb(47, 91, 255)' && s.weight === 500))
  assert.ok(samples.some(s => s.color === 'rgb(255, 100, 39)' && s.weight === 40))
  assert.ok(samples.some(s => s.color === 'rgb(255, 100, 39)' && s.weight === 60))
  assert.ok(!samples.some(s => s.color === 'rgb(0, 200, 0)'))
})

test('resolveHoodie: auto по деке, default — исходное синее, явный цвет — он сам', () => {
  const { stage, getStyle } = deck([
    { text: 'Акцентный заголовок слайда', style: { color: 'rgb(204, 68, 9)', fontSize: '40px' } },
    { text: 'Обычный длинный текст абзаца, который акцентом не является', style: { color: 'rgb(26, 24, 23)' } }
  ])
  const auto = resolveHoodie('auto', stage, getStyle)
  assert.equal(auto.source, 'deck')
  assert.equal(auto.color, hoodiePalette('#CC4409').color)
  assert.equal(resolveHoodie('default', stage, getStyle).color, defaultHoodie.color)
  assert.equal(resolveHoodie('#2f5bff', stage, getStyle).source, 'option')
  const plain = deck([{ text: 'Только серый текст', style: { color: 'rgb(60, 60, 60)' } }])
  assert.equal(resolveHoodie('auto', plain.stage, plain.getStyle).source, 'default')
})

test('createBuddy проверяет hoodie и сообщает итоговый цвет', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  try {
    await assert.rejects(createBuddy({ stage: f.stage, renderer: 'svg', hoodie: 'оранжевый' }), TypeError)
    const buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false, hoodie: '#ff6427' })
    assert.deepEqual({ ...buddy.hoodie }, { color: hoodiePalette('#ff6427').color, source: 'option' })
    buddy.destroy()
    const plain = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false })
    assert.equal(plain.hoodie.source, 'default')   // в фикстуре нет цветов — остаётся синее
    plain.destroy()
  } finally { globalThis.HTMLElement = previous }
})

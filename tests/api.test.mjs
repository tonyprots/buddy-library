import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBuddy, techniques, abilityPresets } from '../src/index.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

test('Каталог доступен при импорте без браузера, приёмы имеют уникальные идентификаторы', () => {
  assert.equal(new Set(techniques.map(item => item.id)).size, techniques.length)
  assert.ok(techniques.length > 60)
  for (const item of techniques) {
    assert.ok(item.title && item.description && item.group && item.requires)
    assert.doesNotMatch([item.title, item.description, item.group, item.requires].join(' '), /[А-Яа-яЁё]/u)
    assert.ok(item.preset === 'base' || item.preset in abilityPresets)
  }
})

test('Фирменный пресет выключен, суперхьюман включён; общий каталог нельзя испортить', () => {
  assert.equal(abilityPresets.y360.enabled, false)
  assert.equal(abilityPresets.superhuman.enabled, true)
  assert.throws(() => techniques[0].title = 'Другое название', TypeError)
  assert.throws(() => techniques.push({}), TypeError)
})

test('фирменные номера отделены от способностей, обычные жесты и реквизит не требуют superhuman', () => {
  const branded = techniques.filter(item => item.preset === 'brand')
  assert.deepEqual(new Set(branded.map(item => item.id)), new Set(['disk', 'mail', 'tracker', 'calendar']))
  assert.ok(branded.every(item => item.group === 'Brand'))
  for (const id of ['salute', 'bow', 'present', 'thumbsUp', 'sonicPulse', 'celebrate', 'spotlight', 'rain']) {
    const item = techniques.find(item => item.id === id)
    assert.equal(item.preset, 'base')
    assert.equal(item.group, id === 'spotlight' || id === 'rain' ? 'Props' : 'Gestures')
  }
  assert.ok(techniques.filter(item => item.preset === 'superhuman' && !item.contextKinds).every(item => item.group === 'Superhuman'))
  assert.ok(techniques.filter(item => item.contextKinds).every(item => item.group === 'Slide context' && item.tags.includes('context')))
})

test('единый контроллер доступен при обоих выключенных режимах, настройки не перебивают ручной номер', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false, presets: { superhuman: false } })
    assert.equal(buddy.profile, 'calm')
    assert.equal(buddy.state().grounded, true)
    buddy.experimental.B.mode = 'free'
    assert.equal(buddy.state().surf, 'floor')
    assert.equal(buddy.state().grounded, false, 'Сохранённый surf не означает физическую опору в полёте')
    buddy.experimental.B.mode = 'ground'
    buddy.experimental.B.surf = { kind: 'plat' }
    assert.equal(buddy.state().grounded, true, 'Опора на карточке тоже означает grounded')
    buddy.reset()
    assert.equal(buddy.intelligence.inspect().scheduled, false)
    assert.equal(buddy.intelligence.state().reactions, false)
    assert.equal(buddy.can('salute'), null)
    assert.equal(buddy.play('salute'), true)
    const act = buddy.state().act
    buddy.setProfile('show'); buddy.setReactions(true); buddy.autoplay(true)
    assert.equal(buddy.state().act, act)
    assert.equal(buddy.profile, 'show')
    assert.equal(buddy.intelligence.state().reactions, true)
    buddy.autoplay(false)
    assert.equal(buddy.intelligence.state().reactions, true)
    buddy.pause()
    assert.equal(buddy.intelligence.state().scheduled, false)
    buddy.resume(); buddy.setReactions(false)
    assert.equal(buddy.intelligence.state().scheduled, false)
    assert.throws(() => buddy.setProfile('invalid'), RangeError)
    assert.throws(() => buddy.setReactions('yes'), TypeError)
    assert.equal(buddy.profile, 'show')
    assert.throws(() => buddy.intelligence.inspect().world.floor.push([]), TypeError)
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('контекстный API сохраняет число, проверяет источник до пола и не сканирует DOM при чтении', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false })
    buddy.experimental.B.surf = { kind: 'plat' }
    assert.match(buddy.can('thinkNumber'), /source/u, 'Нет источника, а не ошибочное предложение сначала спуститься')
    const source = new f.stage.constructor('strong')
    source.setAttribute('data-buddy-context', 'number'); source.setAttribute('data-buddy-context-id', 'demo-value')
    source.textContent = '−18%'
    source.hasAttribute = key => source.getAttribute(key) !== null
    source.closest = () => null
    source.getBoundingClientRect = () => ({ left: 500, top: 220, width: 250, height: 100 })
    f.slide.appendChild(source)
    f.slide.querySelectorAll = selector => selector.includes('data-buddy-context') ? [source] : []
    buddy.rescan()
    assert.equal(buddy.context().facts.find(item => item.kind === 'number').text, '−18%')
    const measures = buddy.context().measures
    for (let i = 0; i < 10; i++) buddy.context()
    assert.equal(buddy.context().measures, measures)
    assert.match(buddy.can('thinkNumber'), /floor/u)
    buddy.reset()
    const fact = buddy.context().facts.find(item => item.kind === 'number')
    buddy.selectContext(fact.id)
    assert.equal(buddy.context().selectedId, fact.id)
    assert.equal(buddy.can('thinkNumber'), null)
    assert.equal(buddy.play('thinkNumber'), true)
    assert.equal(buddy.state().act, 'thinkNumber')
    buddy.step(2)
    assert.ok(buddy.state().fx > 0, 'Число показано настоящим эффектом')
    buddy.selectContext(null)
    assert.equal(buddy.context().selectedId, null)
    assert.throws(() => buddy.context().facts[0].text = 'Другое', TypeError)
    assert.throws(() => buddy.selectContext('unknown'), RangeError)
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('уменьшенное движение возвращает false для всех контекстных номеров, сохраняя проверку неизвестного ID', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false, motion: 'reduce' })
    for (const item of techniques.filter(item => item.contextKinds)) assert.equal(buddy.play(item.id), false, item.id)
    assert.throws(() => buddy.play('not-a-technique'), RangeError)
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('общий router переключает старый и новый контекстные players и очищает изменившийся источник', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    const source = new f.stage.constructor('p')
    source.setAttribute('data-buddy-context', 'text'); source.textContent = 'Точная мысль со слайда'
    source.hasAttribute = key => source.getAttribute(key) !== null; source.closest = () => null
    source.getBoundingClientRect = () => ({ left: 180, top: 220, width: 350, height: 80 })
    f.slide.appendChild(source)
    f.slide.querySelectorAll = selector => selector.includes('data-buddy-context') ? [source] : []
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false })
    assert.equal(buddy.can('laptopNotes'), null)
    buddy.play('laptopNotes'); buddy.step(2)
    assert.equal(buddy.state().act, 'laptopNotes')
    assert.equal(buddy.can('quoteIdea'), null)
    buddy.sequence(['quoteIdea']); buddy.step(2)
    assert.equal(buddy.state().act, 'quoteIdea')
    source.textContent = 'Обновлённая мысль'
    buddy.rescan()
    assert.equal(buddy.context().facts.find(item => item.kind === 'text').text, 'Обновлённая мысль')
    assert.equal(buddy.state().act, 'idle', 'Обновление нового источника отменяет прежний номер второго player')
    buddy.play('laptopNotes'); buddy.reset()
    assert.equal(buddy.state().act, 'idle')
    assert.equal(buddy.state().fx, 0)
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('бинокль убран из публичного каталога и недоступен для запуска', async () => {
  assert.ok(!techniques.some(item => item.id === 'binoculars'))
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false })
    assert.throws(() => buddy.can('binoculars'), RangeError)
    assert.throws(() => buddy.play('binoculars'), RangeError)
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('знаки Я360 требуют явного включения, после включения диск и письмо действительно запускаются', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false })
    assert.equal(buddy.presets.y360, false)
    for (const id of ['disk', 'mail', 'tracker']) {
      assert.ok(buddy.can(id))
      assert.throws(() => buddy.play(id))
    }
    buddy.destroy()
    const { logos } = await import('../src/presets/y360.js')
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false, presets: { y360: true }, logos })
    assert.equal(buddy.presets.y360, true)
    for (const id of ['disk', 'mail']) {
      buddy.reset()
      assert.equal(buddy.can(id), null)
      assert.equal(buddy.play(id), true)
      assert.equal(buddy.state().act, id, `${id}: запущен сам приём, не запасная стойка`)
    }
    const card = new f.stage.constructor('img')
    card.closest = () => null
    card.getBoundingClientRect = () => ({ left: 360, top: 420, right: 660, bottom: 620, width: 300, height: 200 })
    f.slide.querySelectorAll = selector => selector === '*' ? [card] : []
    buddy.reset(); buddy.progress(1); buddy.rescan()
    assert.equal(buddy.can('tracker'), null, 'На подходящей карточке доступна отметка готовности')
    assert.equal(buddy.play('tracker'), true)
    buddy.step(.5)
    assert.ok(buddy.state().fx > 0, 'Отметка создаёт видимый эффект, а не только принимает команду')
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('Подключение без сцены даёт понятную ошибку, а не ошибку обращения к DOM', async () => {
  await assert.rejects(createBuddy(), TypeError)
})

test('Неверные настройки отклоняются до изменения пользовательской сцены', async () => {
  const previous = globalThis.HTMLElement
  class Stage {
    querySelector() { return {} }
    append() { assert.fail('Проверка настроек не должна менять сцену') }
  }
  globalThis.HTMLElement = Stage
  try {
    const stage = new Stage()
    for (const options of [
      { renderer: 'unknown' }, { motion: 'unknown' }, { seed: NaN }, { seed: -1 },
      { seed: 1.5 }, { autoplay: 'yes' }, { keyboard: 1 }, { reactions: [] },
      { presets: { unknown: true } }, { presets: { toString: true } }, { presets: { constructor: true } },
      { presets: JSON.parse('{"__proto__":true}') }, { presets: { y360: 'yes' } }, { presets: null }
    ]) await assert.rejects(createBuddy({ stage, ...options }), TypeError)
    const abort = new AbortController(), reason = new Error('Тестовая отмена')
    abort.abort(reason)
    await assert.rejects(createBuddy({ stage, signal: abort.signal }), error => error === reason)
  } finally {
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('своя жизнь: autonomous не стоит час после reset и включения на лету, с autoplay несовместим', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    await assert.rejects(createBuddy({ stage: f.stage, renderer: 'svg', autonomous: true, autoplay: true }), /mutually exclusive/u)
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autonomous: true, reactions: false })
    assert.equal(buddy.reactionState()?.autoplay ?? false, false, 'autoplay по умолчанию выключается')
    buddy.reset(); let wait = buddy.experimental.B.act; buddy.step(3, 30)
    assert.notEqual(buddy.experimental.B.act, wait, 'Через 3 с уже идёт новое действие, а не часовое ожидание')
    buddy.destroy()
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay: false, reactions: false })
    buddy.reset(); wait = buddy.experimental.B.act; buddy.step(3, 30)
    assert.equal(buddy.experimental.B.act, wait, 'Без своей воли бадди ждёт')
    buddy.experimental.autonomous(true); buddy.step(3, 30)
    assert.notEqual(buddy.experimental.B.act, wait, 'Включение своей жизни обрывает ожидание')
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

test('без настроек бадди живёт сам; явный autoplay выбирает планировщик; переключение на лету взаимоисключающее', async () => {
  const f = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = f.stage.constructor
  let buddy
  try {
    buddy = await createBuddy({ stage: f.stage, renderer: 'svg', reactions: false })
    assert.equal(buddy.state().autonomous, true, 'нулевая настройка — своя жизнь')
    assert.equal(buddy.state().autoplay, false)
    buddy.reset(); const wait = buddy.experimental.B.act; buddy.step(3, 30)
    assert.notEqual(buddy.experimental.B.act, wait, 'без настроек бадди не стоит на месте')
    buddy.autoplay(true)
    assert.deepEqual([buddy.state().autonomous, buddy.state().autoplay], [false, true], 'autoplay(true) выключает свою жизнь')
    buddy.setAutonomous(true)
    assert.deepEqual([buddy.state().autonomous, buddy.state().autoplay], [true, false], 'setAutonomous(true) выключает autoplay')
    assert.throws(() => buddy.setAutonomous('yes'), TypeError)
    buddy.destroy()
    for (const autoplay of [true, false]) {
      buddy = await createBuddy({ stage: f.stage, renderer: 'svg', autoplay, reactions: false })
      assert.equal(buddy.state().autonomous, false, `явный autoplay:${autoplay} выключает свою жизнь`)
      buddy.destroy()
    }
    buddy = undefined
  } finally {
    buddy?.destroy(); f.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
})

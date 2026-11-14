import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBuddy, techniques } from '../index.js'
import { createBehaviorPolicy } from '../behavior.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

async function fixture(options = {}) {
  const base = runtimeFixture(), previous = globalThis.HTMLElement
  globalThis.HTMLElement = base.stage.constructor
  const buddy = await createBuddy({ stage: base.stage, renderer: 'svg', mode: 'manual', ...options })
  buddy.pause()
  return { buddy, ...base, close() {
    buddy.destroy(); base.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  } }
}

test('режимы согласуют автономность, реакции и профиль; старые переключатели остаются доступны', async () => {
  const f = await fixture(), b = f.buddy
  try {
    assert.equal(b.mode, 'manual')
    assert.equal(b.reactionState().reactions, false)
    b.setMode('companion')
    assert.equal(b.profile, 'live')
    assert.equal(b.state().autonomous, true)
    assert.equal(b.reactionState().reactions, true)
    b.setMode('show'); assert.equal(b.profile, 'show')
    b.autoplay(true); assert.equal(b.state().autonomous, false)
    b.setAutonomous(true); assert.equal(b.state().autoplay, false)
    b.setMode('manual')
    assert.equal(b.state().autonomous, false)
    assert.equal(b.reactionState().reactions, false)
    assert.throws(() => b.setMode('wrong'), RangeError)
    assert.throws(() => b.setCharacter('wrong'), RangeError)
    assert.equal(b.character, 'curious')
  } finally { f.close() }
})

test('профиль и характер фильтруют один репертуар, включая внутренние действия наверху', () => {
  const calm = createBehaviorPolicy('calm', 'playful', techniques), live = createBehaviorPolicy('live', 'curious', techniques),
    business = createBehaviorPolicy('show', 'business', techniques), playful = createBehaviorPolicy('show', 'playful', techniques)
  for (const id of ['climb', 'gap', 'fire', 'nap']) assert.equal(calm.allows(id), false, id)
  for (const id of ['nap', 'yawn', 'shadowbox', 'stumble']) assert.equal(live.allows(id), false, id)
  assert.equal(live.allows('climb'), true)
  assert.equal(live.allows('strollTop'), true)
  assert.ok(live.weight('note') > live.weight('wave'))
  for (const id of ['fire', 'hulk', 'backflip', 'gap', 'shadowbox', 'nap']) assert.equal(business.allows(id), false, id)
  for (const id of ['fire', 'nap', 'yawn']) assert.equal(playful.allows(id), true, id)
})

test('автономный runtime использует спокойный профиль на длинном слайде', async () => {
  const f = await fixture({ mode: 'companion', profile: 'calm', character: 'business' }), b = f.buddy
  try {
    b.progress(1)
    const seen = new Set()
    for (let i = 0; i < 560; i++) { b.step(.25, 15); seen.add(b.state().act) }
    assert.ok(seen.size > 1)
    for (const id of seen) assert.equal(createBehaviorPolicy('calm', 'business', techniques).allows(id === 'walk' ? 'stroll' : id), true, id)
    assert.notEqual(b.state().act, 'nap')
    assert.ok(b.experimental.mind().a > .3, 'Долгий слайд не превращается в скуку')
  } finally { f.close() }
})

test('finished ждёт реальный конец lookSlide, хотя busy у него false', async () => {
  const f = await fixture(), b = f.buddy
  try {
    const run = b.perform('lookSlide')
    let result
    run.finished.then(value => { result = value })
    b.step(.2); await Promise.resolve()
    assert.equal(b.state().busy, false)
    assert.equal(result, undefined)
    b.step(6)
    assert.equal((await run.finished).status, 'completed')
  } finally { f.close() }
})

test('история соединяет постановочную сцену, паузу, взгляд и жест', async () => {
  const f = await fixture(), b = f.buddy
  try {
    const run = b.story([{ play: 'leap' }, { wait: .4 }, { lookAt: { x: 200, y: 300 }, duration: .5 }, 'wave'])
    b.step(.2)
    assert.equal(b.state().performing, true)
    b.step(25)
    assert.deepEqual(await run.finished, { status: 'completed', step: 4 })
    assert.equal(b.state().grounded, true)
    assert.equal(b.experimental.mind().queue.length, 0)
  } finally { f.close() }
})

test('мягкая отмена заканчивает полёт и не запускает следующий шаг', async () => {
  const f = await fixture(), b = f.buddy
  try {
    const run = b.story(['leap', 'wave'])
    b.step(.3)
    const act = b.state().act, position = b.state().y
    run.cancel()
    assert.equal(b.state().act, act)
    assert.equal(b.state().y, position)
    b.step(20)
    const result = await run.finished
    assert.equal(result.status, 'cancelled')
    assert.equal(result.step, 1)
    assert.equal(b.state().grounded, true)
    assert.notEqual(b.state().act, 'wave')
  } finally { f.close() }
})

test('AbortSignal мягко завершает конечный сон; снятый listener не трогает следующий запуск', async () => {
  const f = await fixture(), b = f.buddy
  try {
    const signal = new AbortController(), run = b.perform('nap', { duration: 50, signal: signal.signal })
    b.step(4); signal.abort(); b.step(1)
    assert.equal((await run.finished).reason, 'aborted')
    const next = b.perform('wave'); b.step(8)
    assert.equal((await next.finished).status, 'completed')
  } finally { f.close() }
})

test('пауза останавливает и ожидание; step продвигает историю без таймеров', async () => {
  const f = await fixture(), b = f.buddy
  try {
    const run = b.story([{ wait: 1 }, 'wave'])
    b.step(.5)
    assert.equal(b.state().act, 'idle')
    assert.equal(b.state().performing, true)
    b.step(.6)
    assert.equal(b.state().act, 'wave')
    b.step(8)
    assert.equal((await run.finished).status, 'completed')
    assert.equal(b.paused, true)
  } finally { f.close() }
})

test('ручная команда, reset и destroy завершают Promise с причиной прерывания', async () => {
  const f = await fixture(), b = f.buddy
  try {
    const first = b.perform('wave'); b.play('clap')
    assert.equal((await first.finished).reason, 'replaced')
    const second = b.story([{ wait: 10 }]); b.reset()
    assert.equal((await second.finished).reason, 'reset')
    const third = b.story([{ lookAt: { x: 200, y: 200 }, duration: 10 }]); b.destroy()
    assert.equal((await third.finished).reason, 'destroyed')
  } finally { f.close() }
})

test('невалидная история не отменяет текущую; недоступный номер даёт failed', async () => {
  const f = await fixture(), b = f.buddy
  try {
    const run = b.perform('wave')
    assert.throws(() => b.story([{ play: 'wave', wait: 2 }]), TypeError)
    assert.throws(() => b.perform('nap'), RangeError)
    assert.throws(() => b.story([{ wait: Infinity }]), RangeError)
    assert.equal(b.state().performing, true)
    b.step(8); assert.equal((await run.finished).status, 'completed')
    const failed = b.perform('disk')
    assert.equal((await failed.finished).status, 'failed')
    assert.equal(b.state().performing, false)
  } finally { f.close() }
})

test('focus не замораживает текущий номер, затем занимает свободный пол и возвращает режим', async () => {
  const f = await fixture({ mode: 'companion' }), b = f.buddy
  try {
    b.perform('leap'); b.step(.3)
    const y = b.state().y
    b.focus()
    assert.equal(b.state().y, y)
    b.step(20)
    assert.equal(b.state().focused, true)
    assert.equal(b.state().surf, 'floor')
    assert.equal(b.reactionState().reactions, false)
    b.setMode('show')
    assert.equal(b.state().focused, true)
    b.focus(false)
    assert.equal(b.mode, 'show')
    assert.equal(b.reactionState().reactions, true)
    assert.equal(b.state().focusing, false)
  } finally { f.close() }
})

test('настройки во время истории применяются после неё, самодеятельность не вмешивается', async () => {
  const f = await fixture(), b = f.buddy
  try {
    const run = b.story([{ wait: 1 }, 'wave'])
    b.setMode('show'); b.setCharacter('business')
    assert.equal(b.reactionState().reactions, false)
    b.step(10)
    assert.equal((await run.finished).status, 'completed')
    assert.equal(b.mode, 'show')
    assert.equal(b.character, 'business')
    assert.equal(b.reactionState().reactions, true)
  } finally { f.close() }
})

test('reduced motion и заранее отменённый сигнал не оставляют висящий запуск', async () => {
  const f = await fixture({ motion: 'reduce' }), b = f.buddy
  try {
    assert.equal((await b.perform('wave').finished).status, 'skipped')
    const signal = new AbortController(); signal.abort()
    assert.equal((await b.story(['wave'], { signal: signal.signal }).finished).reason, 'aborted')
    assert.equal(b.state().performing, false)
  } finally { f.close() }
})

test('focus выводит из бесконечного сна в старой sequence, не оставляя очередь зависшей', async () => {
  const f = await fixture(), b = f.buddy
  try {
    b.sequence(['nap', 'wave']); b.step(4); b.focus(); b.step(3)
    assert.equal(b.state().focused, true)
    assert.equal(b.state().queue, 0)
    assert.equal(b.state().act, 'idle')
  } finally { f.close() }
})

test('в story входные шаги копируются: последующая правка массива не меняет запущенную историю', async () => {
  const f = await fixture(), b = f.buddy
  try {
    const target = { x: 200, y: 300 }, steps = [{ wait: .5 }, { lookAt: target, duration: 1 }, 'wave'], run = b.story(steps)
    target.x = NaN; steps.splice(1, 2, 'nap')
    b.step(10)
    assert.deepEqual(await run.finished, { status: 'completed', step: 3 })
  } finally { f.close() }
})

test('тихое окно общей политики задерживает автономную способность до его окончания', () => {
  const f = runtimeFixture(), r = f.raw
  try {
    r.behavior({ quietSeconds: 12, powerSeconds: 20, sleepy: false, profile: 'show', allows: id => id === 'fire', weight: () => 0 })
    r.W.idx = 4; r.W.time = 7; r.B.nextPower = 0; r.mind().slideAt = 0
    const before = r.B.lastPower
    r.autonomous(true); r.step(4)
    assert.equal(r.B.lastPower, before)
    r.step(10)
    assert.ok(r.B.lastPower >= 12)
  } finally { f.close() }
})

test('взгляд истории сразу получает приоритет над старой очередью взглядов', async () => {
  const f = await fixture(), b = f.buddy
  try {
    b.lookAt({ x: 100, y: 100 }, 30)
    const run = b.story([{ lookAt: { x: 900, y: 250 }, duration: 1 }])
    b.step(.1)
    assert.equal(b.experimental.mind()._want.x, 900)
    run.cancel()
    assert.equal((await run.finished).status, 'cancelled')
    assert.equal(b.experimental.mind().queue.length, 0)
  } finally { f.close() }
})

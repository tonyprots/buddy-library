import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFileSync } from 'node:fs'
import { createBuddy, techniques } from '../src/index.js'
import { runtimeFixture } from './support/runtime-fixture.mjs'

async function observe({ count = 1, index = 0, seed = 1, options = {}, seconds = 90 } = {}) {
  const base = runtimeFixture(), previous = globalThis.HTMLElement,
    slides = Array.from({ length: count }, (_, i) => {
      const slide = new base.host.constructor('section')
      slide.classList.contains = name => name === 'on' && i === index
      return slide
    })
  base.stage.querySelectorAll = selector => selector === ':scope > .slide' ? slides : []
  base.stage.querySelector = selector => /\.slide/.test(selector) ? slides[index] : null
  globalThis.HTMLElement = base.stage.constructor
  let buddy
  try {
    buddy = await createBuddy({ stage: base.stage, renderer: 'svg', seed, ...options })
    const state = buddy.state(), { B } = buddy.experimental, actions = new Set(), powers = [], gaps = [],
      supernatural = new Set(techniques.filter(item => item.preset === 'superhuman').map(item => item.id))
    let lastPower = B.lastPower, firstAction = null, restFrames = 0
    // Ускоряем только часы; режим, профиль, уровень и выбор номеров не меняем.
    for (let tick = 0; tick < seconds * 60; tick++) {
      buddy.step(1 / 60)
      actions.add(B.act.name)
      if (['idle', 'sitRest', 'sitLean', 'edgeSit'].includes(B.act.name)) restFrames++
      if (firstAction === null && B.act.name !== 'idle') firstAction = tick / 60
      if (B.lastPower !== lastPower) {
        lastPower = B.lastPower; powers.push({ at: B.t, action: B.act.name }); gaps.push(B.nextPower - B.lastPower)
      }
    }
    return { count, index, seed, state, actions: [...actions], effects: [...actions].filter(id => supernatural.has(id)), powers, gaps, firstAction, restFraction: restFrames / (seconds * 60) }
  } finally {
    buddy?.destroy(); base.close()
    if (previous === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previous
  }
}

test('нулевые настройки запускают активное шоу со способностями даже на одной странице', async () => {
  for (const seed of [1, 14, 42]) {
    const row = await observe({ seed })
    assert.equal(row.state.mode, 'show')
    assert.ok(row.firstAction < 8, JSON.stringify(row))
    assert.ok(row.powers.length >= 3, JSON.stringify(row))
    assert.ok(row.effects.length >= 2, JSON.stringify(row))
    assert.ok(row.actions.length >= 5, JSON.stringify(row))
    assert.ok(row.restFraction < .5, JSON.stringify(row))
    assert.ok(!row.actions.includes('nap') && !row.actions.includes('yawn'))
  }
})

test('короткая дека показывает способности, а пауза между ними сокращается к концу', async () => {
  const early = await observe({ count: 6, index: 1 }), late = await observe({ count: 3, index: 2 })
  assert.ok(early.powers.length >= 2 && late.powers.length >= 4, JSON.stringify({ early, late }))
  assert.ok(Math.max(...late.gaps) < Math.min(...early.gaps), JSON.stringify({ early, late }))
  if (process.env.BUDDY_DEFAULTS_REPORT) writeFileSync(process.env.BUDDY_DEFAULTS_REPORT, JSON.stringify({ early, late }, null, 2))
})

test('ручной и спокойный режимы остаются явным выбором без способностей', async () => {
  for (const options of [{ mode: 'manual' }, { profile: 'calm', character: 'business' }, { autoplay: false }, { presets: { superhuman: false } }, { motion: 'reduce' }]) {
    const row = await observe({ options, seconds: 45 })
    assert.equal(row.effects.length, 0, JSON.stringify(row))
    if (options.mode === 'manual' || options.autoplay === false) assert.equal(row.powers.length, 0)
  }
})

test('зарегистрированная способность участвует в самостоятельном выборе', async () => {
  const base = runtimeFixture(), { raw } = base
  try {
    raw.W.idx = 5; raw.W.n = 6; raw.progress(1)
    raw.registerAbilities({ showcase: () => raw.tools.gest('showcase', 1, 0, () => raw.tools.pose(), { power: false }) })
    raw.behavior({ profile: 'show', quietSeconds: 0, powerSeconds: 1, sleepy: false,
      allows: id => id === 'showcase', weight: () => 0 })
    let seen = false, powered = false
    raw.subscribe(() => {
      if (raw.B.act?.name === 'showcase') { seen = true; powered ||= raw.B.act.power === true }
    })
    raw.autonomous(true); raw.step(12)
    assert.ok(raw.B.lastPower > 0, 'Фабрика зарегистрированного номера вызывается автопилотом')
    assert.ok(seen && !powered, 'Обычный жест не получает плащ супергероя из-за планировщика')
  } finally { base.close() }
})

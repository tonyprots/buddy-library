import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { storyFixture } from './support/story-fixture.mjs'

// Инвариант: последовательные исходные пункты проходят через одну ведущую ладонь;
// тот же физический panel не скачет между руками и не меняет видимый текст.
test('assembleList передаёт 3/4/8 пунктов через одну карту в обе стороны, 120 Hz', () => {
  const startedAtUTC = new Date().toISOString(), rows = []
  for (const count of [3, 4, 8]) for (const face of [-1, 1]) {
    const f = storyFixture('assembleList', face), ci = face > 0 ? 0 : 1,
      row = { count, face, frames: 0, maxVisible: 0, maxFadeStep: 0, wrongHandFrames: 0,
        visibleTextChanges: [], handChanges: [], texts: [], fullReadFrames: 0 }, previous = new Map(), seen = new Set()
    try {
      const items = Array.from({ length: count }, (_, i) => ({ ...f.selection.fact.structure.items[0],
        id: 'row-' + i, text: 'Пункт ' + (i + 1), checked: i % 2 === 1 }))
      f.selection.fact.structure.items = items; f.start()
      for (let n = 0; n < Math.ceil(f.entry.duration * 120) + 40; n++) {
        f.raw.step(1 / 120, 120)
        const b = f.raw.B
        let visible = 0
        for (const rec of f.props) {
          if (rec.state.done) continue
          const p = rec.update(rec.state, b.kk)
          if (!p) continue
          const prior = previous.get(rec.name), current = { t: b.act.t, fade: p.fade, text: p.text, side: p.handContact?.side }
          if (p.fade > .001) {
            visible++; seen.add(p.text)
            if (current.side !== ci) row.wrongHandFrames++
          }
          if (p.fade > .999) row.fullReadFrames++
          if (prior) {
            row.maxFadeStep = Math.max(row.maxFadeStep, Math.abs(current.fade - prior.fade))
            if (current.text !== prior.text && current.fade > .001) row.visibleTextChanges.push({ name: rec.name, prior, current })
            if (current.side !== prior.side && (current.fade > .001 || prior.fade > .001)) row.handChanges.push({ name: rec.name, prior, current })
          }
          previous.set(rec.name, current)
        }
        row.maxVisible = Math.max(row.maxVisible, visible); row.frames++
        if (b.act.name === 'idle') break
      }
      row.final = f.raw.B.act.name; row.texts = [...seen]; rows.push(row)
      assert.deepEqual(row.texts, items.map(item => item.text), 'Все исходные строки показаны по порядку буквально')
    } finally { f.close() }
  }
  const report = { startedAtUTC, endedAtUTC: new Date().toISOString(), hz: 120,
    contextSourceSHA: createHash('sha256').update(readFileSync(new URL('../context-stories.js', import.meta.url))).digest('hex'),
    method: 'Настоящие runtime/solve и prop callbacks; без GLB, WebGL/FPS/native capture.', rows }
  if (process.env.BUDDY_LIST_HANDOFF_REPORT) writeFileSync(process.env.BUDDY_LIST_HANDOFF_REPORT, JSON.stringify(report, null, 2) + '\n')
  for (const row of rows) {
    const detail = JSON.stringify(row)
    assert.equal(row.final, 'idle', detail); assert.equal(row.maxVisible, 1, detail)
    assert.equal(row.wrongHandFrames, 0, detail); assert.ok(row.maxFadeStep < .07, 'Opacity непрерывна при появлении/исчезновении. ' + detail)
    assert.equal(row.visibleTextChanges.length, 0, 'Текст заменяется только при fade=0. ' + detail)
    assert.equal(row.handChanges.length, 0, 'Один и тот же предмет не переключается между кистями. ' + detail)
    assert.ok(row.fullReadFrames > 300, 'Каждый допустимый список имеет время полностью видимой физической карточки. ' + detail)
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pullupCandidates, trackerCandidates } from '../src/runtime.js'

test('Подтягивания требуют досягаемой кромки внутри маршрута и ближе 420px', () => {
  const valid = { gap: 45, footX: 200 }, body = { x: 300 }, level = { reach: 110 }, range = [176, 900],
    candidates = [valid, { gap: 110, footX: 700 }, { gap: 44, footX: 200 }, { gap: 111, footX: 200 },
      { gap: 60, footX: 175 }, { gap: 60, footX: 901 }, { gap: 60, footX: 720 }]
  assert.deepEqual(pullupCandidates({ walls: candidates }, body, level, range), [valid, candidates[1]])
  assert.deepEqual(pullupCandidates({ walls: [valid] }, body, { reach: 0 }, range), [])
})

test('Отметка готовности требует близкой плитки подходящей высоты и свободного отрезка 26px', () => {
  const valid = { x1: 400, x2: 500, y: 400, spans: [[410, 436]] }, body = { x: 300 },
    bad = [{ ...valid, x2: 460 }, { ...valid, x1: 600, x2: 700 }, { ...valid, x1: -200, x2: 0 },
      { ...valid, y: 240 }, { ...valid, y: 630 }, { ...valid, spans: [[410, 435.9]] }]
  assert.deepEqual(trackerCandidates({ plats: [valid, ...bad] }, body), [valid])
  assert.deepEqual(trackerCandidates({ plats: [] }, body), [])
})

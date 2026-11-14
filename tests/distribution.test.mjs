import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { logos } from '../presets/y360.js'

test('основная сборка не содержит знаков; отдельная сборка содержит весь пример', async () => {
  const [main, example] = await Promise.all(['buddy', 'buddy-y360'].map(name =>
    readFile(new URL('../dist/' + name + '.js', import.meta.url), 'utf8')))
  assert.ok(!main.includes('data:image/svg+xml;base64'))
  for (const logo of Object.values(logos)) {
    assert.ok(!main.includes(logo))
    assert.ok(example.includes(logo))
  }
})

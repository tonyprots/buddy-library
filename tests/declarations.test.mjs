import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { techniques } from '../index.js'

test('Типизированный каталог покрывает все исполняемые приёмы без лишних идентификаторов', async () => {
  const declaration = await readFile(new URL('../index.d.ts', import.meta.url), 'utf8'),
    union = declaration.split('export type TechniqueId =')[1].split('export type SceneTechniqueId')[0],
    ids = [...union.matchAll(/'([^']+)'/g)].map(match => match[1])
  assert.deepEqual(new Set(ids), new Set(techniques.map(item => item.id)))
})

test('Каждый публичный путь пакета включает существующую декларацию типов', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.types, './index.d.ts')
  for (const target of Object.values(manifest.exports)) {
    assert.ok(target.types && target.import)
    await access(new URL('../' + target.types, import.meta.url))
  }
})

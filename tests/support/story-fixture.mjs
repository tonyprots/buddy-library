import assert from 'node:assert/strict'
import { createStoryPlayer, storyTechniques } from '../../context-stories.js'
import { runtimeFixture } from './runtime-fixture.mjs'

/** Контекст для проверки физического хвата; настоящий runtime и исходные данные истории. */
export function storyFixture(id, face = 1, builders, createPlayer = createStoryPlayer) {
  const core = runtimeFixture(face), { raw } = core, props = [],
    entry = storyTechniques.find(item => item.id === id),
    image = { tagName: 'IMG', src: 'data:image/svg+xml,old' },
    items = (id === 'assembleList' ? ['Проверить источник', 'Сохранить подпись', 'Показать пример'] : ['До', 'После'])
      .map((text, i) => ({ id: 'item-' + i, text, label: text, value: (i ? '27' : '42') + ' %', unit: '%',
        checked: i === 1, target: { x: 250 + i * 250, y: 300, width: 140, height: 100 } })),
    selection = { fact: { id: 'grip-source', kind: entry.contextKinds[0], text: 'Точная формулировка — без домыслов.',
      structure: { items, edges: [{ from: 'item-0', to: 'item-1', points: [{ x: 320, y: 300 }, { x: 430, y: 300 }] }] } },
      element: { tagName: 'DIV' }, bounds: [120, 180, 600, 430],
      parts: items.map(item => ({ id: item.id, element: image, bounds: [200, 230, 460, 430] })) }
  raw.W.floor.spans = [[0, 1280]]
  raw.tools.registerPropBuilders = builders || (() => 0)
  raw.tools.prop3 = (name, update) => { const state = { ping: true }; props.push({ name, update, state }); return state }
  const player = createPlayer({ ...raw, renderer: 'webgl' }, { host: core.host, context: () => selection })
  return { ...core, props, entry, selection, player, start() {
    const action = player.create(id); assert.ok(action, `${id}: ${player.can(id)}`); raw.begin(action); return action
  }, close() { player.destroy(); core.close() } }
}

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { runtimeFixture } from '../support/runtime-fixture.mjs'
import { propGeometry } from '../support/prop-geometry.mjs'

test('физические карточки сравнения, списка и цитаты не пересекают голову в обе стороны', async () => {
  const moduleURL = process.env.BUDDY_PANEL_SOURCE ? pathToFileURL(process.env.BUDDY_PANEL_SOURCE)
    : new URL('../../context-stories.js', import.meta.url), { createStoryPlayer } = await import(moduleURL),
    f = runtimeFixture(), originalDocument = globalThis.document, originalCreate = originalDocument.createElement,
    context = new Proxy({ measureText: text => ({ width: text.length * 20 }) }, { get: (target, key) => target[key] ?? (() => {}) }), cases = []
  try {
    globalThis.document = { createElement: () => ({ getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import('../../vendor.js'), rig = Buddy3D.create({ outline: false })
    await rig.loaded; globalThis.document = originalDocument
    originalDocument.createElement = tag => tag === 'canvas' ? { getContext: () => context } : originalCreate(tag)
    const roots = new Map(), probe = propGeometry(rig, T)
    let registered = false
    for (const id of ['compareValues', 'showBeforeAfter', 'assembleList', 'quoteIdea', 'inspectDetail']
      .filter(id => process.env.BUDDY_PANEL_IDS ? process.env.BUDDY_PANEL_IDS.split(',').includes(id) : !process.env.BUDDY_PANEL_QUICK || id === 'compareValues'))
      for (const face of [-1, 1]) {
        f.raw.reset(); const raw = f.raw, { B } = raw, records = [],
          items = (id === 'inspectDetail' ? [0] : [0, 1]).map(i => ({ id: 'part-' + i, text: i ? 'После' : 'До', value: i ? '27 %' : '42 %', unit: '%', target: { x: 200 + i * 300, y: 300, width: 200, height: 150 } })),
          selection = { fact: { id: 'source', kind: id === 'quoteIdea' ? 'text' : id === 'compareValues' ? 'values' : id === 'assembleList' ? 'list' : id === 'inspectDetail' ? 'detail' : 'images',
            text: 'Точная цитата', structure: { items, crop: { x: 200, y: 250, width: 100, height: 100 } } }, element: { tagName: 'DIV' }, bounds: [100, 200, 800, 450],
            parts: items.map(item => ({ id: item.id, element: { tagName: 'IMG', src: 'data:image/svg+xml,old' }, bounds: [100, 200, 800, 450] })) },
          tools = { ...raw.tools, registerPropBuilders(factory) {
            if (registered) return 6
            registered = true
            return rig.registerPropBuilders(kit => Object.fromEntries(Object.entries(factory(kit)).map(([name, builder]) => [name, () => {
              const prop = builder(); roots.set(name, prop.g); return prop
            }])))
          }, prop3(name, update) { const state = { ping: true }; records.push({ name, update, state }); return state } },
          player = createStoryPlayer({ ...raw, renderer: 'webgl', tools }, { host: f.host, context: () => selection })
        try {
          Object.assign(B, { face, cam: .36, yaw: face > 0 ? .36 * Math.PI / 2 : Math.PI - .36 * Math.PI / 2, yawV: 0 })
          const action = player.create(id); assert.ok(action, player.can(id)); raw.begin(action)
          const row = { id, face, samples: 0, minimumGap: Infinity }
          cases.push(row)
          for (let frame = 0; frame < 540; frame++) {
            raw.step(1 / 60, 60)
            if (process.env.BUDDY_PANEL_QUICK && Math.abs(B.act.t - 4) > .001) continue
            rig.pose(B.kk, B.pose, { yaw: B.yaw, head: 1.5 }); rig.place(B.x, B.y, 0, tools.S * B.scale, [1, 1], B.yaw)
            for (const record of records) {
              const params = record.update(record.state, B.kk)
              if (!params || params.fade <= .1) continue
              rig.prop(record.name, params)
              const result = probe.readPieces(roots.get(record.name)); row.samples++
              if (result.gap < row.minimumGap) { row.minimumGap = result.gap; row.at = { time: B.act.t, name: record.name, params, ...result } }
            }
          }
          assert.ok(row.samples > 0)
        } finally { player.destroy() }
      }
  } finally { originalDocument.createElement = originalCreate; globalThis.document = originalDocument; f.close() }
  if (process.env.BUDDY_PANEL_REPORT) writeFileSync(process.env.BUDDY_PANEL_REPORT,
    JSON.stringify({ created: new Date().toISOString(), source: moduleURL.href,
      sourceSHA: createHash('sha256').update(readFileSync(moduleURL)).digest('hex'), cases }, null, 2) + '\n')
  for (const row of cases) assert.ok(row.minimumGap >= 1, 'Зазор головы и карточки ≥1 stage px. ' + JSON.stringify(row))
})

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { runtimeFixture } from '../support/runtime-fixture.mjs'
import { createEyeOcclusionProbe } from '../support/eye-occlusion.mjs'

test('traceFlow сохраняет свободные глаза и направляет физическую указку на источник во всём цикле трёх связей', async () => {
  const source = process.env.BUDDY_TRACE_EYE_SOURCE ? pathToFileURL(resolve(process.env.BUDDY_TRACE_EYE_SOURCE))
    : new URL('../../src/context-stories.js', import.meta.url), { createStoryPlayer } = await import(source.href),
    report = { created: new Date().toISOString(), hz: 120, source: source.href,
      sourceSHA: createHash('sha256').update(await readFile(source)).digest('hex'), cases: [] }
  for (const face of [-1, 1]) {
    const f = runtimeFixture(face), { raw } = f, { B } = raw, previousDocument = document,
      originalCreate = previousDocument.createElement, roots = new Map(), records = [],
      context = new Proxy({ measureText: text => ({ width: text.length * 20 }) }, { get: (target, key) => target[key] ?? (() => {}) }),
      a = { x: 100, y: 100 }, b = { x: 150, y: 150 }, c = { x: 1200, y: 650 },
      selection = { fact: { id: 'three-edge-flow', kind: 'flow', text: 'Путь запроса', structure: {
        items: [a, b, c].map((point, i) => ({ id: ['a', 'b', 'c'][i], text: ['А', 'Б', 'В'][i], target: { ...point, width: 20, height: 20 } })),
        edges: [{ from: 'a', to: 'b', points: [a, b] }, { from: 'c', to: 'b', points: [c, b] }, { from: 'b', to: 'c', points: [b, c] }]
      } }, element: { tagName: 'DIV' }, bounds: [80, 80, 1220, 670], parts: [] }
    let player
    try {
      globalThis.document = { createElement: () => ({ getContext: () => context }) }
      const { Buddy3D, THREE: T } = await import('../../src/vendor.js'), rig = Buddy3D.create({ outline: false })
      await rig.loaded
      globalThis.document = previousDocument
      previousDocument.createElement = tag => tag === 'canvas' ? { getContext: () => context } : originalCreate(tag)
      const eyeProbe = createEyeOcclusionProbe(rig, T), tools = { ...raw.tools,
        registerPropBuilders(factory) {
          return rig.registerPropBuilders(kit => Object.fromEntries(Object.entries(factory(kit)).map(([name, build]) => [name, () => {
            const prop = build(); roots.set(name, prop.g); return prop
          }])))
        }, prop3(name, update) { const state = { ping: true }; records.push({ name, update, state }); return state } }
      player = createStoryPlayer({ ...raw, renderer: 'webgl', tools }, { host: f.host, context: () => selection })
      raw.begin(player.create('traceFlow'))
      assert.equal(B.act.name, 'traceFlow')
      const row = { face, samples: 0, visibleGlyphSamples: 0, handOccluded: 0, propOccluded: 0,
        raySamples: 0, maxRayMiss: 0, minRayForward: Infinity, firstOcclusion: null }
      report.cases.push(row)
      for (let tick = 0; tick <= 1360; tick++) {
        if (tick) raw.step(1 / 120, 120)
        const k = tick ? B.kk : tools.solve(B.pose, Math.cos(B.yaw) >= 0 ? 1 : -1, Math.sin(B.yaw)),
          scale = tools.S * B.scale, fy = Math.max(...k.legs.flatMap(leg => [leg.heel[1], leg.toe[1]]))
        rig.pose(k, B.pose, { head: 1.5, yaw: B.yaw }); rig.place(B.x, B.y + fy * scale, fy, scale, [1, 1], B.yaw)
        const active = []
        for (const record of records) {
          const params = record.update(record.state, k)
          if (!params || params.fade <= .1) continue
          rig.prop(record.name, params); active.push({ root: roots.get(record.name), params })
        }
        const eye = eyeProbe.read({ propRoots: active.map(prop => prop.root) })
        row.samples++; row.visibleGlyphSamples += eye.eyes.reduce((sum, eye) => sum + eye.samples, 0)
        row.handOccluded += eye.occludedSamples; row.propOccluded += eye.propOccludedSamples
        if ((eye.hits.length || eye.propHits.length) && !row.firstOcclusion)
          row.firstOcclusion = { time: tick / 120, hands: eye.hits, props: eye.propHits }
        const cursors = [], visit = (node, inStory = false) => {
          const story = inStory || node.getAttribute?.('data-context-action') === 'traceFlow'
          if (story && node.tagName === 'CIRCLE' && node.getAttribute('cx') !== null && node.getAttribute('cy') !== null
            && +node.getAttribute('opacity') > .1) cursors.push(node)
          for (const child of node.children || []) visit(child, story)
        }
        visit(f.host)
        for (const prop of active.filter(prop => prop.params.contact > .1)) {
          assert.equal(cursors.length, 1, 'При включённом луче есть единственная видимая цель исходной схемы')
          const origin = prop.root.getWorldPosition(new T.Vector3()),
            tip = prop.root.getObjectByName('stylus-tip').getWorldPosition(new T.Vector3()),
            dx = tip.x - origin.x, dy = -(tip.y - origin.y),
            tx = +cursors[0].getAttribute('cx') - origin.x, ty = +cursors[0].getAttribute('cy') + origin.y,
            length = Math.hypot(dx, dy), targetLength = Math.hypot(tx, ty)
          assert.ok(length > 0 && targetLength > 0)
          row.raySamples++
          row.maxRayMiss = Math.max(row.maxRayMiss, Math.abs(dx * ty - dy * tx) / (length * targetLength))
          row.minRayForward = Math.min(row.minRayForward, (dx * tx + dy * ty) / (length * targetLength))
        }
      }
      row.final = B.act.name
    } finally { previousDocument.createElement = originalCreate; globalThis.document = previousDocument; player?.destroy(); f.close() }
  }
  if (process.env.BUDDY_TRACE_EYE_REPORT)
    await writeFile(process.env.BUDDY_TRACE_EYE_REPORT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  for (const row of report.cases) {
    const detail = JSON.stringify(row)
    assert.equal(row.samples, 1361); assert.equal(row.final, 'idle')
    assert.ok(row.visibleGlyphSamples > 50000 && row.raySamples > 300, 'Проверен полный цикл с видимыми глазами и лучом. ' + detail)
    assert.equal(row.handOccluded, 0, 'Настоящие кисти не закрывают внутреннюю область глаз. ' + detail)
    assert.equal(row.propOccluded, 0, 'Физическая указка не закрывает внутреннюю область глаз. ' + detail)
    assert.ok(row.maxRayMiss < 1e-6 && row.minRayForward > .999999, 'Реальная ось указки направлена вперёд на текущую исходную цель. ' + detail)
  }
})

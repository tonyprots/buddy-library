import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { runtimeFixture } from '../support/runtime-fixture.mjs'
import { propGeometry } from '../support/prop-geometry.mjs'

test('все восемь объёмных понятий сохраняют зазор перед настоящей геометрией головы', async () => {
  const moduleURL = process.env.BUDDY_HOLOGRAM_SOURCE ? pathToFileURL(process.env.BUDDY_HOLOGRAM_SOURCE)
    : new URL('../../src/context-abilities.js', import.meta.url), { createContextPlayer } = await import(moduleURL),
    fixture = runtimeFixture(), originalDocument = globalThis.document,
    canvasContext = new Proxy({}, { get: () => () => {} }), cases = []
  let rig
  try {
    globalThis.document = { createElement: () => ({ getContext: () => canvasContext }) }
    const { Buddy3D, THREE: T } = await import('../../src/vendor.js')
    rig = Buddy3D.create({ outline: false }); await rig.loaded; globalThis.document = originalDocument
    const roots = new Map(), probe = propGeometry(rig, T),
      concepts = process.env.BUDDY_HOLOGRAM_QUICK ? ['memory'] : ['memory', 'target', 'team', 'chain', 'link', 'cloud', 'rules', 'search']
    for (const concept of concepts) for (const face of [-1, 1]) {
      fixture.raw.reset(); const raw = fixture.raw, records = [], { B } = raw,
        selection = { fact: { id: 'concept', kind: 'keyword', text: 'Контекст', concept },
          element: { tagName: 'DIV' }, bounds: [130, 180, 460, 230] },
        tools = { ...raw.tools, registerPropBuilders(factory) {
          if (roots.size) return 3
          return rig.registerPropBuilders(kit => Object.fromEntries(Object.entries(factory(kit)).map(([name, builder]) => [name, () => {
            const prop = builder(); roots.set(name, prop.g); return prop
          }])))
        }, prop3(name, update) { const state = { ping: true }; records.push({ name, update, state }); return state } },
        player = createContextPlayer({ ...raw, renderer: 'webgl', tools }, { host: fixture.host, context: () => selection })
      try {
        Object.assign(B, { face, cam: .3, yaw: face > 0 ? .3 * Math.PI / 2 : Math.PI - .3 * Math.PI / 2, yawV: 0 })
        raw.begin(player.create('hologramKeyword'))
        const row = { concept, face, samples: 0, minimumGap: Infinity }
        cases.push(row)
        for (let frame = 0; frame < 480; frame++) {
          raw.step(1 / 60, 60)
          if (process.env.BUDDY_HOLOGRAM_QUICK && Math.abs(B.act.t - 4) > .001) continue
          const record = records.find(record => record.name === 'contextConcept'), params = record.update(record.state, B.kk)
          if (!params || params.progress <= .1) continue
          rig.pose(B.kk, B.pose, { yaw: B.yaw, head: 1.5 }); rig.place(B.x, B.y, 0, tools.S * B.scale, [1, 1], B.yaw)
          rig.prop('contextConcept', params); rig.root.updateMatrixWorld(true)
          const { head, prop, gap } = probe.read(roots.get('contextConcept'))
          row.samples++
          if (gap < row.minimumGap) { row.minimumGap = gap; row.at = { time: B.act.t, head, prop, params } }
        }
        assert.ok(row.samples > 0)
      } finally { player.destroy() }
    }
  } finally { globalThis.document = originalDocument; fixture.close() }
  if (process.env.BUDDY_HOLOGRAM_REPORT) writeFileSync(process.env.BUDDY_HOLOGRAM_REPORT,
    JSON.stringify({ created: new Date().toISOString(), contextSource: moduleURL.href,
      contextSHA: createHash('sha256').update(readFileSync(moduleURL)).digest('hex'), cases }, null, 2) + '\n')
  for (const row of cases) assert.ok(row.minimumGap >= 1, 'Зазор головы и объёма ≥1 stage px. ' + JSON.stringify(row))
})

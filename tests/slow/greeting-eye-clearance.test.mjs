import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createEyeOcclusionProbe } from '../support/eye-occlusion.mjs'

test('кисти приветствия и оклика не закрывают глазной glyph во всём цикле с шагом 60 Hz', async () => {
  const root = new URL('../../', import.meta.url), source = process.env.BUDDY_EYE_SOURCE
    ? pathToFileURL(resolve(process.env.BUDDY_EYE_SOURCE) + '/') : root,
    fixtureSource = (await readFile(new URL('tests/support/runtime-fixture.mjs', root), 'utf8'))
      .replace("'../../runtime.js'", JSON.stringify(new URL('runtime.js', source).href)),
    { runtimeFixture } = await import('data:text/javascript;base64,' + Buffer.from(fixtureSource).toString('base64')),
    { createAbilityPlayer } = await import(new URL('new-abilities.js', source).href),
    fixture = runtimeFixture(), { raw } = fixture, previous = document, context = new Proxy({}, { get: () => () => {} }),
    report = { startedUTC: new Date().toISOString(), hz: 60, sourceSHA: {}, guardSHA: {}, cases: [], failures: [],
      method: 'Настоящие skin triangles обеих кистей перед 21 внутренней точкой каждого глазного glyph. Glyph привязан к реальной поверхности head skin по uEyeC/uEyeR; проверяются XY barycentric и Z. Полный цикл и .5s tail, physics120Hz. Blink не скрывает нарушение clearance.' }
  let player
  try {
    for (const file of ['runtime.js', 'vendor.js', 'new-abilities.js'])
      report.sourceSHA[file] = createHash('sha256').update(await readFile(new URL(file, source))).digest('hex')
    for (const file of ['tests/slow/greeting-eye-clearance.test.mjs', 'tests/support/eye-occlusion.mjs'])
      report.guardSHA[file] = createHash('sha256').update(await readFile(new URL(file, root))).digest('hex')
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
    const { Buddy3D, THREE: T } = await import(new URL('vendor.js', source).href), rig = Buddy3D.create({ outline: false })
    await rig.loaded
    globalThis.document = previous
    const probe = createEyeOcclusionProbe(rig, T)
    report.geometry = probe.geometry
    raw.tools.registerPropBuilders = () => 1
    player = createAbilityPlayer(raw, { host: fixture.host })
    for (const [id, duration] of [['salute', 3.6], ['sonicPulse', 5.6]]) for (const face of [-1, 1]) {
      raw.reset(); raw.seed(14)
      Object.assign(raw.B, { face, yaw: face > 0 ? .6 * Math.PI / 2 : Math.PI - .6 * Math.PI / 2, yawV: 0 })
      raw.begin(player.create(id))
      assert.equal(raw.B.act.name, id)
      const row = { id, face, samples: 0, maxOccludedSamples: 0, completed: false }
      for (let tick = 0; tick <= Math.ceil((duration + .5) * report.hz); tick++) {
        if (tick) raw.step(1 / report.hz, 120)
        const b = raw.B, k = tick && b.kk || raw.tools.solve(b.pose, Math.cos(b.yaw) >= 0 ? 1 : -1, Math.sin(b.yaw)),
          scale = raw.tools.S * b.scale, fy = Math.max(...k.legs.flatMap(leg => [leg.heel[1], leg.toe[1]]))
        rig.pose(k, b.pose, { head: 1.5, yaw: b.yaw })
        rig.place(b.x, b.y + fy * scale, fy, scale, [1, 1], b.yaw)
        const observation = probe.read()
        row.samples++; row.maxOccludedSamples = Math.max(row.maxOccludedSamples, observation.occludedSamples)
        if (observation.hits.length) report.failures.push({ id, face, time: tick / report.hz, action: b.act?.name,
          eyes: observation.eyes, hits: observation.hits })
      }
      row.completed = raw.B.act?.name !== id
      assert.ok(row.completed, `${id} должен завершиться до хвоста записи`)
      report.cases.push(row)
    }
  } finally { globalThis.document = previous; player?.destroy(); fixture.close() }
  report.finishedUTC = new Date().toISOString()
  if (process.env.BUDDY_EYE_REPORT)
    await writeFile(process.env.BUDDY_EYE_REPORT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  assert.deepEqual(report.failures.map(({ id, face, time, eyes }) => ({ id, face, time,
    occluded: eyes.map(eye => eye.occluded) })), [], 'Ни один внутренний glyph sample не должен быть закрыт кистью спереди')
})

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const url = new URL('./browser/catalog-quality-capture.mjs', import.meta.url), source = readFileSync(url, 'utf8'),
  AsyncFunction = Object.getPrototypeOf(async () => {}).constructor,
  prefix = source.slice(source.indexOf('// Сборщик evidence'), source.indexOf('\nconst files ='))
    .replaceAll('import.meta.url', JSON.stringify(url.href)),
  coverage = source.slice(source.indexOf('function cycleCompletionCheck('), source.indexOf('\nawait saveReport()')),
  env = { BUDDY_CAPTURE_IDS: 'wave', BUDDY_REPORT_DIR: 'drafts/offline-performance-only-contract' }

// Исполняются реальные config/coverage fragments harness; access/writeFile заглушены.
// Browser, сервер, FFmpeg, source-copy и production не запускаются и не меняются.
async function config(extra = {}) {
  const accesses = [], run = new AsyncFunction('assert', 'process', 'resolve', 'dirname', 'fileURLToPath', 'createHash', 'access', 'join', 'sep',
    prefix + '\nreturn {captureSettings,performanceOnly,settingsText}')
  return { ...await run(assert, { env: { ...env, ...extra } }, resolve, dirname, fileURLToPath, createHash,
    async path => { accesses.push(path) }, join, sep), accesses }
}
async function savedCoverage(performanceOnly, cycles) {
  const report = { cycles }, registry = [{ id: 'wave' }, { id: 'nap' }], writes = [],
    run = new AsyncFunction('report', 'registry', 'performanceOnly', 'writeFile', 'reportPath',
      coverage + '\nawait saveReport();return {coverage:report.coverage,successful:[...successful().keys()]}'),
    result = await run(report, registry, performanceOnly, async (_, value) => writes.push(JSON.parse(value)), 'offline-report.json')
  assert.equal(writes.length, 1); assert.deepEqual(writes[0].coverage, result.coverage)
  return result
}
const measured = (key = 'wave:-1', windowSeconds = null) => ({ key, status: 'performance-measured', policy: { windowSeconds },
  performance: { samples: Array(120).fill({ cpuMs: 1 }), rafIntervals: Array(120).fill(16.7),
    segments: [{ kind: windowSeconds ? 'window' : 'complete', complete: true, seconds: windowSeconds || 2.5,
      actionEndedAt: windowSeconds ? null : 2, effectsEndedAt: windowSeconds ? null : 2, ownedFXAtEnd: 0, physicalPropsAtEnd: false,
      durationValidation: { passed: true } }] } })

test('подготовка записи использует существующие контролы демо и выключает автоматическое поведение', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
    controls = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
      value: '', checked: true, dispatchEvent(event) { changes.set(id, event.type) }
    }])), changes = new Map(), document = { getElementById: id => controls.get(id) ?? null },
    start = source.indexOf('      await wait(\'!!globalThis.buddy'),
    preparation = source.slice(source.indexOf('\n', start), source.indexOf('      assert.deepEqual(await ev(', start)),
    choose = async (id, value) => {
      const control = document.getElementById(id)
      assert.ok(control, 'Контрол существует в настоящем index.html: ' + id)
      control.value = value; control.dispatchEvent({ type: 'change' })
    }
  let paused = false
  const ev = async code => new Function('buddy', 'document', 'Event', code)(
    { pause() { paused = true } }, document, class { constructor(type) { this.type = type } })
  assert.ok(start >= 0 && preparation.trim(), 'Исполняется настоящий код подготовки сборщика')
  await new AsyncFunction('choose', 'ev', preparation)(choose, ev)
  assert.equal(paused, true)
  assert.equal(controls.get('mode').value, 'manual')
  assert.equal(controls.get('smart').checked, false)
  assert.equal(changes.get('mode'), 'change')
  assert.equal(changes.get('smart'), 'change')
})

test('ракурс записи задаётся отдельно от ракурса измерения производительности', async () => {
  assert.equal((await config()).captureSettings.captureView, 'auto')
  for (const captureView of ['overview', 'closeup', 'auto']) {
    const result = await config({ BUDDY_CAPTURE_VIEW: captureView, BUDDY_PERF_VIEW: 'closeup' })
    assert.equal(result.captureSettings.captureView, captureView)
    assert.equal(result.captureSettings.perfView, 'closeup')
  }
  await assert.rejects(config({ BUDDY_CAPTURE_VIEW: 'invalid' }), { code: 'ERR_ASSERTION' })
})

test('default config сохраняет encoder checks и явно версионирует completion', async () => {
  const result = await config()
  assert.deepEqual(result.captureSettings, { dpr: 1, perfView: 'overview', captureView: 'auto', quoteTraceOnly: false,
    actorDetails: false, captureVideo: true, capturePerformance: true, keyframes: {}, completionContract: 'action-owned-effects-tail-v1' })
  assert.equal(result.performanceOnly, false); assert.equal(result.accesses.length, 2)
  assert.deepEqual((await config({ BUDDY_CAPTURE_PERFORMANCE_ONLY: '0' })).captureSettings, result.captureSettings)
})

test('performance-only отключает видео и не требует encoder binaries', async () => {
  const result = await config({ BUDDY_CAPTURE_PERFORMANCE_ONLY: '1', BUDDY_CAPTURE_ACTOR_DETAILS: '1',
    BUDDY_FFMPEG: '/missing/ffmpeg', BUDDY_FFPROBE: '/missing/ffprobe' })
  assert.equal(result.performanceOnly, true); assert.equal(result.captureSettings.performanceOnly, true)
  assert.equal(result.captureSettings.captureVideo, false); assert.equal(result.captureSettings.capturePerformance, true)
  assert.equal(result.captureSettings.actorDetails, false)
  assert.deepEqual(result.accesses, []); assert.deepEqual(JSON.parse(result.settingsText), result.captureSettings)
})

test('дополнительная сцена стен включается явно и только для лазанья', async () => {
  assert.equal((await config()).captureSettings.directedWalls, undefined)
  assert.equal((await config({ BUDDY_CAPTURE_WALL_DIRECTIONS: '0' })).captureSettings.directedWalls, undefined)
  assert.equal((await config({ BUDDY_CAPTURE_WALL_DIRECTIONS: '1', BUDDY_CAPTURE_IDS: 'climb,web' })).captureSettings.directedWalls, true)
  await assert.rejects(config({ BUDDY_CAPTURE_WALL_DIRECTIONS: '1' }), { code: 'ERR_ASSERTION' })
  await assert.rejects(config({ BUDDY_CAPTURE_WALL_DIRECTIONS: 'yes' }), { code: 'ERR_ASSERTION' })
})

test('адресный старт парашюта не меняет обычную сцену и проверяет координату до IO', async () => {
  assert.equal((await config()).captureSettings.parachuteStartX, undefined)
  const extra = { BUDDY_CAPTURE_IDS: 'parachute', BUDDY_CAPTURE_PARACHUTE_SITE: '1066' }
  assert.equal((await config(extra)).captureSettings.parachuteStartX, 1066)
  for (const value of ['NaN', '-1', '1281']) await assert.rejects(config({ ...extra, BUDDY_CAPTURE_PARACHUTE_SITE: value }), { code: 'ERR_ASSERTION' })
  await assert.rejects(config({ BUDDY_CAPTURE_PARACHUTE_SITE: '1066' }), { code: 'ERR_ASSERTION' })
})

test('невалидный или конфликтный performance-only input прекращается до IO', async () => {
  for (const extra of [
    { BUDDY_CAPTURE_PERFORMANCE_ONLY: 'yes' }, { BUDDY_CAPTURE_PERFORMANCE_ONLY: '2' },
    { BUDDY_CAPTURE_PERFORMANCE_ONLY: '1', BUDDY_CAPTURE_PERFORMANCE: '0' },
    { BUDDY_CAPTURE_PERFORMANCE_ONLY: '1', BUDDY_CAPTURE_QUOTE_TRACE: '1', BUDDY_CAPTURE_IDS: 'quoteIdea' },
    { BUDDY_CAPTURE_PERFORMANCE_ONLY: '1', BUDDY_CAPTURE_DPR: 'NaN' },
    { BUDDY_CAPTURE_PERFORMANCE_ONLY: '1', BUDDY_PERF_VIEW: 'unknown' },
    { BUDDY_CAPTURE_PERFORMANCE_ONLY: '1', BUDDY_REPORT_DIR: 'outside-drafts' }
  ]) await assert.rejects(config(extra), { code: 'ERR_ASSERTION' })
})

test('performance coverage отдельно от visual и принимает только полные measured стороны', async () => {
  const left = measured(), right = measured('wave:1'), window = measured('nap:-1', 12), short = measured('nap:1', 12),
    captured = { key: 'nap:1', status: 'captured', completion: { kind: 'complete' } }
  short.performance.samples.pop()
  const { coverage, successful } = await savedCoverage(true, [left, right, window, short, captured])
  assert.deepEqual(successful, ['wave:-1', 'wave:1', 'nap:-1'])
  assert.equal(coverage.evidenceKind, 'native-performance-only')
  assert.deepEqual(coverage.visual, { requested: false, captured: [], fullCycles: 0, explicitWindows: [] })
  assert.deepEqual(coverage.performance, { expectedCycles: 4, measured: ['wave:-1', 'wave:1', 'nap:-1'],
    missing: ['nap:1'], minimumSamplesPerFace: 120, fullCycleSegments: 2, explicitWindows: ['nap:-1'] })
  for (const invalid of [
    row => row.performance.rafIntervals.pop(), row => { row.performance.segments[0].complete = false },
    row => { row.performance.segments[0].seconds = 2.49 }, row => { row.performance.segments[0].durationValidation.passed = false },
    row => { row.performance.segments[0].actionEndedAt = null }, row => { delete row.policy },
    row => { row.performance.samples = { length: 120 } }
  ]) {
    const row = measured(); invalid(row)
    assert.deepEqual((await savedCoverage(true, [row])).successful, [])
  }
})

test('default coverage остаётся визуальным captured, performance-only не засчитывается', async () => {
  const { coverage, successful } = await savedCoverage(false, [measured(),
    { key: 'wave:1', status: 'captured', policy: { windowSeconds: null }, durationValidation: { passed: true },
      completion: { kind: 'complete', actionEndedAt: 2, effectsEndedAt: 2, seconds: 2.5, ownedFXAtEnd: 0, physicalPropsAtEnd: false } },
    { key: 'nap:-1', status: 'captured', policy: { windowSeconds: 12 }, durationValidation: { passed: true },
      completion: { kind: 'window', seconds: 12 } }, { key: 'nap:1', status: 'failed' }])
  assert.deepEqual(successful, ['wave:1', 'nap:-1'])
  assert.deepEqual(coverage, { registrySize: 2, expectedCycles: 4, captured: ['wave:1', 'nap:-1'],
    missing: ['wave:-1', 'nap:1'], fullCycles: 1, explicitWindows: ['nap:-1'] })
})

function simulatedCapture({ fxUntil = 0, propsUntil = 0, preexistingUntil = 0, windowSeconds = null, hz = 120, tailSeconds = .5 } = {}) {
  const helperAt = source.indexOf('  function captureCompletion('), snapshotAt = source.indexOf('  globalThis.qaSnapshot ='),
    body = source.slice(helperAt >= 0 ? helperAt : snapshotAt, source.indexOf('  globalThis.qaStart =', snapshotAt)),
    initial = { name: 'point', t: 0 }, idle = { name: 'idle', t: 0 }, fx = {}, preexisting = {},
    b = { act: initial, queue: [], fxs: [], kk: { arms: [{ hand: [0, 0, 0] }, { hand: [0, 0, 0] }],
      legs: [{ heel: [0, 0, 0], toe: [0, 0, 0] }], seat: [0, 0, 0], head: [0, 0, 0] },
      scale: 1, yaw: 0, x: 0, y: 0, surf: { kind: 'floor' } },
    session = { elapsed: 0, completedAt: null, effectsEndedAt: null, initialAction: initial, tokens: new Map(), tailSeconds,
      policy: { windowSeconds }, preexistingFX: new Set([preexisting]) }, sandbox = { qaSession: session },
    buddy = { experimental: { B: b, tools: { S: 1, hands: () => [[0, 0], [0, 0]] } },
      framing: () => ({ props: session.elapsed < propsUntil ? [0, 0, 10, 10] : null }), metrics: () => ({}) },
    snapshot = new Function('globalThis', 'buddy', body + '\nreturn globalThis.qaSnapshot')(sandbox, buddy),
    modelExpression = source.match(/^        completed = (.+)$/m)?.[1],
    nativeExpression = source.match(/              complete=([^;]+);/)?.[1]
  assert.ok(modelExpression && nativeExpression, 'Проверяются настоящие model/native stop expressions')
  const modelStop = new Function('row', 'sample', 'return ' + modelExpression),
    nativeStop = new Function('qaSession', 'state', 'return ' + nativeExpression)
  let modelAt = null, nativeAt = null, last
  for (let tick = 0; tick <= 12 * hz; tick++) {
    session.elapsed = tick / hz; b.t = session.elapsed
    if (session.elapsed >= 2.8) b.act = idle
    b.fxs = [...(session.elapsed < fxUntil ? [fx] : []), ...(session.elapsed < preexistingUntil ? [preexisting] : [])]
    last = snapshot()
    if (modelAt === null && modelStop({ policy: session.policy }, last)) modelAt = session.elapsed
    if (nativeAt === null && nativeStop(session, last)) nativeAt = session.elapsed
    if (modelAt !== null && nativeAt !== null) break
  }
  return { modelAt, nativeAt, last }
}

test('tracker action2.8 + owned FX5 записывается до effects5 +.5tail в model/native', () => {
  for (const hz of [24, 60, 120]) {
    const result = simulatedCapture({ fxUntil: 5, hz })
    assert.ok(result.modelAt >= 5.5 && result.modelAt < 5.5 + 2 / hz, JSON.stringify(result))
    assert.ok(result.nativeAt >= 5.5 && result.nativeAt < 5.5 + 2 / hz)
    assert.ok(result.last.completedAt >= 2.8 && result.last.completedAt < 2.8 + 2 / hz)
    assert.equal(result.last.effectsEndedAt, 5)
  }
})

test('noFX сохраняет action+.5tail; physical props продлевают визуальный горизонт; windows остаются явными', () => {
  const empty = simulatedCapture(), physical = simulatedCapture({ propsUntil: 5 })
  assert.ok(empty.modelAt >= 3.3 && empty.modelAt < 3.32); assert.equal(empty.modelAt, empty.nativeAt)
  assert.ok(physical.modelAt >= 5.5); assert.equal(physical.modelAt, physical.nativeAt)
  assert.equal(simulatedCapture({ preexistingUntil: 20 }).modelAt, empty.modelAt, 'Не ждём FX прежней warmup-стойки')
  for (const windowSeconds of [8, 12]) {
    const window = simulatedCapture({ fxUntil: 20, propsUntil: 20, windowSeconds })
    assert.equal(window.modelAt, windowSeconds); assert.equal(window.nativeAt, windowSeconds)
  }
})

test('расширенный tail наблюдает выход renderer cooldown после исчезновения FX', async () => {
  const configResult = await config({ BUDDY_CAPTURE_PERFORMANCE_ONLY: '1', BUDDY_CAPTURE_TAIL_SECONDS: '2.6' })
  assert.equal(configResult.captureSettings.tailSeconds, 2.6)
  for (const hz of [24, 60, 120]) {
    const result = simulatedCapture({ fxUntil: 5, tailSeconds: 2.6, hz })
    assert.ok(result.modelAt >= 7.6 && result.modelAt < 7.6 + 2 / hz)
    assert.equal(result.nativeAt, result.modelAt)
    assert.equal(result.last.effectsEndedAt, 5)
  }
  for (const tail of ['0', '.49', 'NaN', '11']) await assert.rejects(config({ BUDDY_CAPTURE_TAIL_SECONDS: tail }), { code: 'ERR_ASSERTION' })
})

test('длинный FX не маскирует premature action end, старый captured без effects horizon не повышается', async () => {
  const durationBody = source.slice(source.indexOf('function cycleDurationCheck('), source.indexOf('\nfunction encoder(')),
    durationCheck = new Function(durationBody + '\nreturn cycleDurationCheck')(),
    duration = durationCheck({ duration: 5 }, { windowSeconds: null }, 2.8),
    row = { key: 'wave:-1', status: 'captured', policy: { windowSeconds: null }, durationValidation: duration,
      completion: { kind: 'complete', actionEndedAt: 2.8, effectsEndedAt: 5, seconds: 5.5, ownedFXAtEnd: 0, physicalPropsAtEnd: false } }
  assert.equal(duration.passed, false)
  assert.deepEqual((await savedCoverage(false, [row])).successful, [])
  row.durationValidation = { passed: true }; delete row.completion.effectsEndedAt
  assert.deepEqual((await savedCoverage(false, [row])).successful, [])
  const perf = measured(); perf.performance.segments[0].effectsEndedAt = 5
  assert.deepEqual((await savedCoverage(true, [perf])).successful, [], 'Native coverage не принимает лишь action+.5 при живом FX')
})

test('active lifecycle midpoint основан на original actionEndedAt, не на полной FX записи', () => {
  const expression = source.match(/row\.activeProbeSeconds = (.+)/)?.[1]
  assert.ok(expression)
  const midpoint = new Function('row', 'return ' + expression)
  assert.equal(midpoint({ policy: { windowSeconds: null }, completion: { actionEndedAt: 2.8, seconds: 5.5 } }), 1.456)
  assert.equal(midpoint({ policy: { windowSeconds: 12 }, completion: { actionEndedAt: null, seconds: 12 } }), 6.24)
})

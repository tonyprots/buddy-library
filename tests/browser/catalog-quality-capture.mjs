import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { once } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGzip } from 'node:zlib'
import { openBrowser } from './cdp.mjs'

// Сборщик evidence, а не независимый принимающий: оценок качества здесь нет.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), fps = 24, numericHz = 120,
  ffmpeg = process.env.BUDDY_FFMPEG || '/opt/homebrew/bin/ffmpeg',
  ffprobe = process.env.BUDDY_FFPROBE || '/opt/homebrew/bin/ffprobe',
  hash = data => createHash('sha256').update(data).digest('hex'),
  requested = process.env.BUDDY_CAPTURE_IDS?.trim(), destination = process.env.BUDDY_REPORT_DIR?.trim(),
  captureDpr = Number(process.env.BUDDY_CAPTURE_DPR || 1), perfView = process.env.BUDDY_PERF_VIEW || 'overview',
  captureView = process.env.BUDDY_CAPTURE_VIEW || 'auto',
  viewButtons = { overview: '#overview', closeup: '#zoom', auto: '#autoFrame' },
  performanceOnly = process.env.BUDDY_CAPTURE_PERFORMANCE_ONLY === '1',
  allocationTrace = process.env.BUDDY_CAPTURE_ALLOCATION_TRACE === '1',
  directedWalls = process.env.BUDDY_CAPTURE_WALL_DIRECTIONS === '1',
  parachuteStartX = process.env.BUDDY_CAPTURE_PARACHUTE_SITE === undefined ? null : Number(process.env.BUDDY_CAPTURE_PARACHUTE_SITE),
  tailSeconds = Number(process.env.BUDDY_CAPTURE_TAIL_SECONDS || .5),
  quoteTraceOnly = process.env.BUDDY_CAPTURE_QUOTE_TRACE === '1',
  actorDetails = !performanceOnly && process.env.BUDDY_CAPTURE_ACTOR_DETAILS === '1',
  captureVideo = !performanceOnly && process.env.BUDDY_CAPTURE_VIDEO !== '0',
  capturePerformance = process.env.BUDDY_CAPTURE_PERFORMANCE !== '0',
  keyframes = JSON.parse(process.env.BUDDY_CAPTURE_KEYFRAMES || '{}'),
  completionContract = 'action-owned-effects-tail-v1',
  captureSettings = { dpr: captureDpr, perfView, captureView, quoteTraceOnly, actorDetails, captureVideo, capturePerformance, keyframes,
    ...(allocationTrace ? { allocationTrace: true } : {}),
    ...(directedWalls ? { directedWalls: true } : {}),
    ...(parachuteStartX === null ? {} : { parachuteStartX }),
    ...(tailSeconds !== .5 ? { tailSeconds } : {}),
    completionContract, ...(performanceOnly ? { performanceOnly: true } : {}) }, settingsText = JSON.stringify(captureSettings, null, 2) + '\n'
assert.ok(requested && destination, 'Обязательны BUDDY_CAPTURE_IDS=id,id и BUDDY_REPORT_DIR=папка-в-drafts')
assert.ok(process.env.BUDDY_CAPTURE_PERFORMANCE_ONLY === undefined || ['0', '1'].includes(process.env.BUDDY_CAPTURE_PERFORMANCE_ONLY),
  'BUDDY_CAPTURE_PERFORMANCE_ONLY: только 0 или 1')
assert.ok(!performanceOnly || capturePerformance && !quoteTraceOnly, 'Performance-only требует native CPU/rAF и несовместим с quote trace-only')
assert.ok(!allocationTrace || performanceOnly, 'Allocation trace — отдельный performance-only прогон, без screenshots/FFmpeg')
assert.ok(process.env.BUDDY_CAPTURE_WALL_DIRECTIONS === undefined || ['0', '1'].includes(process.env.BUDDY_CAPTURE_WALL_DIRECTIONS), 'Wall directions: только0или1')
assert.ok(!directedWalls || requested.split(/[\s,]+/u).every(id => ['climb', 'web'].includes(id)), 'Дополнительная физическая сцена предназначена только дляclimb/web')
assert.ok(parachuteStartX === null || Number.isFinite(parachuteStartX) && parachuteStartX >= 0 && parachuteStartX <= 1280,
  'Старт парашюта — конечная координата на слайде')
assert.ok(parachuteStartX === null || requested === 'parachute', 'Явный старт предназначен только для дополнительной проверки парашюта')
assert.ok(Number.isFinite(tailSeconds) && tailSeconds >= .5 && tailSeconds <= 10, 'Хвост записи: от0.5до10 секунд')
assert.ok(!quoteTraceOnly || requested === 'quoteIdea', 'Quote trace-only предназначен только для BUDDY_CAPTURE_IDS=quoteIdea')
assert.ok(Number.isFinite(captureDpr) && captureDpr > 0, 'BUDDY_CAPTURE_DPR должен быть положительным числом')
assert.ok(['overview', 'closeup', 'auto'].includes(perfView), 'BUDDY_PERF_VIEW: overview, closeup или auto')
assert.ok(['overview', 'closeup', 'auto'].includes(captureView), 'BUDDY_CAPTURE_VIEW: overview, closeup или auto')
const output = resolve(root, destination), sourceRoot = join(output, 'sources')
assert.ok(output.startsWith(join(root, 'drafts') + sep), 'Уникальное evidence сохраняется в drafts проекта, не в tmp')
if (!performanceOnly) { await access(ffmpeg); await access(ffprobe) }

const sourceFiles = (await readdir(root)).filter(file => /\.(?:js|html|json|d\.ts)$/u.test(file)),
  presetFiles = (await readdir(join(root, 'presets'))).filter(file => file.endsWith('.js')).map(file => 'presets/' + file),
  files = [...new Set([...sourceFiles, ...presetFiles, 'tests/browser/catalog-quality-capture.mjs', 'tests/browser/cdp.mjs'])].sort(),
  contents = new Map(await Promise.all(files.map(async file => [file, await readFile(join(root, file))]))),
  originalHtml = contents.get('index.html').toString(),
  bridge = `\nglobalThis.qaUI={setBuddy(value){buddy=value;globalThis.buddy=value},state(){return{switching,selected:selected.id}},cameraMode};\n`,
  marker = originalHtml.lastIndexOf('</script>')
assert.ok(marker > 0 && originalHtml.includes('let buddy,'), 'Стенд должен содержать известный UI-контроллер')
assert.equal(originalHtml.split('if (buddy && !switching) {').length, 2, 'Известная единственная точка UI camera update')
const servedHtml = (originalHtml.slice(0, marker) + bridge + originalHtml.slice(marker))
    .replace('if (buddy && !switching) {', 'if (buddy && !switching && !globalThis.qaCameraFrozen) {'),
  hashes = Object.fromEntries([...contents].map(([file, data]) => [file, hash(data)]))
hashes['served-index.html'] = hash(servedHtml)
hashes['capture-settings.json'] = hash(settingsText)
const snapshotId = hash(JSON.stringify(hashes)), manifestPath = join(output, 'source-manifest.json'),
  existingManifest = await readFile(manifestPath, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
if (existingManifest) assert.equal(existingManifest.snapshotId, snapshotId, 'Resume запрещён: SHA исходников или сборщика изменился; выберите новую папку')
await mkdir(sourceRoot, { recursive: true })
if (!existingManifest) {
  for (const [file, data] of contents) {
    await mkdir(dirname(join(sourceRoot, file)), { recursive: true })
    await writeFile(join(sourceRoot, file), data, { flag: 'wx' })
  }
  await writeFile(join(sourceRoot, 'served-index.html'), servedHtml, { flag: 'wx' })
  await writeFile(join(sourceRoot, 'capture-settings.json'), settingsText, { flag: 'wx' })
  await writeFile(manifestPath, JSON.stringify({ date: new Date().toISOString(), snapshotId, hashes,
    captureSettings,
    instrumentation: 'UI bridge заменяет экземпляр после UI-подготовки; test-only camera-freeze для крупных PNG. Runtime counters wrap registrations/dispose in memory; production исходники сохранены дословно.' }, null, 2) + '\n')
} else for (const [file, expected] of Object.entries(hashes))
  assert.equal(hash(await readFile(join(sourceRoot, file))), expected, 'Повреждён сохранённый исходник ' + file)

const { techniques } = await import(pathToFileURL(join(sourceRoot, 'index.js')).href), registry = JSON.parse(JSON.stringify(techniques)),
  ids = requested === 'all' ? registry.map(item => item.id) : [...new Set(requested.split(/[\s,]+/u).filter(Boolean))],
  known = new Set(registry.map(item => item.id))
assert.ok(ids.length && ids.every(id => known.has(id)), 'BUDDY_CAPTURE_IDS содержит неизвестный ID')
assert.equal(known.size, registry.length, 'В реестре нет повторных ID')
for (const [id, times] of Object.entries(keyframes)) {
  assert.ok(known.has(id) && Array.isArray(times) && times.length > 0, 'Keyframes: известный ID и непустой массив секунд')
  assert.ok(times.every((time, i) => Number.isFinite(time) && time >= 0 && (!i || time > times[i - 1])), 'Keyframes отсортированы, без повторов и неотрицательны')
}
const reportPath = join(output, 'report.json'),
  report = await readFile(reportPath, 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return { schema: 3, snapshotId, captureSettings, created: new Date().toISOString(), registry, batches: [], cycles: [], errors: [],
      ...(performanceOnly ? { evidenceKind: 'native-performance-only', visualEvidence: false } : {}),
      limits: performanceOnly ? ['Только native CPU/rAF, отдельно для обеих сторон; полный модельный цикл и визуальные кадры не записываются.',
        'Нет MP4, PNG, raw120Hz trajectory, closeup, interrupt/reset/slide/destroy phase probes. Это не visual/model coverage и не lifecycle acceptance.',
        'На каждую сторону ≥120 CPU samples и rAF intervals; полный цикл ждёт action end, owned FX0 и отсутствие physical props, затем tail ≥0.5s; nap/idle — явные окна.',
        'GPU-time не измеряется. Resource traversal вне CPU clock может влиять на rAF; mount/launch учитываются отдельно.',
        ...(allocationTrace ? ['Allocation trace: test-only обёртка setDrawingBufferSize сохраняет start/end всех выделений, включая mount/launch/внешний render до первого native sample; добавляет измерительный overhead, это отдельный диагностический срез.'] : []),
        'qaStart, seed14, public play, scene/context/direction preparation и native loop совпадают с обычным режимом.']
        : ['Это сбор evidence без оценок 8/10 и без автоматической визуальной приёмки.',
        captureVideo ? `MP4: модельные 24 кадра/с, DPR${captureDpr}; реальные rAF и CPU измеряются отдельно, без кодирования видео.`
          : 'MP4 не записывается: полный raw120Hz цикл и native closeup/actor-detail фазы. Новых покадровых видеодоказательств нет.',
        capturePerformance ? 'Native CPU/rAF включён для representative face+1.'
          : 'Native CPU/rAF в этом срезе отключён. Запись не принимает эффективность; нужен отдельный изолированный замер на совпадающих production SHA.',
        'Числовые подшаги 120 Hz: кинематика до squash и реальные SVG-кисти; данные потоком JSONL.gz.',
        'GPU-время и память драйвера не доступны. Ресурсы — достижимые Three.js объекты и события dispose, DOM и FX.',
        'Idle и nap имеют явно ограниченное окно наблюдения; конечный таймаут считается ошибкой, не полным циклом.',
        'Action end и конец owned FX/physical props учитываются отдельно; полный visual/native цикл включает effects tail +0.5s. Обещанная duration проверяется только по action end.',
        'UI готовит сцену/пресет/источник, затем свежий экземпляр исключает память предыдущего номера.'] }
  })
assert.equal(report.snapshotId, snapshotId)
assert.deepEqual(report.registry, registry)
report.batches.push({ date: new Date().toISOString(), ids, ...(performanceOnly ? { nativeHz: 60 } : { fps, numericHz }), ...captureSettings })

function cycleCompletionCheck(policy, completion) {
  const window = !!policy?.windowSeconds, passed = window
    ? completion?.kind === 'window' && completion.seconds >= policy.windowSeconds
    : completion?.kind === 'complete' && Number.isFinite(completion.actionEndedAt) && Number.isFinite(completion.effectsEndedAt)
      && completion.effectsEndedAt >= completion.actionEndedAt && completion.seconds >= completion.effectsEndedAt + .5 - 1e-6
      && completion.ownedFXAtEnd === 0 && completion.physicalPropsAtEnd === false
  return { contract: 'action-owned-effects-tail-v1', passed: !!passed }
}

const hasFullPerformance = row => row.policy && Array.isArray(row.performance?.samples) && row.performance.samples.length >= 120
    && Array.isArray(row.performance?.rafIntervals) && row.performance.rafIntervals.length >= 120
    && Array.isArray(row.performance.segments) && row.performance.segments.length > 0 && row.performance.segments.every(segment => segment.complete
      && segment.durationValidation?.passed && cycleCompletionCheck(row.policy, segment).passed),
  successful = () => new Map(report.cycles.filter(row => performanceOnly
    ? row.status === 'performance-measured' && hasFullPerformance(row)
    : row.status === 'captured' && row.durationValidation?.passed && cycleCompletionCheck(row.policy, row.completion).passed).map(row => [row.key, row])),
  saveReport = async () => {
    const done = successful(), required = registry.flatMap(item => [-1, 1].map(face => item.id + ':' + face))
    report.updated = new Date().toISOString()
    report.coverage = performanceOnly ? { registrySize: registry.length, evidenceKind: 'native-performance-only',
      visual: { requested: false, captured: [], fullCycles: 0, explicitWindows: [] },
      performance: { expectedCycles: required.length, measured: required.filter(key => done.has(key)),
        missing: required.filter(key => !done.has(key)), minimumSamplesPerFace: 120,
        fullCycleSegments: [...done.values()].filter(row => !row.policy.windowSeconds).reduce((sum, row) => sum + row.performance.segments.length, 0),
        explicitWindows: [...done.values()].filter(row => row.policy.windowSeconds).map(row => row.key) } }
      : { registrySize: registry.length, expectedCycles: required.length,
      captured: required.filter(key => done.has(key)), missing: required.filter(key => !done.has(key)),
      fullCycles: [...done.values()].filter(row => row.completion?.kind === 'complete').length,
      explicitWindows: [...done.values()].filter(row => row.completion?.kind === 'window').map(row => row.key) }
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  }
await saveReport()

const contextScenes = { laptopNotes: 'context-text', thinkNumber: 'numbers', hologramObject: 'context-keywords',
  hologramKeyword: 'context-keywords', traceFocus: 'context-text', peekCard: 'context-cards', perchRead: 'context-cards',
  thinkKeyword: 'context-keywords', quoteIdea: 'context-text', compareValues: 'context-values', showBeforeAfter: 'context-images',
  followChart: 'context-chart', chartClimb: 'context-bars', cardRoute: 'context-route', traceFlow: 'context-flow',
  assembleList: 'context-list', inspectDetail: 'context-detail' },
  sceneFor = entry => contextScenes[entry.id] || (entry.requires === 'stairs' ? 'stairs' : entry.requires === 'finale' ? 'finale'
    : ['wall', 'platform', 'icon', 'land', 'brand', 'elevated'].includes(entry.requires) || entry.id === 'tracker' ? 'platforms'
      : ['point', 'present', 'spotlight', 'lookSlide'].includes(entry.id) ? 'image' : 'empty'),
  policyFor = entry => ({ capSeconds: entry.id === 'stairs' ? 90 : 60,
    windowSeconds: entry.id === 'nap' ? 12 : entry.id === 'idle' ? 8 : null,
    windowReason: entry.id === 'nap' ? 'Сон длится до прерывания' : entry.id === 'idle' ? 'Фоновая стойка и дыхание: окно наблюдения' : null })

function cycleDurationCheck(entry, policy, actionEndedAt) {
  const required = !policy.windowSeconds && Number.isFinite(entry.duration) && entry.duration > 0,
    minimumSeconds = required ? entry.duration - .1 : null
  return { promisedSeconds: entry.duration ?? null, minimumSeconds, actionEndedAt,
    skippedReason: policy.windowSeconds ? 'Объявленное окно' : required ? null : 'Нет фиксированной длительности',
    passed: !required || Number.isFinite(actionEndedAt) && actionEndedAt >= minimumSeconds }
}

function encoder(file) {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'image2pipe', '-vcodec', 'mjpeg',
    '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000) }); child.stdin.on('error', () => {})
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg ${code}: ${stderr}`)))
  })
  closed.catch(() => {})
  return { write: buffer => new Promise((resolve, reject) => child.stdin.write(buffer, error => error ? reject(error) : resolve())),
    async close() { child.stdin.end(); await closed }, kill() { child.kill() } }
}

async function probe(file) {
  const child = spawn(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,avg_frame_rate,nb_frames,duration', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', data => { stdout += data }); child.stderr.on('data', data => { stderr += data })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, stderr)
  return JSON.parse(stdout).streams[0]
}

// Выполняется в браузере; обёртка сохраняет тот же create/rig и не меняет рендеринг.
async function installHarness() {
  const module = await import('/index.js'), vendor = await import('/vendor.js'), original = vendor.Buddy3D.create,
    resourceOwners = new WeakMap(), native = {}, listenerRecords = new Set(),
    production = /\/[^/\s]+\.js[:?]/u
  let owner = null, nextInstanceId = 0
  const withOwner = (record, fn) => { const previous = owner; owner = record; try { return fn() } finally { owner = previous } },
    registrationOwner = () => owner && production.test(new Error().stack || '') ? owner : null,
    currentRecord = () => globalThis.qaInstance,
    observeResource = (record, kind, resource, origin = 'reachable') => {
      if (!record || !resource || record.resources[kind].has(resource)) return
      const firstOwner = resourceOwners.get(resource)
      record.resources[kind].add(resource)
      if (firstOwner && firstOwner !== record.id) record.shared[kind].add(resource)
      else { resourceOwners.set(resource, record.id); record.owned[kind].add(resource) }
      if (origin === 'dispose') record.disposeOnly[kind].add(resource)
      resource.addEventListener('dispose', () => record.disposed[kind].add(resource))
    },
    resourceSets = () => ({ geometries: new Set(), materials: new Set(), textures: new Set() })
  // Test-only ownership: registrations made in library calls and their callbacks.
  // UI's independent camera RAF and harness waits never get an instance owner.
  for (const [schedule, cancel, kind] of [['setTimeout', 'clearTimeout', 'timers'], ['setInterval', 'clearInterval', 'intervals'], ['requestAnimationFrame', 'cancelAnimationFrame', 'raf']]) {
    native[schedule] = globalThis[schedule].bind(globalThis); native[cancel] = globalThis[cancel].bind(globalThis)
    const owners = new Map()
    globalThis[schedule] = (callback, ...args) => {
      const record = registrationOwner()
      if (!record || typeof callback !== 'function') return native[schedule](callback, ...args)
      const id = native[schedule]((...values) => {
        if (kind !== 'intervals') { record.pending[kind].delete(id); owners.delete(id) }
        return withOwner(record, () => callback(...values))
      }, ...args)
      owners.set(id, record); record.pending[kind].add(id); return id
    }
    globalThis[cancel] = id => { owners.get(id)?.pending[kind].delete(id); owners.delete(id); return native[cancel](id) }
  }
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener,
    captureOf = options => typeof options === 'boolean' ? options : !!options?.capture
  EventTarget.prototype.addEventListener = function (type, callback, options) {
    const record = registrationOwner(), capture = captureOf(options)
    if (!record || !callback) return add.call(this, type, callback, options)
    if ([...listenerRecords].some(item => item.target === this && item.type === type && item.callback === callback && item.capture === capture)) return
    const item = { record, target: this, type, callback, capture, active: true }
    item.wrapper = function (...args) {
      if (options?.once) { listenerRecords.delete(item); record.pending.listeners.delete(item) }
      return withOwner(record, () => typeof callback === 'function' ? callback.apply(this, args) : callback.handleEvent(...args))
    }
    listenerRecords.add(item); record.pending.listeners.add(item)
    return add.call(this, type, item.wrapper, options)
  }
  EventTarget.prototype.removeEventListener = function (type, callback, options) {
    const item = [...listenerRecords].find(item => item.target === this && item.type === type && item.callback === callback && item.capture === captureOf(options))
    if (item) { listenerRecords.delete(item); item.record.pending.listeners.delete(item) }
    return remove.call(this, type, item?.wrapper || callback, options)
  }
  for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) if (globalThis[name]) {
    const Base = globalThis[name]
    globalThis[name] = class extends Base {
      constructor(callback) {
        const record = registrationOwner()
        super((...args) => withOwner(record, () => callback(...args)))
        this.qaOwner = record
      }
      observe(...args) { this.qaOwner?.pending.observers.add(this); return super.observe(...args) }
      disconnect() { this.qaOwner?.pending.observers.delete(this); return super.disconnect() }
    }
  }
  // Vendor intentionally exports a compact namespace; the three base classes are private.
  for (const [kind, Type] of [['geometries', vendor.THREE.SphereGeometry], ['materials', vendor.THREE.ShaderMaterial], ['textures', vendor.THREE.CanvasTexture]]) {
    const prototype = Object.getPrototypeOf(Type.prototype), dispose = prototype.dispose
    if (typeof dispose !== 'function' || !Object.hasOwn(prototype, 'dispose')) throw new Error('Недоступен базовый dispose для ' + kind)
    prototype.dispose = function (...args) {
      const record = owner
      observeResource(record, kind, this, 'dispose')
      if (record) record.disposeCalls[kind].set(this, (record.disposeCalls[kind].get(this) || 0) + 1)
      return dispose.apply(this, args)
    }
  }
  globalThis.qaModule = module
  globalThis.qaOwned = fn => withOwner(currentRecord(), fn)
  if (globalThis.qaAllocationTraceEnabled) {
    const Renderer = vendor.THREE.WebGLRenderer
    globalThis.qaAllocationSpans = []
    vendor.THREE.WebGLRenderer = class extends Renderer {
      constructor(...args) {
        super(...args)
        const resize = this.setDrawingBufferSize, record = owner
        this.setDrawingBufferSize = function (...values) {
          const start = performance.now()
          try { return resize.apply(this, values) }
          finally { qaAllocationSpans.push({ instanceId: record?.id ?? null, start, end: performance.now(),
            width: values[0], height: values[1], ratio: values[2] }) }
        }
      }
    }
  }
  vendor.Buddy3D.create = function (...args) { const rig = original.apply(this, args); if (owner) owner.rig = rig; return rig }
  globalThis.qaResources = (record = currentRecord()) => {
    const geometries = new Set(), materials = new Set(), textures = new Set(), rig = record?.rig
    let objects = 0, visibleObjects = 0, visibleMeshes = 0, geometryBytes = 0
    const isVisible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true }
    let scene = rig?.root
    while (scene?.parent) scene = scene.parent
    scene?.traverse(object => {
      objects++; if (isVisible(object)) { visibleObjects++; if (object.isMesh) visibleMeshes++ }
      if (object.geometry) geometries.add(object.geometry)
      if (object.skeleton?.boneTexture) textures.add(object.skeleton.boneTexture)
      if (object.background?.isTexture) textures.add(object.background)
      if (object.environment?.isTexture) textures.add(object.environment)
      for (const material of [].concat(object.material || [])) {
        materials.add(material)
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
        for (const uniform of Object.values(material.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value)
      }
    })
    for (const geometry of geometries) {
      for (const attribute of [geometry.index, ...Object.values(geometry.attributes || {}), ...Object.values(geometry.morphAttributes || {}).flat()])
        geometryBytes += attribute?.array?.byteLength || 0
    }
    for (const [kind, resources] of Object.entries({ geometries, materials, textures })) for (const resource of resources) observeResource(record, kind, resource)
    const host = record?.host || document.querySelector('#stage > .buddy'), live = record?.buddy,
      counts = sets => Object.fromEntries(Object.entries(sets).map(([kind, values]) => [kind, values.size])),
      accounting = record ? { instanceId: record.id, observedCreated: counts(record.owned), sharedFromPriorInstances: counts(record.shared),
        initialAtMount: record.initialResources, disposed: counts(record.disposed), onlyObservedAtDispose: counts(record.disposeOnly),
        disposeCalls: Object.fromEntries(Object.entries(record.disposeCalls).map(([kind, values]) => [kind, [...values.values()].reduce((sum, value) => sum + value, 0)])),
        disposedMoreThanOnce: Object.fromEntries(Object.entries(record.disposeCalls).map(([kind, values]) => [kind, [...values.values()].filter(value => value > 1).length])),
        outstandingOwned: Object.fromEntries(Object.keys(record.owned).map(kind => [kind, [...record.owned[kind]].filter(value => !record.disposed[kind].has(value)).length])) } : null
    return { three: rig ? { objects, visibleObjects, visibleMeshes, geometries: geometries.size, materials: materials.size,
      textures: textures.size, geometryBytes, accounting, gpuMemory: null } : null,
    pending: record ? counts(record.pending) : null, instanceId: record?.id, destroyed: !!record?.destroyed,
    hostConnected: !!host?.isConnected, domNodes: host?.isConnected ? host.querySelectorAll('*').length : 0,
    canvases: host?.isConnected ? host.querySelectorAll('canvas').length : 0,
    images: host?.isConnected ? host.querySelectorAll('image').length : 0, fx: live?.experimental.B.fxs.length || 0,
    storyLayers: host?.isConnected ? host.querySelectorAll('[data-buddy-story-layer],[data-buddy-context-layer],[data-buddy-parachute-layer]').length : 0,
    clipPath: host?.style.clipPath || '', state: !record?.destroyed ? live?.state() : null,
    metrics: record?.destroyed ? live?.experimental.metrics() : live?.metrics() }
  }
  globalThis.qaSourceSnapshot = (slide = document.querySelector('.slide.on')) => JSON.stringify([slide?.innerHTML ?? null,
    [...(slide?.querySelectorAll('input') || [])].map(input => input.checked)])
  const stringify = JSON.stringify
  JSON.stringify = function (...args) {
    const result = stringify.apply(this, args), value = args[0], session = globalThis.qaSession
    // Только observation: оригинальная функция/аргументы/output не подменяются.
    // context() здесь не вызывается: он мог бы сам вызвать refresh и отмену.
    try {
      if (session?.id === 'quoteIdea' && Array.isArray(value) && value.length === 4
        && value[0]?.id === 'demo-note:text') {
        const stack = new Error('Test-only sourceVersion stringify').stack
        if (stack.includes('context-source.js') && stack.includes('contextSource')) {
          session.sourceVersions ||= []
          session.sourceVersions.push({ at: performance.now(), result, stack })
        }
      }
    } catch (error) { if (session?.id === 'quoteIdea') session.sourceVersionSpyError = String(error) }
    return result
  }
  globalThis.qaDiagnostics = () => {
    const record = currentRecord(), b = record?.buddy?.experimental.B
    return record ? { instanceId: record.id, current: { name: b?.act?.name, time: b?.act?.t, modelTime: b?.t },
      actAssignments: record.actTrace?.slice() || [], sourceVersions: globalThis.qaSession?.sourceVersions?.slice() || [],
      sourceVersionSpyError: globalThis.qaSession?.sourceVersionSpyError ?? null,
      sourceBeforePlay: record.sourceSignature,
      sourceNow: qaSourceSnapshot(record.sourceElement) } : null
  }
  globalThis.qaDestroy = async () => {
    const record = currentRecord(), before = qaResources(record), old = record.buddy,
      source = { beforePlay: record.sourceSignature, beforeDestroy: qaSourceSnapshot(record.sourceElement) }
    qaUI.setBuddy(null); withOwner(record, () => old.destroy()); record.destroyed = true
    const immediate = qaResources(record)
    source.afterImmediate = qaSourceSnapshot(record.sourceElement)
    await new Promise(resolve => native.requestAnimationFrame(() => native.requestAnimationFrame(resolve)))
    await new Promise(resolve => native.setTimeout(resolve, 150))
    source.afterDelayed = qaSourceSnapshot(record.sourceElement)
    source.restoredAtImmediate = source.afterImmediate === source.beforePlay
    source.restoredAtDelayed = source.afterDelayed === source.beforePlay
    return { before, immediate, delayed: qaResources(record), delayMs: 150, source,
      limitation: 'Observed object identities, not driver allocation counters. Detached object graphs are retained only by this probe; shared resources are separate. No new mount during destroy probe.' }
  }
  function directionStart(raw, id, face, stage) {
    const b = raw.B, preparation = { requestedFace: face, originalX: b.x, rule: ['read', 'note'].includes(id)
      ? 'factory-retains-input-face' : 'requested-initial-pose; public-number-may-turn', preparedX: b.x,
      assertFirstHalfSecond: ['popcorn', 'mail', 'read', 'note', 'tracker', 'stairs', 'grapple', 'present', 'spotlight'].includes(id) }
    if (id === 'parachute' && Number.isFinite(globalThis.qaParachuteStartX)) {
      const x = globalThis.qaParachuteStartX
      if (!raw.W.floor.spans.some(([a, b]) => x >= a + 18 && x <= b - 18)) throw new Error('Явный старт парашюта вне свободного пола')
      return { ...preparation, preparedX: x, rule: 'supplemental-free-floor-before-public-parachute-launch', assertFirstHalfSecond: true }
    }
    if (globalThis.qaDirectedWalls && ['climb', 'web'].includes(id)) return { ...preparation,
      rule: 'supplemental-rounded-card-at-floor-range-edge; public-factory-selects-only-accessible-side',
      assertFirstHalfSecond: true }
    if (id === 'popcorn') { preparation.preparedX = face > 0 ? 639 : 641; preparation.rule = 'popcorn-faces-stage-center' }
    if (id === 'mail') { preparation.preparedX = face > 0 ? 641 : 639; preparation.rule = 'mail-faces-stage-edge' }
    if (['stroll', 'stumble', 'jog'].includes(id)) {
      // Factory сама выбирает случайную цель минимум в40/90px от тела.
      // У внешней границы свободного пола такая цель лежит только с нужной
      // стороны; RNG и решение factory после play не подменяются.
      const margin = 14, spans = raw.W.floor.spans.filter(([a, z]) => z - a >= margin * 2)
        .sort((a, z) => face > 0 ? a[0] - z[0] : z[1] - a[1]), span = spans[0]
      if (!span) throw new Error('Нет безопасного старта ходьбы: ' + id)
      return { ...preparation, rule: 'free-floor-boundary-before-public-random-target',
        preparedX: face > 0 ? span[0] + margin : span[1] - margin,
        floorSpans: raw.W.floor.spans.map(span => [...span]), bodyMargin: margin, assertFirstHalfSecond: true }
    }
    if (id === 'pullups') {
      const spans = raw.W.floor.spans, level = raw.LEVELS[raw.W.li],
        inFloor = x => spans.some(([a, z]) => x >= a && x <= z),
        left = Math.min(...spans.map(span => span[0])), right = Math.max(...spans.map(span => span[1])),
        walls = raw.W.walls.filter(w => w.gap >= 45 && w.gap <= level.reach && w.footX >= left && w.footX <= right),
        starts = walls.filter(w => w.side === -face).map(w => ({ w, x: w.footX - face * 6 }))
          .filter(({ w, x }) => inFloor(x) && inFloor(w.footX)
            && walls.filter(q => Math.abs(q.footX - x) < 420)
              .sort((a, z) => Math.abs(a.footX - x) - Math.abs(z.footX - x))[0]?.side === -face)
          .sort((a, z) => Math.abs(a.x - b.x) - Math.abs(z.x - b.x)), chosen = starts[0]
      if (!chosen) throw new Error('Нет свободного пола перед кромкой pullups, face=' + face)
      return { ...preparation, rule: 'free-floor-before-nearest-public-pullup-wall', preparedX: chosen.x,
        floorSpans: spans.map(span => [...span]), targetX: chosen.w.x,
        targetBounds: [chosen.w.plat.x1, chosen.w.top, chosen.w.plat.x2, chosen.w.bottom],
        assertFirstHalfSecond: true }
    }
    if (!['tracker', 'stairs', 'grapple', 'present', 'spotlight'].includes(id)) return preparation
    const slide = stage.querySelector(':scope > .slide.on'), rect = stage.getBoundingClientRect(), ratio = rect.width / 1280 || 1,
      bounds = element => { const r = element.getBoundingClientRect(); return [(r.left - rect.left) / ratio, (r.top - rect.top) / ratio,
        (r.right - rect.left) / ratio, (r.bottom - rect.top) / ratio] },
      preferred = face > 0 ? 82 : 1200, spans = raw.W.floor.spans, points = [], margin = 14
    for (const [a, z] of spans) if (z - a >= margin * 2) {
      points.push(Math.max(a + margin, Math.min(z - margin, preferred)), a + margin, z - margin)
      for (let x = a + margin; x <= z - margin; x += 8) points.push(x)
    }
    let targetFor
    if (id === 'tracker') targetFor = x => {
      const q = raw.W.plats.filter(q => q.x2 - q.x1 > 60 && q.x1 - 300 < x && q.x2 + 300 > x && q.y < 630 && q.y > 240
        && q.spans.some(([a, z]) => z - a >= 26)).sort((a, z) => z.y - a.y)[0]
      if (!q || (face > 0 ? x >= q.spans[0][0] - 6 : x <= q.spans.at(-1)[1] + 6)) return null
      return { kind: 'tracker-platform', bounds: [q.x1, q.y, q.x2, q.box?.y2 ?? q.y], targetX: (q.x1 + q.x2) / 2 }
    }
    else if (id === 'grapple') targetFor = x => {
      // Подход снаружи к доступной кромке, не подмена выбора factory после play().
      const choices = raw.W.plats.filter(q => {
        const edge = x < q.x1 - 20 ? q.x1 : x > q.x2 + 20 ? q.x2 : null,
          distance = edge === null ? 0 : Math.abs(edge - x), height = b.surfY - q.y
        if (edge === null || distance < 30 || distance > 230 || height < 80 || height > 330) return false
        const inward = edge === q.x1 ? 1 : -1, ropeX = edge - inward * 8,
          landing = q.spans.filter(([a, z]) => z - a >= 26).map(([a, z]) => Math.max(a, Math.min(z, edge + inward * 10)))
            .sort((a, z) => Math.abs(a - edge) - Math.abs(z - edge))[0]
        if (!Number.isFinite(landing) || Math.abs(landing - edge) > 24) return false
        // Вложенная SVG-иконка не подходит, если родительская плитка перекрывает канат/место хвата.
        return !raw.W.plats.some(p => p !== q && p.box &&
          (p.x1 - 2 < ropeX && ropeX < p.x2 + 2 && p.box.y2 > q.y + 6 && p.y < b.surfY - 4
          || p.x1 < landing + 10 && p.x2 > landing - 10 && p.box.y2 > q.y - 46 && p.y < q.y - 2))
      })
      if (!choices.length || choices.some(q => Math.sign((q.x1 + q.x2) / 2 - x) !== face)) return null
      const q = choices[0]
      return { kind: 'grapple-exterior-platform', bounds: [q.x1, q.y, q.x2, q.box?.y2 ?? q.y],
        targetX: x < q.x1 ? q.x1 : q.x2 }
    }
    else {
      const element = id === 'stairs' ? slide?.querySelector('[data-buddy-stairs]')?.children[0]
        : ['[data-buddy-focus]', '[data-buddy-target]', 'h1', 'h2', 'img', 'video'].map(selector => slide?.querySelector(selector))
          .find(node => node?.getBoundingClientRect().width > 0)
      if (!element) throw new Error('Нет настоящей сценной цели для direction prep ' + id)
      const box = bounds(element), platform = id === 'stairs' ? raw.W.plats.find(q => Math.abs(q.y - box[1]) < 6 && q.x1 < (box[0] + box[2]) / 2 && q.x2 > (box[0] + box[2]) / 2) : null,
        targetX = id === 'stairs' ? platform?.spans[0]?.[0] + 8 : (box[0] + box[2]) / 2
      if (!Number.isFinite(targetX)) throw new Error('Не найдена настоящая первая ступень')
      targetFor = x => (targetX - x) * face > 24 ? { kind: id === 'stairs' ? 'stairs-first-grapple' : 'content-focus', bounds: box, targetX } : null
    }
    const candidates = [...new Set(points)].map(x => ({ x, target: targetFor(x) })).filter(candidate => candidate.target)
      .sort((a, z) => Math.abs(a.x - preferred) - Math.abs(z.x - preferred)), chosen = candidates[0]
    if (!chosen) throw new Error(`Нет безопасного floor span для ${id}, requestedFace=${face}`)
    return { ...preparation, rule: 'free-floor-before-target-facing-public-factory', preparedX: chosen.x,
      floorSpans: spans.map(span => [...span]), bodyMargin: margin, ...chosen.target }
  }
  function captureCompletion(session, actionComplete, fxs, props) {
    let ownedFX = 0
    for (const fx of fxs) if (!session.preexistingFX.has(fx)) ownedFX++
    const physicalProps = !!props
    if (!session.policy.windowSeconds && session.completedAt === null && actionComplete) session.completedAt = session.elapsed
    if (!actionComplete || ownedFX || physicalProps) session.effectsEndedAt = null
    else if (session.completedAt !== null && session.effectsEndedAt === null) session.effectsEndedAt = session.elapsed
    return { completedAt: session.completedAt, actionEndedAt: session.completedAt, effectsEndedAt: session.effectsEndedAt,
      ownedFX, physicalProps, captureComplete: session.policy.windowSeconds ? session.elapsed >= session.policy.windowSeconds
        : session.effectsEndedAt !== null && session.elapsed >= session.effectsEndedAt + (session.tailSeconds ?? .5) }
  }
  globalThis.qaSnapshot = () => {
    const raw = buddy.experimental, b = raw.B, k = b.kk, scale = raw.tools.S * b.scale,
      world = point => [b.x + (point[0] * Math.cos(b.yaw) - point[2] * Math.sin(b.yaw)) * scale,
        b.y + point[1] * scale, (point[0] * Math.sin(b.yaw) + point[2] * Math.cos(b.yaw)) * scale],
      session = globalThis.qaSession
    if (session.directionPreparation?.assertFirstHalfSecond && session.elapsed > 0 && session.elapsed <= .5 && b.face !== session.face)
      throw new Error(`Публичный ${session.id} изменил requestedFace=${session.face} на ${b.face} до .5s, startX=${session.directionPreparation.preparedX}`)
    if (!session.tokens.has(b.act)) session.tokens.set(b.act, session.tokens.size + 1)
    const actionToken = session.tokens.get(b.act)
    const framing = buddy.framing(), completion = captureCompletion(session,
      b.act !== session.initialAction && b.act.name === 'idle' && b.queue.length === 0, b.fxs, framing.props),
      feet = k.legs.flatMap(leg => [world(leg.heel), world(leg.toe)])
    return { elapsed: session.elapsed, time: b.t, action: b.act.name, actionTime: b.act.t, actionToken,
      queue: b.queue.length, mode: b.mode, surface: { kind: b.surf.kind, y: b.surfY, x1: b.surf.x1, x2: b.surf.x2 },
      x: b.x, y: b.y, yaw: b.yaw, face: b.face, scale: b.scale, alpha: b.alpha, tint: b.tint, squash: b.sq,
      pose: b.pose, hands: k.arms.map(arm => world(arm.hand)), renderedHands: raw.tools.hands().map(point => [...point]),
      feet, seat: world(k.seat), head: world(k.head), contact: { mask: b.cset, footId: b.footId, footWX: b.footWX,
        anchor: b.anchor ? { id: b.anchor.id, wx: b.anchor.wx } : null, footDistances: feet.map(point => point[1] - b.surfY) },
      framing, metrics: buddy.metrics(), ...completion }
  }
  globalThis.qaStart = async (id, face, policy) => {
    globalThis.qaCameraFrozen = false
    const entry = module.techniques.find(item => item.id === id), stage = document.getElementById('stage'),
      selectedId = buddy?.context().selectedId, old = buddy, mountAt = performance.now(), priorOwner = owner,
      record = { id: ++nextInstanceId, resources: resourceSets(), owned: resourceSets(), shared: resourceSets(),
        disposed: resourceSets(), disposeOnly: resourceSets(), disposeCalls: { geometries: new Map(), materials: new Map(), textures: new Map() },
        pending: { raf: new Set(), timers: new Set(), intervals: new Set(), listeners: new Set(), observers: new Set() } }
    qaUI.setBuddy(null)
    if (old) withOwner(currentRecord(), () => old.destroy())
    globalThis.qaInstance = record; owner = record
    try {
    const fresh = await module.createBuddy({ stage, autoplay: false, reactions: false, motion: 'full', renderer: 'auto', seed: 14,
      presets: { superhuman: true, y360: entry.preset === 'brand' },
      logos: entry.preset === 'brand' ? (await import('./presets/y360.js')).logos : {} })
    record.buddy = fresh; record.host = stage.querySelector(':scope > .buddy')
    qaResources(record); record.initialResources = Object.fromEntries(Object.entries(record.owned).map(([kind, values]) => [kind, values.size]))
    fresh.pause(); fresh.reset(); fresh.progress(1); fresh.rescan(); fresh.experimental.autonomous(false)
    let directedWallPreparation = null
    if (globalThis.qaDirectedWalls && ['climb', 'web'].includes(id)) {
      const slide = stage.querySelector(':scope > .slide.on'), cards = [...slide.querySelectorAll('.block')], card = cards[0]
      if (!card) throw new Error('Не найдена исходная скруглённая карточка')
      for (const other of cards.slice(1)) other.remove()
      Object.assign(card.style, { left: (face > 0 ? 930 : 50) + 'px', top: '420px', width: '300px', height: '200px' })
      fresh.rescan()
      const raw = fresh.experimental, level = raw.LEVELS[raw.W.li],
        walls = raw.W.walls.filter(w => w.footX >= level.floor[0] && w.footX <= level.floor[1]
          && (id === 'web' ? w.h > 80 && w.h <= 600 : w.h <= level.climb && w.gap <= level.reach))
      if (walls.length !== 1 || walls[0].side !== -face) throw new Error('Физическая сцена не даёт единственную кромку нужной стороны')
      directedWallPreparation = { fixture: 'supplemental; original-complex-scene-retained-in-separate-capture',
        card: [face > 0 ? 930 : 50, 420, face > 0 ? 1230 : 350, 620], radius: getComputedStyle(card).borderTopLeftRadius,
        onlyWall: { side: walls[0].side, x: walls[0].x, top: walls[0].top, bottom: walls[0].bottom } }
    }
    let elevationPreparation = null
    if (entry.requires === 'elevated') {
      fresh.play('land'); fresh.pause()
      for (let i = 0; i < 1200; i++) {
        fresh.step(1 / 60)
        const state = fresh.state()
        if (state.act === 'idle' && state.queue === 0 && state.surf !== 'floor' && state.grounded) break
      }
      if (fresh.state().surf === 'floor' || !fresh.state().grounded) throw new Error('Не подготовлена настоящая высокая опора')
      elevationPreparation = fresh.state()
    }
    if (entry.contextKinds) {
      const facts = fresh.context().facts.filter(fact => entry.contextKinds.includes(fact.kind)),
        source = facts.find(fact => fact.id === selectedId) || facts[0]
      if (!source) throw new Error('Нет источника контекстного номера')
      fresh.selectContext(source.id)
    }
    const raw = fresh.experimental, b = raw.B
    raw.seed(14); fresh.lookAt(null)
    // Public factories choose a side from their starting position; prepare that
    // position rather than replacing the factory's decision after play().
    const directionPreparation = { ...directionStart(raw, id, face, stage), ...(directedWallPreparation ? { directedWallPreparation } : {}) }
    b.x = directionPreparation.preparedX
    Object.assign(b, { face, cam: .4, yaw: face > 0 ? .4 * Math.PI / 2 : Math.PI - .4 * Math.PI / 2, yawV: 0, anchor: null })
    qaUI.setBuddy(fresh)
    globalThis.qaSession = { id, face, policy, directionPreparation, tailSeconds: globalThis.qaMinimumTailSeconds ?? .5,
      elapsed: 0, completedAt: null, effectsEndedAt: null,
      preexistingFX: new Set(), tokens: new Map(), initialAction: null }
    record.sourceElement = document.querySelector('.slide.on'); record.sourceSignature = qaSourceSnapshot(record.sourceElement)
    // Подготовка экспериментального B не обновляет отображённые кисти/рамку.
    // Отрисовываем настоящую исходную стойку до отсчёта номера, иначе t0
    // содержит кэш прежнего ракурса, а первый update выглядит ложным скачком.
    withOwner(record, () => fresh.step(1 / 120, 120))
    qaSession.preexistingFX = new Set(b.fxs)
    const context = fresh.context(), selected = context.facts.find(fact => fact.id === context.selectedId),
      before = qaResources(), mountMs = performance.now() - mountAt, start = performance.now(), accepted = fresh.play(id), launchCostMs = performance.now() - start
    fresh.pause(); qaSession.initialAction = b.act
    if (!accepted) throw new Error('Публичный play() отказал в запуске ' + id + ': ' + JSON.stringify({
      directionPreparation, actualX: b.x, surfaceY: b.surfY, mode: b.mode, availability: raw.availability(id),
      platforms: raw.W.plats.map(q => ({ x1: q.x1, x2: q.x2, y: q.y, spans: q.spans, box: q.box })) }))
    if (id === 'quoteIdea') {
      let currentAction = b.act
      record.actTrace = []
      Object.defineProperty(b, 'act', { configurable: true, enumerable: true,
        get() { return currentAction },
        set(next) {
          const prior = currentAction
          currentAction = next
          // Только примитивы/stack: context() здесь мог бы сам вызвать refresh и отмену.
          record.actTrace.push({ at: performance.now(), modelTime: b.t,
            from: { name: prior?.name, time: prior?.t }, to: { name: next?.name, time: next?.t },
            stack: new Error('Test-only B.act assignment').stack })
        }
      })
    }
    directionPreparation.publicLaunchFace = b.face
    return { id, face, seed: 14, instanceId: record.id, mountMs, launchCostMs,
      clock: { mountStartedAt: mountAt, launchStartedAt: start, launchEndedAt: start + launchCostMs },
      before, launched: qaResources(), elevationPreparation, directionPreparation,
      renderer: fresh.renderer, presets: fresh.presets, context: selected || null, initial: qaSnapshot(),
      sourceSignature: record.sourceSignature }
    } finally { owner = priorOwner }
  }
  globalThis.qaStep = count => {
    const rows = []
    for (let i = 0; i < count; i++) { qaOwned(() => buddy.step(1 / 120, 120)); qaSession.elapsed += 1 / 120; rows.push(qaSnapshot()) }
    return rows
  }
  globalThis.qaPhase = () => {
    const viewport = document.getElementById('viewport').getBoundingClientRect(), runs = []
    for (const node of document.querySelectorAll('.buddy text')) {
      const box = node.getBoundingClientRect(), css = getComputedStyle(node)
      let opacity = 1, hidden = false
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent); opacity *= Number(style.opacity)
        if (style.display === 'none' || style.visibility === 'hidden') hidden = true
      }
      const visibleWidth = Math.max(0, Math.min(box.right, viewport.right) - Math.max(box.left, viewport.left)),
        visibleHeight = Math.max(0, Math.min(box.bottom, viewport.bottom) - Math.max(box.top, viewport.top))
      if (!hidden && opacity >= .05 && box.width && box.height) runs.push({ text: node.textContent, opacity,
        visibleFraction: visibleWidth * visibleHeight / (box.width * box.height), fontSize: css.fontSize,
        box: [box.left, box.top, box.right, box.bottom] })
    }
    return { sample: qaSnapshot(), resources: qaResources(), textRuns: runs,
      stageTransform: document.getElementById('stage').style.transform,
      phase: document.querySelector('[data-story-phase]')?.getAttribute('data-story-phase') || null }
  }
  globalThis.qaCloseupFrame = () => {
    const stage = document.getElementById('stage'), viewport = document.getElementById('viewport').getBoundingClientRect(),
      framing = buddy.framing(), boxes = [framing.actor, framing.props, framing.detail].filter(Boolean),
      bounds = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))],
      padding = 16, scale = Math.min(12, (viewport.width - padding * 2) / Math.max(1, bounds[2] - bounds[0]), (viewport.height - padding * 2) / Math.max(1, bounds[3] - bounds[1])),
      x = viewport.width / 2 - (bounds[0] + bounds[2]) / 2 * scale,
      y = viewport.height / 2 - (bounds[1] + bounds[3]) / 2 * scale
    globalThis.qaCameraFrozen = true
    stage.style.transform = `translate(${x}px,${y}px) scale(${scale})`
    return { kind: 'test-only-fit-actor-props-detail', bounds, scale, padding, time: qaSession.elapsed,
      actorHeightPx: (framing.actor[3] - framing.actor[1]) * scale }
  }
  globalThis.qaActorFrame = () => {
    const stage = document.getElementById('stage'), viewport = document.getElementById('viewport').getBoundingClientRect(),
      bounds = buddy.framing().actor,
      scale = Math.min(3.75, (viewport.width - 32) / Math.max(1, bounds[2] - bounds[0]),
        (viewport.height - 32) / Math.max(1, bounds[3] - bounds[1])),
      x = viewport.width / 2 - (bounds[0] + bounds[2]) / 2 * scale,
      y = viewport.height / 2 - (bounds[1] + bounds[3]) / 2 * scale
    globalThis.qaCameraFrozen = true
    stage.style.transform = `translate(${x}px,${y}px) scale(${scale})`
    return { kind: 'test-only-actor-detail', bounds, scale, time: qaSession.elapsed,
      actorHeightPx: (bounds[3] - bounds[1]) * scale,
      limitation: 'Деталь тела дополняет общий кадр; удалённая проекция может быть вне viewport. Плотность фиксируется по факту, лимит renderer не меняется.' }
  }
  globalThis.qaSlideChange = async () => {
    const before = qaResources(), slides = [...document.querySelectorAll('#stage > .slide')], current = slides.findIndex(slide => slide.classList.contains('on')),
      next = (current + 1) % slides.length
    slides.forEach((slide, i) => slide.classList.toggle('on', i === next))
    await Promise.resolve()
    qaOwned(() => buddy.rescan())
    qaOwned(() => buddy.step(1 / 60, 60))
    await new Promise(resolve => native.requestAnimationFrame(() => native.requestAnimationFrame(resolve)))
    return { from: current, to: next, before, after: qaResources() }
  }
  return module.techniques
}

const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname),
      file = path === '/' ? join(sourceRoot, 'served-index.html') : resolve(sourceRoot, '.' + path)
    if (!file.startsWith(sourceRoot + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.html' ? 'text/html' : 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await openBrowser({ width: 1600, height: 1100, dpr: captureDpr })
  report.environment = { ...await browser.send('Browser.getVersion'), platform: process.platform, arch: process.arch }
  const ev = browser.evaluate, settle = () => ev('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),
    wait = async (expression, message) => {
      for (let i = 0; i < 400; i++) { if (await ev(expression)) return; await browser.sleep(25) }
      throw new Error(message)
    },
    choose = (id, value) => ev(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`),
    capture = async (format = 'jpeg', metadata = null) => {
      const view = await ev(`(()=>{const r=document.getElementById('viewport').getBoundingClientRect();return{clip:{x:r.left+scrollX,y:r.top+scrollY,width:Math.floor(r.width/2)*2,height:Math.floor(r.height/2)*2,scale:1},stageTransform:document.getElementById('stage').style.transform,dpr:devicePixelRatio}})()`)
      if (metadata) metadata.viewBeforeCapture = { stageTransform: view.stageTransform, dpr: view.dpr,
        viewport: [view.clip.width, view.clip.height],
        limitation: 'Transform записан непосредственно перед screenshot. Между CDP вызовами камера может сделать следующий rAF; для crop нужен запас или union соседних кадров.' }
      return Buffer.from((await browser.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 84 } : {}),
        captureBeyondViewport: true, clip: view.clip })).data, 'base64')
    },
    artifact = async file => ({ file: file.slice(output.length + 1), bytes: (await stat(file)).size, sha: hash(await readFile(file)) }),
    prepare = async entry => {
      await browser.navigate(`http://127.0.0.1:${server.address().port}/`)
      await wait('!!globalThis.buddy && !!globalThis.qaUI && !qaUI.state().switching', 'Стенд не подключился')
      await choose('mode', 'manual')
      await ev(`buddy.pause();const smart=document.getElementById('smart');smart.checked=false;smart.dispatchEvent(new Event('change'))`)
      assert.deepEqual(await ev(`globalThis.qaAllocationTraceEnabled=${allocationTrace};globalThis.qaDirectedWalls=${directedWalls};globalThis.qaParachuteStartX=${parachuteStartX};globalThis.qaMinimumTailSeconds=${tailSeconds};await (${installHarness.toString()})()`), registry, 'Реестр браузера совпадает со snapshot')
      await choose('scene', sceneFor(entry)); await ev('buddy.pause();buddy.rescan()')
      if (entry.contextKinds) {
        const fact = await ev(`buddy.context().facts.find(f=>${JSON.stringify(entry.contextKinds)}.includes(f.kind))`)
        assert.ok(fact, 'UI подготовил совместимый источник')
        await wait(`[...document.getElementById('contextSource').options].some(o=>o.value===${JSON.stringify(fact.id)})`, 'Источник не появился в UI')
        await choose('contextSource', fact.id)
      }
      await browser.click(`[data-id="${entry.id}"]`)
      await wait(`!!globalThis.buddy && !qaUI.state().switching && qaUI.state().selected===${JSON.stringify(entry.id)} && buddy.presets.y360===${entry.preset === 'brand'}`, 'UI не подготовил приём/пресет')
      await ev('buddy.pause();document.getElementById("viewport").scrollIntoView({block:"center"})')
      return ev(`({scene:document.getElementById('scene').value,selected:qaUI.state().selected,presets:buddy.presets,context:buddy.context(),status:document.getElementById('status').textContent})`)
    }

  for (const entry of registry.filter(item => ids.includes(item.id))) for (const face of [-1, 1]) {
    const key = entry.id + ':' + face, prior = successful().get(key)
    if (prior) {
      const valid = await Promise.all(prior.artifacts.map(async item => readFile(join(output, item.file)).then(data => hash(data) === item.sha, () => false)))
      if (valid.every(Boolean)) { console.log('RESUME ' + key); continue }
    }
    const caseRoot = join(output, entry.id + (face < 0 ? '-left' : '-right'))
    await mkdir(caseRoot, { recursive: true })
    let attempt = 1, folder
    for (;;) {
      folder = join(caseRoot, 'attempt-' + attempt)
      try { await mkdir(folder); break } catch (error) { if (error.code !== 'EEXIST') throw error; attempt++ }
    }
    const row = { key, id: entry.id, face, attempt, metadata: entry, policy: policyFor(entry), status: performanceOnly ? 'measuring-performance' : 'capturing',
      ...(performanceOnly ? { evidenceKind: 'native-performance-only', captureMode: 'native-performance-only', visualEvidence: false } : {}),
      started: new Date().toISOString(), artifacts: [], phaseImages: [], closeups: [], actorDetails: [], performance: null }
    report.cycles.push(row); await saveReport()
    let film, gzip, stream, lifecycleTarget = 0
    const images = [], videoFrames = [], seen = new Set(), numericFile = join(folder, 'trajectory.jsonl.gz'), movieFile = join(folder, 'cycle.mp4')
    try {
      row.uiPreparation = await prepare(entry)
      await browser.click(viewButtons[captureView])
      row.start = await ev(`await qaStart(${JSON.stringify(entry.id)},${face},${JSON.stringify(row.policy)})`)
      assert.equal(row.start.renderer, 'webgl', 'Нативная модель действительно отрисовывается через WebGL')
      assert.equal(row.start.initial.face, face)
      if (quoteTraceOnly) {
        row.diagnosticOnly = true
        row.diagnosticSamples = [row.start.initial]
        await settle()
        // Один PNG повторяет начальную точку обычного capture; видео/FFmpeg и perf не запускаются.
        const initialFile = join(folder, 'diagnostic-initial.png')
        await writeFile(initialFile, await capture('png')); row.artifacts.push(await artifact(initialFile))
        const cap = Math.ceil(((entry.duration || 10) + 1) * fps)
        for (let frame = 0; frame < cap; frame++) {
          const samples = await ev('qaStep(5)')
          row.diagnosticSamples.push(...samples)
          const last = samples.at(-1)
          if (last.captureComplete) break
          await settle()
        }
        row.afterCycle = await ev('qaResources()')
        row.diagnostics = await ev('qaDiagnostics()')
        const last = row.diagnosticSamples.at(-1)
        row.diagnosticCompletion = { declaredDuration: entry.duration, observedSeconds: last.elapsed,
          actionEndedAt: last.completedAt, lastAction: last.action,
          prematurelyEnded: last.completedAt !== null && last.completedAt < entry.duration - .1 }
        row.status = 'diagnosed'; row.finished = new Date().toISOString()
        console.log('DIAGNOSED ' + key + ' ' + JSON.stringify(row.diagnosticCompletion))
        continue
      }
      if (!performanceOnly) {
      film = captureVideo ? encoder(movieFile) : null; gzip = createGzip({ level: 6 }); stream = createWriteStream(numericFile, { flags: 'wx' }); gzip.pipe(stream)
      const numericClosed = once(stream, 'finish'); numericClosed.catch(() => {})
      gzip.on('error', error => stream?.destroy(error))
      let completed = false, samples = 1, maxStep = 0, previous = row.start.initial
      const facingSamples = { [previous.face]: 1 }, facingTransitions = []
      gzip.write(JSON.stringify(previous) + '\n'); seen.add(previous.action)
      videoFrames.push({ elapsed: 0, action: previous.action, x: previous.x, y: previous.y, completedAt: null, framing: previous.framing })
      await settle()
      if (captureVideo) {
        const initialJpeg = await capture('jpeg', videoFrames.at(-1)); images.push(initialJpeg); await film.write(initialJpeg)
      }
      for (let frame = 0; frame < Math.ceil(row.policy.capSeconds * fps); frame++) {
        const rows = await ev('qaStep(5)')
        for (const sample of rows) {
          assert.ok([sample.x, sample.y, sample.yaw, sample.scale, ...sample.hands.flat(), ...sample.feet.flat()].every(Number.isFinite), 'Конечная кинематика')
          seen.add(sample.action); samples++
          facingSamples[sample.face] = (facingSamples[sample.face] || 0) + 1
          if (previous && sample.face !== previous.face) facingTransitions.push({ elapsed: sample.elapsed, from: previous.face, to: sample.face, action: sample.action })
          if (previous) maxStep = Math.max(maxStep, ...sample.hands.map((hand, i) => Math.hypot(...hand.map((value, axis) => value - previous.hands[i][axis]))))
          previous = sample
        }
        if (!gzip.write(rows.map(sample => JSON.stringify(sample)).join('\n') + '\n')) await once(gzip, 'drain')
        const sample = rows.at(-1)
        videoFrames.push({ elapsed: sample.elapsed, action: sample.action, x: sample.x, y: sample.y, completedAt: sample.completedAt,
          effectsEndedAt: sample.effectsEndedAt, ownedFX: sample.ownedFX, physicalProps: sample.physicalProps,
          framing: sample.framing, phase: null })
        await settle()
        if (captureVideo) {
          const jpeg = await capture('jpeg', videoFrames.at(-1))
          images.push(jpeg); await film.write(jpeg)
        }
        completed = sample.captureComplete
        if (completed) {
          row.completion = { kind: row.policy.windowSeconds ? 'window' : 'complete', seconds: sample.elapsed,
            actionEndedAt: sample.completedAt, effectsEndedAt: sample.effectsEndedAt, ownedFXAtEnd: sample.ownedFX,
            physicalPropsAtEnd: sample.physicalProps, reason: row.policy.windowReason }
          break
        }
      }
      gzip.end(); await numericClosed; gzip = null; stream = null
      if (captureVideo) {
        await film.close(); film = null
        row.video = await probe(movieFile)
        assert.equal(Number(row.video.nb_frames), videoFrames.length, 'FFmpeg сохранил каждый кадр')
        assert.equal(row.video.avg_frame_rate, '24/1')
        row.artifacts.push(await artifact(movieFile))
      } else { row.video = null; row.captureMode = 'full-numeric-native-phases-no-movie' }
      row.numeric = { hz: numericHz, samples, maxHandStep: maxStep, seenActions: [...seen], facingSamples, facingTransitions }
      row.artifacts.push(await artifact(numericFile))
      const framesFile = join(folder, captureVideo ? 'video-frames.json' : 'model-frames.json')
      await writeFile(framesFile, JSON.stringify(videoFrames) + '\n')
      row.artifacts.push(await artifact(framesFile))
      // JPEG уже входят в MP4: держим только один цикл в памяти и оставляем восемь фаз.
      if (captureVideo) for (const [phase, fraction] of [0, .14, .28, .42, .57, .71, .85, 1].entries()) {
        const index = Math.round((images.length - 1) * fraction), file = join(folder, 'phase-' + phase + '.jpg')
        await writeFile(file, images[index]); row.artifacts.push(await artifact(file)); row.phaseImages.push({ phase, frame: index, ...videoFrames[index], file: file.slice(output.length + 1) })
      }
      images.length = 0
      assert.ok(completed, `Hard timeout ${row.policy.capSeconds}с: цикл не завершён, сохранённая запись НЕ полный цикл`)
      row.afterCycle = await ev('qaResources()')
      if (entry.id === 'quoteIdea') row.diagnostics = await ev('qaDiagnostics()')
      const afterSignature = await ev('qaSourceSnapshot()')
      row.sourceUnchanged = afterSignature === row.start.sourceSignature
      assert.ok(row.sourceUnchanged, 'Исходная разметка и отметки восстановлены после полного номера')
      row.durationValidation = cycleDurationCheck(entry, row.policy, row.completion.actionEndedAt)
      assert.ok(row.durationValidation.passed,
        `Преждевременное завершение ${entry.id}: ${row.completion.actionEndedAt}s < ${row.durationValidation.minimumSeconds}s по реестру`)
      row.completionValidation = cycleCompletionCheck(row.policy, row.completion)
      assert.ok(row.completionValidation.passed, 'Полная визуальная запись включает owned FX0/props0 и ≥0.5s tail')
      row.activeProbeSeconds = (row.policy.windowSeconds || row.completion.actionEndedAt) * .52
      lifecycleTarget = Math.round(row.activeProbeSeconds * numericHz)

      // Повторяем тот же старт для крупных фаз; адресные секунды закрывают старые плохие позы.
      await ev(`await qaStart(${JSON.stringify(entry.id)},${face},${JSON.stringify(row.policy)})`)
      await browser.click('#zoom')
      let replayTick = 0
      const phaseFrames = keyframes[entry.id] ? keyframes[entry.id].map(time => {
        assert.ok(time <= row.completion.seconds, 'Адресная фаза находится внутри наблюдённого цикла')
        return videoFrames.reduce((nearest, sample, index) => Math.abs(sample.elapsed - time) < Math.abs(videoFrames[nearest].elapsed - time) ? index : nearest, 0)
      }) : [.28, .52, .76].map(fraction => Math.round((videoFrames.length - 1) * fraction))
      for (const [phase, frame] of phaseFrames.entries()) {
        const targetTick = Math.round(videoFrames[frame].elapsed * numericHz)
        while (replayTick < targetTick) {
          const count = Math.min(30, targetTick - replayTick)
          await ev(`qaStep(${count})`); replayTick += count; await settle()
        }
        const testFraming = await ev('qaCloseupFrame()')
        await settle(); await browser.sleep(180)
        const file = join(folder, 'closeup-' + phase + '.png'), observation = await ev('qaPhase()')
        await writeFile(file, await capture('png')); row.artifacts.push(await artifact(file))
        row.closeups.push({ phase, frame, file: file.slice(output.length + 1), observation, testFraming,
          replayPositionDelta: Math.hypot(observation.sample.x - videoFrames[frame].x, observation.sample.y - videoFrames[frame].y) })
        if (actorDetails) {
          const detailFraming = await ev('qaActorFrame()')
          await settle(); await browser.sleep(180)
          const detailFile = join(folder, 'actor-detail-' + phase + '.png'), detail = await ev('qaPhase()')
          await writeFile(detailFile, await capture('png')); row.artifacts.push(await artifact(detailFile))
          assert.equal(detail.sample.time, observation.sample.time, 'Съёмка детали не двигает модельные часы')
          assert.equal(detail.sample.actionToken, observation.sample.actionToken, 'Кадрирование не отменяет номер')
          assert.deepEqual(detail.sample.pose, observation.sample.pose, 'Render-only деталь сохраняет позу')
          row.actorDetails.push({ phase, frame, file: detailFile.slice(output.length + 1), observation: detail, testFraming: detailFraming })
        }
      }
      // FX-tail записан отдельно; lifecycle probes начинаются со свежего исходного ID в active midpoint.
      {
        row.interruptProbeStart = await ev(`await qaStart(${JSON.stringify(entry.id)},${face},${JSON.stringify(row.policy)})`)
        for (let tick = 0, target = entry.id === 'magnet' ? 360 : lifecycleTarget; tick < target;) {
          const count = Math.min(120, target - tick); await ev(`qaStep(${count})`); tick += count
        }
      }
      row.beforeInterrupt = await ev('qaResources()')
      row.beforeInterruptSource = await ev('({signature:qaSourceSnapshot(qaInstance.sourceElement),changed:qaSourceSnapshot(qaInstance.sourceElement)!==qaInstance.sourceSignature})')
      if (entry.id === 'magnet') assert.ok(row.beforeInterruptSource.changed, 'E2 interrupt начинается с реально скрытого источника')
      row.interruptionMethod = entry.id === 'magnet' ? 'public-play-wave' : 'experimental-run-wave'
      await ev(`qaOwned(()=>{${entry.id === 'magnet' ? "buddy.play('wave')" : "buddy.experimental.run(['wave'])"};buddy.pause()})`)
      row.afterInterrupt = await ev('qaResources()')
      row.afterInterruptSource = await ev('({signature:qaSourceSnapshot(qaInstance.sourceElement),unchanged:qaSourceSnapshot(qaInstance.sourceElement)===qaInstance.sourceSignature})')
      assert.ok(row.afterInterruptSource.unchanged, 'Другой номер восстановил исходную разметку')
      // Reset проверяет исходный ID, а не wave после interruption.
      {
        row.resetProbeStart = await ev(`await qaStart(${JSON.stringify(entry.id)},${face},${JSON.stringify(row.policy)})`)
        for (let tick = 0, target = entry.id === 'magnet' ? 360 : lifecycleTarget; tick < target;) {
          const count = Math.min(120, target - tick); await ev(`qaStep(${count})`); tick += count
        }
      }
      row.beforeReset = await ev('qaResources()')
      row.beforeResetSource = await ev('({signature:qaSourceSnapshot(qaInstance.sourceElement),changed:qaSourceSnapshot(qaInstance.sourceElement)!==qaInstance.sourceSignature})')
      if (entry.id === 'magnet') assert.ok(row.beforeResetSource.changed, 'E2 reset начинается с отдельного реально скрытого источника')
      await ev('qaOwned(()=>{buddy.reset();buddy.pause()})'); await settle()
      row.afterReset = await ev('qaResources()')
      row.afterResetSource = await ev('({signature:qaSourceSnapshot(qaInstance.sourceElement),unchanged:qaSourceSnapshot(qaInstance.sourceElement)===qaInstance.sourceSignature})')
      assert.ok(row.afterResetSource.unchanged, 'Reset восстановил исходную разметку')
      assert.equal(row.afterReset.fx, 0, 'Reset убирает FX')
      assert.equal(row.afterReset.storyLayers, 0, 'Reset убирает отдельные слои')
      }

      if ((face === 1 || performanceOnly) && capturePerformance) {
        await ev('globalThis.qaCameraFrozen=false')
        await browser.click(perfView === 'closeup' ? '#zoom' : perfView === 'auto' ? '#autoFrame' : '#overview')
        const series = [], launches = [], rafIntervals = [], segments = []
        for (let repetition = 0; (series.length < 120 || rafIntervals.length < 120) && repetition < 8; repetition++) {
          const start = await ev(`await qaStart(${JSON.stringify(entry.id)},${face},${JSON.stringify(row.policy)})`)
          launches.push({ instanceId: start.instanceId, clock: start.clock,
            mountMs: start.mountMs, launchCostMs: start.launchCostMs, before: start.before, launched: start.launched })
          const result = await ev(`await (async()=>{
            const samples=[],intervals=[],nativeEnteredAt=performance.now();let prior=null,complete=false;
            for(let i=0;i<Math.ceil(qaSession.policy.capSeconds*60);i++){
              const now=await new Promise(requestAnimationFrame),intervalMs=prior===null?null:now-prior;prior=now;
              if(intervalMs!==null)intervals.push(intervalMs);
              const priorAction=buddy.experimental.B.act.name;
              const cpuMs=qaOwned(()=>{const at=performance.now();buddy.step(1/60,60);return performance.now()-at});
              qaSession.elapsed+=1/60;const state=qaSnapshot();
              qaResources();
              samples.push({cpuMs,intervalMs,rafTimestamp:now,action:state.action,priorAction,actionToken:state.actionToken,
                actionTime:state.actionTime,time:state.elapsed,mode:state.mode,surface:state.surface.kind,
                cameraTransform:document.getElementById('stage').style.transform,framing:state.framing,
                storyPhase:document.querySelector('[data-story-phase]')?.getAttribute('data-story-phase')||null,
                completedAt:state.completedAt,effectsEndedAt:state.effectsEndedAt,ownedFX:state.ownedFX,physicalProps:state.physicalProps,metrics:state.metrics});
              complete=state.captureComplete;
              if(complete)break;
            }
            return{samples,intervals,complete,nativeEnteredAt,nativeEndedAt:performance.now(),
              allocations:globalThis.qaAllocationSpans?.filter(span=>span.instanceId===qaInstance.id)||null,
              after:qaResources(),elapsed:qaSession.elapsed,completedAt:qaSession.completedAt,
              effectsEndedAt:qaSession.effectsEndedAt,ownedFXAtEnd:samples.at(-1).ownedFX,physicalPropsAtEnd:samples.at(-1).physicalProps}
          })()`)
          assert.ok(result.complete, 'CPU/rAF измерение покрывает полный цикл с tail ≥0.5 s либо объявленное окно')
          result.durationValidation = cycleDurationCheck(entry, row.policy, result.completedAt)
          assert.ok(result.durationValidation.passed,
            `Преждевременный CPU/rAF цикл ${entry.id}: ${result.completedAt}s < ${result.durationValidation.minimumSeconds}s по реестру`)
          result.completionValidation = cycleCompletionCheck(row.policy, { ...result, kind: row.policy.windowSeconds ? 'window' : 'complete',
            seconds: result.elapsed, actionEndedAt: result.completedAt })
          assert.ok(result.completionValidation.passed, 'Native цикл ждёт owned FX0/props0 и ≥0.5s tail')
          let previousResizes = start.launched.metrics.canvasResizes
          for (const sample of result.samples) {
            sample.canvasResizeDelta = Math.max(0, sample.metrics.canvasResizes - previousResizes)
            previousResizes = sample.metrics.canvasResizes
            sample.repetition = repetition
            sample.stage = sample.effectsEndedAt !== null && sample.time >= sample.effectsEndedAt ? 'end-tail'
              : sample.completedAt !== null ? 'effects-tail' : sample.time <= .25 ? 'startup' : 'active'
            sample.normalizedBin = Math.min(9, Math.floor(sample.time / result.elapsed * 10))
            sample.phase = [sample.stage, sample.action, sample.actionToken, sample.mode, sample.surface, sample.storyPhase || 'none'].join(':')
          }
          series.push(...result.samples); rafIntervals.push(...result.intervals)
          segments.push({ repetition, kind: row.policy.windowSeconds ? 'window' : 'complete', steps: result.samples.length, complete: result.complete, seconds: result.elapsed,
            nativeEnteredAt: result.nativeEnteredAt, nativeEndedAt: result.nativeEndedAt, allocations: result.allocations,
            actionEndedAt: result.completedAt, effectsEndedAt: result.effectsEndedAt, ownedFXAtEnd: result.ownedFXAtEnd,
            physicalPropsAtEnd: result.physicalPropsAtEnd, durationValidation: result.durationValidation,
            completionValidation: result.completionValidation, after: result.after,
            launchCanvasResizes: start.launched.metrics.canvasResizes - start.before.metrics.canvasResizes,
            activeCanvasResizes: result.after.metrics.canvasResizes - start.launched.metrics.canvasResizes })
        }
        assert.ok(series.length >= 120 && rafIntervals.length >= 120, 'Измерены ≥120 CPU-шагов и rAF-интервалов; каждый повтор снят полностью')
        const summary = values => {
          if (!values.length) return { count: 0, mean: null, p50: null, p95: null, max: null }
          const sorted = values.slice().sort((a, b) => a - b), at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
          return { count: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, p50: at(.5), p95: at(.95), max: sorted.at(-1) }
        }, grouped = field => [...new Set(series.map(sample => sample[field]))].map(key => {
          const samples = series.filter(sample => sample[field] === key)
          return { key, cpuMs: summary(samples.map(sample => sample.cpuMs)),
            rafMs: summary(samples.filter(sample => sample.intervalMs !== null).map(sample => sample.intervalMs)),
            resizes: samples.reduce((sum, sample) => sum + sample.canvasResizeDelta, 0) }
        })
        row.performance = { view: perfView, dpr: captureDpr, samples: series, launches, segments, rafIntervals, activeSteps: series.length,
          activeCanvasResizes: segments.reduce((sum, segment) => sum + segment.activeCanvasResizes, 0),
          launchCanvasResizes: segments.reduce((sum, segment) => sum + segment.launchCanvasResizes, 0),
          cpuMs: summary(series.map(sample => sample.cpuMs)), rafMs: summary(rafIntervals),
          byPhase: grouped('phase'), byStage: grouped('stage'), byNormalizedBin: grouped('normalizedBin'), gpuTimeMs: null,
          after: await ev('qaResources()'), limitations: 'CPU отправки кадра и интервалы rAF, не GPU-time. Каждый цикл до action end и owned FX0/props0 +0.5s либо полного окна; короткие циклы повторены целиком. Remount исключён из интервалов; test-only resource traversal вне CPU clock может влиять на rAF.' }
        await ev('qaOwned(()=>{buddy.reset();buddy.pause()})')
      }
      if (performanceOnly) {
        assert.ok(hasFullPerformance(row), 'Performance-only завершает только измеренный полный native цикл/окно с ≥120 samples')
        row.status = 'performance-measured'; row.finished = new Date().toISOString()
        console.log('PERFORMANCE_MEASURED ' + key + ' ' + row.performance.segments.length + ' complete segments, ' + row.performance.samples.length + ' CPU samples')
        continue
      }
      // Прерываем отдельный свежий номер сменой слайда, затем destroy без нового mount.
      await ev(`await qaStart(${JSON.stringify(entry.id)},${face},${JSON.stringify(row.policy)})`)
      let lifecycleTick = 0
      while (lifecycleTick < lifecycleTarget) {
        const count = Math.min(120, lifecycleTarget - lifecycleTick)
        await ev(`qaStep(${count})`); lifecycleTick += count
      }
      row.slideChange = await ev('await qaSlideChange()')
      row.destroyAfterSlideChange = await ev('await qaDestroy()')
      assert.ok(row.destroyAfterSlideChange.source.restoredAtImmediate && row.destroyAfterSlideChange.source.restoredAtDelayed,
        'Смена слайда и destroy восстановили исходник прежнего номера')
      // Active-ID destroy is a different scenario: restore the real UI scene,
      // mount fresh and advance to the same meaningful phase without cancelling it.
      row.destroyUIPreparation = await prepare(entry)
      row.destroyStart = await ev(`await qaStart(${JSON.stringify(entry.id)},${face},${JSON.stringify(row.policy)})`)
      lifecycleTick = 0
      while (lifecycleTick < lifecycleTarget) {
        const count = Math.min(120, lifecycleTarget - lifecycleTick)
        await ev(`qaStep(${count})`); lifecycleTick += count
      }
      row.destroy = await ev('await qaDestroy()')
      if (entry.id === 'magnet') assert.notEqual(row.destroy.source.beforeDestroy, row.destroy.source.beforePlay,
        'E2 active destroy начинается с реально скрытого источника')
      assert.ok(row.destroy.source.restoredAtImmediate && row.destroy.source.restoredAtDelayed,
        'Active destroy восстановил исходник сразу и после задержки')
      row.status = 'captured'; row.finished = new Date().toISOString()
      console.log('CAPTURED ' + key + ' ' + row.completion.kind + ' ' + row.completion.seconds.toFixed(2) + 's')
    } catch (error) {
      row.status = 'failed'; row.error = error.stack; row.finished = new Date().toISOString()
      row.failureState = await ev(`(()=>{const raw=globalThis.buddy?.experimental;return{
        state:globalThis.buddy?.state(),preparation:globalThis.qaSession?.directionPreparation,
        world:raw?.world(),plats:raw?.W.plats.map(q=>({x1:q.x1,x2:q.x2,y:q.y,spans:q.spans})),
        lastDownAt:raw?.B.downAt}})()`).catch(() => null)
      if (entry.id === 'quoteIdea') row.diagnostics = await ev('globalThis.qaDiagnostics?.()').catch(() => null)
      console.log('FAIL ' + key + ': ' + error.message)
    } finally {
      if (allocationTrace) row.allocationTrace = await ev('globalThis.qaAllocationSpans||[]').catch(() => null)
      images.length = 0
      const numericClosed = stream && !stream.closed ? once(stream, 'close').catch(() => {}) : null
      if (gzip) gzip.end()
      if (numericClosed) await numericClosed
      if (film) { try { await film.close() } catch { film.kill() } }
      await saveReport()
    }
  }
  report.errors.push(...browser.exceptions, ...browser.consoleErrors)
  report.requests = [...new Set(browser.requests.filter(url => !url.startsWith('data:')))]
  report.externalRequests = report.requests.filter(url => /^https?:/u.test(url) && !url.startsWith(`http://127.0.0.1:${server.address().port}/`))
} catch (error) { report.errors.push(error.stack) }
finally { await saveReport(); await browser?.close(); await new Promise(resolve => server.close(resolve)) }
const done = successful(), missingBatch = ids.flatMap(id => [-1, 1].map(face => id + ':' + face)).filter(key => !done.has(key))
console.log(JSON.stringify({ output, snapshotId, registry: registry.length, batch: ids, missingBatch, coverage: report.coverage, errors: report.errors }))
if (missingBatch.length || report.errors.length || report.externalRequests?.length) process.exitCode = 1

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeFixture } from './support/runtime-fixture.mjs'
import { createRuntime } from '../src/runtime.js'
import { writeFileSync } from 'node:fs'
const rendererRuntime = process.env.BUDDY_RENDERER_SOURCE
  ? (await import(new URL(process.env.BUDDY_RENDERER_SOURCE, import.meta.url))).createRuntime : createRuntime

// Настоящий runtime/resize/observer; подменены только WebGL-команды и DOM из общей fixture.
async function rendererFixture({ dpr = 1, scale = 1, maxTexture = 16384, maxRenderbuffer = 16384, anchors = null, deferRigLoad = false } = {}) {
  const fixture = runtimeFixture(), { stage, host } = fixture, previousDpr = globalThis.devicePixelRatio,
    callbacks = new Map(), observers = [], rigs = [], renderers = []
  let requestId = 0, clock = 0
  const pendingLoads = []
  globalThis.devicePixelRatio = dpr
  globalThis.requestAnimationFrame = fn => { callbacks.set(++requestId, fn); return requestId }
  globalThis.cancelAnimationFrame = id => callbacks.delete(id)
  globalThis.MutationObserver = class {
    constructor(fn) { this.fn = fn; observers.push(this) }
    observe() {}
    disconnect() {}
  }
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1280 * scale, bottom: 720 * scale,
    width: 1280 * scale, height: 720 * scale })
  class Scene {
    children = []
    add(node) { this.children.push(node) }
    traverse(fn) { for (const node of this.children) fn(node) }
  }
  class Renderer {
    constructor({ canvas }) {
      this.canvas = this.domElement = canvas; this.capabilities = { maxTextureSize: maxTexture }; this.calls = []
      this.disposeCalls = 0; this.lossCalls = 0; this.contextLost = false
      this.context = { canvas, MAX_RENDERBUFFER_SIZE: 1, MAX_VIEWPORT_DIMS: 2,
        getParameter: key => key === 1 ? maxRenderbuffer : [maxRenderbuffer, maxRenderbuffer] }
      renderers.push(this)
    }
    setClearColor() {}
    compile() {}
    clear() {}
    render() {}
    dispose() { this.disposeCalls++ }
    forceContextLoss() { this.lossCalls++; this.contextLost = true }
    getContext() { return this.context }
    setDrawingBufferSize(width, height, ratio) {
      this.canvas.width = Math.floor(width * ratio); this.canvas.height = Math.floor(height * ratio)
      this.calls.push({ width, height, ratio, pixels: this.canvas.width * this.canvas.height })
    }
  }
  const Buddy3D = { create() {
    const rig = { root: {}, loaded: deferRigLoad ? new Promise(resolve => pendingLoads.push(resolve)) : Promise.resolve(), viewports: [], pose() {}, place() {}, tint() {},
      opacity() {}, propsOn() {}, prop() {}, headPos: () => false,
      viewport(...args) { this.viewports.push(args) } }
    if (anchors) rig.renderAnchors = anchors
    rigs.push(rig); return rig
  } }, dependencies = { Buddy3D, THREE: { WebGLRenderer: Renderer, Scene,
    OrthographicCamera: class { position = {}; updateProjectionMatrix() {} } } }, instances = []
  async function mount() {
    const raw = rendererRuntime({ deck: stage, host, autonomous: false, dependencies })
    instances.push(raw); if (!deferRigLoad) await raw.ready
    raw.manual(true); raw.progress(1); raw.rescan(); raw.reset()
    return raw
  }
  return { raw: await mount(), host, mount, rigs, renderers, finishLoads() { for (const resolve of pendingLoads.splice(0)) resolve() },
    tick(ms) {
      clock = Math.max(clock, performance.now()) + ms
      for (const [id, fn] of [...callbacks]) { callbacks.delete(id); fn(clock) }
    },
    zoom(value) {
      scale = value; stage.style.transform = 'scale(' + value + ')'
      for (const observer of observers) observer.fn([{ target: stage }])
      for (const [id, fn] of [...callbacks]) { callbacks.delete(id); fn(performance.now()) }
    },
    close() {
      for (const raw of instances) raw.destroy()
      fixture.close()
      previousDpr === undefined ? delete globalThis.devicePixelRatio : globalThis.devicePixelRatio = previousDpr
    }
  }
}

test('WebGL bridge публикует текущие точки главной фигуры, затем обновляет laser/lightning', async () => {
  for (const id of ['laser', 'lightning']) {
    let revision = 0, expected
    const f = await rendererFixture({ anchors(out) {
      revision++
      for (let i = 0; i < 2; i++) {
        out.eyesW[i][0] = 200 + revision + i * 2; out.eyesW[i][1] = 300 + revision;
        out.handsW[i][0] = 400 + revision + i * 2; out.handsW[i][1] = 500 + revision;
        out.palmsW[i][0] = 700 + revision + i * 2; out.palmsW[i][1] = 800 + revision;
        out.eyeOn[i] = true
      }
      expected = structuredClone(out.handsW)
      return true
    } })
    try {
      f.raw.run([id])
      let observed = 0
      for (let n = 0; n < 230; n++) {
        f.raw.step(1 / 120, 120)
        const t = f.raw.B.act.t
        if (t < 1.2 || t > 1.9) continue
        const nodes = [], visit = node => { nodes.push(node); for (const child of node.children || []) visit(child) }
        visit(f.host)
        const lines = nodes.filter(x => x.getAttribute?.('stroke') === (id === 'laser' ? '#FF3B1F' : '#FFC400'))
        for (const line of lines) {
          if (id === 'laser') {
            const x = +line.getAttribute('x1'), y = +line.getAttribute('y1')
            assert.ok([200 + revision, 202 + revision].includes(x) && y === 300 + revision)
          } else {
            const points = line.getAttribute('points'); if (!points) continue
            const start = points.split(' ')[0].split(',').map(Number)
            assert.deepEqual(start, [701 + revision, 800 + revision], 'Молния следует отдельным skin-якорям пясти')
          }
          observed++
        }
        assert.deepEqual(f.raw.tools.hands(), expected, 'SVG draw не затирает реальные ладони')
      }
      assert.ok(revision > 100 && observed > 40, 'Проверен активный номер с обновлениями WebGL')
    } finally { f.close() }
  }
})

test('destroy освобождает только собственный GL-контекст и не закрывает второй экземпляр', async () => {
  const f = await rendererFixture()
  try {
    const second = await f.mount(), [a, b] = f.renderers
    f.raw.destroy(); f.raw.destroy()
    assert.equal(a.disposeCalls, 1); assert.equal(a.lossCalls, 1)
    assert.equal(a.contextLost, true); assert.equal(b.contextLost, false)
    second.run(['wave']); second.step(1 / 60)
    assert.equal(b.lossCalls, 0)
    second.destroy(); assert.equal(b.lossCalls, 1)
  } finally { f.close() }
})

test('destroy до загрузки GLB освобождает поздние ресурсы без повторного закрытия renderer', async () => {
  const f = await rendererFixture({ deferRigLoad: true })
  try {
    f.raw.destroy()
    const renderer = f.renderers[0]
    assert.equal(renderer.disposeCalls, 1); assert.equal(renderer.lossCalls, 1)
    let lateDisposals = 0
    f.rigs[0].root.geometry = { dispose() { lateDisposals++ } }
    f.finishLoads(); await f.raw.ready; await Promise.resolve()
    assert.equal(lateDisposals, 1, 'Поздняя модель всё ещё проходит очистку scene')
    assert.equal(renderer.disposeCalls, 1); assert.equal(renderer.lossCalls, 1)
    assert.equal(f.raw.metrics().scheduled, false)
  } finally { f.close() }
})

test('destroy не вызывает принудительный loss для контекста чужого canvas', async () => {
  const f = await rendererFixture()
  try {
    f.renderers[0].context.canvas = {}
    f.raw.destroy()
    assert.equal(f.renderers[0].disposeCalls, 1)
    assert.equal(f.renderers[0].lossCalls, 0)
  } finally { f.close() }
})

test('WebGL не перевыделяет буфер при отъезде и возврате камеры активного номера', async () => {
  const f = await rendererFixture({ dpr: 2, scale: 3.75 })
  try {
    f.raw.run(['wave']); f.zoom(3.75)
    const before = f.raw.metrics(), samples = []
    for (const zoom of [3.5, 3.2, 3, 2.8, 2.6, 2.4, 2.8, 3.2, 3.75]) {
      f.zoom(zoom)
      const metrics = f.raw.metrics()
      samples.push({ zoom, metrics })
      assert.ok(metrics.nativeDensityMet, 'Сохранена плотность реального экрана')
      assert.ok(metrics.canvasPixels <= metrics.canvasPixelLimit, 'Прежний жёсткий лимит памяти соблюдается')
    }
    const after = f.raw.metrics(), evidence = { before, samples, after }
    if (process.env.BUDDY_CAMERA_BUFFER_REPORT)
      writeFileSync(process.env.BUDDY_CAMERA_BUFFER_REPORT, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
    assert.equal(after.canvasResizes, before.canvasResizes, 'Отъезд и возврат в уже выделенный масштаб не требуют новых buffers')
    f.raw.reset(); f.zoom(1)
    assert.ok(f.raw.metrics().canvasWidth < before.canvasWidth, 'После номера буфер возвращается к обычному размеру')
  } finally { f.close() }
})

test('WebGL удерживает буфер после жеста до конца видимого FX с собственной рамкой', async () => {
  const f = await rendererFixture({ dpr: 2, scale: 3.75 })
  try {
    f.raw.reset(); f.zoom(3.75)
    assert.equal(f.raw.state().act, 'idle')
    const fx = f.raw.tools.custom(5, () => f.raw.tools.mk('g', {}, f.host), () => {})
    fx.frameBounds = [380, 430, 410, 485]
    const before = f.raw.metrics()
    for (const scale of [3.5, 3.2, 2.8, 2.4, 2, 2.4, 2.8, 3.2, 3.75]) {
      f.zoom(scale)
      const metrics = f.raw.metrics()
      assert.ok(metrics.nativeDensityMet)
      assert.ok(metrics.canvasPixels <= metrics.canvasPixelLimit)
      assert.equal(metrics.canvasReserved, true, 'Резерв FX виден в публичной диагностике')
      assert.equal(metrics.canvasResizes, before.canvasResizes,
        'Живой эффект удерживает выделенную плотность после point → idle')
    }
    fx.age = fx.life; f.raw.step(1 / 120, 120); f.zoom(1)
    assert.equal(f.raw.frameBounds().planned, null)
    assert.equal(f.raw.metrics().canvasResizes, before.canvasResizes,
      'Выход FX сохраняет резерв, пока камера завершает приближение')
    f.raw.step(2.1, 60); f.zoom(1)
    assert.equal(f.raw.metrics().canvasReserved, false)
    assert.ok(f.raw.metrics().canvasWidth < before.canvasWidth, 'После исчезновения эффекта плотность снова уменьшается')
  } finally { f.close() }
})

test('плавное приближение к живому FX не пересоздаёт supersampling буфер каждый кадр', async () => {
  const f = await rendererFixture({ dpr: 2, scale: .75 })
  try {
    f.raw.reset(); f.zoom(.75)
    const fx = f.raw.tools.custom(5, () => f.raw.tools.mk('g', {}, f.host), () => {})
    fx.frameBounds = [380, 430, 410, 485]
    const before = f.raw.metrics()
    for (let tick = 1; tick <= 360; tick++) {
      f.zoom(.75 + .65 * tick / 360)
      const metrics = f.raw.metrics()
      assert.ok(metrics.nativeDensityMet)
      assert.ok(metrics.canvasPixels <= 2.4e6, 'Сохраняется мягкий бюджет supersampling')
      assert.ok(metrics.drawingBufferRatio >= Math.min(2 * metrics.screenRatio, 6) - .01,
        'Плотность изображения не снижается относительно прежнего supersampling')
    }
    assert.ok(f.raw.metrics().canvasResizes - before.canvasResizes <= 1,
      'Весь supersampling резерв выделяется один раз до плавного приближения')
  } finally { f.close() }
})

test('WebGL сохраняет native DPR при CSS zoom, включая резерв большой кисти', async () => {
  const observations = []
  for (const dpr of [1, 2]) {
    const f = await rendererFixture({ dpr })
    try {
      for (const zoom of [1, 3, 3.75, 6, 12]) {
        const time = f.raw.state().time
        f.zoom(zoom)
        let metrics = f.raw.metrics()
        observations.push({ dpr, zoom, metrics })
        assert.equal(f.raw.state().time, time, 'render-only zoom не двигает модельное время')
        assert.ok(Math.abs(metrics.outlineScreenPx - 1.25) < 1e-8)
      }
      f.raw.tools.reserveCanvasBounds([590, 620, 702, 748])
      const metrics = f.raw.metrics()
      observations.push({ dpr, zoom: 12, reserve: true, metrics })
      assert.ok(metrics.canvasPixels <= 8.4e6)
    } finally { f.close() }
  }
  if (process.env.BUDDY_DENSITY_REPORT) writeFileSync(process.env.BUDDY_DENSITY_REPORT, JSON.stringify(observations, null, 2) + '\n')
  for (const { dpr, zoom, metrics } of observations) {
    assert.ok(metrics.drawingBufferRatio >= dpr * zoom - .001, JSON.stringify({ dpr, zoom, metrics }))
  }
  for (const { metrics } of observations) {
    assert.equal(metrics.nativeDensityMet, true)
    assert.equal(metrics.canvasDensityLimit, 'none')
  }
})

test('бюджет и hardware ceiling ограничивают буфер явно, сохраняя экранный контур', async () => {
  for (const [options, reason] of [[{ dpr: 2, scale: 100 }, 'pixel-budget'],
    [{ dpr: 2, scale: 12, maxTexture: 1024 }, 'hardware'],
    [{ dpr: 2, scale: 12, maxRenderbuffer: 512 }, 'hardware']]) {
    const f = await rendererFixture(options)
    try {
      const metrics = f.raw.metrics()
      assert.equal(metrics.nativeDensityMet, false)
      assert.equal(metrics.canvasDensityLimit, reason)
      assert.equal(metrics.canvasPixelLimit, 8.4e6)
      assert.ok(metrics.canvasPixels <= metrics.canvasPixelLimit)
      assert.ok(metrics.canvasWidth <= metrics.canvasDimensionLimit && metrics.canvasHeight <= metrics.canvasDimensionLimit)
      assert.ok(Math.abs(metrics.outlineScreenPx - 1.25) < 1e-8)
    } finally { f.close() }
  }
})

test('cold active zoom до native DPR2 не оставляет недостающий пиксель и ограничивает resize, 360Hz input', async () => {
  const rows = []
  for (const options of [{ dpr: 2, scale: 2 }, { dpr: 2, scale: 2, maxTexture: 512 }]) {
    const f = await rendererFixture(options)
    try {
      f.raw.run(['wave'])
      const before = f.raw.metrics(), time = f.raw.state().time, failures = [], allocations = []
      for (let tick = 1; tick <= 360; tick++) {
        const zoom = 2 + 1.75 * tick / 360
        f.zoom(zoom)
        const metrics = f.raw.metrics()
        if (metrics.canvasDensityLimit === 'none' && !metrics.nativeDensityMet) failures.push({ tick, zoom, metrics })
        assert.ok(metrics.canvasPixels <= 8.4e6, 'Не поднят hard pixel budget')
        assert.ok(metrics.canvasWidth <= metrics.canvasDimensionLimit && metrics.canvasHeight <= metrics.canvasDimensionLimit)
        if (metrics.lastFrameResized) allocations.push({ tick, zoom, ratio: metrics.drawingBufferRatio, width: metrics.canvasWidth, height: metrics.canvasHeight })
      }
      assert.equal(f.raw.state().time, time, '360 view updates не меняют модельное время')
      const after = f.raw.metrics()
      rows.push({ options, inputs: 360, before, after, resizes: after.canvasResizes - before.canvasResizes,
        failures: failures.length, firstFailure: failures[0] || null, lastFailure: failures.at(-1) || null, allocations })
    } finally { f.close() }
  }
  if (process.env.BUDDY_COLD_DENSITY_REPORT) writeFileSync(process.env.BUDDY_COLD_DENSITY_REPORT, JSON.stringify({
    createdAtUTC: new Date().toISOString(), method: 'Offline actual runtime resize с WebGL command stub; 360Hz input sweep, не browser FPS/GPU.', rows }, null, 2) + '\n')
  for (const row of rows) {
    assert.equal(row.failures, 0, 'При cap=none фактический backing buffer покрывает native pixels. ' + JSON.stringify(row))
    assert.ok(row.resizes <= 14, 'Монотонный native zoom не перевыделяет буфер на каждом малом float increment. ' + JSON.stringify(row))
  }
})

test('cold near-end float zoom 3.74999→3.75 DPR2 достигает настоящих конечных native pixels', async () => {
  const f = await rendererFixture({ dpr: 2, scale: 3.74999 })
  try {
    f.raw.run(['wave'])
    f.zoom(3.74999) // Начальный trim происходит до последнего малого приращения, не на native endpoint.
    f.zoom(3.75)
    const metrics = f.raw.metrics(), { width, height } = f.renderers[0].calls.at(-1)
    assert.equal(metrics.canvasDensityLimit, 'none')
    assert.ok(metrics.canvasWidth >= Math.floor(width * 7.5) && metrics.canvasHeight >= Math.floor(height * 7.5),
      'Фактические pixels достигают native без предварительного settle/cache7.5. ' + JSON.stringify(metrics))
    assert.equal(metrics.nativeDensityMet, true)
    assert.ok(metrics.canvasPixels <= 8.4e6)
  } finally { f.close() }
})

test('native rounding сохраняет soft supersampling ceiling для desired выше screen ratio', async () => {
  const f = await rendererFixture({ dpr: 2, scale: .75 })
  try {
    f.raw.tools.reserveCanvasBounds([0, 0, 768, 640])
    const metrics = f.raw.metrics()
    assert.ok(metrics.drawingBufferRatio > metrics.screenRatio, 'Проверяется именно supersampling, не native ветка')
    assert.ok(metrics.canvasPixels <= 2.4e6, 'Native quantization не поднимает supersampling soft budget')
    assert.equal(metrics.nativeDensityMet, true)
    assert.equal(metrics.canvasPixelLimit, 8.4e6)
  } finally { f.close() }
})

test('native pixel shortfall пробивает ratio tolerance при переходе из supersampling', async () => {
  const f = await rendererFixture({ dpr: 2, scale: 2.995 })
  try {
    f.raw.tools.reserveCanvasBounds([560, 288, 704, 752])
    f.zoom(2.995)
    const before = f.raw.metrics()
    assert.ok(before.drawingBufferRatio > before.screenRatio && before.drawingBufferRatio < 6)
    assert.ok(6 - before.drawingBufferRatio < .01, 'Переход специально меньше старого resize tolerance')
    f.zoom(3)
    const after = f.raw.metrics()
    assert.equal(after.nativeDensityMet, true, JSON.stringify({ before, after }))
    assert.ok(after.canvasResizes > before.canvasResizes, 'Реальная нехватка pixels требует одного resize')
    assert.ok(after.canvasPixels <= 8.4e6)
  } finally { f.close() }
})

test('hardware и pixel-budget ниже native остаются limited без повторных resize в покое', async () => {
  for (const [options, reason] of [[{ dpr: 2, scale: 100 }, 'pixel-budget'],
    [{ dpr: 2, scale: 12, maxTexture: 512 }, 'hardware']]) {
    const f = await rendererFixture(options)
    try {
      f.zoom(options.scale)
      const before = f.raw.metrics()
      for (let n = 0; n < 60; n++) {
        f.zoom(options.scale + (n % 2 ? .000001 : 0))
        const metrics = f.raw.metrics()
        assert.equal(metrics.nativeDensityMet, false)
        assert.equal(metrics.canvasDensityLimit, reason)
        assert.ok(metrics.canvasPixels <= 8.4e6)
        assert.ok(metrics.canvasWidth <= metrics.canvasDimensionLimit && metrics.canvasHeight <= metrics.canvasDimensionLimit)
      }
      assert.equal(f.raw.metrics().canvasResizes, before.canvasResizes, 'Недостижимая native density не вызывает resize storm')
    } finally { f.close() }
  }
})

test('две WebGL-фигуры независимы; jump резерв не перевыделяется в полёте', async () => {
  const f = await rendererFixture({ dpr: 2, scale: 3.75 })
  try {
    const second = await f.mount(), before = second.metrics()
    f.raw.scene('leap')
    const reserved = f.raw.metrics()
    assert.equal(reserved.canvasReserved, true)
    assert.equal(second.metrics().canvasResizes, before.canvasResizes)
    for (let i = 0; i < 120 && f.raw.B.mode === 'free'; i++) f.raw.step(1 / 60)
    assert.equal(f.raw.metrics().canvasResizes, reserved.canvasResizes, 'В полёте буфер уже зарезервирован')
    assert.equal(second.metrics().canvasPixels, before.canvasPixels)
  } finally { f.close() }
})

test('destroy освобождает private map/uniform/bone textures ровно один раз, включая собственные hooks', async () => {
  const f = await rendererFixture()
  function tracked(texture = false) {
    const listeners = new Map()
    return { isTexture: texture, calls: 0,
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
      dispose() { this.calls++; for (const fn of [...(listeners.get('dispose') || [])]) fn({ target: this }) } }
  }
  function resources(root) {
    const logo = tracked(true), pocket = tracked(true), panel = tracked(true), bone = tracked(true),
      geometry = tracked(), first = Object.assign(tracked(), { map: logo }),
      second = Object.assign(tracked(), { map: pocket, uniforms: { shared: { value: logo },
        image: { value: panel }, layers: { value: [panel, bone] } } }),
      skeleton = { calls: 0, boneTexture: bone, dispose() { this.calls++; this.boneTexture?.dispose(); this.boneTexture = null } }
    second.addEventListener('dispose', () => panel.dispose()) // Реквизит уже владеет своей текстурой.
    Object.assign(root, { geometry, material: [first, second, first], skeleton })
    return [logo, pocket, panel, bone, geometry, first, second, skeleton]
  }
  try {
    const owned = resources(f.rigs[0].root), second = await f.mount(), other = resources(f.rigs[1].root)
    f.raw.destroy(); f.raw.destroy()
    assert.deepEqual(owned.map(x => x.calls), owned.map(() => 1), 'Все собственные ресурсы освобождены один раз')
    assert.deepEqual(other.map(x => x.calls), other.map(() => 0), 'Другой экземпляр сохраняет свои ресурсы')
    second.destroy()
    assert.deepEqual(other.map(x => x.calls), other.map(() => 1))
  } finally { f.close() }
})

test('speed резервирует только локальное окно ghost history до движения, без resize в walk/brake', async () => {
  const cases = []
  for (const face of [-1, 1]) for (const fps of [20, 60]) {
    const f = await rendererFixture({ dpr: 2, scale: 3.75 })
    try {
      Object.assign(f.raw.B, { x: face > 0 ? 200 : 1080, face, anchor: null })
      f.raw.W.floor.spans = [[176, 1080]]
      f.raw.seed(14)
      const before = f.raw.metrics().canvasResizes, x0 = f.raw.B.x
      f.raw.run(['speed'])
      const launched = f.raw.metrics(), changes = [], phases = new Set()
      let last = launched.canvasResizes, maxGhostSpan = 0
      f.raw.manual(false)
      for (let frame = 0; frame < fps * 8; frame++) {
        f.tick(1000 / fps)
        const metrics = f.raw.metrics(), b = f.raw.B
        phases.add(b.act.name)
        if (b.ghost && b.trail.length) maxGhostSpan = Math.max(maxGhostSpan, ...b.trail.map(t => Math.abs(b.x - t[3])))
        if (metrics.canvasResizes !== last) changes.push({ time: f.raw.W.time, action: b.act.name,
          width: metrics.canvasWidth, height: metrics.canvasHeight, resizes: metrics.canvasResizes })
        last = metrics.canvasResizes
        if (b.act.name === 'idle') break
      }
      cases.push({ face, fps, beforeResizes: before, launchResizes: launched.canvasResizes - before,
        reservedPixels: launched.canvasPixels, reservedWidth: f.renderers[0].calls.at(-1).width,
        maxGhostSpan, x0, x1: f.raw.B.x, phases: [...phases], changes })
    } finally { f.close() }
  }
  if (process.env.SPEED_BUFFER_REPORT) writeFileSync(process.env.SPEED_BUFFER_REPORT, JSON.stringify(cases, null, 2) + '\n')
  for (const c of cases) {
    assert.ok(c.phases.includes('walk') && c.phases.includes('brake') && c.phases.includes('idle'))
    assert.deepEqual(c.changes, [], JSON.stringify(c))
    assert.ok(c.reservedWidth < 600, 'Резерв ограничен history window, а не всей шириной слайда')
  }
})

test('кадрирование возвращает неизменяемый снимок тела и плана без чтения DOM', () => {
  const fixture = runtimeFixture(), { raw, stage } = fixture
  try {
    stage.getBoundingClientRect = () => { throw new Error('framing не должен читать layout') }
    const first = raw.frameBounds()
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.actor))
    assert.ok(first.actor.every(Number.isFinite) && first.actor[2] > first.actor[0] && first.actor[3] > first.actor[1])
    assert.equal(first.props, null)
    assert.equal(first.detail, null)
    assert.equal(first.planned, null)
    const plan = [40, 80, 1100, 720], detail = [600, 550, 760, 630]
    raw.B.act.frameBounds = plan
    raw.B.act.detailBounds = () => detail
    const second = raw.frameBounds()
    assert.deepEqual(second.actor, first.actor)
    assert.deepEqual(second.planned, plan)
    assert.deepEqual(second.detail, detail)
    plan[0] = -500
    detail[0] = -500
    assert.equal(second.planned[0], 40, 'сохранённый снимок не зависит от последующей мутации плана')
    assert.equal(second.detail[0], 600)
    assert.ok(Object.isFrozen(second.detail))
    assert.throws(() => { second.actor[0] = 0 })
  } finally { fixture.close() }
})

test('кадрирование включает видимого двойника, а резерв требует конечный прямоугольник', () => {
  const fixture = runtimeFixture(), { raw } = fixture
  try {
    const first = raw.frameBounds().actor
    raw.B.clone = raw.B.x + 180
    raw.step(1 / 60)
    assert.ok(raw.frameBounds().actor[2] - first[2] > 300)
    assert.throws(() => raw.tools.reserveCanvasBounds([0, 0, NaN, 100]), RangeError)
    assert.throws(() => raw.tools.reserveCanvasBounds([0, 0, 0, 100]), RangeError)
    assert.equal(raw.tools.reserveCanvasBounds([0, 0, 300, 200]), false, 'SVG не выделяет WebGL-буфер')
  } finally { fixture.close() }
})

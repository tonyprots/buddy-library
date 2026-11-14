import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inventory } from './deck-integration-check.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/context-v5/webkit')),
  cases = { thinkKeyword: ['context-keywords', 'keyword'], compareValues: ['context-values', 'values'],
    followChart: ['context-chart', 'chart'], chartClimb: ['context-bars', 'bars'], cardRoute: ['context-route', 'route'],
    traceFlow: ['context-flow', 'flow'], inspectDetail: ['context-detail', 'detail'], assembleList: ['context-list', 'list'],
    showBeforeAfter: ['context-images', 'images'], quoteIdea: ['context-text', 'text'] },
  report = { date: new Date().toISOString(), checks: [], sources: {}, errors: [], external: [], failedAssets: [],
    limits: ['WebKit: функциональный прогон десяти номеров с одной стороны; обе стороны и крупности проверяются отдельным Chromium-сценарием.',
      'Модельные шаги и ключевые кадры не являются замером FPS или просмотром непрерывного видео.'] },
  available = await inventory(), packageInfo = available.packages.find(item => item.engines?.webkit.exists)
assert.ok(packageInfo, 'Нужен уже установленный WebKit/Playwright; загрузка браузера этим сценарием не выполняется')
const require = createRequire(import.meta.url), api = require(join(packageInfo.path, 'index.js'))
await mkdir(output, { recursive: true })
for (const file of ['index.html', 'index.js', 'context-stories.js', 'context-story-props.js', 'context-abilities.js',
  'slide-context.js', 'slide-intelligence.js', 'runtime.js', 'vendor.js'])
  report.sources[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex')
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)),
      file = path === root ? join(root, 'index.html') : path
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.html' ? 'text/html' : 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await api.webkit.launch({ headless: true, executablePath: packageInfo.engines.webkit.binary })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2,
    reducedMotion: 'no-preference' }), page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('response', response => { if (response.status() >= 400) report.failedAssets.push(response.url()) })
  page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|data:|blob:)/u.test(request.url())) report.external.push(request.url()) })
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!globalThis.buddy)
  report.browser = browser.version(); report.renderer = await page.evaluate(() => buddy.renderer)
  await page.locator('#group').selectOption('Контекст слайда')
  for (const [id, [scene, kind]] of Object.entries(cases)) {
    await page.locator('#scene').selectOption(scene)
    const fact = await page.evaluate(kind => {
      buddy.pause(); buddy.reset(); buddy.progress(1); buddy.rescan()
      return buddy.context().facts.find(fact => fact.kind === kind)
    }, kind)
    if (!fact) report.missingSource = await page.evaluate(() => {
      const scene = document.querySelector('.slide.on'), svg = scene.querySelector('svg'),
        line = svg?.querySelector('[data-buddy-chart-line]'), matrix = line?.getScreenCTM(), rect = svg?.getBoundingClientRect()
      return { scene: scene.dataset.scene, snapshot: buddy.context(), matrix: matrix ? [matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f] : null,
        rect: rect ? [rect.x,rect.y,rect.width,rect.height] : null, points: line?.getAttribute('points'),
        stage: getComputedStyle(document.getElementById('stage')).transform }
    })
    assert.ok(fact, id + ': найден авторский источник')
    await page.waitForFunction(id => [...document.getElementById('contextSource').options].some(option => option.value === id), fact.id)
    await page.locator('#contextSource').selectOption(fact.id)
    const before = await page.locator('.slide.on').innerHTML()
    await page.locator(`[data-id="${id}"]`).click()
    const result = await page.evaluate(async id => {
      buddy.pause()
      const metadata = (await import('/index.js')).techniques.find(item => item.id === id)
      for (let i = 0; i < 1800 && buddy.state().act !== id; i++) buddy.step(1 / 60)
      if (buddy.state().act !== id) throw new Error('История не запущена: ' + id)
      buddy.step(Math.max(0, metadata.duration * .45 - buddy.experimental.B.act.t))
      const state = buddy.state(), framing = buddy.framing(), layers = document.querySelectorAll('[data-buddy-story-layer]').length
      return { id, fact: buddy.context().facts.find(fact => fact.id === buddy.context().selectedId),
        duration: metadata.duration, state, framing, layers }
    }, id)
    assert.equal(result.state.act, id); assert.ok(result.layers > 0)
    assert.ok([result.state.x, result.state.y, ...result.framing.actor].every(Number.isFinite))
    await page.locator('#viewport').scrollIntoViewIfNeeded()
    await page.locator('#viewport').screenshot({ path: join(output, id + '.png') })
    const ended = await page.evaluate(duration => {
      buddy.step(duration + 1)
      return { state: buddy.state(), layers: document.querySelectorAll('[data-buddy-story-layer]').length }
    }, result.duration)
    assert.notEqual(ended.state.act, id); assert.equal(ended.layers, 0)
    assert.equal(await page.locator('.slide.on').innerHTML(), before)
    report.checks.push({ id, pass: true, result, ended })
    console.log('PASS WebKit ' + id)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => buddy.reducedMotion)
  assert.equal(await page.evaluate(() => buddy.play('thinkKeyword')), false)
  report.checks.push({ name: 'reduced motion', pass: true })
  assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []); assert.deepEqual(report.failedAssets, [])
  report.pass = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve))
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
}

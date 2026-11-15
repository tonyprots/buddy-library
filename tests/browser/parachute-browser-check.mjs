import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/parachute-v6/browser')),
  report = { date: new Date().toISOString(), fps: 24, sources: {}, cycles: [], checks: [], errors: [],
    limits: ['Полный цикл идёт модельными шагами при 24 кадрах/с; это не измерение настоящих FPS.',
      'PNG фиксируют ключевые фазы и крупные планы; качество картинки независимо оценивается по этим кадрам.'] },
  page = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка парашюта</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='28'%3E🪂%3C/text%3E%3C/svg%3E">
<style>*{box-sizing:border-box}body{margin:0;padding:28px;background:#fff;color:#233554;font:16px system-ui}h1{font-size:24px;margin:0}p{margin:12px 0 24px}#viewport{width:1280px;height:720px;position:relative;overflow:hidden;background:#edf4ff}#stage{position:absolute;left:0;top:0;width:1280px;height:720px;transform-origin:0 0}.slide{position:absolute;inset:0;background:#edf4ff}</style>
<h1>Проверка парашюта</h1><p id="status">Подключение персонажа</p><div id="viewport"><div id="stage"><section class="slide on"></section></div></div>
<script type="module">import {createBuddy} from './src/index.js';
globalThis.actor=await createBuddy({stage:document.getElementById('stage'),renderer:new URL(location.href).searchParams.get('renderer')||'auto',motion:'full',autoplay:false,reactions:false,seed:14});
actor.progress(1);actor.pause();document.getElementById('status').textContent='Отрисовка: '+actor.renderer;</script></html>`

await mkdir(output, { recursive: true })
for (const file of ['src/runtime.js', 'src/index.js', 'src/vendor.js', 'tests/browser/parachute-browser-check.mjs'])
  report.sources[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex')
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(page); return }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

function sample() {
  const raw = actor.experimental, b = raw.B, framing = actor.framing(),
    project = point => [b.x + (point[0] * Math.cos(b.yaw) - point[2] * Math.sin(b.yaw)) * raw.tools.S * b.scale,
      b.y + point[1] * raw.tools.S * b.scale],
    hands = b.kk.arms.map(arm => project(arm.hand)),
    feet = b.kk.legs.flatMap(leg => [project(leg.heel), project(leg.toe)]),
    canopy = document.querySelector('[data-buddy-parachute-canopy]'),
    svgShown = canopy && getComputedStyle(canopy.parentElement).display !== 'none'
      && Number(canopy.parentElement.getAttribute('opacity')) > .05,
    cords = [...document.querySelectorAll('[data-buddy-parachute-cord]')].map(node => node.getAttribute('d'))
  return { time: b.t, actionTime: b.act.t, action: b.act.name, mode: b.mode, x: b.x, y: b.y,
    surface: b.surf.kind, surfaceY: b.surfY, hands, feet, framing,
    svgShown: !!svgShown, cords, canopyPath: canopy?.getAttribute('d') || null,
    layers: document.querySelectorAll('[data-buddy-parachute-layer]').length,
    metrics: actor.metrics(), fx: b.fxs.length, renderer: actor.renderer }
}

let browser
const check = async (name, run) => {
  try { const detail = await run(); report.checks.push({ name, pass: true, detail }); console.log('PASS ' + name) }
  catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message) }
}
try {
  browser = await openBrowser({ width: 1440, height: 1000, dpr: Number(process.env.BUDDY_DPR || 2) })
  const ev = browser.evaluate, settle = () => ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),
    capture = async (row, phase) => {
      const before = await ev('actor.state().time'),
        clip = await ev(`(()=>{const r=document.getElementById('viewport').getBoundingClientRect();return{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}})()`)
      for (const closeup of [false, true]) {
        await ev(`(()=>{const s=document.getElementById('stage');if(!${closeup}){s.style.transform='none';return}const f=actor.framing(),boxes=[f.actor,f.props,f.detail].filter(Boolean),a=[Math.min(...boxes.map(b=>b[0]))-12,Math.min(...boxes.map(b=>b[1]))-12,Math.max(...boxes.map(b=>b[2]))+12,Math.max(...boxes.map(b=>b[3]))+12],k=Math.min(5,1100/(a[2]-a[0]),600/(a[3]-a[1]));s.style.transform='translate('+(640-(a[0]+a[2])/2*k)+'px,'+(360-(a[1]+a[3])/2*k)+'px) scale('+k+')'})()`)
        await settle()
        const file = `${row.renderer}-${row.face}-${phase}-${closeup ? 'closeup' : 'overview'}.png`,
          image = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })
        await writeFile(join(output, file), Buffer.from(image.data, 'base64'))
        row.images.push({ phase, closeup, file, sample: await ev(`(${sample.toString()})()`) })
      }
      await ev(`document.getElementById('stage').style.transform='none'`); await settle()
      assert.equal(await ev('actor.state().time'), before, 'Кадрирование не двигает модельное время')
    }

  for (const renderer of ['auto', 'svg']) for (const face of [-1, 1]) await check(`${renderer}, сторона ${face}: полный цикл`, async () => {
    await browser.navigate(`http://127.0.0.1:${server.address().port}/?renderer=${renderer}`)
    for (let i = 0; i < 200 && !await ev('!!globalThis.actor'); i++) await browser.sleep(50)
    assert.equal(await ev('!!globalThis.actor'), true, 'Бадди подключился')
    assert.ok(await ev(`decodeURIComponent(document.querySelector('link[rel="icon"]').getAttribute('href')).includes('<svg')`), 'SVG favicon декодируется')
    const actualRenderer = await ev('actor.renderer')
    if (renderer === 'auto') assert.equal(actualRenderer, 'webgl', 'Нативный WebGL действительно включён')
    else assert.equal(actualRenderer, 'svg')
    await ev(`actor.experimental.B.face=${face};actor.experimental.B.yaw=${face > 0 ? .4 * Math.PI / 2 : Math.PI - .4 * Math.PI / 2};actor.play('parachute');actor.pause()`)
    const row = { renderer: actualRenderer, face, frames: [], images: [] }, pending = [
      [.12, 'start'], [.42, 'opening'], [1, 'open'], [3, 'descent']]
    report.cycles.push(row)
    let landedAt = null, idleAt = null, collapse = false, ending = false, priorHands, maxHandStep = 0
    for (let frame = 0; frame < 24 * 12; frame++) {
      await ev('actor.step(1/24,24)')
      const data = await ev(`(${sample.toString()})()`), elapsed = (frame + 1) / 24
      row.frames.push({ elapsed, ...data })
      if (priorHands) data.hands.forEach((hand, i) => {
        maxHandStep = Math.max(maxHandStep, Math.hypot(...hand.map((value, axis) => value - priorHands[i][axis])))
      })
      priorHands = data.hands
      while (pending[0]?.[0] <= elapsed) await capture(row, pending.shift()[1])
      if (landedAt === null && data.mode === 'ground') { landedAt = elapsed; await capture(row, 'landing') }
      if (landedAt !== null && !collapse && elapsed >= landedAt + .6) { collapse = true; await capture(row, 'collapse') }
      if (landedAt !== null && data.action === 'idle' && idleAt === null) idleAt = elapsed
      if (idleAt !== null && elapsed >= idleAt + .5) { ending = true; await capture(row, 'clean'); break }
    }
    row.landedAt = landedAt; row.maxHandStep = maxHandStep
    assert.ok(maxHandStep < 15, `Нет рывка кисти: ${maxHandStep.toFixed(2)} px за 1/24 с`)
    assert.ok(landedAt > 2 && landedAt < 10, 'Управляемое снижение заканчивается посадкой')
    assert.ok(ending, 'Полный цикл завершился')
    const held = row.frames.filter(frame => frame.action === 'chute' && frame.mode === 'free' && frame.elapsed > 1 && frame.elapsed < 3),
      speed = (held.at(-1).y - held[0].y) / (held.at(-1).elapsed - held[0].elapsed)
    assert.ok(speed > 75 && speed < 100, `Скорость под куполом ${speed.toFixed(2)} px/с`)
    assert.ok(held.every(frame => frame.cords.length === 6 && frame.cords.every(d => d?.includes('L'))), 'Шесть строп натянуты при спуске')
    if (actualRenderer === 'svg') assert.ok(held.every(frame => frame.svgShown), 'SVG-купол видим при спуске')
    else assert.ok(held.every(frame => frame.framing.props && frame.metrics.canvasWidth > 0), 'Купол присутствует в нативном WebGL-кадре')
    const end = row.frames.at(-1)
    assert.equal(end.layers, 0); assert.equal(end.fx, 0); assert.equal(end.framing.props, null)
    assert.ok(Math.abs(Math.max(...end.feet.map(point => point[1])) - end.surfaceY) < .05, 'Стопы на полу')
    await ev(`actor.play('parachute');actor.step(1);actor.reset()`)
    assert.equal(await ev(`document.querySelectorAll('[data-buddy-parachute-layer]').length`), 0, 'Reset удаляет купол в воздухе')
    return { landedAt, speed, maxHandStep, frames: row.frames.length, images: row.images.length }
  })
  report.errors = [...browser.exceptions, ...browser.consoleErrors]
  const external = browser.requests.filter(url => /^https?:/u.test(url) && !url.startsWith(`http://127.0.0.1:${server.address().port}/`))
  assert.deepEqual(external, [], 'Нет внешних сетевых запросов')
  assert.equal(report.errors.length, 0, 'Нет JS/console ошибок')
} catch (error) { report.errors.push(error.stack) }
finally {
  report.passed = report.checks.length === 4 && report.checks.every(check => check.pass) && report.errors.length === 0
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
console.log(JSON.stringify({ output, passed: report.passed, checks: report.checks.map(({ name, pass }) => ({ name, pass })), errors: report.errors }))
if (!report.passed) process.exitCode = 1

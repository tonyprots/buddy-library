import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_RENDER_REPORT || join(root, 'drafts/renderer-before')),
  mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' },
  server = createServer(async (request, response) => {
    try {
      if (request.url === '/fixture') {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;overflow:hidden;background:#edf4ff}.stage{position:absolute;width:1280px;height:720px;transform-origin:0 0}.slide{position:absolute;inset:0}</style></head><body><div class="stage"><section class="slide on"></section></div></body></html>')
        return
      }
      const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
      if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) { response.writeHead(404).end(); return }
      response.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream')
      response.end(await readFile(path === join(root, 'runtime.js') && process.env.BUDDY_RENDER_RUNTIME
        ? resolve(process.env.BUDDY_RENDER_RUNTIME) : path))
    } catch { response.writeHead(404).end() }
  })
await mkdir(output, { recursive: true })
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const base = `http://127.0.0.1:${server.address().port}`, report = { date: new Date().toISOString(), environment: {}, zoom: [], trajectories: [], sources: {} }
for (const name of ['runtime.js', 'vendor.js', 'index.js', 'new-abilities.js', 'ability-props.js']) {
  const data = await readFile(name === 'runtime.js' && process.env.BUDDY_RENDER_RUNTIME ? resolve(process.env.BUDDY_RENDER_RUNTIME) : join(root, name))
  report.sources[name] = createHash('sha256').update(data).digest('hex')
}
let browser
try {
  browser = await openBrowser({ width: 1280, height: 900, dpr: 2 })
  report.environment = await browser.send('Browser.getVersion')
  await browser.navigate(base + '/fixture')
  await browser.evaluate(`const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){const gl=getContext.call(this,kind,...args);
    if(gl&&/^webgl/.test(kind)&&!gl.__buddyPrograms){gl.__buddyPrograms=[];const create=gl.createProgram.bind(gl);gl.createProgram=()=>{const program=create();gl.__buddyPrograms.push(program);return program};this.__buddyGL=gl}return gl};
    globalThis.mod=await import('/index.js'); globalThis.stage=document.querySelector('.stage');
    globalThis.b=await mod.createBuddy({stage,autoplay:false,reactions:false,seed:14});b.pause();b.progress(1);b.reset();
    globalThis.raw=b.experimental;raw.mind().update=()=>{};raw.mind().apply=()=>{};
    raw.posed({smile:.4},.4);raw.B.yaw=.4*Math.PI/2;raw.B.yawV=0;b.step(1/60);
    globalThis.sample=()=>{const cv=stage.querySelector('.buddy canvas'),r=cv.getBoundingClientRect(),s=stage.getBoundingClientRect(),gl=cv.__buddyGL,
      outlines=gl.__buddyPrograms.filter(program=>gl.getProgramParameter(program,gl.LINK_STATUS)).map(program=>{const loc=gl.getUniformLocation(program,'uPx');return loc?gl.getUniform(program,loc):null}).filter(value=>value!=null);
      return {state:b.state(),metrics:b.metrics(),scale:s.width/1280,outlineUniforms:[...new Set(outlines)],canvas:{width:cv.width,height:cv.height,cssWidth:parseFloat(cv.style.width),cssHeight:parseFloat(cv.style.height),displayWidth:r.width,displayHeight:r.height,ratio:cv.width/parseFloat(cv.style.width)}}}`)

  const sample = async (name, expression, wait = 80) => {
    await browser.evaluate(expression)
    await browser.sleep(wait)
    const value = await browser.evaluate('sample()')
    report.zoom.push({ name, ...value })
    await browser.screenshot(join(output, name + '.png'))
  }
  await sample('scale-1-paused', `stage.style.transform='scale(1)';dispatchEvent(new Event('resize'));b.step(1/60)`)
  await sample('scale-3-paused-no-step', `stage.style.transform='translate(-1280px,-1340px) scale(3)'`, 250)
  await sample('scale-3-paused-after-step', `b.step(1/60)`)
  await sample('scale-3-forced-resize', `dispatchEvent(new Event('resize'));b.step(1/60)`)
  await sample('scale-1-paused-return', `stage.style.transform='scale(1)'`, 250)
  await sample('scale-1-forced-resize', `dispatchEvent(new Event('resize'));b.step(1/60)`)
  await sample('parent-scale-half', `document.body.style.transformOrigin='0 0';document.body.style.transform='scale(.5)'`)
  await sample('individual-scale-double', `stage.style.scale='2'`)
  await sample('translation-only', `stage.style.transform='translate(10px,10px)'`)
  await sample('scale-1-dpr-2', `stage.style.scale='';stage.style.transform='scale(1)';document.body.style.transform=''`)
  await browser.metrics(1280, 900, 1)
  // CDP меняет deviceScaleFactor без нативного resize окна; воспроизводим сопровождающий DPR-переход сигнал.
  await browser.evaluate(`dispatchEvent(new Event('resize'))`)
  await sample('scale-1-dpr-1', 'void 0', 160)
  await browser.metrics(1280, 900, 2)

  await browser.evaluate(`stage.style.transform='scale(1)';dispatchEvent(new Event('resize'));b.reset();b.progress(1)`)
  for (const id of ['energyBow', 'forcePush']) {
    const result = await browser.evaluate(`(()=>{b.reset();b.progress(1);const prePlay=b.metrics();b.play(${JSON.stringify(id)});const raw=b.experimental,rows=[],before=b.metrics();
      for(let i=0;i<480;i++){const start=performance.now();b.step(1/60);rows.push({time:i/60,cpuMs:performance.now()-start,resizes:b.metrics().canvasResizes,lastResized:b.metrics().lastFrameResized,pixels:b.metrics().canvasPixels})}
      const after=b.metrics(),costs=rows.map(row=>row.cpuMs).sort((a,b)=>a-b);return {id:${JSON.stringify(id)},prepareResizes:before.canvasResizes-prePlay.canvasResizes,resizes:after.canvasResizes-before.canvasResizes,p95CpuMs:costs[Math.floor(costs.length*.95)],peakCpuMs:Math.max(...costs),before,after,rows}})()`)
    report.trajectories.push(result)
  }
  report.errors = { exceptions: browser.exceptions, consoleErrors: browser.consoleErrors }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ zoom: report.zoom.map(({ name, canvas, outlineUniforms, metrics }) => ({ name, canvas, outlineUniforms,
    outlineScreenPx: metrics.outlineScreenPx, resizes: metrics.canvasResizes })),
    trajectories: report.trajectories.map(({ id, resizes, p95CpuMs, peakCpuMs }) => ({ id, resizes, p95CpuMs, peakCpuMs })), errors: report.errors }))
  if (process.env.BUDDY_RENDER_ASSERT === '1') {
    const normal = report.zoom.find(row => row.name === 'scale-1-paused'),
      zoom = report.zoom.find(row => row.name === 'scale-3-paused-no-step'),
      zoomStepped = report.zoom.find(row => row.name === 'scale-3-paused-after-step'),
      returned = report.zoom.find(row => row.name === 'scale-1-paused-return')
    assert.ok(zoom.canvas.ratio > normal.canvas.ratio * 1.4, 'пауза не оставляет увеличенный холст в прежнем разрешении')
    assert.equal(zoom.state.time, normal.state.time, 'перерисовка зума не двигает модельное время')
    assert.equal(zoom.canvas.width, zoomStepped.canvas.width, 'первый кадр после зума не исправляет запоздало размер буфера')
    assert.ok(returned.canvas.ratio < zoom.canvas.ratio, 'возврат к общему плану обновляет плотность буфера')
    for (const row of report.zoom) assert.ok(Math.abs(row.metrics.outlineScreenPx - 1.25) < 1e-6, row.name + ': контур сохраняет экранную толщину')
    assert.ok(report.zoom.find(row => row.name === 'parent-scale-half').canvas.ratio < normal.canvas.ratio)
    assert.equal(report.zoom.find(row => row.name === 'individual-scale-double').canvas.ratio, normal.canvas.ratio)
    assert.equal(report.zoom.find(row => row.name === 'translation-only').metrics.canvasResizes,
      report.zoom.find(row => row.name === 'individual-scale-double').metrics.canvasResizes)
    assert.equal(report.zoom.find(row => row.name === 'scale-1-dpr-1').canvas.ratio, normal.canvas.ratio / 2)
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

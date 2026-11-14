import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(root, process.env.BUDDY_REPORT_DIR || 'drafts/parachute-v6/native-entry'),
  sourceRoot = join(output, 'sources'),
  frameLimit = Number(process.env.BUDDY_ENTRY_FRAMES || 40),
  cameraMode = process.env.BUDDY_ENTRY_CAMERA || 'auto',
  report = { sources: {}, cycles: [], errors: [], limits: [
    'Реальный стенд и настоящий rAF; screenshots снимаются после числовой записи и не служат замером FPS.',
    'Синхронный снимок до rAF проверяет свежесть framing, следующие кадры — вход в автокамеру.'
  ] }
assert.ok(Number.isInteger(frameLimit) && frameLimit >= 40 && frameLimit <= 900)
assert.ok(['auto', 'closeup', 'overview'].includes(cameraMode))
report.cameraMode = cameraMode
await mkdir(output, { recursive: true })
const sourceFiles = [...(await readdir(root)).filter(name => /\.(?:js|html|json|d\.ts)$/u.test(name)),
  ...(await readdir(join(root, 'presets'))).filter(name => name.endsWith('.js')).map(name => 'presets/' + name),
  'tests/browser/parachute-entry-browser-check.mjs', 'tests/browser/cdp.mjs']
for (const name of sourceFiles) {
  const data = await readFile(join(root, name))
  report.sources[name] = createHash('sha256').update(data).digest('hex')
  await mkdir(dirname(join(sourceRoot, name)), { recursive: true })
  await writeFile(join(sourceRoot, name), data, { flag: 'wx' })
}
report.snapshotId = createHash('sha256').update(JSON.stringify(report.sources)).digest('hex')
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname,
      file = resolve(sourceRoot, pathname === '/' ? 'index.html' : '.' + decodeURIComponent(pathname))
    if (!file.startsWith(sourceRoot + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'text/html')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await openBrowser({ width: 1440, height: 1080, dpr: 2 })
  const ev = browser.evaluate
  await browser.navigate(`http://127.0.0.1:${server.address().port}/`)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  assert.ok(await ev('!!globalThis.buddy'))
  for (const face of [-1, 1]) {
    await ev(`buddy.pause();buddy.autoplay(false);buddy.setReactions(false);buddy.reset();buddy.progress(1);
      document.getElementById('scene').value='empty';document.getElementById('scene').dispatchEvent(new Event('change',{bubbles:true}));
      Object.assign(buddy.experimental.B,{face:${face},yaw:${face > 0 ? '.4*Math.PI/2' : 'Math.PI-.4*Math.PI/2'},yawV:0});buddy.step(1/60,60)`)
    await browser.click(cameraMode === 'closeup' ? '#zoom' : cameraMode === 'overview' ? '#overview' : '#autoFrame'); await browser.sleep(400)
    const row = await ev(`await(async()=>{
      const read=label=>{const b=buddy.experimental.B,s=document.getElementById('stage'),v=document.getElementById('viewport'),m=new DOMMatrix(s.style.transform),f=buddy.framing();
        return{label,time:b.t,action:b.act.name,actor:[b.x,b.y],framing:f,metrics:buddy.metrics(),transform:[m.a,m.e,m.f],viewport:[v.clientWidth,v.clientHeight],
          projectedActor:[f.actor[0]*m.a+m.e,f.actor[1]*m.a+m.f,f.actor[2]*m.a+m.e,f.actor[3]*m.a+m.f]}};
      const samples=[read('before')],longTasks=[],observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));
      observer.observe({type:'longtask',buffered:false});
      const start=performance.now();buddy.play('parachute');const launchMs=performance.now()-start;samples.push(read('synchronous'));buddy.resume();
      for(let i=0;i<${frameLimit};i++){const stamp=await new Promise(requestAnimationFrame);samples.push({...read('raf'+i),stamp})}
      buddy.pause();observer.disconnect();return{face:${face},launchMs,longTasks,samples};
    })()`)
    report.cycles.push(row)
    await browser.screenshot(join(output, `entry-${face}.png`))
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
    assert.ok(row.samples.filter(sample => sample.label.startsWith('raf')).every(sample =>
      sample.projectedActor[3] >= 0 && sample.projectedActor[1] <= sample.viewport[1]), 'Персонаж не пропадает из кадра')
    if (frameLimit >= 540) assert.equal(row.samples.at(-1).action, 'idle', 'Полный настоящий цикл завершён')
    console.log('CAPTURED entry:' + face)
  }
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, [])
} catch (error) { report.errors.push(error.stack) }
finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
if (report.errors.length) process.exitCode = 1

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openBrowser } from './cdp.mjs'

// Узкая диагностика настоящего rAF автокамеры; покадровые screenshots здесь не используются.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(root, process.env.BUDDY_REPORT_DIR || 'drafts/camera-native/present'),
  sourceRoot = join(output, 'sources'), hash = value => createHash('sha256').update(value).digest('hex'),
  files = [...(await readdir(root)).filter(name => /\.(?:js|html|json|d\.ts)$/u.test(name)),
    ...(await readdir(join(root, 'presets'))).filter(name => name.endsWith('.js')).map(name => 'presets/' + name),
    'tests/browser/camera-native-browser-check.mjs', 'tests/browser/cdp.mjs'],
  sources = new Map(await Promise.all(files.map(async name => [name, await readFile(join(root, name))]))),
  report = { created: new Date().toISOString(), cycles: [], errors: [], limits: [
    'Настоящие rAF и transform автокамеры, без screenshot/кодирования в измеряемом окне.',
    'Модель шагает по1/60s за настоящий rAF; измеряется camera continuity, CPU шага и rAF интервал, не GPU-time.',
    'Диагностический отчёт не присваивает оценок качества и не скрывает редкие длинные интервалы.'
  ] }
assert.ok(output.startsWith(join(root, 'drafts') + sep))
await mkdir(sourceRoot, { recursive: true })
for (const [name, data] of sources) {
  await mkdir(dirname(join(sourceRoot, name)), { recursive: true })
  await writeFile(join(sourceRoot, name), data, { flag: 'wx' })
}
report.hashes = Object.fromEntries([...sources].map(([name, data]) => [name, hash(data)]))
report.snapshotId = hash(JSON.stringify(report.hashes))
const { techniques } = await import(pathToFileURL(join(sourceRoot, 'index.js'))),
  promisedSeconds = techniques.find(entry => entry.id === 'present').duration
report.promisedSeconds = promisedSeconds
await writeFile(join(output, 'source-manifest.json'), JSON.stringify({ snapshotId: report.snapshotId, hashes: report.hashes }, null, 2), { flag: 'wx' })
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname),
      file = resolve(sourceRoot, pathname === '/' ? 'index.html' : '.' + pathname)
    if (!file.startsWith(sourceRoot + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.html' ? 'text/html' : 'application/json')
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
  assert.equal(await ev('!!globalThis.buddy'), true)
  await ev(`document.getElementById('scene').value='image';document.getElementById('scene').dispatchEvent(new Event('change',{bubbles:true}));buddy.pause();buddy.autoplay(false);buddy.setReactions(false)`)
  await browser.click('#autoFrame')
  for (const face of [-1, 1]) {
    const preparation = await ev(`(() => {
      buddy.pause();buddy.reset();buddy.progress(1);buddy.rescan();
      const stage=document.getElementById('stage'),element=stage.querySelector('.slide.on [data-buddy-focus]');
      if(!element)throw Error('Нет реальной цели');
      const rect=element.getBoundingClientRect(),base=stage.getBoundingClientRect(),ratio=base.width/1280,
        focus={x:(rect.left+rect.width/2-base.left)/ratio,y:(rect.top+rect.height/2-base.top)/ratio};
      const x=Math.max(64,Math.min(1216,focus.x-(${face})*150));
      Object.assign(buddy.experimental.B,{face:${face},x,cam:.4,yaw:${face > 0 ? '.4*Math.PI/2' : 'Math.PI-.4*Math.PI/2'},yawV:0});
      return{focus,x};
    })()`)
    await browser.click('#autoFrame'); await browser.sleep(300)
    const row = await ev(`await (async()=>{
      if(document.getElementById('autoFrame').getAttribute('aria-pressed')!=='true')throw Error('Камера неauto');
      const began=performance.now();buddy.play('present');buddy.pause();const launchMs=performance.now()-began,
        samples=[],longTasks=[],observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));
      observer.observe({type:'longtask',buffered:false});let prior=null,endedAt=null;
      for(let i=0;i<900;i++){
        const stamp=await new Promise(requestAnimationFrame),start=performance.now();buddy.step(1/60,60);const cpuMs=performance.now()-start,
          b=buddy.experimental.B,m=new DOMMatrix(document.getElementById('stage').style.transform),state=buddy.state();
        samples.push({stamp,intervalMs:prior===null?null:stamp-prior,cpuMs,time:(i+1)/60,action:state.act,actionTime:b.act.t,face:b.face,
          transform:[m.a,m.d,m.e,m.f],framing:buddy.framing(),actor:[b.x,b.y],metrics:buddy.metrics()});prior=stamp;
        if(state.act==='idle'&&endedAt===null)endedAt=(i+1)/60;
        if(endedAt!==null&&(i+1)/60>=endedAt+.6)break;
      }
      observer.disconnect();return{requestedFace:${face},mode:document.getElementById('autoFrame').getAttribute('aria-pressed'),launchMs,samples,longTasks,endedAt,state:buddy.state()};
    })()`)
    report.cycles.push(row)
    row.preparation = preparation
    assert.equal(row.mode, 'true'); assert.equal(row.state.act, 'idle'); assert.ok(row.endedAt >= promisedSeconds - .1)
    assert.ok(row.samples.length > 120)
    assert.ok(row.samples.filter(sample => sample.action === 'present').every(sample => sample.face === face), 'Номер действительно исполнен в запрошенную сторону')
    console.log('CAPTURED native auto present:' + face)
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  }
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, [])
} catch (error) { report.errors.push(error.stack) }
finally {
  report.pass = !report.errors.length && report.cycles.length === 2
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
if (!report.pass) process.exitCode = 1

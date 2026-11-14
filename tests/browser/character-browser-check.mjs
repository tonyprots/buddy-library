import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

// Native PNG и диагностика; графических оценок и production-изменений этот сборщик не делает.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(root, process.env.BUDDY_CHARACTER_REPORT || 'drafts/character-quality/native'),
  rimDiagnostic = process.env.BUDDY_CHARACTER_RIM === '1',
  snapshotRoot = join(output, 'sources'), hash = data => createHash('sha256').update(data).digest('hex'),
  names = [...(await readdir(root)).filter(file => /\.(js|json|d\.ts)$/.test(file)),
    ...(await readdir(join(root, 'presets'))).filter(file => file.endsWith('.js')).map(file => 'presets/' + file),
    'tests/browser/character-browser-check.mjs', 'tests/browser/cdp.mjs'],
  sources = new Map(await Promise.all(names.map(async name => [name, await readFile(join(root, name))])))
assert.ok(output.startsWith(join(root, 'drafts') + sep), 'Сохраняйте evidence в drafts проекта')
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Бадди · графика персонажа</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='7' r='5' fill='%231340e0'/%3E%3Cpath d='M16 13v10M6 16l10-3 10 3M16 23l-7 7m7-7 7 7' stroke='%231340e0' stroke-width='3' fill='none'/%3E%3C/svg%3E">
<style>*{box-sizing:border-box}body{margin:24px;background:#fff;color:#15243c;font:16px system-ui}h1{margin:0 0 16px;font-size:24px}p{margin:0 0 24px}.panes{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pane{position:relative;overflow:hidden;height:880px;background:#edf4ff;border-radius:12px}.stage{position:absolute;width:1280px;height:720px;transform-origin:0 0}.slide{position:absolute;inset:0}.floor{position:absolute;left:0;top:700px;width:1280px;border-top:1px solid #a6b3c4}</style></head><body>
<h1>Бадди · проверка графики</h1><p>Исходный WebGL, два независимых экземпляра, модельное время остановлено между снимками.</p>
<div class="panes"><div class="pane" id="pane-a"><div class="stage" id="a"><section class="slide on"></section><div class="floor"></div></div></div><div class="pane" id="pane-b"><div class="stage" id="b"><section class="slide on"></section><div class="floor"></div></div></div></div>
<script type="module">
const nativeContext=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(kind,...args){const gl=nativeContext.call(this,kind,...args);if(gl&&/^webgl/.test(kind)&&!gl.__qaPrograms){gl.__qaPrograms=[];const original=gl.createProgram.bind(gl);gl.createProgram=()=>{const program=original();gl.__qaPrograms.push(program);return program};this.__qaGL=gl}return gl};
globalThis.qaRigs={};globalThis.qaRimDefaults={};globalThis.qaRimSerial=0;
if(${JSON.stringify(rimDiagnostic)}){const vendor=await import('/vendor.js'),original=vendor.Buddy3D.create;vendor.Buddy3D.create=function(...args){const rig=original.apply(this,args);qaRigs[globalThis.qaCreatingId]=rig;qaRimDefaults[globalThis.qaCreatingId]=rig.G.uRimCol.value.toArray();return rig}}
const{createBuddy}=await import('/index.js');globalThis.qaBuddies={};
for(const id of['a','b']){globalThis.qaCreatingId=id;const stage=document.getElementById(id),buddy=await createBuddy({stage,renderer:'auto',motion:'full',autoplay:false,reactions:false,keyboard:false,seed:14,presets:{superhuman:true}});buddy.pause();buddy.progress(1);buddy.reset();qaBuddies[id]=buddy}
globalThis.qaCamera=(id,scale=12,focus='body')=>{const buddy=qaBuddies[id],stage=document.getElementById(id),pane=stage.parentElement,r=buddy.experimental,b=r.B,k=b.kk,sc=r.tools.S*b.scale,world=p=>[b.x+(p[0]*Math.cos(b.yaw)-p[2]*Math.sin(b.yaw))*sc,b.y+p[1]*sc],box=buddy.framing().actor;let center=[(box[0]+box[2])/2,(box[1]+box[3])/2];if(focus==='face')center=world(k.head);if(focus==='hand')center=world(k.arms[b.face>0?0:1].hand);stage.style.transform='translate('+(pane.clientWidth/2-center[0]*scale)+'px,'+(pane.clientHeight/2-center[1]*scale)+'px) scale('+scale+')';return{scale,focus,center}};
globalThis.qaPose=(id,face,cam,expression={})=>{const buddy=qaBuddies[id],r=buddy.experimental;buddy.reset();buddy.pause();r.B.face=face;r.posed(expression,cam);r.B.yaw=face>0?cam*Math.PI/2:Math.PI-cam*Math.PI/2;r.B.yawV=0;buddy.step(.5,60);return qaCamera(id,12)};
globalThis.qaPlay=(id,name,face,time)=>{const buddy=qaBuddies[id],r=buddy.experimental;buddy.reset();buddy.pause();r.B.face=face;r.B.yaw=face>0?.4*Math.PI/2:Math.PI-.4*Math.PI/2;r.B.yawV=0;buddy.play(name);buddy.step(time,60);return qaCamera(id,12)};
globalThis.qaSample=id=>{const buddy=qaBuddies[id],stage=document.getElementById(id),cv=stage.querySelector('.buddy canvas'),r=cv?.getBoundingClientRect(),box=stage.getBoundingClientRect(),gl=cv?.__qaGL,programs=gl?.__qaPrograms||[],outlines=programs.filter(p=>gl.getProgramParameter(p,gl.LINK_STATUS)).map(p=>{const loc=gl.getUniformLocation(p,'uPx');return loc?gl.getUniform(p,loc):null}).filter(v=>v!==null),b=buddy.experimental.B;return{renderer:buddy.renderer,dpr:devicePixelRatio,state:buddy.state(),pose:b.pose,yaw:b.yaw,framing:buddy.framing(),metrics:buddy.metrics(),stageScale:box.width/1280,outlineUniforms:[...new Set(outlines)],canvas:cv?{width:cv.width,height:cv.height,cssWidth:parseFloat(cv.style.width),cssHeight:parseFloat(cv.style.height),displayWidth:r.width,displayHeight:r.height,backingPerDisplayPixel:[cv.width/r.width,cv.height/r.height]}:null}};
globalThis.qaSetRim=(id,off)=>{const rig=qaRigs[id];if(!rig?.G?.uRimCol)throw Error('Нет реального rig.G.uRimCol');rig.G.uRimCol.value.setRGB(...(off?[0,0,0]:qaRimDefaults[id]));document.getElementById(id).style.setProperty('--qa-redraw',String(++qaRimSerial));};
globalThis.qaRimSample=id=>{const rig=qaRigs[id],stage=document.getElementById(id),cv=stage.querySelector('.buddy canvas'),gl=cv.__qaGL,b=qaBuddies[id].experimental.B,bones=[],materials=[];rig.root.traverse(object=>{if(object.isBone)bones.push({name:object.name,matrix:[...object.matrixWorld.elements]});for(const material of[].concat(object.material||[]))if(material.uniforms?.uRimCol)materials.push({name:material.name,color:material.uniforms.uRimCol.value.toArray(),sameUniform:material.uniforms.uRimCol===rig.G.uRimCol})});const uniforms=gl.__qaPrograms.filter(p=>gl.getProgramParameter(p,gl.LINK_STATUS)).map(p=>{const location=gl.getUniformLocation(p,'uRimCol');return location?Array.from(gl.getUniform(p,location)):null}).filter(Boolean);return{sample:qaSample(id),actionTime:b.act.t,color:rig.G.uRimCol.value.toArray(),defaults:qaRimDefaults[id],programRimUniforms:uniforms,bones,materials}};
qaPose('a',1,.4);qaPose('b',-1,1);globalThis.qaReady=true;
</script></body></html>`
sources.set('fixture.html', Buffer.from(html))
const hashes = Object.fromEntries([...sources].map(([name, data]) => [name, hash(data)])),
  report = { date: new Date().toISOString(), snapshotId: hash(JSON.stringify(hashes)), hashes, rimDiagnostic, checks: [], images: [], zoom: [], isolation: [],
    limits: ['Native PNG сняты после настоящего WebGL-render, без увеличения старых растров.',
      'CSS scale12 — диагностический крупный план; фактическая плотность и cap renderer записываются, не подразумеваются.',
      'Канонические позы задаются через experimental.posed, настоящие wave/thumbsUp/yawn — через публичный play.',
      'Это графический evidence и проверка pause/density; FPS/GPU-time не измеряются, качество не оценивается автоматически.'] }
await mkdir(snapshotRoot, { recursive: true })
for (const [name, data] of sources) { const file = join(snapshotRoot, name); await mkdir(dirname(file), { recursive: true }); await writeFile(file, data, { flag: 'wx' }) }
await writeFile(join(output, 'source-manifest.json'), JSON.stringify({ snapshotId: report.snapshotId, hashes }, null, 2), { flag: 'wx' })
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), file = resolve(snapshotRoot, pathname === '/' ? 'fixture.html' : '.' + pathname)
    if (!file.startsWith(snapshotRoot + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.html' ? 'text/html' : 'application/json'); response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
const check = async (name, fn) => { try { const detail = await fn(); report.checks.push({ name, pass: true, detail }); console.log('PASS ' + name) }
  catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message) } }
try {
  browser = await openBrowser({ width: 1600, height: 1100, dpr: 1 }); report.environment = await browser.send('Browser.getVersion')
  const ev = browser.evaluate, settle = () => ev('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),
    capture = async (name, id = 'a') => {
      await settle(); const sample = await ev(`qaSample(${JSON.stringify(id)})`),
        clip = await ev(`(()=>{const r=document.getElementById(${JSON.stringify('pane-' + id)}).getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height,scale:1}})()`),
        file = name + '.png', data = Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })).data, 'base64')
      await writeFile(join(output, file), data, { flag: 'wx' }); const row = { name, file, sha: hash(data), instance: id, ...sample }; report.images.push(row); return row
    }
  await browser.navigate(`http://127.0.0.1:${server.address().port}/`)
  for (let i = 0; i < 240 && !await ev('!!globalThis.qaReady'); i++) await browser.sleep(50)
  assert.equal(await ev('!!globalThis.qaReady'), true)
  await check('Favicon декодируется; два WebGL экземпляра; зазор панелей ≥8px', async () => {
    const result = await ev(`(()=>{const icon=document.querySelector('link[rel=icon]'),svg=decodeURIComponent(icon.href.split(',')[1]),a=document.getElementById('pane-a').getBoundingClientRect(),b=document.getElementById('pane-b').getBoundingClientRect();return{svgValid:new DOMParser().parseFromString(svg,'image/svg+xml').documentElement.localName==='svg',renderers:Object.values(qaBuddies).map(b=>b.renderer),gap:b.left-a.right}})()`)
    assert.equal(result.svgValid, true); assert.deepEqual(result.renderers, ['webgl', 'webgl']); assert.ok(result.gap >= 8); return result
  })
  if (rimDiagnostic) {
    report.rimPairs = []
    report.limits.push('Rim A/B: G.uRimCol меняется только test-only hook реального Buddy3D.create; pose/time не шагают. Это диагностика причины окраски, без автоматической художественной оценки.')
    for (const dpr of [1, 2]) {
      await browser.metrics(1600, 1100, dpr); await ev("dispatchEvent(new Event('resize'))"); await settle()
      for (const face of [-1, 1]) await check(`Rim A/B/A: stretch1.5s, face${face}, DPR${dpr}, одинаковое модельное время`, async () => {
        await ev(`qaSetRim('a',false);qaPlay('a','stretch',${face},1.5);qaCamera('a',12)`); await settle()
        const name = `rim-dpr-${dpr}-${face < 0 ? 'left' : 'right'}`,
          otherBefore = await ev("qaRimSample('b')"), normal = await capture(name + '-normal'), before = await ev("qaRimSample('a')")
        assert.equal(before.sample.state.act, 'stretch'); assert.ok(Math.abs(before.actionTime - 1.5) < .03)
        assert.ok(before.color.some(value => value > 0)); assert.ok(before.programRimUniforms.length > 0)
        let off, disabled, restored, after
        try {
          await ev("qaSetRim('a',true)"); await settle()
          off = await capture(name + '-off'); disabled = await ev("qaRimSample('a')")
        } finally { await ev("qaSetRim('a',false)"); await settle() }
        restored = await capture(name + '-restored'); after = await ev("qaRimSample('a')")
        for (const probe of [disabled, after]) {
          assert.equal(probe.sample.state.time, before.sample.state.time, 'Rim redraw не двигает модельные часы')
          assert.equal(probe.actionTime, before.actionTime); assert.equal(probe.sample.yaw, before.sample.yaw)
          assert.deepEqual(probe.sample.pose, before.sample.pose); assert.deepEqual(probe.sample.canvas, before.sample.canvas)
          assert.deepEqual(probe.bones.map(bone => bone.name), before.bones.map(bone => bone.name))
          const maxDelta = Math.max(0, ...probe.bones.flatMap((bone, index) => bone.matrix.map((value, axis) => Math.abs(value - before.bones[index].matrix[axis]))))
          assert.ok(maxDelta <= 1e-9, 'Кости frozen pose изменились: ' + maxDelta)
        }
        assert.deepEqual(disabled.color, [0, 0, 0]); assert.ok(disabled.programRimUniforms.every(color => color.every(value => value === 0)), 'Настоящие WebGL uniforms должны получить ноль')
        assert.deepEqual(after.color, before.color); assert.deepEqual(after.programRimUniforms, before.programRimUniforms)
        const otherAfter = await ev("qaRimSample('b')")
        assert.deepEqual(otherAfter.color, otherBefore.color); assert.deepEqual(otherAfter.programRimUniforms, otherBefore.programRimUniforms)
        assert.equal(otherAfter.sample.state.time, otherBefore.sample.state.time)
        for (const row of [normal, off, restored]) {
          assert.ok(Math.min(...row.canvas.backingPerDisplayPixel) >= dpr - .03)
          assert.equal(row.metrics.nativeDensityMet, true)
        }
        const pair = { dpr, face, images: [normal.file, off.file, restored.file], before, disabled, after, otherBefore, otherAfter,
          pixelComparison: { normalVsOffDifferent: normal.sha !== off.sha, restoredEqualsNormal: restored.sha === normal.sha },
          qualityScore: null, limitation: 'Разница PNG фиксируется как факт, не как улучшение. Нормаль/текстура/свет кроме rim не менялись.' }
        report.rimPairs.push(pair)
        return { dpr, face, time: before.sample.state.time, actionTime: before.actionTime, programCount: before.programRimUniforms.length, ...pair.pixelComparison }
      })
    }
  } else {
  for (const dpr of [1, 2]) {
    await browser.metrics(1600, 1100, dpr); await ev("dispatchEvent(new Event('resize'))"); await settle()
    for (const face of [-1, 1]) for (const [angle, cam] of [['profile', 0], ['quarter', .4], ['front', 1]]) {
      await ev(`qaPose('a',${face},${cam})`); await capture(`dpr-${dpr}-${face < 0 ? 'left' : 'right'}-${angle}`)
    }
    for (const [name, expression] of [['neutral', {}], ['blink', { lid: 1 }], ['smile', { smile: 1 }], ['open-mouth', { mouth: 1, hp: -12 }]]) {
      await ev(`qaPose('a',1,1,${JSON.stringify(expression)})`); await capture(`dpr-${dpr}-expression-${name}`)
    }
    for (const face of [-1, 1]) for (const [name, time] of [['wave', .8], ['wave', 1.2], ['wave', 1.6], ['wave', 2.1], ['thumbsUp', 1.6], ['yawn', 1.2]]) {
      await ev(`qaPlay('a',${JSON.stringify(name)},${face},${time})`)
      await capture(`dpr-${dpr}-${name}-${face < 0 ? 'left' : 'right'}-${time.toFixed(1)}`)
    }
    // Самое важное: размер CSS меняется на уже замороженной позе, первый PNG снят ДО step.
    await check(`DPR${dpr}: pause scale1→3→3.75→6→12→1 обновляется до step без движения времени`, async () => {
      await ev("qaPose('a',1,.4,{smile:.4});qaCamera('a',1)"); await browser.sleep(250)
      const base = await capture(`dpr-${dpr}-pause-scale-1-before`), rows = [base]
      let expectedTime = base.state.time
      for (const scale of [3, 3.75, 6, 12, 1]) {
        await ev(`qaCamera('a',${scale})`); await browser.sleep(250)
        const before = await capture(`dpr-${dpr}-pause-scale-${scale}-before-step`)
        assert.equal(before.state.time, expectedTime, 'CSS repaint не двигает модельное время')
        assert.ok(Math.abs(before.metrics.outlineScreenPx - 1.25) < 1e-6)
        const minDensity = Math.min(...before.canvas.backingPerDisplayPixel)
        assert.ok(minDensity >= dpr - .03, `Плотность ${minDensity} меньше DPR${dpr}`)
        assert.equal(before.metrics.nativeDensityMet, true, 'Runtime подтверждает фактическую native density')
        assert.equal(before.metrics.canvasDensityLimit, 'none', 'В этой сцене native density не ограничена бюджетом/устройством')
        assert.ok(before.metrics.canvasPixels <= before.metrics.canvasPixelLimit)
        assert.ok(Math.max(before.canvas.width, before.canvas.height) <= before.metrics.canvasDimensionLimit)
        await ev("qaBuddies.a.step(1/60,60)"); const after = await capture(`dpr-${dpr}-pause-scale-${scale}-after-step`)
        assert.equal(before.canvas.width, after.canvas.width, 'Step не исправляет запоздалый backing size')
        assert.equal(before.canvas.height, after.canvas.height)
        assert.ok(after.state.time > before.state.time, 'Явный step действительно продвинул время')
        rows.push(before, after); expectedTime = after.state.time
      }
      report.zoom.push({ dpr, rows }); return rows.map(({ name, canvas, metrics, state }) => ({ name, canvas, outline: metrics.outlineScreenPx, time: state.time }))
    })
    await check(`DPR${dpr}: масштаб и DPR второго экземпляра не меняют первый`, async () => {
      await ev("qaPose('a',1,.4);qaCamera('a',3);qaPose('b',-1,1);qaCamera('b',1)"); await browser.sleep(250)
      const before = await ev("({a:qaSample('a'),b:qaSample('b')})")
      await ev("qaCamera('b',3)"); await browser.sleep(250)
      const after = await ev("({a:qaSample('a'),b:qaSample('b')})")
      assert.equal(after.a.state.time, before.a.state.time); assert.deepEqual(after.a.canvas, before.a.canvas)
      assert.deepEqual(after.a.outlineUniforms, before.a.outlineUniforms); assert.ok(after.b.canvas.width > before.b.canvas.width)
      report.isolation.push({ dpr, before, after }); await browser.screenshot(join(output, `dpr-${dpr}-two-instances.png`)); return { before, after }
    })
  }
  await check('Native крупные планы scale12 сохраняют плотность устройства', () => {
    const rows = report.images.filter(image => image.stageScale === 12)
    assert.ok(rows.length >= 44)
    for (const row of rows) {
      assert.ok(Math.min(...row.canvas.backingPerDisplayPixel) >= row.dpr - .03,
        `${row.name}: backing/display=${row.canvas.backingPerDisplayPixel}, DPR=${row.dpr}`)
      assert.equal(row.metrics.nativeDensityMet, true, row.name)
      assert.equal(row.metrics.canvasDensityLimit, 'none', row.name)
      assert.ok(row.metrics.canvasPixels <= row.metrics.canvasPixelLimit, row.name)
      assert.ok(Math.max(row.canvas.width, row.canvas.height) <= row.metrics.canvasDimensionLimit, row.name)
    }
    return { captures: rows.length, minimumDeviceDensity: Math.min(...rows.flatMap(row => row.canvas.backingPerDisplayPixel.map(value => value / row.dpr))) }
  })
  // Нагрузка отдельно от PNG: реальный rAF, настоящая отправка WebGL и никакого кодирования/съёмки.
  await browser.metrics(1600, 1100, 2)
  await ev("dispatchEvent(new Event('resize'))")
  report.performance = []
  for (const scale of [3.75, 12]) await check(`DPR2: 144 native rAF/CPU шага wave при CSSscale${scale}`, async () => {
    await ev(`qaPlay('a','wave',1,0);qaCamera('a',${scale});qaCamera('b',1)`)
    await settle(); await browser.sleep(150)
    const result = await ev(`await (async()=>{
      const buddy=qaBuddies.a,samples=[],longTasks=[],before=qaSample('a');let last=null;
      const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));
      try{observer.observe({type:'longtask',buffered:false})}catch{}
      for(let i=0;i<144;i++){
        const raf=await new Promise(requestAnimationFrame),at=performance.now();buddy.step(1/60,60);const cpuMs=performance.now()-at;
        samples.push({frame:i,rafTimestamp:raf,intervalMs:last===null?null:raf-last,cpuMs,action:buddy.state().act,time:buddy.state().time,metrics:buddy.metrics()});last=raf;
      }
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));observer.disconnect();
      return{scale:${scale},dpr:devicePixelRatio,before,after:qaSample('a'),samples,longTasks}
    })()`)
    const summary = values => { const sorted = values.slice().sort((a, b) => a - b); return { count: sorted.length,
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, p95: sorted[Math.floor((sorted.length - 1) * .95)], max: sorted.at(-1) } }
    result.cpuMs = summary(result.samples.map(row => row.cpuMs))
    result.rafMs = summary(result.samples.filter(row => row.intervalMs !== null).map(row => row.intervalMs))
    result.activeWaveSteps = result.samples.filter(row => row.action === 'wave').length
    result.gpuTimeMs = null
    result.limitations = 'CPU submission и native rAF, не GPU-time. Другой экземпляр присутствует, но paused. PNG/кодирования/ресурсного traversal в измеренном цикле нет.'
    report.performance.push(result)
    assert.ok(result.activeWaveSteps >= 128, 'Снято ≥128 активных кадров wave')
    return { scale, activeWaveSteps: result.activeWaveSteps, cpuMs: result.cpuMs, rafMs: result.rafMs,
      pixels: result.after.metrics.canvasPixels, canvas: result.after.canvas, longTasks: result.longTasks }
  })
  }
  report.exceptions = browser.exceptions; report.consoleErrors = browser.consoleErrors
  report.externalRequests = [...new Set(browser.requests.filter(url => /^https?:/.test(url) && !url.startsWith(`http://127.0.0.1:${server.address().port}/`)))]
  await check('Нет ошибок JavaScript и внешних запросов', async () => { assert.deepEqual(report.exceptions, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.externalRequests, []); return true })
} catch (error) { report.fatal = error.stack }
finally {
  report.pass = !report.fatal && report.checks.every(check => check.pass)
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
console.log(JSON.stringify({ output, snapshotId: report.snapshotId, pass: report.pass, images: report.images.length, failed: report.checks.filter(c => !c.pass).map(c => c.name), fatal: report.fatal }))
if (!report.pass) process.exitCode = 1

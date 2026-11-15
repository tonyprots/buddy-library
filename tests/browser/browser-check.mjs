import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/browser-check')),
  mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.md': 'text/plain' }
const demoHtml = await readFile(join(root, 'index.html'), 'utf8'),
  storyCss = demoHtml.match(/\.story-caption[\s\S]*?(?=<\/style>)/)[0],
  storySceneMap = { values: 'context-values', images: 'context-images', chart: 'context-chart', bars: 'context-bars',
    route: 'context-route', flow: 'context-flow', list: 'context-list', detail: 'context-detail' },
  storyFixtures = Object.fromEntries(Object.entries(storySceneMap).map(([kind, scene]) => {
    const section = demoHtml.match(new RegExp(`<section class="slide" data-scene="${scene}"[^>]*>([\\s\\S]*?)<\\/section>`))
    assert.ok(section, scene)
    return [kind, section[1]]
  }))
await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/fixture') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}.slide{display:none}.slide.on{display:block}</style></head><body></body></html>')
      return
    }
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)),
      file = path === root ? join(root, 'index.html') : path
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`, report = { date: new Date().toISOString(), checks: [], techniques: [], performance: null }
let browser
const check = (name, detail = true) => { report.checks.push({ name, detail }); console.log(`✓ ${name}`) }
try {
  browser = await openBrowser()
  const version = await browser.send('Browser.getVersion')
  report.environment = { product: version.product, userAgent: version.userAgent, platform: process.platform, arch: process.arch }
  const ev = browser.evaluate
  await browser.navigate(base)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  assert.equal(await ev('!!globalThis.buddy'), true)
  check('Стенд подключает WebGL', await ev('buddy.renderer'))
  const favicon = await ev(`(() => { const href=document.querySelector('link[rel=icon]').href; const svg=decodeURIComponent(href.slice(href.indexOf(',')+1)); return new DOMParser().parseFromString(svg,'image/svg+xml').documentElement.tagName })()`)
  assert.equal(favicon, 'svg'); check('Фавиконка SVG декодируется')
  await browser.click('#search')
  await browser.send('Input.insertText', { text: 'читать книгу' })
  assert.equal(await ev('document.querySelectorAll("#list button").length'), 1)
  await ev(`document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'));document.querySelector('#group').value='Реквизит';document.querySelector('#group').dispatchEvent(new Event('change'))`)
  assert.equal(await ev('document.querySelectorAll("#list button").length'), 5)
  await ev(`document.querySelector('#group').value='';document.querySelector('#group').dispatchEvent(new Event('change'))`)
  check('Поиск и фильтр групп работают')
  await browser.click('#pause'); assert.equal(await ev('buddy.paused'), true)
  const frames = await ev('buddy.metrics().frames')
  const time = await ev('buddy.state().time')
  await browser.sleep(200)
  assert.equal(await ev('buddy.metrics().frames'), frames); check('Пауза не планирует кадры')
  await browser.click('#step'); assert.ok(await ev('buddy.state().time') > time)
  await browser.click('#pause'); assert.equal(await ev('buddy.paused'), false)
  await browser.click('#overview'); await browser.sleep(100)
  await browser.screenshot(join(output, 'desktop.png'))
  for (const width of [320, 768, 1920]) {
    await browser.metrics(width, 1000, 1); await browser.sleep(120)
    const layout = await ev(`({ width:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth })`)
    assert.ok(layout.scroll <= layout.width + 1, `Горизонтальный скролл при ${width}px`)
    if (width === 320) await browser.screenshot(join(output, 'mobile.png'))
  }
  check('Нет горизонтального скролла: 320, 768, 1920px')
  await browser.metrics(1440, 1000, 2)
  const gaps = await ev(`(() => {const result=[];for(const selector of ['.workspace','aside','.transport','.toolbar','.scene-controls','.context-controls']){const parent=document.querySelector(selector),children=[...parent.children].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);for(let i=1;i<children.length;i++){const a=children[i-1].getBoundingClientRect(),b=children[i].getBoundingClientRect(),vertical=b.top>=a.bottom-1,gap=vertical?b.top-a.bottom:b.left>=a.right-1?b.left-a.right:null;if(gap!==null)result.push({selector,gap:Math.round(gap*100)/100})}}return result})()`)
  assert.ok(gaps.every(item => item.gap >= 7.5), JSON.stringify(gaps))
  check('Зазоры между соседними блоками не меньше 8px', gaps)
  await browser.navigate(base + '/fixture')
  await ev(`document.body.innerHTML = '<div id="fixture"></div>';globalThis.THREE={host:true}; globalThis.module = await import('./src/index.js'); globalThis.makeStage = (kind='floor') => { const stage=document.createElement('div'); stage.style.cssText='position:relative;width:1280px;height:720px;background:white;'; stage.innerHTML='<section class="slide on" style="position:absolute;inset:0"><h2 style="position:absolute;left:60px;top:40px">Проверка бадди</h2></section><div class="brand" style="position:absolute;left:45px;top:660px;height:40px;width:180px"><span data-perch-text>Buddy</span></div>'; document.querySelector('#fixture').append(stage); return stage }; globalThis.testStage=makeStage(); globalThis.testBuddy=await module.createBuddy({stage:testStage,autoplay:false,reactions:false,seed:14}); testBuddy.progress(1); testBuddy.reset(); testBuddy.pause();`)
  assert.equal(await ev('globalThis.THREE.host'), true)
  check('Библиотека сохраняет THREE основного приложения')
  assert.equal(await ev('testBuddy.presets.y360'), false)
  assert.match(await ev(`testBuddy.can('disk')`), /is off/)
  assert.equal(browser.requests.some(url => url.includes('/src/presets/y360.js')), false)
  check('Я360 выключен и не загружается по умолчанию')
  await ev(`globalThis.otherStage=makeStage(); otherStage.style.position='absolute';otherStage.style.top='0';otherStage.style.left='0'; globalThis.otherBuddy=await module.createBuddy({stage:otherStage,autoplay:false,reactions:false});otherBuddy.pause()`)
  assert.equal(await ev(`(() => {const ids=[...document.querySelectorAll('.buddy [id]')].map(e=>e.id);return ids.length===new Set(ids).size})()`), true)
  await ev('otherBuddy.destroy();otherStage.remove()')
  check('Два экземпляра не создают одинаковые SVG id')
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await browser.sleep(100)
  assert.equal(await ev('testBuddy.reducedMotion'), true)
  assert.equal(await ev(`testBuddy.play('wave')`), false)
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await browser.sleep(100)
  assert.equal(await ev('testBuddy.reducedMotion'), false)
  check('Системный reduced motion меняется без переподключения')
  await ev(`testBuddy.destroy();globalThis.testBuddy=await module.createBuddy({stage:testStage,autoplay:false,reactions:false,presets:{y360:true},seed:14});testBuddy.pause();testBuddy.progress(1);testBuddy.reset()`)
  assert.equal(await ev(`testBuddy.can('disk')`), null)
  check('Я360 включается явно')
  const focusCheck = await ev(`(() => {
    const slide=testStage.querySelector('.slide'), results=[];
    for(const id of ['present','spotlight'])for(const face of [-1,1]){
      testBuddy.reset();testBuddy.progress(1);testBuddy.experimental.B.face=face;
      slide.innerHTML='<h2 style="position:absolute;left:60px;top:40px">Заголовок</h2><div data-buddy-target style="position:absolute;left:80px;top:150px;width:100px;height:60px">Вторая цель</div><div data-buddy-focus style="position:absolute;left:1000px;top:200px;width:100px;height:60px">Главная цель</div>';
      testBuddy.play(id);testBuddy.step(2);const raw=testBuddy.experimental,mind=raw.mind(),target=mind.queue[0]?.p||mind.tgt;
      results.push({id,face:raw.B.face,target,queue:mind.queue.length});
    }
    slide.innerHTML='<h2 style="position:absolute;left:60px;top:40px">Проверка бадди</h2>';testBuddy.reset();return results;
  })()`)
  for (const item of focusCheck) {
    assert.equal(item.face, 1, `${item.id}: повернулся к явной цели`)
    assert.equal(item.target.x, 1050, `${item.id}: data-buddy-focus важнее заголовка и data-buddy-target`)
    assert.equal(item.target.y, 230)
    assert.ok(item.queue <= 1, 'Взгляд не создаёт очередь на каждом кадре')
  }
  check('Представление и фонарик выбирают явную цель, поворачиваются и смотрят на неё', focusCheck)
  for (const [id, time] of [['present', 2], ['spotlight', 2.5], ['comet', 1.55], ['energyOrb', 3], ['rain', 3], ['timeBubble', 3]]) {
    await ev(`testBuddy.reset();testBuddy.progress(1);testStage.querySelector('.slide').innerHTML='<h2 data-buddy-focus style="position:absolute;left:80px;top:100px;font-size:48px">Содержимое слайда</h2>';testBuddy.experimental.B.face=1;testBuddy.play(${JSON.stringify(id)});testBuddy.step(${time});`)
    await browser.screenshot(join(output, id + '-stage.png'))
  }
  check('Сохранён общий план сцены с видимой целью и обычным размером персонажа')
  const techniques = await ev('module.techniques.map(({id,requires,contextKinds,duration})=>({id,requires,contextKinds,duration}))')
  await ev(`document.head.insertAdjacentHTML('beforeend',${JSON.stringify('<style>' + storyCss + '</style>')})`)
  for (const technique of process.env.BUDDY_SKIP_ANIMATIONS ? [] : techniques) {
    const result = await ev(`(() => {
      const {id,requires,contextKinds,duration}=${JSON.stringify(technique)}, slide=testStage.querySelector('.slide');
      testBuddy.reset(); testBuddy.progress(1);
      slide.innerHTML='<h2 style="position:absolute;left:60px;top:40px">Проверка бадди</h2>';
      if (['wall','platform','icon','land','stairs','finale','elevated'].includes(requires) || id==='tracker') {
        if (requires==='stairs') slide.innerHTML+='<div data-buddy-stairs><div style="position:absolute;left:280px;top:470px;width:220px;height:170px;background:#dde8fa">A</div><div style="position:absolute;left:530px;top:390px;width:220px;height:170px;background:#dde8fa">B</div><div style="position:absolute;left:780px;top:310px;width:220px;height:170px;background:#dde8fa">C</div></div>';
        else if (requires==='finale') slide.innerHTML+='<div data-buddy-fly data-buddy-like style="position:absolute;left:420px;top:300px;width:480px;height:230px;background:#dde8fa"><span data-buddy-text>Спасибо</span></div>';
        else slide.innerHTML+='<div data-buddy-land style="position:absolute;left:360px;top:420px;width:300px;height:200px;background:#dde8fa"><svg viewBox="0 0 48 48" style="position:absolute;left:120px;top:80px;width:48px;height:48px"><circle cx="24" cy="24" r="20" fill="blue"/></svg></div>';
      }
      if(contextKinds){
        const kind=contextKinds[0],structured=${JSON.stringify(storyFixtures)};
        if(structured[kind])slide.innerHTML=structured[kind];
        else if(kind==='number')slide.innerHTML+='<strong data-buddy-context="number" style="position:absolute;left:200px;top:200px;font-size:80px">42%</strong>';
        else if(kind==='keyword')slide.innerHTML+='<strong data-buddy-context="keyword" data-buddy-concept="memory" style="position:absolute;left:200px;top:200px;font-size:80px">Контекст</strong>';
        else if(kind==='object')slide.innerHTML+='<svg data-buddy-context="object" viewBox="0 0 80 80" style="position:absolute;left:250px;top:230px;width:100px;height:100px"><circle cx="40" cy="40" r="32" fill="blue"/></svg>';
        else if(kind==='card')slide.innerHTML+='<div data-buddy-context="card" data-buddy-card style="position:absolute;left:820px;top:430px;width:250px;height:160px;padding:24px;background:#dde8fa">Пример</div>';
        else slide.innerHTML+='<p data-buddy-context="text" style="position:absolute;left:120px;top:180px;width:460px;font-size:32px">Проверим результат на примере.</p>';
      }
      testBuddy.rescan();
      if (requires==='elevated') {testBuddy.play('land');testBuddy.step(4)}
      const reason=testBuddy.can(id); if(reason){if(contextKinds)throw new Error(id+': '+reason);return {id,declined:reason}};
      const accepted=testBuddy.play(id), seen=new Set([testBuddy.state().act]);
      for(let i=0;i<Math.max(12,Math.ceil((duration||0)+1));i++){testBuddy.step(1,30);seen.add(testBuddy.state().act); const state=testBuddy.state();if(!Number.isFinite(state.x)||!Number.isFinite(state.y))throw new Error(id+': nonfinite state')}
      const invalid=[...testStage.querySelectorAll('.buddy *')].some(e=>[...e.attributes].some(a=>/NaN|Infinity/.test(a.value)));
      if(invalid)throw new Error(id+': invalid SVG geometry');
      return {id,accepted,seen:[...seen],final:testBuddy.state().act,nodes:testStage.querySelectorAll('.buddy *').length};
    })()`)
    if (technique.id === 'pullups' && !result.declined) assert.ok(result.seen.includes('climb'), 'Подтягивания должны действительно дойти до кромки')
    if (technique.id === 'tracker' && !result.declined) assert.ok(result.seen.includes('point'), 'Знак готовности должен действительно запустить указующий жест')
    report.techniques.push(result)
  }
  if (report.techniques.length) check('Все приёмы проверены на конечные координаты и SVG', report.techniques.length)
  const reaction = await ev(`await (async () => {
    testBuddy.reset();testBuddy.resume();testStage.querySelector('.slide').setAttribute('data-buddy-scene','number');
    const {attachSlideIntelligence}=await import('./src/slide-intelligence.js'), events=[],controller=attachSlideIntelligence({stage:testStage,buddy:testBuddy,quietMs:60,cooldownMs:100,revisitMs:100,staleMs:3000,onReaction:event=>events.push(event)});
    await new Promise(r=>setTimeout(r,40));const early=events.length;await new Promise(r=>setTimeout(r,250));
    const measures=controller.state().measures;for(let i=0;i<20;i++){const node=document.createElement('i');node.textContent='x';testStage.querySelector('.buddy').append(node);node.remove()}
    await new Promise(r=>setTimeout(r,250));const after=controller.state().measures;controller.destroy();
    return {early,events:events.map(e=>({action:e.action,kind:e.kind})),measures,after,destroyed:controller.state().destroyed}
  })()`)
  assert.equal(reaction.early, 0)
  assert.equal(reaction.events.length, 1)
  assert.equal(reaction.events[0].kind, 'number')
  assert.equal(reaction.after, reaction.measures)
  assert.equal(reaction.destroyed, true)
  check('Реакции: тихое окно, один номер, отсутствие пересканирования кадров, cleanup', reaction)
  await ev(`testStage.querySelector('.slide').innerHTML='<h2 style="position:absolute;left:60px;top:40px">Производительность</h2>';testBuddy.reset();testBuddy.pause();testBuddy.progress(1);testBuddy.play('wave');testBuddy.step(1);`)
  report.performance = await ev(`(() => {const samples=[];for(let i=0;i<600;i++){const t=performance.now();testBuddy.step(1/60);samples.push(performance.now()-t)}samples.sort((a,b)=>a-b);return {frames:600,dpr:devicePixelRatio,renderer:testBuddy.renderer,mean:samples.reduce((a,b)=>a+b,0)/samples.length,p50:samples[299],p95:samples[569],p99:samples[593],max:samples.at(-1),metrics:testBuddy.metrics()}})()`)
  check('Замер 600 модельных кадров', report.performance)
  report.activePerformance = await ev(`(() => {
    const results=[];
    for(const id of ['clone','speed','hulk','leap','flip','energyOrb','celebrate']) {
      testBuddy.reset();testBuddy.progress(1);testBuddy.play(id);const samples=[],resizes=[],before=testBuddy.metrics();
      for(let i=0;i<420;i++){const active=testBuddy.state().busy,t=performance.now();testBuddy.step(1/60);const cost=performance.now()-t,metrics=testBuddy.metrics();if(active){samples.push(cost);if(metrics.lastFrameResized)resizes.push({frame:i,cost,resizeMs:metrics.canvasLastResizeMs})}}
      samples.sort((a,b)=>a-b);const at=q=>samples[Math.min(samples.length-1,Math.floor(samples.length*q))];
      const after=testBuddy.metrics();results.push({id,frames:samples.length,mean:samples.reduce((a,b)=>a+b,0)/samples.length,p50:at(.5),p95:at(.95),max:samples.at(-1),canvasResizes:after.canvasResizes-before.canvasResizes,resizeMs:after.canvasResizeMs-before.canvasResizeMs,pixelRatioChanges:after.pixelRatioChanges-before.pixelRatioChanges,canvasPeakPixels:after.canvasPeakPixels,resizes})
    }
    return results
  })()`)
  check('Цена активных тяжёлых номеров измерена отдельно', report.activePerformance)
  report.realtimePerformance = await ev(`await (async () => {
    const result=[];
    for(const id of ['leap','flip']) {
      testBuddy.reset();testBuddy.pause();testBuddy.progress(1);const before=testBuddy.metrics(),t=performance.now();testBuddy.play(id);const launchCostMs=performance.now()-t,launched=testBuddy.metrics(),samples=[];
      for(let i=0;i<420&&testBuddy.state().busy;i++){await new Promise(requestAnimationFrame);const start=performance.now();testBuddy.step(1/60);samples.push(performance.now()-start)}
      samples.sort((a,b)=>a-b);const after=testBuddy.metrics();testBuddy.step(4);const idle=testBuddy.metrics();result.push({id,frames:samples.length,launchCostMs,mean:samples.reduce((a,b)=>a+b,0)/samples.length,p95:samples[Math.floor(samples.length*.95)],max:samples.at(-1),canvasResizes:after.canvasResizes-before.canvasResizes,activeCanvasResizes:after.canvasResizes-launched.canvasResizes,resizeMs:after.canvasResizeMs-before.canvasResizeMs,canvasPeakPixels:after.canvasPeakPixels,canvasPixels:after.canvasPixels,idleCanvasPixels:idle.canvasPixels,canvasReserved:after.canvasReserved,idleCanvasReserved:idle.canvasReserved});
    }
    return result
  })()`)
  check('Крупные появления измерены с паузой rAF между шагами', report.realtimePerformance)
  report.abilityPerformance = []
  for (const item of await ev(`module.techniques.filter(item=>Number.isFinite(item.duration)&&!item.contextKinds).map(({id,duration})=>({id,duration}))`)) {
    const result = await ev(`await (async () => {
      const {id,duration}=${JSON.stringify(item)};
      testBuddy.reset();testBuddy.pause();testBuddy.progress(1);testBuddy.play(id);const samples=[],before=testBuddy.metrics();
      for(let i=0;i<Math.ceil(duration*60);i++){await new Promise(requestAnimationFrame);const start=performance.now();testBuddy.step(1/60);samples.push(performance.now()-start)}
      const active=testBuddy.metrics();testBuddy.step(3);samples.sort((a,b)=>a-b);
      return {id,frames:samples.length,mean:samples.reduce((a,b)=>a+b,0)/samples.length,p95:samples[Math.floor(samples.length*.95)],max:samples.at(-1),canvasResizes:active.canvasResizes-before.canvasResizes,canvasPeakPixels:active.canvasPeakPixels,idleCanvasPixels:testBuddy.metrics().canvasPixels};
    })()`)
    report.abilityPerformance.push(result)
    console.log('  ' + result.id + ': p95 ' + result.p95.toFixed(2) + ' мс')
  }
  assert.equal(report.abilityPerformance.length, 17)
  check('Все 17 переработанных номеров измерены с интервалом rAF', report.abilityPerformance)
  await ev('testBuddy.destroy()')
  assert.equal(await ev(`testStage.querySelector('.buddy')===null`), true)
  await ev(`globalThis.remount=await module.createBuddy({stage:testStage,autoplay:false,reactions:false});remount.destroy()`)
  check('destroy освобождает сцену для повторного подключения')
  const intro = await ev(`await (async () => {
    testStage.innerHTML='<section class="slide cover on" style="position:absolute;inset:0;background:#edf4ff"><h1 style="position:absolute;left:70px;top:180px;font-size:64px">Сейчас начнётся</h1></section><section class="slide" style="position:absolute;inset:0;background:#edf4ff"><h2 style="position:absolute;left:70px;top:70px">Следующий слайд</h2><div data-buddy-land style="position:absolute;left:360px;top:420px;width:300px;height:200px;background:#dde8fa">Площадка</div></section>';
    testStage.style.setProperty('--paper','#edf4ff');testStage.style.setProperty('--flame','#1340e0');
    globalThis.introBuddy=await module.createBuddy({stage:testStage,autoplay:false,reactions:false});
    const {attachDeckEffects}=await import('./src/effects.js'),slides=[...testStage.querySelectorAll('.slide')];
    globalThis.introEffects=attachDeckEffects({stage:testStage,buddy:introBuddy,show:index=>slides.forEach((slide,i)=>slide.classList.toggle('on',i===index))});
    const armed=introEffects.armIntro('line');await new Promise(r=>setTimeout(r,150));const glass=introEffects.glass;
    introEffects.go(1,0);await new Promise(r=>setTimeout(r,2200));
    return {armed,glass,secondActive:slides[1].classList.contains('on'),state:introBuddy.state()}
  })()`)
  assert.equal(intro.armed, true)
  assert.ok(intro.glass?.n > 0)
  assert.equal(intro.secondActive, true)
  await browser.screenshot(join(output, 'intro.png'))
  await ev('introEffects.destroy();introBuddy.destroy()')
  assert.equal(await ev(`testStage.querySelector('[class^="fx-"]') === null`), true)
  check('Интро: стекло, переход на второй слайд и очистка', intro)
  await browser.navigate(base)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  report.catalogClicks = []
  assert.equal(await ev(`document.querySelector('[data-id="binoculars"]')===null`), true)
  for (const id of ['disk', 'mail', 'tracker']) {
    await browser.click(`[data-id="${id}"]`)
    for (let i = 0; i < 200 && !await ev(`(() => {try{return !!buddy?.presets.y360 && buddy.state().busy}catch{return false}})()`); i++) await browser.sleep(25)
    const result = await ev(`(() => {
      buddy.pause();const seen=new Set(), samples=[];
      for(let i=0;i<600;i++){buddy.step(1/60);const state=buddy.state();seen.add(state.act);if(i%30===0)samples.push({act:state.act,fx:state.fx,images:document.querySelectorAll('.buddy image').length})}
      return {id:${JSON.stringify(id)},enabled:buddy.presets.y360,seen:[...seen],samples};
    })()`)
    assert.equal(result.enabled, true)
    assert.ok(result.seen.includes(id === 'tracker' ? 'point' : id), `${id}: клик дошёл до настоящего номера`)
    assert.ok(result.samples.some(sample => sample.images > 0), `${id}: на слайде появился видимый знак`)
    report.catalogClicks.push(result)
    await browser.click(`[data-id="${id}"]`)
    await ev(`buddy.pause();${id === 'tracker' ? "for(let i=0;i<600&&buddy.state().act!=='point';i++)buddy.step(1/60);buddy.step(.15)" : 'buddy.step(1.6)'}`)
    await browser.screenshot(join(output, id + '-click.png'))
  }
  check('Реальные клики каталога запускают диск, письмо и готовность с видимыми знаками', report.catalogClicks)
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions))
  assert.equal(browser.consoleErrors.length, 0, JSON.stringify(browser.consoleErrors))
  report.requests = browser.requests.filter(url => !url.startsWith('data:'))
  check('Необработанных ошибок браузера нет')
  const reportName = process.env.BUDDY_SKIP_ANIMATIONS ? 'report-smoke.json' : 'report.json'
  await writeFile(join(output, reportName), JSON.stringify(report, null, 2))
  console.log(`Отчёт: ${join(output, reportName)}`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

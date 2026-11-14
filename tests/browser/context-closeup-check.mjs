import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/context-v4/closeup')),
  concepts = ['memory', 'target', 'team', 'chain', 'link', 'cloud', 'rules', 'search'],
  report = { date: new Date().toISOString(), sources: {}, frames: [], performance: [], errors: [],
    limits: ['Ключевые кадры не заменяют непрерывный просмотр видео.',
      'CPU времени buddy.step и интервалы rAF измерены отдельно; GPU время и FPS не измерялись.',
      'Старт номера и подготовка реквизита вынесены за пределы 120 измеряемых шагов.'] },
  mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }
await mkdir(output, { recursive: true })
for (const file of ['index.html', 'index.js', 'context-abilities.js', 'context-props.js', 'slide-context.js', 'camera.js', 'runtime.js', 'vendor.js'])
  report.sources[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex')
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)),
      file = path === root ? join(root, 'index.html') : path
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await openBrowser({ width: 1440, height: 1100, dpr: 2 })
  const ev = browser.evaluate,
    choose = async (id, value) => {
      await ev(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`)
      await browser.sleep(100)
    },
    launch = async (id, concept) => {
      const scene = id === 'laptopNotes' ? 'context-text' : id === 'thinkNumber' ? 'numbers' : 'context-keywords',
        kind = id === 'laptopNotes' ? 'text' : id === 'thinkNumber' ? 'number' : 'keyword'
      await choose('scene', scene)
      if (concept) await choose('contextConcept', concept)
      await ev('buddy.pause();buddy.reset();buddy.progress(1);buddy.rescan()')
      const fact = await ev(`buddy.context().facts.find(f=>f.kind===${JSON.stringify(kind)})`)
      assert.ok(fact, 'Найден источник ' + kind)
      let ready = false
      for (let i = 0; i < 40; i++) {
        ready = await ev(`[...document.getElementById('contextSource').options].some(o=>o.value===${JSON.stringify(fact.id)})`)
        if (ready) break
        await browser.sleep(50)
      }
      assert.ok(ready, 'UI источник готов')
      await choose('contextSource', fact.id)
      await browser.click(`[data-id="${id}"]`)
      await ev('buddy.pause()')
      const reached = await ev(`(() => {for(let i=0;i<1200;i++){if(buddy.state().act===${JSON.stringify(id)})return true;buddy.step(1/60)}return false})()`)
      assert.equal(reached, true, 'Достигнут номер ' + id)
      return fact
    },
    screenshot = async file => {
      await ev(`document.getElementById('viewport').scrollIntoView({block:'center'})`); await browser.sleep(120)
      const clip = await ev(`(() => {const r=document.getElementById('viewport').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}})()`),
        result = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })
      await writeFile(join(output, file), Buffer.from(result.data, 'base64'))
    },
    capture = async (id, concept, time, mode, fact) => {
      await browser.click(mode === 'auto' ? '#autoFrame' : '#zoom'); await browser.sleep(750)
      const detail = await ev(`(() => {const f=buddy.framing(),m=new DOMMatrix(getComputedStyle(document.getElementById('stage')).transform),scale=Math.hypot(m.a,m.b),r=document.getElementById('viewport').getBoundingClientRect();return {state:buddy.state(),phase:buddy.experimental.B.act.t,framing:f,viewport:[r.width,r.height],scale,actorCssHeight:(f.actor[3]-f.actor[1])*scale,propsCssHeight:f.props?(f.props[3]-f.props[1])*scale:null,texts:[...document.querySelectorAll('[data-buddy-context-layer] text')].filter(e=>{const r=e.getBoundingClientRect();return r.width>1&&r.height>1}).map(e=>e.textContent)}})()`),
        file = `${id}-${concept || 'source'}-t${time}-${mode}.png`
      await screenshot(file)
      const row = { id, concept, time, mode, fact, image: file, ...detail }
      report.frames.push(row); console.log('FRAME ' + file)
      assert.equal(detail.state.act, id)
      assert.ok(Number.isFinite(detail.actorCssHeight) && detail.actorCssHeight > 0)
      const cut = await ev(`(() => {const view=document.getElementById('viewport').getBoundingClientRect();return [...document.querySelectorAll('[data-buddy-context-layer] text')].filter(el=>{const r=el.getBoundingClientRect();return r.width>1&&r.height>1}).flatMap(el=>{const r=el.getBoundingClientRect();return r.left<view.left-1||r.top<view.top-1||r.right>view.right+1||r.bottom>view.bottom+1?[el.textContent]:[]})})()`)
      assert.deepEqual(cut, [], 'Текст результата целиком в кадре: ' + JSON.stringify(cut))
    }
  await browser.navigate(`http://127.0.0.1:${server.address().port}`)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  assert.equal(await ev('!!globalThis.buddy'), true)
  report.browser = await ev('navigator.userAgent')
  await choose('group', 'Контекст слайда')
  for (const [id, concept] of [['laptopNotes', null], ['thinkNumber', null], ...concepts.map(concept => ['hologramKeyword', concept])]) {
    try {
      const fact = await launch(id, concept)
      for (const time of id === 'hologramKeyword' ? [4] : [2, 4, 6]) {
        await ev(`buddy.step(Math.max(0,${time}-buddy.experimental.B.act.t))`)
        for (const mode of ['auto', 'closeup']) await capture(id, concept, time, mode, fact)
      }
      await ev('buddy.reset();buddy.pause()')
    } catch (error) { report.errors.push({ id, concept, error: error.stack }); console.log('FAIL ' + id + ': ' + error.message) }
  }
  for (const id of ['laptopNotes', 'hologramKeyword']) {
    try {
      await launch(id, id === 'hologramKeyword' ? 'memory' : null)
      await ev('buddy.step(Math.max(0,2-buddy.experimental.B.act.t))')
      await browser.click('#zoom'); await browser.sleep(750)
      const result = await ev(`globalThis.qaPerf=await (async () => {const before=buddy.metrics(),rows=[],start=performance.now();let previous=null;for(let i=0;i<120;i++){const stamp=await new Promise(resolve=>requestAnimationFrame(resolve)),t0=performance.now();buddy.step(1/60);rows.push({cpuMs:performance.now()-t0,intervalMs:previous===null?null:stamp-previous,act:buddy.state().act});previous=stamp}const summarize=xs=>{const sorted=[...xs].sort((a,b)=>a-b);return {count:xs.length,p95:sorted[Math.floor((sorted.length-1)*.95)],max:Math.max(...xs),mean:xs.reduce((a,b)=>a+b,0)/xs.length}};return {before,after:buddy.metrics(),elapsedMs:performance.now()-start,cpuMs:summarize(rows.map(r=>r.cpuMs)),rafIntervalMs:summarize(rows.map(r=>r.intervalMs).filter(x=>x!==null)),rows}})();qaPerf`)
      report.performance.push({ id, mode: 'closeup', startAtSeconds: 2, ...result })
      assert.equal(result.rows.length, 120)
      assert.ok(result.rows.every(row => row.act === id), 'Все измеренные шаги относятся к активному номеру')
      console.log('PERF ' + id + ' CPU p95=' + result.cpuMs.p95 + ' max=' + result.cpuMs.max)
    } catch (error) { report.errors.push({ id, performance: true, error: error.stack }) }
  }
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions))
  assert.equal(browser.consoleErrors.length, 0, JSON.stringify(browser.consoleErrors))
} catch (error) { report.errors.push({ fatal: true, error: error.stack }) }
finally {
  report.pass = report.errors.length === 0
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  const rows = [], groups = new Map()
  for (const frame of report.frames) {
    const key = `${frame.id}:${frame.concept || ''}:${frame.time}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(frame)
  }
  for (const frames of groups.values()) rows.push(`<section><h2>${frames[0].id}${frames[0].concept ? ' · ' + frames[0].concept : ''} · ${frames[0].time} с</h2><div>${frames.map(f => `<figure><img src="${f.image}" alt="${f.mode}"><figcaption>${f.mode} · персонаж ${f.actorCssHeight.toFixed(1)} CSS px</figcaption></figure>`).join('')}</div></section>`)
  await writeFile(join(output, 'comparison.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Бадди · крупности контекста</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='8' cy='8' r='7' fill='%2329be79'/%3E%3C/svg%3E"><style>body{margin:24px;font:16px system-ui;color:#20252f;background:white}section{margin:32px 0}h2{font-size:18px}section>div{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}img{display:block;width:100%}figcaption{margin-top:8px}@media(max-width:768px){section>div{grid-template-columns:1fr}}</style><h1>Общий и крупный планы</h1><p>Отдельные ключевые кадры; непрерывный видеопросмотр не выполнен. Высота персонажа дана в CSS-пикселях viewport.</p>${rows.join('')}</html>`)
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
if (!report.pass) process.exitCode = 1

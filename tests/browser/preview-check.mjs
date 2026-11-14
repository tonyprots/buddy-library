import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/preview-v3')),
  mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.md': 'text/plain' }
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
const check = (name, detail = true) => { report.checks.push({ name, detail }); console.log('PASS ' + name) }
let browser
try {
  browser = await openBrowser()
  const ev = browser.evaluate
  await browser.navigate(base)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  assert.equal(await ev('!!globalThis.buddy'), true)
  await browser.sleep(300)
  const choose = async (id, value) => { await ev(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change'))`); await browser.sleep(220) }
  const listClick = async id => { await browser.click(`[data-id="${id}"]`); await browser.sleep(100) }
  await choose('group', 'Яндекс 360')
  assert.deepEqual(await ev(`[...document.querySelectorAll('#list button')].map(x=>x.dataset.id).sort()`), ['calendar','disk','mail','tracker'])
  await browser.screenshot(join(output, 'y360-group.png'))
  await choose('group', 'Суперхьюман')
  assert.equal(await ev(`[...document.querySelectorAll('#list button')].some(x=>['present','salute','spotlight','rain','celebrate','disk','mail'].includes(x.dataset.id))`), false)
  check('Яндекс 360 отдельной группой, в Суперхьюман только способности')
  await choose('group', '')
  await choose('scene', 'image')
  await listClick('yawn')
  assert.equal(await ev(`document.querySelector('.slide.on').dataset.scene`), 'image')
  assert.equal(await ev(`document.getElementById('overview').getAttribute('aria-pressed')`), 'true')
  await browser.screenshot(join(output, 'image-yawn.png'))
  check('Большая картинка → Зевнуть сохраняет сцену и общий план')
  await browser.click('#zoom')
  await listClick('starcatch')
  assert.equal(await ev(`document.getElementById('zoom').getAttribute('aria-pressed')`), 'true')
  await browser.click('#autoFrame')
  await listClick('starcatch')
  await ev('buddy.step(1.3)')
  await browser.sleep(160)
  const fit = await ev(`(() => {const f=buddy.framing(),v=document.getElementById('viewport').getBoundingClientRect(),m=new DOMMatrix(getComputedStyle(document.getElementById('stage')).transform);return {planned:f.planned,actor:f.actor,scale:m.a,top:f.planned?m.d*f.planned[1]+m.f:null,height:v.height}})()`)
  assert.ok(fit.planned, JSON.stringify(fit))
  assert.ok(fit.top >= -1 && fit.top <= fit.height, JSON.stringify(fit))
  check('Ручной крупный план сохраняется; автокадр включает падение звезды', fit)
  await browser.screenshot(join(output, 'star-auto.png'))
  await choose('scene', 'image')
  await browser.sleep(250)
  await browser.click('#showTarget')
  assert.equal(await ev(`getComputedStyle(document.getElementById('targetOutline')).display`), 'block')
  assert.match(await ev(`document.getElementById('analysis').textContent`), /Картинка/)
  const expectedReaction = await ev('buddy.intelligence.inspect().candidates.find(item=>!item.reason)?.id')
  await browser.click('#reactNow')
  assert.equal(await ev('buddy.state().act'), expectedReaction)
  check('Панель объясняет слайд, показывает цель и запускает подходящую реакцию')
  await browser.click('#pause')
  await choose('mode', 'companion')
  await choose('profile', 'live')
  assert.equal(await ev('buddy.paused'), true)
  assert.deepEqual(await ev('({a:buddy.state().autonomous,r:buddy.intelligence.state().reactions,p:buddy.profile})'), {a:true,r:true,p:'live'})
  await browser.click('#smart')
  assert.deepEqual(await ev('({a:buddy.state().autonomous,r:buddy.intelligence.state().reactions})'), {a:true,r:false})
  await choose('mode', 'manual')
  assert.deepEqual(await ev('({paused:buddy.paused,a:buddy.state().autonomous,r:buddy.intelligence.state().reactions})'), {paused:true,a:false,r:false})
  check('Режимы, профиль и переключатель реакций сохраняют паузу')
  await choose('scene', 'empty')
  await browser.click('#brandUp')
  await ev('buddy.step(15)')
  await browser.sleep(800)
  const brand = await ev('buddy.intelligence.inspect().analysis.brand')
  assert.equal(brand.surface, 'avatar')
  assert.equal(await ev('buddy.state().surf'), 'logo')
  await browser.screenshot(join(output, 'brand-avatar.png'))
  await browser.click('#brandDown')
  await ev('buddy.step(8)')
  await choose('scene', 'image')
  await browser.click('#brandUp')
  await ev('buddy.step(15)')
  await browser.sleep(800)
  assert.equal(await ev('buddy.intelligence.inspect().analysis.brand.surface'), 'text')
  assert.equal(await ev('buddy.state().surf'), 'logo')
  await browser.screenshot(join(output, 'brand-text.png'))
  check('Кнопки взаимодействуют с аватаркой и надписью Digital Review')
  await listClick('energyOrb')
  assert.equal(await ev(`document.querySelector('.slide.on').dataset.scene`), 'image')
  const sequenceSeen = await ev(`(() => {buddy.pause();const seen=new Set();for(let i=0;i<900;i++){buddy.step(1/60);seen.add(buddy.state().act)}return [...seen]})()`)
  assert.ok(sequenceSeen.includes('energyOrb'),JSON.stringify(sequenceSeen))
  check('Номер на полу после подписи выполняет спуск и сохраняет сцену')
  await browser.click('#overview')
  await choose('scene', 'image')
  await browser.screenshot(join(output, 'desktop.png'))
  for (const width of [320,768,1920]) {
    await browser.metrics(width,1100,1);await browser.sleep(250)
    assert.ok(await ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth+1'))
    assert.ok(await ev("document.getElementById('list').scrollWidth <= document.getElementById('list').clientWidth+1"))
    const gaps = await ev(`(() => {const out=[];for(const sel of ['.workspace','aside','.transport','.toolbar','.scene-controls','.diagnostics','.diagnostic-actions','.context-controls']){const es=[...document.querySelector(sel).children].filter(x=>x.getBoundingClientRect().width&&x.getBoundingClientRect().height);for(let i=1;i<es.length;i++){const a=es[i-1].getBoundingClientRect(),b=es[i].getBoundingClientRect(),g=b.top>=a.bottom-1?b.top-a.bottom:b.left>=a.right-1?b.left-a.right:null;if(g!==null)out.push({sel,g})}}return out})()`)
    assert.ok(gaps.every(x=>x.g>=7.5),JSON.stringify({width,gaps}))
    if(width===320) await browser.screenshot(join(output,'mobile.png'))
    report.checks.push({name:'Зазоры и ширина '+width,detail:gaps})
  }
  const favicon = await ev(`new DOMParser().parseFromString(decodeURIComponent(document.querySelector('link[rel=icon]').href.split(',')[1]),'image/svg+xml').documentElement.tagName`)
  assert.equal(favicon,'svg')
  assert.equal(browser.exceptions.length,0,JSON.stringify(browser.exceptions))
  assert.equal(browser.consoleErrors.length,0,JSON.stringify(browser.consoleErrors))
  check('Фавиконка корректна, ошибок JavaScript и консоли нет')
} catch(error) {report.error=error.stack;throw error}
finally {await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve))}

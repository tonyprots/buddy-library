import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/behavior-0.8/browser')), checks = [],
  mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' }
await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname,
      file = resolve(root, path === '/' ? 'index.html' : '.' + decodeURIComponent(path))
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return }
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
let browser
const check = name => { checks.push(name); console.log('✓ ' + name) }
try {
  browser = await openBrowser({ width: 1440, height: 1200, dpr: 1 })
  const ev = browser.evaluate
  await browser.navigate(`http://127.0.0.1:${server.address().port}`)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  assert.equal(await ev('buddy.renderer'), 'webgl')
  assert.equal(await ev('buddy.mode'), 'show')
  assert.equal(await ev('buddy.paused'), false)
  await ev(`document.getElementById('mode').value='companion';document.getElementById('mode').dispatchEvent(new Event('change'))`)
  assert.deepEqual(await ev('[buddy.mode,buddy.state().autonomous,buddy.profile]'), ['companion', true, 'live'])
  await ev(`document.getElementById('character').value='business';document.getElementById('character').dispatchEvent(new Event('change'))`)
  assert.equal(await ev('buddy.character'), 'business')
  check('Режим и характер в стенде управляют настоящим экземпляром')

  await ev(`buddy.reset();buddy.perform('leap');buddy.step(.3)`)
  const before = await ev('buddy.state().y')
  await browser.click('#focus')
  assert.equal(await ev('buddy.state().y'), before)
  await ev('buddy.step(20)')
  assert.equal(await ev('buddy.state().focused'), true)
  await browser.screenshot(join(output, 'focused.png'))
  await browser.click('#focus')
  assert.equal(await ev('buddy.state().focusing'), false)
  check('Кнопка сосредоточиться сохраняет полёт, ждёт посадки и возвращает режим')

  await ev(`document.getElementById('mode').value='manual';document.getElementById('mode').dispatchEvent(new Event('change'));buddy.reset()`)
  await browser.click('#storyPlay')
  await ev('buddy.step(20)')
  await browser.sleep(50)
  assert.equal(await ev(`document.getElementById('storyStatus').textContent`), 'Story complete.')
  assert.equal(await ev(`document.getElementById('storyCancel').disabled`), true)
  await browser.click('#storyPlay')
  await browser.click('#storyCancel')
  await ev('buddy.step(12)')
  await browser.sleep(50)
  assert.equal(await ev(`document.getElementById('storyStatus').textContent`), 'Story cancelled.')
  check('Настоящие клики запускают историю и мягко отменяют её')

  await ev(`document.getElementById('scene').value='platforms';document.getElementById('scene').dispatchEvent(new Event('change'));buddy.focus(false);buddy.pause();buddy.play('land');buddy.step(8)`)
  assert.equal(await ev('buddy.state().surf'), 'plat')
  await ev('buddy.focus();buddy.step(35)')
  assert.equal(await ev('buddy.state().focused'), true)
  assert.equal(await ev('buddy.state().surf'), 'floor')
  check('С карточки focus спускается и находит свободный пол')

  await ev(`buddy.focus(false);document.getElementById('scene').value='stairs';document.getElementById('scene').dispatchEvent(new Event('change'));buddy.pause();globalThis.stairRun=buddy.story(['stairs','wave']);globalThis.stairResult=null;stairRun.finished.then(r=>stairResult=r);buddy.step(2)`)
  assert.equal(await ev('stairResult'), null)
  await ev('buddy.step(50)')
  assert.equal(await ev('stairResult?.status'), 'completed')
  assert.equal(await ev('buddy.state().grounded'), true)
  check('История ждёт весь маршрут лестницы, включая парашют, перед следующим жестом')

  await ev(`document.getElementById('scene').value='numbers';document.getElementById('scene').dispatchEvent(new Event('change'));buddy.pause();buddy.rescan();globalThis.numberId=buddy.context().facts.find(f=>f.kind==='number').id;buddy.selectContext(null);globalThis.contextRun=buddy.story([{play:'thinkNumber',contextId:numberId},'wave']);buddy.step(1)`)
  assert.equal(await ev('buddy.context().selectedId'), await ev('numberId'))
  await ev('buddy.step(20)')
  assert.equal(await ev('await contextRun.finished.then(r=>r.status)'), 'completed')
  assert.equal(await ev('buddy.context().selectedId'), null)
  assert.equal(await ev(`await buddy.perform('thinkNumber',{contextId:'missing'}).finished.then(r=>r.status)`), 'failed')
  check('Шаг выбирает контекстный источник, восстанавливает выбор и объясняет отсутствующий источник')

  await ev(`globalThis.interrupted=buddy.story([{wait:30},'wave']);const slides=[...document.querySelectorAll('#stage>.slide')];slides.forEach(s=>s.classList.toggle('on',s.dataset.scene==='empty'))`)
  await browser.sleep(100)
  assert.equal(await ev('await interrupted.finished.then(r=>r.reason)'), 'slide-changed')
  check('Смена слайда завершает старую историю с причиной')

  await ev(`globalThis.motionRun=buddy.story([{wait:30},'wave'])`)
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await browser.sleep(100)
  assert.equal(await ev('await motionRun.finished.then(r=>r.status)'), 'skipped')
  assert.equal(await ev(`await buddy.perform('wave').finished.then(r=>r.status)`), 'skipped')
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await browser.sleep(100)
  check('Смена reduced motion завершает ожидающую историю и не оставляет Promise')

  const layoutCheck = `(() => {
    const problems=[];
    for(const selector of ['.workspace','.toolbar','.story-controls','.scene-controls']){
      const children=[...document.querySelector(selector).children].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);
      for(let i=1;i<children.length;i++){
        const a=children[i-1].getBoundingClientRect(),b=children[i].getBoundingClientRect(),gap=b.top>=a.bottom-1?b.top-a.bottom:b.left>=a.right-1?b.left-a.right:null;
        if(gap!==null&&gap<7.5)problems.push({selector,gap});
      }
    }
    const href=document.querySelector('link[rel=icon]').getAttribute('href'),icon=new DOMParser().parseFromString(decodeURIComponent(href.split(',')[1]),'image/svg+xml');
    return {problems,icon:icon.documentElement.tagName};
  })()`, layout = await ev(layoutCheck)
  assert.deepEqual(layout.problems, [])
  assert.equal(layout.icon, 'svg')
  await ev(`document.getElementById('focus').scrollIntoView({block:'center'})`)
  await browser.screenshot(join(output, 'desktop.png'))
  for (const width of [320, 768, 1920]) {
    await browser.metrics(width, 1000, 1)
    await browser.sleep(100)
    assert.equal(await ev('document.documentElement.scrollWidth<=document.documentElement.clientWidth'), true)
    for (const mode of ['manual', 'companion', 'show']) {
      await ev(`document.getElementById('mode').value=${JSON.stringify(mode)};document.getElementById('mode').dispatchEvent(new Event('change'));buddy.pause()`)
      assert.deepEqual((await ev(layoutCheck)).problems, [], `${width}, ${mode}`)
    }
    if (width === 320) {
      await ev(`document.getElementById('mode').scrollIntoView({block:'start'})`)
      await browser.screenshot(join(output, 'mobile.png'))
    }
  }
  check('Новые элементы: зазоры ≥8px, три ширины без горизонтального скролла, SVG-фавиконка')
  assert.deepEqual(browser.consoleErrors, [])
  assert.deepEqual(browser.exceptions, [])
  check('Необработанных ошибок браузера нет')
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks }, null, 2))
  await browser?.close()
  await new Promise(done => server.close(done))
}

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/context-v4')),
  cases = [
    ['laptopNotes', 'context-text', 'text', 8.6], ['thinkNumber', 'numbers', 'number', 7.2],
    ['hologramObject', 'context-keywords', 'object', 7.8], ['hologramKeyword', 'context-keywords', 'keyword', 8],
    ['traceFocus', 'context-text', 'text', 6], ['peekCard', 'context-cards', 'card', 9.2],
    ['perchRead', 'context-cards', 'card', 12.8]
  ], concepts = ['memory', 'target', 'team', 'chain', 'link', 'cloud', 'rules', 'search'],
  mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.md': 'text/plain' },
  report = { date: new Date().toISOString(), checks: [], keyframes: [], concepts: [], sources: {},
    limits: ['Ручное продвижение модельного времени и отдельные ключевые кадры; полный видеопрогон не выполнен.',
      'Читаемость движения оценивается человеком по blind-keyframes.html; DOM assertions не заменяют эту оценку.',
      'Две стороны задаются контролируемой позой экспериментального тестового интерфейса перед реальным кликом.'] }
await mkdir(output, { recursive: true })
for (const file of ['index.html', 'index.js', 'context-abilities.js', 'context-props.js', 'slide-context.js', 'runtime.js', 'vendor.js'])
  report.sources[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex')
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/fixture') {
      response.setHeader('Content-Type', 'text/html')
      response.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><style>
        body{margin:0;background:#edf4ff;font-family:sans-serif}#fallbackStage{position:relative;width:1280px;height:720px}
        .slide{position:absolute;inset:0}.number{position:absolute;left:160px;top:180px;font-size:100px}
        button{margin:8px;padding:12px}</style></head><body><div id="fallbackStage"><section class="slide on"><div class="number" data-buddy-context="number" data-buddy-context-id="fallback-number">42%</div></section></div><button id="fallbackThink">Мысль</button><button id="fallbackTrace">Линия</button></body></html>`)
      return
    }
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)),
      file = path === root ? join(root, 'index.html') : path
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let browser
const check = async (name, run) => {
  try {
    const detail = await run(); report.checks.push({ name, pass: true, detail }); console.log('PASS ' + name)
  } catch (error) {
    report.checks.push({ name, pass: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message)
  }
}
try {
  browser = await openBrowser({ width: 1440, height: 1100, dpr: 2 })
  const ev = browser.evaluate,
    choose = async (id, value) => {
      await ev(`(() => {const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      await browser.sleep(140)
    },
    sourceSignature = () => ev(`JSON.stringify([...document.querySelectorAll('.slide.on [data-buddy-context]')].map(el=>({html:el.outerHTML,css:['display','visibility','opacity','transform','clipPath','position','left','top','width','height'].map(key=>getComputedStyle(el)[key])})))`),
    clean = () => ev(`({layers:document.querySelectorAll('[data-buddy-context-layer]').length,clip:document.querySelector('#stage > .buddy')?.style.clipPath || '',state:buddy.state()})`),
    selectKind = async kind => {
      const fact = await ev(`buddy.context().facts.find(fact=>fact.kind===${JSON.stringify(kind)})`)
      assert.ok(fact, 'Совместимый источник ' + kind)
      let available = false
      for (let attempt = 0; attempt < 40; attempt++) {
        available = await ev(`[...document.getElementById('contextSource').options].some(option=>option.value===${JSON.stringify(fact.id)})`)
        if (available) break
        await browser.sleep(50)
      }
      assert.ok(available, 'UI добавил option для источника ' + fact.id)
      await choose('contextSource', fact.id)
      assert.equal(await ev('buddy.context().selectedId'), fact.id)
      return fact
    },
    prepare = async (scene, kind, face = 1) => {
      await choose('scene', scene)
      await ev(`buddy.pause();buddy.reset();buddy.progress(1);buddy.experimental.B.face=${face};document.querySelector('#stage > .buddy').style.clipPath='inset(0px)'`)
      // Зеркалится только тестовая разметка. Сигнатура снимается после этой подготовки.
      await ev(`(() => {for(const el of document.querySelectorAll('.slide.on [data-buddy-context]')){if(el.dataset.qaOriginalLeft===undefined)el.dataset.qaOriginalLeft=el.style.left;el.style.left=el.dataset.qaOriginalLeft;if(${face}<0){const stage=document.getElementById('stage').getBoundingClientRect(),r=el.getBoundingClientRect(),scale=stage.width/1280;el.style.left=(1280-(r.left-stage.left+r.width)/scale)+'px'}}buddy.rescan()})()`)
      return selectKind(kind)
    },
    waitFor = async id => {
      await ev('buddy.pause()')
      const result = await ev(`(() => {const seen=[];for(let i=0;i<1200;i++){const state=buddy.state();if(!seen.includes(state.act))seen.push(state.act);if(state.act===${JSON.stringify(id)})return {reached:true,seen,t:buddy.experimental.B.act.t,face:buddy.experimental.B.face};buddy.step(1/60)}return {reached:false,seen,state:buddy.state(),status:document.getElementById('status')?.textContent}})()`)
      assert.ok(result.reached, JSON.stringify(result)); return result
    },
    toTime = async time => ev(`(() => {const t=buddy.experimental.B.act.t;buddy.step(Math.max(0,${time}-t));return {state:buddy.state(),t:buddy.experimental.B.act.t,face:buddy.experimental.B.face,framing:buddy.framing(),layerCount:document.querySelectorAll('[data-buddy-context-layer]').length}})()`),
    visibleTexts = () => ev(`(() => {const texts=[];for(const el of document.querySelectorAll('[data-buddy-context-layer] text')){const r=el.getBoundingClientRect();let opacity=1;for(let p=el;p&&p.closest('.buddy');p=p.parentElement){const css=getComputedStyle(p);opacity*=Number(css.opacity);if(css.display==='none'||css.visibility==='hidden')opacity=0}if(r.width>.5&&r.height>.5&&opacity>.05)texts.push(el.textContent)}return texts})()`),
    screenshot = async name => {
      await ev(`document.getElementById('viewport')?.scrollIntoView({block:'center'})`); await browser.sleep(100)
      const clip = await ev(`(() => {const r=document.getElementById('viewport').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}})()`),
        result = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })
      await writeFile(join(output, name), Buffer.from(result.data, 'base64'))
      return name
    }
  await browser.navigate(base)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  assert.equal(await ev('!!globalThis.buddy'), true, 'UI подключил бадди')
  await ev('buddy.pause()')
  report.browser = await ev('navigator.userAgent')
  await check('Метаданные и группа контекстных приёмов', async () => {
    const metadata = await ev(`globalThis.qaModule=await import('./index.js');qaModule.techniques.filter(t=>${JSON.stringify(cases.map(([id]) => id))}.includes(t.id)).map(t=>({id:t.id,kinds:t.contextKinds,tags:t.tags}))`)
    assert.deepEqual(metadata.map(item => item.id).sort(), cases.map(item => item[0]).sort())
    assert.ok(metadata.every(item => item.kinds.length && item.tags.includes('context')))
    await choose('group', 'Slide context')
    const listed = await ev(`[...document.querySelectorAll('#list [data-id]')].map(el=>el.dataset.id)`)
    assert.ok(cases.every(([id]) => listed.includes(id)))
    return { metadata, listed }
  })
  for (const face of [1, -1]) for (const [id, scene, kind, duration] of cases) {
    await check(`${id}: реальный клик, сторона ${face}`, async () => {
      const fact = await prepare(scene, kind, face), before = await sourceSignature()
      await browser.click(`[data-id="${id}"]`)
      const entered = await waitFor(id), row = { label: 'A' + String(report.keyframes.length + 1).padStart(2, '0'), id, face, fact, entered, frames: [] }
      report.keyframes.push(row)
      for (const time of [...new Set([2, 4, Math.min(6, duration - .2)])]) {
        const state = await toTime(time), texts = await visibleTexts()
        assert.equal(state.state.act, id, 'Номер ещё активен на ключевом кадре')
        assert.ok([state.state.x, state.state.y, state.t, ...state.framing.actor].every(Number.isFinite))
        if (id === 'thinkNumber' && time === 4) assert.ok(texts.includes('42%'), JSON.stringify(texts))
        row.frames.push({ time, ...state, texts, image: await screenshot(`${row.label}-t${time}.png`) })
      }
      await ev(`buddy.step(${duration + .6}-buddy.experimental.B.act.t)`)
      const ended = await clean()
      assert.notEqual(ended.state.act, id, 'Анимация конечна')
      assert.equal(ended.layers, 0, 'Собственные слои убраны после окончания')
      assert.equal(ended.clip, 'inset(0px)', 'Предыдущий clipPath восстановлен')
      assert.equal(await sourceSignature(), before, 'Стиль и содержимое источника не изменились')
      row.frames.push({ time: 'end', ...ended, image: await screenshot(`${row.label}-end.png`) })
      return { fact, entered, ended }
    })
  }
  for (const concept of concepts) await check('Подготовленный объём: ' + concept, async () => {
    await prepare('context-keywords', 'keyword')
    await choose('contextConcept', concept)
    const fact = await selectKind('keyword')
    assert.equal(fact.concept, concept)
    await browser.click('[data-id="hologramKeyword"]'); await waitFor('hologramKeyword'); await toTime(4)
    const texts = await visibleTexts()
    assert.ok(texts.includes(fact.text), JSON.stringify({ fact, texts }))
    const result = { concept, fact, state: await ev('buddy.state()'), image: await screenshot(`concept-${concept}.png`) }
    report.concepts.push(result); await ev('buddy.reset();buddy.pause()'); assert.equal((await clean()).layers, 0)
    return result
  })
  await check('Ручной источник object/keyword и кнопка подбора номера', async () => {
    await prepare('context-keywords', 'object')
    const before = await sourceSignature(), reason = await ev(`buddy.can('hologramKeyword')`)
    assert.equal(typeof reason, 'string'); assert.ok(reason.length)
    await browser.click('[data-id="hologramKeyword"]'); await ev('buddy.pause()')
    assert.notEqual(await ev('buddy.state().act'), 'hologramKeyword')
    assert.equal((await clean()).layers, 0)
    await browser.click('#contextPlay'); await waitFor('hologramObject'); await toTime(4)
    assert.equal(await sourceSignature(), before)
    await ev('buddy.reset()'); await selectKind('keyword')
    assert.equal(typeof await ev(`buddy.can('hologramObject')`), 'string')
    await browser.click('#contextPlay'); await waitFor('hologramKeyword')
    await ev('buddy.reset();buddy.selectContext(null)')
    assert.equal(await ev('buddy.context().selectedId'), null)
    return { incompatibleReason: reason }
  })
  await check('SVG-копия сохраняет gradient/clip definitions без повторных ID', async () => {
    await prepare('context-keywords', 'object')
    await ev(`(() => {const source=document.querySelector('.slide.on [data-buddy-context="object"]');source.innerHTML='<defs><linearGradient id="qaGradient"><stop stop-color="#38a97a"/><stop offset="1" stop-color="#2854ad"/></linearGradient><clipPath id="qaClip"><circle cx="80" cy="80" r="67"/></clipPath></defs><rect x="10" y="10" width="140" height="140" fill="url(#qaGradient)" clip-path="url(#qaClip)"/>';buddy.rescan()})()`)
    await selectKind('object')
    const before = await sourceSignature()
    await browser.click('[data-id="hologramObject"]'); await waitFor('hologramObject'); await toTime(4)
    const clone = await ev(`(() => {const source=document.querySelector('.slide.on [data-buddy-context="object"]'),copy=document.querySelector('[data-buddy-context-layer] svg'),ids=[...document.querySelectorAll('[id]')].map(el=>el.id),refs=[...(copy?.querySelectorAll('*')||[])].flatMap(el=>[...el.attributes].flatMap(attr=>[...attr.value.matchAll(/url\\(#([^)]*)\\)/g)].map(m=>m[1])));return {exists:!!copy,duplicate:ids.filter((id,i)=>ids.indexOf(id)!==i),copyIds:[...(copy?.querySelectorAll('[id]')||[])].map(el=>el.id),refs,source:source.outerHTML}})()`)
    assert.equal(clone.exists, true); assert.deepEqual(clone.duplicate, [])
    assert.ok(clone.refs.length >= 2 && clone.refs.every(id => clone.copyIds.includes(id)))
    assert.ok(!clone.copyIds.includes('qaGradient') && !clone.copyIds.includes('qaClip'))
    assert.equal(await sourceSignature(), before)
    await screenshot('gradient-projection.png'); await ev('buddy.reset()')
    return clone
  })
  for (const operation of ['reset', 'interrupt', 'slidechange']) await check('Очистка peekCard: ' + operation, async () => {
    await prepare('context-cards', 'card')
    const before = await sourceSignature()
    await browser.click('[data-id="peekCard"]'); await waitFor('peekCard'); await toTime(4)
    assert.ok((await clean()).layers > 0)
    if (operation === 'reset') await ev('buddy.reset();buddy.pause()')
    if (operation === 'interrupt') await ev(`buddy.sequence(['wave']);buddy.step(1/60)`)
    if (operation === 'slidechange') await choose('scene', 'numbers')
    const result = await clean()
    assert.equal(result.layers, 0); assert.equal(result.clip, 'inset(0px)')
    if (operation !== 'slidechange') assert.equal(await sourceSignature(), before)
    return result
  })
  await check('context.measures не измеряет DOM на каждом rAF', async () => {
    await prepare('numbers', 'number'); await browser.sleep(3100)
    const lifecycle = await ev('(() => {const before=buddy.context().measures;buddy.resume();return {before,after:buddy.context().measures}})()')
    assert.equal(lifecycle.after, lifecycle.before + 1, 'resume выполняет один событийный пересчёт контекста')
    const before = lifecycle.after
    await browser.sleep(550); await ev('buddy.pause()')
    const after = await ev('buddy.context().measures')
    assert.equal(after, before)
    return { lifecycle, before, after }
  })
  await choose('group', '')
  for (const width of [320, 768, 1440]) await check('Ширина, интервалы и каталог: ' + width, async () => {
    await browser.metrics(width, 1100, 1); await browser.sleep(180)
    const layout = await ev(`(() => {const gaps=[],clipped=[],hiddenIds=[];for(const selector of ['.workspace','aside','.transport','.toolbar','.scene-controls','.diagnostics','.diagnostic-actions','.context-controls']){const parent=document.querySelector(selector),children=[...parent.children].filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height);for(let i=1;i<children.length;i++){const a=children[i-1].getBoundingClientRect(),b=children[i].getBoundingClientRect(),gap=b.top>=a.bottom-1?b.top-a.bottom:b.left>=a.right-1?b.left-a.right:null;if(gap!==null)gaps.push({selector,gap})}}for(const el of document.querySelectorAll('#list button')){if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)clipped.push(el.dataset.id);const code=el.querySelector('small');if(!code?.getClientRects().length)hiddenIds.push(el.dataset.id)}return {overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,listOverflow:document.getElementById('list').scrollWidth-document.getElementById('list').clientWidth,gaps,clipped,hiddenIds}})()`)
    assert.ok(layout.overflow <= 1 && layout.listOverflow <= 1, JSON.stringify(layout))
    assert.ok(layout.gaps.every(row => row.gap >= 7.5), JSON.stringify(layout.gaps))
    assert.deepEqual(layout.clipped, [])
    if (width === 1440) {
      assert.deepEqual(layout.hiddenIds, [], 'На широком экране видны все идентификаторы')
      const total = await ev(`globalThis.qaModule=await import('./index.js');qaModule.techniques.length`)
      assert.equal(await ev(`document.querySelectorAll('#list button').length`), total)
    } else {
      const selected = await ev(`document.querySelector('#list button.selected')?.dataset.id`),
        code = await ev(`(() => {const el=document.querySelector('#code');return {text:el.textContent,visible:!!el.getClientRects().length,overflow:el.scrollWidth-el.clientWidth}})()`)
      assert.ok(code.visible && code.text.includes(selected) && code.overflow <= 1, JSON.stringify({ selected, code }))
      layout.selectedCode = code
    }
    await ev('scrollTo(0,0)'); await browser.screenshot(join(output, `ui-${width}.png`))
    return layout
  })
  await check('Фавиконка декодируется в SVG', async () => {
    const result = await ev(`(() => {const link=document.querySelector('link[rel=icon]');return {href:link?.href,tag:link?new DOMParser().parseFromString(decodeURIComponent(link.href.split(',')[1]),'image/svg+xml').documentElement.tagName:null}})()`)
    assert.equal(result.tag, 'svg'); return result
  })
  await check('Новый SVG-instance: точное число, подчёркивание и очистка', async () => {
    // Навигация завершает UI вместе с его rAF; отдельно destroy живого стенда вызвал бы его собственный stale callback.
    await browser.metrics(1440, 1000, 1); await browser.navigate(base + '/fixture')
    await ev(`globalThis.qaModule=await import('./index.js');globalThis.buddy=await qaModule.createBuddy({stage:document.getElementById('fallbackStage'),renderer:'svg',autoplay:false,reactions:false,motion:'full',seed:14,presets:{superhuman:true}});buddy.progress(1);buddy.pause();document.getElementById('fallbackThink').onclick=()=>buddy.play('thinkNumber');document.getElementById('fallbackTrace').onclick=()=>buddy.play('traceFocus')`)
    assert.equal(await ev('buddy.renderer'), 'svg')
    assert.equal(await ev(`document.querySelectorAll('.buddy canvas').length`), 0)
    await browser.click('#fallbackThink'); await waitFor('thinkNumber'); await toTime(4)
    assert.ok((await visibleTexts()).includes('42%'))
    await browser.screenshot(join(output, 'fallback-thought.png')); await ev('buddy.reset()')
    assert.equal((await clean()).layers, 0)
    await browser.click('#fallbackTrace'); await waitFor('traceFocus'); await toTime(3)
    const paths = await ev(`[...document.querySelectorAll('[data-buddy-context-layer] path')].filter(el=>el.getAttribute('stroke-width')==='6').map(el=>({d:el.getAttribute('d'),opacity:Number(el.getAttribute('opacity')),width:el.getBoundingClientRect().width}))`)
    assert.ok(paths.some(path => path.opacity > .5 && path.width > 30), JSON.stringify(paths))
    await browser.screenshot(join(output, 'fallback-trace.png')); await ev('buddy.reset()')
    assert.equal((await clean()).layers, 0)
    await ev('buddy.destroy()')
    assert.equal(await ev(`document.querySelectorAll('.buddy,[data-buddy-context-layer]').length`), 0)
    return { renderer: 'svg', paths }
  })
  await check('Нет ошибок JavaScript и консоли', () => {
    assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions))
    assert.equal(browser.consoleErrors.length, 0, JSON.stringify(browser.consoleErrors))
    return { exceptions: browser.exceptions, consoleErrors: browser.consoleErrors }
  })
} catch (error) { report.fatal = error.stack }
finally {
  report.pass = !report.fatal && report.checks.every(check => check.pass)
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  const rows = report.keyframes.map(row => `<section><h2>${row.label}</h2><div>${row.frames.map(frame => `<figure><img src="${frame.image}" alt="${row.label}, фаза ${frame.time}"><figcaption>${frame.time === 'end' ? 'После завершения' : frame.time + ' с'}</figcaption></figure>`).join('')}</div></section>`).join('')
  await writeFile(join(output, 'blind-keyframes.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Бадди · ключевые кадры</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='8' cy='8' r='7' fill='%2329be79'/%3E%3C/svg%3E"><style>body{font:16px system-ui;margin:24px;background:#fff;color:#20252f}section{margin:32px 0}h2{font-size:18px}section>div{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}img{width:100%;display:block}figcaption{margin-top:8px;font-size:13px}@media(max-width:768px){section>div{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><h1>Ключевые кадры</h1><p>Имена номеров скрыты. Оцените смысл движения по четырём кадрам; соответствие кодов хранится в report.json. Это не видеозапись.</p>${rows}</html>`)
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
if (!report.pass) process.exitCode = 1

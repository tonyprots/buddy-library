import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/context-stories')),
  video = process.env.BUDDY_CAPTURE_VIDEO === '1', svgOnly = process.env.BUDDY_RENDERER === 'svg',
  onlyMedia = process.env.BUDDY_ONLY_MEDIA === '1', fps = 24,
  scenes = {
    thinkKeyword: ['context-keywords', 'keyword'], compareValues: ['context-values', 'values'],
    followChart: ['context-chart', 'chart'], chartClimb: ['context-bars', 'bars'], cardRoute: ['context-route', 'route'],
    traceFlow: ['context-flow', 'flow'], inspectDetail: ['context-detail', 'detail'], assembleList: ['context-list', 'list'],
    showBeforeAfter: ['context-images', 'images'], quoteIdea: ['context-text', 'text'],
    laptopNotes: ['context-text', 'text'], thinkNumber: ['numbers', 'number'], hologramObject: ['context-keywords', 'object'],
    hologramKeyword: ['context-keywords', 'keyword'], traceFocus: ['context-text', 'text'],
    peekCard: ['context-cards', 'card'], perchRead: ['context-cards', 'card']
  }, ids = Object.keys(scenes).slice(0, 10),
  report = { date: new Date().toISOString(), video, fps, checks: [], cycles: [], performance: [], sources: {}, errors: [],
    limits: ['Видео представляет полный модельный цикл по 24 шага в секунду; это не измерение настоящих FPS.',
      'CPU активного шага и интервалы rAF измеряются отдельно; запуск и создание реквизита исключены.',
      'Зеркальная постановка меняет только тестовый DOM, исходные файлы не записываются.'] }
await mkdir(output, { recursive: true })
for (const file of ['index.html', 'index.js', 'context-stories.js', 'context-story-props.js', 'context-abilities.js',
  'context-props.js', 'slide-context.js', 'camera.js', 'runtime.js', 'vendor.js'])
  report.sources[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex')
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)),
      file = path === root ? join(root, 'index.html') : path
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.html' ? 'text/html' : 'application/octet-stream')
    if (svgOnly && file === join(root, 'index.html')) {
      const html = await readFile(file, 'utf8'), marker = 'createBuddy({ stage, autoplay:'
      assert.ok(html.includes(marker), 'Тестовая копия стенда содержит подключение бадди')
      response.end(html.replace(marker, "createBuddy({ stage, renderer: 'svg', autoplay:"))
    } else response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

// Позиции отражаются без отражения букв. SVG хранит отражение внутри собственного DOM,
// поэтому точные копии и getScreenCTM получают одинаковую геометрию.
function mirrorFixture(face) {
  const slide = document.querySelector('.slide.on')
  globalThis.qaOriginalSlides ||= new Map()
  if (!qaOriginalSlides.has(slide)) qaOriginalSlides.set(slide, slide.innerHTML)
  else slide.innerHTML = qaOriginalSlides.get(slide)
  for (const [i, svg] of [...slide.querySelectorAll('[data-buddy-context="images"] > svg,[data-buddy-context="detail"] > svg')].entries()) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'), id = `qa-${slide.dataset.scene}-gradient-${i}`
    defs.innerHTML = `<linearGradient id="${id}"><stop stop-color="#d1e2ff"/><stop offset="1" stop-color="#c6e9df"/></linearGradient>`
    svg.prepend(defs); svg.querySelector('rect')?.setAttribute('fill', `url(#${id})`)
  }
  if (face > 0) return
  const stage = document.getElementById('stage').getBoundingClientRect(), scale = stage.width / 1280,
    roots = [...slide.querySelectorAll('[data-buddy-context]')].filter(el => !el.parentElement.closest('[data-buddy-context]'))
  for (const element of roots) {
    const box = element.getBoundingClientRect(), left = (box.left - stage.left) / scale,
      width = box.width / scale, dx = 1280 - 2 * left - width
    element.style.transform = `translateX(${dx}px)`
    const childSelector = element.matches('[data-buddy-context="bars"], [data-buddy-context="route"]')
      ? ':scope > [data-buddy-step]' : element.matches('[data-buddy-context="flow"]')
        ? ':scope > [data-buddy-node]' : element.matches('[data-buddy-context="values"], [data-buddy-context="images"]')
          ? ':scope > div, :scope > svg' : null
    const own = element.getBoundingClientRect(), children = childSelector
      ? [...element.querySelectorAll(childSelector)].map(child => ({ child, rect: child.getBoundingClientRect() })) : []
    for (const { child, rect: r } of children) {
      const x = (r.left - own.left) / scale, w = r.width / scale
      child.style.position = 'absolute'; child.style.left = (width - x - w) + 'px'
    }
    const svgs = element.tagName.toLowerCase() === 'svg' ? [element] : [...element.querySelectorAll(':scope > svg')]
    // Пары изображений сохраняют внутреннее устройство каждой картинки; переставляются целиком.
    if (!element.matches('[data-buddy-context="images"]')) for (const svg of svgs) {
      const view = svg.viewBox.baseVal, group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      for (const text of svg.querySelectorAll('text')) {
        const b = text.getBBox(); text.setAttribute('transform', `translate(${2 * b.x + b.width} 0) scale(-1 1)`)
      }
      group.setAttribute('transform', `translate(${2 * view.x + view.width} 0) scale(-1 1)`)
      while (svg.firstChild) group.append(svg.firstChild)
      svg.append(group)
    }
    for (const node of [element, ...element.querySelectorAll('[data-buddy-points], [data-buddy-crop]')]) {
      if (node.hasAttribute('data-buddy-points')) node.setAttribute('data-buddy-points', JSON.stringify(
        JSON.parse(node.getAttribute('data-buddy-points')).map(p => Array.isArray(p) ? [1280 - p[0], p[1]] : { ...p, x: 1280 - p.x })))
      if (node.hasAttribute('data-buddy-crop')) {
        const [x, y, w, h] = JSON.parse(node.getAttribute('data-buddy-crop'))
        node.setAttribute('data-buddy-crop', JSON.stringify([1280 - x - w, y, w, h]))
      }
    }
  }
}

function encoder(file) {
  const child = spawn(process.env.BUDDY_FFMPEG || '/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
  { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000) })
  child.stdin.on('error', () => {})
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg ${code}: ${stderr}`)))
  })
  // Не допускаем unhandled rejection, пока цикл ещё пишет кадры.
  closed.catch(() => {})
  return { write: buffer => new Promise((resolve, reject) => child.stdin.write(buffer, error => error ? reject(error) : resolve())),
    async close() { child.stdin.end(); await closed }, kill() { child.kill() } }
}

async function probeVideo(file) {
  const child = spawn(process.env.BUDDY_FFPROBE || '/opt/homebrew/bin/ffprobe', ['-v', 'error',
    '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_frames,duration',
    '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`FFprobe ${code}: ${stderr}`)))
  })
  return JSON.parse(stdout).streams[0]
}

async function nativeMediaProbe() {
  const stage = document.createElement('div')
  stage.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:720px;background:white;z-index:100'
  stage.innerHTML = `<section class="slide on" style="position:absolute;inset:0">
    <div data-buddy-context="images" style="position:absolute;left:200px;top:200px;width:800px;height:280px">
      ${['a', 'b'].map((id, i) => `<svg data-buddy-item="${id}" data-buddy-label="${id}" viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet" style="position:absolute;left:${i * 400}px;top:0;width:100px;height:80px;transform-origin:0 0;transform:scale(2,${i ? 3 : 2});fill:#315e48">
        <g transform="translate(7 3)"><rect data-copy-probe="${id}" x="20" y="15" width="40" height="50"/></g></svg>`).join('')}
    </div></section>`
  document.body.appendChild(stage)
  let actor
  try {
    actor = await qaModule.createBuddy({ stage, renderer: 'svg', autoplay: false, reactions: false,
      motion: 'full', seed: 14, presets: { superhuman: true } })
    actor.progress(1); actor.pause(); actor.rescan()
    const fact = actor.context().facts.find(fact => fact.kind === 'images')
    if (!fact) throw new Error('SVG regression: источник не найден')
    actor.selectContext(fact.id)
    const before = stage.querySelector('.slide').innerHTML
    if (!actor.play('showBeforeAfter')) throw new Error('SVG regression: пара не запущена')
    for (let i = 0; i < 1800 && actor.state().act !== 'showBeforeAfter'; i++) actor.step(1 / 60)
    actor.step(4)
    const ratio = (shape, svg) => {
      // У вложенного SVG getBoundingClientRect возвращает bbox содержимого.
      // Рамку viewport восстанавливаем из viewBox внешнего wrapper и его CTM.
      const viewportBox = () => {
        const wrapper = svg.parentNode, box = wrapper.viewBox.baseVal, matrix = wrapper.getScreenCTM(),
          a = new DOMPoint(box.x, box.y).matrixTransform(matrix),
          b = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix)
        return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
      }, a = shape.getBoundingClientRect(), b = svg.ownerSVGElement ? viewportBox() : svg.getBoundingClientRect()
      return [(a.x - b.x) / b.width, (a.y - b.y) / b.height, a.width / b.width, a.height / b.height]
    }, rows = ['a', 'b'].map(id => {
      const source = stage.querySelector(`.slide [data-buddy-item="${id}"]`),
        copy = stage.querySelector(`[data-buddy-story-layer] [data-copy-probe="${id}"]`), clone = copy?.ownerSVGElement
      if (!copy || !clone) throw new Error('SVG regression: нет копии ' + id)
      const original = ratio(source.querySelector('rect'), source), copied = ratio(copy, clone)
      clone.style.setProperty('transform', 'scale(2)', 'important')
      const doubleScaled = ratio(copy, clone)
      clone.style.setProperty('transform', 'none', 'important')
      return { id, original, copied, doubleScaled,
        transform: getComputedStyle(clone).transform, paint: getComputedStyle(copy).fill,
        childTransform: copy.parentNode.getAttribute('transform') }
    })
    actor.reset()
    const after = stage.querySelector('.slide').innerHTML, unchanged = after === before, reasons = []
    for (const transform of ['rotate(15deg)', 'skewX(10deg)', 'scale(-1,1)']) {
      stage.querySelector('.slide svg').style.transform = transform
      actor.rescan(); reasons.push({ transform, reason: actor.can('showBeforeAfter') })
    }
    return { rows, unchanged, reasons, ...(unchanged ? {} : { before, after }) }
  } finally { actor?.destroy(); stage.remove() }
}

function sampleScene() {
  const layer = document.querySelector('[data-buddy-story-layer]'), state = buddy.state(), framing = buddy.framing(),
    cursor = layer?.querySelector('circle[r="5"],circle[r="9"]'), stage = document.getElementById('stage'),
    matrix = new DOMMatrix(getComputedStyle(stage).transform), scale = Math.hypot(matrix.a, matrix.b),
    stageBox = stage.getBoundingClientRect(), viewport = document.getElementById('viewport').getBoundingClientRect(), textRuns = []
  for (const element of layer?.querySelectorAll('text') || []) {
    const box = element.getBoundingClientRect(), css = getComputedStyle(element), ctm = element.getScreenCTM()
    let opacity = Number(css.fillOpacity), hidden = false
    for (let node = element; node && node !== stage.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node)
      opacity *= Number(style.opacity)
      if (style.display === 'none' || style.visibility === 'hidden') hidden = true
    }
    const width = Math.max(0, Math.min(box.right, viewport.right) - Math.max(box.left, viewport.left)),
      height = Math.max(0, Math.min(box.bottom, viewport.bottom) - Math.max(box.top, viewport.top)),
      fraction = box.width * box.height > 0 ? width * height / (box.width * box.height) : 0
    if (!hidden && opacity >= .1 && width >= 1 && height >= 1 && element.textContent) textRuns.push({
      text: element.textContent, opacity, visibleFraction: Math.min(1, fraction),
      cssFontPx: parseFloat(css.fontSize) * (ctm ? Math.hypot(ctm.c, ctm.d) : 0),
      box: [box.left - viewport.left, box.top - viewport.top, box.right - viewport.left, box.bottom - viewport.top]
    })
  }
  function fits(bounds) {
    if (!bounds) return true
    const box = [stageBox.left + bounds[0] * scale, stageBox.top + bounds[1] * scale,
      stageBox.left + bounds[2] * scale, stageBox.top + bounds[3] * scale]
    return box[0] >= viewport.left - 1 && box[1] >= viewport.top - 1
      && box[2] <= viewport.right + 1 && box[3] <= viewport.bottom + 1
  }
  return { state, t: buddy.experimental.B.act.t, face: buddy.experimental.B.face, framing, scale,
    actorCssHeight: (framing.actor[3] - framing.actor[1]) * scale,
    fits: { actor: fits(framing.actor), detail: fits(framing.detail) },
    phase: layer?.getAttribute('data-story-phase'), layers: document.querySelectorAll('[data-buddy-story-layer],[data-buddy-context-layer]').length,
    texts: textRuns.map(run => run.text), textRuns,
    cursor: cursor ? { x: Number(cursor.getAttribute('cx')), y: Number(cursor.getAttribute('cy')),
      opacity: Number(cursor.getAttribute('opacity')) } : null,
    clip: document.querySelector('#stage > .buddy').style.clipPath }
}

let browser
const check = async (name, run) => {
  try { const detail = await run(); report.checks.push({ name, pass: true, detail }); console.log('PASS ' + name) }
  catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message) }
}
try {
  browser = await openBrowser({ width: 1440, height: 1100, dpr: Number(process.env.BUDDY_DPR || 1) })
  const ev = browser.evaluate,
    choose = async (id, value) => {
      await ev(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`)
      await browser.sleep(100)
    }, prepare = async (id, face = 1) => {
      const [scene, kind] = scenes[id]
      await choose('scene', scene)
      await ev(`(${mirrorFixture.toString()})(${face});buddy.pause();buddy.reset();buddy.progress(1);buddy.experimental.B.face=${face};buddy.rescan();document.querySelector('#stage > .buddy').style.clipPath='inset(0px)'`)
      const fact = await ev(`buddy.context().facts.find(f=>f.kind===${JSON.stringify(kind)})`)
      assert.ok(fact, 'Найден источник ' + kind)
      let found = false
      for (let i = 0; i < 40; i++) {
        found = await ev(`[...document.getElementById('contextSource').options].some(o=>o.value===${JSON.stringify(fact.id)})`)
        if (found) break
        await browser.sleep(50)
      }
      assert.ok(found, 'Выбор источника появился в UI')
      await choose('contextSource', fact.id)
      assert.equal(await ev('buddy.context().selectedId'), fact.id)
      const signature = await ev(`JSON.stringify([document.querySelector('.slide.on').innerHTML,[...document.querySelectorAll('.slide.on input')].map(e=>e.checked)])`)
      await browser.click(`[data-id="${id}"]`); await ev('buddy.pause()')
      const entered = await ev(`(() => {const seen=[];for(let i=0;i<1800;i++){const s=buddy.state();if(!seen.includes(s.act))seen.push(s.act);if(s.act===${JSON.stringify(id)})return {reached:true,seen,face:buddy.experimental.B.face};buddy.step(1/60)}return {reached:false,seen,state:buddy.state(),status:document.getElementById('status').textContent}})()`)
      assert.ok(entered.reached, JSON.stringify(entered))
      await browser.click('#autoFrame'); await ev(`document.getElementById('viewport').scrollIntoView({block:'center'})`)
      await browser.sleep(450)
      return { fact, signature, entered }
    }, sample = () => ev(`(${sampleScene.toString()})()`),
    clip = () => ev(`(() => {const r=document.getElementById('viewport').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:Math.floor(r.width/2)*2,height:Math.floor(r.height/2)*2,scale:1}})()`),
    capture = async rectangle => Buffer.from((await browser.send('Page.captureScreenshot',
      { format: 'jpeg', quality: 85, captureBeyondViewport: true, clip: rectangle })).data, 'base64')
  await browser.navigate(`http://127.0.0.1:${server.address().port}`)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  assert.equal(await ev('!!globalThis.buddy'), true)
  await ev(`globalThis.qaModule=await import('./index.js');buddy.pause()`)
  report.browser = await ev('navigator.userAgent')
  report.devicePixelRatio = await ev('devicePixelRatio')
  report.renderer = await ev('buddy.renderer')
  report.testOverrides = svgOnly ? { renderer: 'svg' } : {}
  if (svgOnly) assert.equal(report.renderer, 'svg')
  const metadata = await ev(`qaModule.techniques.filter(t=>${JSON.stringify(ids)}.includes(t.id)).map(t=>({id:t.id,duration:t.duration,kinds:t.contextKinds,tags:t.tags}))`)
  await choose('group', 'Slide context')
  await check('Десять различных историй есть в метаданных и каталоге', async () => {
    assert.deepEqual(metadata.map(t => t.id).sort(), [...ids].sort())
    assert.ok(metadata.every(t => t.kinds.length && t.tags.includes('context')))
    assert.equal(await ev(`${JSON.stringify(ids)}.every(id=>document.querySelector('[data-id="'+id+'"]'))`), true)
    return metadata
  })
  for (const face of [1, -1]) for (const id of onlyMedia ? [] : ids) await check(`${id}: полный цикл, сторона ${face}`, async () => {
    const source = await prepare(id, face), duration = metadata.find(t => t.id === id).duration,
      row = { id, face, ...source, duration, frames: [], closeups: [], overviews: [], observed: [], video: video ? `${id}-${face}.mp4` : null },
      edges = source.fact.structure?.edges?.length || 1,
      holds = id === 'traceFlow' ? edges === 1 ? [2 + (duration - 4.4) * .35, 2 + (duration - 4.4) * .55]
        : [2 + (duration - 4.4) * .4 / edges, 2 + (duration - 4.4) * (edges - .6) / edges]
        : [duration * .45, duration * .7],
      rectangle = await clip(), important = [...new Set([.5, 2, ...holds, duration - .75, duration + .6])],
      movie = video ? encoder(join(output, row.video)) : null
    report.cycles.push(row)
    try {
      const total = Math.ceil((duration + .6) * fps), ticks = video ? Array.from({ length: total + 1 }, (_, i) => i)
        : important.map(time => Math.round(time * fps))
      let previous = 0
      for (const tick of ticks) {
        const time = tick / fps
        await ev(`buddy.step(${Math.max(0, time - previous)})`); previous = time
        const detail = await sample()
        assert.ok([detail.state.x, detail.state.y, ...detail.framing.actor].every(Number.isFinite))
        if (!row.observed.includes(detail.state.act)) row.observed.push(detail.state.act)
        const keyframe = !video || tick % 12 === 0 || important.some(t => Math.round(t * fps) === tick)
        let buffer
        if (movie || keyframe) buffer = await capture(rectangle)
        if (movie) await movie.write(buffer)
        if (keyframe) {
          const duplicates = await ev(`(() => {const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.filter((id,i)=>ids.indexOf(id)!==i)})()`)
          assert.deepEqual(duplicates, [], 'Копии SVG имеют собственные ID даже при активных gradient defs')
          const file = `${id}-${face}-${String(tick).padStart(4, '0')}.jpg`
          await writeFile(join(output, file), buffer); row.frames.push({ time, image: file, ...detail })
          if (!video && holds.some(time => Math.round(time * fps) === tick)) {
            if (tick === Math.round(holds[0] * fps)) {
              await browser.click('#overview'); await browser.sleep(500)
              const overview = await sample(), file = `${id}-${face}-overview.jpg`
              await writeFile(join(output, file), await capture(rectangle))
              row.overviews.push({ time, image: file, ...overview })
            }
            await browser.click('#zoom'); await browser.sleep(500)
            const closeup = await sample(), closeFile = `${id}-${face}-${tick}-closeup.jpg`
            await writeFile(join(output, closeFile), await capture(rectangle))
            row.closeups.push({ time, image: closeFile, ...closeup })
            assert.ok(closeup.fits.actor, 'Крупный план не обрезает персонажа')
            assert.ok(closeup.fits.detail, 'Крупный план не обрезает текущую проекцию')
            await browser.click('#autoFrame'); await browser.sleep(450)
          }
        }
      }
      await movie?.close()
      if (movie) {
        row.probe = await probeVideo(join(output, row.video))
        assert.equal(row.probe.avg_frame_rate, '24/1')
        assert.equal(Number(row.probe.nb_frames), total + 1, 'Закодированы все кадры полного цикла')
      }
    } catch (error) { movie?.kill(); throw error }
    const ended = await sample()
    assert.notEqual(ended.state.act, id, 'История конечна')
    assert.equal(ended.layers, 0, 'Собственные слои очищены')
    assert.equal(ended.clip, 'inset(0px)')
    assert.equal(await ev(`JSON.stringify([document.querySelector('.slide.on').innerHTML,[...document.querySelectorAll('.slide.on input')].map(e=>e.checked)])`), source.signature,
      'Источник и его отметки остались прежними')
    const hold = row.frames.filter(frame => ['read', 'hold'].includes(frame.phase)),
      heldTexts = hold.flatMap(frame => frame.textRuns), expected = ['thinkKeyword', 'quoteIdea'].includes(id) ? [source.fact.text]
        : id === 'compareValues' ? source.fact.structure.items.flatMap(item => [item.value, item.label].filter(Boolean))
          : ['assembleList', 'showBeforeAfter'].includes(id) ? source.fact.structure.items.map(item => item.label || item.text) : []
    assert.ok(hold.length >= 2, 'Сняты минимум две фазы удержания/чтения')
    if (id === 'traceFlow' || id === 'followChart') assert.ok(hold.some(frame => frame.cursor?.opacity > .5),
      'В фазе чтения действительно виден световой курсор')
    for (const text of expected) {
      assert.ok(heldTexts.some(run => run.text === text && run.visibleFraction >= .98), 'Точный текст действительно видим на удержании: ' + text)
      assert.ok(heldTexts.some(run => run.text === text && run.cssFontPx >= 12 && run.visibleFraction >= .98),
        'Текст проекции читается в общем плане (не менее 12 CSS px): ' + text)
      if (!video) assert.ok(row.closeups.flatMap(frame => frame.textRuns).some(run => run.text === text
        && run.visibleFraction >= .98 && run.cssFontPx >= 14), 'Текст полностью виден в крупном плане (не менее 14 CSS px): ' + text)
    }
    const duplicateIds = await ev(`(() => {const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.filter((id,i)=>ids.indexOf(id)!==i)})()`)
    assert.deepEqual(duplicateIds, [])
    await ev('buddy.reset();buddy.pause()')
    return { duration, keyframes: row.frames.length, observed: row.observed, video: row.video }
  })
  for (const operation of onlyMedia ? [] : ['reset', 'interrupt', 'slidechange']) await check('Очистка новой истории: ' + operation, async () => {
    await prepare('quoteIdea'); await ev('buddy.step(3)')
    assert.ok((await sample()).layers > 0)
    if (operation === 'reset') await ev('buddy.reset()')
    if (operation === 'interrupt') await ev(`buddy.sequence(['wave']);buddy.step(1/60)`)
    if (operation === 'slidechange') await choose('scene', 'numbers')
    assert.equal((await sample()).layers, 0)
  })
  await check('SVG: масштаб применяется один раз, letterboxing и дочерняя геометрия сохранены', async () => {
    const result = await ev(`await (${nativeMediaProbe.toString()})()`)
    assert.ok(result.unchanged, JSON.stringify(result))
    for (const row of result.rows) {
      assert.ok(row.original.every((value, i) => Math.abs(value - row.copied[i]) < .001), JSON.stringify(row))
      assert.ok(row.original.some((value, i) => Math.abs(value - row.doubleScaled[i]) > .1), 'Проверка выявляет повторное масштабирование')
      assert.equal(row.transform, 'none'); assert.equal(row.childTransform, 'translate(7 3)')
      assert.equal(row.paint, 'rgb(49, 94, 72)')
    }
    assert.ok(result.reasons.every(row => row.reason), JSON.stringify(result.reasons))
    return result
  })
  if (!onlyMedia && process.env.BUDDY_SKIP_PERF !== '1') for (const id of Object.keys(scenes))
    await check('Активные шаги с rAF: ' + id, async () => {
      await prepare(id); await ev('buddy.step(Math.max(0,2-buddy.experimental.B.act.t))')
      const result = await ev(`globalThis.qaPerf=await (async()=>{const rows=[],before=buddy.metrics();let previous=null;for(let i=0;i<120;i++){const stamp=await new Promise(resolve=>requestAnimationFrame(resolve)),start=performance.now();buddy.step(1/60);rows.push({cpuMs:performance.now()-start,intervalMs:previous===null?null:stamp-previous,act:buddy.state().act});previous=stamp}const summary=xs=>{const sorted=[...xs].sort((a,b)=>a-b);return {count:xs.length,p95:sorted[Math.floor((sorted.length-1)*.95)],max:Math.max(...xs)}};return {before,after:buddy.metrics(),cpuMs:summary(rows.map(r=>r.cpuMs)),rafIntervalMs:summary(rows.map(r=>r.intervalMs).filter(x=>x!==null)),rows}})();qaPerf`)
      assert.ok(result.rows.every(row => row.act === id))
      assert.equal(result.after.canvasResizes, result.before.canvasResizes, 'Активная фаза не перевыделяет WebGL-буфер')
      if (!svgOnly) {
        assert.ok(result.after.drawingBufferRatio >= Math.min(6, result.after.screenRatio) - .01, 'Разрешение соответствует общему пределу рендерера')
        assert.ok(Math.abs(result.after.outlineScreenPx - 1.25) < .01, 'Экранный контур не утолщается от зума')
      }
      report.performance.push({ id, baseline: !ids.includes(id), ...result }); return { cpuMs: result.cpuMs, rafIntervalMs: result.rafIntervalMs }
    })
  await check('Нет браузерных ошибок', () => {
    assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, [])
  })
} catch (error) { report.errors.push(error.stack) }
finally {
  report.pass = !report.errors.length && report.checks.every(c => c.pass)
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  const rows = report.cycles.map((row, i) => `<section><h2>B${String(i + 1).padStart(2, '0')}</h2>${row.video ? `<video controls preload="none" src="${row.video}"></video>` : ''}<div>${[...row.frames, ...row.overviews, ...row.closeups].map(f => `<figure><img loading="lazy" src="${f.image}" alt="Фаза ${f.time.toFixed(2)} с"><figcaption>${f.image.includes('closeup') ? 'Крупный план · ' : f.image.includes('overview') ? 'Весь слайд · ' : ''}${f.time.toFixed(2)} с · ${f.actorCssHeight.toFixed(1)} CSS px</figcaption></figure>`).join('')}</div></section>`).join('')
  await writeFile(join(output, 'cycles.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Бадди · полные циклы</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='8' cy='8' r='7' fill='%2329be79'/%3E%3C/svg%3E"><style>body{font:16px system-ui;margin:24px;color:#20252f;background:#fff}section{margin:32px 0}section>div{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}img,video{display:block;width:100%}video{max-width:1100px;margin-bottom:16px}figcaption{margin-top:8px}@media(max-width:768px){section>div{grid-template-columns:1fr 1fr}}</style><h1>Контекстные истории</h1><p>${video ? 'Полные модельные циклы, 24 кадра в секунду. Это не измерение производительности рендерера.' : 'Ключевые кадры; полный видеоцикл в этом прогоне не записывался.'} Названия скрыты; соответствия — в report.json.</p>${rows}</html>`)
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
if (!report.pass) process.exitCode = 1

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/defaults-0.8.1/browser')),
  report = { checks: [], runs: [], limits: 'Первые 3 секунды — реальные rAF; длинные циклы — модельное время 60 Гц, не замер FPS.' },
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/fixture') {
        const count = Number(url.searchParams.get('slides') || 1)
        assert.ok([1, 3, 6].includes(count))
        response.setHeader('Content-Type', 'text/html')
        response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><style>body{margin:0;background:white}#stage{position:relative;width:1280px;height:720px}.slide{display:none;position:absolute;inset:0}.slide.on{display:block}h1{margin:40px;font:40px Arial}</style><div id="stage">${Array.from({ length: count }, (_, i) => `<section class="slide${i ? '' : ' on'}"><h1>Глава ${i + 1}</h1></section>`).join('')}</div><script type="module">import {createBuddy} from '/index.js';globalThis.buddy=await createBuddy({stage:document.getElementById('stage')})</script></html>`)
        return
      }
      const file = resolve(root, '.' + decodeURIComponent(url.pathname))
      if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return }
      response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'text/html')
      response.end(await readFile(file))
    } catch { response.writeHead(404).end() }
  })
await mkdir(output, { recursive: true })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await openBrowser({ width: 1280, height: 720, dpr: 1 })
  const ev = browser.evaluate, base = `http://127.0.0.1:${server.address().port}`
  for (const count of [1, 3, 6]) {
    await browser.navigate(`${base}/fixture?slides=${count}`)
    for (let n = 0; n < 200 && !await ev('!!globalThis.buddy'); n++) await browser.sleep(25)
    assert.deepEqual(await ev('[buddy.mode,buddy.profile,buddy.state().autonomous,buddy.paused,buddy.renderer]'), ['show', 'show', true, false, 'webgl'])
    await browser.sleep(3000)
    assert.ok(await ev('buddy.state().time') > 1, 'Время движется без resume/play')
    await ev('buddy.pause()')
    const run = { count, slides: [] }
    report.runs.push(run)
    for (let index = 0; index < count; index++) {
      if (index) {
        await ev(`document.querySelectorAll('.slide').forEach((node,i)=>node.classList.toggle('on',i===${index}))`)
        await browser.sleep(20)
        await ev('buddy.rescan()')
      }
      const row = await ev(`(()=>{const raw=buddy.experimental,B=raw.B,actions=new Set(),gaps=[];let last=B.lastPower;for(let i=0;i<${count === 1 ? 90 : 35}*60;i++){buddy.step(1/60);actions.add(B.act.name);if(B.lastPower!==last){last=B.lastPower;gaps.push(B.nextPower-last)}}return {index:raw.W.idx,progress:raw.W.progress,level:raw.W.li,actions:[...actions],gaps,state:buddy.state()}})()`)
      assert.equal(row.index, index)
      assert.ok(row.actions.length > 1, JSON.stringify(row))
      assert.ok(!row.actions.includes('nap') && !row.actions.includes('yawn'))
      if (index > 0 || count === 1) assert.ok(row.gaps.length > 0, JSON.stringify(row))
      if (count > 1 && index === 0) assert.equal(row.gaps.length, 0, 'На первом слайде пока только жесты и движение')
      run.slides.push(row)
      await browser.screenshot(join(output, `deck-${count}-slide-${index}.png`))
    }
    if (count === 6) assert.ok(Math.max(...run.slides.at(-1).gaps) < Math.min(...run.slides[1].gaps))
    report.checks.push(`Дека ${count}: запуск без настроек, смены слайдов и самостоятельный репертуар`)
  }
  assert.deepEqual(browser.exceptions, [])
  assert.deepEqual(browser.consoleErrors, [])
} catch (error) { report.error = error.stack; throw error }
finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
console.log(JSON.stringify({ checks: report.checks, output }))

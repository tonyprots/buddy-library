import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(root, process.env.BUDDY_REPORT_DIR || 'drafts/concept-variants/native'),
  sourceRoot = join(output, 'sources'), hash = value => createHash('sha256').update(value).digest('hex'),
  concepts = ['memory', 'target', 'team', 'chain', 'link', 'cloud', 'rules', 'search'],
  files = [...(await readdir(root)).filter(name => /\.(?:js|html|json|d\.ts)$/u.test(name)),
    ...(await readdir(join(root, 'presets'))).filter(name => name.endsWith('.js')).map(name => 'presets/' + name),
    'tests/browser/concept-variants-browser-check.mjs', 'tests/browser/cdp.mjs'],
  sources = new Map(await Promise.all(files.map(async name => [name, await readFile(join(root, name))]))),
  html = sources.get('index.html').toString().replace('if (buddy && !switching) {',
    'if (buddy && !switching && !globalThis.qaCameraFrozen) {'),
  report = { created: new Date().toISOString(), cycles: [], checks: [], errors: [], limits: [
    'PNG — отдельные grow/hold/fade кадры, не непрерывный просмотр.',
    'Тестовый крупный план ограничен CSS scale3.75; точная плотность и ограничения буфера записаны для каждого PNG.',
    'Native rAF/CPU измерены отдельно от снимков, по полному циклу каждой формы. GPU-time не измерен.'
  ] }
assert.ok(output.startsWith(join(root, 'drafts') + sep))
assert.notEqual(html, sources.get('index.html').toString(), 'Известная точка управления камерой')
sources.set('served-index.html', Buffer.from(html))
await mkdir(sourceRoot, { recursive: true })
for (const [name, data] of sources) {
  await mkdir(dirname(join(sourceRoot, name)), { recursive: true })
  await writeFile(join(sourceRoot, name), data, { flag: 'wx' })
}
report.hashes = Object.fromEntries([...sources].map(([name, data]) => [name, hash(data)]))
report.snapshotId = hash(JSON.stringify(report.hashes))
await writeFile(join(output, 'source-manifest.json'), JSON.stringify({ snapshotId: report.snapshotId, hashes: report.hashes }, null, 2), { flag: 'wx' })
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname),
      file = resolve(sourceRoot, pathname === '/' ? 'served-index.html' : '.' + pathname)
    if (!file.startsWith(sourceRoot + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.html' ? 'text/html' : 'application/json')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await openBrowser({ width: 1440, height: 1100, dpr: 2 })
  const ev = browser.evaluate, settle = () => ev('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),
    choose = async (id, value) => {
      await ev(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`)
      await settle()
    },
    launch = async face => ev(`(() => {
      buddy.pause();buddy.reset();buddy.progress(1);buddy.rescan();
      const fact=buddy.context().facts.find(f=>f.kind==='keyword'),b=buddy.experimental.B;
      if(!fact)throw Error('Нет понятия');buddy.selectContext(fact.id);
      b.face=${face};b.x=${face > 0 ? 639 : 641};b.cam=.4;b.yaw=${face > 0 ? '.4*Math.PI/2' : 'Math.PI-.4*Math.PI/2'};b.yawV=0;
      const before=performance.now();buddy.play('hologramKeyword');buddy.pause();
      return{fact,launchMs:performance.now()-before,state:buddy.state()};
    })()`)
  await browser.navigate(`http://127.0.0.1:${server.address().port}/`)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  assert.equal(await ev('!!globalThis.buddy'), true)
  await ev('await document.fonts.ready;globalThis.qaCameraFrozen=true')
  report.browser = await ev('navigator.userAgent')
  const icon = await ev(`new DOMParser().parseFromString(decodeURIComponent(document.querySelector('link[rel=icon]').href.split(',')[1]),'image/svg+xml').documentElement.localName`)
  assert.equal(icon, 'svg')
  await choose('group', 'Контекст слайда'); await choose('scene', 'context-keywords')
  for (const concept of concepts) for (const face of [-1, 1]) {
    const row = { concept, face, frames: [] }
    report.cycles.push(row)
    try {
      await choose('contextConcept', concept)
      row.launch = await launch(face)
      assert.equal(row.launch.fact.concept, concept); assert.equal(row.launch.state.act, 'hologramKeyword')
      for (const [phase, at] of [['grow', 2.6], ['hold', 4], ['fade', 6.6]]) {
        await ev(`buddy.step(Math.max(0,${at}-buddy.experimental.B.act.t),120)`)
        for (const mode of ['overview', 'closeup']) {
          const detail = await ev(`(() => {
            const stage=document.getElementById('stage'),view=document.getElementById('viewport'),f=buddy.framing(),
              bounds=[f.actor,f.props,f.detail].filter(Boolean),box=[Math.min(...bounds.map(b=>b[0])),Math.min(...bounds.map(b=>b[1])),Math.max(...bounds.map(b=>b[2])),Math.max(...bounds.map(b=>b[3]))],
              scale=${mode === 'overview' ? '.75' : 'Math.min(3.75,(view.clientWidth-32)/(box[2]-box[0]),(view.clientHeight-32)/(box[3]-box[1]))'};
            stage.style.transformOrigin='0 0';stage.style.transform='translate('+(view.clientWidth/2-(box[0]+box[2])/2*scale)+'px,'+(view.clientHeight/2-(box[1]+box[3])/2*scale)+'px) scale('+scale+')';
            view.scrollIntoView({block:'center'});return{scale,bounds:box,state:buddy.state(),time:buddy.experimental.B.act.t,face:buddy.experimental.B.face};
          })()`)
          await settle()
          const sample = await ev(`(() => {
            const cv=document.querySelector('.buddy canvas'),r=cv.getBoundingClientRect(),v=document.getElementById('viewport').getBoundingClientRect(),
              labels=[...document.querySelectorAll('[data-buddy-context-layer] text')].filter(e=>e.getBoundingClientRect().width>1);
            return{metrics:buddy.metrics(),time:buddy.experimental.B.act.t,face:buddy.experimental.B.face,
              canvas:{width:cv.width,height:cv.height,display:[r.width,r.height],density:[cv.width/r.width,cv.height/r.height]},
              labels:labels.map(e=>({text:e.textContent,inside:(()=>{const r=e.getBoundingClientRect();return r.left>=v.left-1&&r.top>=v.top-1&&r.right<=v.right+1&&r.bottom<=v.bottom+1})()})),
              clip:{x:v.left+scrollX,y:v.top+scrollY,width:v.width,height:v.height,scale:1}};
          })()`), file = `${concept}-${face < 0 ? 'left' : 'right'}-${phase}-${mode}.png`,
            data = Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: sample.clip })).data, 'base64')
          await writeFile(join(output, file), data, { flag: 'wx' })
          row.frames.push({ phase, mode, file, sha: hash(data), ...detail, ...sample })
          assert.equal(sample.time, detail.time, 'Камера не двигает часы')
          assert.equal(sample.face, face, 'Показана нужная сторона')
          assert.ok(sample.labels.some(label => label.text === row.launch.fact.text))
          assert.ok(sample.labels.every(label => label.inside), 'Подпись целиком в кадре')
        }
      }
      row.performanceLaunch = await launch(face)
      row.performance = await ev(`await (async()=>{
        const rows=[],before=buddy.metrics();let previous=null;
        for(let i=0;i<540;i++){
          const stamp=await new Promise(requestAnimationFrame),start=performance.now();buddy.step(1/60,120);
          const cpuMs=performance.now()-start;rows.push({cpuMs,intervalMs:previous===null?null:stamp-previous,action:buddy.state().act,time:buddy.experimental.B.act.t,metrics:buddy.metrics()});previous=stamp;
          if(i>30&&buddy.state().act==='idle')break;
        }
        return{before,after:buddy.metrics(),rows,state:buddy.state()};
      })()`)
      assert.equal(row.performance.state.act, 'idle')
      const clean = await ev(`({layers:document.querySelectorAll('[data-buddy-context-layer]').length,fx:buddy.state().fx,queue:buddy.state().queue})`)
      assert.deepEqual(clean, { layers: 0, fx: 0, queue: 0 }); row.cleanup = clean; row.pass = true
      console.log('PASS concept ' + concept + ':' + face)
    } catch (error) { row.pass = false; row.error = error.stack; report.errors.push({ concept, face, error: error.stack }); console.log('FAIL concept ' + concept + ':' + face + ': ' + error.message) }
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  }
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, [])
} catch (error) { report.errors.push({ fatal: error.stack }) }
finally {
  report.pass = !report.errors.length; report.finished = new Date().toISOString()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
if (!report.pass) process.exitCode = 1

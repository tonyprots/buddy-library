import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/endings-v3')),
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
let browser
try {
  browser = await openBrowser({ width: 1280, height: 1000, dpr: 1 })
  const ev = browser.evaluate
  await browser.navigate(base)
  for(let i=0;i<200&&!await ev('!!globalThis.buddy');i++)await browser.sleep(50)
  const cases={starcatch:[1,1.9,4.9,5.5,6,6.6],forcePush:[1,2,3,4,4.7,5.2],comet:[1.55,3,4.6,5.4,5.7,6.5],celebrate:[1.5,2.5,3.5,4.6,5.1,5.65],timeBubble:[1,2,4.8,5.3,6,6.7]}
  for(const [id,times] of Object.entries(cases))for(const face of [1,-1]){
    await ev(`buddy.reset();buddy.pause();buddy.progress(1);buddy.experimental.seed(14);buddy.experimental.B.face=${face};buddy.play('${id}');buddy.pause()`)
    let previous=0
    const shots=[]
    for(const time of times){
      await ev(`buddy.step(${time-previous})`);previous=time
      await browser.sleep(160)
      const clip=await ev(`(()=>{const e=document.getElementById('viewport');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`),
        screenshot=await browser.send('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true}),name=id+'-'+face+'-'+time+'.png'
      await writeFile(join(output,name),Buffer.from(screenshot.data,'base64'))
      shots.push({time,name,state:await ev('buddy.state()'),framing:await ev('buddy.framing()')})
    }
    report.checks.push({id,face,shots});console.log(id+' '+face)
  }
  assert.equal(browser.exceptions.length,0,JSON.stringify(browser.exceptions))
  assert.equal(browser.consoleErrors.length,0,JSON.stringify(browser.consoleErrors))
} catch(error){report.error=error.stack;throw error}
finally{await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve))}

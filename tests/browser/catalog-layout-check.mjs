import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/catalog-layout')),
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
  browser = await openBrowser()
  await browser.navigate(base)
  for (let i=0;i<100&&!await browser.evaluate('!!globalThis.buddy');i++) await browser.sleep(50)
  for (const width of [1440,1024,768,320]) {
    await browser.metrics(width,1000,1);await browser.sleep(120)
    const rows=await browser.evaluate(`(()=>{const list=document.getElementById('list');return [...list.querySelectorAll('button')].map(button=>{const r=button.getBoundingClientRect(),code=button.querySelector('small'),c=code.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button.firstChild);const title=range.getBoundingClientRect();return {id:button.dataset.id,top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,titleBottom:title.bottom-r.top,codeVisible:getComputedStyle(code).display!=='none',codeBottom:c.bottom-r.top,codeGap:c.top-title.bottom,scroll:button.scrollWidth,width:button.clientWidth}})})()`)
    report.checks.push({width,rows})
    await browser.screenshot(join(output,`catalog-${width}.png`))
    assert.ok(rows.every(r=>r.height>=44&&r.titleBottom<=r.height-7.5),JSON.stringify({width,bad:rows.filter(r=>r.titleBottom>r.height-7.5).slice(0,5)}))
    assert.ok(rows.filter(r=>r.codeVisible).every(r=>r.codeBottom<=r.height-7.5&&r.codeGap>=7.5),JSON.stringify({width,bad:rows.filter(r=>r.codeVisible&&(r.codeBottom>r.height-7.5||r.codeGap<7.5)).slice(0,5)}))
    assert.ok(rows.every(r=>r.scroll<=r.width+1))
    const gaps=rows.slice(1).map((b,i)=>{const a=rows[i];return b.top>=a.bottom-1?b.top-a.bottom:b.left>=a.right-1?b.left-a.right:null}).filter(g=>g!==null)
    assert.ok(gaps.every(g=>g>=7.5),JSON.stringify({width,gaps}))
    if(width===1440){const clip=await browser.evaluate(`(()=>{const r=document.getElementById('list').getBoundingClientRect(),s=document.querySelector('#list .selected').getBoundingClientRect(),y=Math.max(r.y,s.y-150);return {x:r.x,y,width:r.width,height:Math.min(300,r.bottom-y),scale:1}})()`),shot=await browser.send('Page.captureScreenshot',{format:'png',clip});await writeFile(join(output,'catalog-detail.png'),Buffer.from(shot.data,'base64'))}
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),true)
    console.log('PASS '+width+': '+rows.length+' buttons')
  }
  assert.equal(browser.exceptions.length,0)
} catch(error){report.error=error.stack;throw error}
finally{await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve))}

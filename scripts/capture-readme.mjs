// Capture real runtime excerpts at 20fps. Run from the repository root.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openBrowser } from '../tests/browser/cdp.mjs'
const output = resolve(process.argv[2] || 'drafts/readme-capture'), b = await openBrowser({width:960,height:540,dpr:1})
await mkdir(output, {recursive:true})
const frames = []
try {
  await b.navigate(pathToFileURL(resolve('examples/showcase.html')).href + '?capture')
  for(let i=0;i<200&&!await b.evaluate('!!window.buddy');i++) await b.sleep(50)
  assert(await b.evaluate('!!window.buddy'))
  for(let frame=0;frame<740;frame++) {
    await b.evaluate('for(let j=0;j<3;j++) buddy.step(1/60)')
    const t=(frame+1)/20, shot=t<=1.5?'wide':t>=2&&t<=12.3?'climb':t>=24.5&&t<=32?'magnet':t>=34.5&&t<=36.5?'end':null
    if(!shot) continue
    // Camera changes preserve the slide and character geometry; only crop/scale changes.
    const transform=shot==='wide'?'scale(.75)':shot==='climb'?'translate(-690px,-770px) scale(1.8)':shot==='magnet'?'translate(-230px,-410px) scale(1.3)':'scale(.75)'
    await b.evaluate(`document.getElementById('stage').style.transform=${JSON.stringify(transform)}; buddy.step(0)`)
    await b.screenshot(resolve(output, `frame-${String(frames.length).padStart(4,'0')}.png`))
    frames.push({time:t,shot})
    if(frames.length%80===0) console.log(`${frames.length} frames`)
  }
  const result=await b.evaluate('({result:demoResult,state:buddy.state(),sourceOpacity:getComputedStyle(document.querySelector(".idea")).opacity})')
  assert.equal(result.result.status,'completed')
  assert.equal(result.sourceOpacity,'1')
  assert.equal(b.exceptions.length,0); assert.equal(b.consoleErrors.length,0)
  await writeFile(resolve(output,'capture.json'),JSON.stringify({fps:20,frames,result},null,2))
  console.log(JSON.stringify({frames:frames.length,result:result.result}))
} finally { await b.close() }

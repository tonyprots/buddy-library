import assert from 'node:assert/strict'
import {openBrowser} from './cdp.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
const out=process.env.BUDDY_REPORT_DIR || new URL('../../drafts/visible-clicks',import.meta.url).pathname
const c=await openBrowser({width:1440,height:1000,dpr:1}),records=[]
await mkdir(out,{recursive:true})
try {
 await c.navigate(process.env.BUDDY_BASE_URL || 'http://127.0.0.1:8907/')
 for(let i=0;i<100&&!await c.evaluate('!!globalThis.buddy');i++)await c.sleep(50)
 await c.evaluate(`globalThis.imageVisible=e=>{let opacity=1;for(let n=e;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return false;opacity*=Number(s.opacity)}const a=e.getBoundingClientRect(),b=document.querySelector('#viewport').getBoundingClientRect();return opacity>.5&&a.width>2&&a.height>2&&a.right>b.left&&a.left<b.right&&a.bottom>b.top&&a.top<b.bottom}`)
 for(const id of ['disk','mail','tracker']) {
  await c.click('[data-id="'+id+'"]')
  for(let i=0;i<100;i++){if(await c.evaluate(`(()=>{try{return buddy.presets.y360&&buddy.state().busy}catch{return false}})()`))break;await c.sleep(25)}
  await c.evaluate('buddy.pause()')
  const samples=[],seen=new Set();let saved=false
  for(let frame=0;frame<270;frame++){
   const s=await c.evaluate(`await (async()=>{buddy.step(1/30);await new Promise(requestAnimationFrame);return{act:buddy.state().act,images:[...document.querySelectorAll('.buddy image')].filter(imageVisible).map(e=>({opacity:getComputedStyle(e).opacity,rect:JSON.parse(JSON.stringify(e.getBoundingClientRect()))}))}})()`)
   seen.add(s.act);if(s.images.length){samples.push({frame,...s});if(!saved&&frame>=60){await c.screenshot(out+'/'+id+'-visible.png');saved=true}}
  }
  assert(seen.has(id==='tracker'?'point':id));assert(samples.length>10,id+': знак видим в нескольких кадрах')
  records.push({id,seen:[...seen],visibleFrames:samples.length,samples});console.log(id+': visible '+samples.length+' frames')
 }
 assert.equal(c.exceptions.length,0)
 await writeFile(out+'/report.json',JSON.stringify({records,errors:c.exceptions},null,2))
}finally{await c.close()}

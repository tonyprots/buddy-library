import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(process.argv[2] || '.'),
  output = resolve(process.env.BUDDY_REPORT_DIR || 'drafts/brand-0.9/browser'),
  report = { checks: [], variants: [] }
await mkdir(output, { recursive: true })
const browser = await openBrowser({ width: 1440, height: 1000, dpr: 1 }), ev = browser.evaluate
try {
  await browser.navigate(pathToFileURL(join(root, 'examples/brand.html')).href)
  for (let n=0;n<200&&!await ev('!!window.buddy?.state');n++) await browser.sleep(50)
  assert.deepEqual(await ev('[buddy.presets.brand,buddy.presets.y360,buddy.mode,buddy.profile,buddy.hoodie.source,buddy.brand.accent]'),
    [true,false,'show','show','brand','#267052'])
  await ev('window.fixtureBrand=JSON.parse(document.getElementById("deck-brand").textContent);buddy.setMode("manual");buddy.pause();buddy.reset()')
  await browser.click('[data-technique="shield"]')
  const orbit = await ev(`(() => {
    buddy.step(1.2)
    const images=[...document.querySelectorAll('.buddy image')].map(image=>image.getAttribute('href'))
    return { products:buddy.brand.products.every(image=>images.includes(image)),
      accent:!!document.querySelector('.buddy [stroke="#267052"]'), color:buddy.hoodie.color }
  })()`)
  assert.ok(orbit.products && orbit.accent)
  await ev('Promise.all([fixtureBrand.logo,...fixtureBrand.products].map(async src=>{const image=new Image();image.src=src;await image.decode();if(!image.naturalWidth)throw Error("Пустое изображение")}))')
  await browser.screenshot(join(output,'brand-orbit.png'))
  report.checks.push('JSON data-brand включает фирменные номера; собственные SVG декодируются, два продукта на орбите, акцент в эффекте и палитре худи')

  const variants = [
    ['empty','{}'], ['main','{logo:fixtureBrand.logo}'],
    ['no-products','{logo:fixtureBrand.logo,products:[]}'],
    ['one-product','{logo:fixtureBrand.logo,products:[fixtureBrand.products[0]]}'],
    ['products-only','{products:[fixtureBrand.products[0]]}'],
    ['nine-products','{logo:fixtureBrand.logo,products:Array.from({length:9},(_,i)=>fixtureBrand.products[i%2])}']
  ]
  for (const [name, source] of variants) {
    const row = await ev(`await (async()=>{
      buddy.destroy();show(0)
      window.buddy=await Buddy.createBuddy({stage:document.getElementById('deck'),slideSelector:'.pages > article',activeClass:'is-active',brand:${source}})
      const active=buddy.presets.brand
      buddy.setMode('manual');buddy.pause()
      const actions=active?['disk','mail','calendar','tracker','fire','shield','fly']:['shield','fire','fly'],
        results=[]
      if(!active&&buddy.can('disk')===null)throw Error('Пустой бренд включил номер')
      for(const id of [...actions,'finale']){
        show(id==='finale'?2:0);buddy.reset();buddy.progress(1);buddy.rescan()
        const reason=buddy.can(id)
        if(reason)throw Error(id+': '+reason)
        buddy.play(id)
        for(let frame=0;frame<480;frame++){
          buddy.step(1/30)
          const state=buddy.state()
          if(!Number.isFinite(state.x)||!Number.isFinite(state.y))throw Error(id+': NaN')
          if([...document.querySelectorAll('.buddy [transform]')].some(node=>/NaN|Infinity/.test(node.getAttribute('transform'))))throw Error(id+': transform')
        }
        results.push(id)
      }
      return {active,products:buddy.brand.products.length,actions:results}
    })()`)
    report.variants.push({name,...row})
  }
  report.checks.push('Пустой, одиночный, нулевой/один/девять продуктов: фирменные номера, огонь, щит, полёт и финал без исключений и NaN')
  await ev(`buddy.destroy();show(0);window.buddy=await Buddy.createBuddy({stage:document.getElementById('deck'),slideSelector:'.pages > article',activeClass:'is-active',brand:fixtureBrand,renderer:'svg'});buddy.pause();buddy.play('shield');buddy.step(1)`)
  assert.equal(await ev('buddy.renderer'),'svg')
  assert.ok(await ev(`!!document.querySelector('.buddy [stroke="#267052"]')`))
  report.checks.push('Резервный SVG также использует бренд и акцент')
  assert.deepEqual(browser.exceptions, [])
  assert.deepEqual(browser.consoleErrors, [])
  assert.equal(browser.requests.some(url=>/^https?:/.test(url)), false)
} catch(error) { report.error=error.stack; throw error }
finally {
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
  await browser.close()
}
console.log(JSON.stringify(report.checks))

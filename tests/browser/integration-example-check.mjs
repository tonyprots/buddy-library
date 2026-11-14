// Проверка готового примера из поставки: file://, чужая разметка, адаптивность и очистка.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(process.argv[2] || '.'),
  page = process.argv[3] || 'quick-start.html',
  output = resolve(process.env.BUDDY_REPORT_DIR || 'drafts/public-package/example'),
  report = { checks: [], layouts: [] }
await mkdir(output, { recursive: true })
const browser = await openBrowser({ width: 1440, height: 1000, dpr: 1 }), ev = browser.evaluate
try {
  await browser.navigate(pathToFileURL(join(root, 'examples', page)).href)
  for (let attempt = 0; attempt < 200 && !await ev('!!window.buddy?.state'); attempt++) await browser.sleep(50)
  assert.deepEqual(await ev('[buddy.mode,buddy.profile,buddy.state().character,buddy.state().autonomous,buddy.renderer]'),
    ['show', 'show', 'curious', true, 'webgl'])
  await browser.sleep(1500)
  assert.ok(await ev('buddy.state().time') > .5)
  assert.ok(await ev("new DOMParser().parseFromString(decodeURIComponent(document.querySelector('link[rel=icon]').href.split(',')[1]),'image/svg+xml').documentElement.localName === 'svg'"))
  await browser.click('#pause')
  assert.equal(await ev('buddy.paused'), true)
  await browser.click('#pause')
  assert.equal(await ev('buddy.paused'), false)
  report.checks.push('file://: активные дефолты, WebGL, самостоятельное время, фавиконка и кнопка паузы')
  if (page === 'y360.html' || page === 'brand.html') {
    for (const id of ['disk', 'mail', 'calendar', 'tracker']) {
      const role = { disk: 'disc', mail: 'message', calendar: 'reminder', tracker: 'mark' }[id]
      await ev('buddy.pause(); buddy.reset(); buddy.progress(1)')
      await browser.click('[data-technique="' + id + '"]')
      const branded = await ev(`(() => {
        for(let frame=0;frame<900;frame++){
          buddy.step(1/60)
          if([...document.querySelectorAll('.buddy image')].some(image=>image.getAttribute('href')===buddy.brand.roles['${role}'])) return true
        }
        return false
      })()`)
      assert.ok(branded, 'Кнопка запускает номер со знаком: ' + id)
      const visible = await ev(`(() => {
        buddy.step(.8)
        return [...document.querySelectorAll('.buddy image')].some(image => {
          if(image.getAttribute('href')!==buddy.brand.roles['${role}']) return false
          for(let node=image;node;node=node.parentElement)
            if(+getComputedStyle(node).opacity<.5) return false
          const box=image.getBoundingClientRect()
          return box.width>0&&box.height>0
        })
      })()`)
      assert.ok(visible, 'Знак видим после появления: ' + id)
      await browser.screenshot(join(output, 'brand-' + id + '.png'))
    }
    await ev('buddy.reset(); buddy.resume()')
    report.checks.push('Четыре кнопки отдельного примера запускают номера с переданными знаками')
  }

  for (const width of [320, 768, 1440, 1920]) {
    await browser.metrics(width, 1000, 1)
    await browser.sleep(80)
    await ev('show(0)')
    for (const index of [0, 1, 2]) {
      if (index) await browser.click('#next')
      await browser.sleep(120)
      assert.equal(await ev('buddy.experimental.W.idx'), index)
      assert.equal(await ev("document.querySelectorAll('.pages > article.is-active').length"), 1)
      const layout = await ev(`(() => {
        const r = node => node.getBoundingClientRect(), slide = document.querySelector('article.is-active'),
          [heading, copy] = [...slide.querySelector('.copy').children].map(r),
          props = [...slide.querySelectorAll('.prop')].map(r), stage = r(document.getElementById('deck')),
          main = [...document.querySelector('main').children].map(r),
          buttons = [...document.querySelectorAll('button')].map(r)
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          gaps: [copy.top-heading.bottom, props[1] ? props[1].left-props[0].right : 40,
            main[1].top-main[0].bottom, main[2].top-main[1].bottom],
          inBounds: [heading,copy,...props].every(box=>box.left>=stage.left&&box.right<=stage.right+.5&&box.top>=stage.top&&box.bottom<=stage.bottom),
          hitAreas: buttons.every(box=>box.width>=44&&box.height>=44) }
      })()`)
      assert.equal(layout.overflow, false)
      assert.ok(layout.gaps.every(gap => gap >= 8), JSON.stringify(layout))
      assert.ok(layout.inBounds && layout.hitAreas, JSON.stringify(layout))
      report.layouts.push({ width, index, ...layout })
      await browser.screenshot(join(output, `example-${width}-${index}.png`))
    }
  }
  assert.equal(await ev('buddy.experimental.W.progress'), 1)
  await browser.click('#previous')
  assert.equal(await ev('buddy.experimental.W.idx'), 1)
  await ev(`window.number = document.createElement('strong'); number.textContent='42%'; document.querySelector('article.is-active .copy').append(number)`)
  await browser.sleep(250)
  assert.ok(await ev("buddy.context().facts.some(f => f.text === '42%')"))
  await ev("number.textContent='57%'")
  await browser.sleep(250)
  assert.ok(await ev("buddy.context().facts.some(f => f.text === '57%')"))
  report.checks.push('Вложенные article/is-active: навигация, прогресс, обновление контекста; 12 раскладок без обрезки и зазоров <8px')
  await ev('buddy.destroy()')
  assert.equal(await ev("document.querySelectorAll('.buddy').length"), 0)
  await ev("window.buddy = await Buddy.createBuddy({stage:document.getElementById('deck'),slideSelector:'.pages > article',activeClass:'is-active'})")
  assert.equal(await ev("document.querySelectorAll('.buddy').length"), 1)
  assert.equal(await ev('buddy.experimental.W.idx'), 1)
  report.checks.push('destroy и повторное подключение без дубликата')
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await browser.navigate(pathToFileURL(join(root, 'examples', page)).href)
  for (let attempt = 0; attempt < 200 && !await ev('!!window.buddy?.state'); attempt++) await browser.sleep(50)
  assert.equal(await ev('buddy.state().reducedMotion'), true)
  assert.equal(await ev("buddy.play('wave')"), false)
  report.checks.push('Системное reduced motion сохранено')
  assert.deepEqual(browser.exceptions, [])
  assert.deepEqual(browser.consoleErrors, [])
  assert.equal(browser.requests.some(url => /^https?:/.test(url)), false)
} catch (error) { report.error = error.stack; throw error }
finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify(report.checks))

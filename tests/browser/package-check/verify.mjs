// Проверка пакета «как внешний пользователь»: node verify.mjs <папка-приложения> <scenario>
// Папка приложения: страницы из этой папки + node_modules с пакетом, установленным из npm pack
// (см. CONTRIBUTING.md, «Выпуск»). Для bundled.html нужен bundle.js: esbuild app.js --bundle --format=esm.
// Сценарии: life, classic, bundled, scenes, effects, keys, reduced. Кадры и журнал — в <папка>/shots/.
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openBrowser } from '../cdp.mjs'

const [appDir, scenario] = process.argv.slice(2), app = resolve(appDir), out = join(app, 'shots')
await mkdir(out, { recursive: true })
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  const path = resolve(app, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (path !== app && !path.startsWith(app + sep)) { res.writeHead(403).end(); return }
  try { res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(await readFile(path)) }
  catch { res.writeHead(404).end() }
}).listen(0, '127.0.0.1')
await new Promise(r => server.once('listening', r))
const http = page => `http://127.0.0.1:${server.address().port}/${page}`
const b = await openBrowser({ width: 1280, height: 720, dpr: 1 }), log = [], checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`) }
const shot = name => b.screenshot(join(out, `${scenario}-${name}.png`))
const ready = async () => {
  for (let i = 0; i < 150; i++) { if (await b.evaluate('!!(window.buddy && typeof window.buddy.state === "function")')) return true; await b.sleep(100) }
  return false
}
const sample = () => b.evaluate('(() => { const s = buddy.state(); return { x: Math.round(s.x), y: Math.round(s.y), act: s.act, surf: s.surf, g: s.grounded, level: s.level, autonomous: s.autonomous, r: buddy.renderer, slide: [...document.querySelectorAll("#stage > .slide")].findIndex(e => e.classList.contains("on")) } })()')
async function watch(seconds, label, every = 400) {
  const rows = [], end = Date.now() + seconds * 1000, shots = new Set()
  while (Date.now() < end) {
    const row = await sample(); row.t = +(seconds - (end - Date.now()) / 1000).toFixed(1); row.label = label
    rows.push(row); log.push(row)
    if (row.surf === 'plat' && !shots.has('plat')) { shots.add('plat'); await shot(`${label}-on-block`) }
    if (row.surf === 'floor' && !row.g && row.y < 600 && !shots.has('air')) { shots.add('air'); await shot(`${label}-air`) }
    await b.sleep(every)
  }
  await shot(`${label}-end`)
  return rows
}
const acts = rows => [...new Set(rows.map(r => r.act).filter(Boolean))]
const spread = rows => Math.max(...rows.map(r => r.x)) - Math.min(...rows.map(r => r.x))
const go = index => b.evaluate(`document.querySelectorAll('#stage > .slide').forEach((slide, i) => slide.classList.toggle('on', i === ${index}))`)

try {
  if (scenario === 'optional-brand') {
    for (const page of ['classic.html', 'esm.html']) {
      await b.navigate(page === 'classic.html' ? pathToFileURL(join(app, page)).href : http(page))
      check(`${page}: пакет подключён`, await ready())
      const result = await b.evaluate(`await (async () => {
        buddy.destroy()
        const create = globalThis.Buddy?.createBuddy || (await import('./node_modules/@tony-prots/buddy/src/index.js')).createBuddy,
          stage = document.getElementById('stage'), warn = console.warn, warnings = [], runs = []
        console.warn = message => warnings.push(message)
        try {
          window.buddy = await create({ stage, mode: 'manual', presets: { y360: true } })
          buddy.pause()
          for (const id of ['disk','mail','calendar','tracker']) {
            buddy.reset(); buddy.progress(1); buddy.play(id)
            let images = []
            for (let frame=0;frame<900&&!images.length;frame++) {
              buddy.step(1/60)
              images = [...stage.querySelectorAll('.buddy image')].map(image=>image.getAttribute('href')).filter(Boolean)
            }
            runs.push({id, images:images.length, neutral:images.every(href=>!href.includes('base64'))})
          }
          const withoutLogosWarnings = warnings.length
          buddy.destroy(); warnings.length=0
          stage.style.width='1600px'; stage.style.height='900px'; stage.style.transform='scale(.5)'
          window.buddy=await create({stage,mode:'manual'})
          const wrongSizeWarnings=warnings.length
          buddy.destroy(); warnings.length=0
          stage.style.width='1280px';stage.style.height='720px'
          window.buddy=await create({stage,mode:'manual'})
          const scaledWarnings=warnings.length
          buddy.destroy(); stage.style.transform=''
          let logos
          if(globalThis.Buddy) {
            await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./node_modules/@tony-prots/buddy/dist/buddy-y360.js';script.onload=resolve;script.onerror=reject;document.head.append(script)})
            logos=BuddyY360.logos
          } else logos=(await import('./node_modules/@tony-prots/buddy/src/presets/y360.js')).logos
          window.buddy=await create({stage,mode:'manual',presets:{y360:true},logos})
          buddy.pause();buddy.progress(1);buddy.play('disk');buddy.step(.5)
          return {runs,withoutLogosWarnings,wrongSizeWarnings,scaledWarnings,
            withLogosWarnings:warnings.length, branded:[...stage.querySelectorAll('.buddy image')].some(image=>image.getAttribute('href')===logos.disk)}
        } finally {console.warn=warn}
      })()`)
      check(`${page}: четыре номера без знаков`, result.runs.every(run=>run.images>0&&run.neutral), JSON.stringify(result.runs))
      check(`${page}: одно предупреждение о знаках`, result.withoutLogosWarnings===1)
      check(`${page}: диагностика размера учитывает CSS scale`, result.wrongSizeWarnings===1&&result.scaledWarnings===0)
      check(`${page}: отдельный файл знаков подключён`, result.withLogosWarnings===0&&result.branded)
      await shot('optional-'+page.replace('.html',''))
    }
  } else if (scenario === 'defaults') {
    for (const page of ['classic.html', 'esm.html', 'bundled.html']) {
      await b.navigate(page === 'classic.html' ? pathToFileURL(join(app, page)).href : http(page))
      check(`${page}: пакет подключён`, await ready())
      const initial = await b.evaluate('({mode:buddy.mode,profile:buddy.profile,paused:buddy.paused,autonomous:buddy.state().autonomous,renderer:buddy.renderer})')
      check(`${page}: активное шоу без настроек`, initial.mode === 'show' && initial.profile === 'show' && !initial.paused && initial.autonomous && initial.renderer === 'webgl', JSON.stringify(initial))
      await b.evaluate(`document.querySelectorAll('#stage > .slide').forEach((node,i,list)=>node.classList.toggle('on',i===list.length-1))`)
      await b.sleep(50)
      const result = await b.evaluate(`(()=>{buddy.pause();buddy.rescan();const B=buddy.experimental.B,actions=new Set();let powers=0,last=B.lastPower;for(let i=0;i<90*60;i++){buddy.step(1/60);actions.add(B.act.name);if(B.lastPower!==last){last=B.lastPower;powers++}}return {powers,actions:[...actions],level:buddy.state().level}})()`)
      // Авторский финальный полёт и лазанье занимают часть 90-секундного окна.
      check(`${page}: способности на финальном слайде без ручного play`, result.powers >= 2 && result.actions.length >= 5 && result.level === 3 && !result.actions.includes('nap'), JSON.stringify(result))
      await shot(page.replace('.html', ''))
    }
  } else if (scenario === 'behavior') {
    for (const page of ['classic.html', 'esm.html', 'bundled.html']) {
      await b.navigate(page === 'classic.html' ? pathToFileURL(join(app, page)).href : http(page))
      check(`${page}: пакет подключён`, await ready())
      const result = await b.evaluate(`await (async () => {
        buddy.setMode('manual');buddy.setCharacter('business');buddy.pause();buddy.reset();
        const run=buddy.story(['lookSlide',{wait:.2},'wave']);buddy.step(12);const completed=await run.finished;
        const flight=buddy.perform('leap');buddy.step(.3);flight.cancel();buddy.step(15);const cancelled=await flight.finished;
        buddy.focus();let settling=0;while(!buddy.state().focused&&settling<30){buddy.step(1);settling++}
        return {completed:completed.status,cancelled:cancelled.status,focused:buddy.state().focused,settling,character:buddy.character,renderer:buddy.renderer,state:buddy.state()};
      })()`)
      check(`${page}: сценарий, отмена, focus и характер`, result.completed === 'completed' && result.cancelled === 'cancelled' && result.focused && result.character === 'business' && result.renderer === 'webgl', JSON.stringify(result))
    }
  } else if (scenario === 'life' || scenario === 'classic' || scenario === 'bundled') {
    const url = scenario === 'life' ? http('esm.html') : scenario === 'bundled' ? http('bundled.html') : pathToFileURL(join(app, 'classic.html')).href
    await b.navigate(url)
    check('бадди появился без настроек', await ready(), url.split('/').pop())
    const first = await sample()
    check('WebGL и своя жизнь по умолчанию', first.r === 'webgl' && first.autonomous === true, JSON.stringify({ r: first.r, autonomous: first.autonomous }))
    await shot('start')
    const short = scenario !== 'life'
    const s0 = await watch(short ? 20 : 25, 's0')
    check('слайд 1: двигается сам', spread(s0) > 20 || acts(s0).length >= 3, `x-разброс ${spread(s0)}, приёмы ${acts(s0).join(',')}`)
    if (short) {
      if (scenario === 'classic') await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
      else await go(1)
      const s1 = await watch(20, 's1')
      check('смена слайда замечена', s1.at(-1).slide === 1 && acts(s1).length >= 2, `приёмы ${acts(s1).join(',')}`)
    } else {
      await go(1); const s1 = await watch(75, 's1')
      check('слайд 2: реакция на смену и число', acts(s1).length >= 3, acts(s1).join(','))
      check('слайд 2: залез на блок', s1.some(r => r.surf === 'plat'), `опоры ${[...new Set(s1.map(r => r.surf))]}`)
      await go(2); const s2 = await watch(45, 's2')
      const heights = [...new Set(s2.filter(r => r.surf === 'plat' && r.g).map(r => r.y))]
      check('слайд 3: лестница пройдена сама', heights.length >= 2, `высоты на ступенях ${heights.join(',')}`)
      await go(3); const s3 = await watch(35, 's3')
      check('слайд 4: финальный полёт к data-buddy-fly', s3.some(r => r.y < 520 && r.surf !== 'plat'), `мин. y ${Math.min(...s3.map(r => r.y))}, приёмы ${acts(s3).join(',')}`)
    }
  } else if (scenario === 'scenes') {
    await b.navigate(http('esm.html?o=' + encodeURIComponent(JSON.stringify({ autoplay: false, reactions: false }))))
    check('бадди появился (ручное управление)', await ready())
    await go(1); await b.sleep(3000); await b.evaluate('buddy.rescan()')
    check('play("land") начат', await b.evaluate('buddy.play("land")'))
    const land = await watch(8, 'land')
    check('посадка на data-buddy-land', land.some(r => r.surf === 'plat'), `опоры ${[...new Set(land.map(r => r.surf))]}`)
    await b.evaluate('buddy.reset()'); await b.sleep(1500)
    check('play("parachute") начат', await b.evaluate('buddy.play("parachute")'))
    const chute = await watch(9, 'parachute', 250)
    check('парашют: подъём и спуск', Math.min(...chute.map(r => r.y)) < 400 && chute.at(-1).y > 640, `мин. y ${Math.min(...chute.map(r => r.y))}, конец ${chute.at(-1).y}`)
    await b.evaluate('buddy.reset()'); await b.sleep(1000)
    check('play("leap") начат', await b.evaluate('buddy.play("leap")'))
    await watch(6, 'leap', 300)
    for (const id of ['wave', 'read', 'fire', 'thinkNumber']) {
      await b.evaluate('buddy.reset()'); await b.sleep(800)
      const reason = await b.evaluate(`buddy.can(${JSON.stringify(id)})`)
      const ok = reason === null && await b.evaluate(`buddy.play(${JSON.stringify(id)})`)
      check(`ручной приём ${id}`, ok, reason ?? '')
      await b.sleep(2500); await shot(`manual-${id}`)
    }
  } else if (scenario === 'effects') {
    await b.navigate(http('esm.html?fx=line&o=' + encodeURIComponent(JSON.stringify({ reactions: false }))))
    check('бадди и эффекты подключены', await ready() && await b.evaluate('!!window.effects'))
    await b.sleep(1500); await shot('cover')
    await b.evaluate('effects.go(1, 0)')
    const rows = []
    for (let i = 0; i < 16; i++) { rows.push(await sample()); if (i === 2 || i === 6) await shot(`intro-${i}`); await b.sleep(300) }
    await shot('intro-end')
    check('интро перевело на слайд 2', rows.at(-1).slide === 1, `слайд ${rows.at(-1).slide}`)
    check('бадди вылетел и приземлился', Math.min(...rows.map(r => r.y)) < 500, `мин. y ${Math.min(...rows.map(r => r.y))}, конец ${rows.at(-1).y} ${rows.at(-1).surf}`)
  } else if (scenario === 'keys') {
    await b.navigate(http('esm.html?o=' + encodeURIComponent(JSON.stringify({ autoplay: false, reactions: false, keyboard: true }))))
    check('бадди появился с клавиатурой', await ready())
    await go(3); await b.sleep(3000)
    const before = await sample()
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'n', code: 'KeyN', text: 'n', windowsVirtualKeyCode: 78 })
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78 })
    const rows = await watch(12, 'key-n', 250)
    check('клавиша N запускает способность', acts(rows).some(a => !['idle', 'walk', 'lookSlide', 'lookHall', before.act].includes(a)), acts(rows).join(','))
  } else if (scenario === 'reduced') {
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await b.navigate(http('esm.html'))
    check('бадди появился при reduced motion', await ready())
    const flags = await b.evaluate('({ reduced: buddy.reducedMotion, play: buddy.play("wave") })')
    check('reduced motion: play() возвращает false', flags.reduced === true && flags.play === false, JSON.stringify(flags))
    const rows = await watch(8, 'still')
    check('reduced motion: стоит на месте', spread(rows) === 0 && new Set(rows.map(r => r.y)).size === 1, `x-разброс ${spread(rows)}`)
  }
  check('нет исключений и ошибок консоли', !b.exceptions.length && !b.consoleErrors.length,
    JSON.stringify([...b.exceptions.map(e => e.exception?.description || e.text), ...b.consoleErrors]).slice(0, 300))
} catch (error) {
  check('сценарий завершился', false, error.stack)
} finally {
  await writeFile(join(out, `${scenario}.json`), JSON.stringify({ scenario, checks, log }, null, 1))
  await b.close(); server.close()
  process.exitCode = checks.every(c => c.ok) ? 0 : 1
}

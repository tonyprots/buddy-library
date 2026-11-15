import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './cdp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  output = resolve(process.env.BUDDY_REPORT_DIR || join(root, 'drafts/jump-motion/browser')),
  ffmpeg = process.env.BUDDY_FFMPEG || '/opt/homebrew/bin/ffmpeg', fps = 24,
  video = process.env.BUDDY_CAPTURE_VIDEO !== '0' && await access(ffmpeg).then(() => true, () => false),
  variants = process.env.BUDDY_JUMP_IDS ? process.env.BUDDY_JUMP_IDS.split(',') : ['ordinary', 'quick', 'flip', 'roll', 'publicLeap', 'publicFlip'],
  report = { date: new Date().toISOString(), fps, video, sources: {}, cycles: [], errors: [],
    limits: ['Браузерный прогон использует настоящий WebGL и ту же модель персонажа.',
      'Видео — полный модельный цикл с частотой 24 кадра/с; это не измерение настоящих FPS или GPU-времени.',
      'Крупный план следует за персонажем; общий PNG показывает положение настоящей опоры.',
      'Контакты и координаты измеряются по кинематике runtime; визуальная оценка роликов выполняется отдельно.'] },
  html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Бадди · проверка прыжка</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M7 26Q16 1 25 26' fill='none' stroke='%231340e0' stroke-width='4'/%3E%3C/svg%3E">
<style>body{margin:24px;background:white;color:#20252f;font:16px system-ui}h1{font-size:22px;margin:0 0 12px}p{margin:0 0 16px}#viewport{width:1100px;height:640px;overflow:hidden;position:relative;background:#edf4ff;border-radius:12px}#stage{width:1280px;height:720px;position:absolute;transform-origin:0 0}.slide{position:absolute;inset:0}#platform{position:absolute;left:580px;top:370px;width:120px;height:300px;background:#b8cceb;border-radius:8px;display:none}#floorLine{position:absolute;left:0;top:700px;width:1280px;border-top:2px solid #65798e;pointer-events:none}</style>
<h1>Полные циклы прыжка</h1><p id="status" role="status">Подключаю персонажа…</p><div id="viewport"><div id="stage"><section class="slide on"><div id="platform" data-buddy-land></div></section><div id="floorLine" aria-hidden="true"></div></div></div>
<script type="module">
import { createBuddy } from '/src/index.js';
const stage=document.getElementById('stage');
globalThis.buddy=await createBuddy({stage,renderer:'auto',motion:'full',autoplay:false,reactions:false,seed:14,presets:{superhuman:true}});
buddy.pause();buddy.progress(1);buddy.rescan();buddy.reset();
globalThis.jumpCamera=(mode='closeup')=>{const b=buddy.experimental.B,f=buddy.framing().actor,scale=mode==='overview'?Math.min(1100/1280,640/720):Math.min(3.8,1068/(f[2]-f[0]),608/(f[3]-f[1])),cx=mode==='overview'?640:(f[0]+f[2])/2,cy=mode==='overview'?360:(f[1]+f[3])/2;stage.style.transform='translate('+(550-cx*scale)+'px,'+(320-cy*scale)+'px) scale('+scale+')';return {mode,scale,actor:f,x:b.x,y:b.y}};
globalThis.startJump=(id,face)=>{
  buddy.pause();buddy.reset();jumpCamera('overview');
  document.getElementById('platform').style.display=id==='roll'?'block':'none';buddy.rescan();
  const r=buddy.experimental,b=r.B,S=r.tools.S,rest=r.tools.pose(),low=Math.max(...r.tools.solve(rest,1,0).legs.flatMap(l=>[l.heel[1],l.toe[1]])),source=id==='roll'?r.W.plats.find(p=>Math.abs(p.x1-580)<2&&Math.abs(p.y-370)<2):r.W.floor;
  if(!source)throw new Error('Реальная опора не найдена');
  Object.assign(b,{x:640,y:source.y-low*S,surf:source,surfY:source.y,mode:'ground',anchor:null,face,cam:.4,yaw:face>0?.4*Math.PI/2:Math.PI-.4*Math.PI/2,yawV:0});
  const o=id==='quick'?{apex:18,quick:true}:id==='flip'?{apex:20,flip:-360}:id==='roll'?{apex:8,roll:true}:{apex:18},target=id==='roll'?r.W.floor:source,tx=640+face*(id==='flip'?-6:id==='roll'?200:100);
  if(!target.spans.some(([a,z])=>tx>=a+12&&tx<=z-12))throw new Error('Точка приземления вне свободной опоры');
  const publicScene=id==='publicLeap'||id==='publicFlip';if(publicScene){b.x+=face*140;buddy.play(id==='publicLeap'?'leap':'flip');buddy.pause()}else r.begin(r.jumpTo(tx,target,o));globalThis.qaJump={id,face,tx:publicScene?640:tx,targetY:target.y,sourceY:source.y,time:0,seenAir:false,landedAt:null,initial:{x:b.x,y:b.y,scale:b.scale}};jumpCamera();document.getElementById('status').textContent=id+' · '+(face>0?'вправо':'влево');return qaJump
};
globalThis.stepJump=()=>{
  buddy.step(1/24,24);const r=buddy.experimental,b=r.B,k=b.kk,S=r.tools.S,world=p=>[b.x+(p[0]*Math.cos(b.yaw)-p[2]*Math.sin(b.yaw))*S*b.scale,b.y+p[1]*S*b.scale],feet=k.legs.flatMap(l=>[world(l.heel),world(l.toe)]);
  qaJump.time+=1/24;if(b.mode==='free')qaJump.seenAir=true;if(qaJump.seenAir&&b.mode==='ground'&&qaJump.landedAt===null)qaJump.landedAt=qaJump.time;
  const camera=jumpCamera();return {time:qaJump.time,state:buddy.state(),scale:b.scale,mode:b.mode,face:b.face,pose:b.pose,feet,hands:k.arms.map(a=>world(a.hand)),contact:b.footId,footError:b.mode==='ground'&&b.cset===0?Math.max(...feet.map(p=>p[1]))-b.surfY:null,landedAt:qaJump.landedAt,camera}
};
document.getElementById('status').textContent='Готово';jumpCamera('overview');
</script></html>`

function encoder(file) {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg',
    '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000) }); child.stdin.on('error', () => {})
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg ${code}: ${stderr}`)))
  })
  closed.catch(() => {})
  return { write: buffer => new Promise((resolve, reject) => child.stdin.write(buffer, error => error ? reject(error) : resolve())),
    async close() { child.stdin.end(); await closed }, kill() { child.kill() } }
}

await mkdir(output, { recursive: true })
for (const file of ['src/runtime.js', 'src/index.js', 'src/vendor.js', 'tests/browser/jump-browser-check.mjs'])
  report.sources[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex')
const runtime = await readFile(join(root, 'src/runtime.js'), 'utf8')
report.jumpToSha = createHash('sha256').update(runtime.split('  function jumpTo(')[1].split('\n  function leap(')[0]).digest('hex')
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (pathname === '/' || pathname === '/jump-test.html') { response.setHeader('Content-Type', 'text/html'); response.end(html); return }
    const file = resolve(root, '.' + pathname)
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await openBrowser({ width: 1200, height: 860, dpr: Number(process.env.BUDDY_DPR || 2) })
  const ev = browser.evaluate,
    settleView = () => ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),
    clip = async () => ev(`(()=>{const r=document.getElementById('viewport').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:1100,height:640,scale:1}})()`),
    capture = async format => Buffer.from((await browser.send('Page.captureScreenshot', {
      format, ...(format === 'jpeg' ? { quality: 86 } : {}), captureBeyondViewport: true, clip: await clip() })).data, 'base64')
  await browser.navigate(`http://127.0.0.1:${server.address().port}/jump-test.html`)
  for (let i = 0; i < 200 && !await ev('!!globalThis.buddy'); i++) await browser.sleep(50)
  assert.ok(await ev('!!globalThis.buddy'), 'Персонаж подключён')
  assert.equal(await ev('buddy.state().renderer'), 'webgl', 'Используется настоящий WebGL')
  report.browser = await ev('navigator.userAgent')
  report.favicon = await ev(`(()=>{const h=document.querySelector('link[rel=icon]').href;return decodeURIComponent(h.split(',')[1]).startsWith('<svg')})()`)
  assert.equal(report.favicon, true)
  assert.ok(variants.length && variants.every(id => ['ordinary', 'quick', 'flip', 'roll', 'publicLeap', 'publicFlip'].includes(id)))
  for (const id of variants) for (const face of [-1, 1]) {
    const name = `${id}-${face < 0 ? 'left' : 'right'}`, row = { id, face, frames: [], images: [] },
      film = video ? encoder(join(output, name + '.mp4')) : null
    try {
      row.start = await ev(`startJump(${JSON.stringify(id)},${face})`)
      await settleView()
      let first = false, second = false, ended = false
      for (let frame = 0; frame < fps * 10; frame++) {
        const sample = await ev('stepJump()')
        row.frames.push(sample)
        assert.ok([sample.state.x, sample.state.y, ...sample.feet.flat(), ...sample.hands.flat()].every(Number.isFinite))
        if (sample.footError !== null) assert.ok(Math.abs(sample.footError) < .01)
        await settleView()
        if (film) await film.write(await capture('jpeg'))
        if (!first && sample.mode === 'free' && sample.time > (id === 'quick' ? .35 : id === 'roll' ? .9 : .65)) {
          const file = name + '-closeup-air.png'; await writeFile(join(output, file), await capture('png')); row.images.push(file)
          await ev(`jumpCamera('overview')`); await settleView()
          const overview = name + '-overview.png'; await writeFile(join(output, overview), await capture('png')); row.images.push(overview)
          await ev(`jumpCamera('closeup')`); await settleView(); first = true
        }
        if (!second && sample.landedAt !== null && sample.time > sample.landedAt + .12) {
          const file = name + '-closeup-land.png'; await writeFile(join(output, file), await capture('png')); row.images.push(file); second = true
        }
        if (sample.state.act === 'idle' && sample.landedAt !== null && sample.time > sample.landedAt + .8 && sample.state.fx === 0) { ended = true; break }
      }
      assert.ok(ended && first && second, 'Полный цикл, два крупных плана и финальное состояние')
      if (id === 'roll') assert.ok(row.frames.some(frame => frame.state.act === 'roll'))
      row.final = row.frames.at(-1).state
      assert.equal(row.final.surf, 'floor'); assert.equal(row.final.fx, 0)
      await film?.close(); row.movie = film ? name + '.mp4' : null
      await ev('buddy.reset();buddy.pause()')
      row.cleanup = await ev(`({fx:buddy.state().fx,queue:buddy.state().queue,clip:buddy.experimental.B.clip,mode:buddy.experimental.B.mode,act:buddy.state().act})`)
      assert.equal(row.cleanup.fx, 0); assert.equal(row.cleanup.queue, 0); assert.equal(row.cleanup.clip, null)
      row.pass = true; console.log('PASS ' + name)
    } catch (error) { film?.kill(); row.pass = false; row.error = error.stack; report.errors.push({ id, face, error: error.stack }) }
    report.cycles.push(row)
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  }
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, [])
} catch (error) { report.errors.push({ fatal: true, error: error.stack }) }
finally {
  report.exceptions = browser?.exceptions || []; report.consoleErrors = browser?.consoleErrors || []
  report.pass = report.errors.length === 0 && report.cycles.length === variants.length * 2 && report.cycles.every(cycle => cycle.pass)
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
if (!report.pass) process.exitCode = 1

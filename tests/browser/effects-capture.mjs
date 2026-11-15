import { openBrowser } from './cdp.mjs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url)),
  out = process.env.BUDDY_CAPTURE_DIR || root + 'drafts/effects-rework/final-capture', fps = 24,
  c = await openBrowser({ width: 960, height: 640, dpr: 1 }), records = [], sources = {}
await mkdir(out + '/sources', { recursive: true })
for (const file of ['new-abilities.js', 'ability-props.js', 'vendor.js', 'runtime.js', 'index.js', 'index.html']) {
  const data = await readFile(root + file)
  await writeFile(out + '/sources/' + file, data)
  sources[file] = createHash('sha256').update(data).digest('hex')
}
await writeFile(out + '/sources/manifest.json', JSON.stringify(sources, null, 2))
try {
  await c.navigate((process.env.BUDDY_BASE_URL || 'http://127.0.0.1:8907') + '/tests/capture-fixture.html')
  await c.evaluate(`document.head.insertAdjacentHTML('beforeend','<style>body{margin:0;background:#edf4ff}.view{width:960px;height:640px;overflow:hidden;position:relative}.stage{position:absolute;width:1280px;height:720px;transform-origin:0 0}.slide{position:absolute;inset:0;background:#edf4ff}.caption{position:absolute;left:32px;top:25px;color:#20252f;font:22px -apple-system,sans-serif;z-index:5}</style>');document.body.innerHTML='<div class="view"><div class="stage"><section class="slide on"><h1 style="position:absolute;left:80px;top:80px">Движение</h1></section></div><div class="caption"></div></div>';globalThis.mod=await import('/src/index.js');globalThis.stage=document.querySelector('.stage');globalThis.b=await mod.createBuddy({stage,autoplay:false,reactions:false});b.pause();b.progress(1);stage.style.transform='translate('+(480-640*4)+'px,'+(495-700*4)+'px) scale(4)';dispatchEvent(new Event('resize'))`)
  const requested = process.env.BUDDY_CAPTURE_IDS?.split(',')
  const cases = await c.evaluate(`mod.techniques.filter(x=>(x.duration&&!x.contextKinds)||${JSON.stringify(requested || [])}.includes(x.id)).map(x=>({id:x.id,title:x.title,duration:(x.duration&&!x.contextKinds)||(x.id==='hulk'?6.4:10)}))`)
  for (const item of cases.filter(item => !process.env.BUDDY_CAPTURE_IDS || process.env.BUDDY_CAPTURE_IDS.split(',').includes(item.id))) for (const facing of [1, -1]) {
    const name = item.id + '-' + (facing === 1 ? 'right' : 'left'), file = out + '/' + name + '.mp4',
      ff = spawn(process.env.BUDDY_FFMPEG || 'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
          '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'ignore', 'pipe'] }),
      completion = once(ff, 'exit'), states = [], setup = 12
    let stderr = ''
    ff.stderr.on('data', data => stderr += data)
    const fullStage = process.env.BUDDY_CAPTURE_FULL_STAGE === '1' || ['starcatch', 'spotlight'].includes(item.id)
    await c.evaluate(`b.reset();b.progress(1);b.experimental.B.face=${facing};b.experimental.B.yaw=${facing === 1 ? .5 : Math.PI - .5};b.experimental.seed(14);b.experimental.mind().slideAt=b.state().time;stage.style.transform=${JSON.stringify(fullStage ? 'scale(.75)' : 'translate(-1440px,-1605px) scale(3)')};dispatchEvent(new Event('resize'));document.querySelector('h1').style.left='${facing === 1 ? 850 : 80}px';document.querySelector('.caption').textContent=${JSON.stringify(item.title)}`)
    for (let frame = 0; frame < Math.ceil((item.duration + 1.5) * fps); frame++) {
      if (frame === setup) await c.evaluate(`b.play(${JSON.stringify(item.id)})`)
      await c.evaluate(`b.step(${1 / fps},${fps})`)
      const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }), data = Buffer.from(r.data, 'base64'),
        time = (frame - setup + 1) / fps,
        dense = item.id === 'comet' && time >= 1.125 && time <= 1.75
          || item.id === 'starcatch' && time >= 1.7 && time <= 2.15
          || item.id === 'timeBubble' && (time < 2.1 || time > 4.8 && time < 5.8)
          || item.id === 'energyBow' && time >= 2.85 && time <= 3.5
      if (!ff.stdin.write(data)) await once(ff.stdin, 'drain')
      if (frame % 6 === 0 || dense) {
        await writeFile(out + '/' + name + '-' + String(frame).padStart(3, '0') + '.png', data)
        states.push({ frame, time, state: await c.evaluate('b.state()') })
      }
    }
    ff.stdin.end()
    const [code] = await completion
    if (code !== 0) throw new Error(stderr)
    records.push({ ...item, facing, file, states })
    await writeFile(out + '/report.json', JSON.stringify({ fps, sources, records, errors: c.exceptions }, null, 2))
    console.log('rendered ' + name)
  }
  console.log(JSON.stringify({ clips: records.length, errors: c.exceptions }))
} finally { await c.close() }

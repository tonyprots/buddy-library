import { spawn } from 'node:child_process'
import { access, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function findChromium() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  for (const cache of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    const entries = await readdir(cache).catch(() => [])
    for (const entry of entries.filter(name => name.startsWith('chromium_headless_shell')).sort()) {
      const variants = process.platform === 'darwin'
        ? [`chrome-headless-shell-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}/chrome-headless-shell`]
        : ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell']
      candidates.unshift(...variants.map(variant => join(cache, entry, variant)))
    }
  }
  if (process.env.BUDDY_CHROME) candidates.unshift(process.env.BUDDY_CHROME)
  for (const path of candidates.filter(Boolean))
    if (await access(path).then(() => true, () => false)) return path
  throw new Error('Chromium не найден. Укажите BUDDY_CHROME=/path/to/chromium')
}

/** Один локальный Chromium и прямой CDP без сторонних зависимостей. */
export async function openBrowser({ width = 1440, height = 1000, dpr = 2 } = {}) {
  const executable = await findChromium(), profile = await mkdtemp(join(tmpdir(), 'buddy-browser-')),
    child = spawn(executable, ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--no-sandbox']), 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = '', closed = false
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-12000) })
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chromium не запустился: ${stderr}`)), 20000)
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Chromium завершился (${code}): ${stderr}`)) })
    child.stderr.on('data', () => {
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  }).catch(error => { child.kill(); throw error })
  const http = endpoint.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, ''),
    pages = await fetch(`${http}/json`, { signal: AbortSignal.timeout(5000) }).then(response => response.json()),
    page = pages.find(item => item.type === 'page'), ws = new WebSocket(page.webSocketDebuggerUrl),
    pending = new Map(), exceptions = [], consoleErrors = [], requests = []
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let id = 0
  ws.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id); pending.delete(message.id); clearTimeout(waiter.timer)
      message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
      consoleErrors.push(message.params.args.map(value => value.value ?? value.description ?? '').join(' '))
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params }))
  }), evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result?.value
  }, metrics = (width, height, dpr = 2) => send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: dpr, mobile: false }), navigate = async url => {
    await send('Page.navigate', { url })
    for (let attempt = 0; attempt < 100; attempt++) {
      await sleep(50)
      if (await evaluate('document.readyState === "complete"')) return
    }
    throw new Error('Страница не загрузилась')
  }, click = async selector => {
    const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Нет элемента'); element.scrollIntoView({block:'center'}); const r=element.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await metrics(width, height, dpr)
  return { send, evaluate, metrics, navigate, click, exceptions, consoleErrors, requests, sleep,
    screenshot: async path => { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path, Buffer.from(result.data, 'base64')) },
    close: async () => {
      if (closed) return
      closed = true; for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Браузер закрыт')) }
      pending.clear(); ws.close(); child.kill(); await sleep(100)
    }
  }
}

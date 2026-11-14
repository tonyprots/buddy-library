import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { runtimeFixture } from '../support/runtime-fixture.mjs'

// Локальный CSSOM fixture: атрибут сохраняет точную исходную строку до CSSOM-записи,
// CSSOM-запись нормализует декларации, а removeProperty оставляет пустой style.
function styledIcon(f, initial) {
  const node = new f.stage.constructor('svg'), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node)
  let declarations = new Map()
  const parse = text => {
    declarations = new Map()
    for (const part of text.split(';')) {
      const colon = part.indexOf(':'); if (colon < 0) continue
      const name = part.slice(0, colon).trim().toLowerCase(), raw = part.slice(colon + 1).trim(), important = /\s*!important\s*$/iu.test(raw)
      declarations.set(name, { value: raw.replace(/\s*!important\s*$/iu, '').trim(), priority: important ? 'important' : '' })
    }
  }, serialize = () => set('style', [...declarations].map(([name, item]) => `${name}: ${item.value}${item.priority ? ' !' + item.priority : ''};`).join(' ')),
    style = {
      getPropertyValue(name) { return declarations.get(name)?.value || '' },
      getPropertyPriority(name) { return declarations.get(name)?.priority || '' },
      setProperty(name, value, priority = '') { if (!value) return this.removeProperty(name); declarations.set(name, { value, priority }); serialize() },
      removeProperty(name) { const old = declarations.get(name)?.value || ''; declarations.delete(name); serialize(); return old }
    }
  Object.defineProperty(style, 'length', { get: () => declarations.size })
  node.style = new Proxy(style, {
    get(target, key) { if (key in target) return Reflect.get(target, key); if (key === 'cssText') return node.getAttribute('style') || ''; return target.getPropertyValue(key) },
    set(target, key, value) { if (key === 'cssText') { node.setAttribute('style', value); return true } target.setProperty(key, value); return true }
  })
  node.setAttribute = (name, value) => { set(name, value); if (name === 'style') parse(String(value)) }
  node.removeAttribute = name => { remove(name); if (name === 'style') declarations.clear() }
  node.hasAttribute = name => node.getAttribute(name) !== null
  node.closest = () => null
  node.getBoundingClientRect = () => ({ left: 500, top: 300, right: 548, bottom: 348, width: 48, height: 48 })
  node.cloneNode = () => new f.stage.constructor('svg')
  if (initial !== null) node.setAttribute('style', initial)
  f.slide.append(node)
  f.slide.querySelectorAll = selector => selector === 'svg, img' ? [node] : []
  return node
}

test('magnet точно восстанавливает style источника и сохраняет concurrent изменения владельца', () => {
  const started = Date.now(), cases = [], sourceSHA = createHash('sha256').update(readFileSync(new URL('../../runtime.js', import.meta.url))).digest('hex'),
    styles = [null, '', 'color: tomato;', ' COLOR: tomato; visibility : visible !important; --theme: stable; '],
    scenarios = [{ name: 'unchanged' },
      { name: 'host-color', edit: node => node.style.setProperty('color', 'blue') },
      { name: 'host-visibility', edit: node => node.style.setProperty('visibility', 'collapse', 'important') },
      { name: 'host-removes-style', edit: node => node.removeAttribute('style') }],
    snapshot = node => ({ attribute: node.getAttribute('style'), visibility: node.style.getPropertyValue('visibility'),
      priority: node.style.getPropertyPriority('visibility'), color: node.style.getPropertyValue('color'), theme: node.style.getPropertyValue('--theme') })
  for (const initial of styles) for (const finish of ['completion', 'reset', 'destroy']) for (const scenario of scenarios) {
    const f = runtimeFixture(), icon = styledIcon(f, initial)
    try {
      const before = snapshot(icon)
      assert.ok(f.raw.run(['magnet'])); f.raw.step(.4, 120)
      const during = snapshot(icon)
      scenario.edit?.(icon)
      const host = snapshot(icon)
      if (finish === 'completion') f.raw.step(7.4, 120)
      else if (finish === 'reset') f.raw.reset()
      else f.raw.destroy()
      const after = snapshot(icon), failures = []
      if (during.visibility !== 'hidden') failures.push('Источник действительно скрыт во время номера')
      if (scenario.name === 'unchanged' && JSON.stringify(after) !== JSON.stringify(before)) failures.push('Точный атрибут/value/priority не восстановлены')
      if (scenario.name === 'host-color' && (after.color !== 'blue' || after.visibility !== before.visibility || after.priority !== before.priority || after.theme !== before.theme))
        failures.push('Concurrent цвет/прочие свойства или исходная visibility потеряны')
      if (scenario.name === 'host-visibility' && JSON.stringify(after) !== JSON.stringify(host)) failures.push('Затёрта concurrent visibility владельца')
      if (scenario.name === 'host-removes-style' && after.attribute !== null) failures.push('Возвращён удалённый владельцем style')
      cases.push({ initial, finish, scenario: scenario.name, before, during, host, after, failures })
    } finally { f.close() }
  }
  const report = { startedUTC: new Date(started).toISOString(), finishedUTC: new Date().toISOString(), durationMs: Date.now() - started,
    sourceSHA, limits: 'Настоящий runtime/номер magnet; DOM/CSSOM fixture без браузера. Native exact-source проверка остаётся отдельной.', cases }
  if (process.env.BUDDY_MAGNET_SOURCE_REPORT) writeFileSync(process.env.BUDDY_MAGNET_SOURCE_REPORT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  assert.deepEqual(cases.filter(row => row.failures.length).map(row => ({ initial: row.initial, finish: row.finish, scenario: row.scenario,
    before: row.before, after: row.after, failures: row.failures })), [], 'Источник восстановлен без потери style/value/priority или concurrent host edits')
})

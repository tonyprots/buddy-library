// Вход готовой сборки dist/buddy.js: один классический скрипт без модулей и сервера (работает и через file://).
// Глобальный объект window.Buddy. С атрибутом data-stage скрипт сам подключает бадди к сцене.
import { createBuddy, techniques, abilityPresets, autoplayProfiles, behaviorModes, characters } from '../index.js'
import { attachDeckEffects } from '../effects.js'

export { createBuddy, techniques, abilityPresets, autoplayProfiles, behaviorModes, characters, attachDeckEffects }

const script = typeof document !== 'undefined' ? document.currentScript : null,
  selector = script?.dataset.stage
if (selector) {
  const mount = () => {
    const stage = document.querySelector(selector)
    if (!stage) { console.error(`Бадди: сцена ${selector} не найдена`); return }
    let brand
    if (script.dataset.brand) {
      try {
        const data = document.querySelector(script.dataset.brand)
        if (!data || data.type !== 'application/json') throw new TypeError('Нужен script type="application/json" с набором бренда')
        brand = JSON.parse(data.textContent)
      } catch (error) { console.error('Бадди: не удалось прочитать data-brand:', error); return }
    }
    window.buddy = createBuddy({ stage, slideSelector: script.dataset.slideSelector, activeClass: script.dataset.activeClass, brand })
    window.buddy.then(buddy => { window.buddy = buddy }, error => console.error('Бадди не запустился:', error))
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', mount, { once: true }) : mount()
}

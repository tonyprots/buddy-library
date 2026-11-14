// Локальный адаптер контрольной деки; маршруты задаёт deck-integration-check.mjs.
import { createBuddy } from '/library/index.js'
import { attachDeckEffects } from '/library/effects.js'

const params = new URLSearchParams(location.search), stage = document.querySelector('#deck'),
  rawShow = globalThis.go, slides = [...stage.querySelectorAll(':scope > .slide')]

await document.fonts.ready
const buddy = await createBuddy({ stage, autoplay: false, reactions: false, keyboard: false,
  renderer: params.get('renderer') === 'svg' ? 'svg' : 'auto',
  motion: params.get('motion') === 'reduce' ? 'reduce' : 'full', seed: 41 })
buddy.pause()
buddy.reset()

const show = async index => {
  rawShow(index)
  await new Promise(requestAnimationFrame)
  for (const animation of slides[index].getAnimations({ subtree: true }))
    animation.effect?.getComputedTiming().iterations !== Infinity && animation.finish()
  buddy.rescan()
}, effects = params.get('effects') === '1' ? attachDeckEffects({ stage, buddy, show: rawShow }) : null

globalThis.integration = Object.freeze({ buddy, effects, stage, slides, show,
  summary() {
    const world = buddy.experimental.W, rect = element => {
      const r = element.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    return { title: slides[world.idx]?.dataset.title, slide: world.idx, count: slides.length,
      state: buddy.state(), metrics: buddy.metrics(), logo: world.logo,
      platforms: world.plats.map(({ x1, x2, y, spans }) => ({ x1, x2, y, spans })),
      deck: rect(stage), brand: rect(stage.querySelector('.brand')), avatar: rect(stage.querySelector('[data-perch]')),
      brandText: rect(stage.querySelector('[data-perch-text]')),
      presets: buddy.presets, hosts: stage.querySelectorAll(':scope > .buddy').length }
  },
  dispose() { effects?.destroy(); buddy.destroy() }
})
globalThis.integrationReady = true

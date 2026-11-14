import { createBuddy, techniques, type Buddy, type TechniqueId, type SequenceTechniqueId } from '@tony-prots/buddy'
import { attachDeckEffects } from '@tony-prots/buddy/effects'
import { analyzeSlide, attachSlideIntelligence, createReactionPolicy, type DeepReadonly } from '@tony-prots/buddy/intelligence'
import { logos } from '@tony-prots/buddy/presets/y360'
import { analyzeSlideContext, type ContextStructure } from '@tony-prots/buddy/context'

declare const stage: HTMLElement

const buddy: Buddy = await createBuddy({ stage, slideSelector: '.pages > article', activeClass: 'is-active', renderer: 'svg', profile: 'calm', presets: { y360: true }, logos,
  signal: new AbortController().signal, reactions: { quietMs: 4000, onReaction(event) { console.log(event.kind, event.action) } } })
const id: TechniqueId = techniques[0]!.id, sequence: readonly SequenceTechniqueId[] = ['wave', 'note']
buddy.play(id)
buddy.sequence(sequence)
buddy.setMode('companion')
buddy.setCharacter('business')
buddy.focus(); buddy.focus(false)
const playback = buddy.story(['wave', { wait: .5 }, { lookAt: { x: 200, y: 300 }, duration: 2 }, { play: 'leap' }])
playback.cancel()
const playbackStatus: 'completed' | 'cancelled' | 'skipped' | 'failed' = (await playback.finished).status
void buddy.perform('nap', { duration: 5, signal: new AbortController().signal })
void playbackStatus
buddy.lookAt({ x: 200, y: 300 })
const hoodieColor: string = buddy.hoodie.color, hoodieSource: 'deck' | 'option' | 'default' | 'brand' = buddy.hoodie.source
void createBuddy({ stage, hoodie: 'auto' }); void createBuddy({ stage, hoodie: '#ff6427' })
const metrics: number = buddy.metrics().canvasPeakPixels
const drawingDensity: number = buddy.metrics().drawingBufferRatio
const displayDensity: number = buddy.metrics().screenRatio
const outlineWidth: number = buddy.metrics().outlineScreenPx
const canvasWidth: number = buddy.metrics().canvasWidth
const canvasHeight: number = buddy.metrics().canvasHeight
const bufferOutline: number = buddy.metrics().outlineBufferPx
buddy.setProfile('show')
buddy.setReactions(false)
const blocker: string = buddy.intelligence.inspect().verdict.reason
const actorLeft: number = buddy.framing().actor[0]
const factId: string | undefined = buddy.context().facts[0]?.id
buddy.selectContext(factId ?? null)
buddy.play('thinkNumber')
buddy.play('traceFlow')
buddy.sequence(['quoteIdea', 'assembleList'])
const structure: DeepReadonly<ContextStructure> | undefined = analyzeSlideContext(stage, stage).facts[0]?.structure
const pathX: number | undefined = buddy.context().facts[0]?.structure?.edges?.[0]?.points[0]?.x
const effects = attachDeckEffects({ stage, buddy, show(index) { console.log(index) } })
effects.armIntro('flip')
effects.go(1, 0)
const controller = attachSlideIntelligence({ stage, buddy })
controller.setProfile('live')
controller.setAutoplay(true)
controller.setReactions(false)
controller.inspect().world?.floor[0]?.[0]
controller.state().analysis?.target?.x
analyzeSlide(stage, stage).kind
const policy = createReactionPolicy<HTMLElement>()
policy.begin(stage, performance.now())
const verdict = policy.verdict(performance.now())
if (!verdict.ready) console.log(verdict.wait)
console.log(metrics)
console.log(drawingDensity, displayDensity, outlineWidth, canvasWidth, canvasHeight, bufferOutline)
console.log(blocker, actorLeft)
console.log(structure, pathX)

// @ts-expect-error Неизвестный приём должен обнаруживаться до запуска.
buddy.play('unknown')
// @ts-expect-error Удалённый приём больше не входит в публичный API.
buddy.play('binoculars')
// @ts-expect-error Диагностика только для чтения.
buddy.intelligence.inspect().world?.floor.push([])
// @ts-expect-error Контекст возвращается только для чтения.
buddy.context().facts.push({})
// @ts-expect-error Структурированные пути тоже доступны только для чтения.
buddy.context().facts[0]?.structure?.points?.push({ x: 1, y: 2 })
// @ts-expect-error Профиль ограничен каталогом.
buddy.setProfile('random')
// @ts-expect-error Постановочная сцена не является шагом sequence.
buddy.sequence(['leap'])
// @ts-expect-error Пресет принимает логическое значение.
createBuddy({ stage, presets: { superhuman: 'yes' } })
// @ts-expect-error Для подключения обязательна сцена.
createBuddy()
void createBuddy({ stage, brand: { logo: './logo.svg', products: ['./product.svg'], accent: '#3e8c74' } })
const brandMain: string | null = buddy.brand.logo
const productImages: readonly string[] = buddy.brand.products
void brandMain; void productImages

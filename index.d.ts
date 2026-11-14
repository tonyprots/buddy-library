import type { AutoplayProfileId, AutoplayProfile, ReactionOptions, SlideIntelligenceState, IntelligenceDiagnostics, DeepReadonly } from './slide-intelligence.js'
import type { ContextKind, SlideContextSnapshot } from './slide-context.js'

export type { AutoplayProfileId } from './slide-intelligence.js'
export { analyzeSlideContext, contextConcepts } from './slide-context.js'
export type { ContextKind, ContextConcept, ContextFact, ContextItem, ContextStructure, ContextPoint, ContextIssue, SlideContextSnapshot } from './slide-context.js'

export type TechniqueId =
  | 'idle' | 'lookSlide' | 'lookHall' | 'yawn' | 'sitRest' | 'sitLean' | 'nap'
  | 'wave' | 'clap' | 'point' | 'cheer' | 'dance'
  | 'stroll' | 'jog' | 'hop' | 'stumble' | 'handstand' | 'backflip' | 'climb' | 'pullups' | 'logo' | 'descend'
  | 'stretch' | 'squats' | 'jacks' | 'toeTouch' | 'sideBend' | 'shadowbox' | 'kick'
  | 'popcorn' | 'read' | 'note'
  | 'levitate' | 'shield' | 'laser' | 'shrink' | 'smoke' | 'lightning' | 'fire' | 'ice' | 'portal'
  | 'speed' | 'clone' | 'fly' | 'hulk' | 'web' | 'magnet' | 'tracker' | 'disk' | 'mail' | 'calendar'
  | 'grapple' | 'construct'
  | 'land' | 'stairs' | 'parachute' | 'finale' | 'leap' | 'flip'
  | 'salute' | 'bow' | 'present' | 'thumbsUp' | 'spotlight' | 'celebrate' | 'energyOrb' | 'forcePush'
  | 'sonicPulse' | 'energyBow' | 'orbit' | 'comet' | 'rain' | 'snow' | 'starcatch' | 'forceWall' | 'timeBubble'
  | 'laptopNotes' | 'thinkNumber' | 'hologramObject' | 'hologramKeyword' | 'traceFocus' | 'peekCard' | 'perchRead'
  | 'thinkKeyword' | 'compareValues' | 'followChart' | 'chartClimb' | 'cardRoute'
  | 'traceFlow' | 'inspectDetail' | 'assembleList' | 'showBeforeAfter' | 'quoteIdea'

export type SceneTechniqueId = 'land' | 'stairs' | 'parachute' | 'finale' | 'leap' | 'flip'
export type SequenceTechniqueId = Exclude<TechniqueId, SceneTechniqueId>
export type PresetId = 'superhuman' | 'brand' | 'y360'
export type LogoId = 'y360' | 'mail' | 'calendar' | 'disk' | 'docs' | 'telemost' | 'tracker'
export type LogoSet = Partial<Record<LogoId, string>>
export type BrandRole = 'disc' | 'message' | 'reminder' | 'mark' | 'board'
/** Набор из самой презентации. Отсутствующий/пустой набор не включает фирменные номера. */
export interface Brand {
  logo?: string | null
  products?: readonly string[]
  accent?: string | null
  /** Необязательно: изображения для конкретных ролей; иначе используются продукты и главный знак. */
  roles?: Partial<Record<BrandRole, string | null>>
}
export interface BrandSnapshot {
  readonly logo: string | null
  readonly products: readonly string[]
  readonly accent: string | null
  readonly roles: Readonly<Record<BrandRole, string | null>>
}
export type MotionPreference = 'system' | 'reduce' | 'full'
export type RendererPreference = 'auto' | 'svg'
export type RendererKind = 'webgl' | 'svg'
export type BubbleKind = '!' | '?' | '…' | 'heart' | 'bulb' | 'z'
export type BehaviorMode = 'manual' | 'companion' | 'show'
export type CharacterId = 'business' | 'curious' | 'playful'
export type PlaybackStatus = 'completed' | 'cancelled' | 'skipped' | 'failed'
export interface PlaybackResult {
  readonly status: PlaybackStatus
  /** Число завершённых шагов; при failed — индекс отказавшего шага (с нуля). */
  readonly step: number
  readonly reason?: string
}
export interface Playback {
  readonly finished: Promise<PlaybackResult>
  /** Заканчивает текущий номер, следующие шаги не запускает. На паузе ждёт resume/step. */
  cancel(): void
}
export interface PerformOptions {
  contextId?: string | null
  /** Только для nap: от 3 до 300 секунд. */
  duration?: number
  signal?: AbortSignal
}
export type StoryStep = TechniqueId | { play: TechniqueId; contextId?: string | null; duration?: number }
  | { wait: number } | { lookAt: LookTarget; duration: number }
export type TechniqueRequirement = 'floor' | 'wall' | 'platform' | 'icon' | 'brand' | 'elevated' |
  'land' | 'stairs' | 'finale' | 'content' | `logo:${LogoId}`

export interface Technique {
  readonly id: TechniqueId
  readonly title: string
  readonly description: string
  readonly group: string
  readonly requires: TechniqueRequirement
  readonly preset: PresetId | 'base'
  readonly tags?: readonly 'context'[]
  readonly contextKinds?: readonly ContextKind[]
  /** Длительность в секундах, когда она указана в реестре. */
  readonly duration?: number
}

export interface PresetDescriptor {
  readonly title: string
  readonly enabled: boolean
}

export interface LookTarget { x: number; y: number; z?: number }

export interface BuddyOptions {
  /** Сцена 1280×720; по умолчанию прямые дочерние .slide и активный класс on. */
  stage: HTMLElement
  /** CSS-селектор слайдов относительно stage. По умолчанию ':scope > .slide'. */
  slideSelector?: string
  /** Одно имя класса текущего слайда. По умолчанию 'on'. */
  activeClass?: string
  /** По умолчанию show. Единый режим; не сочетается с autonomous/autoplay в одном вызове. */
  mode?: BehaviorMode
  /** По умолчанию curious. Характер ограничивает только автоматический выбор. */
  character?: CharacterId
  /** Отдельно переданные изображения для примера y360. Без них — нейтральный реквизит и предупреждение. */
  logos?: LogoSet
  /** Явный набор бренда включает фирменные номера автоматически; имеет приоритет над старым logos. */
  brand?: Brand | null
  /** Своя жизнь: сам выбирает номера, смелеет к концу деки, лезет на блоки, проходит лестницу и финал.
   *  По умолчанию true, если не задан autoplay; при явном autoplay — false. Взаимоисключающе с autoplay. */
  autonomous?: boolean
  /** Самостоятельные номера через планировщик профилей calm/live/show. По умолчанию false. */
  autoplay?: boolean
  /** По умолчанию show; live для явного companion; calm для прежнего явного autoplay. */
  profile?: AutoplayProfileId
  keyboard?: boolean
  motion?: MotionPreference
  renderer?: RendererPreference
  /** Целое число 0…4294967295. */
  seed?: number
  presets?: Partial<Record<PresetId, boolean>>
  /** Цвет худи. 'auto' (по умолчанию) — преобладающий насыщенный цвет слайдов, без такого цвета исходное синее;
   *  'default' — всегда синее; иначе цвет #rgb, #rrggbb или rgb(). Считывается один раз при запуске. */
  hoodie?: 'auto' | 'default' | (string & {})
  reactions?: boolean | ReactionOptions
  signal?: AbortSignal
}

export interface BuddyState {
  x: number
  y: number
  act: string | null
  surf: string | null
  /** Есть физическая опора; true и на полу, и на карточке. */
  grounded: boolean
  level: number
  plats: number
  walls: number
  queue: number
  fx: number
  /** Модельное время в секундах. */
  time: number
  visible: boolean
  busy: boolean
  paused: boolean
  autoplay: boolean
  /** Своя жизнь включена. */
  autonomous: boolean
  mode: BehaviorMode
  character: CharacterId
  /** Запрошен спокойный режим; текущий номер и спуск ещё могут идти. */
  focusing: boolean
  /** Персонаж уже занял свободное место на полу. */
  focused: boolean
  performing: boolean
  renderer: RendererKind
  reducedMotion: boolean
}

export interface BuddyMetrics {
  frames: number
  meanFrameMs: number
  peakFrameMs: number
  scheduled: boolean
  timers: number
  canvasResizes: number
  canvasResizeMs: number
  canvasLastResizeMs: number
  canvasPeakPixels: number
  canvasPixels: number
  canvasReserveMs: number
  canvasReserved: boolean
  canvasWidth: number
  canvasHeight: number
  drawingBufferRatio: number
  screenRatio: number
  outlineBufferPx: number
  outlineScreenPx: number
  /** Жёсткий потолок backing pixels; supersampling имеет отдельный мягкий бюджет. */
  canvasPixelLimit: number
  canvasDimensionLimit: number
  canvasDensityLimit: 'none' | 'pixel-budget' | 'hardware'
  nativeDensityMet: boolean
  pixelRatioChanges: number
  lastFrameResized: boolean
}

export type FrameBounds = readonly [number, number, number, number]
export interface BuddyFraming {
  readonly actor: FrameBounds
  readonly props: FrameBounds | null
  /** Локальный смысловой результат: например, текст облачка рядом с героем. */
  readonly detail: FrameBounds | null
  readonly planned: FrameBounds | null
}

export interface Buddy {
  readonly renderer: RendererKind
  readonly reducedMotion: boolean
  readonly paused: boolean
  readonly profile: AutoplayProfileId
  readonly mode: BehaviorMode
  readonly character: CharacterId
  readonly intelligence: IntelligenceDiagnostics
  readonly presets: Readonly<Record<PresetId, boolean>>
  readonly brand: BrandSnapshot
  /** Итоговый цвет худи и откуда он: deck — подобран по слайдам, option — задан явно, default — исходный. */
  readonly hoodie: Readonly<{ color: string; source: 'deck' | 'option' | 'default' | 'brand' }>
  /** null означает, что известные предварительные условия выполнены. */
  can(id: TechniqueId): string | null
  /** true при запуске приёма или подхода к его месту; false при отказе планировщика. */
  play(id: TechniqueId): boolean
  /** В отличие от play, даёт ожидать завершение всей очереди номера. */
  perform(id: TechniqueId, options?: PerformOptions): Playback
  /** От 1 до 128 шагов; ожидания идут по модельному времени. */
  story(steps: readonly StoryStep[], options?: { signal?: AbortSignal }): Playback
  sequence(ids: readonly SequenceTechniqueId[]): boolean
  pause(): void
  resume(): void
  step(seconds?: number, fps?: number): void
  reset(): void
  autoplay(on: boolean): void
  /** Включает или выключает свою жизнь; включение выключает autoplay, и наоборот. */
  setAutonomous(on: boolean): void
  setProfile(id: AutoplayProfileId): void
  setMode(id: BehaviorMode): void
  setCharacter(id: CharacterId): void
  /** Закончить номер и спокойно встать на свободном полу; false возвращает заданный режим. */
  focus(on?: boolean): void
  setReactions(on: boolean): void
  progress(value: number): void
  say(kind: BubbleKind): void
  lookAt(target: LookTarget | null, duration?: number): void
  state(): BuddyState
  metrics(): BuddyMetrics
  /** Кэш границ в координатах сцены 1280×720; чтение не измеряет DOM. */
  framing(): BuddyFraming
  reactionState(): DeepReadonly<SlideIntelligenceState> | null
  context(): DeepReadonly<SlideContextSnapshot>
  selectContext(id: string | null): void
  rescan(): void
  destroy(): void
  /** Нестабильный внутренний интерфейс 0.x; его поля требуют явного уточнения типов. */
  readonly experimental: Readonly<Record<string, unknown>>
}

export const techniques: readonly Technique[]
export const behaviorModes: Readonly<Record<BehaviorMode, Readonly<{ title: string; profile: AutoplayProfileId }>>>
export const characters: Readonly<Record<CharacterId, Readonly<{ title: string }>>>
export const abilityPresets: Readonly<Record<PresetId, PresetDescriptor>>
export const autoplayProfiles: Readonly<Record<AutoplayProfileId, AutoplayProfile>>
export function createBuddy(options: BuddyOptions): Promise<Buddy>

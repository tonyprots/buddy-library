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
/** Assets from the presentation. A missing or empty set does not enable brand actions. */
export interface Brand {
  logo?: string | null
  products?: readonly string[]
  accent?: string | null
  /** Optional role-specific images; otherwise product images and the main logo are used. */
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
  /** Completed step count; on failure, the zero-based index of the rejected step. */
  readonly step: number
  readonly reason?: string
}
export interface Playback {
  readonly finished: Promise<PlaybackResult>
  /** Finishes the current action without starting later steps. While paused, waits for resume/step. */
  cancel(): void
}
export interface PerformOptions {
  contextId?: string | null
  /** For nap only: 3 to 300 seconds. */
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
  /** Duration in seconds when specified in the catalog. */
  readonly duration?: number
}

export interface PresetDescriptor {
  readonly title: string
  readonly enabled: boolean
}

export interface LookTarget { x: number; y: number; z?: number }

export interface BuddyOptions {
  /** A 1280×720 stage; defaults to direct .slide children and active class on. */
  stage: HTMLElement
  /** Slide selector relative to stage. Default: ':scope > .slide'. */
  slideSelector?: string
  /** A single active slide class name. Default: 'on'. */
  activeClass?: string
  /** Default: show. Cannot be combined with autonomous/autoplay in the same call. */
  mode?: BehaviorMode
  /** Default: curious. Character affects automatic choices only. */
  character?: CharacterId
  /** Explicit images for the y360 example. Missing images use neutral props with a warning. */
  logos?: LogoSet
  /** Brand images enable brand actions automatically and take priority over legacy logos. */
  brand?: Brand | null
  /** Self-directed actions, increasing confidence, climbing, stairs and finale. Defaults to true unless autoplay is explicit; mutually exclusive with autoplay. */
  autonomous?: boolean
  /** Interval-scheduled actions using calm/live/show profiles. Default: false. */
  autoplay?: boolean
  /** Default: show; live for explicit companion; calm for legacy explicit autoplay. */
  profile?: AutoplayProfileId
  keyboard?: boolean
  motion?: MotionPreference
  renderer?: RendererPreference
  /** An integer from 0 to 4294967295. */
  seed?: number
  presets?: Partial<Record<PresetId, boolean>>
  /** Hoodie color. Default auto uses the brand/deck accent, falling back to blue; default keeps blue. Also accepts #rgb, #rrggbb or rgb(). Read once at startup. */
  hoodie?: 'auto' | 'default' | (string & {})
  reactions?: boolean | ReactionOptions
  signal?: AbortSignal
}

export interface BuddyState {
  x: number
  y: number
  act: string | null
  surf: string | null
  /** Physical support exists, whether on the floor or a card. */
  grounded: boolean
  level: number
  plats: number
  walls: number
  queue: number
  fx: number
  /** Simulation time in seconds. */
  time: number
  visible: boolean
  busy: boolean
  paused: boolean
  autoplay: boolean
  /** Autonomous behavior is enabled. */
  autonomous: boolean
  mode: BehaviorMode
  character: CharacterId
  /** Focus requested; the current action or descent may still be running. */
  focusing: boolean
  /** Buddy has reached a free spot on the floor. */
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
  /** Hard backing-pixel limit; supersampling has a separate soft budget. */
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
  /** Local semantic result, such as bubble text beside Buddy. */
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
  /** Resolved hoodie color and its origin: brand, deck, explicit option or original default. */
  readonly hoodie: Readonly<{ color: string; source: 'deck' | 'option' | 'default' | 'brand' }>
  /** null means known prerequisites are satisfied; otherwise an English reason. */
  can(id: TechniqueId): string | null
  /** true when the action or its approach starts; false when the scheduler declines. */
  play(id: TechniqueId): boolean
  /** Unlike play, allows awaiting the entire action queue. */
  perform(id: TechniqueId, options?: PerformOptions): Playback
  /** 1 to 128 steps; waits use simulation time. */
  story(steps: readonly StoryStep[], options?: { signal?: AbortSignal }): Playback
  sequence(ids: readonly SequenceTechniqueId[]): boolean
  pause(): void
  resume(): void
  step(seconds?: number, fps?: number): void
  reset(): void
  autoplay(on: boolean): void
  /** Toggles autonomous behavior; enabling it disables autoplay and vice versa. */
  setAutonomous(on: boolean): void
  setProfile(id: AutoplayProfileId): void
  setMode(id: BehaviorMode): void
  setCharacter(id: CharacterId): void
  /** Finish the action and stand quietly on clear floor; false restores the chosen mode. */
  focus(on?: boolean): void
  setReactions(on: boolean): void
  progress(value: number): void
  say(kind: BubbleKind): void
  lookAt(target: LookTarget | null, duration?: number): void
  state(): BuddyState
  metrics(): BuddyMetrics
  /** Cached bounds in logical 1280×720 coordinates; reading does not measure the DOM. */
  framing(): BuddyFraming
  reactionState(): DeepReadonly<SlideIntelligenceState> | null
  context(): DeepReadonly<SlideContextSnapshot>
  selectContext(id: string | null): void
  rescan(): void
  destroy(): void
  /** Unstable 0.x internals. Fields require explicit type narrowing. */
  readonly experimental: Readonly<Record<string, unknown>>
}

export const techniques: readonly Technique[]
export const behaviorModes: Readonly<Record<BehaviorMode, Readonly<{ title: string; profile: AutoplayProfileId }>>>
export const characters: Readonly<Record<CharacterId, Readonly<{ title: string }>>>
export const abilityPresets: Readonly<Record<PresetId, PresetDescriptor>>
export const autoplayProfiles: Readonly<Record<AutoplayProfileId, AutoplayProfile>>
export function createBuddy(options: BuddyOptions): Promise<Buddy>

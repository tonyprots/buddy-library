import type { Buddy, TechniqueId } from './index.js'
import type { ContextConcept, ContextKind, SlideContextController, SlideContextSnapshot } from './slide-context.js'

export type SlideKind = 'finale' | 'divider' | 'image' | 'number' | 'title' | 'content' | 'off'
export type AutoplayProfileId = 'calm' | 'live' | 'show'
export interface AutoplayProfile {
  readonly title: string
  readonly quietMs: number
  readonly cooldownMs: number
  readonly ambientMs: readonly [number, number]
  readonly actions: readonly TechniqueId[]
}
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
export interface SlideEvidence {
  declared?: string
  disabled?: boolean
  heading?: string
  cover?: boolean
  divider?: boolean
  finale?: boolean
  imageCoverage?: number
  largeNumber?: boolean
}
export interface SlideClassification { kind: SlideKind; reason: string; confidence: number }
export interface SlideTarget {
  x: number
  y: number
  width: number
  height: number
  kind: 'image' | 'number' | 'title' | 'explicit'
}
export interface SlideAnalysis extends SlideClassification {
  available: boolean
  target: SlideTarget | null
  targets: SlideTarget[]
  explicitAction: string | null
  imageCoverage: number
  brand: { text: string; perch: boolean; perchText: boolean; surface: 'text' | 'avatar' | 'fallback'; techniques: TechniqueId[] } | null
}
export interface ReactionTimingOptions {
  /** Все интервалы задаются в миллисекундах. */
  quietMs?: number
  cooldownMs?: number
  revisitMs?: number
  staleMs?: number
  debounceMs?: number
}
export interface ReactionRecord {
  reason: string
  action: TechniqueId | null
  source?: 'semantic' | 'ambient' | null
  rejected?: string[]
  context?: { id: string; kind: ContextKind; text: string; concept?: ContextConcept }
}
export interface ReactionEvent extends ReactionRecord { kind: SlideKind; target: SlideTarget | null }
export interface ReactionOptions extends ReactionTimingOptions { onReaction?(event: ReactionEvent): void }
export interface ReactionPolicyState { at: number | null; consumed: boolean; lastReaction: number | null }
export type ReactionVerdict = { ready: true; reason: string } | {
  ready: false; reason: string; wait?: number; expired?: boolean
}
export interface ReactionPolicy<Key extends object = object> {
  begin(key: Key, now: number): void
  verdict(now: number, context?: { paused?: boolean; hidden?: boolean; reduced?: boolean; busy?: boolean }): ReactionVerdict
  consume(now: number): void
  skip(): void
  configure(options?: ReactionTimingOptions): void
  defer(now: number): void
  state(): ReactionPolicyState
}
export interface SlideIntelligenceState {
  profile: AutoplayProfileId
  autoplay: boolean
  reactions: boolean
  paused: boolean
  destroyed: boolean
  measures: number
  analysis: SlideAnalysis | null
  last: ReactionRecord
  policy: ReactionPolicyState
  nextAmbientAt: number | null
  scheduled: boolean
  context: SlideContextSnapshot | null
}
export interface SceneWorld {
  walls: { x: number; side: number; top: number; h: number }[]
  plats: { y: number; x1: number; x2: number; spans: number[][] }[]
  floor: number[][]
  logo: number[][] | null
}
export interface SlideInspection extends SlideIntelligenceState {
  verdict: ReactionVerdict
  candidates: { id: TechniqueId; reason: string | null }[]
  world: SceneWorld | null
  rhythm?: { quietMs: number; cooldownMs: number; ambientMs: readonly [number, number] }
}
export interface IntelligenceDiagnostics {
  state(): DeepReadonly<SlideIntelligenceState>
  inspect(): DeepReadonly<SlideInspection>
}
export interface SlideIntelligence {
  refresh(): void
  pause(): void
  resume(): void
  state(): DeepReadonly<SlideIntelligenceState>
  inspect(): DeepReadonly<SlideInspection>
  setProfile(id: AutoplayProfileId): void
  setAutoplay(on: boolean): void
  setReactions(on: boolean): void
  /** Сообщает о ручном действии: пропускает текущую реакцию и начинает паузу. */
  activity(id?: TechniqueId): void
  destroy(): void
}
export interface SlideIntelligenceOptions extends ReactionOptions {
  profile?: AutoplayProfileId
  seed?: number
  autoplay?: boolean
  reactions?: boolean
  world?(): SceneWorld
  /** Общая политика автоматических действий; ручные команды не ограничивает. */
  allowAutomatic?(id: TechniqueId): boolean
  slideContext?: SlideContextController
  contextTechniques?: readonly { id: TechniqueId; contextKinds: readonly ContextKind[] }[]
  stage: HTMLElement
  buddy: Pick<Buddy, 'paused' | 'reducedMotion' | 'state' | 'can' | 'play'> & Partial<Pick<Buddy, 'lookAt'>>
}

export function classifySlideEvidence(evidence?: SlideEvidence): SlideClassification
export function analyzeSlide(slide: HTMLElement, stage: HTMLElement): SlideAnalysis
export function createReactionPolicy<Key extends object = object>(options?: ReactionTimingOptions): ReactionPolicy<Key>
export function attachSlideIntelligence(options: SlideIntelligenceOptions): SlideIntelligence
export const autoplayProfiles: Readonly<Record<AutoplayProfileId, AutoplayProfile>>
export function resolveAutoplayProfile(id?: AutoplayProfileId): AutoplayProfile

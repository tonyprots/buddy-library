import type { Buddy } from './index.js'

export type IntroVariant = 'line' | 'leap' | 'flip'
export interface DeckEffectsOptions {
  stage: HTMLElement
  buddy: Pick<Buddy, 'experimental' | 'reducedMotion'>
  /** Синхронно переключает .on на слайд с указанным индексом. */
  show(index: number): void
  keyboard?: boolean
}

export interface DeckEffects {
  armIntro(variant?: IntroVariant): boolean
  go(index: number, currentIndex: number): void
  readonly glass: { n: number; ms: number; kf: number } | null
  destroy(): void
}

export function attachDeckEffects(options: DeckEffectsOptions): DeckEffects

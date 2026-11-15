import type { DeepReadonly } from './slide-intelligence.js'

export type ContextKind = 'number' | 'text' | 'keyword' | 'object' | 'card'
  | 'values' | 'images' | 'chart' | 'bars' | 'route' | 'flow' | 'list' | 'detail'
export type ContextConcept = 'memory' | 'target' | 'team' | 'chain' | 'link' | 'cloud' | 'rules' | 'search'
export interface ContextTarget { x: number; y: number; width: number; height: number }
export interface ContextPoint { x: number; y: number }
export interface ContextItem {
  id: string
  text: string
  label?: string
  target: ContextTarget
  kind?: ContextKind
  value?: string
  unit?: string
  checked?: boolean
}
export interface ContextStructure {
  items: ContextItem[]
  points?: ContextPoint[]
  edges?: { from: string; to: string; points: ContextPoint[] }[]
  /** Crop in stage coordinates; x/y is the top-left corner, not the center. */
  crop?: { x: number; y: number; width: number; height: number }
}
export interface ContextFact {
  id: string
  kind: ContextKind
  text: string
  concept?: ContextConcept
  target: ContextTarget
  reason: string
  priority: number
  structure?: ContextStructure
}
export interface SlideContextSnapshot {
  available: boolean
  facts: ContextFact[]
  issues: ContextIssue[]
  selectedId: string | null
  reason: string
  measures: number
}
export interface ContextIssue {
  id: string
  kind: ContextKind
  reason: string
  target: ContextTarget
}
export interface ResolvedContext {
  readonly fact: DeepReadonly<ContextFact>
  readonly element: HTMLElement | SVGElement
  readonly bounds: readonly [number, number, number, number]
  readonly parts?: readonly {
    readonly id: string
    readonly element: HTMLElement | SVGElement
    readonly bounds: readonly [number, number, number, number]
    /** Internal snapshot of the viewport and whether the root SVG can be copied accurately. */
    readonly media?: Readonly<{ width: number; height: number; copyable: boolean; reason: string | null }>
  }[]
}
export interface SlideContextController {
  refresh(): void
  invalidate(): void
  snapshot(): DeepReadonly<SlideContextSnapshot>
  select(id: string | null): void
  resolve(id: string): ResolvedContext | null
  destroy(): void
}
export const contextConcepts: DeepReadonly<Record<ContextConcept, { title: string; words: string[] }>>
export function extractContextNumbers(text: string): string[]
export function matchContextConcepts(text: string): { concept: ContextConcept; text: string; offset: number }[]
export function analyzeSlideContext(slide: HTMLElement, stage: HTMLElement): DeepReadonly<SlideContextSnapshot>
export function createSlideContext(options: {
  stage: HTMLElement
  techniques?: readonly { id: string; contextKinds: readonly ContextKind[] }[]
  onRefresh?(): void
}): SlideContextController

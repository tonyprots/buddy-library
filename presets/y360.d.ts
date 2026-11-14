import type { LogoId, BrandSnapshot } from '../index.js'

/** Фирменные знаки; импорт этого файла сам по себе не включает пресет. */
export const logos: Readonly<Record<LogoId, string>>
/** Тот же демонстрационный набор в общем формате бренда. */
export const brand: BrandSnapshot

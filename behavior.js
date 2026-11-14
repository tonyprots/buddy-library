import { resolveAutoplayProfile } from './slide-intelligence.js'

export const behaviorModes = Object.freeze({
  manual: Object.freeze({ title: 'Ручной', profile: 'live' }),
  companion: Object.freeze({ title: 'Спутник', profile: 'live' }),
  show: Object.freeze({ title: 'Шоу', profile: 'show' })
})

export const characters = Object.freeze({
  business: Object.freeze({ title: 'Деловой' }),
  curious: Object.freeze({ title: 'Любопытный' }),
  playful: Object.freeze({ title: 'Озорной' })
})

export function validateMode(id) {
  if (!Object.hasOwn(behaviorModes, id)) throw new RangeError(`Неизвестный режим: ${id}`)
  return id
}

export function validateCharacter(id) {
  if (!Object.hasOwn(characters, id)) throw new RangeError(`Неизвестный характер: ${id}`)
  return id
}

const aliases = { strollTop: 'stroll', lookDown: 'lookSlide', edgeSit: 'sitRest', sitLean: 'sitRest', gap: 'backflip' },
  sleepy = new Set(['nap', 'yawn']),
  unruly = new Set(['shadowbox', 'kick', 'stumble', 'popcorn']),
  businessExcluded = new Set([...unruly, 'dance', 'cheer', 'jacks', 'squats', 'handstand', 'backflip', 'hop', 'pullups']),
  interested = new Set(['lookSlide', 'point', 'note', 'read', 'climb', 'peekCard', 'perchRead'])

/** Одна политика для всех автоматических выборов. Ручные команды её не используют. */
export function createBehaviorPolicy(profile, character, techniques) {
  validateCharacter(character)
  const allowed = new Set([...resolveAutoplayProfile(profile).actions, 'idle', 'sitRest']),
    powers = new Set(techniques.filter(item => item.preset !== 'base').map(item => item.id))
  if (character === 'playful' && profile !== 'calm') for (const id of sleepy) allowed.add(id)
  const allows = name => {
    const id = aliases[name] || name
    if (!allowed.has(id)) return false
    if (sleepy.has(id) && character !== 'playful') return false
    if (character === 'business' && (businessExcluded.has(id) || powers.has(id))) return false
    return character !== 'curious' || !unruly.has(id)
  }
  return Object.freeze({
    profile, character, allows,
    quietSeconds: resolveAutoplayProfile(profile).quietMs / 1000,
    powerSeconds: resolveAutoplayProfile(profile).cooldownMs / 1000,
    sleepy: character === 'playful',
    weight(id) {
      if (!allows(id)) return 0
      // В шоу отдых остаётся передышкой, а не основным занятием героя.
      if (profile === 'show' && (id === 'idle' || id === 'edgeSit' || (aliases[id] || id) === 'sitRest')) return .3
      return character === 'curious' && interested.has(id) ? 1.6 : 1
    }
  })
}

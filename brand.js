import { parseColor } from './outfit.js'

const roleNames = ['disc', 'message', 'reminder', 'mark', 'board'],
  legacyRoles = { disc: 'disk', message: 'mail', reminder: 'calendar', mark: 'tracker', board: 'telemost' },
  image = value => {
    if (value == null) return null
    if (typeof value !== 'string' || !value.trim() || /^(?:javascript|vbscript):/i.test(value.trim())
      || /^data:/i.test(value.trim()) && !/^data:image\//i.test(value.trim()))
      throw new TypeError('Изображение бренда — непустой URL или data:image URI')
    return value.trim()
  }

/** Старые сервисные ключи переводятся в роли только на границе API. */
export function resolveBrand(input, logos = {}) {
  logos ??= {}
  if (input == null) input = {
    logo: logos.y360,
    products: ['mail', 'calendar', 'disk', 'docs', 'telemost', 'tracker'].map(id => logos[id]).filter(Boolean),
    roles: Object.fromEntries(Object.entries(legacyRoles).map(([role, id]) => [role, logos[id]]))
  }
  if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('brand — объект с logo, products и accent')
  if (input.products != null && !Array.isArray(input.products)) throw new TypeError('brand.products — массив изображений')
  if (input.roles != null && (typeof input.roles !== 'object' || Array.isArray(input.roles))) throw new TypeError('brand.roles — объект')
  const logo = image(input.logo), products = Object.freeze((input.products || []).map(value => {
    const url = image(value)
    if (!url) throw new TypeError('В brand.products не должно быть пустых изображений')
    return url
  })), rgb = input.accent == null ? null : parseColor(input.accent)
  if (input.accent != null && (!rgb || rgb.some(value => !Number.isFinite(value))
    || rgb.slice(0, 3).some(value => value < 0 || value > 255) || rgb[3] !== 1))
    throw new TypeError('brand.accent — непрозрачный цвет #rgb, #rrggbb или rgb()')
  const accent = rgb ? '#' + rgb.slice(0, 3).map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase() : null,
    roles = Object.freeze(Object.fromEntries(roleNames.map((role, index) => [
      role, Object.hasOwn(input.roles || {}, role) ? image(input.roles[role])
        : (role === 'board' ? logo : null) || (products.length ? products[index % products.length] : null) || logo
    ])))
  return Object.freeze({ logo, products, accent, roles })
}

export const hasBrandImages = brand => !!(brand.logo || brand.products.length || Object.values(brand.roles).some(Boolean))

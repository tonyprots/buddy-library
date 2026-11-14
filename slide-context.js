const structuredKinds = new Set(['values', 'images', 'chart', 'bars', 'route', 'flow', 'list', 'detail']),
  kinds = new Set(['number', 'text', 'keyword', 'object', 'card', ...structuredKinds]),
  dictionary = {
    memory: ['память', 'памяти', 'памятью', 'контекст', 'контекста', 'контексте', 'контекстом', 'контексты', 'контекстов', 'memory', 'context'],
    target: ['цель', 'цели', 'целей', 'целью', 'целям', 'целях', 'target', 'targets', 'goal', 'goals'],
    team: ['команда', 'команды', 'команду', 'команде', 'командой', 'агент', 'агенты', 'агентов', 'агентами', 'рой', 'роя', 'роем', 'team', 'teams', 'agent', 'agents', 'swarm'],
    chain: ['цепочка', 'цепочки', 'цепочку', 'цепочек', 'этап', 'этапы', 'этапов', 'этапа', 'workflow', 'workflows', 'pipeline', 'pipelines'],
    link: ['связь', 'связи', 'связей', 'связью', 'интеграция', 'интеграции', 'интеграцию', 'api', 'integration', 'connection', 'link'],
    cloud: ['облако', 'облака', 'облаке', 'облаком', 'облаков', 'cloud', 'clouds'],
    rules: ['правило', 'правила', 'правил', 'правилами', 'инструкция', 'инструкции', 'инструкцию', 'инструкций', 'checklist', 'rules', 'instruction', 'instructions'],
    search: ['поиск', 'поиска', 'поиске', 'поиском', 'найти', 'искать', 'search']
  }, labels = { memory: 'Memory and context', target: 'Goal', team: 'Team', chain: 'Chain', link: 'Connection', cloud: 'Cloud', rules: 'Rules', search: 'Search' },
  ignored = '.buddy, .brand, .nav, .dv-nav, [data-perch], [data-perch-text], [data-buddy-ignore], script, style, nav',
  blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'LI', 'UL', 'OL', 'TABLE', 'TR']),
  selectors = '[data-buddy-context], [data-buddy-focus], [data-buddy-target], [data-buddy-number], h1, h2, h3, strong, em, pre, code, img, svg, .card, .tile, [data-buddy-card]',
  numberPattern = /(?<![\p{L}\p{N}_.,])(?:[+−–-]?\s*)?(?:[$€£₽]\s*)?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d+)?(?:[ \u00a0\u202f]*(?:(?:тыс\.?|млн\.?|млрд\.?)(?:[ \u00a0\u202f]*(?:₽|€|\$|£|руб(?:\.|лей|ля|ль)?|USD|EUR|RUB))?|%|‰|×|x|₽|€|\$|£|руб(?:\.|лей|ля|ль)?|кг|мс|сек\.?|с|мин\.?|ч|дн\.?|дней|лет|год(?:а|ов)?|ms|min|h|s|USD|EUR|RUB|GB|TB|MB|ГБ|МБ|ТБ|°C))?(?![\p{L}\p{N}_])/giu,
  patterns = Object.entries(dictionary).map(([concept, words]) => [concept,
    new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.join('|')})(?![\\p{L}\\p{N}_])`, 'giu')]),
  freeze = value => {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze))
    if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, part]) => [key, freeze(part)])))
    return value
  },
  visible = element => {
    for (let node = element; node && node.nodeType !== 9; node = node.parentElement) {
      if (node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false
      const css = getComputedStyle(node)
      if (css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return false
    }
    return true
  },
  excluded = element => !!element.closest?.(ignored),
  negated = (text, offset, length = 0) => {
    const clause = text.slice(0, offset).split(/[.!?;,:]/u).at(-1), words = clause.match(/[\p{L}]+(?:['’][\p{L}]+)?/gu) || []
    const following = length ? text.slice(offset + length).split(/[.!?;,:]/u)[0].match(/[\p{L}]+(?:['’][\p{L}]+)?/gu) || [] : []
    return [...words.slice(-4), ...following.slice(0, 3)].some(word => /^(?:не|без|нет|никакой|никакая|никаких|not|no|without|never|isn't|isn’t)$/iu.test(word))
  },
  readText = element => {
    if (excluded(element) || !visible(element)) return ''
    if (element.tagName.toUpperCase() === 'BR') return '\n'
    const nodes = element.childNodes && [...element.childNodes]
    return nodes?.length ? nodes.map(node => {
      if (node.nodeType === 3) return node.nodeValue || ''
      if (node.nodeType !== 1) return ''
      const text = readText(node)
      return blockTags.has(node.tagName.toUpperCase()) ? `\n${text}\n` : text
    }).join('')
      : element.textContent || ''
  }

export const contextConcepts = freeze(Object.fromEntries(Object.entries(dictionary).map(([id, words]) => [id, { title: labels[id], words }])))

/** Число сохраняется вместе со знаком, разделителями и единицей; оценка успешности не выводится. */
export function extractContextNumbers(text) {
  return [...String(text).matchAll(numberPattern)].filter(match => {
    const before = text.slice(0, match.index), after = text.slice(match.index + match[0].length)
    return !/\d[/:−–-]$/u.test(before) && !/^[/:−–-]\d|^[.,]\d|^[%‰×₽€$£]/u.test(after)
  }).map(match => match[0].trim()).filter(Boolean)
}

/** Контролируемый словарь: полные слова и явные формы, без поиска подстрок и отрицательных упоминаний. */
export function matchContextConcepts(text) {
  const result = []
  for (const [concept, pattern] of patterns) for (const match of String(text).matchAll(pattern))
    if (!negated(text, match.index, match[0].length)) { result.push({ concept, text: match[0], offset: match.index }); break }
  return result.sort((a, b) => a.offset - b.offset)
}

const numericUnit = value => value.replace(/[+−–\-\d.,]/gu, '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru'),
  targetBounds = target => [target.x - target.width / 2, target.y - target.height / 2,
    target.x + target.width / 2, target.y + target.height / 2],
  sourceText = element => (element.getAttribute('data-buddy-text') || readText(element)).replace(/\s+/gu, ' ').trim(),
  stagePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1280 && point.y >= 0 && point.y <= 720,
  parseStagePoints = text => {
    try {
      const input = JSON.parse(text)
      if (!Array.isArray(input) || input.length < 2 || input.length > 64) return null
      const points = input.map(point => Array.isArray(point) && point.length === 2 ? { x: point[0], y: point[1] } : point)
      return points.every(stagePoint) && points.some(point => Math.hypot(point.x - points[0].x, point.y - points[0].y) > .1)
        ? points.map(({ x, y }) => ({ x, y })) : null
    } catch { return null }
  }

function svgMedia(element, target) {
  const width = element.clientWidth || element.width?.baseVal?.value || target.width,
    height = element.clientHeight || element.height?.baseVal?.value || target.height,
    result = reason => Object.freeze({ width, height, copyable: !reason, reason })
  if (![width, height].every(value => Number.isFinite(value) && value > 0))
    return result('Could not measure the source SVG viewport')
  try {
    if (typeof element.getScreenCTM === 'function') {
      const matrix = element.getScreenCTM()
      if (!matrix || ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite))
        return result('Could not determine the source SVG transform')
      const tolerance = 1e-7 * Math.max(Math.abs(matrix.a), Math.abs(matrix.d), Number.EPSILON)
      if (matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.b) > tolerance || Math.abs(matrix.c) > tolerance || matrix.is2D === false)
        return result('Root SVG rotation, skew or reflection is not supported; move the transform to an inner group')
    } else {
      const css = getComputedStyle(element)
      if (css.transform && css.transform !== 'none' || element.hasAttribute('transform'))
        return result('Could not validate the root SVG transform without a matrix')
    }
    return result(null)
  } catch { return result('Could not determine the source SVG transform') }
}

const finiteMatrix = matrix => matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite),
  transformPoint = (matrix, x, y) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f })

function svgCalibration(svg, stage) {
  let css
  for (let node = svg; node; node = node.parentElement) {
    const style = getComputedStyle(node), transform = style.transform
    if (node === svg) css = style
    if (transform && transform !== 'none') {
      const match = /^matrix\(([^)]+)\)$/u.exec(transform), values = match?.[1].trim().split(/[\s,]+/u).map(Number),
        tolerance = values ? 1e-7 * Math.max(Math.abs(values[0]), Math.abs(values[3]), Number.EPSILON) : 0
      if (!values || values.length !== 6 || !values.every(Number.isFinite) || values[0] <= 0 || values[3] <= 0
        || Math.abs(values[1]) > tolerance || Math.abs(values[2]) > tolerance)
        return { error: 'Root CSS rotation, skew or reflection of an SVG line is not supported; use an inner SVG group' }
    }
    if (style.rotate && style.rotate !== 'none' && !/^(?:[xyz]\s+)?0(?:deg|grad|rad|turn)?$/u.test(style.rotate)
      || style.scale && style.scale !== 'none' && !style.scale.split(/\s+/u).every(value => Number.isFinite(Number(value)) && Number(value) > 0))
      return { error: 'Root CSS rotation or reflection of an SVG line is not supported; use an inner SVG group' }
    if (node === stage) break
  }
  const matrix = svg.getScreenCTM?.(), box = svg.getBoundingClientRect(),
    borders = ['borderLeftWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth'].map(key => parseFloat(css[key]) || 0),
    width = (parseFloat(css.width) || svg.clientWidth) - (css.boxSizing === 'border-box' ? borders[0] + borders[2] : 0),
    height = (parseFloat(css.height) || svg.clientHeight) - (css.boxSizing === 'border-box' ? borders[1] + borders[3] : 0)
  if (!finiteMatrix(matrix) || ![width, height, box.width, box.height].every(value => Number.isFinite(value) && value > 0))
    return { error: 'Could not measure the SVG line viewport and matrix' }
  const view = svg.viewBox?.baseVal, ratio = svg.preserveAspectRatio?.baseVal
  let sx = 1, sy = 1, tx = 0, ty = 0
  if (view?.width > 0 && view.height > 0) {
    sx = width / view.width; sy = height / view.height
    if (ratio?.align !== 1) {
      sx = sy = ratio?.meetOrSlice === 2 ? Math.max(sx, sy) : Math.min(sx, sy)
      const alignment = (ratio?.align || 6) - 2
      tx = (width - view.width * sx) * (alignment % 3) / 2
      ty = (height - view.height * sy) * Math.floor(alignment / 3) / 2
    }
    tx -= view.x * sx; ty -= view.y * sy
  }
  const corners = [[-borders[0], -borders[1]], [width + borders[2], -borders[1]],
    [-borders[0], height + borders[3]], [width + borders[2], height + borders[3]]]
    .map(([x, y]) => transformPoint(matrix, (x - tx) / sx, (y - ty) / sy)),
    left = Math.min(...corners.map(point => point.x)), top = Math.min(...corners.map(point => point.y)),
    projectedWidth = Math.max(...corners.map(point => point.x)) - left,
    projectedHeight = Math.max(...corners.map(point => point.y)) - top
  if (!(projectedWidth > 0 && projectedHeight > 0)) return { error: 'Degenerate SVG line viewport' }
  // WebKit может сохранить экранный перенос, пропустив CSS scale предков
  // в линейной части CTM. Калибруем весь viewport, включая letterbox.
  return { x: box.width / projectedWidth, y: box.height / projectedHeight,
    left, top, screenLeft: box.left, screenTop: box.top }
}

function linePoints(element, stageBox, scale, stage, matrices) {
  const explicit = element.getAttribute('data-buddy-points')
  if (explicit !== null) return parseStagePoints(explicit)
  const tag = element.tagName.toLowerCase(), local = []
  try {
    if (tag === 'polyline') {
      const values = (element.getAttribute('points') || '').trim().split(/[\s,]+/u).map(Number)
      if (values.length < 4 || values.length > 128 || values.length % 2 || !values.every(Number.isFinite)) return null
      for (let i = 0; i < values.length; i += 2) local.push({ x: values[i], y: values[i + 1] })
    } else if (tag === 'line') {
      for (const suffix of ['1', '2']) {
        const x = element.getAttribute(`x${suffix}`), y = element.getAttribute(`y${suffix}`)
        if (x === null || y === null) return null
        local.push({ x: Number(x), y: Number(y) })
      }
    } else if (tag === 'path' && element.getTotalLength && element.getPointAtLength) {
      const path = element.getAttribute('d') || ''
      if (!path || /z/iu.test(path) || (path.match(/m/giu) || []).length !== 1) return null
      const length = element.getTotalLength()
      if (!Number.isFinite(length) || length <= 0) return null
      for (let i = 0; i < 64; i++) local.push(element.getPointAtLength(length * i / 63))
    } else return null
    const matrix = element.getScreenCTM?.()
    if (!finiteMatrix(matrix)) return null
    let svg = element.ownerSVGElement
    while (svg?.ownerSVGElement) svg = svg.ownerSVGElement
    if (svg && !matrices.has(svg)) matrices.set(svg, svgCalibration(svg, stage))
    const correction = svg ? matrices.get(svg) : null
    if (correction?.error) return correction
    const points = local.map(({ x, y }) => {
      const point = transformPoint(matrix, x, y)
      return { x: ((correction ? correction.screenLeft + (point.x - correction.left) * correction.x : point.x) - stageBox.left) / scale,
        y: ((correction ? correction.screenTop + (point.y - correction.top) * correction.y : point.y) - stageBox.top) / scale }
    })
    return points.every(stagePoint) && points.some(point => Math.hypot(point.x - points[0].x, point.y - points[0].y) > .1) ? points : null
  } catch { return null }
}

function structuredSource(container, kind, measure, stageBox, scale, stage, matrices) {
  const reject = error => ({ error }),
    owned = element => {
      for (let parent = element.parentElement; parent && parent !== container; parent = parent.parentElement)
        if (structuredKinds.has(parent.getAttribute('data-buddy-context'))) return false
      return !excluded(element) && visible(element)
    },
    descendants = selector => [...container.querySelectorAll(selector)].filter(owned),
    selector = kind === 'bars' ? '[data-buddy-bar]' : kind === 'flow' ? '[data-buddy-node]' : '[data-buddy-item]',
    nodes = kind === 'chart' ? [] : descendants(selector),
    limits = { values: [2, 2], images: [2, 2], bars: [2, 8], route: [2, 8], flow: [2, 12], list: [1, 8], detail: [1, 1] },
    parts = [], items = [], seen = new Set(), structure = { items }
  if (kind !== 'chart' && (nodes.length < limits[kind][0] || nodes.length > limits[kind][1]))
    return reject(`Structure ${kind} requires ${limits[kind][0] === limits[kind][1] ? `exactly ${limits[kind][0]}` : `between ${limits[kind][0]} and ${limits[kind][1]}`} visible parts`)
  if (kind === 'route' || kind === 'bars') {
    const steps = nodes.map(node => node.getAttribute('data-buddy-step'))
    if (steps.some(value => !/^[1-9]\d*$/u.test(value || '')) || new Set(steps.map(Number)).size !== steps.length)
      return reject('data-buddy-step order must use unique positive integers')
    nodes.sort((a, b) => Number(a.getAttribute('data-buddy-step')) - Number(b.getAttribute('data-buddy-step')))
  }
  for (const [index, node] of nodes.entries()) {
    const target = measure(node), id = node.getAttribute('data-buddy-node') || node.getAttribute('data-buddy-item')
        || node.getAttribute('data-buddy-bar') || `item-${index + 1}`,
      rawText = node.getAttribute('data-buddy-text') || readText(node),
      text = rawText.replace(/\s+/gu, ' ').trim() || node.getAttribute('alt') || node.getAttribute('aria-label') || '',
      label = (node.getAttribute('data-buddy-label') || node.getAttribute('aria-label') || '').trim(),
      image = /^(?:IMG|SVG)$/u.test(node.tagName.toUpperCase()) && !node.parentElement?.closest?.('svg')
    if (!target) return reject('A part has no visible, measurable area on the stage')
    if (seen.has(id) || id.length > 100 || kind === 'flow' && !node.getAttribute('data-buddy-node')?.trim())
      return reject('Parts must have unique nonempty IDs up to 100 characters')
    if (text.length > 180 || label.length > 80) return reject('Part text is limited to 180 characters and labels to 80')
    if ((kind === 'images' || kind === 'detail') && !image) return reject('An image part must be an IMG or root SVG')
    seen.add(id)
    const item = { id, text, target, kind: image ? 'object' : kind === 'route' || kind === 'bars' ? 'card' : 'text' }
    if (label) item.label = label
    if (kind === 'values' || kind === 'bars') {
      const declared = node.getAttribute('data-buddy-value'), values = extractContextNumbers(declared ?? rawText)
      if (kind === 'values' && values.length !== 1 || declared !== null && (values.length !== 1 || values[0] !== declared.trim()))
        return reject('Each numeric part must contain one exact value with its sign and unit')
      if (values.length === 1) { item.value = values[0]; item.unit = numericUnit(values[0]) }
      if (kind === 'values') item.kind = 'number'
    }
    if (kind === 'list') {
      const checkbox = node.matches?.('input[type="checkbox"]') ? node : node.querySelector('input[type="checkbox"]'),
        checked = node.getAttribute('data-buddy-checked')
      if (checked !== null && checked !== 'true' && checked !== 'false') return reject('data-buddy-checked accepts only true or false')
      if (checkbox && (!owned(checkbox) || !visible(checkbox))) return reject('The source checkbox is hidden or excluded from context')
      if (checkbox) item.checked = !!checkbox.checked
      else if (checked !== null) item.checked = checked === 'true'
    }
    items.push(item); parts.push({ id, element: node, bounds: targetBounds(target),
      ...((kind === 'images' || kind === 'detail') && node.tagName.toUpperCase() === 'SVG' ? { media: svgMedia(node, target) } : {}) })
  }
  if (kind === 'values' && items[0].unit !== items[1].unit) return reject('Both values must have matching units and scale for comparison')
  if (kind === 'chart') {
    const lines = container.hasAttribute('data-buddy-chart-line') ? [container] : descendants('[data-buddy-chart-line]')
    if (lines.length !== 1) return reject('A chart requires exactly one explicitly marked data-buddy-chart-line')
    structure.points = linePoints(lines[0], stageBox, scale, stage, matrices)
    if (structure.points?.error) return reject(structure.points.error)
    if (!structure.points) return reject('The chart line must be open, continuous and contain 2 to 64 points inside the stage')
  }
  if (kind === 'flow') {
    const edges = descendants('[data-buddy-from], [data-buddy-to]'), seenEdges = new Set()
    if (!edges.length || edges.length > 16) return reject('A diagram requires 1 to 16 explicitly marked links')
    structure.edges = []
    for (const edge of edges) {
      const from = edge.getAttribute('data-buddy-from'), to = edge.getAttribute('data-buddy-to'), key = `${from}\u0000${to}`,
        points = linePoints(edge, stageBox, scale, stage, matrices)
      if (!seen.has(from) || !seen.has(to)) return reject('A link references a missing or hidden node')
      if (from === to || seenEdges.has(key)) return reject('Duplicate links and self-loops are not supported')
      if (points?.error) return reject(points.error)
      if (!points) return reject('A link requires 2 to 64 finite points along its actual path inside the stage')
      seenEdges.add(key); structure.edges.push({ from, to, points })
    }
  }
  if (kind === 'detail') {
    try {
      const crop = JSON.parse(container.getAttribute('data-buddy-crop')), bounds = parts[0].bounds
      if (!Array.isArray(crop) || crop.length !== 4 || !crop.every(Number.isFinite) || crop[2] <= 0 || crop[3] <= 0
        || !stagePoint({ x: crop[0], y: crop[1] }) || !stagePoint({ x: crop[0] + crop[2], y: crop[1] + crop[3] })
        || crop[0] < bounds[0] || crop[1] < bounds[1] || crop[0] + crop[2] > bounds[2] || crop[1] + crop[3] > bounds[3])
        return reject('The crop must have positive dimensions and lie entirely within the image and stage')
      structure.crop = { x: crop[0], y: crop[1], width: crop[2], height: crop[3] }
    } catch { return reject('data-buddy-crop must contain JSON [x,y,width,height]') }
  }
  return { structure, parts }
}

function scan(slide, stage, identify = (_, index) => `source-${index + 1}`) {
  const stageBox = stage.getBoundingClientRect(), scale = stageBox.width / 1280 || 1, facts = [], issues = [], records = new Map(), matrices = new Map(),
    elements = [...slide.querySelectorAll(selectors)].slice(0, 200),
    measure = element => {
      const box = element.getBoundingClientRect(), target = { x: (box.left + box.width / 2 - stageBox.left) / scale,
        y: (box.top + box.height / 2 - stageBox.top) / scale, width: box.width / scale, height: box.height / scale }
      return Object.values(target).every(Number.isFinite) && target.width >= 2 && target.height >= 2
        && target.x + target.width / 2 > 0 && target.x - target.width / 2 < 1280
        && target.y + target.height / 2 > 0 && target.y - target.height / 2 < 720 ? target : null
    },
    add = (element, index, kind, text, target, priority, reason, concept, part = '', structure, parts) => {
      if (facts.length >= 80) return
      const base = element.getAttribute('data-buddy-context-id') || element.id || identify(element, index),
        key = `${base}:${kind}${part ? `:${part}` : ''}`, id = records.has(key) ? `${key}:${index}` : key,
        fact = freeze({ id, kind, text, target, priority, reason, ...(concept ? { concept } : {}), ...(structure ? { structure } : {}) })
      facts.push(fact); records.set(id, { fact, element,
        bounds: Object.freeze(targetBounds(target)),
        ...(parts ? { parts: Object.freeze(parts.map(item => Object.freeze({ ...item, bounds: Object.freeze([...item.bounds]) }))) } : {}) })
    }
  for (const [index, element] of elements.entries()) {
    if (excluded(element) || !visible(element)) continue
    const target = measure(element)
    if (!target) continue
    const structured = element.getAttribute('data-buddy-context')
    if (structuredKinds.has(structured)) {
      const result = structuredSource(element, structured, measure, stageBox, scale, stage, matrices)
      if (result.structure) {
        const crop = result.structure.crop, focus = crop ? { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2,
          width: crop.width, height: crop.height } : target,
          text = sourceText(element) || element.getAttribute('aria-label') || structured
        add(element, index, structured, text.slice(0, 180), focus, 440, 'Explicit slide structure', null, '', result.structure, result.parts)
      } else issues.push({ id: element.getAttribute('data-buddy-context-id') || element.id || identify(element, index),
        kind: structured, reason: result.error, target })
      continue
    }
    const marker = element.getAttribute('data-buddy-context'), explicit = kinds.has(marker),
      focused = element.hasAttribute('data-buddy-focus') || element.hasAttribute('data-buddy-target'),
      heading = /^H[123]$/u.test(element.tagName.toUpperCase()), quote = !!element.closest?.('blockquote, pre, code, [data-buddy-example]'),
      priority = (explicit ? 400 : focused ? 300 : heading ? 200 : 100) - (quote && !explicit ? 80 : 0),
      reason = explicit ? 'Explicit context marker' : focused ? 'Highlighted source' : heading ? 'Slide heading' : 'Visible highlighted content',
      raw = element.getAttribute('data-buddy-text') || readText(element), text = raw.replace(/\s+/gu, ' ').trim(),
      concept = element.getAttribute('data-buddy-concept'), isConcept = Object.hasOwn(dictionary, concept),
      matches = quote && !explicit ? [] : matchContextConcepts(raw),
      rawConcept = isConcept && [...raw.matchAll(patterns.find(([id]) => id === concept)[1])].length > 0,
      selectedMatches = isConcept ? (matches.some(item => item.concept === concept) || !rawConcept && !negated(raw, raw.length)
        ? [{ concept, text: text || labels[concept] }] : []) : matches,
      numbers = extractContextNumbers(raw)
    if ((!explicit || marker === 'number') && (heading || focused || explicit || element.hasAttribute('data-buddy-number') || parseFloat(getComputedStyle(element).fontSize) >= 40))
      for (const [part, number] of numbers.entries()) if (number.length <= 48)
        add(element, index, 'number', number, target, priority + 30, reason, null, String(part + 1))
    if ((!explicit || marker === 'keyword') && text && text.length <= 220)
      for (const match of selectedMatches) add(element, index, 'keyword', match.text, target, priority + 20, reason, match.concept, match.concept)
    if ((!explicit || marker === 'text') && text && text.length <= 180)
      add(element, index, 'text', text, target, priority + 10, reason)
    const media = /^(?:IMG|SVG)$/u.test(element.tagName.toUpperCase()) && !element.parentElement?.closest?.('svg'),
      card = element.matches?.('.card, .tile, [data-buddy-card]') || marker === 'card'
    if ((marker === 'object' || media && !explicit) && (media || isConcept))
      add(element, index, 'object', element.getAttribute('alt') || element.getAttribute('aria-label') || text || 'Image',
        target, priority, reason, isConcept ? concept : null)
    if (card && (!explicit || marker === 'card') && target.width >= 80 && target.height >= 45)
      add(element, index, 'card', text.slice(0, 180) || 'Card', target, priority, reason)
  }
  facts.sort((a, b) => b.priority - a.priority)
  return { records, snapshot: freeze({ available: stageBox.width > 0 && stageBox.height > 0 && visible(slide),
    facts, issues, selectedId: null, measures: 1,
    reason: issues[0]?.reason || (facts.length ? 'Automatic selection by markers, emphasis and heading' : 'No suitable source found') }) }
}

/** Измеряет видимые источники в координатах 1280×720; DOM-ссылки в результат не попадают. */
export function analyzeSlideContext(slide, stage) { return scan(slide, stage).snapshot }

/** Внутренний кэш контекста. События сцены обслуживает единый slide-intelligence. */
export function createSlideContext({ stage, presentation, techniques = [], onRefresh }) {
  const ids = new WeakMap(), requirements = new Map(techniques.map(item => [item.id, new Set(item.contextKinds)]))
  let current = null, selectedId = null, dirty = true, dead = false, records = new Map(), serial = 0, revision = 0,
    data = freeze({ available: false, facts: [], issues: [], selectedId: null, reason: 'No active slide', measures: revision })
  const activeSlide = presentation?.current || (() => stage.querySelector(':scope > .slide.on') || stage.querySelector(':scope > .slide')),
    refresh = () => {
      if (dead) return
      const slide = activeSlide()
      if (current !== slide) selectedId = null
      current = slide; dirty = false; revision++
      if (!slide) {
        records.clear(); data = freeze({ available: false, facts: [], issues: [], selectedId: null, reason: 'No active slide', measures: revision })
        onRefresh?.(); return
      }
      const result = scan(slide, stage, element => {
        if (!ids.has(element)) ids.set(element, `source-${++serial}`)
        return ids.get(element)
      })
      records = result.records
      if (!records.has(selectedId)) selectedId = null
      data = freeze({ ...result.snapshot, selectedId, reason: selectedId ? 'Source selected manually' : result.snapshot.reason, measures: revision })
      onRefresh?.()
    },
    ensure = () => { if (!dead && (dirty || current !== activeSlide())) refresh() }
  return Object.freeze({
    refresh, invalidate() { dirty = true },
    snapshot() { ensure(); return data },
    select(id) {
      if (dead) throw new Error('Context disabled')
      ensure()
      if (id !== null && (typeof id !== 'string' || !records.has(id))) throw new RangeError('Unknown context source')
      selectedId = id; data = freeze({ ...data, selectedId, reason: id ? 'Source selected manually'
        : data.issues[0]?.reason || 'Automatic selection by markers, emphasis and heading' })
    },
    resolve(id) {
      ensure()
      if (!data.available) return null
      const allowed = requirements.get(id)
      if (!allowed) return null
      const candidates = selectedId ? data.facts.filter(item => item.id === selectedId && allowed.has(item.kind))
        : data.facts.filter(item => allowed.has(item.kind))
      if (!candidates.length || !selectedId && candidates[1]?.priority === candidates[0].priority) return null
      const record = records.get(candidates[0].id)
      return record && current?.contains(record.element) && visible(record.element) && !excluded(record.element)
        && (!record.parts || record.parts.every(part => current.contains(part.element) && visible(part.element) && !excluded(part.element))) ? record : null
    },
    destroy() { dead = true; records.clear(); current = null; dirty = false; data = freeze({ available: false, facts: [], issues: [], selectedId: null, reason: 'Context disabled', measures: revision }) }
  })
}

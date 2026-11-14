const sceneTypes = new Set(['finale', 'divider', 'image', 'number', 'title', 'content', 'off']),
  sceneAliases = Object.freeze({ stat: 'number', numbers: 'number', empty: 'content', platforms: 'content', stairs: 'content' }),
  calmActions = new Set(['idle']),
  choices = {
    finale: ['bow', 'celebrate', 'wave'],
    divider: ['salute', 'present', 'lookSlide'],
    image: ['present', 'point', 'lookSlide'],
    number: ['note', 'point'],
    title: ['salute', 'wave', 'lookSlide'],
    content: []
  }, defaults = Object.freeze({ quietMs: 4000, cooldownMs: 20000, revisitMs: 90000, staleMs: 16000, debounceMs: 140 })

export const autoplayProfiles = Object.freeze(Object.fromEntries(Object.entries({
  calm: { title: 'Спокойный', quietMs: 6000, cooldownMs: 45000, ambientMs: [30000, 50000],
    actions: ['lookSlide', 'lookHall', 'wave', 'salute', 'bow', 'point', 'present', 'thumbsUp', 'note', 'read', 'stretch', 'sideBend', 'stroll', 'thinkNumber', 'thinkKeyword', 'traceFocus'] },
  live: { title: 'Живой', quietMs: 4000, cooldownMs: 24000, ambientMs: [18000, 30000],
    actions: ['wave', 'clap', 'salute', 'bow', 'point', 'present', 'thumbsUp', 'sonicPulse', 'note', 'read', 'rain', 'spotlight',
      'stretch', 'squats', 'toeTouch', 'sideBend', 'stroll', 'jog', 'hop', 'logo', 'climb', 'descend', 'popcorn',
      'thinkNumber', 'traceFocus', 'laptopNotes', 'hologramObject', 'hologramKeyword', 'peekCard', 'perchRead',
      'thinkKeyword', 'compareValues', 'followChart', 'traceFlow', 'inspectDetail', 'assembleList', 'showBeforeAfter', 'quoteIdea'] },
  show: { title: 'Шоу', quietMs: 2500, cooldownMs: 14000, ambientMs: [10000, 18000],
    actions: ['wave', 'clap', 'cheer', 'dance', 'celebrate', 'salute', 'bow', 'point', 'present', 'thumbsUp', 'sonicPulse',
      'note', 'read', 'rain', 'spotlight', 'stretch', 'squats', 'jacks', 'shadowbox', 'kick', 'stroll', 'jog', 'hop',
      'stumble', 'handstand', 'backflip', 'logo', 'climb', 'pullups', 'descend', 'popcorn', 'levitate', 'shield',
      'laser', 'shrink', 'smoke', 'lightning', 'fire', 'ice', 'portal', 'speed', 'clone', 'fly', 'hulk', 'web',
      'magnet', 'tracker', 'disk', 'mail', 'calendar', 'grapple', 'construct', 'energyOrb', 'forcePush', 'energyBow',
      'orbit', 'comet', 'snow', 'starcatch', 'forceWall', 'timeBubble',
      'thinkNumber', 'traceFocus', 'laptopNotes', 'hologramObject', 'hologramKeyword', 'peekCard', 'perchRead',
      'thinkKeyword', 'compareValues', 'followChart', 'chartClimb', 'cardRoute', 'traceFlow', 'inspectDetail', 'assembleList', 'showBeforeAfter', 'quoteIdea'] }
}).map(([id, value]) => [id, Object.freeze({ ...value, ambientMs: Object.freeze(value.ambientMs), actions: Object.freeze(value.actions) })])))

export function resolveAutoplayProfile(id = 'calm') {
  if (!Object.hasOwn(autoplayProfiles, id)) throw new RangeError(`Неизвестный профиль автопилота: ${id}`)
  return autoplayProfiles[id]
}

/** Классифицирует уже измеренные признаки. DOM и случайность в решении не участвуют. */
export function classifySlideEvidence(evidence = {}) {
  const { declared, disabled = false, heading = '', cover = false, divider = false,
    finale = false, imageCoverage = 0, largeNumber = false } = evidence
  if (disabled || declared === 'off') return { kind: 'off', reason: 'Отключено разметкой', confidence: 1 }
  if (sceneTypes.has(declared)) return { kind: declared, reason: 'Явная роль слайда', confidence: 1 }
  if (finale || /^(?:спасибо(?:\s+за\s+внимание)?|вопросы\??|thank\s+you|questions\??)[.!\s]*$/iu.test(heading.trim()))
    return { kind: 'finale', reason: finale ? 'Отмечена цель финального полёта' : 'Финальный заголовок', confidence: .95 }
  if (divider) return { kind: 'divider', reason: 'Перебивка размечена классом или ролью', confidence: .95 }
  if (cover) return { kind: 'title', reason: 'Обложка', confidence: .95 }
  if (imageCoverage >= .3) return { kind: 'image', reason: 'Изображение занимает не менее 30% слайда', confidence: .85 }
  if (largeNumber) return { kind: 'number', reason: 'Выделено крупное число', confidence: .8 }
  return { kind: 'content', reason: 'Обычный содержательный слайд', confidence: .6 }
}

/** Политика реакций: одно событие на посещение, тишина после смены, глобальная и повторная паузы. */
export function createReactionPolicy(options = {}) {
  const config = { ...defaults, ...options }, history = new WeakMap()
  let visit = null, lastReaction = -Infinity
  const configure = (input = {}) => {
    const next = { ...config, ...input }
    for (const name of ['quietMs', 'cooldownMs', 'revisitMs', 'staleMs', 'debounceMs'])
      if (!Number.isFinite(next[name]) || next[name] < 0) throw new RangeError(`Некорректный интервал ${name}`)
    Object.assign(config, next)
  }
  configure()
  return {
    configure,
    begin(key, now) { visit = { key, at: now, consumed: false } },
    verdict(now, { paused = false, hidden = false, reduced = false, busy = false } = {}) {
      if (!visit) return { ready: false, reason: 'Нет активного слайда' }
      if (visit.consumed) return { ready: false, reason: 'Реакция этого посещения завершена' }
      if (paused || hidden || reduced) return { ready: false, reason: paused ? 'Пауза' : hidden ? 'Вкладка скрыта' : 'Уменьшенное движение' }
      const quietLeft = config.quietMs - (now - visit.at)
      if (quietLeft > 0) return { ready: false, reason: 'Тихое окно', wait: quietLeft }
      if (now - visit.at > config.quietMs + config.staleMs) return { ready: false, reason: 'Момент реакции прошёл', expired: true }
      const remaining = Math.max(config.cooldownMs - (now - lastReaction), config.revisitMs - (now - (history.get(visit.key) ?? -Infinity)))
      if (remaining > 0) return { ready: false, reason: 'Пауза между реакциями', wait: remaining }
      if (busy) return { ready: false, reason: 'Персонаж занят', wait: 750 }
      return { ready: true, reason: 'Можно реагировать' }
    },
    consume(now) {
      if (!visit || visit.consumed) return
      visit.consumed = true; history.set(visit.key, now); lastReaction = now
    },
    skip() { if (visit) visit.consumed = true },
    defer(now) { lastReaction = now; if (visit) visit.consumed = true },
    state() { return { at: visit?.at ?? null, consumed: visit?.consumed ?? false, lastReaction: Number.isFinite(lastReaction) ? lastReaction : null } }
  }
}

const visible = element => {
  for (let node = element; node; node = node.parentElement) {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  }
  return true
}

/** Измеряет активный слайд один раз, при изменении его содержания или размеров. */
export function analyzeSlide(slide, stage, slides) {
  const bounds = stage.getBoundingClientRect(), scale = bounds.width / 1280 || 1,
    rect = element => {
      const box = element.getBoundingClientRect()
      return { x: (box.left + box.width / 2 - bounds.left) / scale,
        y: (box.top + box.height / 2 - bounds.top) / scale,
        width: box.width / scale, height: box.height / scale }
    }, heading = slide.querySelector('h1, h2'),
    annotated = slide.querySelector('[data-buddy-focus]') || slide.querySelector('[data-buddy-target]'),
    targets = [], media = [...slide.querySelectorAll('img, video, svg, canvas')].slice(0, 80)
  let imageCoverage = 0, imageTarget = null, numberTarget = null
  for (const element of media) {
    const svg = element.closest('svg')
    if (element.closest('.buddy, [data-buddy-ignore]') || !visible(element) || svg && svg !== element) continue
    const box = rect(element), coverage = box.width * box.height / (1280 * 720)
    if (box.width < 200 || box.height < 140) continue
    if (coverage > imageCoverage) { imageCoverage = coverage; imageTarget = { ...box, kind: 'image' } }
  }
  for (const element of [...slide.querySelectorAll('[data-buddy-number], h1, h2, h3, strong, .stat, .num')].slice(0, 100)) {
    if (element.closest('[data-buddy-ignore]') || !visible(element) || !/\d/u.test(element.textContent)) continue
    if (!element.hasAttribute('data-buddy-number') && parseFloat(getComputedStyle(element).fontSize) < 40) continue
    const box = rect(element)
    if (box.width > 0 && box.height > 0 && (!numberTarget || box.height > numberTarget.height)) numberTarget = { ...box, kind: 'number' }
  }
  if (heading && visible(heading)) targets.push({ ...rect(heading), kind: 'title' })
  if (imageTarget) targets.push(imageTarget)
  if (numberTarget) targets.push(numberTarget)
  if (annotated && visible(annotated)) targets.unshift({ ...rect(annotated), kind: 'explicit' })
  const explicitAction = slide.getAttribute('data-buddy-react'), role = slide.getAttribute('data-buddy-scene') ||
      slide.getAttribute('data-buddy-kind') || slide.getAttribute('data-scene'), declared = sceneAliases[role] || role,
    classification = classifySlideEvidence({ declared, disabled: explicitAction === 'none', heading: heading?.textContent || '',
      finale: !!slide.querySelector('[data-buddy-fly]'), cover: slide.classList.contains('cover'),
      divider: slide.classList.contains('divider') || slide.getAttribute('role') === 'separator', imageCoverage,
      largeNumber: !!numberTarget }),
    target = targets.find(item => item.kind === 'explicit') || targets.find(item => item.kind === classification.kind) || targets[0] || null
  const brand = stage.querySelector('.brand'), perch = brand?.querySelector('[data-perch]'), text = brand?.querySelector('[data-perch-text]'),
    index = (slides || [...stage.querySelectorAll(':scope > .slide')]).indexOf(slide)
  return { ...classification, available: bounds.width > 0 && bounds.height > 0 && visible(slide), target, targets,
    explicitAction: explicitAction && explicitAction !== 'none' ? explicitAction : null,
    imageCoverage: Math.round(imageCoverage * 1000) / 1000,
    brand: brand ? { text: text?.textContent?.trim() || '', perch: !!perch, perchText: !!text,
      surface: text && (!perch || index % 3) ? 'text' : perch ? 'avatar' : 'fallback', techniques: ['logo', 'descend'] } : null }
}

const snapshot = value => {
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot))
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, part]) => [key, snapshot(part)])))
  return value
}

const layoutStyle = element => (element.getAttribute('style') || element.style?.cssText || '')
  .replace(/(?:^|;)\s*(?:transform(?:-origin)?|translate|rotate|scale|zoom)\s*:[^;]*/giu, '')
  .replace(/^[;\s]+|[;\s]+$/gu, '')

/** Единый режиссёр: реакции на слайд и редкие самостоятельные действия без прерывания пользователя. */
export function attachSlideIntelligence({ stage, buddy, presentation, profile = 'calm', seed = 1, autoplay = false,
  reactions = true, world, slideContext, contextTechniques = [], allowAutomatic = () => true, ...options }) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed — целое 0…4294967295')
  if (typeof autoplay !== 'boolean' || typeof reactions !== 'boolean') throw new TypeError('autoplay и reactions — логические значения')
  const contextIds = new Set(contextTechniques.map(item => item.id)),
    timing = () => ({ ...defaults, ...resolveAutoplayProfile(profile), ...options }),
    config = timing(), policy = createReactionPolicy(config), now = () => performance.now(), observers = [],
    currentSlide = presentation?.current || (() => stage.querySelector(':scope > .slide.on') || stage.querySelector(':scope > .slide')),
    random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 },
    shuffle = items => {
      const result = [...items]
      for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]] }
      return result
    }
  let current = null, analysis = null, timer = 0, debounce = 0, paused = false, destroyed = false, directing = false,
    last = { reason: 'Подключение', action: null, source: null }, measures = 0, candidates = [], candidateKey = '', ambientBag = [],
    lastAction = null, lastActivity = -Infinity, nextAmbientAt = Infinity, contextVisitUsed = false,
    stageLayoutStyle = layoutStyle(stage)
  const clear = () => { clearTimeout(timer); timer = 0 },
    resetAmbient = () => {
      const [min, max] = config.ambientMs
      nextAmbientAt = now() + Math.max(config.cooldownMs, min + random() * (max - min))
    },
    contextCandidates = () => {
      const allowed = new Set(config.actions), contextual = !contextVisitUsed && analysis?.kind !== 'off'
        ? contextTechniques.filter(item => allowed.has(item.id)).map(item => ({ id: item.id, source: slideContext?.resolve(item.id) })).filter(item => item.source) : [],
        priority = Math.max(...contextual.map(item => item.source.fact.priority)),
        preferred = contextual.filter(item => item.source.fact.priority === priority)
      return new Set(preferred.map(item => item.source.fact.id)).size === 1 ? preferred.map(item => item.id) : []
    },
    chooseCandidates = () => {
      const allowed = new Set(config.actions), contextual = contextCandidates(),
        ids = analysis?.explicitAction ? [analysis.explicitAction] : contextual.length ? contextual
          : (choices[analysis?.kind] || []).filter(id => allowed.has(id)), key = ids.join()
      if (candidateKey !== key) { candidateKey = key; candidates = analysis?.explicitAction ? ids : shuffle(ids) }
    },
    context = () => {
      const state = buddy.state()
      return { paused: paused || buddy.paused, hidden: document.hidden, reduced: buddy.reducedMotion,
        busy: state.queue > 0 || state.busy || !calmActions.has(state.act), invisible: state.visible === false }
    },
    later = wait => {
      clear()
      if (!destroyed && !paused && (autoplay || reactions)) timer = setTimeout(react, Math.max(20, Math.min(wait, 60000)))
    },
    blocked = ctx => ctx.paused ? 'Пауза' : ctx.hidden ? 'Вкладка скрыта' : ctx.reduced ? 'Уменьшенное движение'
      : ctx.invisible ? 'Сцена вне экрана' : !analysis?.available ? 'Сцена скрыта или не имеет размеров' : null,
    schedule = () => {
      if (destroyed || paused || !analysis || (!autoplay && !reactions)) return
      const ctx = context(), reason = blocked(ctx)
      if (reason) { clear(); if (ctx.invisible && !ctx.hidden && !ctx.reduced) later(1000); return }
      const verdict = reactions && analysis.kind !== 'off' ? policy.verdict(now(), ctx) : null,
        semanticWait = verdict?.ready ? 20 : verdict?.wait ?? Infinity,
        ambientWait = autoplay ? Math.max(20, nextAmbientAt - now(), config.cooldownMs - (now() - lastActivity)) : Infinity
      if (verdict?.expired) policy.skip()
      const wait = Math.min(semanticWait, ambientWait)
      Number.isFinite(wait) && later(wait)
    },
    attempt = (ids, source) => {
      const rejected = [], automaticContext = new Set(contextCandidates())
      let selected = null
      directing = true
      try {
        for (const id of ids) {
          if (!allowAutomatic(id)) { rejected.push(`${id}: не подходит профилю или характеру`); continue }
          if (contextIds.has(id) && contextVisitUsed) { rejected.push(`${id}: контекстная история этого посещения уже показана`); continue }
          if (contextIds.has(id) && !automaticContext.has(id) && !(source === 'semantic' && analysis.explicitAction === id)) {
            rejected.push(`${id}: источник неоднозначен или ниже приоритета выбранного контекста`); continue
          }
          if (id === lastAction) { rejected.push(`${id}: повтор предыдущего действия`); continue }
          try {
            const reason = buddy.can(id)
            if (reason) { rejected.push(`${id}: ${reason}`); continue }
            if (buddy.play(id) !== false) { selected = id; break }
            rejected.push(`${id}: планировщик отказал в запуске`)
          } catch (error) { rejected.push(`${id}: ${error.message}`) }
        }
      } finally { directing = false }
      if (selected) { lastAction = selected; if (contextIds.has(selected)) contextVisitUsed = true }
      lastActivity = now(); resetAmbient()
      const fact = selected && contextIds.has(selected) ? slideContext?.resolve(selected)?.fact : null
      last = { reason: fact ? fact.reason : selected ? source === 'semantic' ? analysis.reason : 'Самостоятельное действие профиля'
        : ids.length ? 'Доступен только взгляд' : 'Сдержанный взгляд на содержание', action: selected, source, rejected,
        ...(fact ? { context: { id: fact.id, kind: fact.kind, text: fact.text, ...(fact.concept ? { concept: fact.concept } : {}) } } : {}) }
      options.onReaction?.(snapshot({ ...last, kind: analysis.kind, target: analysis.target }))
    },
    react = () => {
      timer = 0
      if (destroyed || paused || !analysis) return
      const ctx = context(), reason = blocked(ctx)
      if (reason) { last = { reason, action: null, source: null }; schedule(); return }
      const verdict = reactions && analysis.kind !== 'off' ? policy.verdict(now(), ctx) : null
      if (verdict?.ready) {
        if (analysis.target) buddy.lookAt?.({ x: analysis.target.x, y: analysis.target.y, z: 0 }, 2.4)
        attempt(candidates, 'semantic'); policy.consume(now())
      } else if (autoplay && now() >= nextAmbientAt && now() - lastActivity >= config.cooldownMs) {
        // Занятый персонаж пропускает момент: после завершения не играет накопленный номер.
        if (ctx.busy) resetAmbient()
        else {
          if (!ambientBag.length) ambientBag = shuffle(config.actions)
          const ids = ambientBag.splice(0, Math.min(8, ambientBag.length))
          if (buddy.state().surf !== 'floor' && config.actions.includes('descend')) ids.unshift('descend')
          attempt(ids, 'ambient')
        }
      }
      schedule()
    },
    refresh = () => {
      if (destroyed) return
      const slide = currentSlide()
      clear()
      if (!slide) { current = null; analysis = null; return }
      const changed = current !== slide
      if (changed) { current = slide; contextVisitUsed = false; policy.begin(slide, now()); resetAmbient() }
      slideContext?.refresh()
      analysis = analyzeSlide(slide, stage, presentation?.slides); measures++
      if (changed) candidateKey = ''
      chooseCandidates()
      if (changed) last = { reason: 'Новый слайд, тихое окно', action: null, source: null }
      schedule()
    },
    requestRefresh = () => {
      if (destroyed) return
      slideContext?.invalidate()
      clearTimeout(debounce)
      debounce = setTimeout(refresh, config.debounceMs)
    },
    visibility = () => { if (document.hidden) clear(); else { resetAmbient(); refresh() } },
    motionChanged = () => { resetAmbient(); requestRefresh() },
    inputChanged = event => {
      const element = event.target?.nodeType === 1 ? event.target : event.target?.parentElement
      if (element && !element.closest('.buddy') && (presentation ? current?.contains(element) : element.closest('.slide') === current)) requestRefresh()
    },
    state = () => snapshot({ profile, autoplay, reactions, paused, destroyed, measures, analysis, last, policy: policy.state(),
      context: slideContext?.snapshot() ?? null,
      nextAmbientAt: Number.isFinite(nextAmbientAt) ? nextAmbientAt : null, scheduled: !!timer }),
    inspect = () => {
      if (destroyed) return snapshot({ ...state(), verdict: { ready: false, reason: 'Контроллер отключён' }, candidates: [], world: null })
      const ctx = context(), reason = blocked(ctx),
        verdict = reason ? { ready: false, reason } : !reactions ? { ready: false, reason: 'Реакции выключены' }
          : analysis?.kind === 'off' ? { ready: false, reason: analysis.reason } : policy.verdict(now(), ctx)
      return snapshot({ ...state(), verdict, candidates: candidates.map(id => {
        try { return { id, reason: contextIds.has(id) && contextVisitUsed ? 'Контекстная история этого посещения уже показана'
          : id === lastAction ? 'Повтор предыдущего действия' : buddy.can(id) } }
        catch (error) { return { id, reason: error.message } }
      }), world: world?.() ?? null, rhythm: { quietMs: config.quietMs, cooldownMs: config.cooldownMs, ambientMs: config.ambientMs } })
    }

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(records => {
      if (records.some(record => {
        const element = record.target.nodeType === 1 ? record.target : record.target.parentElement
        if (!element || element.closest('.buddy')) return false
        if (element === stage && record.attributeName === 'style') {
          const stamp = layoutStyle(stage), changed = stamp !== stageLayoutStyle
          stageLayoutStyle = stamp
          if (!changed) return false
        }
        return element === stage || element.closest('.brand') || (presentation ? current?.contains(element) : element.closest('.slide') === current) || (presentation ? presentation.slides.includes(element) : element.matches('.slide'))
      })) requestRefresh()
    })
    observer.observe(stage, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'src', 'srcset', 'sizes', 'alt', 'hidden', 'aria-hidden', 'aria-label',
        'href', 'xlink:href', 'id', 'viewBox', 'preserveAspectRatio', 'd', 'points', 'pathLength',
        'transform', 'opacity', 'display', 'visibility', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
        'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'fill', 'fill-opacity', 'fill-rule',
        'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
        'clip-path', 'clip-rule', 'mask', 'filter', 'offset', 'stop-color', 'stop-opacity',
        'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform',
        'marker-start', 'marker-mid', 'marker-end', 'font-size', 'font-family', 'font-weight', 'text-anchor',
        'data-buddy-scene', 'data-buddy-kind', 'data-scene',
        'data-buddy-react', 'data-buddy-focus', 'data-buddy-target', 'data-buddy-number', 'data-perch', 'data-perch-text',
        'data-buddy-context', 'data-buddy-context-id', 'data-buddy-concept', 'data-buddy-text', 'data-buddy-ignore',
        'data-buddy-item', 'data-buddy-label', 'data-buddy-step', 'data-buddy-bar', 'data-buddy-value', 'data-buddy-node',
        'data-buddy-from', 'data-buddy-to', 'data-buddy-points', 'data-buddy-chart-line', 'data-buddy-crop',
        'data-buddy-checked', 'checked'] })
    observers.push(observer)
  }
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(requestRefresh)
    observer.observe(stage); observers.push(observer)
  }
  document.addEventListener('visibilitychange', visibility)
  stage.addEventListener('load', requestRefresh, true)
  stage.addEventListener('input', inputChanged, true)
  stage.addEventListener('change', inputChanged, true)
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  motionQuery?.addEventListener('change', motionChanged)
  refresh()
  return Object.freeze({
    refresh, inspect, state,
    pause() { paused = true; clear(); clearTimeout(debounce) },
    resume() { if (destroyed) return; paused = false; resetAmbient(); refresh() },
    setProfile(id) {
      resolveAutoplayProfile(id); profile = id; Object.assign(config, timing()); policy.configure(config)
      ambientBag = []; chooseCandidates(); resetAmbient(); schedule()
    },
    setAutoplay(on) {
      if (typeof on !== 'boolean') throw new TypeError('Ожидается логическое значение')
      autoplay = on; clear(); resetAmbient(); schedule()
    },
    setReactions(on) {
      if (typeof on !== 'boolean') throw new TypeError('Ожидается логическое значение')
      reactions = on; clear(); schedule()
    },
    activity(id) {
      if (destroyed || directing) return
      if (contextIds.has(id)) contextVisitUsed = true
      lastActivity = now(); policy.defer(lastActivity); resetAmbient(); clear(); schedule()
    },
    destroy() {
      if (destroyed) return
      destroyed = true; clear(); clearTimeout(debounce)
      for (const observer of observers) observer.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      stage.removeEventListener('load', requestRefresh, true)
      stage.removeEventListener('input', inputChanged, true)
      stage.removeEventListener('change', inputChanged, true)
      motionQuery?.removeEventListener('change', motionChanged)
      current = null; analysis = null
    }
  })
}

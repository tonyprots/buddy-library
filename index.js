import { resolveHoodie, parseColor } from './outfit.js'
import { createRuntime } from './runtime.js'
import { extraTechniques, createAbilityPlayer } from './new-abilities.js'
import { attachSlideIntelligence, resolveAutoplayProfile } from './slide-intelligence.js'
import { createSlideContext } from './slide-context.js'
import { contextTechniques, createContextPlayer } from './context-abilities.js'
import { storyTechniques, createStoryPlayer } from './context-stories.js'
import { behaviorModes, validateMode, validateCharacter, createBehaviorPolicy } from './behavior.js'
import { createPlayback } from './playback.js'
import { resolveBrand, hasBrandImages } from './brand.js'

export { autoplayProfiles } from './slide-intelligence.js'
export { analyzeSlideContext, contextConcepts } from './slide-context.js'
export { behaviorModes, characters } from './behavior.js'

const groups = {
  'Покой и внимание': [
    ['idle', 'Стоять', 'Спокойная стойка, дыхание и редкое моргание.'],
    ['lookSlide', 'Смотреть на слайд', 'Поворачивается к содержимому слайда.'],
    ['lookHall', 'Смотреть в зал', 'Переводит внимание на зрителей.'],
    ['yawn', 'Зевнуть', 'Прикрывает рот рукой.'],
    ['sitRest', 'Сесть', 'Садится, обняв колени; таз и стопы опираются на пол.'],
    ['sitLean', 'Отдохнуть сидя', 'Вариант спокойной посадки с наклоном.'],
    ['nap', 'Заснуть', 'Опускает голову к коленям; появляются сонные z. Длится до прерывания.']
  ],
  'Жесты': [
    ['wave', 'Помахать', 'Согнутая рука, ладонь обращена к зрителям.'],
    ['clap', 'Похлопать', 'Ладони сходятся перед грудью.'],
    ['point', 'Указать', 'Показывает рукой в сторону слайда.'],
    ['cheer', 'Обрадоваться', 'Подпрыгивает с руками вверх.'],
    ['dance', 'Потанцевать', 'Короткий танец с переносом веса.']
  ],
  'Передвижение и акробатика': [
    ['stroll', 'Пройтись', 'Идёт к свободной точке пола, сохраняя опорную стопу.'],
    ['jog', 'Пробежаться', 'Трусца к более далёкой точке.'],
    ['hop', 'Подпрыгнуть', 'Небольшой прыжок на текущей опоре.'],
    ['stumble', 'Споткнуться', 'Идёт, спотыкается и восстанавливает равновесие.'],
    ['handstand', 'Встать на руки', 'Балансирует на руках; доступен со второго уровня.'],
    ['backflip', 'Сальто назад', 'Прыжок с оборотом; доступен на четвёртом уровне.'],
    ['climb', 'Залезть', 'Подходит к свободной стене и залезает на скруглённый верх.', 'wall'],
    ['pullups', 'Подтянуться', 'Повисает на кромке и подтягивается.', 'wall'],
    ['logo', 'Забраться на подпись', 'Запрыгивает на выбранную опору бренда: аватарку или верх букв подписи.', 'brand'],
    ['descend', 'Спуститься', 'Слезает с текущей площадки; на полу не запускается.', 'elevated']
  ],
  'Разминка': [
    ['stretch', 'Потянуться', 'Поднимает руки и вытягивается.'],
    ['squats', 'Присесть', 'Несколько приседаний вполоборота к залу.'],
    ['jacks', 'Прыжки с разведением рук', 'Серия прыжков с синхронным движением рук и ног.'],
    ['toeTouch', 'Наклониться к стопам', 'Наклоняется вперёд.'],
    ['sideBend', 'Наклониться вбок', 'Наклоны корпуса вправо и влево.'],
    ['shadowbox', 'Бой с тенью', 'Чередует короткие удары руками.'],
    ['kick', 'Ударить ногой', 'Поднимает колено, выпрямляет ногу, возвращается в стойку.']
  ],
  'Реквизит': [
    ['popcorn', 'Есть попкорн', 'Садится на табурет, держит ведёрко, подносит попкорн ко рту.'],
    ['read', 'Читать книгу', 'Держит книгу снизу; страницы видны зрителям.'],
    ['note', 'Записать идею', 'Держит блокнот за край и пишет карандашом; появляется лампочка.']
  ],
  'Способности': [
    ['levitate', 'Левитировать', 'Скрещивает голени и парит над полом.'],
    ['shield', 'Создать щит', 'Раскрывает руки, вокруг вспыхивает силовое поле.'],
    ['laser', 'Лазер из глаз', 'Смотрит в пол, оставляет дымящуюся подпалину.'],
    ['shrink', 'Уменьшиться', 'Бегает маленьким и возвращается к обычному размеру.'],
    ['smoke', 'Дымовая телепортация', 'Прячется в дыму и выходит из второго облака.'],
    ['lightning', 'Молния', 'Направляет разряды из ладоней в пол.'],
    ['fire', 'Огненный шар', 'Собирает шар между ладонями и толкает вдоль пола.'],
    ['ice', 'Ледяная дорожка', 'Замораживает пол и скользит по нему.'],
    ['portal', 'Портал', 'Ныряет в одно кольцо и вылетает из другого.'],
    ['speed', 'Суперскорость', 'Разгоняется со шлейфом и тормозит с пылью.'],
    ['clone', 'Двойник', 'Создаёт копию; оба машут и прыгают.'],
    ['fly', 'Полёт', 'Летает над полом; использует знак бренда в роли доски.'],
    ['hulk', 'Вырастить великана', 'Вырастает до 3,4×, рассматривает руки, делает два тяжёлых шага с пылью и волнами, затем уменьшается.'],
    ['web', 'Паутина', 'Цепляется нитью за карточку и подтягивается наверх.', 'platform'],
    ['magnet', 'Магнит', 'Притягивает иконку, крутит над ладонями и возвращает.', 'icon'],
    ['tracker', 'Отметить готовность', 'Отметка опускается на плитку; появляется галочка.'],
    ['disk', 'Бросить диск', 'Достаёт диск из люка, бросает как фрисби и ловит.'],
    ['mail', 'Отправить письмо', 'Посылает письмо за край слайда и получает ответ.'],
    ['calendar', 'Вспомнить о встрече', 'Календарь появляется над головой: хлопок по лбу и пробежка.'],
    ['grapple', 'Выстрелить крюком', 'Забрасывает крюк на верхнюю площадку и подтягивается.', 'platform'],
    ['construct', 'Собрать световую копию', 'Кольцо на кулаке собирает копию иконки со слайда.', 'icon']
  ],
  'Постановочные сцены': [
    ['land', 'Падение на блок', 'Падает сверху на data-buddy-land и машет.', 'land'],
    ['stairs', 'Лестница', 'Крюк к первому блоку, проход с паузами, парашют в конце.', 'stairs'],
    ['parachute', 'Парашют', 'Падение с высоты с гарантированным раскрытием купола.'],
    ['finale', 'Финальный полёт', 'Летит к data-buddy-fly, ставит лайк и облетает слайд.', 'finale'],
    ['leap', 'Прыжок на зрителя', 'Приближается до пятикратного масштаба и возвращается на пол.'],
    ['flip', 'Прыжок с сальто', 'Вариант прыжка на зрителя с оборотом на обратном пути.']
  ]
}

const contextModules = [{ techniques: contextTechniques, create: createContextPlayer },
    { techniques: storyTechniques, create: createStoryPlayer }],
  allContextTechniques = Object.freeze(contextModules.flatMap(module => module.techniques)),
  branded = new Set(['tracker', 'disk', 'mail', 'calendar']),
  contextual = new Set(['point', 'present', 'spotlight', 'climb', 'pullups', 'logo', 'descend', 'web', 'grapple', 'magnet', 'construct', 'land', 'stairs', 'finale'])

export const techniques = Object.freeze([...Object.entries(groups).flatMap(([group, items]) =>
  items.map(([id, title, description, requires = 'floor']) => Object.freeze({ id, title, description,
    group: branded.has(id) ? 'Бренд' : group === 'Способности' ? 'Суперхьюман' : group, requires,
    preset: branded.has(id) ? 'brand' : group === 'Способности' ? 'superhuman' : 'base',
    ...(contextual.has(id) ? { tags: Object.freeze(['context']) } : {}) }))),
  ...extraTechniques.map(item => contextual.has(item.id) ? Object.freeze({ ...item, tags: Object.freeze(['context']) }) : item), ...allContextTechniques])

export const abilityPresets = Object.freeze({
  superhuman: Object.freeze({ title: 'Суперхьюман', enabled: true }),
  brand: Object.freeze({ title: 'Бренд презентации', enabled: false }),
  y360: Object.freeze({ title: 'Яндекс 360', enabled: false })
})

const registry = new Map(techniques.map(item => [item.id, item])), owners = new WeakMap(),
  sceneNames = new Set(['land', 'stairs', 'finale', 'leap', 'flip']), bubbles = new Set(['!', '?', '…', 'heart', 'bulb', 'z'])

function resolvePresets(input = {}, brandImages = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Пресеты задаются объектом')
  const result = {}
  for (const [key, value] of Object.entries(input))
    if (!Object.hasOwn(abilityPresets, key) || typeof value !== 'boolean') throw new TypeError(`Неизвестный пресет или значение: ${key}`)
  for (const [key, value] of Object.entries(abilityPresets)) result[key] = input[key] ?? value.enabled
  if (input.brand === false && input.y360 === true) throw new TypeError('brand: false несовместим с y360: true')
  result.brand = input.brand ?? (result.y360 || brandImages)
  return Object.freeze(result)
}

function createContextRouter(raw, options) {
  const players = [], routes = new Map()
  try {
    for (const module of contextModules) {
      const player = module.create(raw, options)
      players.push(player)
      for (const item of module.techniques) routes.set(item.id, player)
    }
  } catch (error) { for (const player of players) player.destroy(); throw error }
  return {
    can(id) { const player = routes.get(id); return player ? player.can(id) : 'Неизвестный контекстный приём' },
    create(id) { return routes.get(id)?.create(id) ?? null },
    refresh() { for (const player of players) player.refresh?.() },
    reset() { for (const player of players) player.reset() },
    destroy() { for (const player of players) player.destroy() }
  }
}

/** Подключает одного бадди к сцене 1280×720. Сцена принадлежит вызывающему приложению. */
export async function createBuddy({ stage, slideSelector = ':scope > .slide', activeClass = 'on', logos = {}, brand: brandOption, mode: modeOption, character = 'curious', autonomous: autonomousOption, autoplay: autoplayOption, profile: profileOption, keyboard = false, motion = 'system', renderer = 'auto', seed = 1,
  presets = {}, reactions = true, hoodie = 'auto', signal } = {}) {
  if (typeof HTMLElement === 'undefined' || !(stage instanceof HTMLElement)) throw new TypeError('Нужен HTMLElement сцены')
  if (typeof slideSelector !== 'string' || !slideSelector.trim() || typeof activeClass !== 'string' || !activeClass || /\s/.test(activeClass))
    throw new TypeError('Нужны CSS-селектор слайдов и одно имя активного класса')
  if (owners.has(stage)) throw new Error('В этой сцене уже есть бадди')
  if (modeOption !== undefined) {
    validateMode(modeOption)
    if (autonomousOption !== undefined || autoplayOption !== undefined) throw new TypeError('mode нельзя смешивать с autonomous/autoplay')
  }
  validateCharacter(character)
  let profile = profileOption ?? (modeOption ? behaviorModes[modeOption].profile : autoplayOption === undefined ? 'show' : 'calm')
  resolveAutoplayProfile(profile)
  if (!['system', 'reduce', 'full'].includes(motion) || !['auto', 'svg'].includes(renderer))
    throw new TypeError('Неизвестный режим движения или отрисовки')
  // Без настроек бадди живёт сам: ходит, лазает на блоки, проходит лестницу и финал.
  // Явный autoplay (true или false) означает управление через планировщик, и тогда своя жизнь выключена.
  const autonomous = modeOption === undefined ? autonomousOption ?? autoplayOption === undefined : modeOption !== 'manual'
  let autoplay = modeOption === undefined ? autoplayOption ?? !autonomous : false
  if (typeof autonomous !== 'boolean') throw new TypeError('autonomous — логическое значение')
  if (autonomous && autoplay) throw new TypeError('autonomous и autoplay взаимоисключающие: своя жизнь бадди уже сама выбирает номера')
  if (typeof autoplay !== 'boolean' || typeof keyboard !== 'boolean' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new TypeError('autoplay и keyboard — логические значения; seed — целое 0…4294967295')
  if (reactions !== true && reactions !== false && (!reactions || typeof reactions !== 'object' || Array.isArray(reactions)))
    throw new TypeError('reactions принимает true, false или настройки реакций')
  if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
    throw new TypeError('signal должен быть AbortSignal')
  if (typeof hoodie !== 'string' || hoodie !== 'auto' && hoodie !== 'default' && !parseColor(hoodie))
    throw new TypeError("hoodie — 'auto', 'default' или цвет #rgb, #rrggbb, rgb()")
  if (signal?.aborted) throw signal.reason ?? new DOMException('Запуск отменён', 'AbortError')
  const brand = resolveBrand(brandOption, presets?.y360 === true ? logos : {}),
    enabledPresets = resolvePresets(presets, hasBrandImages(brand)),
    enabled = item => item.preset === 'base' || enabledPresets[item.preset],
    enabledPowers = new Set(techniques.filter(item => enabled(item)).map(item => item.id))
  const slides = [...stage.querySelectorAll(slideSelector)],
    presentation = { slides, activeClass, current: () => slides.find(slide => slide.classList.contains(activeClass)) || slides[0] }
  if (!slides.length) throw new TypeError('В сцене не найдены слайды по селектору ' + slideSelector)
  owners.set(stage, true)
  let outfit, host, raw, player, contextPlayer, slideContext, controller, playback, dead = false, paused = false, living = autonomous,
    mode = modeOption ?? (autonomous || autoplay ? profile === 'show' ? 'show' : 'companion' : 'manual'),
    reacting = modeOption === 'manual' ? false : reactions !== false, focusing = false,
    behavior = createBehaviorPolicy(profile, character, techniques)
  try {
    const dependencies = renderer === 'auto' ? await import('./vendor.js') : null
    if (signal?.aborted) throw signal.reason ?? new DOMException('Запуск отменён', 'AbortError')
    if (brandOption == null && enabledPresets.y360 && ['disk', 'mail', 'calendar', 'tracker'].some(id => !logos?.[id]))
      console.warn('Бадди: не все знаки пресета y360 переданы через logos; вместо отсутствующих знаков используется нейтральный реквизит. Пример подключения: examples/y360.html.')
    const { offsetWidth: width, offsetHeight: height } = stage
    if (width > 0 && height > 0 && (Math.abs(width - 1280) > 1 || Math.abs(height - 720) > 1))
      console.warn(`Бадди: размер сцены ${width}×${height}; нужен логический размер 1280×720. Для другого окна масштабируйте всю сцену через transform: scale().`)
    // цвет худи считывается до появления самого бадди на сцене
    outfit = resolveHoodie(hoodie === 'auto' && brand.accent ? brand.accent : hoodie, stage, undefined, slides)
    if (hoodie === 'auto' && brand.accent) outfit.source = 'brand'
    host = document.createElement('div')
    host.className = 'buddy'
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText = 'position:absolute;inset:0;z-index:4;pointer-events:none'
    stage.append(host)
    raw = createRuntime({ deck: stage, host, brand: enabledPresets.brand ? brand : resolveBrand({ accent: brand.accent }), presentation, keyboard, motion, autonomous, renderer, enabledPowers, behavior, hoodie: outfit.source === 'default' ? null : outfit, dependencies: dependencies ?? {} })
    for (const svg of host.querySelectorAll(':scope > svg'))
      svg.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:720px;overflow:visible'
    raw.seed(seed)
    await raw.ready
    if (signal?.aborted) throw signal.reason ?? new DOMException('Запуск отменён', 'AbortError')
    player = createAbilityPlayer(raw, { host })
    slideContext = createSlideContext({ stage, presentation, techniques: allContextTechniques, onRefresh: () => contextPlayer?.refresh?.() })
    contextPlayer = createContextRouter(raw, { host, context: id => slideContext.resolve(id) })
    raw.registerAbilities(Object.fromEntries(extraTechniques.filter(enabled).map(({ id }) => [id, () => player.create(id)])))
    raw.registerAbilities(Object.fromEntries(allContextTechniques.filter(enabled).map(({ id }) => [id, () => contextPlayer.create(id)])))
    raw.rescan()
  } catch (error) {
    contextPlayer?.destroy(); slideContext?.destroy(); player?.destroy()
    raw?.destroy()
    host?.remove()
    owners.delete(stage)
    throw error
  }

  const active = () => { if (dead) throw new Error('Бадди уже отключён') },
    finite = (n, min, max) => { if (!Number.isFinite(n) || n < min || n > max) throw new RangeError(`Число вне диапазона ${min}…${max}`) },
    check = id => {
      const item = registry.get(id)
      if (!item) throw new RangeError(`Неизвестный приём: ${id}`)
      const slide = presentation.current(),
        world = raw.W, state = raw.state(), requirement = item.requires
      if (!enabled(item)) return `Пресет «${abilityPresets[item.preset].title}» выключен`
      if (item.contextKinds && !slideContext.resolve(id)) {
        const context = slideContext.snapshot(), issue = context.issues.find(issue => item.contextKinds.includes(issue.kind))
        return context.selectedId ? 'Выбранный источник несовместим с этим номером' : issue?.reason
          || 'Нет однозначного совместимого источника; выберите факт на слайде'
      }
      if (requirement === 'floor' && (state.surf !== 'floor' || raw.B.mode !== 'ground')) return 'Нужна стойка на полу'
      if (requirement === 'wall' && !world.walls.length) return 'Нет доступной стены'
      if (requirement === 'platform' && !world.plats.length) return 'Нет доступной площадки'
      if (requirement === 'icon' && !slide.querySelector('svg, img')) return 'На слайде нет иконки'
      if (requirement === 'brand' && !world.logo?.spans.length) return 'Не задана опора .brand'
      if (requirement === 'elevated' && state.surf === 'floor') return 'Персонаж уже на полу'
      if (requirement === 'land' && !slide.querySelector('[data-buddy-land]')) return 'Нужен блок data-buddy-land'
      if (requirement === 'stairs' && !slide.querySelector('[data-buddy-stairs]')) return 'Нужна лестница data-buddy-stairs'
      if (requirement === 'finale' && !slide.querySelector('[data-buddy-fly], .tile.main')) return 'Нужна цель data-buddy-fly'
      if (id === 'handstand' && state.level < 1 || id === 'backflip' && state.level < 3) return 'Недостаточный уровень смелости'
      if (item.contextKinds) return contextPlayer.can(id)
      return raw.availability(id)
    }

  const syncAutomation = () => {
    if (dead) return
    const blocked = focusing || !!playback?.running
    raw.autonomous(living && !blocked)
    controller?.setAutoplay(autoplay && !blocked)
    controller?.setReactions(reacting && !blocked)
    if (paused || blocked) controller?.pause()
    else controller?.resume()
  }, updateBehavior = () => { behavior = createBehaviorPolicy(profile, character, techniques); raw.behavior(behavior) },
    launch = (id, duration) => {
      if (raw.reduced) return false
      raw.rescan()
      if (registry.get(id)?.contextKinds) slideContext.refresh()
      const reason = check(id)
      if (reason) throw new Error(reason)
      const result = id === 'parachute' ? raw.launchParachute(440)
        : sceneNames.has(id) ? raw.scene(id) : raw.run([duration === undefined ? id : [id, duration]])
      if (result) controller?.activity(id)
      return result
    }, diagnostics = Object.freeze({ state() { active(); return controller.state() }, inspect() { active(); return controller.inspect() } }),
    buddy = Object.freeze({
    get renderer() { return raw.renderer },
    get reducedMotion() { return raw.reduced },
    get paused() { return paused },
    get profile() { return profile },
    get mode() { return mode },
    get character() { return character },
    get intelligence() { return diagnostics },
    get presets() { return enabledPresets },
    get brand() { return brand },
    get hoodie() { return Object.freeze({ color: outfit.color, source: outfit.source }) },
    can(id) { active(); raw.ensureWorld(); return check(id) },
    play(id) {
      active()
      if (!registry.has(id)) throw new RangeError(`Неизвестный приём: ${id}`)
      // Сам runtime сообщает об успешном замещении; недоступная команда историю не отменяет.
      return launch(id)
    },
    perform(id, options = {}) { active(); const { signal, ...step } = options; return playback.start([{ ...step, play: id }], { signal }) },
    story(steps, options) { active(); return playback.start(steps, options) },
    sequence(ids) {
      active()
      if (!Array.isArray(ids) || !ids.length || ids.some(id => !registry.has(id) || !enabled(registry.get(id)) || sceneNames.has(id) || id === 'parachute'))
        throw new TypeError('Последовательность принимает непустой список действий и способностей без постановочных сцен')
      if (raw.reduced) return false
      raw.rescan()
      if (ids.some(id => registry.get(id)?.contextKinds)) slideContext.refresh()
      const result = raw.run(ids)
      if (result) controller?.activity(ids.find(id => registry.get(id)?.contextKinds))
      return result
    },
    pause() { active(); paused = true; controller?.pause(); raw.manual(true) },
    resume() { active(); paused = false; raw.manual(false); syncAutomation() },
    step(seconds = 1 / 60, fps = 60) { active(); finite(seconds, 0, 300); finite(fps, 1, 240); paused = true; controller?.pause(); raw.manual(true); raw.step(seconds, fps) },
    reset() { active(); contextPlayer.reset(); raw.rescan(); raw.reset(); controller?.activity() },
    autoplay(on) { active(); if (typeof on !== 'boolean') throw new TypeError('Ожидается логическое значение'); if (on) living = false; autoplay = on; mode = living || autoplay ? profile === 'show' ? 'show' : 'companion' : 'manual'; syncAutomation() },
    setAutonomous(on) { active(); if (typeof on !== 'boolean') throw new TypeError('Ожидается логическое значение'); if (on) autoplay = false; living = on; mode = living || autoplay ? profile === 'show' ? 'show' : 'companion' : 'manual'; syncAutomation() },
    setProfile(id) { active(); resolveAutoplayProfile(id); profile = id; updateBehavior(); controller.setProfile(id) },
    setCharacter(id) { active(); validateCharacter(id); character = id; updateBehavior() },
    setMode(id) {
      active(); validateMode(id); mode = id; living = id !== 'manual'; autoplay = false; reacting = id !== 'manual'
      if (id !== 'manual') buddy.setProfile(behaviorModes[id].profile)
      syncAutomation()
    },
    focus(on = true) {
      active(); if (typeof on !== 'boolean') throw new TypeError('Ожидается логическое значение')
      focusing = on
      if (on) playback.cancel()
      raw.focus(on); syncAutomation()
    },
    setReactions(on) { active(); if (typeof on !== 'boolean') throw new TypeError('Ожидается логическое значение'); reacting = on; syncAutomation() },
    progress(value) { active(); finite(value, 0, 1); raw.progress(value) },
    say(kind) { active(); if (!bubbles.has(kind)) throw new RangeError('Неизвестный пузырь'); if (!raw.reduced) raw.say(kind) },
    lookAt(target, duration = 1.5) {
      active(); finite(duration, .05, 60)
      if (target === null) { raw.mind().look(null); return }
      if (!target || ![target.x, target.y, target.z ?? 0].every(Number.isFinite)) throw new TypeError('Нужна конечная точка {x,y,z?} сцены')
      raw.mind().look({ x: target.x, y: target.y, z: target.z ?? 0 }, duration)
    },
    state() { active(); return { ...raw.state(), grounded: raw.B.mode === 'ground', paused, autoplay, autonomous: living, mode, character, performing: !!playback?.running, renderer: raw.renderer, reducedMotion: raw.reduced } },
    metrics() { active(); return raw.metrics() },
    framing() { active(); return raw.frameBounds() },
    reactionState() { active(); return controller?.state() ?? null },
    context() { active(); return slideContext.snapshot() },
    selectContext(id) { active(); slideContext.select(id); controller?.refresh() },
    rescan() { active(); raw.rescan(); slideContext.refresh() },
    destroy() { if (dead) return; dead = true; signal?.removeEventListener('abort', aborted); playback?.destroy(); controller?.destroy(); contextPlayer.destroy(); slideContext.destroy(); player.destroy(); raw.destroy(); host.remove(); owners.delete(stage) },
    /** Внутренний интерфейс для effects.js и подбора поз. Не является стабильным API. */
    experimental: raw
  })
  const aborted = () => buddy.destroy()
  try {
    controller = attachSlideIntelligence({ stage, buddy, presentation, ...(typeof reactions === 'object' ? reactions : {}),
      profile, seed, autoplay, reactions: reacting, allowAutomatic: id => behavior.allows(id),
      slideContext, contextTechniques: allContextTechniques,
      world: () => { raw.ensureWorld(); return raw.world() } })
    playback = createPlayback({ raw, registry, launch, context: slideContext,
      lookAt: (target, duration) => raw.mind().look(target, duration), changed: syncAutomation })
    if (paused) controller.pause()
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
  } catch (error) { buddy.destroy(); throw error }
  return buddy
}

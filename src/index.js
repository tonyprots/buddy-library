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
  'Rest and attention': [
    ['idle', 'Stand', 'A relaxed stance with breathing and occasional blinking.'],
    ['lookSlide', 'Look at the slide', 'Turns toward the slide content.'],
    ['lookHall', 'Look at the audience', 'Shifts attention to the audience.'],
    ['yawn', 'Yawn', 'Covers the mouth with one hand.'],
    ['sitRest', 'Sit down', 'Sits holding the knees, with hips and feet resting on the floor.'],
    ['sitLean', 'Rest while seated', 'A relaxed seated pose with a slight lean.'],
    ['nap', 'Take a nap', 'Rests the head on the knees with sleepy z bubbles. Continues until interrupted.']
  ],
  'Gestures': [
    ['wave', 'Wave', 'Waves with a bent arm and the palm facing the audience.'],
    ['clap', 'Clap', 'Brings the palms together in front of the chest.'],
    ['point', 'Point', 'Points toward the slide.'],
    ['cheer', 'Cheer', 'Jumps with both arms raised.'],
    ['dance', 'Dance', 'A short dance with shifting weight.']
  ],
  'Movement and acrobatics': [
    ['stroll', 'Stroll', 'Walks to a free spot on the floor while keeping the planted foot stable.'],
    ['jog', 'Jog', 'Jogs to a more distant spot.'],
    ['hop', 'Hop', 'A small jump on the current support.'],
    ['stumble', 'Stumble', 'Trips while walking, then regains balance.'],
    ['handstand', 'Handstand', 'Balances on both hands; available from confidence level two.'],
    ['backflip', 'Backflip', 'A backward somersault; available at confidence level four.'],
    ['climb', 'Climb', 'Walks to an accessible wall and climbs onto its rounded top.', 'wall'],
    ['pullups', 'Pull-ups', 'Hangs from an edge and pulls up.', 'wall'],
    ['logo', 'Climb onto the signature', 'Jumps onto the chosen brand perch: an avatar or the top of the signature letters.', 'brand'],
    ['descend', 'Climb down', 'Descends from the current platform; unavailable on the floor.', 'elevated']
  ],
  'Warm-up': [
    ['stretch', 'Stretch', 'Raises both arms and stretches upward.'],
    ['squats', 'Squats', 'Does a few squats, partly turned toward the audience.'],
    ['jacks', 'Jumping jacks', 'Jumps while moving arms and legs together.'],
    ['toeTouch', 'Touch toes', 'Bends forward.'],
    ['sideBend', 'Side bends', 'Leans the torso to either side.'],
    ['shadowbox', 'Shadowboxing', 'Alternates short punches.'],
    ['kick', 'Kick', 'Raises a knee, extends the leg, then returns to a standing pose.']
  ],
  'Props': [
    ['popcorn', 'Eat popcorn', 'Sits on a stool, holds a bucket and brings popcorn to the mouth.'],
    ['read', 'Read a book', 'Supports a book from below, with its pages visible to the audience.'],
    ['note', 'Write down an idea', 'Holds a notebook by its edge and writes with a pencil; a light bulb appears.']
  ],
  'Powers': [
    ['levitate', 'Levitate', 'Crosses the lower legs and floats above the floor.'],
    ['shield', 'Raise a shield', 'Opens both arms as a force field lights up around the body.'],
    ['laser', 'Eye laser', 'Looks at the floor, leaving a smoking scorch mark.'],
    ['shrink', 'Shrink', 'Runs around at a tiny scale, then returns to normal size.'],
    ['smoke', 'Smoke teleport', 'Disappears into smoke and emerges from a second cloud.'],
    ['lightning', 'Lightning', 'Directs electric arcs from the palms into the floor.'],
    ['fire', 'Fireball', 'Builds a ball between the palms and pushes it along the floor.'],
    ['ice', 'Ice trail', 'Freezes the floor and slides across it.'],
    ['portal', 'Portal', 'Dives into one ring and flies out of another.'],
    ['speed', 'Super speed', 'Accelerates with a motion trail and brakes in a cloud of dust.'],
    ['clone', 'Clone', 'Creates a copy; both wave and jump.'],
    ['fly', 'Fly', 'Flies above the floor, using the brand image assigned to the board role.'],
    ['hulk', 'Become a giant', 'Grows to 3.4 times normal size, examines both hands, takes two heavy steps with dust and shock waves, then shrinks back.'],
    ['web', 'Web swing', 'Attaches a thread to a card and pulls up onto it.', 'platform'],
    ['magnet', 'Magnet', 'Attracts an icon, spins it above the palms, then returns it.', 'icon'],
    ['tracker', 'Mark as done', 'Lowers a stamp onto a tile, leaving a check mark.'],
    ['disk', 'Throw a disc', 'Takes a disc from a hatch, throws it like a frisbee and catches it.'],
    ['mail', 'Send a message', 'Sends a message beyond the slide edge and receives a reply.'],
    ['calendar', 'Remember a meeting', 'A calendar appears overhead, followed by a forehead slap and a quick run.'],
    ['grapple', 'Grappling hook', 'Throws a hook onto an upper platform and pulls up.', 'platform'],
    ['construct', 'Build a light copy', 'A ring on the fist assembles a copy of a slide icon.', 'icon']
  ],
  'Staged scenes': [
    ['land', 'Land on a block', 'Drops onto data-buddy-land from above and waves.', 'land'],
    ['stairs', 'Staircase', 'Hooks onto the first step, climbs with pauses and finishes with a parachute.', 'stairs'],
    ['parachute', 'Parachute', 'A fall from above with a guaranteed canopy opening.'],
    ['finale', 'Final flight', 'Flies toward data-buddy-fly, gives a like and circles the slide.', 'finale'],
    ['leap', 'Leap toward the audience', 'Approaches at up to five times normal size, then returns to the floor.'],
    ['flip', 'Leap with a flip', 'Leaps toward the audience and somersaults on the way back.']
  ]
}

const contextModules = [{ techniques: contextTechniques, create: createContextPlayer },
    { techniques: storyTechniques, create: createStoryPlayer }],
  allContextTechniques = Object.freeze(contextModules.flatMap(module => module.techniques)),
  branded = new Set(['tracker', 'disk', 'mail', 'calendar']),
  contextual = new Set(['point', 'present', 'spotlight', 'climb', 'pullups', 'logo', 'descend', 'web', 'grapple', 'magnet', 'construct', 'land', 'stairs', 'finale'])

export const techniques = Object.freeze([...Object.entries(groups).flatMap(([group, items]) =>
  items.map(([id, title, description, requires = 'floor']) => Object.freeze({ id, title, description,
    group: branded.has(id) ? 'Brand' : group === 'Powers' ? 'Superhuman' : group, requires,
    preset: branded.has(id) ? 'brand' : group === 'Powers' ? 'superhuman' : 'base',
    ...(contextual.has(id) ? { tags: Object.freeze(['context']) } : {}) }))),
  ...extraTechniques.map(item => contextual.has(item.id) ? Object.freeze({ ...item, tags: Object.freeze(['context']) }) : item), ...allContextTechniques])

export const abilityPresets = Object.freeze({
  superhuman: Object.freeze({ title: 'Superhuman', enabled: true }),
  brand: Object.freeze({ title: 'Presentation brand', enabled: false }),
  y360: Object.freeze({ title: 'Yandex 360', enabled: false })
})

const registry = new Map(techniques.map(item => [item.id, item])), owners = new WeakMap(),
  sceneNames = new Set(['land', 'stairs', 'finale', 'leap', 'flip']), bubbles = new Set(['!', '?', '…', 'heart', 'bulb', 'z'])

function resolvePresets(input = {}, brandImages = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('presets must be an object')
  const result = {}
  for (const [key, value] of Object.entries(input))
    if (!Object.hasOwn(abilityPresets, key) || typeof value !== 'boolean') throw new TypeError(`Unknown preset or value: ${key}`)
  for (const [key, value] of Object.entries(abilityPresets)) result[key] = input[key] ?? value.enabled
  if (input.brand === false && input.y360 === true) throw new TypeError('brand: false cannot be combined with y360: true')
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
    can(id) { const player = routes.get(id); return player ? player.can(id) : 'Unknown context action' },
    create(id) { return routes.get(id)?.create(id) ?? null },
    refresh() { for (const player of players) player.refresh?.() },
    reset() { for (const player of players) player.reset() },
    destroy() { for (const player of players) player.destroy() }
  }
}

/** Подключает одного бадди к сцене 1280×720. Сцена принадлежит вызывающему приложению. */
export async function createBuddy({ stage, slideSelector = ':scope > .slide', activeClass = 'on', logos = {}, brand: brandOption, mode: modeOption, character = 'curious', autonomous: autonomousOption, autoplay: autoplayOption, profile: profileOption, keyboard = false, motion = 'system', renderer = 'auto', seed = 1,
  presets = {}, reactions = true, hoodie = 'auto', signal } = {}) {
  if (typeof HTMLElement === 'undefined' || !(stage instanceof HTMLElement)) throw new TypeError('stage must be an HTMLElement')
  if (typeof slideSelector !== 'string' || !slideSelector.trim() || typeof activeClass !== 'string' || !activeClass || /\s/.test(activeClass))
    throw new TypeError('Provide a slide CSS selector and a single active class name')
  if (owners.has(stage)) throw new Error('This stage already has a Buddy instance')
  if (modeOption !== undefined) {
    validateMode(modeOption)
    if (autonomousOption !== undefined || autoplayOption !== undefined) throw new TypeError('mode cannot be combined with autonomous/autoplay')
  }
  validateCharacter(character)
  let profile = profileOption ?? (modeOption ? behaviorModes[modeOption].profile : autoplayOption === undefined ? 'show' : 'calm')
  resolveAutoplayProfile(profile)
  if (!['system', 'reduce', 'full'].includes(motion) || !['auto', 'svg'].includes(renderer))
    throw new TypeError('Unknown motion or renderer mode')
  // Без настроек бадди живёт сам: ходит, лазает на блоки, проходит лестницу и финал.
  // Явный autoplay (true или false) означает управление через планировщик, и тогда своя жизнь выключена.
  const autonomous = modeOption === undefined ? autonomousOption ?? autoplayOption === undefined : modeOption !== 'manual'
  let autoplay = modeOption === undefined ? autoplayOption ?? !autonomous : false
  if (typeof autonomous !== 'boolean') throw new TypeError('autonomous must be a boolean')
  if (autonomous && autoplay) throw new TypeError('autonomous and autoplay are mutually exclusive: autonomous behavior already selects actions')
  if (typeof autoplay !== 'boolean' || typeof keyboard !== 'boolean' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new TypeError('autoplay and keyboard must be booleans; seed must be an integer from 0 to 4294967295')
  if (reactions !== true && reactions !== false && (!reactions || typeof reactions !== 'object' || Array.isArray(reactions)))
    throw new TypeError('reactions must be true, false or a reaction options object')
  if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
    throw new TypeError('signal must be an AbortSignal')
  if (typeof hoodie !== 'string' || hoodie !== 'auto' && hoodie !== 'default' && !parseColor(hoodie))
    throw new TypeError('hoodie must be \'auto\', \'default\' or a #rgb, #rrggbb or rgb() color')
  if (signal?.aborted) throw signal.reason ?? new DOMException('Startup aborted', 'AbortError')
  const brand = resolveBrand(brandOption, presets?.y360 === true ? logos : {}),
    enabledPresets = resolvePresets(presets, hasBrandImages(brand)),
    enabled = item => item.preset === 'base' || enabledPresets[item.preset],
    enabledPowers = new Set(techniques.filter(item => enabled(item)).map(item => item.id))
  const slides = [...stage.querySelectorAll(slideSelector)],
    presentation = { slides, activeClass, current: () => slides.find(slide => slide.classList.contains(activeClass)) || slides[0] }
  if (!slides.length) throw new TypeError('No slides match the selector ' + slideSelector)
  owners.set(stage, true)
  let outfit, host, raw, player, contextPlayer, slideContext, controller, playback, dead = false, paused = false, living = autonomous,
    mode = modeOption ?? (autonomous || autoplay ? profile === 'show' ? 'show' : 'companion' : 'manual'),
    reacting = modeOption === 'manual' ? false : reactions !== false, focusing = false,
    behavior = createBehaviorPolicy(profile, character, techniques)
  try {
    const dependencies = renderer === 'auto' ? await import('./vendor.js') : null
    if (signal?.aborted) throw signal.reason ?? new DOMException('Startup aborted', 'AbortError')
    if (brandOption == null && enabledPresets.y360 && ['disk', 'mail', 'calendar', 'tracker'].some(id => !logos?.[id]))
      console.warn('Buddy: some y360 images are missing from logos; missing images use neutral props. See examples/y360.html.')
    const { offsetWidth: width, offsetHeight: height } = stage
    if (width > 0 && height > 0 && (Math.abs(width - 1280) > 1 || Math.abs(height - 720) > 1))
      console.warn(`Buddy: stage size is ${width}×${height}; expected a logical size of 1280×720. Scale the entire stage with transform: scale() to fit the viewport.`)
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
    if (signal?.aborted) throw signal.reason ?? new DOMException('Startup aborted', 'AbortError')
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

  const active = () => { if (dead) throw new Error('Buddy has been destroyed') },
    finite = (n, min, max) => { if (!Number.isFinite(n) || n < min || n > max) throw new RangeError(`Value outside range ${min}…${max}`) },
    check = id => {
      const item = registry.get(id)
      if (!item) throw new RangeError(`Unknown action: ${id}`)
      const slide = presentation.current(),
        world = raw.W, state = raw.state(), requirement = item.requires
      if (!enabled(item)) return `Preset "${abilityPresets[item.preset].title}" is disabled`
      if (item.contextKinds && !slideContext.resolve(id)) {
        const context = slideContext.snapshot(), issue = context.issues.find(issue => item.contextKinds.includes(issue.kind))
        return context.selectedId ? 'The selected source is incompatible with this action' : issue?.reason
          || 'No unambiguous compatible source; select a fact on the slide'
      }
      if (requirement === 'floor' && (state.surf !== 'floor' || raw.B.mode !== 'ground')) return 'Requires a standing pose on the floor'
      if (requirement === 'wall' && !world.walls.length) return 'No accessible wall'
      if (requirement === 'platform' && !world.plats.length) return 'No accessible platform'
      if (requirement === 'icon' && !slide.querySelector('svg, img')) return 'No icon on the slide'
      if (requirement === 'brand' && !world.logo?.spans.length) return 'No .brand perch configured'
      if (requirement === 'elevated' && state.surf === 'floor') return 'Already on the floor'
      if (requirement === 'land' && !slide.querySelector('[data-buddy-land]')) return 'Requires a data-buddy-land block'
      if (requirement === 'stairs' && !slide.querySelector('[data-buddy-stairs]')) return 'Requires a data-buddy-stairs staircase'
      if (requirement === 'finale' && !slide.querySelector('[data-buddy-fly], .tile.main')) return 'Requires a data-buddy-fly target'
      if (id === 'handstand' && state.level < 1 || id === 'backflip' && state.level < 3) return 'Confidence level is too low'
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
      if (!registry.has(id)) throw new RangeError(`Unknown action: ${id}`)
      // Сам runtime сообщает об успешном замещении; недоступная команда историю не отменяет.
      return launch(id)
    },
    perform(id, options = {}) { active(); const { signal, ...step } = options; return playback.start([{ ...step, play: id }], { signal }) },
    story(steps, options) { active(); return playback.start(steps, options) },
    sequence(ids) {
      active()
      if (!Array.isArray(ids) || !ids.length || ids.some(id => !registry.has(id) || !enabled(registry.get(id)) || sceneNames.has(id) || id === 'parachute'))
        throw new TypeError('sequence requires a nonempty list of actions and powers without staged scenes')
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
    autoplay(on) { active(); if (typeof on !== 'boolean') throw new TypeError('Expected a boolean'); if (on) living = false; autoplay = on; mode = living || autoplay ? profile === 'show' ? 'show' : 'companion' : 'manual'; syncAutomation() },
    setAutonomous(on) { active(); if (typeof on !== 'boolean') throw new TypeError('Expected a boolean'); if (on) autoplay = false; living = on; mode = living || autoplay ? profile === 'show' ? 'show' : 'companion' : 'manual'; syncAutomation() },
    setProfile(id) { active(); resolveAutoplayProfile(id); profile = id; updateBehavior(); controller.setProfile(id) },
    setCharacter(id) { active(); validateCharacter(id); character = id; updateBehavior() },
    setMode(id) {
      active(); validateMode(id); mode = id; living = id !== 'manual'; autoplay = false; reacting = id !== 'manual'
      if (id !== 'manual') buddy.setProfile(behaviorModes[id].profile)
      syncAutomation()
    },
    focus(on = true) {
      active(); if (typeof on !== 'boolean') throw new TypeError('Expected a boolean')
      focusing = on
      if (on) playback.cancel()
      raw.focus(on); syncAutomation()
    },
    setReactions(on) { active(); if (typeof on !== 'boolean') throw new TypeError('Expected a boolean'); reacting = on; syncAutomation() },
    progress(value) { active(); finite(value, 0, 1); raw.progress(value) },
    say(kind) { active(); if (!bubbles.has(kind)) throw new RangeError('Unknown bubble'); if (!raw.reduced) raw.say(kind) },
    lookAt(target, duration = 1.5) {
      active(); finite(duration, .05, 60)
      if (target === null) { raw.mind().look(null); return }
      if (!target || ![target.x, target.y, target.z ?? 0].every(Number.isFinite)) throw new TypeError('Expected a finite stage point {x,y,z?}')
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

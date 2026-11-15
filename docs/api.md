# Buddy API reference

Start with the [README](../README.md) for one-script integration.

## ES modules and bundlers

The package is not on npm yet. Download the TGZ or sources from the
[latest release](https://github.com/tonyprots/buddy-library/releases/latest).
Install a source folder beside your application:

```bash
npm install ../buddy-library
```

Or install the release package: `npm install ./tony-prots-buddy-0.9.1.tgz`.
With Vite, webpack or esbuild:

```js
import { createBuddy } from '@tony-prots/buddy'
const buddy = await createBuddy({ stage: document.querySelector('#stage') })
// On unmount:
buddy.destroy()
```

Without a bundler, serve the source folder over HTTP and import `./buddy-library/src/index.js`.
ES modules do not work through `file://`; use the classic bundle for double-click playback.
Create instances after the browser DOM mounts, not during SSR. Importing the
`techniques` catalog is safe without a DOM.

## Markup and scale

The stage needs `position: relative; width: 1280px; height: 720px; overflow: hidden`.
Default slides match `:scope > .slide`; `on` marks the active slide.

```js
const buddy = await createBuddy({
  stage: document.querySelector('#deck'),
  slideSelector: '.pages > article',
  activeClass: 'is-active'
})
```

Select only leaf slides, in presentation order. Exactly one should have the active
class; otherwise Buddy falls back to the first. The host controls visibility and
navigation. Recreate Buddy when adding or removing slides.

For another viewport size, scale the whole stage with `transform: scale(k)` and
`transform-origin: 0 0`. The floor is at y=700. Other logical sizes, nonuniform
scale and stage rotation are unsupported. The optional `attachDeckEffects`
module only supports `.slide` / `on` markup.

## Classic bundle

`dist/buddy.js` exposes `Buddy.createBuddy`, `attachDeckEffects`, `techniques`,
`abilityPresets`, `autoplayProfiles`, `behaviorModes` and `characters`.
`data-stage="#stage"` mounts automatically; `data-slide-selector` and
`data-active-class` adapt the markup. After the script loads, `await window.buddy`
returns the instance. It is initially a Promise, then the instance itself.

For multiple stages or extra options, omit `data-stage` and call
`Buddy.createBuddy({ stage, ...options })` once per stage.

## Default behavior

Defaults are `mode: 'show'`, `character: 'curious'`, `profile: 'show'`.
Buddy walks, explores cards, reacts to content and performs powers automatically.

- Confidence grows with deck progress. He starts near the left side of the floor,
  then climbs, walks along card tops, sits on edges and jumps down. Powers begin
  after roughly 15% of the deck. Selection intervals shorten from about 25–34 to
  10–13 seconds toward the finale; the current action finishes first.
  Single-slide decks start at the middle confidence level.
- Supports are visible blocks with a background, border or media, at least 40 px
  wide, with no text on their top edge. Climbable blocks have their bottom edge
  within roughly 110–175 px of the floor, depending on confidence.
  Text, images and unreachable blocks remain obstacles.
- A slide change makes Buddy descend, look at the new slide and choose a reaction.
  Marked staircases and finales can run automatically.
- Prominent numbers, known concepts, large images and closing headings can trigger
  contextual actions. Mark small numbers with `data-buddy-number`.
  Recognition uses local rules, without an LLM or network requests.

## Modes, character and focus

```js
const buddy = await createBuddy({ stage })
buddy.setMode('show')        // Active movement, show profile
buddy.setMode('manual')      // No autonomous actions or reactions
buddy.setMode('companion')   // Autonomous movement and reactions, live profile
buddy.setProfile('calm')
buddy.setCharacter('business')
```

| Character | Automatic behavior |
|---|---|
| `business` | Attention, walking and content actions; no sleep, yawning, mischief, acrobatics or powers |
| `curious` (default) | More reading, note-taking and card exploration; no sleep or shadowboxing |
| `playful` | Allows mischief; may yawn or nap on a long slide in live/show |

`calm` limits the repertoire to quiet actions; `live` adds climbing and context
stories; `show` adds tricks and powers. The same policy governs autonomous choices
and reactions. Manual commands and explicit `data-buddy-stairs` / `data-buddy-fly`
scenes preserve the author's intent and are not filtered by character.

```js
buddy.focus()       // Finish, descend if needed, stand on clear floor
buddy.focus(false)  // Restore the selected mode, character and profile
```

Focus preserves breathing and blinking. `focusing` means a request is pending;
`focused` means Buddy has reached a free floor spot. If none is available, he waits
and `focused` stays false. Mode changes during focus apply when focus ends.
`pause()` freezes simulation time completely.

Legacy `autonomous` enables self-directed movement; `autoplay` enables a separate
interval scheduler. Any explicit `autoplay` disables autonomous movement by default.
`autoplay: false, reactions: false` gives manual control. `setAutonomous(true)` and
`autoplay(true)` disable each other. Do not combine `mode` with either startup option.
Legacy explicit `autoplay` still defaults to `calm`. `setMode()` reapplies coherent
settings; you can then adjust the profile and reactions individually.

## Stories, completion and cancellation

```js
const run = buddy.story(['lookSlide', { wait: .4 }, 'present', { wait: .5 }, 'bow'])
const result = await run.finished // { status: 'completed', step: 5 }

const flight = buddy.perform('parachute')
flight.cancel()                   // Finish the current action and land
await flight.finished            // status: 'cancelled'
```

A story accepts 1–128 steps:

- An action ID, or `{ play: 'thinkNumber', contextId: fact.id }` to select a source.
  A nap needs a finite duration: `{ play: 'nap', duration: 8 }` (3–300 seconds).
- `{ lookAt: { x: 640, y: 300 }, duration: 2 }`: gaze in stage coordinates,
  with a duration from 0.05 to 60 seconds.
- `{ wait: 1 }`: a wait in simulation seconds, up to 300.

Staged scenes are allowed. Each step waits for the entire action, including its
approach, internal transitions and landing. A source selection persists until the
next explicit selection, then the previous source is restored at story end
(or automatic selection if it no longer exists). An unavailable step ends with
`failed` and a reason; it is not silently skipped.

Autonomous actions and reactions pause during a story. Mode and character changes
apply afterward. `cancel()` and an optional AbortSignal finish the current action
before cancelling remaining steps; naps wake early. Cancellation during `wait` or
`lookAt` is immediate. During `pause()`, waits and graceful completion need
`resume()` or `step()` to advance.

`finished` resolves to `completed`, `cancelled`, `skipped` or `failed`, with the
completed step count and optional `reason`. Invalid story shapes throw before
starting. Slide changes, new manual actions, reset and destroy cancel the previous
story. Reduced motion returns `skipped`. Pass a signal as
`buddy.story(steps, { signal })` or `buddy.perform(id, { signal })`.

## Hoodie color

With `hoodie: 'auto'`, a brand accent takes priority. Otherwise Buddy scans all
slides once, including hidden ones, for a prominent saturated color in headings,
fills, borders or SVG shapes. Gray, near-white and near-black colors are ignored.
Without a usable accent, the original blue remains. Image pixels are not analyzed;
`data-buddy-ignore` excludes a block.

```js
createBuddy({ stage })                    // Detect the deck accent
createBuddy({ stage, hoodie: 'default' })  // Original blue
createBuddy({ stage, hoodie: '#ff6427' })  // Explicit color
```

Saturation and lightness are adjusted for readable lighting and outlines.
`buddy.hoodie` exposes `{ color, source }`, where source is `brand`, `deck`,
`option` or `default`.

## Scenes

Use markup or `play()` to launch a staged scene.

- `stairs`: put steps inside `data-buddy-stairs`; Buddy hooks onto the first,
  climbs in order and finishes with a parachute.
- `land`: drops onto a block marked `data-buddy-land` and waves.
- `finale`: flies toward `data-buddy-fly`, optionally likes `data-buddy-like`,
  and circles the slide. `data-buddy-text` anchors the text target.
- `parachute`: descends under a canopy.
- `leap`: approaches the audience and returns to the floor.
- `flip`: the same entrance, with a somersault on the return path.

Reserve large entrances for the opening or section transitions.

## Deck effects

The optional module breaks the cover apart, launches Buddy through the opening
and lands him on the next slide:

```js
import { attachDeckEffects } from '@tony-prots/buddy/effects'
const effects = attachDeckEffects({
  stage, buddy,
  show(index) { /* synchronously move the on class to slide index */ }
})
effects.armIntro('line') // line | leap | flip
effects.go(1, 0)        // The host navigation calls this instead of switching directly
// On unmount, destroy effects first:
effects.destroy()
buddy.destroy()
```

The first `.slide.cover` is the cover. `line` lands on `[data-buddy-land]` or the
lowercase letter tops of the next heading. Set stage CSS variables `--paper`
(slide background) and `--flame` (impact ring). Effects use real time, not `step()`.
Reduced motion switches slides without an explosion. In the classic bundle use
`Buddy.attachDeckEffects`.

## Markup reference

All attributes are optional.

| Marker | Where | Purpose |
|---|---|---|
| `data-buddy-stairs` | Step container | Staircase on slide entry |
| `data-buddy-land` | Block | Landing and intro target |
| `data-buddy-fly` | Block | Finale target; makes the slide a finale |
| `data-buddy-like`, `data-buddy-text` | Finale target | Heart reaction and text anchor |
| `data-buddy-focus`, `data-buddy-target` | Any element | Gaze, presentation and spotlight target |
| `data-buddy-scene` | Slide | Explicit role: title, divider, image, number, finale, content, off |
| `data-buddy-react` | Slide | Explicit action such as wave, or none |
| `data-buddy-number` | Numeric element | Recognize a number even at a small font size |
| `data-buddy-ignore` | Block | Exclude its media and numbers from reactions |
| `data-buddy-context` and related attributes | Source content | See the [context guide](slide-context.md) |
| `.brand` with `[data-perch]` / `[data-perch-text]` | Corner signature | Perch for the logo action |
| `.cover` | First slide | Breakout intro cover |

Avoid decorative full-slide filled containers: they can become supports.
Continuously animated elements are not treated as supports.

## Keyboard and accessibility

`keyboard: true` enables **B** for a trick, **N** for a power, **C** for climbing
and **M** for the magnet. Keyboard layout does not matter; inputs are excluded.
Keyboard control is off by default.

With `prefers-reduced-motion`, Buddy stays still, `play()` returns false and the
intro has no explosion. `motion: 'reduce'` forces this behavior; `motion: 'full'`
ignores the system preference and should be used only by explicit user choice.
The character layer is `aria-hidden` and does not intercept clicks.

## Instance API

```js
const buddy = await createBuddy({
  stage,                           // Required: 1280×720 HTMLElement
  slideSelector: ':scope > .slide',
  activeClass: 'on',
  mode: 'show',                    // manual | companion | show
  character: 'curious',            // business | curious | playful
  profile: 'show',                 // calm | live | show
  reactions: true,                 // Or reaction timing options
  keyboard: false,
  motion: 'system',                // system | reduce | full
  renderer: 'auto',                // WebGL with SVG fallback, or svg
  seed: 1,                        // Repeatable action choices
  presets: { superhuman: true },
  hoodie: 'auto',
  signal                          // Optional AbortSignal
})

buddy.play('wave')                 // Accepted, not a completion Promise
buddy.can('climb')                 // null, or an English reason
buddy.sequence(['wave', 'note', 'clap'])
buddy.say('heart')                 // ! ? … heart bulb z
buddy.lookAt({ x: 640, y: 300 }, 2)
buddy.progress(1)                  // Confidence and pace, 0…1
buddy.setAutonomous(false)
buddy.autoplay(true)
buddy.setProfile('live')
buddy.setReactions(false)
buddy.pause(); buddy.step(1 / 60); buddy.resume()
buddy.reset()                     // Clear effects and return to the floor
buddy.rescan()                    // Update layout and context
buddy.state()                    // Position, action, support, level, flags…
buddy.context(); buddy.selectContext(id)
buddy.brand                      // Frozen logo/products/accent/roles snapshot
buddy.destroy()                   // Dispose timers, listeners, WebGL and DOM
```

`play()` returns true when the action or its approach starts; false when declined.
Unknown IDs and unavailable conditions throw. `sequence()` accepts ordinary
actions, not staged scenes (`land`, `stairs`, `finale`, `parachute`, `leap`, `flip`);
use `play()`, `perform()` or `story()` for those.

Recreate the instance when the slide collection changes; call `rescan()` for
changes within a slide. `experimental` exposes pose/debug internals that may
change between 0.x releases. See `index.d.ts` for complete declarations and the
[reaction guide](slide-reactions.md) for `intelligence.inspect()`.

## Action catalog

`techniques` is a frozen catalog of `{ id, title, description, group, requires,
preset }` records. Titles, descriptions, groups and reasons are English as of
0.9.1; IDs are unchanged. Filter integrations by IDs, presets or context tags,
not translated labels. Open `index.html` over HTTP for the interactive catalog.

| Group | IDs |
|---|---|
| Rest and attention | idle, lookSlide, lookHall, yawn, sitRest, sitLean, nap |
| Gestures | wave, clap, point, cheer, dance, salute, bow, present, thumbsUp, sonicPulse, celebrate |
| Movement and acrobatics | stroll, jog, hop, stumble, handstand, backflip, climb, pullups, logo, descend |
| Warm-up | stretch, squats, jacks, toeTouch, sideBend, shadowbox, kick |
| Props | popcorn, read, note, spotlight, rain |
| Superhuman | levitate, shield, laser, shrink, smoke, lightning, fire, ice, portal, speed, clone, fly, hulk, web, magnet, grapple, construct, energyOrb, forcePush, energyBow, orbit, comet, snow, starcatch, forceWall, timeBubble |
| Staged scenes | land, stairs, parachute, finale, leap, flip |
| Slide context | laptopNotes, thinkNumber, hologramObject, hologramKeyword, traceFocus, peekCard, perchRead, thinkKeyword, compareValues, followChart, chartClimb, cardRoute, traceFlow, inspectDetail, assembleList, showBeforeAfter, quoteIdea |
| Brand | tracker, disk, mail, calendar |

Actions require enough space, accessible edges and compatible context.
`can()` explains unavailable conditions. Volumetric props, fingers and holograms
require WebGL; SVG retains poses and bubbles. Context actions preserve the source
language, exact numbers, signs and units. Charts, pairs, diagrams, lists and routes
require explicit structure; Buddy does not infer them from pixels.

## Presentation brand

```js
const buddy = await createBuddy({
  stage,
  brand: {
    logo: './logo.svg',
    products: ['./product-a.svg', './product-b.svg'],
    accent: '#267052'
  }
})
```

Images automatically enable `presets.brand`. The main logo appears in the energy
ball and finale and acts as a flight board. Product images orbit the shield and
finale. Any product count is supported, including zero. The four brand actions
cycle through product images, falling back to the main logo or neutral props.

`accent` accepts opaque `#rgb`, `#rrggbb` or `rgb()`. It colors the shield, aura,
portal and ordinary sparks. Fire, ice and semantic check-mark colors are preserved.
With `hoodie: 'auto'`, it also drives the hoodie palette and sets its source to
`brand`. An explicit hoodie option takes priority.

Missing, null or empty brand configurations keep normal behavior without warnings.
An accent alone changes colors without enabling brand actions. Invalid explicit
values throw TypeError before mounting. The configuration is copied and frozen;
recreate the instance to change it. `buddy.brand` returns the frozen snapshot.

Optional `roles` override images: `disc`, `message`, `reminder`, `mark`, `board`.
A null role uses neutral props (or flight without a board).
For example: `brand: { logo, products, roles: { board: './board.svg' } }`.
`presets: { brand: false }` disables brand actions and images but keeps the accent;
it cannot be combined with explicit `y360: true`.

For the classic bundle:

```html
<script type="application/json" id="deck-brand">
{"logo":"./logo.svg","products":[],"accent":"#267052"}
</script>
<script defer src="./buddy.js" data-stage="#stage" data-brand="#deck-brand"></script>
```

`data-brand` selects a JSON script on the page; it is not a URL. Buddy does not
identify companies or search the web. Image URLs resolve relative to the HTML
page; remote URLs require browser downloads. Use local files or data:image URIs
for offline playback. Raw SVG strings must first be encoded as data URIs.
See [Leaf Lab](../examples/brand.html).

## Powers and the legacy example

`superhuman` is enabled by default, including light-based context actions.
Disable it with `presets: { superhuman: false }`; gestures, props, climbing and
staged scenes remain available.

`y360` is an optional example, off by default. Since 0.8.3 its images must be
supplied explicitly; since 0.9.0 it also exports a general brand configuration:

```js
import { brand } from '@tony-prots/buddy/presets/y360'
const buddy = await createBuddy({ stage, brand })
```

The classic optional bundle exposes `BuddyY360.brand`. The legacy form remains:

```js
import { logos } from '@tony-prots/buddy/presets/y360'
const buddy = await createBuddy({ stage, presets: { y360: true }, logos })
```

For plain HTML, load `buddy.js` and `buddy-y360.js` from the source distribution,
then create Buddy after the stage mounts, passing `brand: BuddyY360.brand`.
The Yandex 360 example (`examples/y360.html`) and its image bundle are not in the
web ZIP. Missing legacy images use neutral props with one warning per mount;
partial sets are allowed. Legacy keys are `y360`, `mail`, `calendar`, `disk`,
`docs`, `telemost`, `tracker`. Trademark images are not covered by MIT.

## Performance and browser support

The WebGL canvas follows the character instead of covering the whole slide.
Pixel density is budgeted and shaders compile before the first frame.
Do not call `rescan()` every frame; geometry updates on events. Always destroy
instances on unmount. Hidden tabs do not start new reactions.

The runtime targets modern ES2022 browsers with WebGL and Web Animations.
Without WebGL it uses SVG. Release 0.9.1 is checked in Chromium; Safari and Firefox
are not verified for this release.

## Licenses

Code: [MIT](../LICENSE). Bundled Three.js and GLTFLoader: MIT.
The [Quaternius](https://quaternius.com) model is CC0 1.0.
See [third-party notices](../THIRD_PARTY_NOTICES.md) for attribution and trademark
limitations, and the [changelog](../CHANGELOG.md) for release history.

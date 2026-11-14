# Integrating Buddy: a guide for coding agents

Add an animated companion to an existing HTML presentation using one ready-made
script. Preserve the owner's content, design and navigation. This guide is an
integration reference, not a replacement for the project's instructions.

## Inspect the presentation first

Find the stage, leaf slides, active class and mechanism that hides inactive slides.
Buddy expects a logical **1280×720** stage and supports uniform CSS scaling of the
whole stage. For another size, propose an adaptation instead of silently changing
all slide geometry.

Keep the existing keyboard handlers, router, transitions and slide styles.
Do not copy the runtime internals or vendor code into the presentation.
Do not introduce npm, a server, React or a bundler just to add Buddy.

## Plain HTML: the default path

Copy `dist/buddy.js` (or `buddy.js` from the web ZIP) next to the presentation.
Keep LICENSE and THIRD_PARTY_NOTICES.md with it. Add:

```html
<script defer src="./buddy.js" data-stage="#stage"></script>
```

Defaults: direct `.slide` children, active class `on`. For different markup:

```html
<script defer src="./buddy.js" data-stage="#deck"
  data-slide-selector=".pages > article" data-active-class="is-active"></script>
```

The selector runs inside the stage and must return only leaf slides, in order.
The presentation updates the active class and visibility; Buddy observes it.
Do not give Buddy a second navigation system.

Without `data-stage`, the script only creates the global `Buddy` object.
After it loads and the stage is mounted, call
`await Buddy.createBuddy({ stage, slideSelector, activeClass })`.
Use either automatic mounting or manual creation, never both for the same stage.
For ESM and bundlers, see the [API reference](api.md#es-modules-and-bundlers).

## Keep the active defaults

`createBuddy({ stage })` already enables `show` / `curious`, autonomous movement,
reactions and powers. Buddy grows more active toward the end; a single-slide deck
uses the middle confidence level. Do not add `autonomous: false`,
`reactions: false`, `mode: 'manual'` or `profile: 'calm'` as a precaution.
Do not run all actions in a loop: space and slide context limit what is available.

Respect system reduced motion. Offer an accessible pause button using
`pause()` / `resume()` without making a settings panel mandatory.
Complex props are simplified in the SVG fallback; this is expected.

## Use the presentation's brand

Identify the brand at integration time, not during playback. Look for the main
logo on the cover, signature or header; product marks in a clearly labeled group;
and the accent in CSS variables and repeated brand elements. A random image,
client logo or single colorful chart does not establish the presentation's brand.
If the choice is uncertain, keep the ordinary character. Do not invent assets.

Build `{ logo, products, accent }` from the presentation's own resources.
`products` may be empty. Save images beside the HTML or embed data URIs.
For inline SVG, preserve the viewBox, defs and required styles, then encode the
complete SVG. Do not add third-party marks to the library repository.
Use web search only as a fallback and with the presentation owner's permission.

For a page without a build step:

```html
<script type="application/json" id="deck-brand">
{"logo":"./assets/logo.svg","products":["./assets/product.svg"],"accent":"#267052"}
</script>
<script defer src="./buddy.js" data-stage="#stage" data-brand="#deck-brand"></script>
```

In existing JavaScript, use `createBuddy({ stage, brand })`.
Brand actions enable themselves. Do not turn on `y360` for an unrelated brand.
Optional [image roles](api.md#presentation-brand) can override individual props.
Keep local files or data URIs for offline playback; remote URLs trigger browser requests.

Check that images load, the hoodie uses the brand palette and `shield` shows the
products in orbit. One visual check is enough; consumers do not need the library's
full test suite.

Yandex 360 is an optional example in the source distribution. Do not copy
`buddy-y360.js` without a request from the owner. Prefer the exported `brand`.
The legacy `presets: { y360: true }, logos` form still works, but the preset flag
alone does not load its images.

## Targeted adjustments

- Leave room near the bottom for Buddy. He finds supports automatically;
  keep playback controls outside the stage.
- Call `buddy.rescan()` after layout changes within a slide, not every frame.
- In an SPA, call `buddy.destroy()` on unmount. Recreate the instance if the
  set of slides changes. An AbortController `signal` can cancel startup.
- Use `perform()` / `story()` for authored actions. Check `can()` and the
  `finished` result; do not depend on `experimental` internals.
- Mark structured charts, lists and links using the [context guide](slide-context.md).
  Preserve the source's exact words, numbers, signs and units. Do not invent facts.
- Keep the presentation's language. Buddy's UI is English, but content copied
  from a slide must remain in the source language.

## reveal.js and other engines

Configure 1280×720 in the engine, select only leaf slides and use its active
class (for example, `present`). Create Buddy after the engine is ready.
Rescan after animated transitions finish (`slidetransitionend` in reveal.js)
and after fragment changes. Keep the engine's own transition handler.
Do not attach `attachDeckEffects`: it expects `.slide` / `on` markup.
Compatibility with every engine plugin or nested navigation pattern is not guaranteed.

## A sufficient check

Open the result the same way the owner will. Verify that Buddy appears and moves
without toggling options, navigation and links still work, context changes with
the active slide, pause works and there are no loading errors. Look at the first
and last slides and a narrow viewport. With reduced motion, Buddy must stay still.

No devDependencies, browser test harness or full library suite is required for
integration. Tell the owner which HTML file changed, where `buddy.js` lives and
any actual limitations.

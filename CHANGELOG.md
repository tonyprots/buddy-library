# Changelog

## 0.10.0 — 2026-11-15

- New README leads with the presentation experience, a real climb-and-magnet GIF
  and a one-script quick start. Added a replayable, offline showcase.
- Runtime modules and TypeScript declarations now live in `src/`, keeping the
  repository root focused. Package exports and `dist/buddy.js` are unchanged.
  Direct source-file imports must add `src/` to their path.
- Updated build, export, consumer fixtures and browser snapshots for the new
  layout. Active defaults and runtime behavior are unchanged.

## 0.9.1 — 2026-11-15

- English is now the primary language for README, API and agent guides,
  contributor documentation, examples and the interactive action catalog.
- Action titles, descriptions, groups, diagnostics, validation errors and the
  call-out bubble are in English. API identifiers and behavior defaults are unchanged.
  Integrations that matched Russian labels or error text must update those matches.
- Leaf Lab replaces the Russian presentation copy in the fictional-brand example.
- English and Russian source recognition is preserved. Buddy copies slide content
  in its original language rather than translating or inventing it.
- Release metadata, classic bundles, TypeScript help and exported documentation
  use the same language.

## 0.9.0 — 2026-11-15

First public GitHub release.

- General brand configuration: main logo, any number of product images, accent
  and optional prop roles. Images automatically enable brand actions; empty sets
  keep normal behavior.
- Runtime uses roles instead of service names. Products orbit shields and finales;
  the main logo appears in the energy ball, finale and flight. Accent colors
  affect the hoodie and energy effects.
- Classic data-brand selects a JSON script. The fictional-brand example works
  without a server or library modifications.
- Y360 exports the general brand format while preserving legacy y360 + logos use.
  Its images remain separate from the main bundle.
- Four brand actions now use preset brand; disk/mail/calendar/tracker IDs remain.
- Agent guidance covers identifying a brand from the deck, avoiding guesses and
  obtaining permission before fallback web search.

## 0.8.3 — 2026-11-15, pre-publication candidate

- Split Yandex 360 images into buddy-y360.js. ESM consumers pass explicitly
  imported logos; the preset flag alone no longer loads images.
  Missing images use neutral props and one warning.
- Added the optional Y360 example; excluded it and its images from the web ZIP.
- Warn on incorrect logical stage dimensions, while allowing uniform CSS scale.
- README points at dist. Export manifests are ignored by git and private project
  names no longer appear in the exporter. Repository metadata awaited publication.

## 0.8.2 — 2026-11-15, local distribution

- slideSelector and activeClass support custom and nested markup without replacing
  navigation. Classic data attributes, context, hoodie detection and progress use
  the same slide collection.
- Short README, separate API and agent guides, and a working mini-deck.
  Integration needs one local script, no npm, server or consumer test suite.
- Allowlisted web/source exports omit git history, private notes and personal decks.

## 0.8.1 — 2026-11-15, local distribution

- Active show/curious defaults in the library and demo; less resting in show mode.
- Powers begin after 15% deck progress and become more frequent toward the finale.
  Short and single-slide decks receive powers too. progress() controls confidence
  and pace; climbing and magnet behavior use progress rather than fixed slide indices.
- Automatic choices call registered action factories, so extra powers and context
  stories actually run when selected.
- Explicit manual, companion/live, calm, disabled presets and reduced motion remain.
- Updated browser tools for modes and independently selectable capture views.

## 0.8.0 — 2026-11-14, local distribution

- Added manual/companion/show modes, business/curious/playful characters and shared
  profile filtering across autonomous behavior and reactions. At this version,
  companion/live was the default; legacy explicit autoplay retained calm.
- Business and curious no longer sleep on long slides; playful may yawn and nap.
  Manual actions and marked scenes preserve author intent.
- focus() finishes the action, descends and finds clear floor; focus(false) restores settings.
- perform/story expose finished and cancel, staged actions, waits, gaze, context
  selection, AbortSignal and explicit cancellation reasons. Completion follows the
  whole engine queue, not an estimated busy flag or timer.
- Added mode, character, focus and story controls to the catalog; updated types and bundle.

## 0.7.0 — unreleased separately

- Automatic hoodie coloring from saturated deck accents in WebGL and SVG, with
  original-blue fallback and explicit overrides. Added outfit.js and buddy.hoodie.
- web/grapple availability now checks the same reachable edges and platforms as
  the action, avoiding can() success followed by a declined play().

## 0.6.0 — 2026-11-12, local distribution

- Autonomous behavior enabled by default. Explicit autoplay true/false preserves
  the legacy scheduler path. Added setAutonomous() and its state field.
- Slower staircase pacing, a pause per step and normal jumps; internal seated
  actions accept durations. Single-slide decks receive middle confidence.
- One classic dist/buddy.js bundle with data-stage mounting and file:// support.
- Reduced package contents to runtime and consumer docs; split fast, slow and
  browser checks. Removed private paths and internal links from public materials.

## 0.5.1 — 2026-11-11, local distribution

- Parachute launches from the floor through preparation and a real jump, checking
  a clear reachable corridor first. Auto framing smoothly zooms both ways and
  accounts for the actual model's head, hands and body.
- Smoothed confirmed transitions in climbing, jumping, grappling, flying, turning,
  running, comet catches and gestures. Held props and beams use real model anchors.
- Context stories preserve source data and stop when it changes. Fixed first-transition
  contact height, restart, cleanup and live reduced-motion changes.
- Reduced unnecessary canvas resizing, preserved density, and fixed private-texture
  and late-model disposal. Measure signature geometry before the floor scan.
- Added the internal rig/prop contract. A complete independent visual acceptance
  of all 93 actions was not claimed for this local milestone.
- Stay on a newly reached platform for six seconds; wait 15 seconds after descending
  before climbing, grappling, webbing or pull-ups again.
- Grappling follows side edges rather than pulling diagonally through cards.
  Reject supports without headroom. Hands and feet follow rounded lower corners.
- Added quick running jumps and fixed hour-long idle waits after reset or enabling
  autonomous behavior. Staircase pacing was subsequently refined in 0.6.0.

## 0.5.0 — local distribution

- Ten new context stories complete a set of 17; the full catalog reaches 93 IDs.
- Explicit value/image pairs, charts, bars, routes, diagrams, lists and crops,
  with exact source data and structured issues instead of guessed or truncated facts.
- Dedicated choreography and props for thinking, comparing, pointing, climbing,
  magnifying, cards and projections. Preserve labels, images and checkbox states.
- Source-linked projections, word-wrapped text and at least 1.5× crop magnification.
  Close-ups include local props; automatic framing includes distant targets.
- Smoothed IK handoffs in peekCard, perchRead and cardRoute. Diagram beams switch
  off between links and smoothly re-aim; up to three links per story.
- SVG copies preserve viewport, letterboxing and inner transforms. Root CSS scale
  is applied once; unsupported root transforms give explicit rejection reasons.
  Calibrated WebKit SVG matrices when ancestor CSS scale is omitted.

## 0.4.0 — local distribution

- First seven context actions: laptopNotes, thinkNumber, hologramObject,
  hologramKeyword, traceFocus, peekCard and perchRead. Existing contextual actions
  retain IDs and groups while gaining context tags.
- Frozen context snapshots, manual source selection, synchronous rescan, standalone
  analyzer and controlled bilingual concept dictionary with TypeScript exports.
- Exact signs, separators, scale and units; no automatic approval based on a number.
  Whole-word concepts honor nearby negation. Hidden content, signature, navigation
  and Buddy's own layer are excluded.
- Explicit markers and manual selection outrank heuristics; ambiguity is never
  resolved randomly. Compatibility is checked before floor and edge geometry.
- Short thoughts/highlights in calm; longer stories in live/show, once per visit.
  Source changes cancel old actions without per-frame DOM scans.
- grounded reports physical support independently of the retained surface label.
  Local framing includes complete thought bubbles and projection captions.

## 0.3.1 — local distribution

- Catalog buttons no longer shrink below their text; mobile grid rows use natural
  height. All 76 then-current actions were checked at 320, 768, 1024 and 1440 px
  for text clipping, horizontal overflow and gaps of at least 8 px.

## 0.3.0 — local distribution

- Separated ordinary gestures/props, Superhuman powers and optional Y360 actions,
  preserving IDs. Ordinary additions no longer require superhuman.
- Unified calm/live/show scheduling, seeded choices and independent autoplay/reaction
  controls. Manual actions start a shared cooldown and are not interrupted.
- Read-only analysis, support geometry, chosen reactions and rejection reasons.
  Signature perches are separate from Y360 images.
- Stars leave above the slide; crates and kicked comets leave sideways. Confetti
  settles before cleanup, and time fragments do not restart their motion cycle.
- Reserved trajectories before the first action frame; fixed paused CSS zoom
  resolution and close-up outline thickness.
- Catalog preserves scene and manual camera choice; automatic framing includes
  actor, props, targets and full trajectories. Added slide-analysis diagnostics.

## 0.2.0 — local distribution

- Rechoreographed 17 actions into preparation, action, contact and recovery phases.
- Replaced their flat props with 14 types of volumetric props; flashlight retains
  a soft SVG light spot. Open hands, fists and thumbs-up use actual finger bones.
- Present/spotlight aim at explicit targets, then headings and media.
  Flying objects move independently, attach on catch and detach on release.
- Star enters from above and reaches the palm at 1.9 s. Orbit grows to 2.7×;
  time bubble surrounds the body. Larger energy sphere, 96 paper confetti pieces,
  clearer comet/umbrella handling, and corrected bow/string/arrow alignment.
- sonicPulse uses a short call-out bubble instead of 3D rings and does not add a cape.
  Force push moves a crate; spotlight reaches the actual target.
- hulk grows to 3.4×, inspects its hands, takes two heavy steps, then shrinks back.
- Removed binoculars from the public API, leaving 76 actions. Catalog clicks can
  enable the Y360 example while library defaults keep it off.
- step() preserves fractional time, including 24 fps exports. Geometry tests cover
  contacts, independent flight, hand metadata and prop cleanup.
- SVG fallback retains poses and the call-out, without 3D props or articulated fingers.

## 0.1.0 — 2026-11-10, local distribution

- First standalone Buddy: 77 actions, including 17 new gestures, powers and props.
- Default superhuman and optional Y360; local reactions to closing slides, dividers,
  images and prominent numbers; breakout intro and interactive catalog.
- Isolated instances, resource cleanup and live reduced motion. Fixed pose reset,
  interrupted flight and synchronous navigation.
- Corrected eye/mouth shader masks and softened skin contact shadows.
- Local modules without CDN loads, with automated checks.

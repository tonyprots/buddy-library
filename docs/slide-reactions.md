# Automatic behavior and slide reactions

Buddy has one controller for semantic reactions and scheduled actions. Autonomous
movement is active by default, with show/curious settings. Use mode, character and
profile controls described in the [API reference](api.md#default-behavior).

## Rhythm and scheduling

`autoplay()` controls the separate interval scheduler; `setReactions()` controls
slide-content reactions. `pause()` suspends both and simulation time;
`resume()` restores their settings. Changing profiles does not interrupt an action.

| Profile | Quiet window | Minimum cooldown | Scheduled action interval | Repertoire |
|---|---:|---:|---:|---|
| calm | 6 s | 45 s | 45–50 s | Glances, greetings, presenting, reading, notes, stretching, walks |
| live | 4 s | 24 s | 24–30 s | Gestures, umbrella, flashlight, warm-up, walking, climbing, signature |
| show | 2.5 s | 14 s | 14–18 s | Broader repertoire, acrobatics and powers |

These timings govern reactions and explicit autoplay. Default autonomous behavior
also responds to deck progress: in show mode its power selection interval decreases
from about 25–34 to 10–13 seconds. Current actions finish first. Single-slide decks
use the middle of the range; `progress()` controls confidence and pace manually.

`autoplayProfiles` exports exact action sets and timing options. `ambientMs` is the
raw random-delay range; the final delay is at least `cooldownMs`. Presets and actual
geometry further limit availability. Show does not enable Y360 images.

A seeded generator shuffles candidates. Equal seeds, events and availability give
equal choices. The previous action is not repeated immediately; inspection does
not consume randomness. Browser timing still depends on load and action duration.

`reactions: { quietMs, cooldownMs, revisitMs, staleMs, debounceMs, onReaction }`
overrides timing in milliseconds. Cooldown applies to both controller modes.
Manual play, sequence and reset skip the current visit's reaction and start a new
shared cooldown.

## Slide classification

Rules run in this order; explicit markup takes precedence. Confidence is a fixed
rule score, not a statistical probability.

| Kind | Detection | Candidates |
|---|---|---|
| off | data-buddy-react="none" or role off | No semantic reaction; autonomous movement is separate |
| Explicit role | data-buddy-scene; legacy data-buddy-kind or data-scene | Candidates for the selected kind |
| finale | data-buddy-fly, or a short Thank you / Questions? heading; Russian equivalents also work | bow, celebrate, wave; celebrate requires show |
| divider | .divider or role="separator" | salute, present, lookSlide |
| title | .cover | salute, wave, lookSlide |
| image | Largest visible img/video/svg/canvas covers at least 30% of the slide and is at least 200×140 | present, point, lookSlide |
| number | data-buddy-number, or a number in h1–h3/strong/.stat/.num at font size ≥40 px | Context thought or highlight; otherwise note or point |
| content | Other slides | Glance at the selected target |

Aliases stat/numbers mean number; empty/platforms/stairs mean content.
CSS background images are not recognized. The analyzer checks up to 80 media
and 100 numeric candidates, without adding separate image areas together.
Hidden and zero-size elements, `data-buddy-ignore`, SVG internals and Buddy's own
layer are excluded. A number does not imply a positive result.

[Slide context](slide-context.md) adds exact numbers, text, concepts, images,
cards and explicit structured sources. An unambiguous compatible context story
outranks a generic gesture. Calm uses short thoughts and highlights; live/show
allow longer stories, while automatic chartClimb/cardRoute require show.
Only one context story runs per visit. Equal top-priority sources are not chosen
randomly; use `selectContext()` or `data-buddy-react` to specify intent.

Targets are chosen from `data-buddy-focus`, then `data-buddy-target`, then the
classified content and heading. Their center and dimensions use stage coordinates.
A gaze target is geometry, not an interpretation of meaning.

```html
<section class="slide" data-buddy-scene="number">
  <h2>Experiment result</h2>
  <strong data-buddy-number data-buddy-focus>4.2×</strong>
</section>
```

`data-buddy-react="wave"` chooses an explicit action. It still respects availability,
quiet windows and busy state. Unknown or unavailable IDs appear in diagnostics;
when no candidate can run, the controller uses a glance.

## Supports and signature

| Source | Actions | Result |
|---|---|---|
| Explicit target, heading or media | present, spotlight | Turn toward the target; flashlight beam reaches it |
| Slide direction and attention target | lookSlide, point | Prepared gestures; eyes separately track the target |
| Accessible card edge | climb, pullups | Approach, climb or hang and pull up |
| Reachable platform | web, grapple | Attach a thread or hook and pull up |
| Accessible icon | magnet, construct | Attract and return the icon, or copy its shape in light |
| Nearby tile and enabled brand preset | tracker | Stamp the tile with a check mark |
| data-buddy-land | land | Land on the marked block |
| data-buddy-stairs | stairs | Follow the staircase and parachute down |
| data-buddy-fly | finale | Fly, like and circle |
| .brand perch | logo, descend | Climb onto the signature and return |

Other gestures and powers use clear floor space. Their stars, comets, boxes and
spheres are authored props, not objects recognized in a slide image.
`can()` checks real geometry; an arbitrary rectangle is not necessarily usable.
The legacy point pose indicates the slide's direction without exact fingertip
alignment. Spotlight provides precise beam aiming.

A `.brand` element can contain an avatar `[data-perch]` and lettering
`[data-perch-text]`. This physical perch is separate from the optional brand image
configuration. It does not enable or replace brand actions.
Buddy uses the avatar on slide indices 0, 3, 6… and letter tops otherwise.
If one marker is absent, the available one is used. With neither, legacy `.brand`
geometry is used and needs a layout check. Autonomous climbing and logo actions
belong to live/show.

`inspect().analysis.brand` shows the signature text, markers and chosen support.
`inspect().world` contains clear floor intervals, platform ranges, reachable walls
and a logo perch or null. Text, tight areas, unsuitable heights and continuously
moving blocks are excluded. Supports guide Buddy's own contacts; props do not have
universal collisions against every DOM element. A moving box can briefly pass in
front of the signature. Auto framing does not turn the slide into a physics engine.

## What blocks a reaction

A new reaction starts only in idle with no queued movement. It does not interrupt
walking, poses, sleep or powers. At most one semantic reaction (including a glance)
runs per visit, with at least 90 seconds before revisiting the same DOM slide.
The controller looks for a suitable moment for 16 seconds after the quiet window;
late reactions are skipped. A scheduled action that finds Buddy busy receives a
fresh delay instead of accumulating in a queue.

Pause, hidden tabs, offscreen or zero-size stages and reduced motion block new
actions. Returning to the page starts a fresh schedule, not an immediate backlog.
The current action and chosen settings are preserved across pause/resume.

## Diagnostics and cost

`buddy.intelligence` is a read-only facade. `state()` exposes cached analysis,
the last event, profile, flags, measure count and timer state. `inspect()` adds
the current verdict, candidates and can() rejections, world supports and rhythm.
`last.source` distinguishes semantic and ambient actions; `last.rejected` records
reasons from the last attempt. Results are deeply frozen copies with no DOM or
engine references. `reactionState()` is a shortcut to state().

`context.issues` reports malformed structures such as mismatched units, missing
link endpoints or out-of-image crops. Relevant issues also explain can() failures.

Analysis runs on slide changes, DOM mutations, media loads and resize. Mutations
are debounced for 140 ms. inspect() does not rescan; can() may refresh engine
geometry already marked dirty. The controller has no per-frame DOM measurement
loop. destroy() removes observers, listeners and timers.

Input/change events update checkbox state. Call rescan() after a property change
without an event. Source changes cancel the old context action; new content is
not silently substituted into a running story.

`attachSlideIntelligence({ stage, buddy, ... })` remains an export for custom
character adapters. A createBuddy instance already owns one controller; use its
methods rather than attaching another.

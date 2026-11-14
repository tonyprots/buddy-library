# Additional actions

The 17 actions introduced in 0.2 use no corporate marks. Greetings, bowing,
presenting, thumbs-up, calling out and confetti are Gestures; flashlight and
umbrella are Props. They do not require superhuman. The remaining actions do.
Use play() to start and can() to check conditions. A standing floor pose is required;
ordinary sequence() and automatic scheduling can also use these actions.

Each has dedicated preparation, contact, hold/release and recovery phases.
prop3 supplies volumetric props; the hand solver and real finger bones drive grips.

| ID | Behavior | Duration, simulation seconds |
|---|---|---:|
| salute | Open palm and nod toward the audience | 3.6 |
| bow | Hand to chest, weight shift and bow | 4.0 |
| present | Look at the target and present with open palms | 4.8 |
| thumbsUp | Raise an articulated thumb, nod, lower the hand | 4.2 |
| spotlight | Aim flashlight and light spot at slide content | 6.4 |
| celebrate | Clap overhead; confetti settles before cleanup | 5.8 |
| energyOrb | Grow a large sphere above the palms, then extinguish | 6.8 |
| forcePush | Send a crate beyond the slide edge with a force wave | 5.4 |
| sonicPulse | Call Hey!, wave and listen | 5.6 |
| energyBow | Draw a bow and watch the released arrow | 6.6 |
| orbit | Raise a large orbital system overhead and return it | 6.8 |
| comet | Catch, cool, drop and kick a comet out of frame | 6.8 |
| rain | Open a folded umbrella, wait out rain, fold it away | 7.8 |
| snow | Catch, inspect and blow away a crystal | 7.0 |
| starcatch | Catch a star from above and release it upward | 6.8 |
| forceWall | Brace a shield against a visible comet impact | 6.4 |
| timeBubble | Slow fragments around the body and restore their speed | 7.4 |

Durations come from extraTechniques. pause() stops simulation time; step(seconds)
preserves fractional time rather than rounding to a whole frame count.

## Targets

present and spotlight search the active slide in order: data-buddy-focus,
data-buddy-target, h1, h2, img, video. Each selector uses its first element,
skipping zero-width targets. Mark the intended visible target explicitly.
Selection occurs at action start; without a target, use a point ahead and above
Buddy. Original slide content remains in place. Flashlight beam length reaches
the actual target, with a soft SVG spot that is removed on finish or interruption.

## Contacts and flight

Incoming comet, snowflake and star use world coordinates. They follow the palm
only after contact and move independently again on release. Arrows also detach
at launch. Eyes follow the object.

- energyOrb uses radius 18 and up to 1.55× scale, growing from a small core.
- orbit reaches 2.7× scale and raises its center 85 stage pixels above the floor.
- timeBubble surrounds the body at radius52 with independently enlarged fragments.
- starcatch starts beyond the top edge, contacts the hand around 1.9 s and exits above.
- The umbrella is visibly folded before opening, with the canopy clear of the head.
- Bow curvature, string and arrow align with the drawing hand.

See [prop builders](ability-props.md) and the [rig contract](internal-rig-contract.md)
for dimensions, anchors and contact output buffers. Do not add a second animation
loop, timer or event system: all poses and props use the engine clock.

## Fallback and interruption

WebGL is required for full volumetric props and finger articulation. SVG retains
poses and the Hey! bubble, but does not reproduce all props, including the older
book, notebook and parachute. Check buddy.renderer when full rendering matters.
Reduced motion prevents these actions from starting.

Each action owns its props and SVG effects. Interruption hides/removes them;
destroy() disposes instance resources. Do not allocate meshes/materials per frame
or mutate the original slide elements.

new-abilities.test.mjs uses the real solver and simulation clock, checking both
facings, finite coordinates, hand metadata, visibility, cleanup, contact, independent
flight and catch transitions. Full motion sequences still need visual review;
frame-series inspection is not a claim of continuous real-time playback quality.

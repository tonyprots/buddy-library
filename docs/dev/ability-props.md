# Volumetric ability props

Additional actions use the same 3D rig as books, notebooks and parachutes.
Geometry is created lazily, using shared toon materials, colored contact shadows
and screen-space outlines. No external images or downloads are needed.

```js
import { createAbilityPropBuilders } from './ability-props.js'
raw.tools.registerPropBuilders(createAbilityPropBuilders) // Once per instance
const prop = raw.tools.prop3('abilityOrb', (state, skeleton) => ({
  at: skeleton.arms[0].hand, t: state.t, fade: state.fade,
  charge: state.charge, box: state.box
}))
prop.ping = true // Every active action frame
prop.done = true // On completion or interruption
```

This is an internal authoring interface. Consumers use buddy.play/perform/story.
Ordinary actions should not access Three.js directly.

Common fields: at is a skeleton point, atW a stage pixel point, dir/to direction
or target, up orientation, grip local holding point, k scale, t simulation seconds,
fade visibility 0…1. box covers the prop in stage pixels and expands the small
WebGL canvas; explicitly include long trails, beams and rain.

Builder geometry uses Three.js axes: x lateral, y up, z forward. Dimensions below
are skeleton units, not meters or stage pixels. Solve hand contact in 3D before
projection. Released arrows and comets must move independently of the hands.

## Builders

| Builder | Geometry | Parameters |
|---|---|---|
| abilityComet | Irregular rock radius 5.5, trail along −z to 38, embers | tail/heat 0…1; independent spin time |
| abilityOrb | Shell radius 6, blue volume, bright core and highlights | charge 0…1; radius 6…18 |
| abilityBow | Grip at origin, bow curves toward +z; tips [0,±18,−5], nock [0,0,−5−12*draw] | draw 0…1 |
| abilityArrow | Along +z, tail −14, tip +11 | Common fields |
| abilityUmbrella | Grip at origin, shaft y−5…49, eight panels; rim y31.7 radius23.8; folded cloth y26…48 | open/rain 0…1; dropLength 20…180, default90 |
| abilitySnowflake | Six 3D branches, radius7, face +z | melt 0…1; spin radians |
| abilityStar | Five points, radius7, thickness2.1, beveled edges | spin radians |
| abilityOrbit | Central body, three orbital planes and a ring | speed0…3, radius0.4…2, integrated clock |
| abilityCrate | 24³ wooden crate with frame and seams; anchor at bottom center | tilt around local x; at/atW movement |
| abilityForceWall | Translucent 25×42×1.4 panel, rigid frame, reflections and impact waves | impact0…1 |
| abilityTimeBubble | Body shell, twelve non-looping fragments and two belts | freeze 0…1, particle clock, radius 18…64, fragmentScale 1…3.5 |
| abilityForceWave | Three push rings; legacy sonic variant remains internal | kind push or sonic; spread0…1 |
| abilityFlashlight | Grip [0,0,−3], lens z6, soft 3D cone | beam0…1, beamLength12…8000, beamRadius3…80 |
| abilityConfetti | 96 thick ribbons3×7 and squares4×4, settling flat on the floor | t after clap, floorDrop, legacy burst0…1 |

## Placement details

Umbrella rain starts at the rim; panels intercept interior drops while exterior
drops continue. The folded fabric spans width3.2…6.8, with a radius3 strap.
Use both dir and up to tilt the closed umbrella. Its raised canopy must visibly
clear the head after opening.

A flashlight cone stays subtle. A separate soft SVG spot marks the actual target
surface and disappears before the flashlight is put away. The spot is action-owned.
Comet heat and embers fade separately from the rock so the caught object can cool.

The crate is the visible target of forcePush. The action moves and tilts it after
the wave arrives; the builder does not solve collisions independently of choreography.
For the large orb use radius 18, not only k, so palm contacts match the radius.
Time bubble uses radius52 and fragmentScale2.2 independently, usually with k=1.
The drawn bow's rear hand reaches z−17. Arrow direction stays fixed after release.

Confetti needs bounds around ±115 stage pixels horizontally and 130 upward at
standard character scale. Its 96 pieces use 1536 triangles. Each settles at
floorDrop, lies flat, then fades. sonicPulse uses a separate Hey! SVG bubble,
not 3D sound waves.

## Fingers and cleanup

`handShape: {kind:'thumbsUp',side:0,amount:1}` curls four real model fingers and
points the thumb upward. handOpen and handFist are two-element 0…1 arrays.
Absent metadata preserves existing hand behavior; no extra spheres replace fingers.

Update transforms and uniforms in place. Do not allocate meshes, geometry,
materials or textures each frame. Resources are reachable from the rig and disposed
by destroy(). Interruption hides a prop; replay reuses its geometry.
Tests in ability-props.test.mjs use real Three.js and validate finite parameters,
allocation stability and finger behavior. They do not replace full visual cycles
from both facing directions.

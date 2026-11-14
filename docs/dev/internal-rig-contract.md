# Internal rig and prop contract

For movement authors. These are implementation details of runtime.js, vendor.js
and the action modules, not stable createBuddy API. `experimental`, `raw.tools`
and the rig can change in 0.x. SVG and WebGL do not promise identical detail.

## Pose and hand channels

Side 0 is model .L and side 1 is .R, not screen-left/right. Visible sides depend
on yaw and facing. Intensity values must be finite in 0…1; absent fields or zero
weights disable the corresponding addition.

| Channel | Meaning |
|---|---|
| handFacing: [left,right] | Rotate wrists around the forearm axis toward the viewer, accounting for yaw; do not move wrists or elbows |
| handOpen: [left,right] | Reduce finger curl; absence keeps ordinary curl, default 0.55 |
| handFist: [left,right] | Add fist curl and thumb bend; applied after opening |
| handShape: {kind:'thumbsUp',side,amount} | Dedicated thumb gesture; amount defaults to 1 |
| handContact / handContactAmount | clap or floor contact, orienting palms and opening fingers; unknown values have no effect |
| handTask: {kind,amount:[left,right]} | support, press, grip or ledge orientation; grip accepts axis, ledge accepts face and aligns actual joints to IK geometry |

These fields are metadata, not numeric skeleton channels. mix(), copy() and
inertialization operate on SC/AR only. Set optional metadata after blending on
every required frame and explicitly choreograph its entry, hold and exit.
api.pose applies handFacing, then pose contact, then handTask; later branches see
the already-modified wrist. New channels should default to no effect and be checked
against existing actions before broader use.

## Held-prop contact

Pose the hands first, including handTask if needed. heldContact(it, P) then places
the prop using kind, amount and side. It requires a ready rig, positive weight and
builder-provided contactMeshes.

- support places solid prop geometry above the actual palm with a small clearance.
- press uses both palms and aligns orientation and the near solid surface to their axis.
- grip aligns the midpoint between Middle1/Middle2 with P.grip; optional offset
  shifts along the palm normal and fingers. This branch returns before contact.out.

Include only solid contact geometry in contactMeshes, excluding trails, glow and
outlines. Unique vertices are cached for support/press. contact.near resolves equal
extrema. Placement blends by amount; this is not a general physics solver.

The action owns a mutable contact.out buffer. After WebGL support/press placement:

| Entry | Coordinates |
|---|---|
| 0 | Prop origin world x in stage pixels |
| 1 | Prop origin world y, downward, in stage pixels |
| 2 | g.position.x / U: local lateral side in skeleton units, not world z |

The buffer is written during prop rendering, not pose calculation. It may initially
be empty or retain a stale value when contact stops. releasedAt() saves the result
as a launch position and uses an estimated fallback when unavailable. Give every
action its own buffer.

api.prop applies contact.aimAtW and contact.placed after contact placement.
The first re-aims toward a stage target after grip relocation. The second receives
stage x, y, dx, dy only when the group chain is visible. DOM/effect ownership stays
with the action.

## Coordinates and anchors

solve() returns skeleton points in forward/down/lateral axes. P.at and P.to use
those axes; vendor V() converts them into local 3D axes with scale U. P.atW is a
stage [x,y] point in pixels. P.side is local lateral depth in skeleton units.
P.grip is an unscaled, unrotated point on the prop to align to the holding point.
P.k defaults to 1; return null to hide, since prop scale is clamped above zero.

SVG fig.draw computes handsW from solved hands, with simplified palms. render()
initializes palmsW from handsW as a fallback. In WebGL, renderAnchors() runs after
pose/place, using Wrist/Index/Pinky bones and actual eye/mouth surface points.
Surface palmsW is updated with includePalms, currently requested for lightning.
Anchors refresh before prop callbacks when P3 exists, and before effects/afterRender.

legacyHandPoint() is the Middle1/Middle2 midpoint for older grips. No single anchor
proves full-palm contact or absence of mesh intersections. hands()/mouth() buffers
are reused; copy values that must survive a frame.

Handstand with handContact='floor' requests handContactSupports() before
groundSolve(). WebGL uses skinned geometry; the fallback uses calculated contacts().
The physical point sets need not match exactly across renderers.

## Ownership and lifecycle

registerPropBuilders(factory) registers per-rig builders. Invalid or duplicate
names throw. A builder runs lazily on first api.prop(name,P) and returns {g,upd}
plus optional contactMeshes. The kit provides units, geometry, materials and
transparency helpers. SVG registration returns 0; it does not create an SVG equivalent.

prop3(name,fn) creates a P3 slot with ping=true and miss=0. Names identify slots;
registering the same name replaces its callback. Set ping=true on each active
frame. done or miss>0.2 removes the slot and hides the prop. Returning null hides
only that frame. SVG does not run draw3d(), so SVG effects need their own lifecycle.

Action owners mark props done, remove SVG effects and restore modified DOM on
completion, interruption, reset and destroy. Runtime disposal walks and deduplicates
reachable geometries, materials, textures and skeletons, then closes the renderer.
Resources outside that traversal need explicit hooks. Laptop screen textures use
material.dispose hooks; the runtime avoids disposing hooked resources twice.
Create resources in builders and update existing values in upd(P), never per frame.

## Source map

Use symbol names rather than fixed line numbers as the code evolves:

- runtime.js: SC/AR, mix, frame, chGet, render, legacyHandPoint, prop3, dispose3d.
- vendor.js: api.pose, heldContact, api.prop, api.renderAnchors, handContactSupports.
- new-abilities.js: heldCenter, releasedAt, cometOpenFrom.
- context-props.js and context-story-props.js: source-bound props and texture cleanup.

Geometry tests validate concrete contacts; full visual cycles are still necessary.

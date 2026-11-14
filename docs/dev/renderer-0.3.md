# Renderer: zoom, pause and framing

## Paused zoom bug

A frozen pose became blurry and darker when CSS scale changed 1 → 3 → 1.
The backing buffer stayed 320×320 while displayed size grew from 80×80 to 240×240.
A simulation step did not fix it; a resize event did.

Scale-cache expiry used simulation time, which stops while paused. ResizeObserver
tracks logical dimensions, not ordinary transform scale. Separately, a constant
2.5 backing-pixel outline became 2.5 instead of 1.25 screen pixels when supersampling
was capped. Lighting and AO were unchanged; brightness compensation would hide the bug.

## Fix and verification limits

Observe scale-affecting changes on stage and ancestors: transform, individual scale,
zoom, classes and CSS variables. Translation alone does not reallocate. Paused
updates redraw only, without frame(), time advancement or resumed autonomous actions.
Outline width is `1.25 * bufferRatio / screenRatio`. Resize, DPR and CSS transition
completion are tracked separately; the fallback cache uses real time.

In the historical check the buffer changed 320² → 480² → 320² and shader uPx
2.5 → 1.25 → 2.5, preserving 1.25 screen pixels. Pause, parent scale, individual
scale and translation-only cases passed. Headless CDP DPR changes did not emit
the expected native resize signal, so the helper explicitly reproduced it.
This does not claim a real window move between monitors was tested.
With that signal, DPR2 → DPR1 reduced the buffer from 320² to 160² and density
from 4 to 2, preserving outline width and frozen simulation time.

## Framing API

framing() returns frozen cached bounds in 1280×720 stage coordinates:

```js
{
  actor: [x1,y1,x2,y2],
  props: [x1,y1,x2,y2] || null,
  detail: [x1,y1,x2,y2] || null,
  planned: [x1,y1,x2,y2] || null
}
```

Actor bounds include body, head and visible clones. Props union visible P.box
bounds. Detail covers a local semantic result such as bubble text. Planned bounds
capture the intended path. These are object bounds, not the entire WebGL canvas.
Reads do not measure DOM; the camera can follow a plan instead of every particle.

## Reserving a trajectory

Set action.canvasBounds before begin(), or call reserveCanvasBounds(bounds) once.
Absolute stage bounds are unioned with actor padding and reserved for the current
action. Action changes and reset clear the reservation; rest returns to a small canvas.

Camera frameBounds and renderer canvasBounds may differ. Offstage motion need not
enter camera bounds. Return null once a prop leaves entirely so it does not expand
the buffer for invisible geometry. SVG-based disc/message props use camera plans
without a needless broad WebGL reservation. Flight has a plan; hulk reserves its
maximum body size. Zero reallocations are not promised for all legacy actions.

## Historical measurements

Measurements used one local HeadlessChrome153 on macOS arm64, DPR2, with frozen
zoom poses and 480 manual steps at 1/60 s. Arrow reallocations dropped from 8 to 1;
its p95 CPU step time changed from 1.2 to 1.1 ms. These synchronous CPU timings do
not establish GPU throughput, real-time FPS or a worst-case frame-time guarantee.
A later repeat recorded one preparation allocation and one in-run allocation for
arrow and force push, with p95 CPU times 1.3 and 1.6 ms. Timing variance does not
change those limits.

renderer-state.test.mjs checks immutable bounds, no DOM reads, clone inclusion
and reservation validation. Browser checks are in tests/browser/renderer-check.mjs;
BUDDY_RENDER_ASSERT enables assertions and BUDDY_RENDER_REPORT selects output.
Historical raw screenshots and logs are not part of the public package.

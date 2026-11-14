# Slide context

Buddy uses a specific source: a number, short text, known concept, image, card or
explicitly marked structure. The analyzer reads visible DOM content and stores
its exact wording and coordinates. It does not read text inside images, recognize
arbitrary photographs or infer success from a number. Source text stays in its
original language; the surrounding API and diagnostics are English.

## Reading and selecting context

Context is included with `createBuddy()`, even when autoplay and reactions are off.
Do not create a second controller.

```js
const buddy = await createBuddy({ stage, mode: 'manual' })
const number = buddy.context().facts.find(fact => fact.kind === 'number')
if (number) {
  buddy.selectContext(number.id)
  if (!buddy.can('thinkNumber')) buddy.play('thinkNumber')
}
buddy.selectContext(null) // Return to automatic selection
```

`context()` returns a deeply frozen snapshot, without DOM references:

```js
{
  available: true,
  selectedId: null,
  reason: 'Automatic selection by markers, emphasis and heading',
  measures: 1,
  issues: [],
  facts: [{
    id: 'demo-value:number:1', kind: 'number', text: '−18%',
    target: { x: 640, y: 300, width: 220, height: 90 },
    priority: 430, reason: 'Explicit context marker'
  }]
}
```

`selectedId: null` means automatic selection. An unknown ID throws without changing
the selection. Moving to another DOM slide clears selection; rescanning the same
element preserves its ID. `measures` increments on analysis, not snapshot reads.

`issues` contains invalid explicit structures with their container `id`, `kind`,
`reason` and `target`. Invalid structures are absent from `facts`; they do not
silently disappear without an explanation. For example, comparing `42%` and `$27`
reports incompatible units.

Manual selection is binding: an image action will not substitute another image
when you selected a number. `can()` checks compatibility before floor geometry.
A card rectangle alone does not guarantee a safe route for `peekCard` or `perchRead`.
Without a compatible fact, `can()` can return a relevant structure issue.

## Author markup

```html
<strong data-buddy-context="number" data-buddy-context-id="result">−18%</strong>
<h2 data-buddy-context="keyword" data-buddy-concept="memory">Context</h2>
<p data-buddy-context="text" data-buddy-focus>A short statement from the slide</p>
<img data-buddy-context="object" src="diagram.svg" alt="Connection diagram">
<article data-buddy-context="card" data-buddy-text="Example">…</article>
```

| Attribute | Meaning |
|---|---|
| `data-buddy-context` | number, text, keyword, object, card or a [structured kind](#structured-facts) |
| `data-buddy-context-id` | Stable ID base; the analyzer appends kind and fact number |
| `data-buddy-concept` | One of eight prepared visuals, not a free-form prompt |
| `data-buddy-text` | Author-selected short text instead of longer content |
| `data-buddy-focus`, `data-buddy-target` | Raise priority without assigning a kind |
| `data-buddy-ignore` | Exclude this element and its descendants |

An explicit kind limits facts from that element. A marked card does not also
become a number or text fact. Nested sources can have separate markers.
Use the full `fact.id` from the snapshot when selecting manually.

## Automatic recognition

Priority is explicit marker → highlighted source → heading → other visible
emphasized content. Within one location, a number outranks a concept, which
outranks text. Equal compatible top-priority sources are ambiguous: Buddy skips
the action and asks for a source selection. Random scheduling does not break ties.

The analyzer considers up to 200 candidate elements and 80 facts. Headings,
`strong`, `em`, `pre`, `code` and explicit markers provide text up to 180 characters.
Numbers come from headings, highlighted sources, `data-buddy-number` and elements
with font size at least 40 px. Signs, decimal separators, grouping spaces and known
units are preserved: `−18%`, `4.2×`, `$1 000`, `12 ms`, `5 s`. Russian words and
units are supported too. Dates and times are not split into unrelated numbers.
The unit vocabulary is limited; unfamiliar units and charts need explicit markup.

An error rate of `42%` is a neutral fact, not a reason to celebrate. Numerical
reactions can think about, underline or record the value.

Visible `img` and root `svg` elements are image sources; their content is not
interpreted. Captions come from `alt` / `aria-label`. Projections copy the actual
source; prepared 3D visuals use `concept`. Cards match `.card`, `.tile`,
`data-buddy-card` or explicit kind `card`, with minimum dimensions 80×45 in stage
coordinates. Reachability is checked separately.

Hidden elements, `.brand`, perch markers, navigation and `.buddy` are excluded.
Block boundaries become spaces, while inline units stay attached:
`42<span>%</span>` becomes `42%`. Internal numeric spacing is preserved.

## Concept vocabulary

| Concept | English examples |
|---|---|
| memory | memory, context |
| target | target, goal |
| team | team, agents, swarm |
| chain | workflow, pipeline |
| link | integration, API, connection, link |
| cloud | cloud |
| rules | checklist, rules, instruction |
| search | search |

`contextConcepts` exports the exact controlled English and Russian word forms.
Matching respects word boundaries: APIary and memoryless do not match.
Nearby negation suppresses a match, for example `cloud is not needed`.
This is a limited rule, not a full language parser. Mark uncertain sources explicitly.
Quotes and code do not automatically produce concepts; an explicit marker can opt in.

## Context actions

All 17 actions belong to **Slide context**. Existing pointing, spotlight, magnet,
climbing and staged actions also carry `tags: ['context']` without changing IDs.

| Action | Source | Behavior |
|---|---|---|
| laptopNotes | text, number, keyword | Record the selected fact on a laptop |
| thinkNumber | number | Show the exact value and unit in a thought bubble |
| hologramObject | object | Project the source image or SVG |
| hologramKeyword | keyword | Show a prepared concept visual and source wording |
| traceFocus | Any of the five basic kinds | Underline the source |
| peekCard, perchRead | card | Use a safe edge to peek or climb and read |
| thinkKeyword | keyword or short text | Hold the exact thought and look at its source |
| compareValues | values | Present both labeled values without judging them |
| followChart | chart | Follow the marked chart line |
| chartClimb | bars | Climb accessible bars in author order |
| cardRoute | route | Visit accessible cards and return |
| traceFlow | flow | Follow only explicit links |
| inspectDetail | detail | Magnify the author-selected crop |
| assembleList | list | Preserve item order and actual check states |
| showBeforeAfter | images | Present both images with separate captions |
| quoteIdea | short text | Show the exact wording on a temporary card |

Holograms, compareValues, followChart, traceFlow, assembleList and showBeforeAfter
require `superhuman`; the other context actions are base actions.
`calm` uses short thoughts and underlining. Longer stories run in live/show;
automatic chartClimb and cardRoute require show. At most one automatic context
story runs per slide visit across both action sets. Manual actions still respect
pause, reduced motion and scene conditions.

`intelligence.state().context` exposes the same snapshot; `last.context` records
the last contextual reaction's source. Analysis updates on DOM changes, media
loads and resize; `buddy.rescan()` updates synchronously. Reads use the cache,
not per-frame DOM scans.

If the source is removed or its text, concept, image, SVG content or bounds change,
the old projection is cancelled and Buddy returns safely to waiting. Camera
movement and whole-stage scaling do not change logical source coordinates.
`analyzeSlideContext(slide, stage)` provides standalone immutable analysis without
selection state or DOM references.

## Structured facts

Use `data-buddy-context="values|images|chart|bars|route|flow|list|detail"` on a container.
Structure is never inferred from arbitrary images or neighboring elements.

```js
{
  items: [{
    id: 'before', text: '42%', label: 'Before', kind: 'number', value: '42%', unit: '%',
    target: { x: 250, y: 300, width: 100, height: 70 }
  }],
  points: [{ x: 100, y: 300 }, { x: 300, y: 180 }],
  edges: [{ from: 'a', to: 'b', points: [{ x: 100, y: 300 }, { x: 300, y: 180 }] }],
  crop: { x: 930, y: 300, width: 80, height: 60 }
}
```

Only applicable fields appear. Coordinates use the logical 1280×720 stage;
`target.x/y` is the center, `crop.x/y` the top-left. Values retain exact signs and
units. Labels come separately from `data-buddy-label` or `aria-label` and never
replace values. Labels allow 80 characters, part text 180, IDs 100. `checked`
is present only when the source state is known.

The private resolver adds `parts: [{ id, element, bounds }]`, with bounds
`[x1,y1,x2,y2]`, for copying and geometry checks. DOM references never enter the
public snapshot. SVG media records viewport dimensions and copyability internally.
Positive root scaling and translation are supported; root rotation, skew or
reflection are rejected. Move those transforms to an inner SVG group.

The shared router handles both context modules through can, play, sequence,
reset, rescan and destroy.

### Value pairs

```html
<div data-buddy-context="values" data-buddy-context-id="comparison">
  <strong data-buddy-item="before" aria-label="Before">42%</strong>
  <strong data-buddy-item="after" data-buddy-label="After">27%</strong>
</div>
```

Exactly two parts, with one exact value each. An optional `data-buddy-value`
must contain only the numeric fact. Units and scale must match; both may be
unitless. Case, spaces and abbreviation periods are normalized, but units are
not converted. A change is not interpreted as success or failure.

### Image pairs

```html
<div data-buddy-context="images">
  <img data-buddy-item="before" src="before.png" alt="Before">
  <img data-buddy-item="after" src="after.png" alt="After">
</div>
```

Exactly two visible IMG or root SVG elements with unique part IDs. The projection
copies the source, including gradients and local SVG references in isolated ID namespaces.

### Charts

```html
<svg data-buddy-context="chart" viewBox="0 0 600 300">
  <polyline data-buddy-chart-line points="20,250 200,180 400,210 570,40"/>
</svg>
```

Exactly one marked polyline, line or open continuous path. SVG points are converted
to stage coordinates using `getScreenCTM()`. Paths are sampled at 64 points;
closed and disconnected paths are rejected. Direction follows point order.
The matrix is checked against the outer viewport to account for ancestor CSS scale
in WebKit, while preserving viewBox, letterboxing and inner transforms.
Root CSS rotation, skew and reflection cannot be reconstructed from a rectangle;
put them on an inner group instead.

Alternatively set `data-buddy-points='[[100,300],[300,180]]'` on the marked line.
These are already stage coordinates: 2–64 finite points inside the stage,
with a nonzero path.

### Bars and card routes

```html
<div data-buddy-context="bars">
  <div data-buddy-bar="a" data-buddy-step="1" data-buddy-value="20%">20%</div>
  <div data-buddy-bar="b" data-buddy-step="2" data-buddy-value="40%">40%</div>
</div>
<div data-buddy-context="route">
  <article data-buddy-item="first" data-buddy-step="1">First stage</article>
  <article data-buddy-item="second" data-buddy-step="2">Second stage</article>
</div>
```

Containers must match actual supports in `world.plats`; the action does not invent
platforms. Steps are unique positive integers. The analyzer preserves 2–8 parts,
but current physical stories use two or three supports; longer routes receive a
`can()` rejection. Safe edges, a clear floor route, distances and return paths are
checked independently of the markup order.

### Diagrams

```html
<div data-buddy-context="flow">
  <div data-buddy-node="a">Source</div>
  <div data-buddy-node="b">Result</div>
  <svg>
    <polyline data-buddy-from="a" data-buddy-to="b" points="100,100 300,100"/>
  </svg>
</div>
```

Provide 2–12 nodes with unique nonempty IDs and 1–16 explicit links. Every link
needs from/to IDs and a real SVG line or explicit stage-coordinate points.
No links are inferred from proximity. Missing or hidden endpoints, duplicate links,
self-loops and out-of-stage points are rejected. A traceFlow story uses at most
three links so it can turn the beam off and re-aim between edges. Larger diagrams
need a smaller selected source.

### Lists

```html
<ul data-buddy-context="list">
  <li data-buddy-item="a"><input type="checkbox" checked>Done</li>
  <li data-buddy-item="b"><input type="checkbox">In progress</li>
</ul>
```

Use 1–8 items. `checked` comes from the actual checkbox, or explicit
`data-buddy-checked="true|false"` when no checkbox exists. The word Done alone
does not create a check mark. Input/change events update the cache; after changing
a property programmatically without an event, call `rescan()`. Item order is preserved.

### Image details

```html
<div data-buddy-context="detail" data-buddy-crop='[930,300,80,60]'>
  <img data-buddy-item="image" src="detail.png" alt="Detail">
</div>
```

Exactly one visible image and an explicit positive `[x,y,width,height]` crop
entirely within both image and stage. The fact target points to the crop; the part
retains the full image bounds. No crop is inferred from pixels. Magnification is
at least 1.5×, with an inner projection size capped at 244 stage pixels.
Oversized crops receive a `can()` rejection; choose a smaller crop. Placement
accounts for overlap with the source image.

Incomplete structures are not guessed, and excessive data is never silently
truncated. Parts of a nested separate structure do not become parent parts.
Changes to parts, captions, points, edges and crop trigger event-based analysis
and validation of the running action.

# Contributing

This guide is for changes to the library itself. To integrate Buddy into a
presentation, use the [README](README.md) and [agent guide](docs/agent-integration.md).
Only the package.json `files` allowlist is included in the TGZ.

## Architecture

| Module | Responsibility |
|---|---|
| index.js | createBuddy, validation, catalog and presets |
| behavior.js, playback.js | Shared automatic policy, stories and cancellation |
| brand.js | General brand configuration and legacy service-key adapter |
| runtime.js | Skeleton, physics, supports, movement and autonomous behavior |
| vendor.js | Bundled Three.js r186, GLTFLoader, Quaternius model and rig |
| new-abilities.js, ability-props.js | Additional actions and 3D props |
| slide-intelligence.js | Classification, autoplay and reactions |
| slide-context.js, context-*.js | Source facts and 17 context actions |
| camera.js | Catalog framing |
| effects.js | Cover breakout intro |
| presets/y360.js | Optional example assets, not enabled by import |
| scripts/build.mjs | Main buddy.js and separate buddy-y360.js bundles |

See `docs/dev/` for the [rig contract](docs/dev/internal-rig-contract.md),
[prop builders](docs/dev/ability-props.md), [additional actions](docs/dev/new-abilities.md)
and renderer notes.

## Commands

```bash
npm install          # esbuild for dist only
npm run check        # Module syntax
npm test             # Fast suite
npm run test:slow    # Model geometry, contacts and clearances
npm run test:all     # Both suites
npm run build        # Classic bundles
npm pack             # prepack rebuilds automatically
npm run export -- drafts/public-export  # Python 3; web/source ZIPs
```

Unit tests need no browser or installed dependencies. DOM fixtures are in
`tests/support/`; slow tests examine actual mesh geometry across motion cycles,
with sampling up to 120 Hz. Keep identifiers stable when translating labels.
Russian input fixtures deliberately exercise multilingual slide recognition.

## Browser checks

The CDP harness in `tests/browser/` uses a local Chromium without extra packages.
Set `BUDDY_CHROME` to override browser discovery. Reports and screenshots go to
`drafts/`, outside git and packages. Run browser scenarios sequentially.

```bash
node tests/browser/browser-check.mjs
node tests/browser/context-browser-check.mjs
node tests/browser/context-stories-browser-check.mjs
node tests/browser/behavior-browser-check.mjs
node tests/browser/integration-example-check.mjs . brand.html
```

Capture motion at full-slide scale:

```bash
BUDDY_CAPTURE_IDS=climb BUDDY_CAPTURE_VIEW=overview \
  BUDDY_CAPTURE_PERFORMANCE=0 BUDDY_REPORT_DIR=drafts/climb-overview \
  node tests/browser/catalog-quality-capture.mjs
```

`BUDDY_CAPTURE_VIEW` selects overview, closeup or auto (default).
`BUDDY_PERF_VIEW` independently selects the performance measurement view.
Use a new output folder when source or settings change; resumed captures verify
hashes. A video exported at 24 simulation frames per second does not prove real-time FPS.

## Adding an action

Core actions live in runtime.js; additional actions in new-abilities.js and their
props in ability-props.js through `prop3`. The shared techniques registry drives
both the API and catalog. Add each new ID to TechniqueId in index.d.ts as well.

Define intent and preconditions before poses, timing, effects and cleanup.
Scalar pose channels are rot, tl, ts, hp, hy, mouth, smile, lid, brow; paired
channels are sf, sa, ef, ea, hf, ha, kf, ka, af. Forearm angles use absolute axes
(sf + ef). The rig also accepts handOpen, handFist and handShape metadata.

Use `buddy.experimental.kin(pose)` to inspect joints and head axes. Copy shared
pose constants before editing. Create DOM, vectors and materials at setup,
update existing values per frame, and clean up on completion and interruption.

## Releases

Export produces a clean tree without local git history, private notes or personal
decks. It refuses to overwrite existing output. ZIP metadata is deterministic and
includes manifest.sha256.json; the manifest is not committed to git.
`BUDDY_EXPORT_PRIVATE_TERMS` can add a local JSON list of prohibited strings
without writing those strings into public files.

1. Update package.json and CHANGELOG.md.
2. Run syntax and relevant tests, then the complete suite before release.
3. Build and pack; verify the TGZ with `scripts/check-package.py`.
4. Export to a new folder and check the source tree independently.
5. Install the TGZ into a clean consumer project and check ESM, classic and
   bundled use with `tests/browser/package-check/verify.mjs`.
6. Publish through the [release workflow](docs/publishing.md), then download and
   verify the actual release files.

For a package consumer check, copy the HTML/CSS/JS fixtures from
`tests/browser/package-check/` into an empty application, install the local TGZ,
and bundle app.js with esbuild. Run verify.mjs with the application directory and
one scenario: defaults, behavior, optional-brand, life, classic, bundled, scenes,
effects, keys or reduced. Screenshots are written under the consumer's shots/ folder.

Consumers do not need this workflow merely to add Buddy to a presentation.

// Build classic scripts for pages without a bundler, including file://.
// Install esbuild with npm install or set its path in ESBUILD.
import { spawnSync } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url)),
  local = new URL('../node_modules/.bin/esbuild', import.meta.url),
  esbuild = process.env.ESBUILD || (existsSync(local) ? fileURLToPath(local) : 'esbuild'),
  { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
for (const [entry, name, file] of [['browser-entry', 'Buddy', 'buddy'], ['y360-entry', 'BuddyY360', 'buddy-y360']]) {
  const result = spawnSync(esbuild, [`scripts/${entry}.js`, '--bundle', '--format=iife', `--global-name=${name}`,
    '--target=es2022', '--charset=utf8', '--minify-whitespace', '--minify-syntax', '--legal-comments=eof', '--log-level=warning',
    `--banner:js=/*! @tony-prots/buddy ${version} · MIT · three.js MIT · Quaternius model CC0 · THIRD_PARTY_NOTICES.md */`,
    `--outfile=dist/${file}.js`], { cwd: root, stdio: 'inherit' })
  if (result.error || result.status) { console.error(result.error?.message ?? 'esbuild failed'); process.exit(1) }
  console.log(`dist/${file}.js: ${(statSync(new URL(`../dist/${file}.js`, import.meta.url)).size / 1024).toFixed(0)} KB`)
}
if (readFileSync(new URL('../dist/buddy.js', import.meta.url), 'utf8').includes('data:image/svg+xml;base64'))
  throw new Error('Brand images must not be embedded in the main buddy.js bundle')

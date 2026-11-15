import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Files needed to serve an isolated catalog and its ES modules. */
export async function publicSourceFiles(root) {
  const files = ['index.html', 'package.json', 'tests/support/source-files.mjs']
  async function walk(folder) {
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
      const name = folder + '/' + entry.name
      if (entry.isDirectory()) await walk(name)
      else if (/\.(?:js|ts)$/.test(name)) files.push(name)
    }
  }
  await walk('src')
  return files.sort()
}

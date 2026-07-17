// Bundle the src/lib suite with esbuild (a Vite transitive dep — no test framework in this repo)
// and execute it under plain Node. Mirrors src/lib/siteOps/engine/__tests__/run-tests.mjs exactly.
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lib-tests-')), 'all.mjs')

await build({
  entryPoints: [path.join(here, 'all.test.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: out,
  logLevel: 'error',
})

await import(pathToFileURL(out).href)

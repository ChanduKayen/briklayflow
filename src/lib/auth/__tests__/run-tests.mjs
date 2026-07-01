// Auth refresh-policy test runner.  Usage from repo root:
//   node src/lib/auth/__tests__/run-tests.mjs
//
// Same pattern as the siteOps engine tests: no installed test framework; esbuild (a Vite dep)
// transpiles + bundles the pure TS tests to a single ESM file under the OS temp dir, which we
// then import to execute. refreshPolicy.ts is browser-free, so bundling for Node is clean.
import { build } from 'esbuild'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, 'all.test.ts')
const out = path.join(tmpdir(), `auth-refresh-tests-${process.pid}.mjs`)

await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: 'inline',
  logLevel: 'warning',
})

await import(pathToFileURL(out).href)

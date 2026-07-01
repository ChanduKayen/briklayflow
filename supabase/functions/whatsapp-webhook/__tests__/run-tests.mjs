// Payment characterization-gate runner.  Usage from repo root:
//   node supabase/functions/whatsapp-webhook/__tests__/run-tests.mjs
//
// Same pattern as the siteOps engine / auth gates: esbuild (a Vite dep) bundles the pure TS tests
// to one ESM file which we import under Node. These edge modules read `Deno.env` at module scope,
// so we shim a no-op `Deno` global BEFORE importing the bundle. Only the deterministic (pure)
// functions are exercised — no network, no LLM calls.
import { build } from 'esbuild'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Shim Deno BEFORE the bundle is imported (_extract.ts calls Deno.env.get() at module load).
globalThis.Deno = { env: { get: () => undefined } }

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, 'all.test.ts')
const out = path.join(tmpdir(), `wa-extract-tests-${process.pid}.mjs`)

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

// Bill-reading gate. Usage from the repo root:
//   node supabase/functions/reconcile-po-bill/__tests__/run-tests.mjs
//
// Same pattern as the whatsapp-webhook gate: esbuild (a Vite dep) bundles the pure TS tests to one
// ESM file, imported under Node. Nothing here talks to OpenAI — the audit is arithmetic, which is
// the whole point of keeping it out of the prompt.
import { build } from 'esbuild'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

globalThis.Deno = { env: { get: () => undefined } }

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(tmpdir(), `bill-audit-tests-${process.pid}.mjs`)

await build({
  entryPoints: [path.join(here, 'all.test.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: 'inline',
  logLevel: 'warning',
})

await import(pathToFileURL(out).href)

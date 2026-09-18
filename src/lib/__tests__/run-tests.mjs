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
  // A suite may import a module that sits beside the Supabase client (walletApi, say). Importing it
  // must not need a project: these stand in for Vite's env so the client constructs and is never
  // called — a suite that reaches the network is a suite with a bug in it.
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '"http://localhost:54321"',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '"test-anon-key"',
  },
})

await import(pathToFileURL(out).href)

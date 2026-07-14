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

// …AND THE NETWORK. The header above has said "no network" since the day it was written, and it was not true:
// every sendNowDurable POSTs to graph.facebook.com, and the gate has been firing hundreds of real requests at
// Meta and collecting 401s (only the absence of a valid token kept it from sending live WhatsApp messages to
// whoever the fixtures name). It went unnoticed because a failed direct send FALLS BACK to the outbox, which
// is where every assertion looks.
//
// So: fail the send here, offline and instantly. That is byte-for-byte the behaviour the suite has always
// relied on — the fallback — minus the round trips and minus the standing risk of a gate that talks to a
// production API. A test that wants to observe the DIRECT road (ack_order, one_road) overrides this with its
// own 200-returning stub for the length of one turn, which is the only place that road should be exercised.
globalThis.fetch = () => Promise.resolve(new Response('{"error":"offline (test gate)"}', { status: 599 }))

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

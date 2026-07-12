// C2 — the 2-MINUTE HELD-FLUSH runner. A tiny cron-driven edge function (pg_cron + pg_net, ~every 2 min)
// that delivers any HELD readback summary (Step C1) whose which_item ask got no reply within the idle
// window: send what's SURE + name the pending as saved-for-review, park the pending item, abandon the convo.
// So a supervisor whose batch auto-resolved 3 items and got asked about 1 hears "your 3 landed" in ~2 min
// even if they wander off — instead of waiting the 24h abandon sweep. NO SILENT DROP.
//
// AUTH: secret-guarded (SITEOPS_REANALYZE_SECRET, shared with siteops-reanalyze — same cron trust domain).
// Idle window: SITEOPS_HELD_IDLE_MINUTES (default 2). `?preview=1` reports the count without sending/parking.
// The same flush also rides the hourly reanalyze tick as a belt; both are idempotent (they abandon the convo).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { flushAbandonedHeldReadbacks } from '../whatsapp-webhook/_siteops_sweep.ts'
import { send } from '../whatsapp-webhook/_format.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FLUSH_SECRET     = Deno.env.get('SITEOPS_REANALYZE_SECRET')   // cron → function auth (shared trust domain)
const IDLE_MINUTES     = Number(Deno.env.get('SITEOPS_HELD_IDLE_MINUTES') ?? '2')

serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!FLUSH_SECRET || auth !== `Bearer ${FLUSH_SECRET}`) return new Response('Forbidden', { status: 403 })
  const preview = new URL(req.url).searchParams.get('preview') === '1'
  const now = new Date()
  const supabase: SB = createClient(SUPABASE_URL, SUPABASE_SVC_KEY)
  const idleMinutes = Number.isFinite(IDLE_MINUTES) && IDLE_MINUTES > 0 ? IDLE_MINUTES : 2

  // preview → a no-op send (report the count, never deliver/park/abandon).
  const sender = preview
    ? (_to: string, _b: string, _o: string) => Promise.resolve()
    : (to: string, body: string, org: string) => send(supabase, to, { kind: 'text', body }, { org_id: org })

  let result: unknown
  try {
    result = preview
      ? { note: 'preview — no send/park', idleMinutes }
      : await flushAbandonedHeldReadbacks(supabase, sender, { now, idleMinutes })
  } catch (e) {
    console.error('[siteops-held-flush] failed:', (e as Error).message)
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({ ran_at: now.toISOString(), preview, result }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})

// THE 23rd-HOUR NUDGE — one warm re-hook for a demo prospect who went quiet.
//
// A landing prospect ran the live demo (lead_status='engaged') but hasn't signed up. Their inbound
// opened a 24h WhatsApp window; we nudge ONCE at ~23h — still INSIDE the window, so it's a FREE-FORM
// message (no approved template needed). It references the exact record they filed and offers to set
// up their real site.
//
// A cron-driven edge function (pg_cron + pg_net), mirroring siteops-chase / siteops-reanalyze:
//   • secret-guarded (DEMO_NUDGE_SECRET), ?preview=1 for a dry run
//   • eligibility: engaged, not yet nudged, last seen 23–24h ago, and NOT already a member (converted)
//   • sends via the same durable outbox as every other WhatsApp message (dedup_key = one per number)
//   • stamps demo_nudged_at so it fires exactly once
//
// SANDBOX: reads wa_prospects only; never a ledger. See docs/wa-demo-concierge-spec.md.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { send } from '../whatsapp-webhook/_format.ts'
import { buildNudgeBody, nudgeCta, type DemoEntry, type Lang } from '../whatsapp-webhook/_agents/demo.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NUDGE_SECRET     = Deno.env.get('DEMO_NUDGE_SECRET')   // cron -> function auth

const HOUR = 3_600_000

// Same cheap script guess prospects get on the inbound path (index.ts guessLang).
function guessLang(text: string): Lang {
  if (/[ఀ-౿]/.test(text)) return 'te'
  if (/[ऀ-ॿ]/.test(text)) return 'hi'
  return 'en'
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!NUDGE_SECRET || auth !== `Bearer ${NUDGE_SECRET}`) return new Response('Forbidden', { status: 403 })

  const preview = new URL(req.url).searchParams.get('preview') === '1'
  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const now = Date.now()
  // Inside the window (before it closes at 24h), but old enough that they've clearly paused.
  const olderThan = new Date(now - 23 * HOUR).toISOString()
  const withinWindow = new Date(now - 24 * HOUR).toISOString()

  const { data: rows, error } = await supabase
    .from('wa_prospects')
    .select('phone_number, last_message_text, demo_entry')
    .eq('lead_status', 'engaged')
    .is('demo_nudged_at', null)
    .lte('last_seen_at', olderThan)
    .gt('last_seen_at', withinWindow)
    .limit(200)
  if (error) return json({ error: error.message }, 500)

  const candidates = (rows ?? []).filter((r) => r.demo_entry)
  if (candidates.length === 0) return json({ ran_at: new Date().toISOString(), preview, nudged: 0, note: 'none due' })

  // Drop anyone who has since signed up (a member row exists) — they converted, don't nudge.
  const phones = candidates.map((r) => r.phone_number)
  const { data: reg } = await supabase.from('wa_registered_numbers').select('phone_number').in('phone_number', phones)
  const members = new Set((reg ?? []).map((r) => r.phone_number))
  const eligible = candidates.filter((r) => !members.has(r.phone_number))

  const sent: string[] = []
  for (const r of eligible) {
    const lang = guessLang(r.last_message_text ?? '')
    const body = buildNudgeBody(r.demo_entry as DemoEntry, lang)
    if (preview) { sent.push(r.phone_number); continue }
    // dedup_key makes the enqueue idempotent even if the stamp below fails and we re-run.
    await send(supabase, r.phone_number, { kind: 'cta', body, cta: nudgeCta(lang) }, { dedup_key: `demo-nudge:${r.phone_number}` })
    await supabase.from('wa_prospects').update({ demo_nudged_at: new Date().toISOString() }).eq('phone_number', r.phone_number)
    sent.push(r.phone_number)
  }

  return json({ ran_at: new Date().toISOString(), preview, eligible: eligible.length, nudged: preview ? 0 : sent.length })
})

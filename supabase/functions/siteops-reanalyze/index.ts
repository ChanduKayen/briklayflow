// STEP 3 (2/2) — the RE-ANALYSE / HARVEST runner. A cron-driven edge function (pg_cron + pg_net) that
// finds the `pending_reanalysis` markers Step 2 left on followup_events and HARVESTS each: re-decompose
// the enrichment text and conservatively fill a MISSING cause / deadline on the object it was trailed
// onto — the "rich re-analyse" Step 2 deliberately deferred (it shipped a conservative attach-only merge).
//
// Two producers leave markers (see _siteops_reanalyze.ts): description_added (in-window RELATED) and
// possible_photo_followup (uncertain→unrelated, routed fresh — re-checked for relatedness here and, if
// related, reunited into the object; if not, the marker just clears). DISCIPLINE: harvest ENRICHES,
// never overwrites a human value and never auto-RESOLVES (resolution stays with the chase-reply path).
//
// AUTH: secret-guarded (SITEOPS_REANALYZE_SECRET), like siteops-chase / the outbox drainer. Invoke with
// `?preview=1` for a dry run — computes every plan and returns them WITHOUT writing or clearing markers.
// No AI key → no-op (returns skipped), leaving markers PENDING for a later run rather than clearing them
// unharvested. Mirrors siteops-chase's shape (serve, service-role client, json()).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decompose } from '../whatsapp-webhook/_siteops_extract.ts'
import {
  decideHarvest, distillSignal, planEnrichmentMerge,
  type PendingEvent, type HarvestObject, type HarvestType,
} from '../whatsapp-webhook/_siteops_reanalyze.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const REANALYZE_SECRET = Deno.env.get('SITEOPS_REANALYZE_SECRET')   // cron → function auth
const BATCH_LIMIT      = Number(Deno.env.get('SITEOPS_REANALYZE_LIMIT') ?? '200')

const HARVEST_TYPES: HarvestType[] = ['description_added', 'possible_photo_followup']

/** One-line trail body describing what the harvest filled. */
function harvestLine(updates: { cause?: string; deadline?: string }): string {
  const bits: string[] = []
  if (updates.cause) bits.push(`cause → ${updates.cause}`)
  if (updates.deadline) bits.push(`due ${updates.deadline}`)
  return `Re-analysed photo follow-up${bits.length ? ` — ${bits.join(', ')}` : ''}`
}

serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!REANALYZE_SECRET || auth !== `Bearer ${REANALYZE_SECRET}`) return new Response('Forbidden', { status: 403 })
  const preview = new URL(req.url).searchParams.get('preview') === '1'
  const now = new Date()

  // No AI key → we cannot re-decompose; leave the markers PENDING (do not clear) for a run that can.
  if (!Deno.env.get('OPENAI_API_KEY') && !Deno.env.get('ANTHROPIC_API_KEY')) {
    return json({ ran_at: now.toISOString(), preview, harvested: 0, note: 'no AI key — markers left pending' })
  }

  const supabase: SB = createClient(SUPABASE_URL, SUPABASE_SVC_KEY)

  const { data: events } = await supabase.from('followup_events')
    .select('id, type, problem_id, todo_id, body, org_id')
    .eq('pending_reanalysis', true)
    .in('type', HARVEST_TYPES)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)

  const clearMarker = async (id: string) => {
    if (!preview) await supabase.from('followup_events').update({ pending_reanalysis: false }).eq('id', id)
  }

  const results: { id: string; type: string; action: string; applied?: Record<string, string> | null }[] = []
  for (const e of (events ?? []) as Record<string, string | null>[]) {
    const parent = e.problem_id ? { kind: 'issue' as const, id: e.problem_id }
      : e.todo_id ? { kind: 'todo' as const, id: e.todo_id } : null
    if (!parent) { await clearMarker(e.id!); results.push({ id: e.id!, type: e.type!, action: 'orphan-noparent' }); continue }

    // Load the object's CURRENT state (the merge is conservative against it).
    const objRes = parent.kind === 'issue'
      ? await supabase.from('problems').select('id, title, cause, deadline, status').eq('id', parent.id).maybeSingle()
      : await supabase.from('todos').select('id, text, due_date, status').eq('id', parent.id).maybeSingle()
    const row = objRes.data as Record<string, string | null> | null
    if (!row) { await clearMarker(e.id!); results.push({ id: e.id!, type: e.type!, action: 'orphan-deleted' }); continue }

    const obj: HarvestObject = parent.kind === 'issue'
      ? { kind: 'issue', title: row.title ?? '', cause: row.cause ?? null, deadline: row.deadline ?? null }
      : { kind: 'todo', title: row.text ?? '', cause: null, deadline: row.due_date ?? null }
    const ev: PendingEvent = { id: e.id!, type: e.type as HarvestType, parent, body: e.body ?? '' }

    const decision = decideHarvest(ev, obj)
    let applied: Record<string, string> | null = null
    if (decision.action === 'merge') {
      let items: Awaited<ReturnType<typeof decompose>>['items'] = []
      try { items = (await decompose(ev.body)).items } catch { items = [] }
      const plan = planEnrichmentMerge(obj, distillSignal(items), now)
      if (plan.changed) {
        applied = plan.updates
        if (!preview) {
          if (parent.kind === 'issue') {
            const upd: Record<string, string> = {}
            if (plan.updates.cause) upd.cause = plan.updates.cause
            if (plan.updates.deadline) upd.deadline = plan.updates.deadline
            await supabase.from('problems').update(upd).eq('id', parent.id)
          } else if (plan.updates.deadline) {
            await supabase.from('todos').update({ due_date: plan.updates.deadline }).eq('id', parent.id)
          }
          // Trail the harvest on the SAME stream the item's feed reads (only when something changed).
          await supabase.from('followup_events').insert({
            org_id: e.org_id, problem_id: parent.kind === 'issue' ? parent.id : null,
            todo_id: parent.kind === 'todo' ? parent.id : null,
            type: 'reanalyzed', body: harvestLine(plan.updates), actor_kind: 'system', actor_id: null,
          })
        }
      }
    }
    await clearMarker(e.id!)
    results.push({ id: e.id!, type: e.type!, action: decision.action, applied })
  }

  return json({ ran_at: now.toISOString(), preview, harvested: results.length, results })
})

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
}

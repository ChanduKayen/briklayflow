// Block B — issue/todo HAND-OFF notification. Fired by the issues UI ONLY when an
// item is MANUALLY reassigned to a DIFFERENT user (a real "I'm handing this to you"),
// never on auto-assignment to the default owner. Records the hand-off on the trail
// (B1) and notifies the new owner via the shared assignment-notify core (free-text
// in-window, approved issue_assignment template out-of-window, through the outbox).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { notifyOwnerAssignment, ownerPhone } from '../whatsapp-webhook/_siteops_assign.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SVC_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { kind, id, to_user_id } = await req.json() as { kind: 'issue' | 'todo'; id: string; to_user_id: string }
    if (!kind || !id || !to_user_id) throw new Error('kind, id, to_user_id required')

    const supabase: SB = createClient(SUPABASE_URL, SVC_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    // caller identity (the assigner) from the JWT — authoritative, not client-supplied
    let byUserId: string | null = null
    const auth = req.headers.get('Authorization')
    if (auth) {
      const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } })
      byUserId = (await u.auth.getUser()).data.user?.id ?? null
    }
    if (!byUserId) return json({ ok: false, error: 'unauthenticated' }, 401)

    const tbl = kind === 'issue' ? 'problems' : 'todos'
    const titleCol = kind === 'issue' ? 'title' : 'text'
    const dueCol = kind === 'issue' ? 'deadline' : 'due_date'
    const extraCols = kind === 'issue' ? ', project_id, cause' : ', project_id'
    const { data: item } = await supabase.from(tbl).select(`org_id, ${titleCol}, ${dueCol}${extraCols}`).eq('id', id).maybeSingle()
    if (!item) return json({ ok: false, error: 'item not found' }, 404)

    // caller must belong to the item's org
    const { data: membership } = await supabase.from('user_profiles')
      .select('id').eq('id', byUserId).eq('org_id', item.org_id).maybeSingle()
    if (!membership) return json({ ok: false, error: 'forbidden' }, 403)

    const { data: names } = await supabase.from('user_profiles').select('id, name').in('id', [to_user_id, byUserId])
    const nameOf = (uid: string) => (names ?? []).find((n: { id: string }) => n.id === uid)?.name ?? 'a teammate'
    const title = (item as Record<string, string>)[titleCol]
    const due = (item as Record<string, string | null>)[dueCol] ?? null

    // trail: record the hand-off regardless of whether we can message
    await supabase.from('followup_events').insert({
      org_id: item.org_id, problem_id: kind === 'issue' ? id : null, todo_id: kind === 'todo' ? id : null,
      type: 'status_changed', body: `Handed off to ${nameOf(to_user_id)} by ${nameOf(byUserId)}`,
      actor_kind: 'user', actor_id: byUserId,
    })

    const phone = await ownerPhone(supabase, to_user_id)
    if (!phone) return json({ ok: true, notified: false, reason: 'new owner has no WhatsApp number' })

    const it = item as Record<string, string | null>
    const res = await notifyOwnerAssignment(supabase, {
      orgId: item.org_id, ownerPhone: phone, ownerName: nameOf(to_user_id),
      title, due, byName: nameOf(byUserId),
      batchItem: { kind, id, orgId: item.org_id, projectId: it.project_id ?? null, projectName: '', title, taskName: null, cause: it.cause ?? null },
    })
    return json({ ok: true, ...res })
  } catch (err) {
    console.error('[notify-assignment] error:', err)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// siteops-say — the AD-HOC MESSAGE. The founder types a message in their own voice on the desk and it
// goes out on Briklay's WhatsApp line to the item's current assignee, ref-stamped so the assignee's reply
// auto-attaches back to THIS problem (an open reply-batch, exactly like an assignment/chase). Records the
// outbound on the trail regardless of delivery.
//
// This is the endpoint the desk's Composer ("Send on WhatsApp") always described but never had — `say` in
// the live adapter used to throw DeskUnsupported. It is user-invoked, so it re-derives the caller from the
// JWT and verifies org membership, then writes with the service role (mirrors siteops-note / siteops-
// notify-assignment).
//
// A HONEST BOUNDARY: WhatsApp only permits free-text INSIDE the 24h customer-service window. Out of it, an
// arbitrary message is not deliverable (there is no free-text template), so we do NOT pretend — we return
// sent:false with a reason the UI states plainly. Nothing half-lands.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { send } from '../whatsapp-webhook/_format.ts'
import { hasOpenSession, ownerPhone } from '../whatsapp-webhook/_siteops_assign.ts'
import { addToOpenBatch } from '../whatsapp-webhook/_siteops_batch.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const MAX_LEN = 1000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { id, text } = await req.json() as { id: string; text: string }
    const body = (text ?? '').trim()
    if (!id || !body) return json({ ok: false, error: 'id and text required' }, 400)
    if (body.length > MAX_LEN) return json({ ok: false, error: `message too long (max ${MAX_LEN})` }, 400)

    const supabase: SB = createClient(SUPABASE_URL, SVC_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    // caller identity (the sender) from the JWT — authoritative, never client-supplied
    let byUserId: string | null = null
    const auth = req.headers.get('Authorization')
    if (auth) {
      const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } })
      byUserId = (await u.auth.getUser()).data.user?.id ?? null
    }
    if (!byUserId) return json({ ok: false, error: 'unauthenticated' }, 401)

    const { data: item } = await supabase.from('problems')
      .select('org_id, title, owner_id, project_id, cause').eq('id', id).maybeSingle()
    if (!item) return json({ ok: false, error: 'item not found' }, 404)

    // caller must belong to the item's org
    const { data: membership } = await supabase.from('user_profiles')
      .select('id').eq('id', byUserId).eq('org_id', item.org_id).maybeSingle()
    if (!membership) return json({ ok: false, error: 'forbidden' }, 403)

    if (!item.owner_id) return json({ ok: true, sent: false, reason: 'no one is assigned to this item' })
    const phone = await ownerPhone(supabase, item.owner_id)
    if (!phone) return json({ ok: true, sent: false, reason: 'the assignee has no WhatsApp number' })

    const { data: names } = await supabase.from('user_profiles').select('id, name').in('id', [item.owner_id])
    const ownerName = (names ?? [])[0]?.name ?? 'the assignee'

    // TRAIL FIRST — the founder said this, and the record of it must survive even if delivery can't happen
    // (out of window, a transient send failure). The desk renders this as an event on the item's story.
    await supabase.from('followup_events').insert({
      org_id: item.org_id, problem_id: id, todo_id: null, type: 'message_sent',
      body: body.slice(0, 500), actor_kind: 'user', actor_id: byUserId,
    })

    // HONEST WINDOW GATE — free-text is only deliverable inside the 24h session. Out of it, say nothing false.
    const inWindow = await hasOpenSession(supabase, phone)
    if (!inWindow) {
      return json({
        ok: true, sent: false, reason: 'out_of_window',
        message: `${ownerName} hasn't messaged in 24h — WhatsApp only allows a template outside that window, not a free-text note. It's saved on the item's trail; nothing was sent.`,
      })
    }

    await send(supabase, phone, { kind: 'text', body }, { org_id: item.org_id })

    // Open the reply-context so the assignee's reply resolves against THIS item (ref-stamped threading —
    // the same machinery an assignment/chase uses).
    await addToOpenBatch(supabase, item.org_id, phone, {
      kind: 'issue', id, orgId: item.org_id, projectId: item.project_id ?? null,
      projectName: '', title: item.title, taskName: null, cause: item.cause ?? null,
    })

    return json({ ok: true, sent: true, channel: 'text', to: ownerName })
  } catch (err) {
    console.error('[siteops-say] error:', err)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

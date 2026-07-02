// WhatsApp outbox drainer (T1.3). Invoked by pg_cron via pg_net every ~10s.
// Claims due PENDING outbox rows (atomically, via outbox_claim -> SENDING), sends
// each through the WhatsApp Cloud API, and marks SENT, or reschedules with
// exponential backoff (FAILED after max_attempts). The atomic claim guarantees
// two concurrent drainers never send the same row.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseSentWamid, buildMapRow } from '../whatsapp-webhook/_wa_message_map.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!  // DB access only
const WA_DRAINER_SECRET    = Deno.env.get('WA_DRAINER_SECRET')           // cron->drainer auth
const WA_ACCESS_TOKEN      = Deno.env.get('WA_ACCESS_TOKEN')!
const WA_PHONE_NUMBER_ID   = Deno.env.get('WA_PHONE_NUMBER_ID')!

const BATCH = 20

/** POST a pre-rendered WhatsApp Cloud API body as-is. Returns {ok, error, wamid?}. The wamid is the
 *  OUTBOUND message id WhatsApp assigns (response messages[0].id) — Step 4a captures it for the map. */
async function postToMeta(body: unknown): Promise<{ ok: boolean; error?: string; wamid?: string | null }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${WA_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    // Always log the send response so a silent send is never invisible again.
    const bodyText = await res.text().catch(() => '')
    console.log('[wa-send]', res.status, bodyText)
    if (!res.ok) {
      return { ok: false, error: `meta ${res.status}: ${bodyText.slice(0, 300)}` }
    }
    return { ok: true, wamid: parseSentWamid(bodyText) }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) }
  }
}

/** Exponential backoff (seconds), capped at 1h. attempts is post-claim (>=1). */
function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** (attempts - 1), 3600)
}

serve(async (req) => {
  // Only the cron caller (shared WA_DRAINER_SECRET bearer) may invoke this.
  // Fail closed if the secret isn't configured.
  const auth = req.headers.get('Authorization') ?? ''
  if (!WA_DRAINER_SECRET || auth !== `Bearer ${WA_DRAINER_SECRET}`) {
    return new Response('Forbidden', { status: 403 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Expire stale replies first (inbound too old) so they're never sent.
  const { data: expired, error: expErr } = await supabase.rpc('outbox_expire', { p_ttl_minutes: 15 })
  if (expErr) console.error('[drainer] outbox_expire error:', expErr)

  const { data: rows, error } = await supabase.rpc('outbox_claim', { p_limit: BATCH })
  if (error) {
    console.error('[drainer] outbox_claim error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  let sent = 0, failed = 0, retried = 0
  for (const row of (rows ?? []) as any[]) {
    // Prefer the pre-rendered body (any message type, from send()); fall back to
    // the legacy text-render path for rows that only carry { type:'text', text }
    // (watchdog / job-failure enqueues).
    let result: { ok: boolean; error?: string }
    if (row.rendered) {
      result = await postToMeta(row.rendered)
    } else if (row.payload?.text) {
      result = await postToMeta({ messaging_product: 'whatsapp', to: row.target, type: 'text', text: { body: row.payload.text } })
    } else {
      result = { ok: false, error: 'unsupported payload (no rendered body / no text)' }
    }

    if (result.ok) {
      // CRITICAL PATH — mark SENT. Unchanged from before: never gated on the wamid-capture below, so a
      // capture failure can NEVER re-send (idempotency) or stall the row.
      await supabase.from('outbox')
        .update({ status: 'SENT', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', row.id)
      sent++
      // STEP 4a — best-effort outbound-wamid capture: write the durable wamid→object map row when this
      // message carried a capture_ref (a readback / pick). Fully separate from the SENT update above;
      // any error here (unmigrated column/table) is swallowed — it must never affect send success.
      const mapRow = buildMapRow(row.org_id ?? null, row.capture_ref ?? null, result.wamid ?? null)
      if (mapRow) {
        const { error: mapErr } = await supabase.from('wa_message_map')
          .upsert(mapRow, { onConflict: 'outbound_wamid', ignoreDuplicates: true })
        if (mapErr) console.warn('[drainer] wa_message_map write skipped:', mapErr.message)
      }
    } else if (row.attempts >= row.max_attempts) {
      await supabase.from('outbox')
        .update({ status: 'FAILED', last_error: result.error, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      failed++
      console.error('[drainer] giving up on outbox row', row.id, result.error)
    } else {
      const next = new Date(Date.now() + backoffSeconds(row.attempts) * 1000).toISOString()
      await supabase.from('outbox')
        .update({ status: 'PENDING', next_attempt_at: next, last_error: result.error, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      retried++
    }
  }

  return new Response(JSON.stringify({ expired: expired ?? 0, claimed: rows?.length ?? 0, sent, retried, failed }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})

// WhatsApp outbox drainer (T1.3). Invoked by pg_cron via pg_net every ~10s.
// Claims due PENDING outbox rows (atomically, via outbox_claim -> SENDING), sends
// each through the WhatsApp Cloud API, and marks SENT, or reschedules with
// exponential backoff (FAILED after max_attempts). The atomic claim guarantees
// two concurrent drainers never send the same row.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WA_ACCESS_TOKEN      = Deno.env.get('WA_ACCESS_TOKEN')!
const WA_PHONE_NUMBER_ID   = Deno.env.get('WA_PHONE_NUMBER_ID')!

const BATCH = 20

/** Send one WhatsApp text message. Returns {ok, error}. */
async function sendText(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${WA_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      },
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `meta ${res.status}: ${body.slice(0, 300)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) }
  }
}

/** Exponential backoff (seconds), capped at 1h. attempts is post-claim (>=1). */
function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** (attempts - 1), 3600)
}

serve(async (req) => {
  // Only the cron caller (service-role bearer) may invoke this.
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${SUPABASE_SERVICE_KEY}`) {
    return new Response('Forbidden', { status: 403 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: rows, error } = await supabase.rpc('outbox_claim', { p_limit: BATCH })
  if (error) {
    console.error('[drainer] outbox_claim error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  let sent = 0, failed = 0, retried = 0
  for (const row of (rows ?? []) as any[]) {
    const text: string = row.payload?.text ?? ''
    const result = text
      ? await sendText(row.target, text)
      : { ok: false, error: 'unsupported payload (no text)' }

    if (result.ok) {
      await supabase.from('outbox')
        .update({ status: 'SENT', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', row.id)
      sent++
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

  return new Response(JSON.stringify({ claimed: rows?.length ?? 0, sent, retried, failed }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})

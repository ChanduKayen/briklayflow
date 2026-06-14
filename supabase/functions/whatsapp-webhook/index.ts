import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logMessage, sendWA } from './_wa.ts'
import { getSession, clearSession } from './_session.ts'
import { classifyMessage } from './_classify.ts'
import {
  handleFinancial,
  handleQuery,
  handleGeneral,
  handleImageMessage,
  handleSessionReply,
  processExpiredImageEntries,
} from './_handlers.ts'
import {
  createJob,
  markJob,
  enqueueJobFailure,
  acquireSenderLock,
  releaseSenderLock,
} from './_spine.ts'

const WA_VERIFY_TOKEN      = Deno.env.get('WA_VERIFY_TOKEN')!
const WA_APP_SECRET        = Deno.env.get('WA_APP_SECRET')        // Meta App → Settings → Basic → App Secret
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/**
 * Verify the X-Hub-Signature-256 header against the raw request body.
 * Header format: `sha256=<hex>`, where <hex> is HMAC-SHA256(rawBody) keyed by
 * the Meta App Secret. The HMAC must be computed over the bytes exactly as
 * received — never over a re-serialized object.
 *
 * Fails closed: a missing secret or missing/malformed signature returns false.
 */
async function verifyMetaSignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!WA_APP_SECRET) {
    console.error('[wa-webhook] WA_APP_SECRET not configured — rejecting (fail closed)')
    return false
  }
  if (!header?.startsWith('sha256=')) return false
  const theirHex = header.slice('sha256='.length).trim()

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WA_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const ourHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return constantTimeEqual(ourHex, theirHex)
}

/** Length-safe, constant-time string comparison — no early return on mismatch. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

serve(async (req) => {
  // ── GET: Meta webhook verification ──────────────────────────────────────────
  if (req.method === 'GET') {
    const url       = new URL(req.url)
    const mode      = url.searchParams.get('hub.mode')
    const token     = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
      console.log('[wa-webhook] Verified by Meta')
      return new Response(challenge, { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  // ── POST: Incoming messages ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    // Read the raw body ONCE: the signature is an HMAC over these exact bytes.
    // Re-serializing (JSON.stringify of a parsed object) would change whitespace
    // / key order and never match.
    const rawBody = await req.text()

    // Auth gate: only genuine Meta traffic proceeds. A failure here is the ONLY
    // case that returns non-2xx (correct — we want unsigned junk rejected). Fail
    // closed if verification throws.
    let valid = false
    try {
      valid = await verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'))
    } catch (e) {
      console.error('[wa-webhook] signature verification threw; rejecting (fail closed):', e)
    }
    if (!valid) {
      console.warn('[wa-webhook] rejected POST with missing/invalid signature')
      return new Response('Forbidden', { status: 403 })
    }

    // From here the request is SIGNED genuine Meta traffic. Always 200 from now on:
    // a non-2xx makes Meta retry and multiply the storm. Any processing failure is
    // handled internally (watchdog/outbox), never surfaced as a non-2xx.
    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      // Signed but unparseable — retrying can't fix it. Ack so Meta stops retrying.
      console.error('[wa-webhook] signed POST with unparseable body; acking 200 to stop retries')
      return new Response('OK', { status: 200 })
    }

    // Fire-and-ack: process in the background (Deno keeps the event loop alive
    // until it settles); errors are swallowed here and recovered by the spine.
    processMessage(body).catch((err) =>
      console.error('[wa-webhook] background processing error (recovered by watchdog/outbox):', err),
    )
    return new Response('OK', { status: 200 })
  }

  return new Response('Method Not Allowed', { status: 405 })
})

// ── Main processor ────────────────────────────────────────────────────────────

async function processMessage(body: unknown): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Parse Meta webhook payload
  const messages = (body as any)?.entry?.[0]?.changes?.[0]?.value?.messages
  if (!messages?.length) return

  const message     = messages[0]
  const from        = message.from        as string
  const messageId   = message.id          as string
  const messageType = message.type        as string

  // ── Idempotency gate (Sprint 0) ──────────────────────────────────────────────
  // Meta retries on timeout/non-200, so the same wamid can arrive twice. The
  // unique-violation on insert IS the dedup signal — no read-then-write race.
  if (messageId) {
    const { error } = await supabase
      .from('wa_inbound_dedup')
      .insert({ wamid: messageId })
    if (error) {
      if (error.code === '23505') {
        console.log('[wa-webhook] duplicate wamid, skipping:', messageId)
        return // already processed; already acked 200
      }
      // Non-duplicate DB error: log but don't drop a real message.
      console.error('[wa-webhook] dedup insert error (continuing):', error)
    }
  }

  // Log every inbound message for audit
  await logMessage(supabase, {
    phone_number: from,
    direction: 'IN',
    message_type: messageType,
    content: message.text?.body ?? null,
    media_url: null,
    wa_message_id: messageId,
  })

  // ── Registration + org resolution (T1.6) ─────────────────────────────────────
  const { data: registered } = await supabase
    .from('wa_registered_numbers')
    .select('*')
    .eq('phone_number', from)
    .eq('is_active', true)
    .maybeSingle()

  if (!registered) {
    await sendWA(from,
      "You're not registered on Briklay. Contact your manager to get access.")
    return
  }

  // Resolve the org from the sender's registered number. Never write an un-orged
  // row: a registered number with no resolvable org is quarantined with a reply.
  const orgId: string | null = (registered as any).org_id ?? null
  if (!orgId) {
    console.error('[wa-webhook] registered number has no org_id; quarantining:', from)
    await sendWA(from, "Your account isn't fully set up yet. Please contact your manager.")
    return
  }

  const senderName: string = registered.name

  // ── processing_job: the promise-to-respond (T1.2) ────────────────────────────
  // Created PROCESSING and keyed by wamid (idempotent alongside the dedup gate).
  let jobId: string | null = null
  if (messageId) {
    try {
      const r = await createJob(supabase, {
        wamid: messageId, org_id: orgId, sender_number: from, message_type: messageType,
      })
      if (r.duplicate) {
        console.log('[wa-webhook] job already exists for wamid, skipping:', messageId)
        return
      }
      jobId = r.jobId
    } catch (e) {
      // Don't drop a real message if job bookkeeping fails; process anyway.
      console.error('[wa-webhook] createJob error (continuing without job):', e)
    }
  }

  // ── Per-sender lock (T1.5) → process → terminal state (T1.7) ─────────────────
  const lockKey = messageId || from
  await acquireSenderLock(supabase, from, lockKey)
  try {
    await runLegacyProcessing(supabase, message, from, senderName, registered, messageType)
    if (jobId) await markJob(supabase, jobId, 'WRITTEN')
  } catch (e) {
    console.error('[wa-webhook] processing error:', e)
    if (jobId) {
      await markJob(supabase, jobId, 'FAILED', (e as Error)?.message ?? String(e))
      // Failure reply goes through the outbox (same dedup_key the watchdog uses,
      // so a crash-then-watchdog never double-sends).
      await enqueueJobFailure(supabase, jobId, orgId, from, messageId)
    }
  } finally {
    await releaseSenderLock(supabase, from, lockKey)
  }
}

// ── Legacy processor (unchanged logic) — wrapped, not replaced ──────────────────
// This is the existing _session/_classify/_handlers routing path. Sprint 1 wraps
// it with job state + per-sender lock; the later cutover replaces it.
async function runLegacyProcessing(
  supabase: ReturnType<typeof createClient>,
  message: any,
  from: string,
  senderName: string,
  registered: any,
  messageType: string,
): Promise<void> {
  // Cleanup: process any entries stuck in AWAITING_CONTEXT past their deadline.
  await processExpiredImageEntries(supabase, from, senderName)
    .catch((e) => console.error('[wa-webhook] processExpiredImageEntries error:', e))

  // Image always wins — clear any stale session and route to image handler.
  if (messageType === 'image') {
    const staleSession = await getSession(supabase, from)
    if (staleSession) await clearSession(supabase, from)
    await handleImageMessage(supabase, message, from, senderName, registered)
    return
  }

  // Session check (multi-turn conversation).
  const session = await getSession(supabase, from)
  if (session) {
    await handleSessionReply(supabase, session, message, from, senderName)
    return
  }

  if (messageType === 'audio') {
    await sendWA(from, '🎤 Voice notes coming soon! Please type your message for now.')
    return
  }

  // Text messages: classify then dispatch.
  const text           = (message.text?.body ?? '') as string
  const classification = await classifyMessage(text)

  if (classification === 'FINANCIAL') {
    await handleFinancial(supabase, text, from, senderName, registered)
  } else if (classification === 'QUERY') {
    await handleQuery(supabase, text, from, registered)
  } else {
    await handleGeneral(text, from, senderName)
  }
}

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logMessage } from './_wa.ts'
import {
  createJob,
  markJob,
  enqueueJobFailure,
  acquireSenderLock,
  releaseSenderLock,
} from './_spine.ts'
import { send, sendTypingIndicator } from './_format.ts'
import { normalize } from './_normalize.ts'
import { dispatch } from './_dispatch.ts'
// Sprint 3: the 4-way router + dispatcher supersede _classify.ts (no longer in the
// live path). Legacy _handlers/_session are reached only via the dispatcher's bridge.

// Supabase Edge Runtime global: keeps the worker alive until the promise settles,
// so background work isn't a bare floating promise the runtime can kill post-200.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

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

    // Durably RECORD the inbound BEFORE acking (awaited, committed): dedup gate +
    // org resolve + processing_job. An isolate kill after the 200 must never leave
    // a message acked to Meta with no DB row (silent loss).
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const inbound = await recordInbound(supabase, body)

    // Heavy processing runs AFTER the record, in the background, kept alive by
    // waitUntil (a bare floating promise can be killed right after the 200).
    if (inbound.kind === 'ready') {
      EdgeRuntime.waitUntil(
        processJob(supabase, inbound).catch((err) =>
          console.error('[wa-webhook] background processing error (recovered by watchdog/outbox):', err),
        ),
      )
    } else if (inbound.kind === 'unregistered') {
      // Durable reply via the outbox (enqueued before the 200).
      await send(supabase, inbound.from, {
        kind: 'text', body: "You're not registered on Briklay. Contact your manager to get access.",
      })
    } else if (inbound.kind === 'no_org') {
      await send(supabase, inbound.from, {
        kind: 'text', body: "Your account isn't fully set up yet. Please contact your manager.",
      })
    }
    // 'duplicate' / 'ignore' → nothing more to do.

    // Ack ONLY after the durable record is committed.
    return new Response('OK', { status: 200 })
  }

  return new Response('Method Not Allowed', { status: 405 })
})

// ── Inbound recording (DURABLE — awaited before the 200) ────────────────────────
// dedup gate + audit log + registration/org resolution + processing_job creation.
// Everything here is committed before Meta is acked, so an isolate kill can never
// drop a recorded message. Returns a descriptor telling the handler what to do next.
type Inbound =
  | { kind: 'ignore' }
  | { kind: 'duplicate' }
  | { kind: 'unregistered'; from: string }
  | { kind: 'no_org'; from: string }
  | {
      kind: 'ready'
      message: any
      from: string
      senderName: string
      registered: any
      messageType: string
      messageId: string
      jobId: string | null
      orgId: string
    }

async function recordInbound(
  supabase: ReturnType<typeof createClient>,
  body: unknown,
): Promise<Inbound> {
  const messages = (body as any)?.entry?.[0]?.changes?.[0]?.value?.messages
  if (!messages?.length) return { kind: 'ignore' }

  const message     = messages[0]
  const from        = message.from        as string
  const messageId   = message.id          as string
  const messageType = message.type        as string

  // Idempotency gate (Sprint 0): the unique-violation on insert IS the dedup signal.
  if (messageId) {
    const { error } = await supabase.from('wa_inbound_dedup').insert({ wamid: messageId })
    if (error) {
      if (error.code === '23505') {
        console.log('[wa-webhook] duplicate wamid, skipping:', messageId)
        return { kind: 'duplicate' }
      }
      console.error('[wa-webhook] dedup insert error (continuing):', error)
    }
  }

  // Audit log.
  await logMessage(supabase, {
    phone_number: from,
    direction: 'IN',
    message_type: messageType,
    content: message.text?.body ?? null,
    media_url: null,
    wa_message_id: messageId,
  })

  // Registration + org resolution (T1.6).
  const { data: registered } = await supabase
    .from('wa_registered_numbers')
    .select('*')
    .eq('phone_number', from)
    .eq('is_active', true)
    .maybeSingle()
  if (!registered) return { kind: 'unregistered', from }

  // Never write an un-orged row: a registered number with no resolvable org is quarantined.
  const orgId: string | null = (registered as any).org_id ?? null
  if (!orgId) {
    console.error('[wa-webhook] registered number has no org_id; quarantining:', from)
    return { kind: 'no_org', from }
  }

  // processing_job (T1.2): created PROCESSING, wamid-unique (idempotent alongside dedup).
  let jobId: string | null = null
  if (messageId) {
    try {
      const r = await createJob(supabase, {
        wamid: messageId, org_id: orgId, sender_number: from, message_type: messageType,
      })
      if (r.duplicate) {
        console.log('[wa-webhook] job already exists for wamid, skipping:', messageId)
        return { kind: 'duplicate' }
      }
      jobId = r.jobId
    } catch (e) {
      // Don't drop a real message if job bookkeeping fails; process anyway.
      console.error('[wa-webhook] createJob error (continuing without job):', e)
    }
  }

  return {
    kind: 'ready',
    message, from, senderName: registered.name as string, registered,
    messageType, messageId, jobId, orgId,
  }
}

// ── Background processing (kept alive by EdgeRuntime.waitUntil) ──────────────────
// Per-sender lock → legacy routing → terminal job state. Runs AFTER the durable
// record + the 200, so a crash here is recovered by the watchdog/outbox, never lost.
async function processJob(
  supabase: ReturnType<typeof createClient>,
  inbound: Extract<Inbound, { kind: 'ready' }>,
): Promise<void> {
  const { message, from, senderName, registered, messageId, jobId, orgId } = inbound

  // Typing indicator: inline, best-effort, fire-and-forget. Never affects the job.
  if (messageId) sendTypingIndicator(messageId).catch(() => {})

  // Normalize every inbound type to the common envelope (image->vision now,
  // voice->transcribe behind WA_VOICE_ENABLED). Failure -> treat as unsupported.
  let norm
  try {
    norm = await normalize(supabase, message, { orgId, from, wamid: messageId })
  } catch (e) {
    console.error('[wa-webhook] normalize error:', e)
    norm = {
      org_id: orgId, sender: from, wamid: messageId, text: '',
      source_type: 'unsupported' as const, attachments: [], timestamp: new Date().toISOString(),
    }
  }

  // Graceful terminal replies that don't enter the legacy dispatch (still terminal + reply).
  if (norm.source_type === 'unsupported') {
    await send(supabase, from, { kind: 'text', body: 'Sorry, I can only handle text, images, and (soon) voice notes right now.' }, { org_id: orgId, wamid: messageId })
    if (jobId) await markJob(supabase, jobId, 'WRITTEN')
    return
  }
  if (norm.source_type === 'voice' && !norm.text.trim()) {
    await send(supabase, from, { kind: 'text', body: 'Voice notes coming soon! For now, please type your message.' }, { org_id: orgId, wamid: messageId })
    if (jobId) await markJob(supabase, jobId, 'WRITTEN')
    return
  }

  // Feed the normalized text into the legacy path, serialized per sender.
  const lockKey = messageId || from
  await acquireSenderLock(supabase, from, lockKey)
  try {
    await dispatch({ supabase, from, senderName, registered, wamid: messageId, orgId }, norm.text)
    if (jobId) await markJob(supabase, jobId, 'WRITTEN')
  } catch (e) {
    console.error('[wa-webhook] processing error:', e)
    if (jobId) {
      await markJob(supabase, jobId, 'FAILED', (e as Error)?.message ?? String(e))
      // Failure reply via the outbox (same dedup_key the watchdog uses, so a
      // crash-then-watchdog never double-sends).
      await enqueueJobFailure(supabase, jobId, orgId, from, messageId)
    }
  } finally {
    await releaseSenderLock(supabase, from, lockKey)
  }
}

// (Routing + dispatch now live in _dispatch.ts: the 4-way router decides, the
//  dispatcher owns wa_conversations state and bridges to the legacy transaction
//  handlers / concierge.)

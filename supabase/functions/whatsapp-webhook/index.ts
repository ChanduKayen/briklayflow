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

    const valid = await verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'))
    if (!valid) {
      console.warn('[wa-webhook] rejected POST with missing/invalid signature')
      return new Response('Forbidden', { status: 403 })
    }

    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    // Respond 200 to Meta immediately (< 5 s requirement).
    // Deno keeps the event loop alive until the background promise settles.
    processMessage(body).catch((err) =>
      console.error('[wa-webhook] unhandled error:', err),
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

  // ── Idempotency gate ─────────────────────────────────────────────────────────
  // Meta retries on timeout/non-200, so the same wamid can arrive twice. Gate as
  // early as wamid is readable, before logging/dispatch. The unique-violation on
  // insert IS the dedup signal — no read-then-write race.
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

  // ── Registration check ───────────────────────────────────────────────────────
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

  const senderName: string = registered.name

  // ── Cleanup: process any entries stuck in AWAITING_CONTEXT past their deadline ─
  await processExpiredImageEntries(supabase, from, senderName)
    .catch((e) => console.error('[wa-webhook] processExpiredImageEntries error:', e))

  // ── Image always wins — clear any stale session and route to image handler ────
  if (messageType === 'image') {
    const staleSession = await getSession(supabase, from)
    if (staleSession) await clearSession(supabase, from)
    await handleImageMessage(supabase, message, from, senderName, registered)
    return
  }

  // ── Session check (multi-turn conversation) ──────────────────────────────────
  const session = await getSession(supabase, from)
  if (session) {
    await handleSessionReply(supabase, session, message, from, senderName)
    return
  }

  // ── Fresh message: type-specific routing ─────────────────────────────────────

  if (messageType === 'audio') {
    await sendWA(from, '🎤 Voice notes coming soon! Please type your message for now.')
    return
  }

  // Text messages: classify then dispatch
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

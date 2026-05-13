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
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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
    const body = await req.json()

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

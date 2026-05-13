// All message handlers. Each handler is its own exported function so future
// phases (project management, queries, etc.) can extend without touching index.ts.

import { sendWA, downloadWAMedia } from './_wa.ts'
import { saveSession, clearSession, type WaSession } from './_session.ts'
import { extractEntities } from './_extract.ts'

// ── Shared helpers ────────────────────────────────────────────────────────────

export function parseAmount(text: string): number | null {
  const s = text.trim().toLowerCase()
    .replace(/₹|rs\.?\s*|rupees?\s*/gi, '')
    .replace(/,/g, '')
    .trim()
  if (/^\d+(\.\d+)?k$/i.test(s)) return parseFloat(s) * 1000
  if (/^\d+(\.\d+)?\s*l(akh)?$/i.test(s)) return parseFloat(s) * 100_000
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export function fmtAmount(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

const CANCEL_WORDS = new Set([
  'cancel', 'stop', 'no thanks', 'nahi', 'cheyyaddu', 'abbayya',
])

function isCancelText(lower: string): boolean {
  return CANCEL_WORDS.has(lower) || lower === 'stop' || lower === 'cancel'
}

/** Insert a new rough_entry row and return its id. */
async function createRoughEntry(
  supabase: any,
  rawText: string,
  from: string,
  senderName: string,
  extracted: Record<string, unknown>,
  source: string,
  imageUrl?: string,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('rough_entries')
    .insert({
      source,
      raw_text: rawText || null,
      raw_image_url: imageUrl ?? null,
      sender_name: senderName,
      sender_number: from,
      ai_extracted: extracted,
      status: 'PENDING',
      // created_by intentionally null — WhatsApp entries have no auth user
    })
    .select('id')
    .single()

  if (error) {
    console.error('[handlers] createRoughEntry error:', error)
    throw error
  }
  return data as { id: string }
}

/** Fire ai-extract-entry in background (non-blocking). */
function triggerExtraction(supabase: any, entryId: string): void {
  // Uses entry_id (not `record`) — matching the actual ai-extract-entry signature
  supabase.functions
    .invoke('ai-extract-entry', { body: { entry_id: entryId } })
    .catch((e: any) => console.error('[handlers] ai-extract-entry error:', e))
}

// ── Financial handler ─────────────────────────────────────────────────────────
// Handles payment messages. Asks at most ONE clarifying question (amount first,
// then payee). Confirmation is only asked when amount > ₹50,000 AND payee
// confidence is LOW — all other cases are added to inbox immediately.

function buildConfirmMsg(payee: string, amount: number, desc: string): string {
  return (
    `✅ Added to Rough Entries\n` +
    `*${payee}* — ${fmtAmount(amount)} · ${desc}\n\n` +
    `Review here: briklayflow.vercel.app/inbox`
  )
}

export async function handleFinancial(
  supabase: any,
  text: string,
  from: string,
  senderName: string,
  _registered: any,
): Promise<void> {
  const extracted = await extractEntities(text)
  const { payee_raw, amount } = extracted

  if (!amount) {
    const entry = await createRoughEntry(
      supabase, text, from, senderName, extracted, 'WHATSAPP_TEXT',
    )
    await sendWA(from, 'How much? (just the number, e.g. *5000* or *5k*)')
    await saveSession(supabase, from, 'AWAIT_AMOUNT', {
      extracted, rough_entry_id: entry.id, original_text: text,
    })
    return
  }

  if (!payee_raw) {
    const entry = await createRoughEntry(
      supabase, text, from, senderName, extracted, 'WHATSAPP_TEXT',
    )
    await sendWA(from, 'Who was paid?')
    await saveSession(supabase, from, 'AWAIT_PAYEE', {
      extracted, rough_entry_id: entry.id, original_text: text,
    })
    return
  }

  const entry = await createRoughEntry(
    supabase, text, from, senderName, extracted, 'WHATSAPP_TEXT',
  )
  triggerExtraction(supabase, entry.id)

  // Only ask YES/NO when amount is large AND payee is uncertain
  if (amount > 50_000 && extracted.payee_confidence === 'LOW') {
    const desc = extracted.description_raw || extracted.category_name || 'Payment'
    await sendWA(from,
      `⚠️ *${payee_raw}* — ${fmtAmount(amount)}\n` +
      `${desc}\n\n` +
      `Amount above ₹50,000 and payee is uncertain.\n` +
      `Post to inbox? Reply *YES* or *NO*`)
    await saveSession(supabase, from, 'AWAIT_CONFIRM', {
      extracted, rough_entry_id: entry.id,
    })
    return
  }

  const desc = extracted.description_raw || extracted.category_name || 'Payment'
  await sendWA(from, buildConfirmMsg(payee_raw, amount, desc))
}

// ── Session reply handler ─────────────────────────────────────────────────────
// Continues a multi-turn conversation based on the active session state.

export async function handleSessionReply(
  supabase: any,
  session: WaSession,
  message: any,
  from: string,
  _senderName: string,
): Promise<void> {
  const text  = (message.text?.body ?? '').trim()
  const lower = text.toLowerCase()
  const ctx   = session.context

  if (isCancelText(lower)) {
    await clearSession(supabase, from)
    await sendWA(from, 'Cancelled. What else can I help with?')
    return
  }

  switch (session.state) {
    // ── User is providing the missing amount ──────────────────────────────────
    case 'AWAIT_AMOUNT': {
      const amount = parseAmount(text)
      if (!amount || amount <= 0) {
        await sendWA(from, 'Please send just the number. Example: *5000* or *5k*')
        return
      }

      const updated = { ...ctx.extracted, amount }
      await supabase
        .from('rough_entries')
        .update({ ai_extracted: updated })
        .eq('id', ctx.rough_entry_id)

      if (!updated.payee_raw) {
        await sendWA(from, 'Who was paid?')
        await saveSession(supabase, from, 'AWAIT_PAYEE', { ...ctx, extracted: updated })
        return
      }

      triggerExtraction(supabase, ctx.rough_entry_id)
      await clearSession(supabase, from)
      const desc1 = updated.description_raw || updated.category_name || 'Payment'
      await sendWA(from, buildConfirmMsg(updated.payee_raw, amount, desc1))
      break
    }

    // ── User is providing the missing payee name ──────────────────────────────
    case 'AWAIT_PAYEE': {
      const updated = { ...ctx.extracted, payee_raw: text, payee_unmatched: true }
      await supabase
        .from('rough_entries')
        .update({ ai_extracted: updated })
        .eq('id', ctx.rough_entry_id)

      triggerExtraction(supabase, ctx.rough_entry_id)
      await clearSession(supabase, from)

      if (!updated.amount) {
        await sendWA(from,
          `📥 Added to inbox — couldn't extract all details.\n` +
          `Review here: briklayflow.vercel.app/inbox`)
        break
      }

      const desc2 = updated.description_raw || updated.category_name || 'Payment'
      await sendWA(from, buildConfirmMsg(text, updated.amount, desc2))
      break
    }

    // ── High-value + uncertain-payee confirmation ─────────────────────────────
    // Only reached when amount > ₹50,000 AND payee_confidence === 'LOW'
    case 'AWAIT_CONFIRM': {
      const YES = ['yes', 'y', 'ok', 'okay', 'sari', 'ha', 'haan', 'post', 'confirm', 'send', 'done']
      const NO  = ['no', 'n', 'nope', 'wrong', 'change', 'edit', 'cancel']

      const isYes = YES.some((w) => lower === w || lower.startsWith(w + ' '))
      const isNo  = NO.some((w) => lower === w || lower.startsWith(w + ' '))

      if (isYes) {
        const e = ctx.extracted as any
        const desc = e.description_raw || e.category_name || 'Payment'
        await sendWA(from, buildConfirmMsg(e.payee_raw ?? '?', e.amount ?? 0, desc))
        await clearSession(supabase, from)
      } else if (isNo) {
        await supabase
          .from('rough_entries')
          .delete()
          .eq('id', ctx.rough_entry_id)
        await sendWA(from, 'Cancelled. What else?')
        await clearSession(supabase, from)
      } else {
        await sendWA(from, 'Reply *YES* to post or *NO* to cancel')
      }
      break
    }

    default:
      await clearSession(supabase, from)
      await sendWA(from, 'Session expired. Please send your message again.')
  }
}

// ── Query handler ─────────────────────────────────────────────────────────────
// Phase 1: whitelisted simple queries only.
// Phase 3 will add NL→SQL for arbitrary balance/project queries.

export async function handleQuery(
  supabase: any,
  text: string,
  from: string,
  _registered: any,
): Promise<void> {
  const lower = text.toLowerCase()

  if (lower.includes('pending')) {
    const { data } = await supabase
      .from('rough_entries')
      .select('re_number, ai_extracted')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(5)

    const rows = (data as any[]) ?? []
    if (!rows.length) {
      await sendWA(from, '✅ No pending entries in inbox!')
      return
    }

    const list = rows
      .map((e, i) => {
        const ai    = e.ai_extracted ?? {}
        const payee = ai.payee_name || ai.payee_raw || '?'
        const amt   = ai.amount ? fmtAmount(ai.amount) : '?'
        return `${i + 1}. ${e.re_number} — ${payee} ${amt}`
      })
      .join('\n')

    await sendWA(from,
      `📥 *${rows.length} pending entries:*\n\n${list}\n\nOpen app: *briklayflow.vercel.app/inbox*`)
    return
  }

  // Fallback — Phase 3 will handle complex queries
  await sendWA(from,
    'For detailed reports open the app:\n*briklayflow.vercel.app*\n\n' +
    'Full query support coming soon! 🚀')
}

// ── General handler ───────────────────────────────────────────────────────────
// Greetings, help, and unclassified messages.

export async function handleGeneral(
  text: string,
  from: string,
  senderName: string,
): Promise<void> {
  const lower     = text.toLowerCase().trim()
  const firstName = senderName.split(' ')[0]

  const GREETINGS = ['hi', 'hello', 'hey', 'hii', 'namaste', 'namaskar', 'vanakkam', 'kem cho']
  if (GREETINGS.some((g) => lower === g || lower.startsWith(g + ' '))) {
    await sendWA(from,
      `Hi ${firstName}! 👋\n\n` +
      `Send me a payment entry like:\n` +
      `_"paid ramu 5000 cash plastering"_\n\n` +
      `Or type *PENDING* to see inbox.`)
    return
  }

  if (lower === 'help' || lower === '?' || lower.includes('what can you do')) {
    await sendWA(from,
      `*Briklay WhatsApp*\n\n` +
      `What you can do:\n` +
      `• Add payments: _"ramu 5k cash plastering"_\n` +
      `• Check inbox: type *PENDING*\n\n` +
      `Open app: briklayflow.vercel.app`)
    return
  }

  await sendWA(from,
    `Got your message! To add a payment, send:\n` +
    `_"name amount description"_\n\n` +
    `Example: _"ramu 5000 cash plastering"_`)
}

// ── Image handler ─────────────────────────────────────────────────────────────
// Downloads WA media → uploads to Supabase Storage → creates rough_entry →
// triggers ai-extract-entry (which supports vision via Claude).

export async function handleImageMessage(
  supabase: any,
  message: any,
  from: string,
  senderName: string,
  _registered: any,
): Promise<void> {
  const mediaId = message.image?.id as string | undefined
  const caption = (message.image?.caption ?? '') as string

  if (!mediaId) {
    await sendWA(from, '📸 Image received! Add a caption for better AI extraction.')
    return
  }

  try {
    const imgBuffer = await downloadWAMedia(mediaId)
    const fileName  = `wa/${from}/${Date.now()}.jpg`

    const { error: uploadErr } = await supabase.storage
      .from('rough-entry-media')
      .upload(fileName, imgBuffer, { contentType: 'image/jpeg' })
    if (uploadErr) throw uploadErr

    const { data: { publicUrl } } = supabase.storage
      .from('rough-entry-media')
      .getPublicUrl(fileName)

    const entry = await createRoughEntry(
      supabase,
      caption || 'Image from WhatsApp',
      from,
      senderName,
      { processed: false },
      'WHATSAPP_IMAGE',
      publicUrl,
    )

    await sendWA(from,
      `📸 Image received!\n` +
      (caption ? `Caption: _"${caption}"_\n` : '') +
      `Added to inbox. Open app to review:\n*briklayflow.vercel.app/inbox*`)

    // Claude vision will extract details from the image
    triggerExtraction(supabase, entry.id)
  } catch (err) {
    console.error('[handlers] image processing error:', err)
    await sendWA(from,
      "⚠️ Couldn't save your image. Please try again or type the details manually.")
  }
}

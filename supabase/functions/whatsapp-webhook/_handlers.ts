// All message handlers. Each handler is its own exported function so future
// phases (project management, queries, etc.) can extend without touching index.ts.

import { sendWA, downloadAndStoreImage } from './_wa.ts'
import { saveSession, clearSession, type WaSession } from './_session.ts'
import { extractEntities, extractPaymentFromImage, extractPaymentListFromImage } from './_extract.ts'
import { classifyImage, classifyIntent } from './_classify.ts'
import { logRoute } from './_router.ts'

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

const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣']

const CANCEL_WORDS = new Set([
  'cancel', 'stop', 'no thanks', 'nahi', 'cheyyaddu', 'abbayya',
])

function isCancelText(lower: string): boolean {
  return CANCEL_WORDS.has(lower) || lower === 'stop' || lower === 'cancel'
}

// ── Payee fuzzy matching ──────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = []
  for (let i = 0; i <= m; i++) { dp[i] = [i]; for (let j = 1; j <= n; j++) dp[i][j] = 0 }
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

function findTopMatches(raw: string, stakeholders: any[], limit: number): any[] {
  const q = raw.toLowerCase().trim()
  return stakeholders
    .map((s: any) => {
      const sn = s.name.toLowerCase()
      let score = Infinity
      if (sn === q) score = 0
      else if (sn.includes(q) && q.length >= 2) score = 1
      else if (q.includes(sn) && sn.length >= 2) score = 1
      else if (sn.split(/\s+/)[0] === q.split(/\s+/)[0] && q.length > 1) score = 2
      else { const d = levenshtein(q, sn); if (d <= 3) score = d + 3 }
      return { ...s, _score: score }
    })
    .filter((s: any) => s._score < Infinity)
    .sort((a: any, b: any) => a._score - b._score)
    .slice(0, limit)
}

// ── Message builders ──────────────────────────────────────────────────────────

/** Short "what was parked" line shown when a topic switch happens mid-session. */
function buildParkMessage(session: WaSession): string {
  const ctx = session.context
  const amount: number | null = ctx.extracted?.amount ?? ctx.amount ?? null
  const payee: string | null  = ctx.extracted?.payee_raw ?? ctx.payee_name ?? null

  if (amount && payee) return `_(Set aside: ${fmtAmount(amount)} to ${payee})_\n`
  if (amount)          return `_(Set aside: ${fmtAmount(amount)} payment)_\n`
  if (session.state === 'AWAIT_IMAGE_CONTEXT') return `_(Image entry set aside.)_\n`
  return `_(Previous entry set aside.)_\n`
}

function buildConfirmMsg(payee: string, amount: number, mode: string | null, desc: string): string {
  return (
    `✅ Added to logbook\n` +
    `*${payee}* — ${fmtAmount(amount)} · ${mode || 'Cash'}\n` +
    `${desc}\n\n` +
    `Review: briklayflow.vercel.app/logbook`
  )
}

function buildDescription(e: any): string {
  if (e.work_type && e.floor_or_area) return `${e.work_type} - ${e.floor_or_area}`
  if (e.work_type) return e.work_type
  if (e.material_name && e.material_quantity)
    return `${e.material_name} - ${e.material_quantity}${e.material_unit ? ' ' + e.material_unit : ''}`
  if (e.material_name) return e.material_name
  return e.description_raw || e.category_name || 'Payment'
}

// ── DB helpers ────────────────────────────────────────────────────────────────

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
  if (error) { console.error('[handlers] createRoughEntry error:', error); throw error }
  return data as { id: string }
}

/** Fetch current ai_extracted, merge updates, and write back. Handles the
 *  race where ai-extract-entry finishes before the user replies. */
async function mergeAndUpdateExtracted(
  supabase: any,
  entryId: string,
  updates: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabase
    .from('rough_entries')
    .select('ai_extracted')
    .eq('id', entryId)
    .single()
  const merged = { ...(data?.ai_extracted ?? fallback), ...updates }
  await supabase.from('rough_entries').update({ ai_extracted: merged }).eq('id', entryId)
}

async function matchPayee(
  supabase: any,
  rawName: string,
): Promise<{ id: string; name: string } | null> {
  if (!rawName?.trim()) return null

  const lower = rawName.toLowerCase().trim()

  const { data: stakeholders } = await supabase
    .from('stakeholders')
    .select('stakeholder_id, name')
    .limit(50)

  if (!stakeholders?.length) return null

  // Priority 1: exact or strong contains match
  for (const s of stakeholders) {
    const full  = s.name.toLowerCase()
    const first = full.split(' ')[0]
    if (full === lower) return { id: s.stakeholder_id, name: s.name }
    if (full.includes(lower) || lower.includes(first)) return { id: s.stakeholder_id, name: s.name }
  }

  // Priority 2: Levenshtein ≤ 2 on first name
  for (const s of stakeholders) {
    const first = s.name.toLowerCase().split(' ')[0]
    if (levenshtein(lower, first) <= 2) return { id: s.stakeholder_id, name: s.name }
  }

  return null
}

function triggerExtraction(supabase: any, entryId: string): void {
  supabase.functions
    .invoke('ai-extract-entry', { body: { entry_id: entryId } })
    .catch((e: any) => console.error('[handlers] ai-extract-entry error:', e))
}

// ── Financial handler ─────────────────────────────────────────────────────────
// Decision order (MAX one clarifying question per entry):
//   1. amount missing      → AWAIT_AMOUNT
//   2. payee missing       → AWAIT_PAYEE
//   3. payee LOW + matches → AWAIT_PAYEE_CHOICE (numbered options)
//   4. multiple projects   → AWAIT_PROJECT     (numbered options)
//   5. everything clear    → POST immediately

export async function handleFinancial(
  supabase: any,
  text: string,
  from: string,
  senderName: string,
  _registered: any,
): Promise<void> {
  const extracted = await extractEntities(text)
  const { payee_raw, amount } = extracted

  // 1. Missing amount
  if (!amount) {
    const entry = await createRoughEntry(supabase, text, from, senderName, extracted, 'WHATSAPP_TEXT')
    const hint = extracted.work_type || extracted.description_raw || ''
    await sendWA(from,
      `Got it${hint ? ` — *${hint}*` : ''}\n\n` +
      `How much? (e.g. *5000* or *5k*)`)
    await saveSession(supabase, from, 'AWAIT_AMOUNT', {
      extracted, rough_entry_id: entry.id, original_text: text,
    })
    return
  }

  // 2. Payee entirely absent
  if (!payee_raw) {
    const entry = await createRoughEntry(supabase, text, from, senderName, extracted, 'WHATSAPP_TEXT')
    await sendWA(from,
      `Got *${fmtAmount(amount)}* · ${extracted.mode || 'Cash'}\n\n` +
      `Who was paid?`)
    await saveSession(supabase, from, 'AWAIT_PAYEE', {
      extracted, rough_entry_id: entry.id, original_text: text,
    })
    return
  }

  // 3. Payee present but LOW confidence — fetch closest matches and offer choices
  if (extracted.payee_confidence === 'LOW') {
    const { data: stks } = await supabase
      .from('stakeholders')
      .select('stakeholder_id, name, type, category')
      .order('name')
    const matches = findTopMatches(payee_raw, stks ?? [], 3)

    if (matches.length > 0) {
      const entry = await createRoughEntry(supabase, text, from, senderName, extracted, 'WHATSAPP_TEXT')
      triggerExtraction(supabase, entry.id)
      const desc = extracted.description_raw || extracted.work_type || 'Payment'
      const lines = matches.map((m: any, i: number) => `${NUM_EMOJI[i]} ${m.name} · ${m.category}`)
      lines.push(`${NUM_EMOJI[matches.length]} Someone else (add to logbook)`)
      await sendWA(from,
        `*${fmtAmount(amount)}* · ${extracted.mode || 'Cash'} · ${desc}\n\n` +
        `Who was paid?\n` +
        lines.join('\n') + '\n\n' +
        `Reply 1, 2 or ${matches.length + 1}`)
      await saveSession(supabase, from, 'AWAIT_PAYEE_CHOICE', {
        extracted,
        rough_entry_id: entry.id,
        payee_matches: matches.map((m: any) => ({ id: m.stakeholder_id, name: m.name, category: m.category })),
      })
      return
    }
    // No close matches — fall through and post with unmatched state
  }

  // 4. Multiple active projects, no project hint — ask which one
  //    (only reached when payee is confident or unresolvable — one-question rule)
  const { data: projects } = await supabase
    .from('projects')
    .select('project_id, name')
    .eq('status', 'Active')
  const activeProjects = (projects ?? []) as any[]

  if (activeProjects.length > 1 && !extracted.project_raw) {
    const entry = await createRoughEntry(supabase, text, from, senderName, extracted, 'WHATSAPP_TEXT')
    triggerExtraction(supabase, entry.id)
    const topProjects = activeProjects.slice(0, 5)
    const lines = topProjects.map((p: any, i: number) => `${NUM_EMOJI[i]} ${p.name}`)
    await sendWA(from,
      `*${payee_raw}* — ${fmtAmount(amount)}\n\n` +
      `Which project?\n` +
      lines.join('\n') + '\n\n' +
      `Reply 1–${topProjects.length}`)
    await saveSession(supabase, from, 'AWAIT_PROJECT', {
      extracted,
      rough_entry_id: entry.id,
      payee_name: payee_raw,
      amount,
      project_options: topProjects.map((p: any) => ({ id: p.project_id, name: p.name })),
    })
    return
  }

  // 5. All fields clear — post immediately
  const entry = await createRoughEntry(supabase, text, from, senderName, extracted, 'WHATSAPP_TEXT')
  triggerExtraction(supabase, entry.id)
  const desc = extracted.description_raw || extracted.work_type || extracted.category_name || 'Payment'
  await sendWA(from, buildConfirmMsg(payee_raw, amount, extracted.mode as string | null, desc as string))
}

// ── Session reply handler ─────────────────────────────────────────────────────

export async function handleSessionReply(
  supabase: any,
  session: WaSession,
  message: any,
  from: string,
  senderName: string,
): Promise<void> {
  const text  = (message.text?.body ?? '').trim()
  const lower = text.toLowerCase()
  const ctx   = session.context

  if (isCancelText(lower)) {
    logRoute(supabase, {
      wa_message_id: message.id ?? null,
      phone_number: from,
      had_session: true,
      session_state: session.state,
      session_score: 0,
      new_intent_score: 95,
      classified_intent: 'CANCEL',
      selected_handler: 'cancel',
      outcome: 'session_cleared',
    })
    await clearSession(supabase, from)
    await sendWA(from, 'Cancelled. What else can I help with?')
    return
  }

  // ── Intent arbitration — mandatory gate before state dispatch ─────────────

  const { data: projects }     = await supabase.from('projects').select('name').eq('status', 'Active')
  const { data: stakeholders } = await supabase.from('stakeholders').select('name').limit(30)

  const intent = await classifyIntent(
    text,
    session.state,
    session.context,
    projects?.map((p: any) => p.name) || [],
    stakeholders?.map((s: any) => s.name) || [],
  )
  console.log('[handlers] Session arbitration:', { text, state: session.state, action: intent.action, confidence: intent.confidence, scores: intent.scores })

  // AWAIT_IMAGE_CONTEXT: text is always annotation — never redirect.
  const isTopic = session.state !== 'AWAIT_IMAGE_CONTEXT' &&
    intent.action !== 'CONTINUE_SESSION' &&
    intent.confidence === 'HIGH'

  logRoute(supabase, {
    wa_message_id: message.id ?? null,
    phone_number: from,
    had_session: true,
    session_state: session.state,
    session_score: intent.scores.sessionScore,
    new_intent_score: intent.scores.newIntentScore,
    classified_intent: intent.action,
    selected_handler: isTopic ? `reroute:${intent.action}` : `session:${session.state}`,
    outcome: isTopic ? 'topic_switch' : 'continue_session',
  })

  if (isTopic) {
    // Build a short "what was parked" note so the user knows we remembered.
    const parked = buildParkMessage(session)
    await sendWA(from, `${parked}Got it — handling that now. 👍`)
    await clearSession(supabase, from)

    if (intent.action === 'NEW_FINANCIAL') {
      await handleFinancial(supabase, text, from, senderName, null)
    } else if (intent.action === 'NEW_SITE_UPDATE') {
      await handleSiteTextUpdate(supabase, text, from, senderName)
    } else if (intent.action === 'NEW_QUERY') {
      await handleQuery(supabase, text, from, null)
    } else if (intent.action === 'CANCEL') {
      await sendWA(from, `Cancelled.`)
    } else {
      await handleGeneral(text, from, senderName)
    }
    return
  }

  switch (session.state) {
    // ── Amount was missing; user is providing it ──────────────────────────────
    case 'AWAIT_AMOUNT': {
      const amount = parseAmount(text)
      if (!amount || amount <= 0) {
        await sendWA(from, 'Just the number please. Example: *5000* or *5k*')
        return
      }
      const updated = { ...ctx.extracted, amount }
      await supabase.from('rough_entries').update({ ai_extracted: updated }).eq('id', ctx.rough_entry_id)

      if (!updated.payee_raw) {
        await sendWA(from, `Got *${fmtAmount(amount)}*\n\nWho was paid?`)
        await saveSession(supabase, from, 'AWAIT_PAYEE', { ...ctx, extracted: updated })
        return
      }
      triggerExtraction(supabase, ctx.rough_entry_id)
      await clearSession(supabase, from)
      const desc1 = (updated.description_raw || updated.work_type || updated.category_name || 'Payment') as string
      await sendWA(from, buildConfirmMsg(updated.payee_raw as string, amount, updated.mode as string | null, desc1))
      break
    }

    // ── Payee was missing; user typed a name ──────────────────────────────────
    case 'AWAIT_PAYEE': {
      const updated = { ...ctx.extracted, payee_raw: text, payee_unmatched: true }
      await supabase.from('rough_entries').update({ ai_extracted: updated }).eq('id', ctx.rough_entry_id)
      triggerExtraction(supabase, ctx.rough_entry_id)
      await clearSession(supabase, from)
      const amount2 = updated.amount as number | null
      if (!amount2) {
        await sendWA(from, `📥 Added to logbook — couldn't extract all details.\nReview: briklayflow.vercel.app/logbook`)
        break
      }
      const desc2 = (updated.description_raw || updated.work_type || updated.category_name || 'Payment') as string
      await sendWA(from, buildConfirmMsg(text, amount2, updated.mode as string | null, desc2))
      break
    }

    // ── Payee was ambiguous; user picks from numbered list ────────────────────
    case 'AWAIT_PAYEE_CHOICE': {
      const num = parseInt(text.trim())
      const matches = (ctx.payee_matches ?? []) as Array<{ id: string; name: string; category: string }>
      const isLastOption = num === matches.length + 1

      if (num >= 1 && num <= matches.length) {
        const chosen = matches[num - 1]
        await mergeAndUpdateExtracted(supabase, ctx.rough_entry_id, {
          payee_id: chosen.id,
          payee_name: chosen.name,
          payee_matched: true,
          payee_unmatched: false,
          payee_confidence: 'HIGH',
        }, ctx.extracted as Record<string, unknown>)
        const amount3 = (ctx.extracted as any).amount as number
        const desc3 = ((ctx.extracted as any).description_raw || (ctx.extracted as any).work_type || (ctx.extracted as any).category_name || 'Payment') as string
        await sendWA(from, buildConfirmMsg(chosen.name, amount3, (ctx.extracted as any).mode as string | null, desc3))
        await clearSession(supabase, from)
      } else if (isLastOption) {
        await sendWA(from,
          `📥 Added to logbook\n` +
          `Open app to assign the right person:\n` +
          `briklayflow.vercel.app/logbook`)
        await clearSession(supabase, from)
      } else {
        await sendWA(from, `Reply 1 to ${matches.length + 1}`)
      }
      break
    }

    // ── Multiple projects; user picks from numbered list ──────────────────────
    case 'AWAIT_PROJECT': {
      const num = parseInt(text.trim())
      const options = (ctx.project_options ?? []) as Array<{ id: string; name: string }>

      if (num >= 1 && num <= options.length) {
        const chosen = options[num - 1]
        await mergeAndUpdateExtracted(supabase, ctx.rough_entry_id, {
          project_id: chosen.id,
          project_name: chosen.name,
          project_matched: true,
          project_unmatched: false,
        }, ctx.extracted as Record<string, unknown>)
        const amount4 = ctx.amount as number
        const payeeName = ctx.payee_name as string
        await sendWA(from,
          `✅ Added to logbook\n` +
          `*${payeeName}* — ${fmtAmount(amount4)}\n` +
          `Project: ${chosen.name}\n\n` +
          `Review: briklayflow.vercel.app/logbook`)
        await clearSession(supabase, from)
      } else {
        await sendWA(from, `Reply 1 to ${options.length}`)
      }
      break
    }

    // ── Image context received; process based on intent ──────────────────────
    case 'AWAIT_IMAGE_CONTEXT': {
      // Background job may have already processed the entry — if so just add annotation
      const { data: currentEntry } = await supabase
        .from('rough_entries')
        .select('status, ai_extracted')
        .eq('id', ctx.rough_entry_id)
        .maybeSingle()

      if (currentEntry?.status === 'PENDING') {
        await supabase.from('rough_entries').update({
          ai_extracted: { ...currentEntry.ai_extracted, user_annotation: text },
        }).eq('id', ctx.rough_entry_id)
        await sendWA(from, `✅ Note added to your entry.\nReview: briklayflow.vercel.app/logbook`)
        await clearSession(supabase, from)
        return
      }

      const deadlinePassed = new Date() > new Date(ctx.deadline)
      const imageType = ctx.image_type as string

      // For payment images the note IS the context — never redirect to new financial.
      // For SITE_UPDATE / UNKNOWN, a clearly financial note starts a new entry instead.
      const redirectToNew =
        imageType !== 'PAYMENT_PROOF' &&
        imageType !== 'PAYMENT_LIST' &&
        intent.action === 'NEW_FINANCIAL' &&
        intent.confidence === 'HIGH' &&
        !deadlinePassed

      if (redirectToNew) {
        await processImageWithContext(supabase, ctx, null, from, senderName)
        await handleFinancial(supabase, text, from, senderName, null)
      } else {
        await processImageWithContext(supabase, ctx, deadlinePassed ? null : text, from, senderName)
      }

      await clearSession(supabase, from)
      break
    }

    default:
      await clearSession(supabase, from)
      await sendWA(from, 'Session expired. Please send your message again.')
  }
}

// ── Site text update handler ──────────────────────────────────────────────────

export async function handleSiteTextUpdate(
  supabase: any,
  text: string,
  from: string,
  senderName: string,
): Promise<void> {
  await createRoughEntry(supabase, text, from, senderName, {
    image_type: 'SITE_UPDATE',
    user_note: text,
    has_attachment: false,
    wired_for_future: true,
  }, 'WHATSAPP_TEXT')

  const preview = text.length > 60 ? text.slice(0, 60) + '…' : text
  await sendWA(from,
    `📋 Site update noted!\n"${preview}"\n\n` +
    `Review: briklayflow.vercel.app/logbook`)
}

// ── Query handler ─────────────────────────────────────────────────────────────

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
      await sendWA(from, '✅ No pending entries in logbook!')
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
      `📥 *${rows.length} pending entries:*\n\n${list}\n\nOpen app: *briklayflow.vercel.app/logbook*`)
    return
  }

  await sendWA(from,
    'For detailed reports open the app:\n*briklayflow.vercel.app*\n\n' +
    'Full query support coming soon! 🚀')
}

// ── General handler ───────────────────────────────────────────────────────────

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
      `_"ramu 5000 cash plastering 2nd floor"_\n\n` +
      `Or type *PENDING* to see logbook.`)
    return
  }

  if (lower === 'help' || lower === '?' || lower.includes('what can you do')) {
    await sendWA(from,
      `*Briklay WhatsApp*\n\n` +
      `What you can do:\n` +
      `• Add payments: _"ramu 5k cash plastering"_\n` +
      `• Check logbook: type *PENDING*\n\n` +
      `Open app: briklayflow.vercel.app`)
    return
  }

  await sendWA(from,
    `Got your message! To add a payment, send:\n` +
    `_"name amount description"_\n\n` +
    `Example: _"ramu 5000 cash plastering"_`)
}

// ── Image handler ─────────────────────────────────────────────────────────────

export async function handleImageMessage(
  supabase: any,
  message: any,
  from: string,
  senderName: string,
  _registered: any,
): Promise<void> {
  const caption = message.image?.caption || null
  const mediaId = message.image?.id

  if (!mediaId) {
    await sendWA(from, '📸 Image received! Add a caption for better AI extraction.')
    return
  }

  // STEP 1: Download + store
  let imageData: { publicUrl: string; base64: string; contentType: string }
  try {
    imageData = await downloadAndStoreImage(mediaId, from, supabase)
  } catch (e) {
    console.error('[handlers] Image download failed:', e)
    await sendWA(from, `⚠️ Could not save the image.\nPlease try sending again.`)
    return
  }
  const { publicUrl, base64, contentType } = imageData

  // STEP 2: Classify image
  const imageClass = await classifyImage(base64, caption, contentType)
  console.log('[handlers] Image classified:', { from, type: imageClass.type, confidence: imageClass.confidence })

  // STEP 3: Create rough entry in AWAITING_CONTEXT status
  const deadline = new Date(Date.now() + 45_000).toISOString()
  const { data: entry, error: insertError } = await supabase
    .from('rough_entries')
    .insert({
      source: 'WHATSAPP_IMAGE',
      raw_text: caption || null,
      raw_image_url: publicUrl,
      sender_name: senderName,
      sender_number: from,
      image_type: imageClass.type,
      status: 'AWAITING_CONTEXT',
      context_deadline: deadline,
      ai_extracted: {
        image_type: imageClass.type,
        image_description: imageClass.description,
        image_confidence: imageClass.confidence,
        has_attachment: true,
        attachment_url: publicUrl,
      },
    })
    .select()
    .single()
  if (insertError) console.error('[handlers] Rough entry insert error:', insertError)

  // STEP 4: Save session — base64 NOT stored (can be 500KB+, too large for session JSONB)
  await saveSession(supabase, from, 'AWAIT_IMAGE_CONTEXT', {
    rough_entry_id: entry?.id,
    image_url: publicUrl,
    image_content_type: contentType,
    image_type: imageClass.type,
    image_description: imageClass.description,
    caption,
    deadline,
  })

  // STEP 5: Reply based on type
  const replies: Record<string, string> = {
    PAYMENT_PROOF:
      `📸 Payment image received!\n\n` +
      `Send a note about it (optional) or I will extract the details automatically.`,
    PAYMENT_LIST:
      `📋 Payment list received!\n\n` +
      `Send any context or I will extract all entries now.`,
    SITE_UPDATE:
      `📷 Site photo received!\n\n` +
      `Send a note — which floor, what work, any issues?`,
    UNKNOWN:
      `📎 Image received! What is this?\n\n` +
      `1️⃣ Payment proof or receipt\n` +
      `2️⃣ Site progress photo\n\n` +
      `Reply 1 or 2 (or send a note describing it).`,
  }
  await sendWA(from, replies[imageClass.type] || replies.UNKNOWN)

  // STEP 6: Start background processing immediately for all types.
  // User can still annotate within the 45s window — if they do, the entry
  // gets updated. If not, the image is already processed when they check logbook.
  if (entry?.id) {
    if (imageClass.type === 'PAYMENT_LIST') {
      processPaymentList(supabase, entry.id, base64, contentType, caption, from, senderName)
        .catch((e) => console.error('[handlers] processPaymentList error:', e))
    } else {
      processImageImmediately(supabase, entry.id, base64, contentType, caption, from, senderName, imageClass.type)
        .catch((e) => console.error('[handlers] processImageImmediately error:', e))
    }
  }
}

// ── Background helpers ────────────────────────────────────────────────────────

export async function processPaymentList(
  supabase: any,
  parentId: string,
  base64: string,
  contentType: string,
  userContext: string | null,
  from: string,
  senderName: string,
): Promise<void> {
  console.log('[handlers] processPaymentList started:', { parentId, from })

  const rows = await extractPaymentListFromImage(base64, contentType, userContext)
  console.log('[handlers] Rows extracted:', rows.length)

  // Nothing extracted — save as-is for manual review
  if (!rows?.length) {
    await supabase.from('rough_entries').update({ status: 'PENDING' }).eq('id', parentId)
    await sendWA(from,
      `📋 Could not read the list clearly.\n` +
      `Saved to logbook for manual review:\nbriklayflow.vercel.app/logbook`)
    return
  }

  // Fetch parent's stored image URL for child entries
  const { data: parent } = await supabase
    .from('rough_entries')
    .select('raw_image_url')
    .eq('id', parentId)
    .maybeSingle()
  const imageUrl = parent?.raw_image_url || null

  // Match each row's payee against stakeholders
  const matchedRows = await Promise.all(
    rows.map(async (row: any) => {
      const payeeMatch = row.payee_raw ? await matchPayee(supabase, row.payee_raw) : null
      return {
        ...row,
        payee_id:       payeeMatch?.id   || null,
        payee_name:     payeeMatch?.name || row.payee_raw,
        payee_matched:  !!payeeMatch,
        payee_unmatched: !payeeMatch && !!row.payee_raw,
      }
    }),
  )

  // Create one rough_entry per row
  const inserts = matchedRows.map((row: any) => ({
    source:                  'WHATSAPP_IMAGE',
    raw_text:                `List item ${row.row_number}: ${row.payee_raw || '?'} ${row.amount || '?'}`,
    raw_image_url:           imageUrl,
    sender_name:             senderName,
    sender_number:           from,
    parent_image_entry_id:   parentId,
    image_type:              'PAYMENT_LIST',
    status:                  'PENDING',
    ai_extracted: {
      payee_raw:       row.payee_raw,
      payee_name:      row.payee_name,
      payee_id:        row.payee_id,
      payee_matched:   row.payee_matched,
      payee_unmatched: row.payee_unmatched,
      amount:          row.amount,
      description_raw: row.description || null,
      mode:            row.mode        || null,
      date_raw:        row.date_raw    || null,
      from_list:       true,
      list_row:        row.row_number,
      has_attachment:  true,
      attachment_url:  imageUrl,
    },
  }))

  const { error: insertError } = await supabase.from('rough_entries').insert(inserts)
  if (insertError) console.error('[handlers] List entries insert error:', insertError)

  // Mark parent as POSTED — it was just a container for the list image
  await supabase.from('rough_entries').update({
    status: 'POSTED',
    ai_extracted: {
      list_processed:  true,
      entries_created: rows.length,
      has_attachment:  true,
      attachment_url:  imageUrl,
    },
  }).eq('id', parentId)

  // Build 3-row preview for WA reply
  const preview = matchedRows
    .slice(0, 3)
    .map((row: any, i: number) => {
      const name = row.payee_name || row.payee_raw || '?'
      const amt  = row.amount ? `₹${row.amount.toLocaleString('en-IN')}` : '?'
      return `${i + 1}. ${name} — ${amt}`
    })
    .join('\n')
  const more = rows.length > 3 ? `\n...and ${rows.length - 3} more` : ''

  await sendWA(from,
    `📋 Found ${rows.length} payments!\n\n` +
    `${preview}${more}\n\n` +
    `Review all:\nbriklayflow.vercel.app/logbook`)

  console.log('[handlers] processPaymentList done:', { parentId, entriesCreated: rows.length })
}

// ── Image fetch helper ────────────────────────────────────────────────────────

async function fetchImageAsBase64(
  url: string,
): Promise<{ base64: string; contentType: string }> {
  const res = await fetch(url)
  const buffer = await res.arrayBuffer()
  const uint8 = new Uint8Array(buffer)
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode(...uint8.slice(i, i + CHUNK))
  }
  return {
    base64: btoa(binary),
    contentType: res.headers.get('content-type') || 'image/jpeg',
  }
}

// ── Immediate background processing ──────────────────────────────────────────

async function processImageImmediately(
  supabase: any,
  entryId: string,
  base64: string,
  contentType: string,
  caption: string | null,
  from: string,
  senderName: string,
  imageType: string,
): Promise<void> {
  // Brief delay so the session save completes before we check status.
  // Also gives the user a 2-second window to start typing a note.
  await new Promise((r) => setTimeout(r, 2000))

  const { data: current } = await supabase
    .from('rough_entries')
    .select('status, ai_extracted')
    .eq('id', entryId)
    .single()

  if (current?.status !== 'AWAITING_CONTEXT') {
    console.log('[handlers] Entry already processed by reply:', entryId)
    return
  }

  const ctx = {
    rough_entry_id: entryId,
    image_url: current.ai_extracted?.attachment_url,
    image_base64: base64,
    image_content_type: contentType,
    image_type: imageType,
    image_description: current.ai_extracted?.image_description,
    caption,
    deadline: new Date().toISOString(),
  }

  await processImageWithContext(supabase, ctx, caption, from, senderName)
  console.log('[handlers] processImageImmediately done:', entryId)
}

// ── Cleanup stuck entries on next message ─────────────────────────────────────

export async function processExpiredImageEntries(
  supabase: any,
  from: string,
  senderName: string,
): Promise<void> {
  const { data: expired } = await supabase
    .from('rough_entries')
    .select('*')
    .eq('sender_number', from)
    .eq('status', 'AWAITING_CONTEXT')
    .lt('context_deadline', new Date().toISOString())

  if (!expired?.length) return

  console.log(`[handlers] Processing ${expired.length} expired image entries for ${from}`)

  for (const entry of expired) {
    let base64 = ''
    let contentType = 'image/jpeg'
    if (entry.raw_image_url) {
      try {
        const fetched = await fetchImageAsBase64(entry.raw_image_url)
        base64 = fetched.base64
        contentType = fetched.contentType
      } catch (e) {
        console.error('[handlers] fetchImageAsBase64 error:', e)
      }
    }

    const ctx = {
      rough_entry_id: entry.id,
      image_url: entry.raw_image_url,
      image_base64: base64,
      image_content_type: contentType,
      image_type: entry.image_type || 'UNKNOWN',
      image_description: entry.ai_extracted?.image_description,
      caption: entry.raw_text,
      deadline: entry.context_deadline,
    }

    await processImageWithContext(supabase, ctx, null, from, senderName)
      .catch((e) => console.error('[handlers] processExpiredImageEntries error:', e))
  }
}

// ── Process image with optional user annotation ───────────────────────────────

async function processImageWithContext(
  supabase: any,
  ctx: any,
  userText: string | null,
  from: string,
  senderName: string,
): Promise<void> {
  const { image_type, rough_entry_id, image_content_type, image_url, caption } = ctx

  // base64 is not stored in session (too large) — use what was passed in ctx or re-fetch
  let effectiveBase64: string = ctx.image_base64 || ''
  let effectiveContentType: string = image_content_type || 'image/jpeg'
  if (!effectiveBase64 && image_url) {
    console.log('[handlers] processImageWithContext: base64 missing, fetching from Storage:', image_url)
    try {
      const fetched = await fetchImageAsBase64(image_url)
      effectiveBase64 = fetched.base64
      effectiveContentType = fetched.contentType
    } catch (e) {
      console.error('[handlers] fetchImageAsBase64 fallback error:', e)
    }
  }

  console.log('[handlers] processImageWithContext:', {
    image_type,
    rough_entry_id,
    base64Length: effectiveBase64?.length || 0,
    contentType: effectiveContentType,
    hasUserText: !!userText,
  })

  const { data: stksData } = await supabase.from('stakeholders').select('name, stakeholder_id').limit(30)
  const { data: projsData } = await supabase.from('projects').select('name, project_id').eq('status', 'Active')
  const knownNames    = stksData?.map((s: any) => s.name) || []
  const knownProjects = projsData?.map((p: any) => p.name) || []

  if (image_type === 'PAYMENT_PROOF') {
    // Image is the source of truth — vision AI extracts all financial fields.
    // The user's note becomes the description only; it does not override payee/amount/mode.
    const extracted = await extractPaymentFromImage(
      effectiveBase64, effectiveContentType, userText || caption, knownNames, knownProjects,
    )

    const payeeMatch = extracted.payee_raw ? await matchPayee(supabase, extracted.payee_raw) : null

    const finalExtracted = {
      ...extracted,
      payee_id:        payeeMatch?.id   || null,
      payee_name:      payeeMatch?.name || extracted.payee_raw,
      payee_matched:   !!payeeMatch,
      payee_unmatched: !payeeMatch && !!extracted.payee_raw,
      user_annotation: userText || null,
      // Note text becomes description; fall back to image extraction, then buildDescription
      description_raw: userText || extracted.description_raw || buildDescription(extracted),
      has_attachment:  true,
      attachment_url:  image_url,
    }

    await supabase.from('rough_entries').update({
      raw_text:     userText || caption,
      ai_extracted: finalExtracted,
      status:       'PENDING',
    }).eq('id', rough_entry_id)

    const payee  = finalExtracted.payee_name || '?'
    const amount = finalExtracted.amount ? `₹${finalExtracted.amount.toLocaleString('en-IN')}` : '?'
    const desc   = finalExtracted.description_raw || ''
    await sendWA(from,
      `✅ Added to logbook\n*${payee}* — ${amount}\n` +
      (desc ? `${desc}\n` : '') +
      `📎 Image attached as proof\n\nReview: briklayflow.vercel.app/logbook`)

  } else if (image_type === 'PAYMENT_LIST') {
    // processPaymentList() is already running in background from handleImageMessage
    if (userText) {
      await sendWA(from, `📋 Got your note — "${userText}"\nExtracting list entries now...`)
    }

  } else if (image_type === 'SITE_UPDATE') {
    await supabase.from('rough_entries').update({
      raw_text:    userText || caption,
      status:      'PENDING',
      ai_extracted: {
        image_type:      'SITE_UPDATE',
        user_note:       userText || caption,
        has_attachment:  true,
        attachment_url:  image_url,
        wired_for_future: true,
      },
    }).eq('id', rough_entry_id)

    await sendWA(from,
      `📷 Site photo saved!\n` +
      (userText ? `Note: "${userText}"\n` : '') +
      `Review: briklayflow.vercel.app/logbook`)

  } else {
    // UNKNOWN
    await supabase.from('rough_entries').update({
      raw_text:    userText || caption,
      status:      'PENDING',
      ai_extracted: { user_note: userText || null, has_attachment: true, attachment_url: image_url },
    }).eq('id', rough_entry_id)

    await sendWA(from, `📎 Saved to logbook.\nbriklayflow.vercel.app/logbook`)
  }
}

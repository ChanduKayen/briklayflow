// Message classification: FINANCIAL | QUERY | GENERAL
// Fast rule-based first; AI fallback only for genuinely ambiguous messages.

const FINANCIAL_PATTERNS = [
  /\d+\s*k\b/i,
  /[₹]|\brs\.?\b|\brupees?\b/i,
  /\b(paid|pay|payment|icchanu|iccham|paniche|iccham)\b/i,
  /\b(bought|purchased|konnam|konnaru)\b/i,
  /\b(cash|neft|upi|cheque)\b/i,
  /\b(bill|invoice|receipt|voucher)\b/i,
  /\b(salary|wages|labour|labor|advance)\b/i,
  /\d{4,}/,   // 4+ digit number → almost certainly an amount
]

const QUERY_PATTERNS = [
  /how\s*much|howmuch|enta|entho/i,
  /\b(balance|pending|due|total|outstanding|ledger)\b/i,
  /\b(paid\s+to|payment\s+to|amount\s+paid)\b/i,
  /\b(status|report|summary|statement|history)\b/i,
  /\?/,
]

export async function classifyMessage(
  text: string,
): Promise<'FINANCIAL' | 'QUERY' | 'GENERAL'> {
  if (FINANCIAL_PATTERNS.some((p) => p.test(text))) return 'FINANCIAL'
  if (QUERY_PATTERNS.some((p) => p.test(text))) return 'QUERY'

  // AI fallback — only reached for short/ambiguous messages
  const prompt =
    'Classify this construction-site WhatsApp message. ' +
    'Reply ONE word only: FINANCIAL, QUERY, or GENERAL. ' +
    'FINANCIAL = any payment/expense/purchase. ' +
    'QUERY = question about data/balance/records. ' +
    'GENERAL = greeting, help, or anything else.'

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const openaiKey    = Deno.env.get('OPENAI_API_KEY')

  if (anthropicKey) {
    const result = await callClaude(anthropicKey, prompt, text, 5)
    if (isValidClass(result)) return result as 'FINANCIAL' | 'QUERY' | 'GENERAL'
  }

  if (openaiKey) {
    const result = await callOpenAI(openaiKey, prompt, text, 5)
    if (isValidClass(result)) return result as 'FINANCIAL' | 'QUERY' | 'GENERAL'
  }

  return 'GENERAL'
}

// ── Private helpers ───────────────────────────────────────────────────────────

function isValidClass(s: string): boolean {
  return ['FINANCIAL', 'QUERY', 'GENERAL'].includes(s)
}

async function callClaude(
  apiKey: string, system: string, user: string, maxTokens: number,
): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) return ''
    const d = await res.json()
    return (d.content?.[0]?.text ?? '').trim()
  } catch { return '' }
}

async function callOpenAI(
  apiKey: string, system: string, user: string, maxTokens: number,
): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) return ''
    const d = await res.json()
    return (d.choices?.[0]?.message?.content ?? '').trim()
  } catch { return '' }
}

// Export callClaude/callOpenAI for reuse in _extract.ts
export { callClaude, callOpenAI }

// ── Image classification ──────────────────────────────────────────────────────

const VALID_IMAGE_TYPES = ['PAYMENT_PROOF', 'PAYMENT_LIST', 'SITE_UPDATE', 'UNKNOWN'] as const
const VALID_CONFIDENCE   = ['HIGH', 'LOW'] as const

type ImageType       = typeof VALID_IMAGE_TYPES[number]
type ImageConfidence = typeof VALID_CONFIDENCE[number]

interface ImageClassification {
  type: ImageType
  confidence: ImageConfidence
  description: string
}

/**
 * Classify a WhatsApp image into PAYMENT_PROOF | PAYMENT_LIST | SITE_UPDATE | UNKNOWN.
 * Fast-path: caption regex. Slow-path: vision AI (Anthropic → OpenAI fallback).
 */
export async function classifyImage(
  base64: string,
  caption: string | null,
  contentType: string,
): Promise<ImageClassification> {
  // Fast path — classify from caption alone when signal is clear
  if (caption) {
    const lower = caption.toLowerCase()

    if (/bill|receipt|payment|paid|invoice|upi|neft|transfer|voucher|challan/i.test(lower)) {
      return { type: 'PAYMENT_PROOF', confidence: 'LOW', description: caption }
    }
    if (/list|labour|worker|wages|register|sheet|multiple|payments|payroll/i.test(lower)) {
      return { type: 'PAYMENT_LIST', confidence: 'LOW', description: caption }
    }
    if (/site|floor|slab|wall|roof|progress|work done|construction|completed|photo|pic/i.test(lower)) {
      return { type: 'SITE_UPDATE', confidence: 'LOW', description: caption }
    }
  }

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  const OPENAI_KEY    = Deno.env.get('OPENAI_API_KEY')

  const prompt =
    `Classify this construction site image. Return ONLY valid JSON.\n` +
    (caption ? `User caption: "${caption}"\n` : '') +
    `\n{"type":"PAYMENT_PROOF or PAYMENT_LIST or SITE_UPDATE or UNKNOWN","confidence":"HIGH or LOW","description":"one line of what you see"}\n\n` +
    `PAYMENT_PROOF: single payment receipt, UPI screenshot, bank transfer confirmation, cash receipt, single vendor bill or invoice.\n` +
    `PAYMENT_LIST: handwritten or printed list with multiple payments, labour wage register, multiple workers with amounts in rows.\n` +
    `SITE_UPDATE: construction site progress photo, building work in progress, material on site, workers, completed work area, any site photo.\n` +
    `UNKNOWN: personal photo, screenshot of something unrelated, selfie, unclear image.`

  try {
    if (ANTHROPIC_KEY) return await classifyImageAnthropic(base64, contentType, prompt, ANTHROPIC_KEY)
    if (OPENAI_KEY)    return await classifyImageOpenAI(base64, contentType, prompt, OPENAI_KEY)
  } catch (e) {
    console.error('[classify] Image classify error:', e)
  }

  return { type: 'UNKNOWN', confidence: 'LOW', description: caption || 'Image received' }
}

function normaliseImageResult(parsed: any): ImageClassification {
  if (!parsed || !VALID_IMAGE_TYPES.includes(parsed.type))   parsed = { ...parsed, type: 'UNKNOWN' }
  if (!parsed || !VALID_CONFIDENCE.includes(parsed.confidence)) parsed = { ...parsed, confidence: 'LOW' }
  if (!parsed.description) parsed.description = ''
  return parsed as ImageClassification
}

function safeParseImageJSON(raw: string): any | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    return JSON.parse(cleaned)
  } catch { return null }
}

async function classifyImageAnthropic(
  base64: string,
  contentType: string,
  prompt: string,
  apiKey: string,
): Promise<ImageClassification> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    clearTimeout(timeout)
    const data = await res.json()
    const text = data.content?.[0]?.text?.trim() || '{}'
    console.log('[classify] classifyImageAnthropic raw:', text.slice(0, 200))
    const parsed = normaliseImageResult(safeParseImageJSON(text) ?? {})
    console.log('[classify] Image classified (Anthropic):', parsed)
    return parsed
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

async function classifyImageOpenAI(
  base64: string,
  contentType: string,
  prompt: string,
  apiKey: string,
): Promise<ImageClassification> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64}`, detail: 'low' } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    clearTimeout(timeout)
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '{}'
    console.log('[classify] classifyImageOpenAI raw:', text.slice(0, 200))
    const parsed = normaliseImageResult(safeParseImageJSON(text) ?? {})
    console.log('[classify] Image classified (OpenAI):', parsed)
    return parsed
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

// ── Intent classification ─────────────────────────────────────────────────────

export type IntentAction =
  | 'CONTINUE_SESSION'
  | 'NEW_FINANCIAL'
  | 'NEW_QUERY'
  | 'CANCEL'
  | 'GENERAL'

export interface IntentResult {
  action: IntentAction
  confidence: 'HIGH' | 'LOW'
  salvageable: {
    amount?: number
    project_hint?: string
  }
}

const VALID_INTENT_ACTIONS: IntentAction[] = [
  'CONTINUE_SESSION', 'NEW_FINANCIAL', 'NEW_QUERY', 'CANCEL', 'GENERAL',
]

/**
 * Decide what a user's reply means given the current session state.
 * Fast-path: hard rules + scoring. Slow-path: AI for genuinely ambiguous cases.
 */
export async function classifyIntent(
  text: string,
  sessionState: string,
  sessionContext: any,
  knownProjects: string[],
  knownNames: string[],
): Promise<IntentResult> {
  const lower = text.toLowerCase().trim()
  const salvageable: IntentResult['salvageable'] = {}

  // ── Hard rules — no AI needed ─────────────────────────────────────────────

  if (/^(cancel|stop|no|nope|wrong|nevermind|forget it|start over|bad|mistake)$/i.test(lower)) {
    return { action: 'CANCEL', confidence: 'HIGH', salvageable: {} }
  }

  if (/^(hi|hello|hey|hii|ok|okay|thanks|thank you|sari|accha|theek|np|k)$/i.test(lower)) {
    return { action: 'GENERAL', confidence: 'HIGH', salvageable: {} }
  }

  if (
    text.includes('?') ||
    /^(what|how|when|who|where|which|is |are |does |did |enta|ela|evaru|evariki|how much|balance|pending)/i.test(lower)
  ) {
    return { action: 'NEW_QUERY', confidence: 'HIGH', salvageable: {} }
  }

  // ── Extract signals ───────────────────────────────────────────────────────

  const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*k\b|(\d{4,})/i)
  const hasAmount = !!amountMatch
  if (amountMatch) {
    salvageable.amount = amountMatch[1]
      ? parseFloat(amountMatch[1]) * 1000
      : parseFloat(amountMatch[2])
  }

  const hasPaymentVerb =
    /\b(paid|pay|payment|bought|purchased|icchanu|iccham|konnam|spent|received)\b/i.test(lower)

  const hasKnownName = knownNames.some((n) =>
    lower.includes(n.toLowerCase().split(' ')[0]),
  )

  const matchedProject = knownProjects.find(
    (p) => lower.includes(p.toLowerCase()) || lower.includes(p.toLowerCase().split(' ')[0]),
  )
  if (matchedProject) salvageable.project_hint = matchedProject
  const hasKnownProject = !!matchedProject

  // ── Score per session state ───────────────────────────────────────────────

  let sessionScore = 0
  let newTxnScore  = 0

  switch (sessionState) {
    case 'AWAIT_PROJECT':
      if (/^[1-9]$/.test(lower))                     sessionScore += 95
      if (hasKnownProject && !hasAmount)              sessionScore += 85
      if (!hasAmount && lower.split(' ').length <= 2) sessionScore += 50
      if (hasAmount && hasPaymentVerb)                newTxnScore  += 90
      if (hasAmount && hasKnownName)                  newTxnScore  += 85
      if (hasPaymentVerb)                             newTxnScore  += 40
      break

    case 'AWAIT_AMOUNT':
      if (/^[\d,.\s]+(k|lakh|l|rs|₹)?$/i.test(lower))        sessionScore += 95
      if (hasAmount && lower.split(' ').length <= 3)           sessionScore += 75
      if (hasAmount && hasPaymentVerb && hasKnownName)         newTxnScore  += 90
      if (hasAmount && hasPaymentVerb)                         newTxnScore  += 65
      break

    case 'AWAIT_PAYEE':
      if (!hasAmount && lower.split(' ').length <= 3) sessionScore += 75
      if (hasKnownName && !hasAmount)                 sessionScore += 70
      if (hasAmount)                                  newTxnScore  += 65
      if (hasAmount && hasPaymentVerb)                newTxnScore  += 80
      break

    case 'AWAIT_PAYEE_CHOICE':
      if (/^[1-9]$/.test(lower))                                     sessionScore += 98
      if (/^(first|second|third|top|last|one|two|three)$/i.test(lower)) sessionScore += 80
      if (hasAmount || hasPaymentVerb)                                newTxnScore  += 80
      break

    case 'AWAIT_IMAGE_CONTEXT':
      if (!hasAmount && lower.split(' ').length <= 8)              sessionScore += 60
      if (/\b(this|from|for|yesterday|today|last|site|floor|delivery|project|same|above|work|it)\b/i.test(lower))
                                                                     sessionScore += 55
      if (hasAmount && hasKnownName)                               newTxnScore  += 85
      if (hasPaymentVerb && hasAmount)                             newTxnScore  += 80
      break

    default:
      newTxnScore += 50
      break
  }

  console.log('[intent] scores:', {
    text, sessionState, sessionScore, newTxnScore,
    hasAmount, hasPaymentVerb, hasKnownName, hasKnownProject,
  })

  // ── Clear winner (gap > 20) ───────────────────────────────────────────────

  if (sessionScore > newTxnScore + 20 && sessionScore >= 55) {
    return {
      action: 'CONTINUE_SESSION',
      confidence: sessionScore > 75 ? 'HIGH' : 'LOW',
      salvageable,
    }
  }

  if (newTxnScore > sessionScore + 20 && newTxnScore >= 55) {
    return {
      action: 'NEW_FINANCIAL',
      confidence: newTxnScore > 75 ? 'HIGH' : 'LOW',
      salvageable,
    }
  }

  // ── Ambiguous — AI fallback ───────────────────────────────────────────────

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  const OPENAI_KEY    = Deno.env.get('OPENAI_API_KEY')

  if (ANTHROPIC_KEY || OPENAI_KEY) {
    try {
      const aiResult = await classifyIntentAI(
        text, sessionState, sessionContext,
        ANTHROPIC_KEY || OPENAI_KEY!,
        !!ANTHROPIC_KEY,
      )
      return { ...aiResult, salvageable }
    } catch (e) {
      console.error('[intent] AI error:', e)
    }
  }

  // Ambiguous with no AI — trust the session
  return { action: 'CONTINUE_SESSION', confidence: 'LOW', salvageable }
}

async function classifyIntentAI(
  text: string,
  sessionState: string,
  context: any,
  apiKey: string,
  isAnthropic: boolean,
): Promise<IntentResult> {
  const stateDesc: Record<string, string> = {
    AWAIT_PROJECT:       'waiting for user to choose a project from a numbered list',
    AWAIT_AMOUNT:        'waiting for user to send a payment amount',
    AWAIT_PAYEE:         'waiting for user to say who was paid',
    AWAIT_PAYEE_CHOICE:  'waiting for user to pick a person by number (1, 2, 3)',
    AWAIT_IMAGE_CONTEXT: 'waiting for user to describe or annotate an image just received',
  }

  const knownInfo = [
    context?.payee_name   && `Payee so far: ${context.payee_name}`,
    context?.amount       && `Amount so far: ₹${context.amount}`,
    context?.project_hint && `Project hint: ${context.project_hint}`,
  ].filter(Boolean).join(', ')

  const prompt =
    `You are handling a WhatsApp conversation for a construction site finance system.\n\n` +
    `Current state: ${stateDesc[sessionState] || sessionState}\n` +
    (knownInfo ? `Known so far: ${knownInfo}\n` : '') +
    `\nUser just sent: "${text}"\n\n` +
    `Decide what this message means:\n` +
    `CONTINUE_SESSION — answering the current question\n` +
    `NEW_FINANCIAL — starting a new payment or expense entry\n` +
    `NEW_QUERY — asking a question about data or balances\n` +
    `CANCEL — wants to cancel or stop\n` +
    `GENERAL — greeting or unrelated message\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"action":"CONTINUE_SESSION","confidence":"HIGH"}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    let resultText: string

    if (isAnthropic) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 60,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      clearTimeout(timeout)
      const data = await res.json()
      resultText = data.content?.[0]?.text?.trim() || '{}'
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 60,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user',   content: text },
          ],
        }),
      })
      clearTimeout(timeout)
      const data = await res.json()
      resultText = data.choices?.[0]?.message?.content?.trim() || '{}'
    }

    const parsed = JSON.parse(resultText)
    if (!VALID_INTENT_ACTIONS.includes(parsed.action)) parsed.action     = 'CONTINUE_SESSION'
    if (!VALID_CONFIDENCE.includes(parsed.confidence)) parsed.confidence = 'LOW'

    console.log('[intent] classified (AI):', parsed)
    return { ...parsed, salvageable: {} }
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

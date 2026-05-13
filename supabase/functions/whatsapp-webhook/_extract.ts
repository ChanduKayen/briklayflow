// AI entity extraction for WhatsApp text messages.
// Returns raw fields only — server-side matching (payee/project fuzzy match)
// is handled by the ai-extract-entry edge function triggered afterward.

import { callClaude, callOpenAI } from './_classify.ts'

export interface ExtractedFields {
  payee_raw: string | null
  payee_name: string | null
  payee_confidence: 'HIGH' | 'LOW' | null
  amount: number | null
  description_raw: string | null
  mode: 'Cash' | 'NEFT' | 'UPI' | 'Cheque' | null
  transaction_type: 'Worker Payment' | 'Material Purchase' | 'General Expense' | null
  category_name: string | null
  category_code: string | null
  work_type: string | null
  floor_or_area: string | null
  material_name: string | null
  material_quantity: string | null
  material_unit: string | null
  site_observation: string | null
  date_raw: string | null
}

const SYSTEM_PROMPT = `You are a construction accounting assistant (Kakinada, Andhra Pradesh).
Extract transaction details from messages in English, Telugu, or Hindi.

Amount conversion: 5k/5K=5000 | 1L/1 lakh=100000 | 50K=50000
Telugu keywords: icchanu/iccham=paid | konnam=bought | ki/ku=to | nakit=Cash
Hindi keywords: diya=paid | liya=took | naqd=Cash

payee_confidence rules:
- "HIGH" if the payee name is clearly a person or known vendor name
- "LOW" if the payee is ambiguous, missing, or could be misread

description_raw building rules:
- Worker payment: "[work_type] - [floor_or_area]" (omit null parts)
- Material purchase: "[material_name] - [material_quantity] [material_unit]" (omit null parts)
- General: summarise the remaining details

Examples:
"ramu 5000 cash 2nd floor plastering"
→ {"payee_raw":"ramu","payee_name":"Ramu","payee_confidence":"HIGH","amount":5000,"mode":"Cash","transaction_type":"Worker Payment","work_type":"Plastering","floor_or_area":"2nd floor","description_raw":"Plastering - 2nd floor","category_name":"Labour","category_code":null,"material_name":null,"material_quantity":null,"material_unit":null,"site_observation":null,"date_raw":null}

"bought cement 50 bags from lakshmi 7000"
→ {"payee_raw":"lakshmi","payee_name":"Lakshmi","payee_confidence":"HIGH","amount":7000,"mode":null,"transaction_type":"Material Purchase","work_type":null,"floor_or_area":null,"material_name":"Cement","material_quantity":"50","material_unit":"bags","description_raw":"Cement - 50 bags","category_name":"Materials","category_code":null,"site_observation":null,"date_raw":null}

"electrician suresh wiring done 3rd floor 15000 neft"
→ {"payee_raw":"suresh","payee_name":"Suresh","payee_confidence":"HIGH","amount":15000,"mode":"NEFT","transaction_type":"Worker Payment","work_type":"Electrical wiring","floor_or_area":"3rd floor","description_raw":"Electrical wiring - 3rd floor","category_name":"Labour","category_code":null,"material_name":null,"material_quantity":null,"material_unit":null,"site_observation":null,"date_raw":null}

Return ONLY valid JSON, no markdown or extra text:
{
  "payee_raw": string|null,
  "payee_name": string|null,
  "payee_confidence": "HIGH"|"LOW"|null,
  "amount": number|null,
  "description_raw": string|null,
  "mode": "Cash"|"NEFT"|"UPI"|"Cheque"|null,
  "transaction_type": "Worker Payment"|"Material Purchase"|"General Expense"|null,
  "category_name": string|null,
  "category_code": string|null,
  "work_type": string|null,
  "floor_or_area": string|null,
  "material_name": string|null,
  "material_quantity": string|null,
  "material_unit": string|null,
  "site_observation": string|null,
  "date_raw": string|null
}`

const EMPTY: ExtractedFields = {
  payee_raw: null,
  payee_name: null,
  payee_confidence: null,
  amount: null,
  description_raw: null,
  mode: null,
  transaction_type: null,
  category_name: null,
  category_code: null,
  work_type: null,
  floor_or_area: null,
  material_name: null,
  material_quantity: null,
  material_unit: null,
  site_observation: null,
  date_raw: null,
}

/** Extract entities from raw WhatsApp text. Returns safe defaults on any failure. */
export async function extractEntities(text: string): Promise<ExtractedFields> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const openaiKey    = Deno.env.get('OPENAI_API_KEY')

  if (!anthropicKey && !openaiKey) return EMPTY

  if (anthropicKey) {
    const raw = await callClaude(anthropicKey, SYSTEM_PROMPT, text, 300)
    const parsed = safeParseJSON(raw)
    if (parsed) return { ...EMPTY, ...parsed }
  }

  if (openaiKey) {
    const raw = await callOpenAIJson(openaiKey, SYSTEM_PROMPT, text)
    const parsed = safeParseJSON(raw)
    if (parsed) return { ...EMPTY, ...parsed }
  }

  return EMPTY
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/^```json\n?|\n?```$/g, '').trim()
    return JSON.parse(cleaned)
  } catch { return null }
}

async function callOpenAIJson(
  apiKey: string, system: string, user: string,
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
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) return ''
    const d = await res.json()
    return d.choices?.[0]?.message?.content ?? ''
  } catch { return '' }
}

// ── Image extraction ──────────────────────────────────────────────────────────

const PAYMENT_EMPTY = {
  payee_raw: null, amount: null, mode: null, date_raw: null,
  reference_number: null, description_raw: null,
  bank_name: null, upi_id: null, vendor_gstin: null,
}

/**
 * Extract a single payment from a UPI screenshot, bank transfer, receipt, or bill image.
 */
export async function extractPaymentFromImage(
  base64: string,
  contentType: string,
  userContext: string | null,
  knownNames: string[],
  knownProjects: string[],
): Promise<{
  payee_raw: string | null
  amount: number | null
  mode: string | null
  date_raw: string | null
  reference_number: string | null
  description_raw: string | null
  bank_name: string | null
  upi_id: string | null
  vendor_gstin: string | null
}> {
  const prompt =
    `Extract payment details from this construction payment image.\n` +
    (userContext ? `User note: "${userContext}" — use as additional context.\n` : '') +
    `\nKnown people: ${JSON.stringify(knownNames)}\n` +
    `Known projects: ${JSON.stringify(knownProjects)}\n` +
    `\nImage may be: UPI screenshot, bank transfer confirmation, cash receipt, vendor bill, or invoice.\n\n` +
    `Return ONLY valid JSON, no other text:\n` +
    `{\n` +
    `  "payee_raw": "name of who received payment or vendor name",\n` +
    `  "amount": 5000,\n` +
    `  "mode": "Cash or NEFT or UPI or Cheque",\n` +
    `  "date_raw": "date as shown in image",\n` +
    `  "reference_number": "UTR or UPI ref or cheque no",\n` +
    `  "description_raw": "what the payment is for",\n` +
    `  "bank_name": "bank name if visible",\n` +
    `  "upi_id": "UPI ID if visible",\n` +
    `  "vendor_gstin": "GSTIN if visible"\n` +
    `}\n\n` +
    `Rules:\n` +
    `- UPI screenshot: payee = recipient name, mode = UPI, reference = UTR number\n` +
    `- Bank transfer: payee = beneficiary name, mode = NEFT or IMPS\n` +
    `- Bill or invoice: payee = vendor/company name, amount = total payable\n` +
    `- If a field is not visible: null\n` +
    `- Amount must be a number, not a string`

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  const OPENAI_KEY    = Deno.env.get('OPENAI_API_KEY')

  console.log('[extract] extractPaymentFromImage called:', {
    base64Length: base64?.length || 0,
    contentType,
    hasAnthropicKey: !!ANTHROPIC_KEY,
    hasOpenAIKey: !!OPENAI_KEY,
  })

  try {
    if (ANTHROPIC_KEY) {
      return await extractImageAnthropic(base64, contentType, prompt, ANTHROPIC_KEY, 'claude-haiku-4-5-20251001', 400)
    }
    if (OPENAI_KEY) {
      return await extractImageOpenAI(base64, contentType, prompt, OPENAI_KEY, 'gpt-4o-mini', 400)
    }
  } catch (e) {
    console.error('[extract] extractPaymentFromImage error:', e)
  }

  return { ...PAYMENT_EMPTY }
}

/**
 * Extract all payment rows from a handwritten or printed payment list image.
 */
export async function extractPaymentListFromImage(
  base64: string,
  contentType: string,
  userContext: string | null,
): Promise<Array<{
  payee_raw: string | null
  amount: number | null
  description: string | null
  mode: string | null
  date_raw: string | null
  row_number: number
}>> {
  const prompt =
    `Extract ALL payment rows from this construction payment list image.\n` +
    (userContext ? `User note: "${userContext}"\n` : '') +
    `\nThis is a handwritten or printed list with multiple payments. Extract EVERY visible row.\n\n` +
    `Return ONLY a valid JSON array, no other text:\n` +
    `[\n` +
    `  {\n` +
    `    "payee_raw": "worker or vendor name",\n` +
    `    "amount": 5000,\n` +
    `    "description": "work type or item",\n` +
    `    "mode": "Cash or NEFT or null",\n` +
    `    "date_raw": "date if shown or null",\n` +
    `    "row_number": 1\n` +
    `  }\n` +
    `]\n\n` +
    `Rules:\n` +
    `- Each visible payment row = one array item\n` +
    `- row_number starts at 1\n` +
    `- If amount is unclear: null\n` +
    `- If name is unclear: best guess as string\n` +
    `- Preserve original spelling of names\n` +
    `- Amount must be a number not a string\n` +
    `- Never return empty array if rows visible`

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  const OPENAI_KEY    = Deno.env.get('OPENAI_API_KEY')

  try {
    if (ANTHROPIC_KEY) return await extractListAnthropic(base64, contentType, prompt, ANTHROPIC_KEY)
    if (OPENAI_KEY)    return await extractListOpenAI(base64, contentType, prompt, OPENAI_KEY)
  } catch (e) {
    console.error('[extract] extractPaymentListFromImage error:', e)
  }

  return []
}

// ── Shared vision helpers ─────────────────────────────────────────────────────

async function extractImageAnthropic(
  base64: string,
  contentType: string,
  prompt: string,
  apiKey: string,
  model: string,
  maxTokens: number,
): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

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
        model,
        max_tokens: maxTokens,
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
    console.log('[extract] extractImageAnthropic raw:', text)
    return safeParseJSON(text) ?? {}
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

async function extractImageOpenAI(
  base64: string,
  contentType: string,
  prompt: string,
  apiKey: string,
  model: string,
  maxTokens: number,
): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64}`, detail: 'high' } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    clearTimeout(timeout)
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '{}'
    console.log('[extract] extractImageOpenAI raw:', text)
    return safeParseJSON(text) ?? {}
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

async function extractListAnthropic(
  base64: string,
  contentType: string,
  prompt: string,
  apiKey: string,
): Promise<any[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
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
    const text = data.content?.[0]?.text?.trim() || '[]'
    console.log('[extract] extractListAnthropic raw:', text)
    const parsed = safeParseJSON(text)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

async function extractListOpenAI(
  base64: string,
  contentType: string,
  prompt: string,
  apiKey: string,
): Promise<any[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64}`, detail: 'high' } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    clearTimeout(timeout)
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '[]'
    console.log('[extract] extractListOpenAI raw:', text)
    const parsed = safeParseJSON(text)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

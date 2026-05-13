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

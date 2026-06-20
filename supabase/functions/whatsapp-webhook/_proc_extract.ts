// Procurement extraction — the structural twin of _extract.ts's transaction
// extraction. Two passes, decoupled by design (mirrors the gate/deep split the
// sprint calls for):
//
//   gateProcurement()      — a TINY, FAST call (WA_PROC_GATE_MODEL, haiku-class).
//                            It only SEGMENTS: how many distinct (vendor, site)
//                            requests, and per-request whether a vendor is named +
//                            the sourcing intent. No item extraction. This is the
//                            single source of the segment COUNT that the one-PR
//                            guard and the future multi-PR loop both read.
//
//   extractProcurements()  — the STRONG deep pass (WA_PROC_EXTRACT_MODEL, gpt-4.1).
//                            Returns an array `Request[]` (v1 length 1), each a
//                            { vendor_raw, sourcing_intent, site_raw, items[], title }.
//                            Mirrors extractTransactions(): array-returning, raw
//                            values only (vendor/site MATCHING happens in the agent,
//                            never here — exactly like payee matching).
//
// The understanding here is TARGET-AGNOSTIC: it does not know or care whether the
// agent stages into purchase_requests or anything else.

import { callClaude } from './_classify.ts'

// Fast gate model (must be MUCH faster than the deep pass, or parallelism buys
// nothing). Deep model mirrors the transaction extractor's default.
const PROC_GATE_MODEL    = Deno.env.get('WA_PROC_GATE_MODEL')    ?? 'gpt-4o-mini'
const PROC_EXTRACT_MODEL = Deno.env.get('WA_PROC_EXTRACT_MODEL') ?? 'gpt-4.1'

// ── types ───────────────────────────────────────────────────────────────────

export type ProcItem = {
  item_name: string
  quantity: number | null
  unit: string | null
  note: string | null
}

export type ProcRequest = {
  vendor_raw: string | null          // raw, as written — matched later in the agent
  sourcing_intent: 'direct' | 'rfq' | null
  site_raw: string | null            // exact project name if confident, else raw, else null
  items: ProcItem[]
  title: string | null               // LLM header for 3+ items
}

/** Per-(vendor,site) segment the gate found — the seam the one-PR guard reads. */
export type ProcSegment = {
  vendor_named: boolean
  vendor_confidence: 'high' | 'low'
  site_named: boolean
  sourcing: 'direct' | 'rfq' | null
}

export type ProcGate = {
  segments: ProcSegment[]            // length = number of distinct requests
}

// ── shared helpers (kept local so this file is self-contained) ───────────────

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw.replace(/^```json\n?|\n?```$/g, '').trim()) } catch { return null }
}

async function callOpenAIJson(
  apiKey: string, system: string, user: string, model: string, maxTokens = 300, temperature = 0,
): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    })
    if (!res.ok) return ''
    return (await res.json()).choices?.[0]?.message?.content ?? ''
  } catch { return '' }
}

function renderKnownProjects(names: string[]): string {
  const list = (names ?? []).filter(Boolean)
  return list.length ? list.map((n) => `"${n}"`).join(', ') : '(none on file)'
}

// ── 1. The fast gate (segment + sourcing only) ──────────────────────────────

const GATE_SYSTEM =
  `You are a FAST classifier for construction-site PURCHASE REQUESTS (materials to BUY/ORDER, not yet purchased).
Read the message and return STRICT JSON only — NO item extraction, be quick and conservative:
{ "segments": [ { "vendor_named": true|false, "vendor_confidence": "high"|"low", "site_named": true|false, "sourcing": "direct"|"rfq"|null } ] }
- A "segment" is ONE distinct (vendor, site) request. Emit one object per distinct request.
- TWO different vendors, OR two different sites, => TWO segments. Same vendor+site, many items => ONE segment.
- vendor_named: is a specific supplier/shop/vendor explicitly named to buy/order from? vendor_confidence "high" only if clearly named.
- site_named: is a project/site named?
- sourcing: "direct" if they say order from / send to a specific vendor; "rfq" if they want quotes / to compare; else null.
Only ONE segment in the vast majority of messages. JSON only.`

/** Fast pass: how many distinct requests, and per-request vendor/sourcing signal. */
export async function gateProcurement(text: string): Promise<ProcGate> {
  const openai = Deno.env.get('OPENAI_API_KEY')
  const anthropic = Deno.env.get('ANTHROPIC_API_KEY')
  const user = `<msg>\n${text}\n</msg>`

  let parsed: Record<string, unknown> | null = null
  if (openai) parsed = safeParseJSON(await callOpenAIJson(openai, GATE_SYSTEM, user, PROC_GATE_MODEL, 200))
  else if (anthropic) parsed = safeParseJSON(await callClaude(anthropic, GATE_SYSTEM, user, 200, 0))

  return gateFrom(parsed)
}

function gateFrom(parsed: Record<string, unknown> | null): ProcGate {
  const arr = Array.isArray((parsed as { segments?: unknown })?.segments) ? (parsed as { segments: unknown[] }).segments : []
  const segments: ProcSegment[] = []
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue
    const r = s as Record<string, unknown>
    segments.push({
      vendor_named: r.vendor_named === true,
      vendor_confidence: r.vendor_confidence === 'high' ? 'high' : 'low',
      site_named: r.site_named === true,
      sourcing: r.sourcing === 'direct' ? 'direct' : r.sourcing === 'rfq' ? 'rfq' : null,
    })
  }
  // Never report zero — a request with no clear vendor/site is still ONE segment.
  if (segments.length === 0) segments.push({ vendor_named: false, vendor_confidence: 'low', site_named: false, sourcing: null })
  return { segments }
}

// ── 2. The deep extraction (array-returning, raw values) ────────────────────

const EXTRACT_SYSTEM = `You extract construction-site PURCHASE REQUESTS — materials someone wants to BUY/ORDER (not yet purchased).
A purchase request = ONE vendor + ONE site + N items.

OUTPUT — STRICT JSON only:
{ "requests": [ { "vendor_raw": string|null, "sourcing_intent": "direct"|"rfq"|null, "site_raw": string|null, "title": string|null,
                  "items": [ { "item_name": string, "quantity": number|null, "unit": string|null, "note": string|null } ] } ] }

SEGMENTATION — one request per DISTINCT (vendor, site). A different vendor OR a different site => a separate request. Same vendor+site with many materials => ONE request with many items.
VENDOR — the supplier to order from, written in Latin/Roman letters, RAW as the user said it (do NOT guess or match to a list). null if none named.
SITE — the user's known projects: {{KNOWN_PROJECTS}}. Return the EXACT project name if it clearly matches one; otherwise the raw site words as written; otherwise null.
SOURCING_INTENT — "direct" if a specific vendor to order from; "rfq" if they want quotes / to compare prices; else null.
ITEMS — each material as its own item. Pull quantity + unit when stated ("200 bags cement" -> item_name "cement", quantity 200, unit "bags"; "2 ton steel" -> quantity 2, unit "ton"). quantity/unit null when not stated. note = any spec/grade/brand detail.
TITLE — for 3 OR MORE items, a short construction-literate header for the list ("Slab materials", "Plastering supplies", "Finishing items"); null for 1-2 items.

Read the WHOLE message first, then fill each request. JSON only.`

/** Deep pass → Request[] (v1 length 1). Raw values only; matching is the agent's job. */
export async function extractProcurements(text: string, knownProjects: string[] = []): Promise<ProcRequest[]> {
  const openai = Deno.env.get('OPENAI_API_KEY')
  const anthropic = Deno.env.get('ANTHROPIC_API_KEY')
  const system = EXTRACT_SYSTEM.replace('{{KNOWN_PROJECTS}}', renderKnownProjects(knownProjects))
  const user = `<msg>\n${text}\n</msg>`

  let parsed: Record<string, unknown> | null = null
  if (openai) parsed = safeParseJSON(await callOpenAIJson(openai, system, user, PROC_EXTRACT_MODEL, 1500))
  else if (anthropic) parsed = safeParseJSON(await callClaude(anthropic, system, user, 1500, 0))

  return requestsFrom(parsed)
}

function requestsFrom(parsed: Record<string, unknown> | null): ProcRequest[] {
  const arr = Array.isArray((parsed as { requests?: unknown })?.requests) ? (parsed as { requests: unknown[] }).requests : []
  const out: ProcRequest[] = []
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue
    const rec = r as Record<string, unknown>
    const items = normalizeItems(rec.items)
    if (items.length === 0) continue   // a request with no items is not a request
    out.push({
      vendor_raw: str(rec.vendor_raw),
      sourcing_intent: rec.sourcing_intent === 'direct' ? 'direct' : rec.sourcing_intent === 'rfq' ? 'rfq' : null,
      site_raw: str(rec.site_raw),
      items,
      title: str(rec.title) ?? titleFor(items),   // deterministic fallback if the LLM didn't name it
    })
  }
  return out
}

function normalizeItems(raw: unknown): ProcItem[] {
  const arr = Array.isArray(raw) ? raw : []
  const out: ProcItem[] = []
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i]
    if (!it || typeof it !== 'object') continue
    const r = it as Record<string, unknown>
    const name = str(r.item_name)
    if (!name) continue
    out.push({ item_name: name, quantity: num(r.quantity), unit: str(r.unit), note: str(r.note) })
  }
  return out
}

/** "cement, steel + 6 more" — the deterministic title fallback for 3+ items. */
export function titleFor(items: ProcItem[]): string | null {
  if (items.length <= 2) return null
  const head = items.slice(0, 2).map((i) => i.item_name).join(', ')
  return `${head} + ${items.length - 2} more`
}

/** "Slab materials · 8 items" — the count is ALWAYS kept (never lost behind a title). */
export function titleWithCount(req: ProcRequest): string {
  const n = req.items.length
  if (n <= 2) return req.items.map((i) => i.item_name).join(', ')
  const base = req.title ?? titleFor(req.items) ?? `${n} items`
  return `${base} · ${n} items`
}

// ── small coercers ──────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') { const n = parseFloat(v.replace(/[^\d.]/g, '')); return isFinite(n) ? n : null }
  return null
}

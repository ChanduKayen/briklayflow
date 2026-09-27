// ─────────────────────────────────────────────────────────────────────────────
// inventory-resolve — turn raw bill lines into inventory identities (model B, Step 2).
//
// Per line, in order:
//   [1] CHEAP MATCH  — inventory_match (trgm over the org's items + aliases). No LLM.
//                      Decisive top ≥ AUTO ⇒ 'mapped'.
//   [2] CANONICALIZE — a lean single-call LLM over all cheap-misses at once: raw name
//                      + spec + vendor hint ⇒ { item, variant, dimension, grade, unit,
//                      category }. Keeps the vendor's words, no enrichment, no web lookup.
//   [3] MATCH        — inventory_match on the canonical item; a decisive trgm winner maps
//                      directly, otherwise the DECIDER (rerank) picks. Confident ⇒ 'mapped',
//                      ambiguous ⇒ 'needs_confirm', nothing ⇒ 'create_suggested'.
//
// It only RESOLVES. The client commits (auto for 'mapped', on confirm otherwise) via the
// commit_bill_line RPC. Runs as the caller (JWT forwarded) so inventory_match sees the org.
//
// DECIDER SEAM: rerank() is the one decision point. Today it's OpenAI; TypeSafe AI's Jev
// (a choice/confidence decision model, ~400x cheaper) drops in here behind INVENTORY_DECIDER
// with zero change elsewhere. See rerankOpenAI / rerankJev below.
// ─────────────────────────────────────────────────────────────────────────────
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })

// Same thresholds the SKU pipeline trusts (see src/lib/skuThresholds.ts).
const AUTO   = 0.82   // decisive similarity that auto-maps
const MARGIN = 0.12   // gap over the runner-up that counts as "decisive"
const FLOOR  = 0.25   // below this, don't even offer as a candidate

const CANON_MODEL  = Deno.env.get('INVENTORY_CANON_MODEL')  ?? 'gpt-4.1'
const RERANK_MODEL = Deno.env.get('INVENTORY_RERANK_MODEL') ?? 'gpt-4.1-mini'
const DECIDER      = (Deno.env.get('INVENTORY_DECIDER') ?? 'openai').toLowerCase()

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface Line { line_index: number; raw_name: string; spec?: string | null; unit?: string | null; qty?: number | null; rate?: number | null }
interface Canonical { item: string; variant: string | null; dimension: string | null; grade: string | null; unit: string | null; category: string | null }
interface Candidate { inventory_id: string; display_name: string | null; item: string; variant: string | null; dimension: string | null; grade: string | null; category: string | null; unit: string | null; similarity: number }
interface Resolution {
  line_index: number
  status: 'mapped' | 'needs_confirm' | 'create_suggested'
  inventory_id?: string
  confidence: number
  source: 'cheap_trgm' | 'trgm' | 'llm_rerank' | 'none'
  canonical?: Canonical
  candidates?: { inventory_id: string; display_name: string | null; confidence: number }[]
}

// deno-lint-ignore no-explicit-any
type SB = any

const decisive = (c: Candidate[]) => c.length > 0 && c[0].similarity >= AUTO && (c.length < 2 || (c[0].similarity - c[1].similarity) >= MARGIN)
const asCandidateOut = (c: Candidate[]) => c.filter(x => x.similarity >= FLOOR).slice(0, 5).map(x => ({ inventory_id: x.inventory_id, display_name: x.display_name ?? x.item, confidence: Math.round(x.similarity * 100) }))

async function inventoryMatch(sb: SB, orgId: string, term: string, category?: string | null): Promise<Candidate[]> {
  if (!term || !term.trim()) return []
  const { data, error } = await sb.rpc('inventory_match', { p_org_id: orgId, p_search_term: term, p_category: category ?? null, p_limit: 6 })
  if (error) { console.error('inventory_match error:', error.message); return [] }
  return (data ?? []) as Candidate[]
}

// A reasoning model (gpt-5 / o-series) rejects temperature and needs a generous completion cap.
function runChat(model: string, messages: unknown[], cap: number) {
  const isReasoning = /^(gpt-5|o\d)/i.test(model)
  // deno-lint-ignore no-explicit-any
  const p: any = { model, messages }
  if (isReasoning) p.max_completion_tokens = Math.max(cap, 8000)
  else { p.max_tokens = cap; p.temperature = 0 }
  return openai.chat.completions.create(p)
}

function parseJson<T>(raw: string, fallback: T): T {
  const cleaned = (raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try { return JSON.parse(cleaned) as T } catch { return fallback }
}

// ── [2] Canonicalize ALL cheap-misses in one call ───────────────────────────────
async function canonicalizeBatch(lines: Line[], vendorCategory?: string | null): Promise<Record<number, Canonical>> {
  if (lines.length === 0) return {}
  const sys = `You canonicalize construction-material line items from Indian sites into structured buckets.
Expand obvious shorthand/phonetic spellings into the standard trade name — but keep it CLOSE to the vendor's own words. Do NOT enrich, do NOT invent specs, do NOT look anything up, do NOT add a textbook definition. If a bucket is not written, use null.

For each item return:
- item: the generic material name only (no size, no grade, no unit, no brand). e.g. "Cement", "TMT Bar", "CPVC Pipe".
- dimension: SIZE only — 12mm, 8x4, 1/2 inch, 110mm — or null.
- variant: material / colour / type — White, SS, Long body, 3 phase — or null.
- grade: grade / class / schedule — Fe500, OPC 53, SCH40, Class B — or null.
- unit: normalized unit (Bag, kg, MT, Nos, Mtr, Sqft, Cft, Ltr, Unit, Trip...) or null. Never infer a unit the line doesn't state.
- category: one broad family — Cement, Steel, Sand, Aggregate, Brick, Block, Paint, Tile, Plumbing, Electrical, Hardware, Plywood, Waterproofing, Glass, Other.
Strip brand names from every bucket (Ultratech, Finolex, Asian Paints, Fevicol...). A size fused to mm/inch/x is a dimension, never a quantity.${vendorCategory ? `\nVendor type hint (soft, do not force it): "${vendorCategory}".` : ''}

Return ONLY a JSON array, one object per input, each with "i" (the input's i) plus item/variant/dimension/grade/unit/category. No markdown, JSON null not "null".`
  const payload = lines.map((l, i) => ({ i, name: l.raw_name, spec: l.spec ?? null, unit: l.unit ?? null }))
  const resp = await runChat(CANON_MODEL, [
    { role: 'system', content: sys },
    { role: 'user', content: JSON.stringify(payload) },
  ], 3000)
  const arr = parseJson<Array<Canonical & { i: number }>>(resp.choices[0]?.message?.content ?? '[]', [])
  const out: Record<number, Canonical> = {}
  for (let k = 0; k < lines.length; k++) {
    const c = arr.find(a => a?.i === k) ?? arr[k]
    out[lines[k].line_index] = {
      item:      (c?.item ?? lines[k].raw_name ?? '').toString().trim() || lines[k].raw_name,
      variant:   c?.variant ?? null,
      dimension: c?.dimension ?? null,
      grade:     c?.grade ?? null,
      unit:      c?.unit ?? lines[k].unit ?? null,
      category:  c?.category ?? null,
    }
  }
  return out
}

// ── [3] DECIDER — pick the one candidate that is the SAME material ───────────────
interface Pick { inventory_id: string | null; confidence: number }

async function rerankOpenAI(line: Line, canon: Canonical, cands: Candidate[]): Promise<Pick> {
  const list = cands.map((c, i) => `${i + 1}. id=${c.inventory_id} | ${c.display_name ?? c.item} | unit ${c.unit ?? '-'} | trgm ${Math.round(c.similarity * 100)}%`).join('\n')
  const prompt = `Which inventory item is the SAME construction material as the line below? Match by meaning; a different size/grade/type is NOT the same item.

Line: "${line.raw_name}"${line.spec ? ` (spec: ${line.spec})` : ''}
Canonical: item="${canon.item}"${canon.dimension ? `, dimension="${canon.dimension}"` : ''}${canon.grade ? `, grade="${canon.grade}"` : ''}${canon.variant ? `, variant="${canon.variant}"` : ''}

Candidates:
${list}

Rules: exact same material (incl. size/grade) → confidence 85-100. Right family, minor diff → 50-84. Not a real match → id null, confidence 0.
Return ONLY JSON: {"inventory_id":"<id or null>","confidence":<0-100>}`
  const resp = await runChat(RERANK_MODEL, [{ role: 'user', content: prompt }], 300)
  const r = parseJson<{ inventory_id: string | null; confidence: number }>(resp.choices[0]?.message?.content ?? '{}', { inventory_id: null, confidence: 0 })
  const valid = r.inventory_id && cands.some(c => c.inventory_id === r.inventory_id)
  return { inventory_id: valid ? r.inventory_id : null, confidence: valid ? (r.confidence ?? 0) : 0 }
}

// Placeholder for TypeSafe AI's Jev (System One 'choice' decision model). Wire when access lands;
// map candidates → choice options, read back the winning option's probability as confidence.
async function rerankJev(line: Line, canon: Canonical, cands: Candidate[]): Promise<Pick> {
  console.warn('INVENTORY_DECIDER=jev not implemented yet; using OpenAI reranker')
  return rerankOpenAI(line, canon, cands)
}

const rerank = (line: Line, canon: Canonical, cands: Candidate[]): Promise<Pick> =>
  DECIDER === 'jev' ? rerankJev(line, canon, cands) : rerankOpenAI(line, canon, cands)

// ── Orchestration ───────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })

    const body = await req.json().catch(() => ({}))
    const orgId: string = body.org_id
    const vendorCategory: string | null = body.vendor_category ?? null
    const lines: Line[] = Array.isArray(body.lines) ? body.lines : []
    if (!orgId || lines.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'org_id and lines are required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const resolutions: Resolution[] = []
    const missed: Line[] = []

    // [1] cheap match, no LLM
    for (const line of lines) {
      const cheap = await inventoryMatch(sb, orgId, line.raw_name)
      if (decisive(cheap)) {
        resolutions.push({ line_index: line.line_index, status: 'mapped', inventory_id: cheap[0].inventory_id, confidence: Math.round(cheap[0].similarity * 100), source: 'cheap_trgm', candidates: asCandidateOut(cheap) })
      } else {
        missed.push(line)
      }
    }

    // [2] one canonicalization call for everything that missed
    const canonMap = await canonicalizeBatch(missed, vendorCategory)

    // [3] match the canonical buckets; decisive trgm maps, else the decider rules
    for (const line of missed) {
      const canon = canonMap[line.line_index]
      const cands = await inventoryMatch(sb, orgId, canon.item, canon.category)
      if (cands.length === 0) {
        resolutions.push({ line_index: line.line_index, status: 'create_suggested', confidence: 0, source: 'none', canonical: canon, candidates: [] })
        continue
      }
      if (decisive(cands)) {
        resolutions.push({ line_index: line.line_index, status: 'mapped', inventory_id: cands[0].inventory_id, confidence: Math.round(cands[0].similarity * 100), source: 'trgm', canonical: canon, candidates: asCandidateOut(cands) })
        continue
      }
      const pick = await rerank(line, canon, cands)
      if (pick.inventory_id && pick.confidence >= AUTO * 100) {
        resolutions.push({ line_index: line.line_index, status: 'mapped', inventory_id: pick.inventory_id, confidence: pick.confidence, source: 'llm_rerank', canonical: canon, candidates: asCandidateOut(cands) })
      } else {
        resolutions.push({ line_index: line.line_index, status: 'needs_confirm', confidence: pick.confidence, source: 'llm_rerank', canonical: canon, candidates: asCandidateOut(cands) })
      }
    }

    resolutions.sort((a, b) => a.line_index - b.line_index)
    return new Response(JSON.stringify({ ok: true, resolutions }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('inventory-resolve error:', (e as Error).message)
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})

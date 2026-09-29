// ─────────────────────────────────────────────────────────────────────────────
// stock-triage — resolve raw arrived stock rows: clear → straight to stock, ambiguous → panel.
//
// For each un-identified stock row (from a bill receive or a no-SKU GRN):
//   · decisive match to an existing material   → adopt (attach identity)               [clear]
//   · plausible-but-not-decisive match(es)      → ENQUEUE to the panel (which one?)     [ambiguous]
//   · no match + clean read                     → create the enriched identity + adopt  [clean new]
//   · no match + unclear read                   → ENQUEUE to the panel                  [ambiguous]
//
// Canonicalization is OBSERVE-NEVER-INVENT (shared canonicalizer, incl. its `clear` flag).
// Runs as the caller (JWT forwarded) so match/create/adopt/enqueue see the org.
// ─────────────────────────────────────────────────────────────────────────────
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'
import { canonicalizeBatch } from '../_shared/canonicalizeMaterial.ts'

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
const AUTO = 0.82      // decisive: attach to the existing identity
const MARGIN = 0.12    // gap over the runner-up that makes a winner decisive
const CONTEND = 0.45   // a plausible-but-not-decisive match → ambiguous (which one?)
const CANON_MODEL = Deno.env.get('INVENTORY_CANON_MODEL') ?? 'gpt-4.1'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface RawItem { item_name: string; unit: string | null; qty?: number | null; rate?: number | null }
interface Candidate { inventory_id: string; display_name: string | null; item: string; category: string | null; unit: string | null; similarity: number }

async function inventoryMatch(sb: any, orgId: string, term: string, category?: string | null): Promise<Candidate[]> {
  if (!term || !term.trim()) return []
  const { data, error } = await sb.rpc('inventory_match', { p_org_id: orgId, p_search_term: term, p_category: category ?? null, p_limit: 6 })
  if (error) { console.error('inventory_match:', error.message); return [] }
  return (data ?? []) as Candidate[]
}
const decisive = (c: Candidate[]) => c.length > 0 && c[0].similarity >= AUTO && (c.length < 2 || (c[0].similarity - c[1].similarity) >= MARGIN)
const contender = (c: Candidate[]) => c.length > 0 && c[0].similarity >= CONTEND
const candOut = (c: Candidate[]) => c.filter((x) => x.similarity >= 0.25).slice(0, 5).map((x) => ({ inventory_id: x.inventory_id, display_name: x.display_name ?? x.item, confidence: Math.round(x.similarity * 100) }))

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const body = await req.json().catch(() => ({}))
    const orgId: string = body.org_id
    const projectId: string = body.project_id
    const source: string = body.source ?? 'grn'
    const sourceRef: string | null = body.source_ref ?? null
    const items: RawItem[] = Array.isArray(body.items) ? body.items.filter((x: any) => x?.item_name) : []
    if (!orgId || !projectId || items.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'org_id, project_id and items are required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const canon = await canonicalizeBatch(openai, CANON_MODEL, items.map((it, i) => ({ key: i, name: it.item_name, unit: it.unit })))
    const adopts: { item_name: string; unit: string | null; inventory_id: string }[] = []
    let queued = 0

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const c = canon[i]
      const cands = await inventoryMatch(sb, orgId, c.item, c.category)

      if (decisive(cands)) {
        adopts.push({ item_name: it.item_name, unit: it.unit, inventory_id: cands[0].inventory_id })
        await sb.rpc('append_inventory_alias', { p_inventory_id: cands[0].inventory_id, p_alias: it.item_name })
      } else if (contender(cands)) {
        await sb.rpc('enqueue_stock_resolution', { p_org_id: orgId, p_project_id: projectId, p_source: source, p_source_ref: sourceRef, p_raw_name: it.item_name, p_unit: it.unit, p_qty: it.qty ?? null, p_rate: it.rate ?? null, p_canonical: c, p_candidates: candOut(cands) })
        queued++
      } else if (c.clear) {
        const { data, error } = await sb.rpc('create_inventory_item', { p_org_id: orgId, p_item: c.item, p_variant: c.variant, p_dimension: c.dimension, p_grade: c.grade, p_category: c.category, p_unit: c.unit ?? it.unit, p_first_alias: it.item_name, p_sku_id: null })
        if (error) { console.error('create_inventory_item:', error.message); continue }
        if (data) adopts.push({ item_name: it.item_name, unit: it.unit, inventory_id: data as string })
      } else {
        await sb.rpc('enqueue_stock_resolution', { p_org_id: orgId, p_project_id: projectId, p_source: source, p_source_ref: sourceRef, p_raw_name: it.item_name, p_unit: it.unit, p_qty: it.qty ?? null, p_rate: it.rate ?? null, p_canonical: c, p_candidates: [] })
        queued++
      }
    }

    if (adopts.length) await sb.rpc('adopt_stock_identity', { p_org_id: orgId, p_project_id: projectId, p_map: adopts })

    return new Response(JSON.stringify({ ok: true, adopted: adopts.length, queued }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('stock-triage error:', (e as Error).message)
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})

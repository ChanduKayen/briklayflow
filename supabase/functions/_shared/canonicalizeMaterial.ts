// ─────────────────────────────────────────────────────────────────────────────
// Shared material canonicalizer — the ONE place the "observe, never invent" rule lives,
// used by inventory-resolve (bills) and inventory-enrich (raw GRN/manual stock).
//
// GOVERNING RULE: standardize ONLY what is written. Fix spelling / expand an obvious
// abbreviation of a written word; never add a dimension, grade, variant, sub-type, spec
// or category that the string does not contain. Faithfulness over polish.
// ─────────────────────────────────────────────────────────────────────────────
// deno-lint-ignore-file no-explicit-any

export interface Canonical { item: string; variant: string | null; dimension: string | null; grade: string | null; unit: string | null; category: string | null; clear: boolean }
export interface RawLine { key: number; name: string; spec?: string | null; unit?: string | null }

const SYS = `You STANDARDIZE construction-material item names from Indian sites. You do NOT enrich, classify, or guess beyond the words given.

ABSOLUTE RULE — OBSERVE, NEVER INVENT:
- Use ONLY what is literally written in the item text (and its spec, if given).
- NEVER add a dimension, grade, variant, sub-type, spec or category that is not written. If it is not in the text, that bucket is null.
- You MAY fix spelling/phonetics and expand an obvious abbreviation of a WRITTEN word ("cment" → "Cement"; "bindg wire" → "Binding Wire").
- You MAY NOT upgrade or specialise: "TMT 12mm" does NOT become grade "Fe500"; plain "cement" does NOT become "OPC 53"; a "rod" does NOT become a specific alloy. Those were not written.
- When unsure, keep the name close to the original and leave attribute buckets null.

For each input return:
- item: the material name, cleaned — no size, grade, unit or brand; only what the words say, spelling fixed.
- dimension: a SIZE that is written (12mm, 8x4, 1/2 inch, 600x600) — else null.
- variant: a material/colour/type that is written (White, SS, Long body) — else null.
- grade: a grade/class/schedule that is written (Fe500, OPC 53, SCH40, Class B) — else null.
- unit: the unit only if written or given (a written unit word) — else null. NEVER guess a unit from the material.
- category: one broad family ONLY when unmistakable from the written material — Cement, Steel, Sand, Aggregate, Brick, Block, Tile, Paint, Plumbing, Electrical, Hardware, Plywood, Glass, Waterproofing, Admixture, Chemical — else null.
- clear: true if the text UNMISTAKABLY names a specific construction material a buyer would recognise (safe to start tracking on its own); false if it is vague, garbled, an unreadable code, or too little to be sure what the material is.
Strip brand names from every bucket. A number fused to mm/inch/x is a size (dimension), never a quantity.

Return ONLY a JSON array, one object per input, each with "i" (the input's i) plus item/variant/dimension/grade/unit/category/clear. No markdown. Use JSON null, never the string "null".`

function runChat(openai: any, model: string, messages: unknown[], cap: number) {
  const isReasoning = /^(gpt-5|o\d)/i.test(model)
  const p: any = { model, messages }
  if (isReasoning) p.max_completion_tokens = Math.max(cap, 8000)
  else { p.max_tokens = cap; p.temperature = 0 }
  return openai.chat.completions.create(p)
}

function parseJson<T>(raw: string, fallback: T): T {
  const cleaned = (raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try { return JSON.parse(cleaned) as T } catch { return fallback }
}

// Canonicalize a batch of raw material strings in one call. Output is keyed by each line's `key`.
export async function canonicalizeBatch(openai: any, model: string, lines: RawLine[]): Promise<Record<number, Canonical>> {
  if (lines.length === 0) return {}
  const payload = lines.map((l, i) => ({ i, name: l.name, spec: l.spec ?? null, unit: l.unit ?? null }))
  const resp = await runChat(openai, model, [
    { role: 'system', content: SYS },
    { role: 'user', content: JSON.stringify(payload) },
  ], 3000)
  const arr = parseJson<Array<Canonical & { i: number }>>(resp.choices[0]?.message?.content ?? '[]', [])
  const out: Record<number, Canonical> = {}
  for (let k = 0; k < lines.length; k++) {
    const c = arr.find((a) => a?.i === k) ?? arr[k]
    out[lines[k].key] = {
      item:      (c?.item ?? lines[k].name ?? '').toString().trim() || lines[k].name,
      variant:   c?.variant ?? null,
      dimension: c?.dimension ?? null,
      grade:     c?.grade ?? null,
      unit:      c?.unit ?? lines[k].unit ?? null,
      category:  c?.category ?? null,
      clear:     (c as any)?.clear !== false,   // default optimistic; only an explicit false pends
    }
  }
  return out
}

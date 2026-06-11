// Run with: deno test supabase/functions/wo-stage-drafter/logic.test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { bandRange, normalizeWeights, extractMeasured, draftStages } from './logic.ts'

Deno.test('bandRange — value bands', () => {
  assertEquals(bandRange(40_000), { min: 1, max: 1 })
  assertEquals(bandRange(50_000), { min: 2, max: 3 })
  assertEquals(bandRange(199_999), { min: 2, max: 3 })
  assertEquals(bandRange(200_000), { min: 3, max: 5 })
  assertEquals(bandRange(1_000_000), { min: 3, max: 5 })
  assertEquals(bandRange(1_000_001), { min: 5, max: 7 })
  assertEquals(bandRange(null), { min: 3, max: 5 })
  assertEquals(bandRange(0), { min: 3, max: 5 })
})

Deno.test('normalizeWeights — always sums to exactly 100', () => {
  for (const w of [[25, 30, 15, 15, 15], [35, 35, 30], [1, 1, 1], [10], [0, 0, 0, 0], [3, 7]]) {
    const out = normalizeWeights(w)
    assertEquals(out.reduce((a, b) => a + b, 0), 100, `sum for ${JSON.stringify(w)}`)
    assertEquals(out.length, w.length)
    assert(out.every(x => Number.isInteger(x) && x >= 0))
  }
})

Deno.test('extractMeasured — only when qty + rate are explicit', () => {
  const m = extractMeasured('Foundation lump sum 1.8L, GF brickwork 1400 sft at 85, then plastering')
  assertEquals(m.length, 1)
  assertEquals(m[0].mode, 'measured')
  assertEquals(m[0].quantity, 1400)
  assertEquals(m[0].unit_type, 'Sqft')
  assertEquals(m[0].rate, 85)
  // No explicit qty/rate → nothing measured
  assertEquals(extractMeasured('Plastering and finishing of the second floor').length, 0)
})

Deno.test('draftStages — civil, with contract, dedupes existing', () => {
  const { stages } = draftStages({
    scope_text: 'GF brickwork 1400 sft at 85',
    trade: 'Civil / Masonry',
    contract_value: 500_000,
    existing_stage_names: ['Foundation & plinth'],
  })
  // 1 measured + weighted up to band max 5; "Foundation & plinth" excluded (already exists)
  assert(stages.length >= 3 && stages.length <= 5)
  assert(stages.some(s => s.mode === 'measured' && s.quantity === 1400))
  assert(!stages.some(s => s.name.toLowerCase() === 'foundation & plinth'))
  const weighted = stages.filter(s => s.mode === 'weighted')
  assertEquals(weighted.reduce((a, b) => a + (b.weight_pct ?? 0), 0), 100)
})

Deno.test('draftStages — no contract value defaults to band 3–5, all weighted', () => {
  const { stages } = draftStages({
    scope_text: 'General electrical work across the flat',
    trade: 'Electrical',
    contract_value: null,
    existing_stage_names: [],
  })
  assert(stages.length >= 3 && stages.length <= 5)
  assert(stages.every(s => s.mode === 'weighted'))
  assertEquals(stages.reduce((a, b) => a + (b.weight_pct ?? 0), 0), 100)
})

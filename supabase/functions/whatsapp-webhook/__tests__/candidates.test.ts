// STEP 1 — grounded candidate shortlist. Pure-path gate for the prefilter + label rendering
// (chase precedence, widen-on-empty, floor/trade narrowing, cap). No DB, no network.

import { suite, test, expect } from './harness'
import { prefilterCandidates, groundingLabels, type Candidate } from '../_siteops_candidates.ts'

let seq = 0
function mk(p: Partial<Candidate>): Candidate {
  seq++
  return {
    kind: p.kind ?? 'task', id: p.id ?? `c${seq}`, node_key: p.node_key ?? null,
    label: p.label ?? `label ${seq}`, floor: p.floor ?? null, unit: p.unit ?? null,
    tradeText: p.tradeText ?? '', chased: p.chased ?? false,
  }
}
const ids = (cs: Candidate[]) => cs.map((c) => c.id)

suite('siteops candidates — prefilter', () => {
  test('chased items rank top and are never dropped by the cap', () => {
    const chased = mk({ id: 'chase', kind: 'issue', label: 'cement short', chased: true })
    const tasks = Array.from({ length: 15 }, (_, i) => mk({ id: `t${i}`, floor: 'First', tradeText: 'plastering' }))
    const out = prefilterCandidates([...tasks, chased], null)   // no hint → no narrowing
    expect(out[0].id).toBe('chase')             // precedence
    expect(out.length).toBe(12)                 // default cap
    expect(out.filter((c) => c.chased).length).toBe(1)
  })

  test('WIDEN-ON-EMPTY: a floor signal matching nothing falls back to the full set', () => {
    const rest = [mk({ id: 'a', floor: 'Second', tradeText: 'slab' }), mk({ id: 'b', floor: 'Second', tradeText: 'column' })]
    const out = prefilterCandidates(rest, 'first floor')   // First matches neither, no trade word → widen
    expect(ids(out)).toEqual(['a', 'b'])
  })

  test('floor narrowing excludes other floors but NEVER issues/todos (floor null)', () => {
    const first = mk({ id: 'first', floor: 'First', tradeText: 'plastering' })
    const second = mk({ id: 'second', floor: 'Second', tradeText: 'plastering' })
    const issue = mk({ id: 'issue', kind: 'issue', floor: null, tradeText: 'leak' })
    const out = prefilterCandidates([first, second, issue], 'first floor')
    expect(ids(out)).toEqual(['first', 'issue'])   // Second dropped; the issue survives
  })

  test('trade narrowing keeps the matching trade, drops the unrelated one', () => {
    const slab = mk({ id: 'slab', tradeText: 'slab casting' })
    const plaster = mk({ id: 'plaster', tradeText: 'plastering' })
    const out = prefilterCandidates([slab, plaster], 'plastering done')   // plaster group matches only 'plaster'
    expect(ids(out)).toEqual(['plaster'])
  })
})

suite('siteops candidates — grounding labels', () => {
  test('tags kind and flags a chased item', () => {
    const cs = [
      mk({ kind: 'issue', label: 'cement short', chased: true }),
      mk({ kind: 'task', label: 'Second · slab' }),
    ]
    expect(groundingLabels(cs)).toEqual(['(awaiting your reply) cement short [issue]', 'Second · slab [task]'])
  })
})

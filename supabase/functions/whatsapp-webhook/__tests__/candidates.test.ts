// STEP 1 — grounded candidate shortlist. Pure-path gate for the prefilter + label rendering
// (chase precedence, widen-on-empty, floor/trade narrowing, cap). No DB, no network.

import { suite, test, expect } from './harness'
import { prefilterCandidates, groundingLabels, loadCandidates, type Candidate } from '../_siteops_candidates.ts'
import type { BatchItem } from '../_siteops_batch.ts'

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

suite('siteops candidates — loadCandidates project scope (Fix Y)', () => {
  // Minimal chainable supabase mock — every DB query resolves to no rows, so the output is exactly
  // the (scoped) chase precedence set. Each from() returns a fresh thenable chain.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // `.in` is here because loadCandidates now RE-READS the chased ids to drop any that were closed
  // in the portal since the digest went out (the stale-batch guard).
  const sb: any = { from: () => { const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, then: (r: (v: unknown) => void) => r({ data: [] }) }; return q } }
  const bi = (p: Partial<BatchItem>): BatchItem => ({
    kind: p.kind ?? 'issue', id: p.id ?? 'x', orgId: 'o', projectId: p.projectId ?? null,
    projectName: p.projectName ?? '', title: p.title ?? 'item', taskName: null, cause: null,
  })

  test('keeps only chases on the grounded project; drops cross-project and null-project chases', async () => {
    const chase = [
      bi({ id: 'here', projectId: 'P1', projectName: 'ASM Elite', title: 'cement short' }),
      bi({ id: 'other', projectId: 'P2', projectName: 'Other site', title: 'masons absent' }),
      bi({ id: 'nullp', projectId: null, title: 'call inspector', kind: 'todo' }),
    ]
    const out = await loadCandidates(sb, 'o', 'P1', chase)
    expect(out.length).toBe(1)
    expect(out[0].id).toBe('here')
    expect(out[0].chased).toBe(true)
  })

  test('a batch with no chase on this project contributes nothing (photo would route fresh)', async () => {
    const chase = [bi({ id: 'other', projectId: 'P2', projectName: 'Other site' })]
    const out = await loadCandidates(sb, 'o', 'P1', chase)
    expect(out.length).toBe(0)
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

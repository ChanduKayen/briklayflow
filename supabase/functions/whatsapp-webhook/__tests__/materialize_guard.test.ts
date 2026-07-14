// THE GENERATOR THAT RAN ON EVERY MESSAGE (latency, 2026-07-13).
//
// materializeProjectTasks called persistGraph on EVERY inbound WhatsApp message: a select, a reconcile, a
// delete, an insert, then a seq_no update per row. On a settled project every one of those is a no-op —
// the live logs read `inserted=0 retired=0` turn after turn — and the round trips are pure latency on a
// turn a supervisor is sitting through, waiting.
//
// So it is skipped when it would change nothing. THE DANGER IS SKIPPING WHEN IT WOULD: the project would
// silently stop self-healing after a library change, and — right now — the zone-collapse migration would
// never retire the old node_keys on the live project, because reconcile-on-next-turn IS that migration.
//
// So the check is EXACT, not a heuristic: persistGraph writes precisely two facts about a generated row —
// that it exists (node_key), and where it sits (seq_no). Compare exactly those. These tests pin every way
// the answer must come back FALSE, because a false negative costs one round trip and a false POSITIVE
// costs correctness.

import { suite, test, expect } from './harness'
import { graphIsMaterialized, type MaterializedRow } from '../_agents/siteops.ts'

// The rows the engine WOULD write (toPersistRows). Not a bare graph any more: a row carries its PLAN
// (`binding` — the hard predecessors), and that is the field a library change most often moves. See below.
const freshOf = (rows: [string, number, string[]?][]) =>
  rows.map(([node_key, seq_no, preds]) => ({
    node_key, seq_no,
    binding: (preds ?? []).map((k) => ({ node_key: k, nature: 'IMPOSSIBLE', reason: 'structural' })),
  }))

const GRAPH = freshOf([
  ['foundation', 1],
  ['blockwork@Ground', 2, ['foundation']],
  ['conduit@Ground/unit', 3, ['blockwork@Ground']],
])

const row = (over: Partial<MaterializedRow>): MaterializedRow => ({
  node_key: 'x', seq_no: 1, source: 'generated', ...over,
})

const bind = (...keys: string[]) => keys.map((k) => ({ node_key: k, nature: 'IMPOSSIBLE', reason: 'structural' }))
const settled: MaterializedRow[] = [
  row({ node_key: 'foundation', seq_no: 1, binding: [] }),
  row({ node_key: 'blockwork@Ground', seq_no: 2, binding: bind('foundation') }),
  row({ node_key: 'conduit@Ground/unit', seq_no: 3, binding: bind('blockwork@Ground') }),
]

suite('materialize guard — skip the reconcile ONLY when it would do nothing', () => {
  test('a settled project has nothing to reconcile — this is the whole point', () => {
    expect(graphIsMaterialized(settled, GRAPH)).toBe(true)
  })

  test('a project with no tasks at all is NOT materialised — the first turn must generate them', () => {
    expect(graphIsMaterialized([], GRAPH)).toBe(false)
  })

  test('a MISSING row means work to do', () => {
    expect(graphIsMaterialized(settled.slice(0, 2), GRAPH)).toBe(false)
  })

  test('an EXTRA generated row means work to do — a retired task must still be retired', () => {
    // THE ZONE-COLLAPSE MIGRATION IS EXACTLY THIS SHAPE: the old per-room keys are still in the table and
    // are no longer in the graph. If this returned true they would never be retired, and the desk would
    // go on showing duplicate tasks forever.
    const withStale = [...settled, row({ node_key: 'conduit@Ground#Ground-unit-wet', seq_no: 4 })]
    expect(graphIsMaterialized(withStale, GRAPH)).toBe(false)
  })

  test('a RE-ORDERED topo means work to do — same rows, different places', () => {
    const reordered = [
      row({ node_key: 'foundation', seq_no: 1 }),
      row({ node_key: 'blockwork@Ground', seq_no: 3 }),      // a library change moved the order
      row({ node_key: 'conduit@Ground/unit', seq_no: 2 }),
    ]
    expect(graphIsMaterialized(reordered, GRAPH)).toBe(false)
  })

  test('a RENAMED key means work to do — the count matches, the identity does not', () => {
    const renamed = [
      row({ node_key: 'foundation', seq_no: 1 }),
      row({ node_key: 'blockwork@Ground', seq_no: 2 }),
      row({ node_key: 'conduit@Ground#dry', seq_no: 3 }),    // the old key scheme: same count, same seq
    ]
    expect(graphIsMaterialized(renamed, GRAPH)).toBe(false)
  })

  test('MANUAL rows are ignored — a hand-added task is not a reason to re-reconcile forever', () => {
    // reconcile never deletes or re-sequences a manual row, so one can never make persistGraph do work.
    // Counting it here would make every project holding a single hand-typed task pay the full reconcile
    // on EVERY message, for the rest of its life.
    const withManual = [...settled, row({ node_key: 'user_solar', seq_no: 99, source: 'manual' })]
    expect(graphIsMaterialized(withManual, GRAPH)).toBe(true)
  })

  test('a legacy row with NO node_key is ignored — it has no engine identity to compare', () => {
    const withLegacy = [...settled, row({ node_key: null, seq_no: 50, source: 'generated' })]
    expect(graphIsMaterialized(withLegacy, GRAPH)).toBe(true)
  })

  test('a row with no seq_no is not counted — an unplaced row is work to do', () => {
    const halfWritten = [
      row({ node_key: 'foundation', seq_no: 1 }),
      row({ node_key: 'blockwork@Ground', seq_no: 2 }),
      row({ node_key: 'conduit@Ground/unit', seq_no: null }),
    ]
    expect(graphIsMaterialized(halfWritten, GRAPH)).toBe(false)
  })
})

// ── THE PLAN IS PART OF THE ROW (2026-07-13) ─────────────────────────────────────────────────────────────
// Fifteen task types were corrected so they could no longer start on bare ground — the façade before the
// frame, waterproofing before the rooms, handover before the building. For most of them the fix changes a
// DEPENDENCY and nothing else: same key, same place in the order, different predecessors.
//
// This guard used to compare only (node_key → seq_no). Such a change was therefore "unchanged": the
// reconcile was skipped, `binding` was never refreshed, and the desk — which reads binding[0] to decide
// whether a task can start — would have gone on saying "Ready — can start now" for the façade of a building
// with no columns, on every project that already existed. Forever. The fix, invisible where a human looks.
suite('materialize guard — a changed PLAN is a changed row', () => {
  const bindOf = (...keys: string[]) => keys.map((k) => ({ node_key: k, nature: 'IMPOSSIBLE', reason: 'structural' }))

  test('the library gave a task a predecessor it did not have → NOT materialised, reconcile must run', () => {
    // the DB says the façade needs nothing (the old library); the engine now says it needs the frame
    const stale: MaterializedRow[] = [
      row({ node_key: 'foundation', seq_no: 1, binding: [] }),
      row({ node_key: 'blockwork@Ground', seq_no: 2, binding: [] }),          // ← the drift, and only this
      row({ node_key: 'conduit@Ground/unit', seq_no: 3, binding: bindOf('blockwork@Ground') }),
    ]
    expect(graphIsMaterialized(stale, GRAPH)).toBe(false)
  })

  test('the same dependencies in a different ORDER are the same dependencies — no pointless rewrite', () => {
    const fresh = freshOf([['a', 1], ['b', 2, ['a', 'x']]])
    const rows: MaterializedRow[] = [
      row({ node_key: 'a', seq_no: 1, binding: [] }),
      row({ node_key: 'b', seq_no: 2, binding: bindOf('x', 'a') }),           // same set, reversed
    ]
    expect(graphIsMaterialized(rows, fresh)).toBe(true)
  })

  test('binding NOT selected → judge only what we were given (never a false "stale" on a partial read)', () => {
    const rows: MaterializedRow[] = [
      row({ node_key: 'a', seq_no: 1 }),   // no `binding` key at all
      row({ node_key: 'b', seq_no: 2 }),
    ]
    expect(graphIsMaterialized(rows, freshOf([['a', 1], ['b', 2, ['a']]]))).toBe(true)
  })
})

// THE PLAN CHANGED AND THE ROWS DID NOT (2026-07-13).
//
// `binding` is a row's hard predecessors, persisted onto the row at INSERT. It is not decoration: it is the
// only thing the desk reads to decide whether a task can start —
//
//     fromDb.ts:547   const after = predKey ? ctx.refByNodeKey.get(predKey) : null
//     derive.ts:79    if (!t.after) return { cls: 'ready', text: 'Ready — can start now' }
//
// …so a row with an empty `binding` reads as READY, forever, whatever the library says.
//
// We had just corrected fifteen task types that could start on bare ground (plan_truth.test) — the façade
// before the frame, waterproofing before the rooms, handover before the building. And it would have changed
// NOTHING for any project that already existed, because reconcile updates `seq_no` and nothing else. Every
// existing row would have kept `binding = []` and gone on saying "Ready — can start now" for the façade of a
// building with no columns. The fix would have been invisible in the one place a human looks.
//
// A row's ENGINE-AUTHORED fields are not a snapshot of what the library said the day the row was born. They
// are a projection of what it says NOW. The library is code; the rows are a cache of it; and a cache that is
// never invalidated is the bug we have spent this whole day paying for, in its fourth costume.
//
// So reconcile refreshes them. NOT the human's fields — status, owner, a hand-dragged seq_no, a manual row —
// which it has never touched and still does not. Only the ones the engine owns, and only when they differ.

import { suite, test, expect } from './harness'
import { reconcile, toPersistRows, type ExistingRow, type PersistRow } from '../persist'
import { instantiate, stackToGeometry } from '../instantiate'

const STACK = {
  levels: [
    { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
    { label: 'First', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
  ],
}
const fresh = (): PersistRow[] =>
  toPersistRows(instantiate(stackToGeometry(STACK, {})), { project_id: 'p1', org_id: 'o1' })

/** The project as the DB holds it: every row present and correctly sequenced, but authored by the OLD
 *  library — so its dependencies (`binding`) are whatever they were the day it was generated. */
const asPersisted = (rows: PersistRow[], mutate: (r: ExistingRow, i: number) => void = () => {}): ExistingRow[] =>
  rows.map((r, i) => {
    const e: ExistingRow = {
      task_id: `t${i}`, node_key: r.node_key, source: 'generated', order_source: 'auto', seq_no: r.seq_no,
      binding: r.binding, name: r.name, trade: r.trade, phase: r.phase, trade_phase: r.trade_phase, system: r.system,
    }
    mutate(e, i)
    return e
  })

const facade = (rows: PersistRow[]) => rows.find((r) => r.task_type_id === 'external_structure')!

suite('the rows track the library (binding refresh)', () => {
  test('(B1) a row whose dependencies the library changed is REFRESHED, not left stale', () => {
    const f = fresh()
    // the row as the OLD library wrote it: the façade, with no predecessor at all — "Ready — can start now"
    const existing = asPersisted(f, (e) => { if (e.node_key === facade(f).node_key) e.binding = [] })

    const plan = reconcile(existing, f)

    const refreshed = plan.toRefresh.find((u) => u.task_id === existing.find((e) => e.node_key === facade(f).node_key)!.task_id)
    expect(!!refreshed).toBe(true)
    // …and it now carries the real gate: the frame must be poured first
    const binding = (refreshed!.patch.binding ?? []) as { task_type_id: string }[]
    expect(binding.some((b) => b.task_type_id === 'floor_pour')).toBe(true)
  })

  test('(B2) a row the library did NOT change is left alone — no write, no churn', () => {
    const f = fresh()
    const plan = reconcile(asPersisted(f), f)   // the DB already agrees with the library, exactly
    expect(plan.toRefresh).toEqual([])
    expect(plan.toUpdateSeq).toEqual([])
    expect(plan.toInsert).toEqual([])
    expect(plan.toDeleteIds).toEqual([])
  })

  test('(B3) a MANUAL row is never refreshed — the engine does not own a human’s task', () => {
    const f = fresh()
    const existing = asPersisted(f, (e) => { e.source = 'manual'; e.binding = [] })
    const plan = reconcile(existing, f)
    expect(plan.toRefresh).toEqual([])
  })

  // The engine owns the row's IDENTITY and its PLAN. It does not own the human's state — and a refresh that
  // quietly reset a status or an assignee would be a far worse bug than the one it fixes.
  test('(B4) the refresh carries ONLY engine-authored fields — never status, owner or task_no', () => {
    const f = fresh()
    const existing = asPersisted(f, (e) => { e.binding = [] })
    const plan = reconcile(existing, f)
    expect(plan.toRefresh.length > 0).toBe(true)
    const ENGINE_OWNED = new Set(['binding', 'name', 'trade', 'phase', 'trade_phase', 'system'])
    for (const u of plan.toRefresh)
      for (const k of Object.keys(u.patch))
        if (!ENGINE_OWNED.has(k)) throw new Error(`refresh would overwrite a field the engine does not own: ${k}`)
  })
})

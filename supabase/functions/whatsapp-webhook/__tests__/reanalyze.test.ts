// STEP 3 (2/2) — JOURNEY TESTS for the re-analyse/harvest core. Table-driven: given a pending
// followup_events marker (description_added / possible_photo_followup) + the object's current state +
// the distilled enrichment signal, assert the harvest terminal — merge which fields, or skip (clear
// only). Conservative discipline is the point: fill-if-empty, never overwrite, never auto-resolve. PURE.

import { suite, test, expect } from './harness'
import {
  decideHarvest, distillSignal, planEnrichmentMerge,
  type PendingEvent, type HarvestObject,
} from '../_siteops_reanalyze.ts'
import type { SiteItem } from '../_siteops_extract.ts'

const NOW = new Date('2026-07-02T09:00:00.000Z')   // fixed — parseWhen is pure given a base

function ev(p: Partial<PendingEvent>): PendingEvent {
  return { id: p.id ?? 'e1', type: p.type ?? 'description_added', parent: p.parent ?? { kind: 'issue', id: 'p1' }, body: p.body ?? '' }
}
function obj(p: Partial<HarvestObject>): HarvestObject {
  return { kind: p.kind ?? 'issue', title: p.title ?? '', cause: p.cause ?? null, deadline: p.deadline ?? null }
}
function si(p: Partial<SiteItem>): SiteItem {
  return {
    type: p.type ?? 'issue', text: p.text ?? '', task_hint: null, qc_statements: [],
    cause: p.cause ?? null, cause_reason: null, owner_hint: null, date_hint: p.date_hint ?? null, project_hint: null,
  }
}

suite('siteops reanalyze — decideHarvest', () => {
  test('description_added always merges (it was an in-window RELATED follow-up)', () => {
    expect(decideHarvest(ev({ type: 'description_added', body: 'anything at all' }), obj({ title: 'cement short' })).action).toBe('merge')
  })

  test('possible_photo_followup that RE-CHECKS related (trade overlap) → merge (the reunion)', () => {
    const d = decideHarvest(ev({ type: 'possible_photo_followup', body: 'the masonry wall is cracked' }), obj({ title: 'brickwork crack on 2F' }))
    expect(d.action).toBe('merge')       // brick ≡ masonry trade group
  })

  test('possible_photo_followup with no overlap → skip (it was correctly routed fresh)', () => {
    const d = decideHarvest(ev({ type: 'possible_photo_followup', body: 'send 50 bags cement to the gate' }), obj({ title: 'lift inspection pending' }))
    expect(d.action).toBe('skip')
  })
})

suite('siteops reanalyze — distillSignal', () => {
  test('picks the first REAL issue cause, ignoring progress and an "other" cause', () => {
    const items = [si({ type: 'progress', text: 'wall built' }), si({ type: 'issue', cause: 'other' }), si({ type: 'issue', cause: 'material' })]
    expect(distillSignal(items)).toEqual({ cause: 'material', date_hint: null })
  })

  test('lifts the first date hint from any item', () => {
    expect(distillSignal([si({ type: 'progress', date_hint: 'friday' })])).toEqual({ cause: null, date_hint: 'friday' })
  })

  test('empty decomposition → empty signal', () => {
    expect(distillSignal([])).toEqual({ cause: null, date_hint: null })
  })
})

suite('siteops reanalyze — planEnrichmentMerge (conservative)', () => {
  test('fills a missing cause on an issue', () => {
    const p = planEnrichmentMerge(obj({ kind: 'issue', cause: 'other' }), { cause: 'labour', date_hint: null }, NOW)
    expect(p.updates).toEqual({ cause: 'labour' })
    expect(p.changed).toBe(true)
  })

  test('NEVER overwrites an existing real cause', () => {
    const p = planEnrichmentMerge(obj({ kind: 'issue', cause: 'material' }), { cause: 'labour', date_hint: null }, NOW)
    expect(p.updates).toEqual({})
    expect(p.changed).toBe(false)
  })

  test('fills a missing deadline from a date hint', () => {
    const p = planEnrichmentMerge(obj({ kind: 'issue', deadline: null }), { cause: null, date_hint: 'friday' }, NOW)
    expect(p.updates).toEqual({ deadline: '2026-07-03' })   // Fri after Thu 2026-07-02
  })

  test('NEVER overwrites an existing deadline', () => {
    const p = planEnrichmentMerge(obj({ kind: 'issue', deadline: '2026-07-10' }), { cause: null, date_hint: 'tomorrow' }, NOW)
    expect(p.updates).toEqual({})
  })

  test('a todo takes a deadline (due_date) but NEVER a cause', () => {
    const p = planEnrichmentMerge(obj({ kind: 'todo', cause: null, deadline: null }), { cause: 'material', date_hint: 'tomorrow' }, NOW)
    expect(p.updates).toEqual({ deadline: '2026-07-03' })   // tomorrow; no cause on a todo
  })

  test('no signal → no change (marker just clears)', () => {
    expect(planEnrichmentMerge(obj({ kind: 'issue', cause: 'other' }), { cause: null, date_hint: null }, NOW).changed).toBe(false)
  })
})

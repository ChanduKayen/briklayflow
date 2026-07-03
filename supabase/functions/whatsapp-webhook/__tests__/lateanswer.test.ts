// STEP 5b — JOURNEY TESTS for late-answer slot reconstruction. Given a parked siteops_unplaced row,
// assert the resume slots rebuilt for answerSiteops match what the LIVE pick would have carried (so the
// late answer hits the same branch), and that an evidence-only / floor park yields null (nothing to
// re-answer). PURE.

import { suite, test, expect } from './harness'
import { reconstructParkedSlots, type ParkedRow } from '../_siteops_lateanswer.ts'

const row = (p: Partial<ParkedRow>): ParkedRow => ({
  reason: p.reason ?? 'disambig', observation: p.observation ?? null, candidates: p.candidates ?? null,
  project_id: p.project_id ?? null, object_path: p.object_path ?? null, caption: p.caption ?? null,
  narration_id: p.narration_id ?? null,
})

suite('siteops lateanswer — reconstructParkedSlots', () => {
  test('disambig → siteops_disambig slots with item + candidates', () => {
    const item = { type: 'progress', text: '2F slab poured' }
    const cands = [{ task_id: 't1', name: 'Slab', floor: 'Second', unit: null }]
    const s = reconstructParkedSlots(row({ reason: 'disambig', observation: item, candidates: cands, project_id: 'P1' }))
    expect(s?.kind).toBe('siteops_disambig')
    expect(s?.item).toEqual(item)
    expect(s?.candidates).toEqual(cands)
    expect(s?.project_id).toBe('P1')
  })

  test('typed_pick → shortlist AND full reuse the parked candidates (full-set fallback survives)', () => {
    const cands = [{ kind: 'issue', id: 'a', label: 'roof leak' }]
    const s = reconstructParkedSlots(row({ reason: 'typed_pick', observation: { type: 'issue', text: 'leak' }, candidates: cands }))
    expect(s?.kind).toBe('siteops_typed_pick')
    expect(s?.shortlist).toEqual(cands)
    expect(s?.full).toEqual(cands)
  })

  test('project → items lifted out of the {items} observation', () => {
    const items = [{ type: 'progress', text: 'a' }, { type: 'issue', text: 'b' }]
    const s = reconstructParkedSlots(row({ reason: 'project', observation: { items }, candidates: [{ id: 'P1', name: 'ASM' }] }))
    expect(s?.kind).toBe('siteops_project')
    expect(s?.items).toEqual(items)
  })

  test('parked photo evidence rebuilds the image slot', () => {
    const s = reconstructParkedSlots(row({ reason: 'typed_pick', object_path: 'rough/x.jpg', caption: 'leak' }))
    expect(s?.image).toEqual({ storagePath: 'rough/x.jpg', caption: 'leak' })
  })

  test('no photo → image slot is null', () => {
    expect(reconstructParkedSlots(row({ reason: 'disambig' }))?.image).toBeNull()
  })

  test('evidence-only / floor parks → null (nothing to re-answer)', () => {
    expect(reconstructParkedSlots(row({ reason: 'photo_pick' }))).toBeNull()
    expect(reconstructParkedSlots(row({ reason: 'batch_collision' }))).toBeNull()
    expect(reconstructParkedSlots(row({ reason: 'floor' }))).toBeNull()
  })
})

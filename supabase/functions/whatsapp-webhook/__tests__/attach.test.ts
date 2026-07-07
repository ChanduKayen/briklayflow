// STEP 3 — the TYPED-PICK resume grammar (PURE). The ATTACH-vs-OBSERVE planner (decideAttach/planPhotoItems)
// retired with the image second-engine in T5 (its tests went with it); the singular unit's ladder now
// decides a re-photo. What survives is resolveTypedPick — the resume grammar for an open place_photo /
// recovered-parked pick (numeric tap, "None — it's new", typed full-set fallback).

import { suite, test, expect } from './harness'
import { resolveTypedPick, type PickCandidate } from '../_siteops_attach.ts'

suite('siteops attach — resolveTypedPick (resume grammar)', () => {
  const shortlist: PickCandidate[] = [{ kind: 'issue', id: 'a', label: 'roof leak' }, { kind: 'todo', id: 'b', label: 'order tiles' }]
  const full: PickCandidate[] = [...shortlist, { kind: 'issue', id: 'z', label: 'plinth beam crack' }]

  test('numeric tap → attach that shortlist item', () => {
    const r = resolveTypedPick(shortlist, full, '1')
    expect(r.kind === 'attach' ? r.target.id : '').toBe('a')
  })

  test('the trailing "None — it\'s new" row (n+1) → observe', () => {
    expect(resolveTypedPick(shortlist, full, '3').kind).toBe('observe')
  })

  test('typed word "new" → observe', () => {
    expect(resolveTypedPick(shortlist, full, "it's new").kind).toBe('observe')
  })

  test('TYPED-ANSWER FULL-SET FALLBACK: a label off the shortlist still matches the full set', () => {
    const r = resolveTypedPick(shortlist, full, 'plinth beam')
    expect(r.kind === 'attach' ? r.target.id : '').toBe('z')       // 'z' was NOT in the shortlist
  })

  test('unrecognised reply → none (re-ask, never mis-place)', () => {
    expect(resolveTypedPick(shortlist, full, 'huh?').kind).toBe('none')
  })
})

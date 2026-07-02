// STEP 2 — association steering. Pure gate for _siteops_assoc: the decision matrix, the conservative
// lexical relatedness scorer, and the bare-affirmation detector. Includes the two paths the whole seam
// exists to protect: "send 50 bags cement" during an open window → unrelated (routes fresh, untouched),
// and "honeycombing 2nd floor" → related (enriches the photo's object).

import { suite, test, expect } from './harness'
import { decideAssociation, photoRelatedness, isBareAffirmation, type AssocInput } from '../_siteops_assoc.ts'

const d = (p: Partial<AssocInput>) => decideAssociation({
  withinHold: p.withinHold ?? true, bareAffirmation: p.bareAffirmation ?? false,
  quotedMatchesHeld: p.quotedMatchesHeld ?? false, relatedness: p.relatedness ?? 'unrelated',
})

suite('siteops association — decideAssociation', () => {
  test('expiry FIRST: an expired window routes fresh, whatever the other signals say', () => {
    expect(d({ withinHold: false, relatedness: 'related' })).toBe('unrelated')
    expect(d({ withinHold: false, quotedMatchesHeld: true })).toBe('unrelated')
  })

  test('bare affirmation within hold → noop (close clean, never a merge or a re-route)', () => {
    expect(d({ bareAffirmation: true, relatedness: 'related' })).toBe('noop')
  })

  test('quoted-reply within hold is related; positive overlap is related', () => {
    expect(d({ quotedMatchesHeld: true, relatedness: 'unrelated' })).toBe('related')
    expect(d({ relatedness: 'related' })).toBe('related')
  })

  test('within hold, no reply, no overlap (incl. uncertain) → unrelated (the fail-safe)', () => {
    expect(d({ relatedness: 'unrelated' })).toBe('unrelated')
  })
})

suite('siteops association — conservative lexical relatedness', () => {
  const PHOTO = 'Second floor slab honeycomb crack near column'

  test('a real DESCRIPTION overlaps the photo extract → related', () => {
    expect(photoRelatedness(PHOTO, 'honeycombing 2nd floor slab')).toBe('related')   // trade: slab
    expect(photoRelatedness(PHOTO, 'that crack near the column is bad')).toBe('related')   // token: crack/column
  })

  test('a genuine SEPARATE message does not overlap → unrelated (routes fresh untouched)', () => {
    expect(photoRelatedness(PHOTO, 'send 50 bags cement to the site')).toBe('unrelated')
    expect(photoRelatedness(PHOTO, 'pay Ramu 5000 for tiles')).toBe('unrelated')
  })

  test('trade SYNONYMS still count (brick ≡ block ≡ masonry)', () => {
    expect(photoRelatedness('ground floor blockwork walls', 'brick work looks uneven')).toBe('related')
  })
})

suite('siteops association — bare affirmation detector', () => {
  test('acknowledgements match (English + code-mix), real updates do not', () => {
    for (const s of ['ok', 'okay', 'done', 'haan', 'sari', '👍', 'yes', 'noted', 'thanks']) expect(isBareAffirmation(s)).toBe(true)
    for (const s of ['honeycombing', 'slab done 2nd floor', 'crack near column', 'send cement']) expect(isBareAffirmation(s)).toBe(false)
  })
})

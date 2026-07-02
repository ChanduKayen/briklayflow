// STEP 2 — association decision matrix. Pure gate for _siteops_assoc.decideAssociation.

import { suite, test, expect } from './harness'
import { decideAssociation, type Relatedness } from '../_siteops_assoc.ts'

const d = (quotedMatchesHeld: boolean, withinHold: boolean, relatedness: Relatedness) =>
  decideAssociation({ quotedMatchesHeld, withinHold, relatedness })

suite('siteops association — decideAssociation', () => {
  test('quoted-reply is PRIMARY: related even after the hold lapsed, whatever the extract says', () => {
    expect(d(true, false, 'unrelated')).toBe('related')
    expect(d(true, false, 'unknown')).toBe('related')
    expect(d(true, true, 'unrelated')).toBe('related')
  })

  test('no reply + hold lapsed → unrelated (never reach back into an item they did not point at)', () => {
    expect(d(false, false, 'related')).toBe('unrelated')
    expect(d(false, false, 'unknown')).toBe('unrelated')
  })

  test('within hold: a confident extract read is trusted either way', () => {
    expect(d(false, true, 'related')).toBe('related')
    expect(d(false, true, 'unrelated')).toBe('unrelated')
  })

  test('within hold but the extract cannot tell → ASK (one cheap question, not a wrong merge)', () => {
    expect(d(false, true, 'unknown')).toBe('ask')
  })
})

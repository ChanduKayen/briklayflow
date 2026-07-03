// STEP 5 — JOURNEY TESTS for the readback verbs. classifyReaction (emoji → confirm/retract/neutral)
// and isRetraction (unambiguous undo phrases only). The conservatism is the point: a reaction must never
// error out, and a retraction must never fire on a normal defect note that happens to say "wrong". PURE.

import { suite, test, expect } from './harness'
import { classifyReaction, isRetraction } from '../_siteops_verbs.ts'

suite('siteops verbs — classifyReaction', () => {
  test('positive emojis → confirm', () => {
    for (const e of ['👍', '✅', '🙏', '👌', '💯']) expect(classifyReaction(e)).toBe('confirm')
  })
  test('negative emojis → retract', () => {
    for (const e of ['👎', '❌', '🚫']) expect(classifyReaction(e)).toBe('retract')
  })
  test('a removed reaction (empty) or an unknown emoji → neutral (ignored, never "unsupported")', () => {
    expect(classifyReaction('')).toBe('neutral')
    expect(classifyReaction('🤔')).toBe('neutral')
  })
})

suite('siteops verbs — isRetraction', () => {
  test('explicit retraction phrases → true', () => {
    for (const t of ['ignore that', 'wrong photo', 'delete that', 'remove it', 'scratch that', 'nevermind', 'my mistake', 'wrong entry']) {
      expect(isRetraction(t)).toBe(true)
    }
  })
  test('a normal defect note that merely contains "wrong" → false (not a retraction)', () => {
    expect(isRetraction('wrong level on the 2nd floor slab')).toBe(false)
    expect(isRetraction('the concrete mix is wrong')).toBe(false)
  })
  test('a real instruction with delete/cancel but no that/it → false', () => {
    expect(isRetraction('cancel the cement order')).toBe(false)
    expect(isRetraction('remove the debris from the site')).toBe(false)
  })
  test('a plain update → false', () => {
    expect(isRetraction('2nd floor slab poured, cement short')).toBe(false)
  })
})

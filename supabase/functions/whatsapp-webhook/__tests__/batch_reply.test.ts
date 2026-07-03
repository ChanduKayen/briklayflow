// TEXT-PATH CHARACTERIZATION GATE — the payment-gate treatment for chase-batch reply routing, the path
// that ate a real blocker in prod. classifyReplyFragment is the pivot: it decides whether a message that
// arrives while a chase is open ANSWERS the chase, COLLIDES, or is a NEW OBSERVATION that must route
// fresh (leftover) — never be consumed empty. The governing principle: chase precedence is a PRIOR, not
// a LOCK; no message is ever eaten.

import { suite, test, expect } from './harness'
import { classifyReplyFragment, scopeBatchToProject, isBareAck, type BatchItem } from '../_siteops_batch.ts'

let seq = 0
const item = (p: Partial<BatchItem>): BatchItem => {
  seq++
  return {
    kind: p.kind ?? 'issue', id: p.id ?? `i${seq}`, orgId: 'o', projectId: p.projectId ?? 'P1',
    projectName: p.projectName ?? 'Site', title: p.title ?? `item ${seq}`, taskName: p.taskName ?? null, cause: p.cause ?? null,
  }
}

suite('siteops batch-reply — classifyReplyFragment (no message eaten)', () => {
  // (a) THE REGRESSION: a fresh substantive observation ("tiles broken, blocking work") arrives while an
  //     UNRELATED single-item chase (waterlogging) is open. It must NOT be force-matched to the chase —
  //     it must route fresh (leftover) so the blocker gets created and the chase is left untouched.
  //     FIX 1: the observation is NOT force-matched — it routes fresh (leftover), the blocker gets
  //     created, and the waterlogging chase is left untouched. The eat is now permanently unshippable.
  test('(a) fresh observation + unrelated single-item batch → leftover (routes fresh, chase untouched)', () => {
    const batch = [item({ id: 'water', title: 'waterlogging in basement', cause: 'weather' })]
    const tiles = { text: 'tiles broken on first floor, blocking all work', task_hint: 'first floor' }
    const v = classifyReplyFragment(tiles, batch, { singleFragment: true, hasObservation: true })
    expect(v.kind).toBe('leftover')
  })

  // (b) THE LEGITIMATE SHORTCUT: a terse non-English ack ("sari" = ok) decomposes to NOTHING
  //     (hasObservation:false) → it IS a chase answer → force-match the lone open item.
  test('(b) terse ack ("sari") + lone chase → match (force-match the one open item)', () => {
    const batch = [item({ id: 'water', title: 'waterlogging in basement' })]
    const v = classifyReplyFragment({ text: 'sari' }, batch, { singleFragment: true, hasObservation: false })
    expect(v).toEqual({ kind: 'match', index: 0 })
  })

  // (c) a multi-fragment reply whose pieces match NOTHING in the batch is never consumed empty — each
  //     non-matching fragment is a leftover (routed fresh), not silently absorbed.
  test('(c) non-matching multi-fragment reply → leftover per piece (never consumed empty)', () => {
    const batch = [item({ id: 'water', title: 'waterlogging' }), item({ id: 'cement', title: 'cement short' })]
    const v = classifyReplyFragment({ text: 'scaffolding delivered to 3rd floor' }, batch, { singleFragment: false, hasObservation: true })
    expect(v.kind).toBe('leftover')
  })

  // A genuine chase answer that shares the chase's subject still matches by CONTENT (the shortcut isn't
  // the only way in) — proves Fix 1 doesn't over-correct into never matching.
  test('content match still works: "waterlogging cleared" → matches the waterlogging chase', () => {
    const batch = [item({ id: 'water', title: 'waterlogging in basement' }), item({ id: 'cement', title: 'cement short' })]
    const v = classifyReplyFragment({ text: 'waterlogging cleared now' }, batch, { singleFragment: true, hasObservation: true })
    expect(v).toEqual({ kind: 'match', index: 0 })
  })
})

suite('siteops batch-reply — isBareAck (cardinality fast-path guard, conservative)', () => {
  // engagement acks (with optional honorific / punctuation / emoji) → true
  test('recognised bare acks → true', () => {
    for (const t of ['sari', 'ok', 'OK', 'okay', 'haan', 'ha', 'thik', 'ji', 'sari sir', 'ok ji', 'noted', '👍', 'ok 👍', '🙏', 'sari.']) {
      expect(isBareAck(t)).toBe(true)
    }
  })
  // anything with content, a second clause, or a CLOSURE word → false (goes to the model; RESOLVE stays
  // behind closure_explicit). Closure words are deliberately NOT acks.
  test('content / closure words / multi-clause → false (to the model)', () => {
    for (const t of ['cement short', 'sari tiles broke', 'done', 'sorted', 'cleared', 'waterlogging resolved', 'ok cement short tomorrow', '']) {
      expect(isBareAck(t)).toBe(false)
    }
  })
})

suite('siteops batch-reply — scopeBatchToProject (Fix 2, the ASM Elite matrix)', () => {
  const batch = [item({ id: 'a', projectId: 'Y', projectName: 'Aiswarya' }), item({ id: 'b', projectId: 'Y', projectName: 'Aiswarya' }), item({ id: 'c', projectId: 'Z', projectName: 'Other' })]

  test('captioned message for a CHASE-FREE project X (Y & Z have chases) → routeFresh', () => {
    const r = scopeBatchToProject(batch, 'X')
    expect(r.scoped).toEqual([])
    expect(r.routeFresh).toBe(true)   // not a chase reply → runSiteops routes it fresh
  })

  test('message resolving to project Y → matches WITHIN Y only (no cross-project collision)', () => {
    const r = scopeBatchToProject(batch, 'Y')
    expect(r.scoped.map((i) => i.id)).toEqual(['a', 'b'])
    expect(r.routeFresh).toBe(false)
  })

  test('no project signal (uncaptioned / unnamed) → whole batch, honest ambiguous', () => {
    const r = scopeBatchToProject(batch, null)
    expect(r.scoped.length).toBe(3)
    expect(r.routeFresh).toBe(false)
  })
})

// "WHICH SRINU?" — SRINU, SURIBABU, RAJU.
//
// Live, 2026-07-17. The band was right (Srinu scores 0.70 — a real near-match, correctly too weak for the
// 0.95 payee-auto band, so it asks). The LIST was nonsense. Suribabu and Raju are not Srinus. They are not
// near-Srinus. They are rows 2 and 3 of a `.slice(0, 3)`:
//
//     scoreName('sreenu', …)  →  Srinu 0.700 | Suribabu 0.375 | Raju 0.333 | Ramesh 0.167 | Lakshmi 0.000
//     closest = scored.slice(0, 3)           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ both far below TXN_CONFIRM (0.60)
//
// `closest` is a blind top-3 with no floor. In an org with three stakeholders, ALL THREE are always
// "closest", whatever the query. Ask about a man who does not exist and it offers you the entire company.
//
// THE HALF-FIX THIS FINISHES. _agents/reporting.ts already carries the diagnosis, in as many words:
//
//     "THE BAND DECIDES, NOT `closest.length`. matchPayee ALWAYS returns the top 3 as `closest`, however bad
//      they score … asked 'Which *Zzzz Qqqq* do you mean?' over three unrelated people."
//
// That fixed the BRANCH — an unknown name now reaches mPayeeUnknown instead of picking from noise. It did
// not fix the LIST, so the moment the band IS 'confirm', the same three unrelated people come back. The
// author saw the bug, named it exactly, and repaired the half that was reachable from where they stood.
//
// The site pick, two functions further down _messages.ts, already knows the rule: "Only ever built from
// projects that exist — no 'nearest' filler." A payee pick deserves the same: every row is a candidate the
// matcher would actually stand behind, or it is not a row.
//
// WHY NOT JUST FLOOR `closest` AT TXN_CONFIRM: transaction.ts's Day Book "did you mean…" suggestion reads
// closest[0] under its OWN, LOWER floor (TXN_SUGGEST_FLOOR 0.45). A 0.50 match is too weak to OFFER as a
// choice and still worth WHISPERING as a suggestion — two different questions, two different floors. So
// `closest` keeps its scores and each consumer floors for itself; `pickable()` is the pick's floor, named.

import { suite, test, expect } from './harness'
import { matchPayee, pickable } from '../_match.ts'

// The live roster, and the live query.
const ROSTER = [
  { stakeholder_id: 'S1', name: 'Srinu' },
  { stakeholder_id: 'S2', name: 'Suribabu' },
  { stakeholder_id: 'S3', name: 'Raju' },
]
const names = (l: { name: string }[]) => l.map((c) => c.name)

suite('matchPayee — a pick offers candidates, not the roster', () => {
  test('"sreenu" offers Srinu ALONE — Suribabu and Raju are not near-Srinus', () => {
    const m = matchPayee('sreenu', ROSTER)
    expect(m.band).toBe('confirm')                 // 0.70 — real, but not the 0.95 money-auto band
    expect(names(pickable(m))).toEqual(['Srinu'])
  })

  // The scores are the evidence, so they ride on the rows: a consumer that wants a different floor (the Day
  // Book suggestion does) can have one without re-scoring.
  test('closest still carries every near row, WITH its score, for other floors', () => {
    const m = matchPayee('sreenu', ROSTER)
    expect(m.closest.length > 1).toBe(true)
    expect(m.closest[0].name).toBe('Srinu')
    expect(m.closest[0].score > 0.6).toBe(true)
    expect(m.closest[1].score < 0.6).toBe(true)    // Suribabu — present, and provably not pickable
  })

  // The failure in its purest form: nobody by that name at all. The band already routes this to
  // mPayeeUnknown, but the list must be empty on its own merits — the branch is not the list's floor.
  test('a name nobody has offers NOBODY', () => {
    const m = matchPayee('zzzz qqqq', ROSTER)
    expect(m.band).toBe('open')
    expect(pickable(m)).toEqual([])
  })

  test('a three-person org does not offer all three to every query', () => {
    expect(pickable(matchPayee('lakshmi', ROSTER)).length < 3).toBe(true)
    expect(pickable(matchPayee('ramesh', ROSTER)).length < 3).toBe(true)
  })

  // A genuine ambiguity is the whole reason a pick exists — flooring must not kill it.
  test('two real Srinus BOTH survive the floor — this is what a pick is for', () => {
    const two = [
      { stakeholder_id: 'A', name: 'Srinu' },
      { stakeholder_id: 'B', name: 'Srinu Reddy' },
      { stakeholder_id: 'C', name: 'Raju' },
    ]
    const got = names(pickable(matchPayee('srinu', two)))
    expect(got.includes('Srinu')).toBe(true)
    expect(got.includes('Srinu Reddy')).toBe(true)
    expect(got.includes('Raju')).toBe(false)
  })

  // Money safety, unchanged: 0.70 is a near-match, not an identification. It must never skip the ask.
  test('a near-match never reaches the auto band — money still asks', () => {
    expect(matchPayee('sreenu', ROSTER).band).toBe('confirm')
    expect(matchPayee('srinu', ROSTER).band).toBe('auto')      // exact — this one is identification
  })
})

// ── The other consumer keeps its own, lower floor ────────────────────────────────────────────────────────
suite('matchPayee — the Day Book suggestion floor is not the pick floor', () => {
  // transaction.ts reads closest[0] at TXN_SUGGEST_FLOOR (0.45). If pickable()'s floor had been applied to
  // `closest` itself, every 0.45–0.60 "did you mean…" whisper in the Day Book would have gone silent — a
  // regression with no error, in a different feature, shipped by a fix to this one.
  test('a sub-confirm match is still readable from closest[0]', () => {
    const m = matchPayee('laxmi', [{ stakeholder_id: 'S9', name: 'Lakshmi' }])
    expect(m.band).toBe('open')            // 0.57 — too weak to offer as a choice…
    expect(pickable(m)).toEqual([])
    expect(m.closest[0]?.name).toBe('Lakshmi')   // …and still worth whispering
    expect(m.closest[0].score > 0.45).toBe(true)
  })
})

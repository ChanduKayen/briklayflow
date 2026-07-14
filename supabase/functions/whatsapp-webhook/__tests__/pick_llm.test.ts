// THE PICK ANSWER WE COULD NOT READ (live failure, 2026-07-13).
//
// We asked which task "electrical chases made for 2nd floor Unit B" was about, and offered exactly one
// option: "Plumbing — in-wall lines (chases & sleeves)". He replied, in Telugu:
//
//     "ఎలక్ట్రికల్ గార్డలు తీసాం, ప్లంబింగ్ గార్డలు కాదు."   (we did the ELECTRICAL chases, not the plumbing ones)
//
// A perfect answer. resolveTypedPick tokenizes with /[a-z0-9]{3,}/g — Latin only — so a Telugu reply yields
// ZERO tokens and can never match. It fell through as "not an answer", the whole message was re-read as a
// fresh narration, and decompose turned his negation into a NEW ISSUE: "plumbing guards not removed".
//
// So the model now reads the reply when the lexical pass gives up. These tests pin the two things that
// matter about that: it is BOUNDED (it may only name an id we offered), and it FAILS CLOSED (anything it
// cannot read becomes not_an_answer — the old behaviour — so a message can never be lost, only understood).

import { suite, test, expect } from './harness'
import { interpretPickReply } from '../_siteops_pick_llm.ts'
import type { PickCandidate } from '../_siteops_attach.ts'

const OFFERED: PickCandidate[] = [
  { kind: 'task', id: 'plumb-2b', label: 'Plumbing — in-wall lines (chases & sleeves) — Second · Unit B' },
  { kind: 'task', id: 'elec-2b', label: 'Electrical — conduiting (1st fix) — Second · Unit B' },
]

const Q = 'Which work is this about?'
const says = (body: unknown) => () => Promise.resolve(JSON.stringify(body))
const dies = () => Promise.reject(new Error('model down'))

suite('the pick reply, read by meaning', () => {
  test('THE LIVE ONE — a Telugu correction resolves to the option he actually meant', async () => {
    const r = await interpretPickReply(Q, OFFERED, 'ఎలక్ట్రికల్ గార్డలు తీసాం, ప్లంబింగ్ గార్డలు కాదు.',
      says({ verdict: 'pick', id: 'elec-2b', reason: 'rules out plumbing; the electrical one is left' }))
    expect(r.kind).toBe('pick')
    expect(r.kind === 'pick' && r.target.id).toBe('elec-2b')
  })

  test('BOUNDED — an id we never offered is refused, not obeyed', async () => {
    // The one thing a model must never be able to do is act on a row we did not show him.
    const r = await interpretPickReply(Q, OFFERED, 'the wiring one',
      says({ verdict: 'pick', id: 'some-task-we-never-showed', reason: 'invented' }))
    expect(r.kind).toBe('not_an_answer')
  })

  test('FAILS CLOSED — a dead model is not_an_answer, which is exactly what we did before', async () => {
    expect((await interpretPickReply(Q, OFFERED, 'ఏదో ఒకటి', dies)).kind).toBe('not_an_answer')
  })

  test('FAILS CLOSED — an unparseable response is not_an_answer', async () => {
    expect((await interpretPickReply(Q, OFFERED, 'x', () => Promise.resolve('I think it is the first one!'))).kind)
      .toBe('not_an_answer')
  })

  test('THE ₹25,000 — a payment mid-pick is NOT an answer, and still falls through to its own turn', async () => {
    // The fall-through exists because this exact message once arrived while a pick was open, matched
    // nothing, and was answered "No problem — I'll check back next time." The money vanished. It must
    // still reach the dispatcher as its own turn.
    const r = await interpretPickReply(Q, OFFERED, 'రాజుకి పాతికి వేలు ఇచ్చాను',
      says({ verdict: 'not_an_answer', reason: 'a payment; nothing to do with the list' }))
    expect(r.kind).toBe('not_an_answer')
  })

  test('"it is something else" is NEW work, not "none of these"', async () => {
    expect((await interpretPickReply(Q, OFFERED, 'kotthadhi', says({ verdict: 'new', reason: 'says it is different work' }))).kind)
      .toBe('new')
  })

  test('"none of these" parks — the right task may simply not exist yet', async () => {
    expect((await interpretPickReply(Q, OFFERED, 'ivi kaadu', says({ verdict: 'none', reason: 'rejects all, points at nothing' }))).kind)
      .toBe('none')
  })

  test('an empty offered list or an empty reply is never an answer', async () => {
    expect((await interpretPickReply(Q, [], 'anything', says({ verdict: 'pick', id: 'x' }))).kind).toBe('not_an_answer')
    expect((await interpretPickReply(Q, OFFERED, '   ', says({ verdict: 'pick', id: 'elec-2b' }))).kind).toBe('not_an_answer')
  })
})

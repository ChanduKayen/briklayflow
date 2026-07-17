// TYPE 5 · THE CONFIRMATION — the destination line, the one button, and the one door they both come through.
//
// A confirmation is the only proof a WhatsApp message became a row in the app. Before this, it proved nothing:
// it named what it had done and never said where the thing now lived, so the only way to find out was to go
// hunting. And because SIX different places composed a confirmation by hand, any fact that had to be true of
// all of them (a destination line, a button) could only ever be true of the one you remembered to edit.
//
// So there is one composer — composeConfirmation — and these are its rules:
//
//   1. The destination line rides EVERY message that wrote data, and NOTHING else. A didn't-catch wrote no
//      row; stamping "Recorded in Tasks" under it would be the system claiming a write it never made.
//   2. The homes are read off the OUTCOMES, never sniffed out of the prose.
//   3. One button, and it goes to the most consequential thing he could do next:
//      undo > Review > the one record > the day.

import { suite, test, expect } from './harness'
import { composeConfirmation, type ReadbackEntry } from '../_siteops_readback.ts'
import { homesOf, type TerminalOutcome, type Terminal, type AttachUpdate } from '../_siteops_resolution.ts'

const upd = (o: Partial<AttachUpdate> & { target_id: string }): AttachUpdate =>
  ({ target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'done', ...o })
const tUpdated = (target_id: string, target_kind: 'issue' | 'task' | 'todo'): Terminal =>
  ({ kind: 'object_updated', update: upd({ target_id, target_kind }), applied: 'resolve', undo: true, readback: '', reason: '' })
const tCreated = (): Terminal =>
  ({ kind: 'object_created', item: { kind: 'issue', detail: 'tiles broke', location: null, project_hint: null, confidence: 'high' }, as: 'classified', upgradeOffer: false, reason: '' })
const tMiss = (): Terminal => ({ kind: 'acked_didnt_catch', reason: '' })
const ok = (t: Terminal): TerminalOutcome => ({ terminal: t, status: 'ok', label: 'x' })
const failed = (t: Terminal): TerminalOutcome => ({ terminal: t, status: 'failed', label: 'x' })

const bodyOf = (m: ReturnType<typeof composeConfirmation>) => ('body' in m ? m.body : '')
const ctaOf = (m: ReturnType<typeof composeConfirmation>) => (m.kind === 'cta' ? m.cta : null)

suite('Type 5 — homesOf: where it landed is read off the WRITES', () => {
  test('a task update lands in Tasks; an issue update in Problems', () => {
    expect(homesOf([ok(tUpdated('t1', 'task'))])).toEqual(['Tasks'])
    expect(homesOf([ok(tUpdated('i1', 'issue'))])).toEqual(['Problems'])
    expect(homesOf([ok(tCreated())])).toEqual(['Problems'])
  })

  test('a FAILED write lands in Review — the park is a real write, to a real home', () => {
    expect(homesOf([failed(tCreated())])).toEqual(['Review'])
  })

  test('one turn, two homes → both, in a stable order (never "Review & Tasks")', () => {
    expect(homesOf([ok(tUpdated('t1', 'task')), failed(tCreated())])).toEqual(['Tasks', 'Review'])
  })

  // THE ONE THAT MATTERS. If the line appears under a message that wrote nothing, it is a claim of a write
  // that never happened — and the day he checks and finds nothing there, the line stops meaning anything at
  // all, on every message it was ever true on.
  test('a didn\'t-catch wrote NOTHING → no home, and therefore no destination line', () => {
    expect(homesOf([ok(tMiss())])).toEqual([])
    const msg = composeConfirmation([{ project: null, body: "Didn't catch that", homes: [] }])
    expect(/Recorded in/.test(bodyOf(msg))).toBe(false)
    expect(msg.kind).toBe('text')                       // …and no button either: there is nowhere to go
  })

  // A SENT question has not written anything yet — it is still a question. An UN-SENT one was parked.
  test('a sent question carries no home; an un-sent (parked) one carries Review', () => {
    const q: Terminal = { kind: 'question_asked', about: 'which_item', ref: 'x', update: upd({ target_id: 'x' }), reason: '' }
    expect(homesOf([ok(q)])).toEqual([])
    expect(homesOf([failed(q)])).toEqual(['Review'])
  })
})

suite('Type 5 — the confirmation: destination line + exactly one button', () => {
  const taskEntry: ReadbackEntry = {
    project: 'The Pride', body: '✓ “Floor tiling” updated', homes: ['Tasks'],
    link: { text: 'View task', url: 'https://x/projects/P1/desk/plan?task=tk-1' },
  }

  test('a write says WHERE it landed', () => {
    expect(/Recorded in \*Tasks\* · Briklay/.test(bodyOf(composeConfirmation([taskEntry])))).toBe(true)
  })

  test('ONE record written → the button lands on THE RECORD, not on a list to hunt through', () => {
    const msg = composeConfirmation([taskEntry])
    expect(msg.kind).toBe('cta')
    expect(ctaOf(msg)?.text).toBe('View task')
    expect(ctaOf(msg)?.url.includes('task=tk-1')).toBe(true)
  })

  // A MIXED bundle spans homes and WhatsApp allows exactly one button — it can't point at all of them, so it
  // points one level UP, at Problems: the half of the desk that needs a human.
  test('a MIXED digest (spans homes) → one button, Open today, landing on Problems', () => {
    const msg = composeConfirmation([
      { project: 'The Pride', body: '✓ “Floor tiling” updated', homes: ['Tasks'] },
      { project: 'Soundharya', body: 'logged new: “cement short”', homes: ['Problems'] },
    ])
    expect(ctaOf(msg)?.text).toBe('Open today')
    expect(ctaOf(msg)?.url.includes('/problems')).toBe(true)   // Problems, not the plan
    expect(/Recorded in \*Tasks & Problems\* · Briklay/.test(bodyOf(msg))).toBe(true)
  })

  // Several updates, and every one of them a task — no single record to open, but they all live in one
  // section. So the button lands on the Tasks plan, not the day.
  test('a PURE-TASK digest → one button, Open Tasks, landing on the plan', () => {
    const msg = composeConfirmation([
      { project: 'The Pride', body: '✓ “Floor tiling” updated', homes: ['Tasks'] },
      { project: 'Chakradhar', body: '✓ “ground clearance” updated', homes: ['Tasks'] },
    ])
    expect(ctaOf(msg)?.text).toBe('Open Tasks')
    expect(ctaOf(msg)?.url.includes('/plan')).toBe(true)
    expect(/Recorded in \*Tasks\* · Briklay/.test(bodyOf(msg))).toBe(true)
  })

  // Something is waiting on him. That outranks navigation to what already worked.
  test('anything held/failed → the button opens REVIEW, and the reassurance is LAST', () => {
    const msg = composeConfirmation([
      { project: 'The Pride', body: '✓ “Floor tiling” updated', homes: ['Tasks'] },
      { project: 'The Pride', body: '⏸ Couldn\'t log “tiles broke”', homes: ['Review'] },
    ])
    expect(ctaOf(msg)?.text).toBe('Open Review')
    const b = bodyOf(msg)
    expect(/Recorded in \*Tasks & Review\* · Briklay — nothing's lost\./.test(b)).toBe(true)
    // …and it is said ONCE. Every failure line used to carry its own copy of it.
    expect((b.match(/nothing's lost/g) ?? []).length).toBe(1)
  })

  // WhatsApp allows ONE interactive type per message — three reply buttons OR one URL button, never both. He
  // just told us an issue is finished and we closed it; if we heard that wrong, a wrongly-closed issue is
  // invisible precisely because it is closed. The fastest reversal beats the fastest navigation.
  test('a RESOLVE keeps the undo button — and STILL says where the row went', () => {
    const msg = composeConfirmation(
      [{ project: 'The Pride', body: '✓ “waterlogging” resolved', homes: ['Problems'] }],
      [{ kind: 'issue', id: 'iss-1', event: 'ev-1' }],
    )
    expect(msg.kind).toBe('buttons')
    expect(msg.kind === 'buttons' && msg.buttons[0].title).toBe('Not resolved')
    expect(/Recorded in \*Problems\* · Briklay/.test(bodyOf(msg))).toBe(true)
  })

  // A held readback stashed in a conversation's slots BEFORE this shipped comes back with no `homes`. It must
  // degrade to no destination line — never to a guessed one.
  test('a pre-Type-5 entry (no homes) → the readback still sends, with no invented destination', () => {
    const msg = composeConfirmation([{ project: 'The Pride', body: '✓ “Floor tiling” updated' }])
    expect(msg.kind).toBe('text')
    expect(bodyOf(msg)).toBe('✓ “Floor tiling” updated')
  })
})

// THE PENDING QUESTION'S LIFE (2026-07-11 fix set, items 3/4/7).
//
// Live, a supervisor interrupted an open which_item pick with a new voice note and got, in this order:
//   1. "✅ Got your message — taking a look now…"
//   2. "Back to my earlier question: which item? 1. Dust is accumulating…"   ← a STUMP of the question,
//                                                                              and it jumped the queue
//   3. "Got it — I'll take care of this, then come back to my earlier question."   ← the PROMISE, arriving
//                                                                                    after the return
// Three defects, pinned here:
//   #4 the re-surface must replay the question WE ASKED — the piece, the escapes, the "(N more)" counter —
//      not a re-render from the candidate names.
//   #7 a question unanswered for 30 minutes is RETIRED (parked, honestly, once), not nagged again.
//   #3 the pre-promise leads the turn (sendNow), instead of riding `prefix` onto the agent's last message.
//      (Source-guarded: dispatch is too IO/model-bound to drive offline — see pending_credibility.)

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { suite, test, expect } from './harness'
import { fakeSupabase } from './fake_supabase'
import { resurfaceBody } from '../_pending.ts'
import { pendingAgeMins } from '../_dispatch.ts'
import { openConversation } from '../_conversation.ts'

const raw = (...p: string[]) => readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', ...p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n')

// ── #4 — the question comes back as it was asked ─────────────────────────────────────────────────────────
const ASK_BODY = `❓ You said: _"tiles being laid"_

Which work is this?

2 more to sort out after this.`

suite('pending — a re-surfaced question is the question, not a summary of it', () => {
  test('(V1) ask_body is replayed verbatim: the piece, both escapes and the drain counter all survive', () => {
    const b = resurfaceBody({ pending_question: 'which item?', slots_so_far: { kind: 'siteops_batch_collision', ask_body: ASK_BODY, candidates: [{ id: 'a', title: 'Tiling — Ground' }] } }, 'en')

    expect(b.includes('You said:')).toBe(true)
    expect(b.includes('"tiles being laid"')).toBe(true)
    expect(b.includes('Which work is this?')).toBe(true)          // the QUESTION comes back, not a summary of it
    expect(b.includes('2 more to sort out after this.')).toBe(true)   // …as does the fact that 2 more are owed
    expect(b.includes('Back to my earlier question')).toBe(true)  // the lead
    expect(/Dismiss/.test(b)).toBe(true)                          // …and the footer still frame it
  })

  test('(V2) no ask_body (an older conversation) → the re-render fallback still asks a usable question', () => {
    const b = resurfaceBody({ pending_question: 'which project is this for?', slots_so_far: { candidates: [{ id: 'p1', name: 'ASM Elite' }] } }, 'en')
    expect(b.includes('which project is this for?')).toBe(true)
    expect(b.includes('1. ASM Elite')).toBe(true)
  })
})

// ── #7 — the 30-minute clock, measured from when the question was FIRST asked ────────────────────────────
suite('pending — the clock starts when the question is first asked, not when it is re-shown', () => {
  const mins = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

  test('(T1) age comes from slots.first_asked_at, so a re-surface cannot renew the lease', () => {
    const p = { slots_so_far: { first_asked_at: mins(40) }, opened_at: mins(1) }   // re-opened a minute ago…
    expect(pendingAgeMins(p)).toBe(40)                                             // …but asked 40 minutes ago
  })

  test('(T2) no stamp (a conversation from before this shipped) → falls back to opened_at', () => {
    expect(pendingAgeMins({ slots_so_far: {}, opened_at: mins(12) })).toBe(12)
  })

  test('(T3) no timestamps at all → age 0 (never retire a question we cannot date)', () => {
    expect(pendingAgeMins({ slots_so_far: {}, opened_at: null })).toBe(0)
  })

  test('(T4) openConversation stamps first_asked_at ONCE; a replay of the same slots keeps the original', async () => {
    const fake = fakeSupabase()
    await openConversation(fake, { orgId: 'o1', sender: '91x', owningAgent: 'SITEOPS', pendingQuestion: 'which item?', slots: { kind: 'siteops_batch_collision' } })
    const first = fake.writesTo('wa_conversations')[0]?.payload?.slots_so_far?.first_asked_at
    expect(typeof first).toBe('string')

    // the re-surface re-opens with the SAME slots — the stamp must ride, not reset
    const old = mins(50)
    await openConversation(fake, { orgId: 'o1', sender: '91x', owningAgent: 'SITEOPS', pendingQuestion: 'which item?', slots: { kind: 'siteops_batch_collision', first_asked_at: old } })
    expect(fake.writesTo('wa_conversations')[1]?.payload?.slots_so_far?.first_asked_at).toBe(old)
  })
})

// ── #3 + #7 — the dispatcher wiring (dispatch is not offline-drivable; source-guard it) ──────────────────
suite('dispatch — the promise leads the turn, and a stale question is retired (source guards)', () => {
  const dd = stripComments(raw('_dispatch.ts'))

  test('(W1) the pre-promise is sent immediately, not folded into the agent prefix', () => {
    expect(/sendNow\([^)]*M\.pendingReturnAck/.test(dd)).toBe(true)
    expect(dd.includes('mergePrefix(welcome, M.pendingReturnAck(lang))')).toBe(false)   // the old glue is gone
  })

  test('(W2) a stale question is RETIRED before it can be promised, deferred or re-shown', () => {
    expect(dd.includes('retireStalePending')).toBe(true)
    expect(dd.includes('pendingRetiredNotice')).toBe(true)          // …and the sender is told, once
    const retire = dd.indexOf('await retireStalePending')
    const promise = dd.indexOf('M.pendingReturnAck')
    const defer = dd.indexOf('carryDeferredOnto(supabase, reopened')
    expect(retire > 0 && promise > retire && defer > retire).toBe(true)
  })

  test('(W3) retiring DISPOSES honestly (the agent parks it) — a dropped question is not a retired one', () => {
    expect(/agentFor\('SITEOPS'\)\.commitInterrupted/.test(dd)).toBe(true)
    // …and the ordinary interruption path still DEFERS rather than parks (the credibility contract)
    expect(dd.includes('owner.commitInterrupted')).toBe(false)
  })
})

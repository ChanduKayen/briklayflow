// AGENT-AGNOSTIC PENDING-QUESTION CREDIBILITY (2026-07-11).
//
// A question we asked can be interrupted by a new turn. The DISPATCHER — not the agent — owns its fate:
//   • answer resolves it            → normal (unchanged)
//   • the reply is NOT an answer    → agent returns 'not_an_answer' UNTOUCHED (no park, no close)
//   • a new intent while it's open  → handle the intent, then RE-SURFACE it (Dismiss button),
//                                      or DROP it with a notice if the intent raised its OWN question (evict)
//   • chitchat while it's open      → answer the chitchat, then RE-SURFACE it
//   • a Dismiss TAP                 → drop it + tell the user (the ONLY dismissal path; text always re-routes)
//
// dispatch() is too IO/model-bound to drive offline (see router_referent's note), so this pins the PURE
// renderers (resurfaceBody / pendingSubjectOf) behaviourally, and SOURCE-GUARDS the dispatcher wiring +
// the agent's now-untouched non-answer contract. The behavioural half lives in _router/eval (pend_* cases).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { suite, test, expect } from './harness'
import { resurfaceBody, pendingSubjectOf, deferredOf, snapshotPending } from '../_pending.ts'

const raw = (...p: string[]) => readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', ...p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n')

// ── PURE: the re-surfaced question body ──────────────────────────────────────
suite('pending — resurfaceBody renders the question + numbered options + footer', () => {
  const P = {
    pending_question: 'which project is this site note for?',
    slots_so_far: { kind: 'siteops_project', messages: ['cars are getting damaged'],
      candidates: [{ id: 'p1', name: 'Dr Sonudharya' }, { id: 'p2', name: 'ASM Elite' }] },
  }
  test('lists the stored question and each candidate, numbered, with the reply/Dismiss footer', () => {
    const b = resurfaceBody(P, 'en')
    expect(b.includes('which project is this site note for?')).toBe(true)
    expect(b.includes('1. Dr Sonudharya')).toBe(true)
    expect(b.includes('2. ASM Elite')).toBe(true)
    expect(/Dismiss/.test(b)).toBe(true)
  })
  test('a which_item pick renders its titles (title is the conventional label, like name)', () => {
    const b = resurfaceBody({ pending_question: 'which item did you mean?', slots_so_far: { candidates: [{ id: 'i1', title: 'Wiring — First floor' }] } }, 'en')
    expect(b.includes('1. Wiring — First floor')).toBe(true)
  })
  test('no candidates → question + footer, no phantom numbering', () => {
    const b = resurfaceBody({ pending_question: 'got your photo — what is it about?', slots_so_far: {} }, 'en')
    expect(b.includes('got your photo')).toBe(true)
    expect(/^\s*1\./m.test(b)).toBe(false)
  })
  test('missing question degrades to a neutral phrase, never empty/undefined', () => {
    const b = resurfaceBody({ pending_question: null, slots_so_far: {} }, 'en')
    expect(b.includes('my earlier question')).toBe(true)
    expect(b.includes('undefined')).toBe(false)
  })
})

// ── PURE: the subject echoed in the evict notice ─────────────────────────────
suite('pending — pendingSubjectOf echoes what the question was about', () => {
  test('which_project → the held message', () => {
    expect(pendingSubjectOf({ pending_question: 'which project?', slots_so_far: { messages: ['cars are getting damaged'] } })).toBe('cars are getting damaged')
  })
  test('which_item → the piece_text', () => {
    expect(pendingSubjectOf({ pending_question: 'which item?', slots_so_far: { piece_text: 'wiring done' } })).toBe('wiring done')
  })
  test('nothing to echo → null (the notice omits the "about …" clause)', () => {
    expect(pendingSubjectOf({ pending_question: 'which item?', slots_so_far: {} })).toBe(null)
  })
  test('a long subject is capped (never a wall of text in the notice)', () => {
    const long = 'x'.repeat(200)
    expect((pendingSubjectOf({ pending_question: 'q', slots_so_far: { text: long } }) ?? '').length).toBe(80)
  })
})

// ── PURE: the deferral snapshot (hold behind a new question, re-surface when done) ──
suite('pending — deferral snapshot holds a question without dropping it', () => {
  test('deferredOf reads the question riding a convo\'s slots; null when none', () => {
    expect(deferredOf({ slots_so_far: {} })).toBe(null)
    const dp = { owning_agent: 'SITEOPS', pending_question: 'which project?', slots_so_far: { kind: 'siteops_project' }, staged_entry_id: null }
    expect(deferredOf({ slots_so_far: { deferred_pending: dp } })?.pending_question).toBe('which project?')
  })
  test('snapshotPending captures exactly what re-surface needs, verbatim slots', () => {
    const snap = snapshotPending({ owning_agent: 'SITEOPS', pending_question: 'which project?', slots_so_far: { kind: 'siteops_project', messages: ['patti work first floor'] }, staged_entry_id: null })
    expect(snap.owning_agent).toBe('SITEOPS')
    expect(snap.pending_question).toBe('which project?')
    expect(resurfaceBody(snap, 'en').includes('which project?')).toBe(true)   // a snapshot re-surfaces like a convo
    expect(pendingSubjectOf(snap)).toBe('patti work first floor')
  })
  test('NESTING chains: a snapshot of a question that itself holds a deferred one preserves the inner one', () => {
    const inner = { owning_agent: 'SITEOPS', pending_question: 'inner?', slots_so_far: {}, staged_entry_id: null }
    const outer = snapshotPending({ owning_agent: 'SITEOPS', pending_question: 'outer?', slots_so_far: { deferred_pending: inner }, staged_entry_id: null })
    expect(deferredOf(outer)?.pending_question).toBe('inner?')   // re-surfacing outer restores its held inner
  })
})

// ── SOURCE-GUARD: the dispatcher wiring (dispatch is not offline-drivable) ────
suite('dispatch — the credibility flow is wired (source guards)', () => {
  const d = raw('_dispatch.ts')
  const dd = stripComments(d)

  test('a Dismiss TAP is handled structurally, before the answer is ROUTED, and drops + tells', () => {
    // THE INVARIANT: a `pending_dismiss` tap must never be mistaken for an ANSWER to the question it is
    // dismissing. It short-circuits — closes the conversation, says so, and returns — before anything
    // routes on `decision`.
    //
    // This used to pin the tap against the literal `isInteractiveReply) ? 'ANSWERS_PENDING'`, i.e. the line
    // that BINDS an interactive reply to the pending question. That binding moved above the router when the
    // router stopped being consulted for a tap at all (2026-07-13: a tap is a structural fact, and paying a
    // 5-second LLM call to be told so — then discarding its answer — was pure latency). The binding being
    // computed earlier changes nothing: the dismiss still returns first, and that is the fact worth pinning.
    // So pin THAT: the tap is handled before `decision` is ever used to route.
    const tap = dd.indexOf("ctx.interactiveId === 'pending_dismiss'")
    const routes = dd.indexOf("if (decision === 'ANSWERS_PENDING')")
    expect(tap > 0).toBe(true)
    expect(routes > 0).toBe(true)
    expect(tap < routes).toBe(true)                                 // the tap wins before the answer is routed
    expect(dd.includes('pendingDismissedAck')).toBe(true)           // …and tells the user (Q1: drop + tell)
  })

  test('an interactive reply to an open question does NOT consult the router', () => {
    // A tap on a row of a list WE sent, against a question WE have open, is a fact — not a sentence to be
    // classified. ANSWERS_PENDING routes by the DB's owning agent, never by the LLM's intent_agent, so the
    // router's answer was being computed and then thrown away. It is NOT the deleted lexical short-circuit
    // returning: nothing here guesses at meaning from words.
    expect(dd.includes('structuralAnswer')).toBe(true)
    const structural = dd.indexOf('const structuralAnswer')
    const route = dd.indexOf('await routeMessage({ text, pending, history })')
    expect(structural > 0).toBe(true)
    expect(structural < route).toBe(true)                           // decided before the router is even offered
  })

  test('a non-answer stashes P (agent no longer parks/closes on its behalf)', () => {
    expect(dd.includes('stashedP')).toBe(true)
    // the old "agent already parked + closed" assumption must be gone
    expect(d.includes('openForInterrupt = null')).toBe(false)
    // no commitInterrupted/abandon on the interactive interruption path (defer + resurface replaces park)
    expect(dd.includes('owner.commitInterrupted')).toBe(false)
  })

  test('the held question is DEFERRED (never dropped/evicted) when the turn raises its own question', () => {
    expect(dd.includes('resurfacePending')).toBe(true)
    expect(dd.includes('carryDeferredOnto')).toBe(true)              // defer, not drop
    expect(dd.includes('pendingDeferredNudge')).toBe(true)           // …and nudge (held, not lost)
    expect(dd.includes('pendingEvictedNotice')).toBe(false)          // the drop-on-evict path is GONE
    expect(dd.includes('getRouterView(supabase, orgId, from)).open')).toBe(true)   // the "did the turn open its own Q?" probe
  })

  test('a resolved answer carries a deferred question forward, or re-surfaces it when the chain ends', () => {
    // on resolve: capture the deferred BEFORE the agent closes the convo, then carry-forward or re-surface
    expect(dd.includes('const carried = deferredOf(')).toBe(true)
    const carry = dd.indexOf('carryDeferredOnto(supabase, nowOpen')
    const surface = dd.indexOf('resurfacePending(supabase, { orgId, from, wamid }, carried')
    expect(carry > 0 && surface > 0).toBe(true)
  })

  test('NEW_INTENT pre-promises the return; the disambig-convo only opens when nothing was pending', () => {
    expect(dd.includes('pendingReturnAck')).toBe(true)
    // AMBIGUOUS-with-pending re-surfaces (returns) BEFORE the disambiguation openConversation is reached
    const ambResurface = dd.indexOf('pendingUnclearLead')
    const disambigOpen = dd.indexOf('log a payment or ask a question')
    expect(ambResurface > 0 && disambigOpen > 0 && ambResurface < disambigOpen).toBe(true)
  })
})

// ── SOURCE-GUARD: the agent's non-answer contract (offline-tested behaviourally in bug1_fanout_dedup j6) ──
suite('siteops — every non-answer branch defers to the dispatcher (no park, no judge)', () => {
  const s = raw('_agents', 'siteops.ts')
  const defined = (name: string) => new RegExp(`(const|function|let|var)\\s+${name}\\b`).test(stripComments(s))

  test('judgePending is deleted (dismissal is a button, not a meaning-guess)', () => {
    expect(defined('judgePending')).toBe(false)
  })
  test('no non-answer branch drops with the old copy', () => {
    expect(s.includes("I've left that out")).toBe(false)
    expect(s.includes('Left that one for now')).toBe(false)
    expect(s.includes('Left it for now')).toBe(false)
  })
})

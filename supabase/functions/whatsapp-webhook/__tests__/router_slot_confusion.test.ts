// THE SLOT CONFUSION — when the model answers the right question in the wrong box.
//
// Live, 2026-07-17, twice inside four minutes:
//
//   [router] raw LLM response: {"decision":"REPORTING","intent_agent":"TRANSACTION","confidence":1.0,
//                               "reasoning":"User is asking for payment status to a specific party,
//                                            not supplying a fact."}
//   [trace] route {"agent":"CONCIERGE","decision":"CHITCHAT", ...}
//
// Read the reasoning. The model understood the message PERFECTLY — it is the ask/tell axis, stated in the
// model's own words, correct. It then wrote its verdict into `decision`, which is the conversation-state
// axis, where REPORTING is not a legal value. validate() rejects on the enum (correctly — it cannot know
// which field is the mistake), returns null, and routeMessage falls through to the LLM-down fallback. The
// text carries no digit and nothing was pending, so it lands on the last line: CHITCHAT / CONCIERGE.
//
// A perfect classification became chitchat. Not because the model failed to understand — because it filled
// the wrong slot, and we threw the whole answer away over it.
//
// WHY THIS SLOT AND NO OTHER. _router.ts's own header explains the two axes: `decision` is conversation
// state, `intent_agent` is ownership, and "a question is not a fifth conversation state". That design is
// right and stays. But it is OUR abstraction, not a natural one — to the model, "what is this message?" has
// one obvious answer and `decision` is the first box on the form. REPORTING is the newest agent AND the
// prompt gives it a section heading of its own (ASKING IS NOT REPORTING), so it reads loudest as a verdict.
// Note what the model did with the box it had left: `intent_agent:"TRANSACTION"` — it demoted ownership to
// TOPIC (this is about money). Both boxes are filled, both are meaningful, and the verdict is in the first
// one. So when `decision` holds an agent name, THAT is the model's answer.
//
// The fix is a code floor, not a prompt paragraph — the lesson from every model-disobedience bug in this
// codebase, and the reason is visible in the log above: you cannot argue a model out of a slot it thinks is
// the natural one, and the same 12 lines of framing that would try measurably break the terse cases.
// validate() already knows both enums. It can see that REPORTING is an AGENT in the DECISION box and
// recover the turn instead of discarding it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { suite, test, expect } from './harness'
import { _validateForTest as validate } from '../_router.ts'

const raw = (...p: string[]) =>
  readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', ...p), 'utf8')

const IN = { text: 'ఎలక్ట్రీషియన్ శ్రీనుకి ఇప్పటివరకు ఎంత పేమెంట్ ఇచ్చావ్?' }

// ── The salvage ──────────────────────────────────────────────────────────────────────────────────────────
suite('router — an AGENT in the decision slot is recovered, not discarded', () => {
  // The exact live payload, byte for byte.
  const LIVE = JSON.stringify({
    decision: 'REPORTING', intent_agent: 'TRANSACTION', confidence: 1.0,
    reply_language: 'te',
    reasoning: 'User is asking for payment status to a specific party, not supplying a fact.',
  })

  test('the live payload routes to REPORTING, not CONCIERGE', () => {
    const d = validate(LIVE, IN, 'te')
    expect(d !== null).toBe(true)
    expect(d!.intent_agent).toBe('REPORTING')
    expect(d!.decision).toBe('NEW_INTENT')
  })

  // The decision box holds the VERDICT; intent_agent had already been demoted to topic. If TRANSACTION won
  // here, a question about a payment would reach the agent that WRITES payments — the ask/tell bug this
  // route exists to kill, arriving through the back door.
  test('the decision slot wins over the demoted intent_agent', () => {
    expect(validate(LIVE, IN, 'te')!.intent_agent).toBe('REPORTING')
  })

  test('the model\'s language and reasoning survive the salvage', () => {
    const d = validate(LIVE, IN, 'te')!
    expect(d.reply_language).toBe('te')
    expect(/payment status/.test(d.reasoning)).toBe(true)
  })

  // Same confusion, other agents — nothing about this is REPORTING-specific, it is just where it showed up.
  test('it holds for every agent name, not just the one we caught', () => {
    for (const agent of ['SITEOPS', 'TRANSACTION', 'PROCUREMENT'] as const) {
      const d = validate(JSON.stringify({ decision: agent, intent_agent: null, reply_language: 'en' }), IN, 'en')
      expect(d !== null).toBe(true)
      expect(d!.intent_agent).toBe(agent)
      expect(d!.decision).toBe('NEW_INTENT')
    }
  })

  // CONCIERGE is the one agent whose turn is NOT a new intent — the concierge exists for the turns that
  // aren't actionable. decision:"CONCIERGE" means chitchat, and the coherence rule below already agrees.
  test('CONCIERGE in the decision slot means CHITCHAT', () => {
    const d = validate(JSON.stringify({ decision: 'CONCIERGE', intent_agent: null, reply_language: 'en' }), IN, 'en')
    expect(d!.decision).toBe('CHITCHAT')
    expect(d!.intent_agent).toBe('CONCIERGE')
  })
})

// ── The salvage is NARROW ────────────────────────────────────────────────────────────────────────────────
// A rescue that starts guessing is worse than the fallback it replaced. This one fires on exactly one
// condition — the decision slot holds a value that is a known AGENT — and on nothing else.
suite('router — garbage is still garbage', () => {
  test('an unknown decision is still rejected', () => {
    expect(validate(JSON.stringify({ decision: 'BANANA', intent_agent: 'SITEOPS' }), IN, 'en')).toBe(null)
    expect(validate(JSON.stringify({ decision: '', intent_agent: 'SITEOPS' }), IN, 'en')).toBe(null)
    expect(validate('not json at all', IN, 'en')).toBe(null)
    expect(validate('', IN, 'en')).toBe(null)
  })

  // The overwhelming majority of turns: a well-formed decision is returned VERBATIM. The salvage must be
  // invisible to them.
  test('a well-formed payload is untouched', () => {
    const good = JSON.stringify({ decision: 'NEW_INTENT', intent_agent: 'REPORTING', confidence: 1.0, reply_language: 'te', reasoning: 'ok' })
    const d = validate(good, IN, 'te')!
    expect(d.decision).toBe('NEW_INTENT')
    expect(d.intent_agent).toBe('REPORTING')
  })

  test('the four real decisions all still parse', () => {
    for (const decision of ['ANSWERS_PENDING', 'NEW_INTENT', 'CHITCHAT', 'AMBIGUOUS'] as const) {
      const d = validate(JSON.stringify({ decision, intent_agent: 'SITEOPS', reply_language: 'en' }), IN, 'en')
      expect(d !== null).toBe(true)
      expect(d!.decision).toBe(decision)
    }
  })

  // The existing coherence rules are load-bearing and must survive the new branch above them.
  test('CHITCHAT still forces CONCIERGE, AMBIGUOUS still forces null', () => {
    expect(validate(JSON.stringify({ decision: 'CHITCHAT', intent_agent: 'SITEOPS' }), IN, 'en')!.intent_agent).toBe('CONCIERGE')
    expect(validate(JSON.stringify({ decision: 'AMBIGUOUS', intent_agent: 'SITEOPS' }), IN, 'en')!.intent_agent).toBe(null)
  })

  test('ANSWERS_PENDING still takes the pending agent, salvage or not', () => {
    const withPending = { ...IN, pending: { agent: 'SITEOPS', question: 'which floor?' } }
    const d = validate(JSON.stringify({ decision: 'ANSWERS_PENDING', intent_agent: 'TRANSACTION' }), withPending, 'en')
    expect(d!.intent_agent).toBe('SITEOPS')
  })
})

// ── The two axes stay two ────────────────────────────────────────────────────────────────────────────────
suite('router — the salvage does NOT make REPORTING a conversation state', () => {
  const router = raw('_router.ts')

  // The whole point of the header comment: four decisions, forever, however many agents arrive. The salvage
  // TRANSLATES a mis-slotted agent back onto the ownership axis; it must never widen the state machine.
  test('DECISIONS still holds exactly the four conversation states', () => {
    const m = router.match(/const DECISIONS = \[([^\]]*)\]/)
    expect(m !== null).toBe(true)
    const values = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
    expect(values.sort().join(',')).toBe('AMBIGUOUS,ANSWERS_PENDING,CHITCHAT,NEW_INTENT')
  })

  test('the RouterDecision type still admits only those four', () => {
    expect(/decision: 'ANSWERS_PENDING' \| 'NEW_INTENT' \| 'CHITCHAT' \| 'AMBIGUOUS'/.test(router)).toBe(true)
  })
})

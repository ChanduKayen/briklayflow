// THE CONCIERGE MUST NOT INVENT A NUMBER — the promise the codebase already made, and never implemented.
//
// reporting_route.test.ts pins the LLM-down fallback's design, and states its justification in as many words:
//
//     "A read-only route that cannot understand the question must not guess at it: with the model down a
//      question lands on the concierge, which says plainly that it can't help."
//
// That sentence was false when it was written. Nothing in SYSTEM_DEFAULT tells the concierge it has no
// records. It is a warm, chatty persona at temperature 0.4, handed HISTORY and told it "logs site payments
// to the Day Book" — so when a payment question reaches it, it does the agreeable thing and produces a
// figure. Live, 2026-07-17: a misrouted "how much have we paid electrician Srinu?" came back with an amount.
// There is no such amount. The concierge has never read a table in its life.
//
// Note where the floor DOES exist: SYSTEM_PROSPECT says "Never claim they have an account or any data" —
// because a stranger being told about their nonexistent data was an obvious harm. The same sentence never
// reached SYSTEM_DEFAULT, where the user HAS data and is therefore far likelier to believe the number.
//
// This gate is the concierge's half of the slot-confusion fix (router_slot_confusion.test.ts is the other).
// Both are needed, and the order matters: the router fix stops THIS message reaching the concierge, but the
// concierge is the fallback for EVERY routing failure — an API timeout, a malformed body, a future agent's
// enum drift. It is the floor under the floor, so it is the one that must be honest.
//
// A prompt rule is not a guarantee — a model can still disobey a rule it was given, which is why the
// router's half is code. What a rule DOES do is remove the invitation: today the concierge is not being
// disobedient, it is doing exactly what a warm assistant with no stated limits should do.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { suite, test, expect } from './harness'

const raw = (...p: string[]) =>
  readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', ...p), 'utf8')

const concierge = raw('_agents', 'concierge.ts')

/** The default-mode system prompt only — the modes are separate strings and only this one was missing it. */
const systemDefault = (() => {
  const start = concierge.indexOf('const SYSTEM_DEFAULT')
  const end = concierge.indexOf('const SYSTEM_ORIENTATION')
  return concierge.slice(start, end)
})()

suite('concierge — the default persona is told it holds no records', () => {
  test('SYSTEM_DEFAULT states it cannot see any data', () => {
    expect(/you (have|hold) no|cannot see|can't see|no access to/i.test(systemDefault)).toBe(true)
  })

  // The specific, dangerous act — stating a figure. "Never state an amount" is the rule; it must be in the
  // prompt in words the model cannot read as a style note.
  test('SYSTEM_DEFAULT forbids stating an amount, balance or total', () => {
    expect(/never/i.test(systemDefault)).toBe(true)
    expect(/amount|number|total|balance|figure/i.test(systemDefault)).toBe(true)
  })

  // The recovery, not just the refusal: a man who asked a real question deserves to be told where the answer
  // is, not stonewalled. Otherwise the honest reply is a worse product than the fabricated one.
  test('…and tells it to say so plainly and point at the app', () => {
    expect(/APP_LINK|briklayflow/i.test(systemDefault)).toBe(true)
  })

  // THE STATE HALF. A number is the loudest fabrication, not the only one: "yes, the 3rd floor wiring is
  // done" is the same lie about a different column, and it is the exact bug the REPORTING route was built to
  // kill. Asking is not reporting — and answering-from-nothing is not reporting either.
  test('SYSTEM_DEFAULT forbids inventing a STATUS too, not only a number', () => {
    expect(/status|done|whether|state of/i.test(systemDefault)).toBe(true)
  })
})

// ── The rule stays terse ─────────────────────────────────────────────────────────────────────────────────
// The A/B proof from the payment prompt: a 12-line framing measurably broke a terse case. State the rule;
// do not argue it. This gate is not decoration — it is the reason this fix is ~4 lines and not a section.
suite('concierge — the honesty rule is stated, not argued', () => {
  test('it costs the default prompt fewer than 8 lines', () => {
    const lines = systemDefault.split('\n').filter((l) => /never|no records|cannot see|can't see/i.test(l))
    expect(lines.length > 0).toBe(true)
    expect(lines.length < 8).toBe(true)
  })
})

// ── The other modes keep their existing floors ───────────────────────────────────────────────────────────
suite('concierge — prospect mode keeps the floor it always had', () => {
  test('SYSTEM_PROSPECT still refuses to claim an account or data', () => {
    expect(/Never claim they have an account or any data/.test(concierge)).toBe(true)
  })
})

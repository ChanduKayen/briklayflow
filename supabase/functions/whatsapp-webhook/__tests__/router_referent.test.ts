// THE REFERENT RULE — the single rule that replaced every routing heuristic in this codebase.
//
//     A message can only act on something it NAMES.
//
// "ok" / "sari" / "haan" / "done" / "👍" name nothing, so they change nothing; the concierge shows the
// supervisor how to name the work. "municipal water issue is resolved" names its subject, so SiteOps resolves
// it. That one sentence subsumes, and deleted:
//
//   • AFFIRM_NEG + isBareAffirmNeg   (_router.ts)        — a pre-LLM ack word list; the model was never asked
//   • ACK_WORDS / ACK_EMOJI / ACK_HONORIFIC + isBareAck  — a SECOND ack word list, for the fast path
//   • RESOLVED_RE / OPEN_RE + interpretStatus            — a THIRD, for "did this reply close the item?"
//   • classifyReplyFragment / matchPieceToBatch          — ASCII-only reply matching (blind to Telugu script)
//   • B3 (_dispatch.ts)                                  — chase open + CHITCHAT → force SITEOPS
//   • isAssistantQuestion / HELP_PHRASE_RE               — a guard on B3, per-language, per-phrasing
//   • the procurement interrupt (_router.ts)             — a regex overriding a successful LLM decision
//
// AFFIRM_NEG had shipped a corrupted entry — 'vద్దు', a Latin "v" glued to Telugu "ద్దు" — next to the correct
// 'వద్దు'. Dead for months, silently, because a word list cannot fail loudly. That is the argument against the
// whole approach, in one line of source.
//
// The router decides now, reading the conversation (_history.ts). This gate cannot call the model, so it pins
// the two things that make the model's decision possible and safe: the RULE is in the prompt, and the
// heuristics are GONE and stay gone. The behavioural half lives in the router eval corpus (_router/eval),
// which does call a model.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { suite, test, expect } from './harness'
import { RouterInput, pendingSummary } from '../_router.ts'   // type-only reference: the module must still compile

// Strip comments before searching. Every deleted symbol is NAMED in a grave-marker comment explaining why it
// went — so a raw text search would find them all and pass forever, which is precisely the class of
// green-but-meaningless test this whole exercise was about.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n')

const src = (...p: string[]) =>
  stripComments(readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', ...p), 'utf8'))

/** The prompt lives in a template literal, so it survives stripComments — read it raw. */
const raw = (...p: string[]) => readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', ...p), 'utf8')

// Source-level guards. `dispatch`/`routeMessage` are too I/O- and model-bound to drive offline, and a pure
// predicate nothing calls is exactly how the last bug survived — so pin the SOURCE.
suite('router — the referent rule is IN the prompt', () => {
  const router = raw('_router.ts')

  test('the prompt states the rule, and decides it first', () => {
    expect(router.includes('THE REFERENT RULE (decide this FIRST, before anything else)')).toBe(true)
    expect(/A message can only act on something it NAMES/.test(router)).toBe(true)
  })

  // The live failure, verbatim: an ack must not become a site update just because a chase is open.
  test('the prompt says an acknowledgement is not an answer, even with a chase in HISTORY', () => {
    expect(/an acknowledgement of a question is not an answer to it/i.test(router)).toBe(true)
    expect(/Naming nothing, it changes nothing/i.test(router)).toBe(true)
  })

  // The OLD rule said the opposite — "a bare status reply … with a lingering site-ops item is a follow-up
  // answer, not chitchat" — which would route "done" straight back into SiteOps. It must be gone.
  test('the contradicting LINGERING rule is gone', () => {
    expect(/bare status reply .* is a follow-up answer, not chitchat/i.test(router)).toBe(false)
  })

  test('the router is given HISTORY, not a one-line lingering summary', () => {
    expect(router.includes('HISTORY (oldest first)')).toBe(true)
    expect(router.includes('LINGERING: ${input.lingering')).toBe(false)
  })
})

suite('router/dispatch — the heuristics are DELETED (and stay deleted)', () => {
  const router = src('_router.ts')
  const dispatch = src('_dispatch.ts')
  const batch = src('_siteops_batch.ts')
  const siteops = src('_agents', 'siteops.ts')

  // Each of these is asserted as an IDENTIFIER, not a word: the grave-marker comments name them all, so a
  // naive "does the file mention X" check would pass forever. Match a definition or a call instead.
  const defined = (s: string, name: string) =>
    new RegExp(`(const|function|let|var)\\s+${name}\\b`).test(s) || new RegExp(`\\b${name}\\s*\\(`).test(s)

  test('the router has no ack word list and no pre-LLM short-circuit', () => {
    expect(defined(router, 'AFFIRM_NEG')).toBe(false)
    expect(defined(router, 'isBareAffirmNeg')).toBe(false)
  })

  // `if (llm) return llm` is the line that makes "no lexical overrides" structural: a successful
  // classification returns before any regex can touch it. looksActionableProcurement still EXISTS (declared
  // above, used below) but may only be CALLED in the LLM-down fallback — where there is no decision to override.
  test('the router does not override a successful LLM decision', () => {
    const gate = router.indexOf('if (llm) return llm')
    expect(gate > 0).toBe(true)
    const calls = [...router.matchAll(/(?<!function\s)\blooksActionable\w+\s*\(/g)].map((m) => m.index ?? -1)
    expect(calls.length > 0).toBe(true)                       // the fallback still uses them
    expect(calls.every((i) => i > gate)).toBe(true)           // …and only after the LLM's answer is returned
    expect(router.includes('override: new order interrupts pending sourcing')).toBe(false)
  })

  test('the dispatcher has no chase-batch routing override and no question detector', () => {
    expect(defined(dispatch, 'isAssistantQuestion')).toBe(false)
    expect(defined(dispatch, 'HELP_PHRASE_RE')).toBe(false)
    expect(/batchOpen\s*&&/.test(dispatch)).toBe(false)     // B3's condition
  })

  test('the reply-matching word lists are gone from the batch module', () => {
    for (const name of ['ACK_WORDS', 'ACK_EMOJI_RE', 'ACK_HONORIFIC', 'RESOLVED_RE', 'OPEN_RE',
                        'isBareAck', 'interpretStatus', 'classifyReplyFragment', 'matchPieceToBatch']) {
      expect(defined(batch, name)).toBe(false)
    }
  })

  // The batch survives as EVIDENCE — the ⭐ candidate prior and the bookkeeping — which is all its own
  // comments ever claimed it was ("a prior … it is NEVER a router").
  test('the batch keeps exactly its evidence role', () => {
    for (const name of ['getOpenBatch', 'upsertOpenBatch', 'dropBatchItems']) {
      expect(defined(batch, name)).toBe(true)
    }
  })

  test('siteops has no bare-ack fast path and no second-opinion judge', () => {
    expect(defined(siteops, 'judgeResolution')).toBe(false)
    expect(defined(siteops, 'handleBatchReply')).toBe(false)
    expect(/isBareAck\s*\(/.test(siteops)).toBe(false)
  })
})

suite('router — the input still type-checks', () => {
  test('RouterInput carries history', () => {
    const i: RouterInput = { text: 'ok', history: [{ role: 'assistant', text: 'quick check on 5', at: 'a' }] }
    expect(i.history?.length).toBe(1)
  })
})

// PENDING SUBJECT (2026-07-10). The router used to be shown only the bare question string ("which project?"),
// not its subject — so a NEW narration on a DIFFERENT subject read as answering it and was dropped. The
// subject + options are on pending.slots; pendingSummary surfaces them.
suite('router — pendingSummary surfaces the pending question\'s subject + options', () => {
  test('a which_project pick renders its subject ("about") and the project options', () => {
    const s = pendingSummary({
      agent: 'SITEOPS', question: 'which project?',
      slots: { kind: 'siteops_project', messages: ['cars are getting damaged'], candidates: [{ id: 'p1', name: 'Dr Sonudharya' }, { id: 'p2', name: 'Aiswarya Enclave' }] },
    })
    expect(s.includes('about:')).toBe(true)
    expect(s.includes('cars are getting damaged')).toBe(true)
    expect(s.includes('Dr Sonudharya')).toBe(true)
    expect(s.includes('Aiswarya Enclave')).toBe(true)
  })

  test('a which_item pick renders its piece_text as the subject', () => {
    const s = pendingSummary({ agent: 'SITEOPS', question: 'which item?', slots: { kind: 'siteops_batch_collision', piece_text: 'wiring done', candidates: [{ id: 'i1', title: 'Wiring — First' }] } })
    expect(s.includes('wiring done')).toBe(true)
    expect(s.includes('Wiring — First')).toBe(true)
  })

  test('no pending → "none"', () => {
    expect(pendingSummary(null)).toBe('none')
  })
})

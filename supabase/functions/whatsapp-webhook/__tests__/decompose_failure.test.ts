// A MODEL OUTAGE MUST NOT SPEAK LIKE A USER ERROR (live failure 2026-07-11, 12:50).
//
// A 9-item, three-site voice note arrived. decompose() threw (a timeout / unreadable response — the model,
// not the message). The narration then fell through the "decompose produced NO items" branch, which is
// written for a genuinely contentless note, and the supervisor was told:
//
//     "Noted 👍 — nothing updated, since I couldn't tell which work you meant."
//
// Nine updates gone, nothing parked, nothing replayable — and the blame put on him. Worse, when a project
// DID resolve from the raw text, that same branch ran the WHOLE narration through the singular unit as ONE
// message, which can only produce a confident wrong answer for a compound note.
//
// The rule: a model failure is OUR failure. It parks (siteops_unplaced, reason 'decompose_failed' — the
// no-drop floor resolveInbound already honours for its own model failures), it says so plainly, and it
// NEVER reaches the raw-text fallback. A decompose that SUCCEEDS and honestly finds nothing is untouched.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'
import { decompose, DecomposeUnreadable } from '../_siteops_extract.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: {}, chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const NARRATION = 'ASM lo 2F slab ayipoyindi, cement short, plumber raledu'

suite('siteops — a decompose FAILURE parks honestly (never "I couldn\'t tell which work you meant")', () => {
  // The model returns nothing usable (timeout → '' → unreadable), twice (the retry also fails).
  test('(D1) model died → parked as decompose_failed + an honest "couldn\'t read that", never NOTHING_TO_UPDATE', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), NARRATION, { callModel: () => Promise.resolve('') })

    const parks = fake.writesTo('siteops_unplaced').filter((w) => w.op === 'insert')
    expect(parks.length).toBe(1)
    expect(parks[0].payload?.reason).toBe('decompose_failed')
    expect(parks[0].payload?.observation).toBe(NARRATION)                    // the sender's words, kept verbatim
    expect(fake.outbox().some((b) => /couldn't read that/i.test(b))).toBe(true)
    expect(fake.outbox().some((b) => /couldn't tell which work you meant/i.test(b))).toBe(false)
  })

  // #2 — the raw-text single-blob fallback must be unreachable on a failure. A resolvable project name in the
  // text is exactly what used to send a 9-fact narration into the unit as ONE message.
  test('(D2) model died → the whole-narration fallback never runs (no resolve, no write, no ask)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM Elite lo slab ayipoyindi', { callModel: () => Promise.resolve('') })

    expect(fake.writesTo('problems').length).toBe(0)
    expect(fake.writesTo('site_tasks').length).toBe(0)
    expect(fake.writesTo('wa_conversations').length).toBe(0)                 // no question opened either
  })

  // The failure is auditable on the narration, like every other miss.
  test('(D3) the narration records WHY nothing landed (miss_verdict decompose_failed)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), NARRATION, { callModel: () => Promise.resolve('') })

    const verdicts = fake.writesTo('site_narrations').filter((w) => w.payload?.miss_verdict)
    expect(verdicts.length).toBe(1)
    expect(verdicts[0].payload?.miss_verdict?.reason).toBe('decompose_failed')
  })

  // An HONEST empty extraction (the model read the message fine and there is genuinely nothing site-ish in
  // it) is NOT a failure — that path is untouched: no decompose_failed park.
  test('(D4) a valid empty extraction is not a failure (no decompose_failed park)', async () => {
    const fake = fakeSupabase(seed())
    const empty = JSON.stringify({ project_hint: null, items: [] })
    await runSiteops(ctxFor(fake), 'sari andi thanks', { callModel: () => Promise.resolve(empty) })

    expect(fake.writesTo('siteops_unplaced').some((w) => w.payload?.reason === 'decompose_failed')).toBe(false)
  })
})

suite('siteops — decompose retries a dead model once before giving up', () => {
  test('(D5) an unreadable first response is retried; a good second response wins', async () => {
    let n = 0
    const call = () => {
      n++
      return Promise.resolve(n === 1 ? '' : JSON.stringify({ project_hint: 'ASM Elite', items: [{ type: 'issue', text: 'cement short', task_hint: null, qc_statements: [], cause: 'material', cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }] }))
    }
    const { items } = await decompose('cement short', [], call)
    expect(n).toBe(2)
    expect(items.length).toBe(1)
  })

  test('(D6) both attempts unreadable → DecomposeUnreadable (a typed failure, not an empty result)', async () => {
    let threw: unknown = null
    try { await decompose('cement short', [], () => Promise.resolve('')) } catch (e) { threw = e }
    expect(threw instanceof DecomposeUnreadable).toBe(true)
    expect((threw as DecomposeUnreadable).cause).toBe('no_response')
  })

  // THE TWO FAILURES ARE NOT ONE. "the model said nothing" (timeout / rate-limit / dead endpoint) and "the
  // model spoke and we cut it off at the token cap" look identical in the log and need opposite fixes: one is
  // an outage to wait out, the other is a budget WE set too small on a nine-item narration.
  test('(D8) a CUT-OFF response (valid work, chopped mid-object) is reported as unparseable, not silence', async () => {
    const truncated = '{"project_hint":"ASM Elite","items":[{"type":"progress","text":"2F slab do'
    let threw: unknown = null
    try { await decompose('long narration', [], () => Promise.resolve(truncated)) } catch (e) { threw = e }
    expect(threw instanceof DecomposeUnreadable).toBe(true)
    expect((threw as DecomposeUnreadable).cause).toBe('unparseable')
  })

  // An empty-but-VALID response is not retried (it is an answer, not a failure) and stays the old error.
  test('(D7) a valid empty extraction is not retried and is not DecomposeUnreadable', async () => {
    let n = 0
    let threw: unknown = null
    try {
      await decompose('ok thanks', [], () => { n++; return Promise.resolve(JSON.stringify({ project_hint: null, items: [] })) })
    } catch (e) { threw = e }
    expect(n).toBe(1)
    expect(threw instanceof DecomposeUnreadable).toBe(false)
    expect(threw instanceof Error).toBe(true)
  })
})

// ── THE DOOR ITSELF (the regression that made the fix above dead code) ───────────────────────────────────
// decompose sizes its OWN model call: a longer leash and a token budget that fits a nine-item narration, not
// the 15s/1200-token default meant for a one-line payment text. runSiteops handed it `callLLM` directly —
// so the default parameter never applied, and every voice note kept running on the small door. Live: the
// same three-site note timed out (or was cut off at the cap) twice and parked, twice.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', ...p), 'utf8')

suite('siteops — decompose gets its OWN model door, not the caller\'s default one', () => {
  test('(D9) runSiteops passes the override or NOTHING — never the raw client', () => {
    const s = src('_agents', 'siteops.ts')
    expect(s.includes('decompose(text, projectNames, opts.callModel)')).toBe(true)
    expect(s.includes('decompose(text, projectNames, opts.callModel ?? callLLM)')).toBe(false)   // the regression
  })

  test('(D10) that door is sized for a narration: a long leash, a retry that is LONGER, and a real budget', () => {
    const e = src('_siteops_extract.ts')
    expect(/DECOMPOSE_TIMEOUT_MS = 30_000/.test(e)).toBe(true)
    expect(/DECOMPOSE_RETRY_TIMEOUT_MS = 45_000/.test(e)).toBe(true)     // repeating an identical timed-out call is not a retry
    expect(/DECOMPOSE_MAX_TOKENS = 4000/.test(e)).toBe(true)             // nine items do not fit in 1200
    expect(/max_completion_tokens: maxTokens/.test(e)).toBe(true)        // …and the budget actually reaches the API
  })

  test('(D11) the door SAYS what went wrong — a cut-off, a non-2xx and a timeout are no longer one silence', () => {
    const e = src('_siteops_extract.ts')
    expect(/finish_reason/.test(e)).toBe(true)          // OpenAI: 'length' ⇒ we cut it off
    expect(/stop_reason/.test(e)).toBe(true)            // Anthropic: the same fact
    expect(/\[llm\] openai \$\{res\.status\}/.test(e) || /openai \$\{res\.status\}/.test(e)).toBe(true)   // a non-2xx was silent
    expect(/siteops:decompose:raw/.test(e)).toBe(true)  // …and what the model actually said
  })
})

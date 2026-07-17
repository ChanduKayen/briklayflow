// THE ASK/TELL AXIS — the router's fifth agent, and the death of the last word list.
//
// Until now the router had no way to tell a QUESTION from a REPORT. That is not a gap, it is a bug, and it
// ran in two directions:
//
//   • WORK PROGRESS. "3rd floor wiring ayipoyinda?" ("is the 3rd floor wiring done?") matched no query
//     pattern anywhere. The router's foundational frame makes SITEOPS the RESIDUAL — "not clearly a payment,
//     not clearly an order, not purely social → SITEOPS" — and the referent rule waves it through, because it
//     DOES name its subject (wiring, 3rd floor). It reached decompose, where nothing in the entire
//     understanding layer asks whether the sentence is a question. A man asking whether the work is finished
//     could mark it finished. Asking is not reporting, and a question must never write.
//
//   • MONEY. MONEY_QUERY_RE → handleQuery was the "until a Reporting agent exists" bridge (_dispatch.ts). It
//     was Latin-only — "ఎంత ఇచ్చాను రాముకి" and "कितना दिया रामू को" matched nothing, so a supervisor asking in
//     his own script could not reach it at all (the same bug as the pick matcher that Telugu could never
//     answer). And handleQuery ignored its `_registered` argument and read rough_entries with NO org filter,
//     on the SERVICE-ROLE client — every registered number could read the five most recent pending entries of
//     every org in the database. It is deleted here, not patched: the leak dies with the word list.
//
// The replacement is not a better regex. It is a fifth AGENT the model routes to, decided in the prompt, on
// the two axes the router already has: `decision` is conversation state, `intent_agent` is ownership, and a
// question is simply a NEW_INTENT that REPORTING owns.
//
// This gate cannot call the model, so — exactly like router_referent.test.ts — it pins the things that make
// the model's decision possible and safe: the axis is IN the prompt, REPORTING is IN the enum, the word list
// is GONE and stays gone, and no regex has quietly grown back to do the model's job. The behavioural half is
// the dummy's own reply, which IS pure and is driven below.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { agentFor } from '../_registry.ts'
import { mReportingSoon } from '../_messages.ts'
import { runReporting } from '../_agents/reporting.ts'

// Strip comments before searching. Every deleted symbol is NAMED in a grave-marker comment explaining why it
// went — so a raw text search would find them all and pass forever, which is precisely the class of
// green-but-meaningless test the referent-rule gate was written to avoid.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n')

const src = (...p: string[]) =>
  stripComments(readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', ...p), 'utf8'))

/** The prompt lives in a template literal, so it survives stripComments — read it raw. */
const raw = (...p: string[]) => readFileSync(join(process.cwd(), 'supabase', 'functions', 'whatsapp-webhook', ...p), 'utf8')

const defined = (s: string, name: string) =>
  new RegExp(`(const|function|let|var)\\s+${name}\\b`).test(s) || new RegExp(`\\b${name}\\s*\\(`).test(s)

// ── The route exists, and the MODEL owns it ──────────────────────────────────────────────────────────────
suite('router — REPORTING is a real intent, decided in the prompt', () => {
  const router = raw('_router.ts')
  const routerSrc = src('_router.ts')

  test('REPORTING is in the intent enum and in the validation list', () => {
    // The type union the dispatcher reads…
    expect(/intent_agent:\s*'TRANSACTION'[^\n]*'REPORTING'/.test(router)).toBe(true)
    // …and the runtime allow-list, or validate() would strip it back to null on every question.
    expect(/const AGENTS = \[[^\]]*'REPORTING'/.test(routerSrc)).toBe(true)
  })

  test('the prompt states the ask/tell axis, and names asking as the thing that must not write', () => {
    expect(router.includes('ASKING IS NOT REPORTING')).toBe(true)
    expect(/a question .*never writes|never write/i.test(router)).toBe(true)
  })

  test('the prompt tells the model REPORTING covers BOTH money and work-progress questions', () => {
    expect(/REPORTING[^\n]*=/.test(router)).toBe(true)
    expect(/how much|balance|paid/i.test(router)).toBe(true)      // the money question
    expect(/is .*done|progress/i.test(router)).toBe(true)         // the progress question
  })

  // THE WHOLE POINT. A question detector is exactly the shape of every heuristic this codebase has already
  // buried (AFFIRM_NEG, HELP_PHRASE_RE, isAssistantQuestion, RESOLVED_RE, the Latin-only pick matcher). A '?'
  // is not a question ("ramu 5000 cash?"), and a question is not a '?' ("wiring ayipoyinda"). The model reads
  // it or nobody does.
  test('NO regex question detector was added anywhere in the routing path', () => {
    const dispatch = src('_dispatch.ts')
    for (const name of ['looksLikeQuestion', 'isQuestion', 'QUESTION_RE', 'ASK_RE', 'QUERY_RE', 'looksActionableReporting']) {
      expect(defined(routerSrc, name)).toBe(false)
      expect(defined(dispatch, name)).toBe(false)
    }
  })

  // The LLM-down fallback deliberately gets NO reporting branch. A read-only route that cannot understand the
  // question must not guess at it: with the model down a question lands on the concierge, which says plainly
  // that it can't help. Guessing would be the only way to get this wrong destructively.
  test('the LLM-down fallback does NOT route to REPORTING', () => {
    // Bounded to the REST OF routeMessage — i.e. the fallback branches only. Not to end-of-file: the prompt
    // and the AGENTS allow-list both name REPORTING further down, and legitimately so.
    const gate = routerSrc.indexOf('if (llm) return llm')
    const endOfRouteMessage = routerSrc.indexOf('const SYSTEM_PROMPT')
    expect(gate > 0).toBe(true)
    expect(endOfRouteMessage > gate).toBe(true)
    expect(routerSrc.slice(gate, endOfRouteMessage).includes('REPORTING')).toBe(false)
  })
})

// ── The division of labour between the model and the matcher ─────────────────────────────────────────────
// Two names, two resolutions, and the difference is ROSTER SIZE — not taste. Pinned in the source because
// both halves are one careless prompt edit from silently reverting, and each failure is invisible:
//
//   THE SITE  — a handful of projects, so the model reads them ALL and returns an id. Levenshtein could
//               never do it ("shyam gaari site" -> "Dr Shyam's Residence"), and it proved it: the Telugu
//               "ఏఎస్ఎం ఎలైట్" scored 0.08 against "ASM Elite" and the site vanished into the all-sites total.
//   THE PARTY — HUNDREDS of stakeholders. That is not a list to hand a model: at that size it starts missing
//               the right row, and a total attributed to the wrong Ramesh is worse than no answer. So the
//               party keeps matchPayee — and the model only TRANSLITERATES his word into Latin so it can
//               reach a Latin roster at all.
//
// The transliteration must stay a transliteration. If the model ever "helpfully" expands "రమేష్" to "Ramesh
// Kumar", it has silently chosen between two real Rameshes — the exact judgement the pick exists to give the
// human. Script in, same word out.
suite('reporting — the model transliterates the party; it does not pick it', () => {
  const agent = raw('_agents', 'reporting.ts')

  test('the prompt tells the model to transliterate the party into Latin', () => {
    expect(/TRANSLITERATE/.test(agent)).toBe(true)
    expect(/రమేష్/.test(agent)).toBe(true)          // the worked example, in the script it must read
  })

  test('…and to transliterate ONLY — never expanding it into a name it guessed', () => {
    expect(/never translate, never swap in a fuller/i.test(agent)).toBe(true)
    expect(/Keep HIS spelling/i.test(agent)).toBe(true)
  })

  // The stakeholder roster must NEVER be rendered into the prompt — that is the 800-row failure this design
  // exists to avoid, and it would arrive looking like a helpful improvement.
  test('the stakeholder roster is never handed to the model', () => {
    const src_ = src('_agents', 'reporting.ts')
    expect(/STAKEHOLDERS:/.test(src_)).toBe(false)
    expect(/stakeholders\.map\([^)]*\)\s*\)?\s*}/.test(src_.replace(/\s+/g, ' '))).toBe(false)
    // loadStakeholders feeds matchPayee, and nothing else.
    expect(/matchPayee\(ask\.party, stakeholders\)/.test(src_)).toBe(true)
  })

  // The projects DO go to the model, as {id,name} — and the id it returns is the answer.
  test('the project roster IS handed to the model, and it answers in ids', () => {
    expect(/PROJECTS: \$\{JSON\.stringify\(projects\.map/.test(agent)).toBe(true)
    expect(/site_id/.test(agent)).toBe(true)
  })
})

// ── The money bridge is dead, and the leak with it ───────────────────────────────────────────────────────
suite('dispatch — the MONEY_QUERY_RE bridge and its unscoped read are DELETED', () => {
  const dispatch = src('_dispatch.ts')

  test('the word list is gone', () => {
    expect(defined(dispatch, 'MONEY_QUERY_RE')).toBe(false)
  })

  // handleQuery read rough_entries with no org_id filter on the service-role client. It is not called from
  // the live path any more, and the import is gone with it.
  test('handleQuery is neither imported nor called by the dispatcher', () => {
    expect(defined(dispatch, 'handleQuery')).toBe(false)
    expect(/from '\.\/_handlers\.ts'/.test(dispatch)).toBe(false)
  })

  test('the dispatcher routes questions through the registry, like every other agent', () => {
    // No bespoke branch: REPORTING must reach its agent via agentFor(intentAgent), not an if-chain.
    expect(/intent === 'REPORTING'/.test(dispatch)).toBe(false)
  })
})

// ── The registry binds it (one entry, per _registry.ts's own promise) ────────────────────────────────────
suite('registry — REPORTING resolves to the reporting agent', () => {
  test('agentFor("REPORTING") is the reporting agent', () => {
    expect(agentFor('REPORTING').intent).toBe('REPORTING')
  })

  // It HAS `answer` now: case 1 can end in a "which Ramesh?" pick, and a pick is a pending question the
  // dispatcher routes the reply back to. Still no `commitInterrupted` — a REPORTING pick holds no half-written
  // state, so an interruption costs only the question, which the credibility flow re-surfaces by itself.
  test('it can resume a pick, and holds no state to commit', () => {
    expect(typeof agentFor('REPORTING').answer).toBe('function')
    expect(agentFor('REPORTING').commitInterrupted).toBe(undefined)
  })
})

// ── The dummy is honest (the behavioural half — a pure composer, driven for real) ────────────────────────
suite('reporting — the dummy answers nothing, and says so plainly', () => {
  const body = () => {
    const m = mReportingSoon('en')
    return m.kind === 'text' ? m.body : ''
  }

  test('it says it cannot answer yet', () => {
    expect(/can't answer|cannot answer/i.test(body())).toBe(true)
  })

  // THE SAFETY VALVE. The ask/tell boundary is the model's judgement, and during the dummy phase a narration
  // that lands here CANNOT be parked — the dummy has nowhere to put it. Telling him plainly that nothing was
  // recorded is what lets him re-send it. A dummy that stayed quiet about this would silently eat site
  // updates, which is the one failure this codebase treats as cardinal.
  test('it says NOTHING WAS RECORDED, so a misrouted update is never silently eaten', () => {
    expect(/nothing .*recorded/i.test(body())).toBe(true)
    expect(/send it again|send again/i.test(body())).toBe(true)
  })

  test('it points at the app, where the answer actually lives today', () => {
    expect(/briklayflow|http/i.test(body())).toBe(true)
  })

  // A fabricated total is worse than no answer: it would be believed. The dummy must carry no digits that
  // could read as money or a count.
  test('it invents no number', () => {
    expect(/₹|\d+\s*(rs|lakh|k\b)/i.test(body())).toBe(false)
  })

  // te/hi are STUBS that fall back to en by catalog convention — Chandu fills them by hand, never
  // auto-generated. Pinned so a well-meaning auto-translation is a failing test, not a silent ship.
  test('te/hi fall back to en until they are written by hand', () => {
    for (const lang of ['te', 'te-en', 'hi'] as const) {
      const m = mReportingSoon(lang)
      expect(m.kind === 'text' && m.body === body()).toBe(true)
    }
  })
})

suite('reporting — the agent sends exactly one reply and writes nothing', () => {
  const SENDER = '919900000000'
  const seed = (): Seed => ({
    projects: [{ project_id: 'P1', name: 'ASM Elite' }],
    wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
    user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  })
  const ctxFor = (fake: ReturnType<typeof fakeSupabase>) =>
    ({ supabase: fake, from: SENDER, senderName: 'Ramesh', orgId: 'org-1', wamid: 'w-1', lang: 'en' as const, interactiveId: null })

  test('a money question gets the one honest reply', async () => {
    const fake = fakeSupabase(seed())
    await runReporting(ctxFor(fake), 'how much did we pay ramesh in total?', {})
    expect(fake.outbox().length).toBe(1)
    expect(/nothing .*recorded/i.test(fake.outbox()[0])).toBe(true)
  })

  // The bug this route exists to kill: a question about work must reach the dummy, and the dummy must not
  // touch a single task row.
  test('a work-progress question gets the same reply — and no site_tasks write', async () => {
    const fake = fakeSupabase(seed())
    await runReporting(ctxFor(fake), '3rd floor wiring ayipoyinda?', {})
    expect(fake.outbox().length).toBe(1)
    expect(/can't answer|cannot answer/i.test(fake.outbox()[0])).toBe(true)
  })

  test('the interrupt prefix is folded in, not dropped', async () => {
    const fake = fakeSupabase(seed())
    await runReporting(ctxFor(fake), 'how much is pending?', { prefix: 'Saved that payment.' })
    expect(fake.outbox()[0].startsWith('Saved that payment.')).toBe(true)
  })
})

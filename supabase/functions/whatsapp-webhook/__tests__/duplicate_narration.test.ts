// THE SAME MESSAGE, SENT TWICE (live failure 2026-07-11).
//
// The supervisor re-sent his voice note. We had already logged its contents the first time — so the second
// send's sentences now MATCHED THE ROWS THEY THEMSELVES HAD CREATED. "dust is entering the gap between the
// tiles where epoxy is applied" came back as a question:
//
//     Which of these is it about?
//     1. Dust is accumulating in the gap between tiles where epoxy is to be applied…
//
// We were asking him whether his sentence meant the issue his own earlier sentence had made. A re-send is
// not new information; it is the same information. Recognise it and say so.
//
// The one thing this must NOT do is block a RETRY. When the first attempt failed (the model died and we told
// him "send it again whenever you like"), the re-send is the whole point — it must run.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const NOTE = 'Soundharya lo tiles vestunnaru, dust clean cheyali'
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const seed = (narrations: Record<string, unknown>[]): Seed => ({
  projects: [{ project_id: 'P1', name: 'Soundharya' }],
  problems: {}, chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-2',
  site_narrations: narrations.map((n) => ({ org_id: ORG, ...n })),
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-2', lang: 'te' as const })

// a narration we HANDLED: decompose produced items (they are on the row)
const handled = (text: string, ageMins: number) => ({
  id: 'narr-1', raw_text: text, created_at: minsAgo(ageMins),
  decomposed: [{ type: 'progress', text: 'tiles being laid' }], miss_verdict: null,
})
const DEC = JSON.stringify({
  project_hint: 'Soundharya',
  items: [{ type: 'progress', text: 'tiles being laid', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }],
})
const R_CREATE = JSON.stringify({
  issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'tiles being laid', location: null, project_hint: 'Soundharya', confidence: 'high' }] },
  update_found: { found: false, updates: [], nearest: [] },
})
const model = (_s: string, user: string) => Promise.resolve(user.startsWith('CANDIDATES:') ? R_CREATE : DEC)
const calls = () => { let n = 0; const f = (s: string, u: string) => { n++; return model(s, u) }; return { f, count: () => n } }

suite('siteops — a re-sent narration is recognised, not re-matched against itself', () => {
  test('(R1) same text, 5 minutes ago, already handled → acknowledged as a repeat; nothing re-run', async () => {
    const fake = fakeSupabase(seed([handled(NOTE, 5)]))
    const c = calls()
    await runSiteops(ctxFor(fake), NOTE, { callModel: c.f })

    expect(c.count()).toBe(0)                                            // no model call at all
    expect(fake.writesTo('site_narrations').length).toBe(0)              // no second narration row
    expect(fake.writesTo('problems').length).toBe(0)                     // and no duplicate object
    expect(fake.outbox().some((b) => /already/i.test(b))).toBe(true)     // …and we say so
  })

  // Whitespace/punctuation/case drift between two transcriptions of the same audio is not a new message.
  test('(R2) the same words, transcribed slightly differently, still count as the same message', async () => {
    const fake = fakeSupabase(seed([handled('Soundharya lo tiles vestunnaru, dust clean cheyali.', 5)]))
    const c = calls()
    await runSiteops(ctxFor(fake), '  soundharya lo TILES vestunnaru  dust clean cheyali  ', { callModel: c.f })
    expect(c.count()).toBe(0)
    expect(fake.outbox().some((b) => /already/i.test(b))).toBe(true)
  })

  test('(R3) the same text from LAST HOUR is not a repeat — the site said it again, it happened again', async () => {
    const fake = fakeSupabase(seed([handled(NOTE, 90)]))
    const c = calls()
    await runSiteops(ctxFor(fake), NOTE, { callModel: c.f })
    expect(c.count() > 0).toBe(true)                                     // processed normally
    expect(fake.writesTo('site_narrations').some((w) => w.op === 'insert')).toBe(true)
  })

  // THE RETRY. The first attempt died (decompose_failed) and we asked him to send it again. That re-send is
  // not a duplicate of anything — nothing was logged the first time.
  test('(R4) a re-send after a FAILED narration is a retry, and must run', async () => {
    const failed = { id: 'narr-1', raw_text: NOTE, created_at: minsAgo(2), decomposed: null, miss_verdict: { reason: 'decompose_failed' } }
    const fake = fakeSupabase(seed([failed]))
    const c = calls()
    await runSiteops(ctxFor(fake), NOTE, { callModel: c.f })

    expect(c.count() > 0).toBe(true)
    expect(fake.writesTo('problems').some((w) => w.op === 'insert')).toBe(true)   // the retry lands
  })

  // A narration the model read but found nothing in is not "handled" either — re-sending it may well be the
  // supervisor rephrasing, and it must be read again.
  test('(R5) a re-send after an EMPTY extraction runs again', async () => {
    const empty = { id: 'narr-1', raw_text: NOTE, created_at: minsAgo(2), decomposed: [], miss_verdict: null }
    const fake = fakeSupabase(seed([empty]))
    const c = calls()
    await runSiteops(ctxFor(fake), NOTE, { callModel: c.f })
    expect(c.count() > 0).toBe(true)
  })

  test('(R6) a DIFFERENT message is never a repeat', async () => {
    const fake = fakeSupabase(seed([handled('cement short at Soundharya', 5)]))
    const c = calls()
    await runSiteops(ctxFor(fake), NOTE, { callModel: c.f })
    expect(c.count() > 0).toBe(true)
  })
})

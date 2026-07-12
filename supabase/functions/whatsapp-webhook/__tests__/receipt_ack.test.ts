// STEP A — the IMMEDIATE receipt ack. A batch/compound message must not sit in ~45s of silence: as soon as
// decompose knows the count, acknowledge ("picked out N updates, reviewing…") BEFORE the resolve loop. A
// single message gets a lighter "got your message" ack. The ack always PRECEDES the final readback.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  // This site HAS a task list, so an unplaceable progress fragment is a genuine miss ('nothing updated'),
  // not the honest "I don't track tasks for this site" answer (acked_untracked_work).
  site_tasks: { 'tk-1': { task_id: 'tk-1', name: 'Slab', project_id: 'P1', status: 'PENDING' } },
  site_narration_id: 'narr-1',
})
const item = (text: string) => ({ type: 'progress', text, task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null })
const DEC = (texts: string[]) => JSON.stringify({ project_hint: 'ASM Elite', items: texts.map(item) })
const BOTH_FALSE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })
const model = (dec: string) => (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? BOTH_FALSE : dec)
const idxOf = (fake: ReturnType<typeof fakeSupabase>, re: RegExp) => fake.outbox().findIndex((b) => re.test(b))

suite('siteops — Step A: immediate receipt ack (batch count + single), before the readback', () => {
  test('a BATCH (2+ items) is acked immediately with the count', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'wiring done, plumbing done', { callModel: model(DEC(['wiring done', 'plumbing done'])) })
    expect(fake.outbox().some((b) => /picked out \*2 updates\*/i.test(b))).toBe(true)
  })

  test('the ack PRECEDES the final readback', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'wiring done, plumbing done', { callModel: model(DEC(['wiring done', 'plumbing done'])) })
    const ack = idxOf(fake, /picked out \*2 updates\*/i)
    const readback = idxOf(fake, /nothing updated/i)   // the both-false readback flush
    expect(ack >= 0).toBe(true)
    expect(readback >= 0).toBe(true)
    expect(ack < readback).toBe(true)
  })

  test('a SINGLE message gets the lighter "got your message" ack', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'wiring done', { callModel: model(DEC(['wiring done'])) })
    expect(fake.outbox().some((b) => /got your message/i.test(b))).toBe(true)
  })
})

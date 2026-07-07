// CONSTITUTIONAL RECONNECTION · A2 (clause 2 — ask-first). A content-bearing message whose project is
// unresolved must ASK "which site?", never collapse to "didn't catch". The live-probe violation: a closure
// ("water problem solved at asm") yields NO new observation, so decompose throws (empty extraction,
// _siteops_extract.ts:292) → decomposed=null → the `!decomposed` branch fired "didn't catch" BEFORE
// ask-first, silently dropping a placeable message. RED until ask-first precedes didn't-catch on content.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],   // 2 → no auto-pick
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
// decompose stub returns EMPTY items → decompose throws → decomposed=null (the closure/update case: nothing
// NEW to observe, yet the message HAS content).
const emptyDecompose = () => (): Promise<string> => Promise.resolve(JSON.stringify({ project_hint: null, items: [] }))

suite('siteops — clause 2 ask-first floor (content + unresolved project → ASK, never silent miss)', () => {
  // (j1) RED — a colloquial closure with an unresolvable site: decompose extracts nothing, but the message
  // is CONTENT. Must ASK "which site?" (carrying the raw text so the resume runs resolveInbound), not miss.
  test('(j1) content + unresolved project + empty decompose → ASK which site (not didn-t-catch)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'water problem solved at asm', { callModel: emptyDecompose() })

    const askedProject = fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    const didntCatch = fake.outbox().some((b) => /Didn't catch/i.test(b))
    expect(askedProject).toBe(true)          // clause 2 — we ask where, never eat a placeable message
    expect(didntCatch).toBe(false)
  })

  // (guard) a genuinely trivial message (a bare ack, no chase, no project) IS an honest didn't-catch — the
  // floor must not turn every unplaceable noise into a question.
  test('(guard) bare ack, no chase, no project → honest didn-t-catch (not an ask)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ok', { callModel: emptyDecompose() })

    const askedProject = fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    const didntCatch = fake.outbox().some((b) => /Didn't catch/i.test(b))
    expect(askedProject).toBe(false)
    expect(didntCatch).toBe(true)
  })
})

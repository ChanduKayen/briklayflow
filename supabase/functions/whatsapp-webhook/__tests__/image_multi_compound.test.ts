// SPRINT 2 · T5 → STAGE 2 — IMAGES JOIN THE PER-PROJECT LOOP. The compound-park interim (first fragment
// through the unit, the rest parked pending_stage2) is REPLACED by the Stage-2 loop: a multi-site photo
// splits into per-project groups and each item runs its OWN unit on its OWN site — through the ladder, no
// pending_stage2 park. This is the end-state the interim comment promised ("Stage 2 restores the per-
// project loop for BOTH modalities at once"). One pipeline, one loop, text and image alike.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const PHOTO = 'wa_919900000000_1.jpg'

const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  problems: {},
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const imgCtx = (fake: ReturnType<typeof fakeSupabase>, caption: string) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-img', lang: 'te' as const,
  image: { base64: 'zz', mime: 'image/jpeg', caption, storagePath: PHOTO },
})

interface Call { system: string; user: string }
// Content-aware resolve stub: each per-project group grades its OWN item, so the two sites get two
// distinct creates (the stub keys on the message text the group loop passes to resolveInbound).
const R_CREATE = (detail: string, project_hint: string) => JSON.stringify({
  issue_snag_found: { found: true, items: [{ kind: 'issue', detail, location: null, project_hint, confidence: 'high' }] },
  update_found: { found: false, updates: [] },
})
const imgModel = (calls: Call[], stubs: { vision?: string }) =>
  (system: string, user: string): Promise<string> => {
    calls.push({ system, user })
    if (user.startsWith('CANDIDATES:')) {
      return Promise.resolve(/transformer/i.test(user) ? R_CREATE('transformer down', 'ASM Elite') : R_CREATE('tiles broke', 'Soundharya'))
    }
    if (user.includes('Decompose the image')) return Promise.resolve(stubs.vision ?? '')
    return Promise.resolve('')
  }
const resolutionCalls = (calls: Call[]) => calls.filter((c) => c.user.startsWith('CANDIDATES:'))

// two items on TWO distinct sites — the multi-project shape the Stage-2 loop fans out per-site.
const VIS_MULTI = JSON.stringify({
  project_hint: null,
  items: [
    { type: 'issue', text: 'tiles broke', confidence: 'high', task_hint: null, cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'Soundharya', qc_statements: [] },
    { type: 'issue', text: 'transformer down', confidence: 'high', task_hint: null, cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'ASM Elite', qc_statements: [] },
  ],
})

suite('siteops T5 → Stage 2 — multi-project images run the per-project loop (no compound-park)', () => {
  test('(multi) two-site photo → EACH item runs its own unit on its own site; both created, no pending_stage2', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, ''), 'site photos', {
      callModel: imgModel(calls, { vision: VIS_MULTI }),
    })

    // the UNIT (ladder) runs ONCE PER GROUP — two sites, two resolution calls.
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(2)

    // each item lands on its OWN site — the per-project fan-out, through the ladder.
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P2')).toBe(true)   // tiles → Soundharya
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P1')).toBe(true)   // transformer → ASM Elite

    // no compound-park anymore — the loop owns every item.
    expect(fake.writesTo('siteops_unplaced').some((w) => w.payload?.reason === 'pending_stage2')).toBe(false)
  })
})

// SPRINT 2 · T5 — IMAGES JOIN THE SINGULAR UNIT. Sub-step 5 (Gap B ruling): images STOP fanning out
// per-project (runMulti) and instead COMPOUND-PARK — first fragment through the unit, the rest parked
// pending_stage2 — exactly like the text path. One pipeline, one compound rule; Stage 2 restores the
// per-project loop for BOTH modalities at once (don't make images fan out differently).
//
// RED-FIRST (flips when the isMulti/runMulti branch is removed): today a multi-site image runs runMulti,
// which files BOTH items per-site via routeGroup (no ladder, no pending_stage2 park).

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
const imgModel = (calls: Call[], stubs: { vision?: string; resolve?: string }) =>
  (system: string, user: string): Promise<string> => {
    calls.push({ system, user })
    if (user.startsWith('CANDIDATES:')) return Promise.resolve(stubs.resolve ?? '')
    if (user.includes('Decompose the image')) return Promise.resolve(stubs.vision ?? '')
    return Promise.resolve('')
  }
const resolutionCalls = (calls: Call[]) => calls.filter((c) => c.user.startsWith('CANDIDATES:'))

// two items on TWO distinct sites — the multi-project shape that runMulti fans out today.
const VIS_MULTI = JSON.stringify({
  project_hint: null,
  items: [
    { type: 'issue', text: 'tiles broke', confidence: 'high', task_hint: null, cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'Soundharya', qc_statements: [] },
    { type: 'issue', text: 'transformer down', confidence: 'high', task_hint: null, cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'ASM Elite', qc_statements: [] },
  ],
})
const R_CREATE_TILES = JSON.stringify({
  issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'tiles broke', location: null, project_hint: 'Soundharya', confidence: 'high' }] },
  update_found: { found: false, updates: [] },
})

suite('siteops T5 sub-step 5 — multi-project images compound-park, not fan out (Gap B / clause-1)', () => {
  test('(multi) two-site photo → FIRST item runs the unit; the SECOND parks pending_stage2 (uniform with text)', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, ''), 'site photos', {
      callModel: imgModel(calls, { vision: VIS_MULTI, resolve: R_CREATE_TILES }),
    })

    // RED until the fan-out is removed — the UNIT (ladder) runs ONCE over the first fragment's project.
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(1)
    expect(rc[0].user.includes('Soundharya') || rc[0].user.includes('tiles')).toBe(true)

    // RED until removed — the SECOND site's item parks pending_stage2 (never a per-site fan-out create).
    expect(fake.writesTo('siteops_unplaced').some((w) => w.payload?.reason === 'pending_stage2' && JSON.stringify(w.payload?.observation ?? '').includes('transformer'))).toBe(true)

    // the first item lands on its site (guard); the second is NOT created anywhere (it parked).
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P2')).toBe(true)
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P1')).toBe(false)
  })
})

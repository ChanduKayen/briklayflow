// SPRINT 2 · T5 — IMAGES JOIN THE SINGULAR UNIT. Sub-step 1 (Gap A pin): a fresh, chase-free RE-PHOTO of
// an existing OPEN item must route through the LADDER as an update component → ADDRESSING + answer-evidence
// (ruling (a): a bare re-photo is engagement = ADDRESSING, same as a bare ack; it re-times the chase). NO
// new executor terminal — the unit's existing update path already expresses it. This journey PINS that
// behavior at the real entry point (runSiteops).
//
// RED-FIRST (intentional, flips at sub-step 3): TODAY a chase-free-project-WITH-items image goes to the
// SECOND engine — finishRoute → planPhotoItems ATTACH axis → attachExistingEvidence, which attaches the
// photo as answer-evidence but NEVER advances the issue's status and NEVER consults the ladder. So:
//   • the issue does NOT reach ADDRESSING            → RED until the finishRoute→runSingularUnit cutover
//   • the ladder (resolveInbound / CANDIDATES:) never runs → RED (finishRoute uses resolveTaskLLM)
// The answer-evidence attach + the no-duplicate guard are GREEN today AND after — the behavior the cutover
// must preserve. This red is the artifact: it documents that the re-photo path bypasses the constitution's
// one ladder. It goes GREEN when sub-step 3 cuts runSiteops:1152 finishRoute→runSingularUnit (after
// sub-step 2 ports the enrichment window, so nothing drops silently).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const PHOTO = 'wa_919900000000_1.jpg'
const waterBI = { kind: 'issue' as const, id: 'iss-water', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'other' }

// P1 ASM Elite (the chased project — the batch lives here), P2 Soundharya (chase-free, carries the open
// wall-crack the re-photo is ABOUT). The batch on P1 makes P2 chase-free → the finishRoute path today.
const seed = (over: Partial<Seed> = {}): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  problems: {
    'iss-water': { id: 'iss-water', title: 'waterlogging in basement', project_id: 'P1', status: 'OPEN' },
    'iss-crack': { id: 'iss-crack', title: 'wall crack near stairs', project_id: 'P2', status: 'OPEN' },
  },
  chase_batches: [{ id: 'batch-1', items: [waterBI] }],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
  ...over,
})
const imgCtx = (fake: ReturnType<typeof fakeSupabase>, caption: string) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-img', lang: 'te' as const,
  image: { base64: 'zz', mime: 'image/jpeg', caption, storagePath: PHOTO },
})

// dispatching model stub — three doors keyed on the prompt shape (mirrors image_batch.test).
interface Call { system: string; user: string }
const imgModel = (calls: Call[], stubs: { vision?: string; resolve?: string; decompose?: string }) =>
  (system: string, user: string): Promise<string> => {
    calls.push({ system, user })
    if (user.startsWith('CANDIDATES:')) return Promise.resolve(stubs.resolve ?? '')
    if (user.includes('Decompose the image')) return Promise.resolve(stubs.vision ?? '')
    return Promise.resolve(stubs.decompose ?? '')
  }
const resolutionCalls = (calls: Call[]) => calls.filter((c) => c.user.startsWith('CANDIDATES:'))

// vision-shaped raw response (decomposeImage's validate() input; confidence high so the issue survives).
const VIS = (projectHint: string | null, items: { type: string; text: string }[]) =>
  JSON.stringify({
    project_hint: projectHint,
    items: items.map((i) => ({
      type: i.type, text: i.text, confidence: 'high', task_hint: null,
      cause: i.type === 'issue' ? 'other' : null, cause_reason: null,
      owner_hint: null, date_hint: null, project_hint: null, qc_statements: [],
    })),
  })

// the ladder contract for a re-photo of the crack: an UPDATE onto iss-crack, action=progress (a re-photo is
// ongoing engagement, NOT closure), high confidence, closure_explicit FALSE → the ladder rules ADDRESSING.
const R_UPDATE_CRACK = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: 'iss-crack', target_kind: 'issue', action: 'progress', confidence: 'high', closure_explicit: false, reason: 're-photo of the wall crack' }] },
})

suite('siteops T5 sub-step 1 — fresh chase-free re-photo joins the ladder (Gap A / clause-1 one-pipeline)', () => {
  test('(gapA) re-photo of an open issue on a chase-free project → ADDRESSING via the ladder + answer-evidence, no duplicate', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, 'Soundharya wall crack'), 'Soundharya wall crack -- crack near the stairs', {
      callModel: imgModel(calls, {
        vision: VIS('Soundharya', [{ type: 'issue', text: 'wall crack near stairs' }]),
        resolve: R_UPDATE_CRACK,
      }),
    })

    // RED until the cutover — the re-photo must ADVANCE the existing issue through the ladder, not attach silently.
    const crackUpd = fake.writesTo('problems').filter((w) => w.op === 'update' && w.filters.some(([k, v]) => k === 'id' && v === 'iss-crack'))
    expect(crackUpd.some((w) => w.payload?.status === 'ADDRESSING')).toBe(true)

    // RED until the cutover — the LADDER (resolveInbound) must run, once, scoped to THE project only.
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(1)
    expect(rc[0].user.includes('iss-crack')).toBe(true)
    expect(rc[0].user.includes('iss-water')).toBe(false)   // the other project stays invisible

    // GUARD (green today AND after) — the photo attaches as ANSWER evidence to the existing issue, and no
    // fresh duplicate is ever created. The cutover must preserve both.
    expect(fake.writesTo('attachments').some((w) => w.payload?.role === 'answer' && w.payload?.parent_id === 'iss-crack' && w.payload?.object_path === PHOTO)).toBe(true)
    expect(fake.writesTo('problems').some((w) => w.op === 'insert')).toBe(false)
  })
})

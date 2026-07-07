// SPRINT 2 · T5 — IMAGES JOIN THE SINGULAR UNIT. Sub-step 2 (Gap C pin): the ENRICHMENT WINDOW must be
// ported from finishRoute into the UNIT's post-create step, and pinned END-TO-END — photo → object → a
// follow-up TEXT enriches that SAME object — BEFORE sub-step 3 retires finishRoute, or the window drops
// silently (no journey ever pinned it opening; reanalyze.test only covers the pure harvest core).
//
// The behavior: when an image CREATES object(s) through the unit, hold an OPEN siteops_photo convo (~90s)
// so the next TEXT enriches those objects (trailed description_added, pending_reanalysis) rather than
// twinning them — the exact Step-2 window finishRoute opened, now owned by the one pipeline.
//
// RED-FIRST (flips when applyTerminals opens the window): today the unit creates the object but opens NO
// window, so the follow-up has nothing to resume into and the object is never enriched.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const PHOTO = 'wa_919900000000_1.jpg'
const waterBI = { kind: 'issue' as const, id: 'iss-water', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'other' }

// P1 ASM Elite is the CHASED project (batch here) → an image about it runs the UNIT today (image_batch i).
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: { 'iss-water': { id: 'iss-water', title: 'waterlogging in basement', project_id: 'P1', status: 'OPEN' } },
  chase_batches: [{ id: 'batch-1', items: [waterBI] }],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const imgCtx = (fake: ReturnType<typeof fakeSupabase>, caption: string) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-img', lang: 'te' as const,
  image: { base64: 'zz', mime: 'image/jpeg', caption, storagePath: PHOTO },
})
const textCtx = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-txt', lang: 'te' as const })

interface Call { system: string; user: string }
const imgModel = (calls: Call[], stubs: { vision?: string; resolve?: string }) =>
  (system: string, user: string): Promise<string> => {
    calls.push({ system, user })
    if (user.startsWith('CANDIDATES:')) return Promise.resolve(stubs.resolve ?? '')
    if (user.includes('Decompose the image')) return Promise.resolve(stubs.vision ?? '')
    return Promise.resolve('')
  }
const VIS = (projectHint: string, items: { type: string; text: string }[]) =>
  JSON.stringify({ project_hint: projectHint, items: items.map((i) => ({ type: i.type, text: i.text, confidence: 'high', task_hint: null, cause: i.type === 'issue' ? 'other' : null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null, qc_statements: [] })) })
const R_CREATE = (detail: string, projectHint: string) => JSON.stringify({
  issue_snag_found: { found: true, items: [{ kind: 'issue', detail, location: null, project_hint: projectHint, confidence: 'high' }] },
  update_found: { found: false, updates: [] },
})

suite('siteops T5 sub-step 2 — the enrichment window joins the unit (Gap C / clause-1 one-pipeline)', () => {
  test('(gapC) photo creates an object via the unit → siteops_photo window opens → a follow-up text enriches it', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []

    // 1) the photo creates a fresh issue through the UNIT (chased project → runSingularUnit).
    await runSiteops(imgCtx(fake, 'ASM Elite cement store'), 'ASM Elite cement store -- soaked bags', {
      callModel: imgModel(calls, { vision: VIS('ASM Elite', [{ type: 'issue', text: 'cement bags soaked' }]), resolve: R_CREATE('cement bags soaked', 'ASM Elite') }),
    })
    expect(fake.writesTo('problems').some((w) => w.op === 'insert')).toBe(true)   // object created (guard)

    // 2) the UNIT must hold an enrichment window over the created object — RED until applyTerminals opens it.
    const win = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_photo')
    expect(!!win).toBe(true)
    const slots = win!.payload.slots_so_far
    expect((slots.object_refs ?? []).some((r: { kind: string; id: string }) => r.kind === 'problem' && r.id === 'problems-1')).toBe(true)
    expect(slots.photo_wamid).toBe('w-img')

    // 3) end-to-end: a follow-up TEXT resumes into that window and ENRICHES the created object (the pin
    //    finishRoute never had) — a description_added trail on the SAME problem, never a fresh twin.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'photo enrichment window', staged_entry_id: null, last_message_id: null, slots_so_far: slots } as any
    await answerSiteops(textCtx(fake), 'the store roof is leaking above the bags', convo)

    expect(fake.trail().some((r) => r.type === 'description_added' && r.problem_id === 'problems-1')).toBe(true)
    expect(fake.writesTo('problems').filter((w) => w.op === 'insert').length).toBe(1)   // enriched, not twinned
  })
})

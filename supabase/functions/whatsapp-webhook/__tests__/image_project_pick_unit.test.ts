// SPRINT 2 · T5 — IMAGES JOIN THE SINGULAR UNIT. Sub-step 4: the siteops_project RESUME joins the unit.
//
// An image with no resolvable site opens an ask-first project pick carrying the photo in its slots (legacy,
// no-`text` slots). Today the resume routes that pick to finishRoute (the second engine) — and finishRoute
// reads ctx.image, which is NULL at resume time (the reply is a text project pick), so the CARRIED PHOTO
// (slots.image) is silently DROPPED and the ladder never runs. This sub-step routes the legacy pick through
// the SINGULAR UNIT and re-hydrates the photo from the slots so it rides the unit's terminals.
//
// RED-FIRST (flips when the resume calls runSingularUnit with the re-hydrated photo): today the object is
// created (finishRoute), but the photo is not attached and the ladder never runs.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const PHOTO = 'wa_919900000000_1.jpg'

// Two active projects → resolveProject never auto-picks; NO batch → no single-project prior. A siteless
// photo therefore has no resolvable project and must ASK first (image-no-project → legacy siteops_project).
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
const textCtx = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-txt', lang: 'te' as const })

interface Call { system: string; user: string }
const imgModel = (calls: Call[], stubs: { vision?: string; resolve?: string }) =>
  (system: string, user: string): Promise<string> => {
    calls.push({ system, user })
    if (user.startsWith('CANDIDATES:')) return Promise.resolve(stubs.resolve ?? '')
    if (user.includes('Decompose the image')) return Promise.resolve(stubs.vision ?? '')
    return Promise.resolve('')
  }
const resolutionCalls = (calls: Call[]) => calls.filter((c) => c.user.startsWith('CANDIDATES:'))
const VIS = (items: { type: string; text: string }[]) =>
  JSON.stringify({ project_hint: null, items: items.map((i) => ({ type: i.type, text: i.text, confidence: 'high', task_hint: null, cause: i.type === 'issue' ? 'other' : null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null, qc_statements: [] })) })
// the picked project is the unit's projectId → project_hint null falls back to it (create on the pick).
const R_CREATE = (detail: string) => JSON.stringify({
  issue_snag_found: { found: true, items: [{ kind: 'issue', detail, location: null, project_hint: null, confidence: 'high' }] },
  update_found: { found: false, updates: [] },
})

suite('siteops T5 sub-step 4 — the siteops_project resume joins the unit (Hazard 2 / clause-1)', () => {
  test('(pick) siteless photo → ask-first → project pick runs the UNIT: object created + photo re-hydrated + ladder ran', async () => {
    const fake = fakeSupabase(seed())

    // 1) a siteless photo → ask-first opens a legacy siteops_project pick carrying the photo (no raw text).
    await runSiteops(imgCtx(fake, ''), 'Image received', {
      callModel: imgModel([], { vision: VIS([{ type: 'issue', text: 'wall crack near stairs' }]) }),
    })
    const projConvo = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    expect(!!projConvo).toBe(true)
    const slots = projConvo!.payload.slots_so_far
    expect(slots.image?.storagePath).toBe(PHOTO)          // the photo is carried in the slots
    expect(typeof slots.text).toBe('undefined')           // legacy slots — no raw text (the finishRoute shape)

    // 2) the supervisor picks the project → the resume must run the UNIT over the carried item + photo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which project?', staged_entry_id: null, last_message_id: null, slots_so_far: slots } as any
    const calls: Call[] = []
    await answerSiteops(textCtx(fake), 'Soundharya', convo, { callModel: imgModel(calls, { resolve: R_CREATE('wall crack near stairs') }) })

    // the object lands on the picked project (green today AND after — the create was never the gap)
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P2')).toBe(true)
    // RED until the cutover — the carried photo (slots.image) must attach to the created object.
    expect(fake.writesTo('attachments').some((w) => w.payload?.object_path === PHOTO && w.payload?.parent_type === 'problem')).toBe(true)
    // RED until the cutover — the LADDER (resolveInbound) must run (finishRoute used resolveTaskLLM).
    expect(resolutionCalls(calls).length).toBe(1)
  })
})

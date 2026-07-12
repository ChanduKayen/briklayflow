// STEPS B + C — THE PHOTO IS GRADED AGAINST THE TASK'S OWN QC CHECKS.
//
// B — the vision pass is SHOWN the authored checks for the open work at this site, and answers what it can
//     SEE. A stated, visible fact lands in qc_statements and confirms its check (step A carries it home).
// C — a photo that CONTRADICTS a check is the issue class that matters. Code disposes, not the model:
//       · a CRITICAL check contradicted  → a tracked, chased issue (confidence high) + the check marked FAILED
//       · a non-critical check           → a visible NOTE (confidence med — recorded, never chased)
//
// WHY THIS IS THE ISSUE ENGINE, and not "look for problems". Asking a vision model to find defects in a
// construction photo asks it to have TASTE, and it answers with nitpicks — unpainted walls, debris, an open
// ceiling grid: work that is simply not finished yet. Graded against a NAMED check, relevance is inherited
// rather than invented: "cover blocks are under ALL slab and beam steel" is a fact a photo can settle, and
// the org already decided it matters. The highest-value ones are the irreversible gates — once the pour is
// down, a missing cover block is permanent.
//
// The QC-failure path is handled by CODE, not routed through the resolver: we already know the check, the
// task and its criticality, so there is nothing to infer — and it keeps the resolver from creating a second,
// duplicate issue for the same defect.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const CRITICAL = 'Cover blocks are under ALL slab and beam steel — no bar is resting directly on the shuttering'
const MINOR = 'Conduits and sleeves are laid in and tied down before the pour, so they cannot float'

const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'The Pride' }],
  problems: {}, chase_batches: [],
  site_tasks: {
    'rebar-second': {
      task_id: 'rebar-second', name: 'Frame — reinforcement (beams & slab)', project_id: 'P1', status: 'OPEN',
      floor_label: 'Second', node_key: 'floor_rebar@Second', task_type_id: 'floor_rebar',
      trade: 'civil', phase: 'structure',
    },
  },
  site_task_qc: [
    { id: 'qc-crit', task_id: 'rebar-second', seq: 1, is_critical: true, qc_status: 'pending', question: CRITICAL },
    { id: 'qc-min', task_id: 'rebar-second', seq: 2, is_critical: false, qc_status: 'pending', question: MINOR },
  ],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})

const CAPTION = 'The Pride second floor slab steel'
const imgCtx = (fake: ReturnType<typeof fakeSupabase>) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const,
  image: { base64: 'x', mime: 'image/jpeg', caption: CAPTION, description: 'slab reinforcement', storagePath: 'rough/x.jpg' },
})

// ── the vision model's answers ───────────────────────────────────────────────────────────────────────
// (a) it SEES the check satisfied → the fact goes in qc_statements
const VIS_CONFIRM = JSON.stringify({
  project_hint: 'The Pride',
  items: [{
    type: 'progress', text: 'Second floor slab steel tied, cover blocks visible under the bars',
    confidence: 'high', task_hint: 'slab reinforcement', structure: null,
    qc_statements: ['cover blocks are in place under the slab and beam steel'],
  }],
})
// (b) it sees the CRITICAL check CONTRADICTED → a qc failure, named by id
const VIS_FAIL_CRITICAL = JSON.stringify({
  project_hint: 'The Pride',
  items: [{
    type: 'issue', text: 'Slab bars are resting directly on the shuttering — no cover blocks under the steel at the near bay',
    confidence: 'high', task_hint: 'slab reinforcement', structure: null, qc_failed: 'qc-crit', cause: 'rework', qc_statements: [],
  }],
})
// (c) a NON-critical check contradicted → recorded, but never chased
const VIS_FAIL_MINOR = JSON.stringify({
  project_hint: 'The Pride',
  items: [{
    type: 'issue', text: 'Conduits are lying loose across the mesh, not tied down',
    confidence: 'high', task_hint: 'slab reinforcement', structure: null, qc_failed: 'qc-min', cause: 'rework', qc_statements: [],
  }],
})

const R_UPDATE = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: 'type:P1:frame reinforcement beams slab', target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'steel tied' }] },
})
const QC_CONFIRM = JSON.stringify({ answers: [{ id: 'qc-crit', answer: 'cover blocks are in place under the slab and beam steel' }] })

interface Call { system: string; user: string }
const model = (calls: Call[], vision: string, qcRaw = JSON.stringify({ answers: [] })) =>
  (system: string, user: string): Promise<string> => {
    calls.push({ system, user })
    if (user.startsWith('TASK:')) return Promise.resolve(qcRaw)
    if (user.startsWith('CANDIDATES:')) return Promise.resolve(R_UPDATE)
    if (user.includes('Decompose the image')) return Promise.resolve(vision)
    return Promise.resolve('')
  }
const visionPrompt = (calls: Call[]) => calls.find((c) => c.user.includes('Decompose the image'))?.user ?? ''
const qcUpdates = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('site_task_qc').filter((w) => w.op === 'update')
const problems = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('problems').filter((w) => w.op === 'insert')

suite('siteops — B: the photo is graded against the task’s authored QC checks', () => {
  test('(B1) the vision pass is SHOWN this site’s open checks, with their ids and which is critical', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(imgCtx(fake), `${CAPTION} -- slab reinforcement`, { callModel: model(calls, VIS_CONFIRM) })

    const p = visionPrompt(calls)
    expect(p.includes(CRITICAL)).toBe(true)       // the check itself, verbatim — not a paraphrase
    expect(p.includes('qc-crit')).toBe(true)      // its id, so a failure can name WHICH check it failed
  })

  test('(B2) a fact the photo SHOWS confirms its check — a photo answers QC, not just a typed report', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake), `${CAPTION} -- slab reinforcement`, { callModel: model([], VIS_CONFIRM, QC_CONFIRM) })

    const w = qcUpdates(fake)
    expect(w.length).toBe(1)
    expect(w[0].filters.some(([k, v]) => k === 'id' && v === 'qc-crit')).toBe(true)
    expect(w[0].payload?.qc_status).toBe('confirmed')
    expect(w[0].payload?.source_narration_id).toBe('narr-1')
  })
})

suite('siteops — C: a contradicted check IS the issue (code disposes, criticality decides)', () => {
  test('(C1) a CRITICAL check contradicted → a tracked, CHASED issue, and the check is marked FAILED', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake), `${CAPTION} -- slab reinforcement`, { callModel: model([], VIS_FAIL_CRITICAL) })

    // the defect is a real, chased problem on the right site
    const p = problems(fake)
    expect(p.length).toBe(1)
    expect(p[0].payload?.project_id).toBe('P1')
    expect(p[0].payload?.confidence).toBe('high')                  // classified → chased
    expect(p[0].payload?.next_followup_at !== null).toBe(true)
    expect(p[0].payload?.cause).toBe('rework')

    // …and the check it failed says so, with the photo's own words as the evidence
    const w = qcUpdates(fake)
    expect(w.length).toBe(1)
    expect(w[0].filters.some(([k, v]) => k === 'id' && v === 'qc-crit')).toBe(true)
    expect(w[0].payload?.qc_status).toBe('failed')
    expect(w[0].payload?.source_narration_id).toBe('narr-1')
  })

  test('(C2) a NON-critical check contradicted → recorded as a note, never chased', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake), `${CAPTION} -- slab reinforcement`, { callModel: model([], VIS_FAIL_MINOR) })

    const p = problems(fake)
    expect(p.length).toBe(1)
    expect(p[0].payload?.confidence).toBe('med')                   // a NOTE: visible, not chased
    expect(p[0].payload?.next_followup_at).toBeNull()
    expect(qcUpdates(fake)[0].payload?.qc_status).toBe('failed')
  })

  test('(C3) the QC failure is created ONCE — code owns it; the resolver never sees it to duplicate it', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake), `${CAPTION} -- slab reinforcement`, { callModel: model([], VIS_FAIL_CRITICAL) })
    expect(problems(fake).length).toBe(1)
  })
})

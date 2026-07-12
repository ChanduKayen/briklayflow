// THE ISSUE FLOOR — a defect the VISION tier identified may never evaporate into "didn't catch".
//
// The vision pass classifies each item (progress | issue | todo) and that verdict reaches the resolver as
// `itemType`. There has always been a code floor for TODO (an instruction is captured, never quizzed back) —
// and none for ISSUE. So the resolution model, which re-decides from scratch, could answer both-false on an
// item the vision tier had already called a DEFECT, and the photo would land as a bare evidence park: no
// problem row, no cause, no chase, nobody told a crack was seen.
//
// A model's judgment needs a code floor under it (the standing lesson). This is that floor:
//
//   itemType 'issue' + both axes false + a known site  →  CREATE the issue. Never an evidence park, never a
//   didn't-catch.
//
// TWO THINGS IT MUST NOT DO:
//   · It must not DUPLICATE a known problem. A model-named MED `nearest` ("did you mean the transformer
//     issue?") is a re-report of something we already track — the recall floor still wins, and asks.
//   · It must not be vetoed by the LEXICAL belt. The image belt matches on raw token overlap ("beam"), so a
//     crack in a beam soffit lexically "nears" the Beams task and would have been answered with "which of
//     these does this photo belong to?" instead of being logged as the defect it is. A spelling coincidence
//     does not outrank a defect.
//
// It CANNOT chase a guess: the vision tier demotes a LOW-confidence issue to a plain progress note upstream
// (_siteops_vision.ts), so an `issue` itemType reaching here was called HIGH by the classifier that saw the
// pixels — which is why the floor creates a classified (chased) issue and not a note.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'
import {
  executeResolution,
  type ResolutionContract, type ResolutionContext, type Terminal, type NearestGuess,
} from '../_siteops_resolution.ts'

const CRACK = 'a diagonal crack about a metre long in the beam soffit at the lift-lobby end'

const bothFalse = (nearest: NearestGuess[] = []): ResolutionContract => ({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: false, updates: [], nearest },
})
const ctxIssue = (o: Partial<ResolutionContext> = {}): ResolutionContext => ({
  candidateIds: new Set(['iss-door', 'type:P1:beams']),
  isImage: true,
  itemType: 'issue',
  sitedProject: 'The Pride',
  message: CRACK,
  taskCoverage: 'open',
  ...o,
})
const created = (t: Terminal[]) => t.find((x) => x.kind === 'object_created')

suite('siteops — the ISSUE floor (a seen defect is never parked as "didn’t catch")', () => {
  test('(IF1) itemType issue + both-false + known site → CREATE the issue, not an evidence park', () => {
    const t = executeResolution(bothFalse(), ctxIssue())
    expect(t.length).toBe(1)
    const c = created(t)
    expect(c?.kind).toBe('object_created')
    if (c?.kind !== 'object_created') throw new Error('no create')
    expect(c.item.kind).toBe('issue')          // a DEFECT, not a planned snag (that is the to-do floor's job)
    expect(c.item.planned ?? false).toBe(false)
    expect(c.item.detail).toBe(CRACK)
    expect(c.item.project_hint).toBe('The Pride')
    expect(c.as).toBe('classified')            // the vision tier already called it high → tracked and chased
    expect(t.some((x) => x.kind === 'queued_as_evidence')).toBe(false)
    expect(t.some((x) => x.kind === 'acked_didnt_catch')).toBe(false)
  })

  test('(IF2) a MED nearest still WINS — a re-report of a known problem asks, it does not duplicate', () => {
    const near: NearestGuess = {
      target_id: 'iss-door', target_kind: 'issue', plausibility: 'med', action: 'progress',
      closure_explicit: false, reason: 'this is the same cracked beam already logged',
    }
    const t = executeResolution(bothFalse([near]), ctxIssue())
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('question_asked')
    expect(t.some((x) => x.kind === 'object_created')).toBe(false)
  })

  test('(IF3) the LEXICAL belt does NOT veto the floor — a shared word is not a placement question', () => {
    // "beam soffit" lexically nears the Beams task; before the floor this asked "which of these is the photo
    // about?" instead of logging the crack.
    const t = executeResolution(bothFalse(), ctxIssue({ nearCandidateIds: ['type:P1:beams'] }))
    expect(created(t)?.kind).toBe('object_created')
    expect(t.some((x) => x.kind === 'question_asked')).toBe(false)
  })

  test('(IF4) NO REGRESSION — a both-false PROGRESS image still parks as evidence (the cautious floor)', () => {
    const t = executeResolution(bothFalse(), ctxIssue({ itemType: 'progress' }))
    expect(t[0].kind).toBe('queued_as_evidence')
    expect(t.some((x) => x.kind === 'object_created')).toBe(false)
  })

  test('(IF5) no site → still ASK which project (never mis-file a defect into the wrong building)', () => {
    const t = executeResolution(bothFalse(), ctxIssue({ sitedProject: null, isImage: false }))
    expect(t.some((x) => x.kind === 'object_created')).toBe(false)
  })
})

// ── THE JOURNEY: one photo, one progress report AND one defect ───────────────────────────────────────────
const ORG = 'org-1'
const SENDER = '919900000000'
const CAPTION = 'The pride 4th floor corridor'
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'The Pride' }],
  problems: {}, chase_batches: [],
  site_tasks: {
    'fcf-fourth': { task_id: 'fcf-fourth', name: 'False-ceiling frame', project_id: 'P1', status: 'OPEN', floor_label: 'Fourth', node_key: 'n1', trade: 'ceiling', phase: 'services' },
  },
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const CEILING = 'The Pride 4th floor corridor: false-ceiling frame is up over the corridor.'
const VISION_BOTH = JSON.stringify({
  project_hint: 'The Pride',
  items: [
    { type: 'progress', text: CEILING, confidence: 'high', task_hint: 'ceiling', structure: null, qc_statements: [] },
    { type: 'issue', text: CRACK, confidence: 'high', task_hint: 'beam', structure: null, cause: 'rework', qc_statements: [] },
  ],
})
const R_UPDATE = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: 'type:P1:false ceiling frame', target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'frame up' }] },
})
// the resolution model MISSES the defect its own vision tier saw — both axes false. The floor must catch it.
const R_BOTH_FALSE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [], nearest: [] } })
const model = (system: string, user: string): Promise<string> => {
  if (user.startsWith('CANDIDATES:')) return Promise.resolve(/crack/i.test(user) ? R_BOTH_FALSE : R_UPDATE)
  if (user.includes('Decompose the image')) return Promise.resolve(VISION_BOTH)
  return Promise.resolve('')
}

suite('siteops — one photo, a progress report AND a defect (both land)', () => {
  test('(IJ1) the ceiling updates its task AND the crack becomes a problem row — neither eats the other', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops({
      supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const,
      image: { base64: 'x', mime: 'image/jpeg', caption: CAPTION, description: 'corridor ceiling', storagePath: 'rough/x.jpg' },
    }, `${CAPTION} -- corridor ceiling`, { callModel: model })

    // the progress half landed on the task…
    const taskWrites = fake.writesTo('site_tasks').filter((w) => w.op === 'update' && w.filters.some(([k, v]) => k === 'task_id' && v === 'fcf-fourth'))
    expect(taskWrites.length).toBe(1)
    // …and the defect half became a real, tracked problem (the floor), on the right site
    const probs = fake.writesTo('problems').filter((w) => w.op === 'insert')
    expect(probs.length).toBe(1)
    expect(probs[0].payload?.project_id).toBe('P1')
    expect(probs[0].payload?.kind).toBe('issue')
    expect(probs[0].payload?.confidence).toBe('high')       // classified → chased, not a silent note
    expect(probs[0].payload?.next_followup_at !== null).toBe(true)
  })
})

// STEP A — A REPORT CAN ANSWER A QC CHECK AGAIN.
//
// Every task carries authored QC checks (engine library → persistGraph fan-out). `matchQc` in
// _siteops_route.ts is the strict matcher that turns a supervisor's own stated FACT into a confirmed
// check — it refuses vague praise ("slab looks good" does not answer "cast continuous, no cold joint")
// and records provenance: the answer text, the status, and the narration that confirmed it.
//
// IT HAS BEEN DEAD. The v2 resolution executor builds its own SiteItem to apply progress with, and
// hard-codes `qc_statements: []` (siteops.ts). matchQc opens with `if (!qc.length || !statements.length)
// return []` — so it returned empty on EVERY message, for text and image alike. The extractor pulled
// "poured continuous" out of the message and the executor threw it on the floor.
//
// Two things this pins:
//   · the statements the extractor found REACH the apply, and a stated fact confirms its check;
//   · vague praise still confirms NOTHING (the matcher's strictness is not softened to make this pass).
//
// The QC matcher gets an INJECTED model door here (it used to reach for env keys and fetch directly,
// which made it unprovable offline — a matcher nobody could test is how it stayed dead for so long).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'

const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'The Pride' }],
  problems: {}, chase_batches: [],
  site_tasks: {
    'pour-second': {
      task_id: 'pour-second', name: 'Frame — slab & beam pour', project_id: 'P1', status: 'OPEN',
      floor_label: 'Second', node_key: 'floor_pour@Second', task_type_id: 'floor_pour',
      trade: 'civil', phase: 'structure',
    },
  },
  // the authored checks, as persistGraph fans them out onto the task
  site_task_qc: [
    { id: 'qc1', task_id: 'pour-second', seq: 1, is_critical: true, qc_status: 'pending', question: 'The beams and slab are poured in ONE continuous operation — no cold joint anywhere in the deck' },
    { id: 'qc2', task_id: 'pour-second', seq: 2, is_critical: false, qc_status: 'pending', question: 'The concrete is vibrated/compacted and the surface levelled to the marked level' },
    { id: 'qc3', task_id: 'pour-second', seq: 3, is_critical: false, qc_status: 'pending', question: 'Curing is started within the specified time and kept up' },
  ],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})

const ctx = (fake: ReturnType<typeof fakeSupabase>) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const,
})

// decompose returns the checkable FACT the supervisor stated, in qc_statements — as it always has.
const decomposed = (qc: string[]) => JSON.stringify({
  project_hint: 'The Pride',
  items: [{
    type: 'progress', text: 'second floor slab poured', task_hint: 'second floor slab',
    structure: { floor: 'Second', unit: null, all: false, except: null },
    qc_statements: qc, cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null,
  }],
})
const R_UPDATE = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: 'type:P1:frame slab beam pour', target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'slab poured' }] },
})
// the QC matcher's own door: it confirms ONLY when a statement states the check's fact.
const QC_ANSWER = JSON.stringify({ answers: [{ id: 'qc1', answer: 'poured continuous, no cold joint' }] })
const QC_NONE = JSON.stringify({ answers: [] })

const model = (qc: string[], qcRaw: string) => (system: string, user: string): Promise<string> => {
  if (user.startsWith('TASK:')) return Promise.resolve(qcRaw)          // the QC matcher's prompt shape
  if (user.startsWith('CANDIDATES:')) return Promise.resolve(R_UPDATE)  // the resolver
  return Promise.resolve(decomposed(qc))                                // decompose
}
const qcWrites = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('site_task_qc').filter((w) => w.op === 'update')

suite('siteops — a report ANSWERS its task’s QC check (step A: the statements reach the apply)', () => {
  test('(QC1) a stated fact confirms its check — with the answer text and the narration that said it', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctx(fake), 'second floor slab poured, cast continuous — no cold joint', {
      callModel: model(['poured continuous, no cold joint'], QC_ANSWER),
    })

    const w = qcWrites(fake)
    expect(w.length).toBe(1)
    expect(w[0].filters.some(([k, v]) => k === 'id' && v === 'qc1')).toBe(true)
    expect(w[0].payload?.qc_status).toBe('confirmed')
    expect(w[0].payload?.answer).toBe('poured continuous, no cold joint')
    expect(w[0].payload?.source_narration_id).toBe('narr-1')   // provenance: WHICH message confirmed it
  })

  test('(QC2) no stated fact → nothing to match → no check is touched', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctx(fake), 'second floor slab poured', { callModel: model([], QC_NONE) })
    expect(qcWrites(fake).length).toBe(0)
  })

  test('(QC3) vague praise confirms NOTHING — the matcher’s strictness is not softened to pass a test', async () => {
    const fake = fakeSupabase(seed())
    // the extractor DID find a statement, but it states no checkable fact — the matcher answers []
    await runSiteops(ctx(fake), 'second floor slab poured, looks good', {
      callModel: model(['looks good'], QC_NONE),
    })
    expect(qcWrites(fake).length).toBe(0)
  })
})

// GAP 1 — THE QC EVIDENCE MUST SURVIVE THE QUESTION.
//
// When a report is ambiguous we ASK ("which of these is it about?"), the supervisor taps the right task, and
// the resume applies the progress. But the resume called applyTaskProgressById WITHOUT the QC thread — so
// every checkable fact the message or the photo carried was thrown away at exactly the moment we finally
// knew which task it belonged to. The checks stayed pending.
//
// This is the case the quality axis hits MOST, not least: a photo of slab steel is precisely the kind of
// thing that ties between two task types, so precisely the kind of thing that gets asked about. Evidence
// that survives only the unambiguous path is evidence that arrives when it is least needed.
//
// The statements ride the pending ask's slots (the same place the piece text, the photo and the held verdict
// already ride) and are applied by the answer.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const CHECK = 'Cover blocks are under ALL slab and beam steel — no bar is resting directly on the shuttering'

// two REAL task types that tie on "second floor steel" — the ask is the only correct output
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'The Pride' }],
  problems: {}, chase_batches: [],
  site_tasks: {
    'rebar-second': { task_id: 'rebar-second', name: 'Frame — reinforcement (beams & slab)', project_id: 'P1', status: 'OPEN', floor_label: 'Second', node_key: 'floor_rebar@Second', task_type_id: 'floor_rebar', trade: 'civil', phase: 'structure' },
    'shutter-second': { task_id: 'shutter-second', name: 'Frame — shuttering (beams & slab)', project_id: 'P1', status: 'OPEN', floor_label: 'Second', node_key: 'floor_shutter@Second', task_type_id: 'floor_shutter', trade: 'civil', phase: 'structure' },
  },
  site_task_qc: [
    { id: 'qc-crit', task_id: 'rebar-second', seq: 1, is_critical: true, qc_status: 'pending', question: CHECK },
  ],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const ctx = (fake: ReturnType<typeof fakeSupabase>) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const,
})

const STATEMENT = 'cover blocks are in place under the slab and beam steel'
const DECOMPOSED = JSON.stringify({
  project_hint: 'The Pride',
  items: [{
    type: 'progress', text: 'second floor steel work done, cover blocks in',
    structure: { floor: 'Second', unit: null, all: false, except: null },
    qc_statements: [STATEMENT], task_hint: 'second floor steel',
    cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null,
  }],
})
// the resolver can't choose between the two real types — it names one and ties the other. The ONLY correct
// output is the question.
const R_TIE = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{
    target_id: 'type:P1:frame reinforcement beams slab', target_kind: 'task', action: 'progress',
    confidence: 'high', closure_explicit: false, reason: 'steel work done',
    alt_target_ids: ['type:P1:frame shuttering beams slab'],
  }] },
})
const QC_CONFIRM = JSON.stringify({ answers: [{ id: 'qc-crit', answer: STATEMENT }] })

const model = (system: string, user: string): Promise<string> => {
  if (user.startsWith('TASK:')) return Promise.resolve(QC_CONFIRM)
  if (user.startsWith('CANDIDATES:')) return Promise.resolve(R_TIE)
  return Promise.resolve(DECOMPOSED)
}
const qcUpdates = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('site_task_qc').filter((w) => w.op === 'update')

suite('siteops — the QC evidence survives the which_item question (gap 1)', () => {
  test('(QP1) ambiguous report → ASK; the answer applies the progress AND confirms the check the message stated', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctx(fake), 'second floor steel work done, cover blocks in', { callModel: model })

    // the tie asked, and nothing was applied yet
    expect(fake.outbox().some((b) => b.includes('❓'))).toBe(true)
    expect(qcUpdates(fake).length).toBe(0)

    // the statements were carried INTO the open pick's slots — they are what the answer will apply
    const conv = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
    if (!conv) throw new Error('no which_item convo opened')
    const slots = conv.payload.slots_so_far as Record<string, unknown>
    expect((slots.qc_statements as string[])?.includes(STATEMENT)).toBe(true)

    // he taps the reinforcement task → the progress lands AND the check it stated is confirmed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convoRow: any = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which item?', staged_entry_id: null, last_message_id: null, slots_so_far: slots }
    await answerSiteops(ctx(fake), '1', convoRow, { callModel: model })

    const w = qcUpdates(fake)
    expect(w.length).toBe(1)
    expect(w[0].filters.some(([k, v]) => k === 'id' && v === 'qc-crit')).toBe(true)
    expect(w[0].payload?.qc_status).toBe('confirmed')
    expect(w[0].payload?.answer).toBe(STATEMENT)
    expect(w[0].payload?.source_narration_id).toBe('narr-1')   // provenance survives the question too
  })
})

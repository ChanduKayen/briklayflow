// SPRINT 2 · T6 concern 2 — NOTE FLOOR at the executor (clause 4: "uncertain → note, never a confident
// wrong issue"). planObserve grades a low/med new item as as:'note' + upgradeOffer, but the executor
// ignored the grading and created a FULL chased issue — an uncertain observation became a confident,
// person-chasing issue, exactly what the floor exists to prevent.
//
// THE FIX (ruling 2): thread confidence to createProblem; RECORD it; GATE the chase — high →
// next_followup_at scheduled; low/med → next_followup_at NULL (exists, visible, NOT chased) + an upgrade
// offer in the readback. No new gate field (reuse the scheduler's null semantics). RED-FIRST: today
// createProblem always schedules a follow-up regardless of confidence.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { applyTerminals, type ExecCtx } from '../_agents/siteops.ts'
import type { Terminal } from '../_siteops_resolution.ts'
import type { BatchItem } from '../_siteops_batch.ts'

const ORG = 'org-1'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const execCtx = (): ExecCtx => ({ itemsById: new Map<string, BatchItem>(), labelById: new Map(), cadenceMap: new Map(), actorId: null, now: new Date('2026-07-07T00:00:00Z'), narrationId: 'narr-1', projectId: 'P1' })
const seed = (): Seed => ({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })

// object_created carrying the ladder's grading: HIGH → classified (chased); LOW/MED → note (upgradeOffer).
const tCreate = (confidence: 'high' | 'med' | 'low', detail: string): Terminal =>
  ({ kind: 'object_created', item: { kind: 'issue', detail, location: null, project_hint: 'ASM Elite', confidence }, as: confidence === 'high' ? 'classified' : 'note', upgradeOffer: confidence !== 'high', reason: '' } as Terminal)

const problemInsert = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('problems').find((w) => w.op === 'insert')

suite('siteops T6 — the note floor: low/med new items are recorded but NOT chased (clause 4)', () => {
  // j3 — a LOW-confidence new item: the row EXISTS (never dropped), confidence is recorded, and the chase
  // is GATED OFF (next_followup_at null) so the scheduler never chases a guess; the readback offers upgrade.
  test('(j3) low-confidence new item → row exists, confidence recorded, next_followup_at NULL (not chased), upgrade offered', async () => {
    const fake = fakeSupabase(seed())
    await applyTerminals(ctxFor(fake), [tCreate('low', 'maybe a hairline crack near the column')], execCtx())

    const ins = problemInsert(fake)
    expect(!!ins).toBe(true)                              // recorded, never dropped
    expect(ins!.payload?.confidence).toBe('low')          // the grade is on the row
    expect(ins!.payload?.next_followup_at).toBe(null)     // GATED OFF — the scheduler never chases it
    // the upgrade offer surfaces in the readback (a low/med note asks the human to confirm before tracking)
    expect(fake.outbox().some((b) => /confirm to track|possible issue/i.test(b))).toBe(true)
  })

  // j4 (guard) — a HIGH-confidence new item is a full issue: confidence recorded, chase ACTIVE (scheduled).
  test('(j4) high-confidence new item → confidence recorded, next_followup_at SCHEDULED (chased)', async () => {
    const fake = fakeSupabase(seed())
    await applyTerminals(ctxFor(fake), [tCreate('high', 'waterlogging flooding the basement')], execCtx())

    const ins = problemInsert(fake)
    expect(!!ins).toBe(true)
    expect(ins!.payload?.confidence).toBe('high')
    expect(typeof ins!.payload?.next_followup_at).toBe('string')   // a real schedule → chased
  })
})

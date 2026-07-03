// UNIFIED INBOUND RESOLUTION v2 — EXECUTOR Layer 2a gate (effectful, wiring → journey-tested). Drives the
// real applyTerminals over the fake supabase. The seams the single-terminal case can't cover: a FAILED
// effect must be PARKED (honest-reply AND actually-preserved — never an eat wearing an apology), the
// combined readback must tell the truth about a partial failure, and assertAllApplied must treat a
// failed-but-parked terminal as ACCOUNTED (a valid outcome), only throwing when an effect VANISHES.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { applyTerminals, type ExecCtx } from '../_agents/siteops.ts'
import type { Terminal, AttachUpdate } from '../_siteops_resolution.ts'
import type { BatchItem } from '../_siteops_batch.ts'

const ORG = 'org-1'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const execCtx = (itemsById: Map<string, BatchItem> = new Map()): ExecCtx => ({ itemsById, cadenceMap: new Map(), actorId: null, now: new Date('2026-07-03T00:00:00Z'), narrationId: 'narr-1' })

const waterItem: BatchItem = { kind: 'issue', id: 'iss-water', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'other' }
const upd = (o: Partial<AttachUpdate> & { target_id: string }): AttachUpdate => ({ target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'done', ...o })
const tUpdateResolve = (target_id: string): Terminal => ({ kind: 'object_updated', update: upd({ target_id }), applied: 'resolve', undo: true, readback: '', reason: '' })
const tCreate = (detail: string, project_hint: string | null): Terminal => ({ kind: 'object_created', item: { kind: 'issue', detail, location: null, project_hint, confidence: 'high' }, as: 'classified', upgradeOffer: false, reason: '' })

suite('siteops resolution v2 — executor applyTerminals (effects, honest readback, failed-parks)', () => {
  // object_updated resolve → the issue is RESOLVED (via force — NO re-judge) and the reply confirms it.
  test('(E1) object_updated resolve → problems RESOLVED + "✓ … resolved" readback', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })
    await applyTerminals(ctxFor(fake), [tUpdateResolve('iss-water')], execCtx(new Map([['iss-water', waterItem]])))

    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')).toBe(true)
    expect(fake.outbox().some((b) => /resolved/i.test(b))).toBe(true)
  })

  // A FAILED object_created (project unresolvable) must PARK to siteops_unplaced AND read back honestly —
  // "saved for review" is true because the observation actually survives.
  test('(E2) object_created fails → parked to siteops_unplaced + honest "couldn\'t log … saved for review"', async () => {
    const fake = fakeSupabase({ projects: [] })   // no projects → resolveProject null → create throws → park
    await applyTerminals(ctxFor(fake), [tCreate('tiles broke', 'ASM Elite')], execCtx())

    const park = fake.writesTo('siteops_unplaced')
    expect(park.length).toBe(1)
    expect(park[0].payload?.reason).toBe('v2_effect_failed')
    expect(park[0].payload?.observation).toBe('tiles broke')                 // preserved, not dropped
    expect(fake.outbox().some((b) => /couldn't log tiles broke — saved for review/i.test(b))).toBe(true)
  })

  // PARTIAL FAILURE in one message: resolve lands, create fails. The ONE reply tells the truth about BOTH,
  // resolve first (consequence order), and the failed half is parked.
  test('(E3) both-axes partial (resolve ok + create fails) → truthful combined readback + park', async () => {
    const fake = fakeSupabase({ projects: [] })   // create will fail; resolve still applies
    const outcomes = await applyTerminals(ctxFor(fake), [tUpdateResolve('iss-water'), tCreate('tiles broke', 'ASM Elite')], execCtx(new Map([['iss-water', waterItem]])))

    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')).toBe(true)
    expect(fake.writesTo('siteops_unplaced').length).toBe(1)                  // the failed half parked
    const reply = fake.outbox().find((b) => /Got it/i.test(b)) ?? ''
    expect(/✓ waterlogging in basement resolved/.test(reply)).toBe(true)      // resolve first
    expect(/⚠️ couldn't log tiles broke — saved for review/.test(reply)).toBe(true)
    // assertAllApplied did NOT throw: a failed-but-parked terminal is ACCOUNTED, not vanished.
    expect(outcomes.length).toBe(2)
    expect(outcomes.filter((o) => o.status === 'failed').length).toBe(1)
  })
})

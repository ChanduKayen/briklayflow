// SPRINT 2 · T6 concern 3 (relocated) — COMPOUND PARTIAL-FAILURE floor: a mixed success+failure compound
// must APPLY the success, PARK the failure (exactly one row carrying its payload), and PASS assertAllApplied
// — never throw past an unparked failure into a silent eat. Diagnostic-first: the board reports reality.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { applyTerminals, type ExecCtx } from '../_agents/siteops.ts'
import type { Terminal } from '../_siteops_resolution.ts'
import type { BatchItem } from '../_siteops_batch.ts'

const ORG = 'org-1'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: ORG, wamid: 'w-1', lang: 'te' as const })
// projectId null → an object_created whose project_hint doesn't resolve throws 'project unresolved' (a real failure).
const execCtx = (): ExecCtx => ({ itemsById: new Map<string, BatchItem>(), labelById: new Map(), cadenceMap: new Map(), actorId: null, now: new Date('2026-07-07T00:00:00Z'), narrationId: 'narr-1', projectId: null })
// TWO projects → resolveProject never auto-picks, so a non-matching project_hint genuinely fails to resolve.
const seed = (): Seed => ({ projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }] })

const tCreate = (kind: 'issue' | 'snag', detail: string, project_hint: string): Terminal =>
  ({ kind: 'object_created', item: { kind, detail, location: null, project_hint, confidence: 'high' }, as: 'classified', upgradeOffer: false, reason: '' } as Terminal)
const tUpdateMissing = (target_id: string): Terminal =>
  ({ kind: 'object_updated', update: { target_id, target_kind: 'issue', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'progress on it' }, applied: 'addressing', undo: false, readback: '', reason: '' } as Terminal)

suite('siteops T6 — compound partial-failure: apply the success, park the failure, pass the assert', () => {
  // A compound where the FIRST terminal FAILS (create at an unresolvable project) and the SECOND SUCCEEDS
  // (a snag at a real project). Floor: the snag lands, the failure parks ONCE, assertAllApplied passes,
  // and a readback goes out — never a silent eat.
  test('(cpf-1) [create FAILS · snag SUCCEEDS] → snag created, 1 park for the failure, readback sent', async () => {
    const fake = fakeSupabase(seed())
    await applyTerminals(ctxFor(fake), [tCreate('issue', 'cracked beam, site unknown', 'Nowhere Site'), tCreate('snag', 'chipped tile 2F', 'ASM Elite')], execCtx())

    const problems = fake.writesTo('problems').filter((w) => w.op === 'insert')
    const parks = fake.writesTo('siteops_unplaced')
    expect(problems.length).toBe(1)                                  // the SUCCESS applied
    expect(problems[0].payload?.kind).toBe('snag')                  // …as the snag it is
    expect(parks.length).toBe(1)                                    // the FAILURE parked, exactly once
    expect(fake.outbox().length).toBe(1)                            // a readback went out (no eat)
  })

  // The object_updated FAILURE angle specifically: a non-applicable update (target not offered) is HELD +
  // parked, while the compound's snag still lands and the assert passes.
  test('(cpf-2) [update HELD/parked · snag SUCCEEDS] → snag created, 1 park for the update, readback sent', async () => {
    const fake = fakeSupabase(seed())
    await applyTerminals(ctxFor(fake), [tUpdateMissing('iss-not-offered'), tCreate('snag', 'honeycombing on the column', 'ASM Elite')], execCtx())

    const problems = fake.writesTo('problems').filter((w) => w.op === 'insert')
    const parks = fake.writesTo('siteops_unplaced')
    expect(problems.length).toBe(1)
    expect(problems[0].payload?.kind).toBe('snag')
    expect(parks.length).toBe(1)
    expect(fake.outbox().length).toBe(1)
  })
})

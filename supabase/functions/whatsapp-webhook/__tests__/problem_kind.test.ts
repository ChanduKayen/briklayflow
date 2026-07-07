// SPRINT 2 · T6 — KIND FIDELITY at the executor bridge (clause 3: issue/snag are DISTINCT kinds).
//
// THE DEVIATION: the planner distinguishes issue vs snag (ObserveItem.kind), but the executor bridge
// toSiteItem (siteops.ts) hardcodes type:'issue' → routeGroup → createProblem writes a `problems` row with
// NO kind, so a found SNAG is stored as a generic issue. Kind fidelity lost between plan and write.
//
// THE FIX (ruling 1): problems gains a `kind` column ('issue'|'snag', default 'issue' — same table, no
// fork); the planner's kind flows toSiteItem → createProblem → the row. RED-FIRST: today createProblem
// writes no kind, so the payload has none.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { applyTerminals, type ExecCtx } from '../_agents/siteops.ts'
import type { Terminal } from '../_siteops_resolution.ts'
import type { BatchItem } from '../_siteops_batch.ts'

const ORG = 'org-1'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const execCtx = (): ExecCtx => ({ itemsById: new Map<string, BatchItem>(), labelById: new Map(), cadenceMap: new Map(), actorId: null, now: new Date('2026-07-07T00:00:00Z'), narrationId: 'narr-1', projectId: 'P1' })
const seed = (): Seed => ({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })

// object_created carrying the planner's KIND (issue|snag) — the bridge must preserve it to the row.
const tCreate = (kind: 'issue' | 'snag', detail: string): Terminal =>
  ({ kind: 'object_created', item: { kind, detail, location: null, project_hint: 'ASM Elite', confidence: 'high' }, as: 'classified', upgradeOffer: false, reason: '' } as Terminal)

const problemInsert = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('problems').find((w) => w.op === 'insert')

suite('siteops T6 — kind fidelity: a found snag is stored AS a snag (clause 3)', () => {
  // j1 — a found SNAG must land as a problems row with kind='snag', not flattened to a generic issue.
  test('(j1) object_created snag → problems row kind=snag (not flattened to issue)', async () => {
    const fake = fakeSupabase(seed())
    await applyTerminals(ctxFor(fake), [tCreate('snag', 'cracked floor tile 2F')], execCtx())

    const ins = problemInsert(fake)
    expect(!!ins).toBe(true)
    expect(ins!.payload?.kind).toBe('snag')
  })

  // j2 (guard) — a found ISSUE stays kind='issue'; the fix must not flatten the OTHER direction.
  test('(j2) object_created issue → problems row kind=issue (guard, unchanged behaviour)', async () => {
    const fake = fakeSupabase(seed())
    await applyTerminals(ctxFor(fake), [tCreate('issue', 'waterlogging in basement')], execCtx())

    const ins = problemInsert(fake)
    expect(!!ins).toBe(true)
    expect(ins!.payload?.kind).toBe('issue')
  })
})

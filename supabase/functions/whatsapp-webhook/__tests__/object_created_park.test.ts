// SPRINT 2 · T6 concern 3 — the ONE-PARK INVARIANT for a failed object_created (the no-drop / no-double
// floor). A failed create must leave EXACTLY ONE recoverable siteops_unplaced row: zero = a silent drop
// (the observation is lost), two = a double-write (the same observation parked twice). The invariant is
// the fixed point; this board reports reality against it — no fabricated failure, no forced red.
//
// j5 drives the REALISTIC failure: object_created whose project can't be resolved (no project_hint, no
// ex.projectId) → the executor throws 'project unresolved' → the catch must park it, once.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { applyTerminals, type ExecCtx } from '../_agents/siteops.ts'
import type { Terminal } from '../_siteops_resolution.ts'
import type { BatchItem } from '../_siteops_batch.ts'

const ORG = 'org-1'
const PHOTO = 'wa_919900000000_1.jpg'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const imgCtxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: ORG, wamid: 'w-1', lang: 'te' as const, image: { base64: 'zz', mime: 'image/jpeg', caption: 'ASM Elite', storagePath: PHOTO } })
const execCtxP1 = (): ExecCtx => ({ itemsById: new Map<string, BatchItem>(), labelById: new Map(), cadenceMap: new Map(), actorId: null, now: new Date('2026-07-07T00:00:00Z'), narrationId: 'narr-1', projectId: 'P1' })
const seedP1 = (): Seed => ({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })
// NO projectId in the exec ctx AND the terminal names no resolvable project → 'project unresolved'.
const execCtxNoProject = (): ExecCtx => ({ itemsById: new Map<string, BatchItem>(), labelById: new Map(), cadenceMap: new Map(), actorId: null, now: new Date('2026-07-07T00:00:00Z'), narrationId: 'narr-1', projectId: null })
const seedNoProjects = (): Seed => ({ projects: [] })   // resolveProject finds nothing → pid null → throw

const tCreate = (detail: string): Terminal =>
  ({ kind: 'object_created', item: { kind: 'issue', detail, location: null, project_hint: 'Nowhere Site', confidence: 'high' }, as: 'classified', upgradeOffer: false, reason: '' } as Terminal)

suite('siteops T6 — object_created failure parks exactly once (no drop, no double)', () => {
  test('(j5) project-unresolved create → EXACTLY ONE siteops_unplaced row', async () => {
    const fake = fakeSupabase(seedNoProjects())
    await applyTerminals(ctxFor(fake), [tCreate('cracked beam, site unknown')], execCtxNoProject())

    const parks = fake.writesTo('siteops_unplaced')
    // no object was actually created (the failure), and the observation survives exactly once.
    expect(fake.writesTo('problems').filter((w) => w.op === 'insert').length).toBe(0)
    expect(parks.length).toBe(1)
  })

  // j5b — THE TWO-SEQUENTIAL-EFFECTS SEAM (create then evidence-attach). An IMAGE create that SUCCEEDS
  // must NOT double-record: exactly ONE problem, its ONE attachment, and ZERO parks (the observation is
  // logged once, not also parked).
  test('(j5b) image object_created success → 1 problem + 1 attachment + ZERO parks (no double-record)', async () => {
    const fake = fakeSupabase(seedP1())
    await applyTerminals(imgCtxFor(fake), [tCreate('cracked beam on 2F')], execCtxP1())

    const problems = fake.writesTo('problems').filter((w) => w.op === 'insert')
    const attachments = fake.writesTo('attachments').filter((w) => w.payload?.object_path === PHOTO)
    const parks = fake.writesTo('siteops_unplaced')
    expect(problems.length).toBe(1)
    expect(attachments.length).toBe(1)
    expect(parks.length).toBe(0)                 // created ⇒ NOT parked (no create+park double-record)
  })

  // j5c — the same seam under FAILURE: an IMAGE create whose project can't resolve throws BEFORE any
  // create side-effect → exactly ONE park carrying the photo, and ZERO problems (parked once, evidence
  // preserved, never also created).
  test('(j5c) image object_created failure (project unresolved) → 1 park carrying the photo, 0 problems', async () => {
    const fake = fakeSupabase(seedNoProjects())
    await applyTerminals(imgCtxFor(fake), [tCreate('cracked beam, site unknown')], execCtxNoProject())

    const parks = fake.writesTo('siteops_unplaced')
    expect(fake.writesTo('problems').filter((w) => w.op === 'insert').length).toBe(0)
    expect(parks.length).toBe(1)
  })
})

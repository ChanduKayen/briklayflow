// ONE SPOKEN THOUGHT = ONE ITEM (live failure 2026-07-11).
//
// The supervisor said, in one breath: "dust is collecting in the gap between the tiles where the epoxy goes;
// the epoxy must only go in after the dust is cleaned; check whether they did that."
//
// Decompose split it into THREE items — an issue, a remedy to-do, and a verification to-do — and each was
// then resolved in isolation against a candidate set rebuilt per item. The result the supervisor saw:
//   · TWO problem rows for one fact ("Dust is accumulating…" AND "Epoxy should be applied only after…"),
//     because the remedy item never knew its own cause had just been logged one second earlier; and
//   · a which_item pick offering him an ISSUE — the recall floor asking "did you mean: Epoxy should be
//     applied only after cleaning dust?" about the very snag its sibling item had just created.
//
// Two rules, pinned here:
//   (a) THE FOLD — an item that REFINES an earlier one (its remedy, or a request to verify it) is folded
//       INTO that item. A remedy merges its words; a check is the parent's chase, which the parent already
//       has. One thought, one row. Nothing is asked about it.
//   (b) THE TO-DO FLOOR — a to-do is NEW WORK the supervisor is assigning. It never falls to the recall
//       floor's "which of these existing items did you mean?" quiz; it becomes a row.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { decompose, type SiteItem } from '../_siteops_extract.ts'
import { executeResolution, type ResolutionContract, type ResolutionContext } from '../_siteops_resolution.ts'
import { runSiteops } from '../_agents/siteops.ts'

// ── (a) THE FOLD (decompose) ──────────────────────────────────────────────────────────────────────────────
const item = (o: Partial<SiteItem> & { type: SiteItem['type']; text: string }) => ({
  task_hint: null, qc_statements: [], cause: o.type === 'issue' ? 'other' : null, cause_reason: null,
  owner_hint: null, date_hint: null, project_hint: null, ...o,
})
const decModel = (items: unknown[]) => () => Promise.resolve(JSON.stringify({ project_hint: 'ASM Elite', items }))

suite('siteops — the FOLD: a remedy and a check belong to the item they refine', () => {
  test('(F1) issue + its remedy + "check they did it" → ONE item, remedy merged, check folded away', async () => {
    const { items } = await decompose('epoxy story', [], decModel([
      item({ type: 'issue', text: 'dust is accumulating in the gap between tiles where epoxy is applied' }),
      item({ type: 'todo', text: 'apply epoxy only after cleaning the dust', refines: 0, refines_as: 'remedy' }),
      item({ type: 'todo', text: 'check whether epoxy was applied after cleaning dust', refines: 0, refines_as: 'check' }),
    ]))

    expect(items.length).toBe(1)
    expect(items[0].type).toBe('issue')
    expect(items[0].text).toBe('dust is accumulating in the gap between tiles where epoxy is applied — apply epoxy only after cleaning the dust')
  })

  // A deadline on the remedy is the ISSUE's deadline once they are one item — never lost with the fold.
  test('(F2) the remedy\'s deadline rides into the parent', async () => {
    const { items } = await decompose('n', [], decModel([
      item({ type: 'issue', text: 'bathroom tiles not fixed correctly' }),
      item({ type: 'todo', text: 'redo them', refines: 0, refines_as: 'remedy', date_hint: 'monday' }),
    ]))
    expect(items.length).toBe(1)
    expect(items[0].date_hint).toBe('monday')
  })

  // A PROGRESS report spawns no row, so there is nothing to fold into: "check how the external flooring is"
  // stays its own to-do (and rule (b) turns it into a row rather than a quiz).
  test('(F3) a check on a PROGRESS item stays standalone (no row to fold into)', async () => {
    const { items } = await decompose('n', [], decModel([
      item({ type: 'progress', text: 'external flooring done' }),
      item({ type: 'todo', text: 'check how the external flooring is', refines: 0, refines_as: 'check' }),
    ]))
    expect(items.length).toBe(2)
    expect(items[1].text).toBe('check how the external flooring is')
  })

  // An UNUSABLE marker is not a licence to lose a fact. A forward/self reference, an out-of-range index, or a
  // missing refines_as → the item stands alone. An unfolded item is a row; a wrongly-folded one is a loss.
  test('(F4) a bad refines marker leaves the item standing (never a silent loss)', async () => {
    const { items } = await decompose('n', [], decModel([
      item({ type: 'issue', text: 'wiring broke' }),
      item({ type: 'todo', text: 'call the electrician', refines: 5, refines_as: 'remedy' }),   // out of range
      item({ type: 'todo', text: 'buy new wire', refines: 0 }),                                 // no refines_as
      item({ type: 'todo', text: 'ask the vendor', refines: 3, refines_as: 'remedy' }),         // self-reference
    ]))
    expect(items.length).toBe(4)
  })
})

// ── (b) THE TO-DO FLOOR (the planner) ─────────────────────────────────────────────────────────────────────
const BOTH_FALSE_WITH_NEAREST: ResolutionContract = {
  issue_snag_found: { found: false, items: [] },
  update_found: {
    found: false, updates: [],
    nearest: [{ target_id: 'iss-epoxy', target_kind: 'issue', plausibility: 'med', action: 'progress', closure_explicit: false, reason: 'relates to the epoxy issue' }],
  },
}
const baseCtx = (o: Partial<ResolutionContext> = {}): ResolutionContext => ({
  candidateIds: new Set(['iss-epoxy']), isImage: false, sitedProject: 'ASM Elite', message: 'check whether epoxy was applied after cleaning dust', ...o,
})

suite('siteops — the TO-DO FLOOR: assigned work becomes a row, never a quiz', () => {
  test('(T1) itemType=todo, both-false with a nearest → object_created, never a which_item ask', () => {
    const terminals = executeResolution(BOTH_FALSE_WITH_NEAREST, baseCtx({ itemType: 'todo' }))

    expect(terminals.length).toBe(1)
    expect(terminals[0].kind).toBe('object_created')
    // captured as PLANNED work on the known site, with the supervisor's own words
    const t = terminals[0] as { kind: 'object_created'; item: { detail: string; planned?: boolean; project_hint: string | null } }
    expect(t.item.detail).toBe('check whether epoxy was applied after cleaning dust')
    expect(t.item.planned).toBe(true)
    expect(t.item.project_hint).toBe('ASM Elite')
  })

  // An ISSUE/PROGRESS report is unchanged — the recall floor still asks rather than silently missing.
  test('(T2) itemType=issue keeps the recall-floor ask (the floor is not weakened)', () => {
    const terminals = executeResolution(BOTH_FALSE_WITH_NEAREST, baseCtx({ itemType: 'issue' }))
    expect(terminals[0].kind).toBe('question_asked')
  })
})

// ── THE JOURNEY — the live message, end to end ────────────────────────────────────────────────────────────
const SEED = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: {}, chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: '919900000000', is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: 'org-1', wamid: 'w-1', lang: 'te' as const })
const DEC_EPOXY = JSON.stringify({
  project_hint: 'ASM Elite',
  items: [
    item({ type: 'issue', text: 'dust is accumulating in the gap between tiles where epoxy is applied' }),
    item({ type: 'todo', text: 'apply epoxy only after cleaning the dust', refines: 0, refines_as: 'remedy' }),
    item({ type: 'todo', text: 'check whether epoxy was applied after cleaning dust', refines: 0, refines_as: 'check' }),
  ],
})
const R_CREATE = JSON.stringify({
  issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'dust is accumulating in the gap between tiles where epoxy is applied — apply epoxy only after cleaning the dust', location: null, project_hint: 'ASM Elite', confidence: 'high' }] },
  update_found: { found: false, updates: [], nearest: [] },
})

suite('siteops — the epoxy narration end to end (one thought → one row, no quiz)', () => {
  test('(J1) issue + remedy + check → ONE problem row and ZERO which-item picks', async () => {
    const fake = fakeSupabase(SEED())
    await runSiteops(ctxFor(fake), 'tile gap lo dust cherutundi, dust clean chesaake epoxy pettali, alaa chesaaro ledo choodali', {
      callModel: (_s: string, user: string) => Promise.resolve(user.startsWith('CANDIDATES:') ? R_CREATE : DEC_EPOXY),
    })

    expect(fake.writesTo('problems').filter((w) => w.op === 'insert').length).toBe(1)
    expect(fake.outbox().filter((b) => /Which of these is it about/i.test(b)).length).toBe(0)
  })
})

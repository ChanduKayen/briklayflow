// WHERE A PROBLEM IS — the structure slot must reach the row.
//
// The capture pipeline has ALWAYS computed a floor/unit slot: decompose emits one, the vision pass
// emits one, and the task pin consumes it to choose which row to write to. It was simply never
// PERSISTED on the problem itself. So a snag knew perfectly well it was on the fourth floor while
// it was being created, and then forgot — and the portal could only ever say "Project-wide".
//
// It is also what a unit chip counts BY: with no floor/unit on the row there is nothing to count,
// so every red badge on the flat strip is empty no matter how many problems that flat has.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'

const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: {},
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const })

/** decompose emits the slot; the resolver then creates the item. */
const modelFor = (structure: unknown, kind: 'issue' | 'snag') => {
  const dec = JSON.stringify({
    project_hint: 'ASM Elite',
    items: [{
      type: kind === 'snag' ? 'issue' : 'issue',
      text: 'seepage near the AC point',
      task_hint: null, qc_statements: [], cause: 'rework', cause_reason: null,
      owner_hint: null, date_hint: null, project_hint: 'ASM Elite',
      structure,
    }],
  })
  const res = JSON.stringify({
    issue_snag_found: {
      found: true,
      items: [{ kind, detail: 'seepage near the AC point', location: null, project_hint: 'ASM Elite', confidence: 'high', cause: 'rework', owner: null }],
    },
    update_found: { found: false, updates: [] },
  })
  return (_s: string, user: string): Promise<string> => Promise.resolve(user.startsWith('CANDIDATES:') ? res : dec)
}

suite('siteops — a problem remembers WHERE it is', () => {
  test('the floor and unit the capture already knew are written onto the problems row', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(
      ctxFor(fake),
      'ASM Elite first floor unit A seepage near the AC point',
      { callModel: modelFor({ floor: 'First', unit: 'Unit A', all: false, except: null }, 'snag') },
    )

    const ins = fake.writesTo('problems').filter((w) => w.op === 'insert')
    expect(ins.length).toBe(1)
    expect(ins[0].payload?.floor_label).toBe('First')
    expect(ins[0].payload?.unit_label).toBe('Unit A')
  })

  test('a floor with no unit still lands — the unit is simply absent, never a guess', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(
      ctxFor(fake),
      'ASM Elite second floor seepage',
      { callModel: modelFor({ floor: 'Second', unit: null, all: false, except: null }, 'snag') },
    )
    const ins = fake.writesTo('problems').filter((w) => w.op === 'insert')
    expect(ins[0].payload?.floor_label).toBe('Second')
    expect(ins[0].payload?.unit_label).toBe(null)
  })

  test('NO SLOT, NO GUESS — an item that never named a place writes null, not an invented floor', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(
      ctxFor(fake),
      'ASM Elite seepage somewhere',
      { callModel: modelFor(null, 'issue') },
    )
    const ins = fake.writesTo('problems').filter((w) => w.op === 'insert')
    expect(ins[0].payload?.floor_label).toBe(null)
    expect(ins[0].payload?.unit_label).toBe(null)
  })
})

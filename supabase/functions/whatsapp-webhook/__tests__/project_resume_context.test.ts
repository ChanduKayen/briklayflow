// THE WHICH_PROJECT RESUME DROPS THE DECOMPOSITION (live probe, 2026-07-11).
//
// The fresh text path runs the singular unit with everything decompose learned about each item:
//   runSingularUnit(… context, itemTypes, structures)      (_agents/siteops.ts, the Stage-2 loop)
// The which_project RESUME — the path every message on a multi-project org takes when it doesn't name its
// site — runs it with NONE of them:
//   runSingularUnit(… projectId, messages, batch, narrationId, callModel, sink, askQueue, projectName)
// because askProjectGroups only ever stored the message STRINGS in its slots. So on the resume:
//   • structure is null → the task PIN has no floor/unit and cannot pin a row. The whole structure-aware pin
//     is DEAD on this path: a message that named "first floor Unit A" exactly still gets asked "which one?".
//   • itemType is null → the honest untracked-work terminal can't fire (a progress report on a site with no
//     task list gets a quiz instead of an answer).
//   • context is null → the FULL NARRATION background is gone, so a clause can't be read in context.
//
// The live probe: "ఫస్ట్ ఫ్లోర్ యూనిట్ ఏ లో టైల్స్ క్లియర్ చేసేసాం" → "which project?" → "ASM Elite" → and the
// resolver ran BLIND. Fix: carry the decomposed ITEMS (text + type + structure) and the raw narration in the
// ask's slots, and thread them back through the unit on resume.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const TEXT = 'first floor unit A tiles cleared'

// TWO active projects → the site never auto-resolves → the message must ask "which project?" first (the live
// shape). ONE tiling task type with TWO open rows: First·Unit A and Second·Unit A. The narration names the
// first floor, so the PIN — if it is given the structure slot — resolves to exactly one row and APPLIES.
// Without the slot it sees two rows and asks "which one?" — the bug.
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  problems: {},
  todos: {},
  site_tasks: {
    'ft-1a': { task_id: 'ft-1a', project_id: 'P1', org_id: ORG, name: 'Floor tiling', status: 'OPEN', node_key: 'n1', floor_label: 'First', unit_label: 'Unit A', trade: 'tiling', phase: 'finishes' },
    'ft-2a': { task_id: 'ft-2a', project_id: 'P1', org_id: ORG, name: 'Floor tiling', status: 'OPEN', node_key: 'n2', floor_label: 'Second', unit_label: 'Unit A', trade: 'tiling', phase: 'finishes' },
  },
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })

interface Call { system: string; user: string }
// decompose returns ONE progress item carrying the structure slot (First · Unit A) — exactly what the live
// decompose produced. The resolver names the TILING TYPE (it is never shown a floor).
const DECOMPOSED = JSON.stringify({
  project_hint: null,
  items: [{
    type: 'progress', text: TEXT, confidence: 'high', task_hint: 'first floor unit A',
    structure: { floor: 'first', unit: 'Unit A', all: false, except: null },
    cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null, qc_statements: [],
  }],
})
const RESOLVED = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: {
    found: true,
    updates: [{ target_id: 'type:P1:floor tiling', target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'tiles cleared' }],
  },
})
const model = (calls: Call[]) => (system: string, user: string): Promise<string> => {
  calls.push({ system, user })
  if (user.startsWith('CANDIDATES:')) return Promise.resolve(RESOLVED)
  return Promise.resolve(DECOMPOSED)
}
const resolveCall = (calls: Call[]) => calls.filter((c) => c.user.startsWith('CANDIDATES:')).slice(-1)[0]

suite('siteops — the which_project resume carries the decomposition (structure · type · context)', () => {
  test('(R1) project pick → the resume PINS the named floor and APPLIES; it does not re-ask "which one?"', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []

    // 1) siteless narration → "which project?" (two active projects, nothing named)
    await runSiteops(ctxFor(fake), TEXT, { callModel: model(calls) })
    const ask = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    expect(!!ask).toBe(true)

    // the ask must CARRY the decomposition, not just the message string — nothing else can restore it later
    const slots = ask!.payload.slots_so_far
    expect(Array.isArray(slots.items)).toBe(true)
    expect(slots.items[0].structure?.floor).toBe('first')
    expect(slots.items[0].type).toBe('progress')
    expect(typeof slots.narration_text).toBe('string')

    // 2) "ASM Elite" → the resume runs the unit WITH the structure slot → the pin resolves ONE row → APPLY
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which project?', slots_so_far: slots } as any
    await answerSiteops(ctxFor(fake), 'ASM Elite', convo, { callModel: model(calls) })

    // the FULL NARRATION rides the resolve call as background (context), like the fresh path
    expect(/FULL NARRATION|first floor unit A tiles cleared/.test(resolveCall(calls)?.user ?? '')).toBe(true)

    // THE POINT: the First·Unit A row is written, and NO which_item question was asked.
    const touched = fake.writesTo('site_tasks').flatMap((w) => w.filters.filter(([k]) => k === 'task_id').map(([, v]) => v))
    expect(touched.includes('ft-1a')).toBe(true)
    expect(touched.includes('ft-2a')).toBe(false)
    expect(fake.outbox().some((b) => /which of these is it about/i.test(b))).toBe(false)
  })
})

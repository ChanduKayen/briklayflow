// CONSTITUTIONAL RECONNECTION · step 4 — A1, loosen resolveProject so an ABBREVIATION resolves. A supervisor
// types the site's initials ("SRC" for "Sri Raghavendra Constructions"); the extractor forwards that as the
// project_hint. scoreName scores an exact full-initialism at 0.75 — CONFIRM band — which resolveProject
// discards (it accepts only 'auto'), so the message is parked and re-asked every time. An exact initialism is
// a STRUCTURAL match (every initial lines up), not a coincidence, so it earns the auto band: promote it to
// 0.85. The multi-project safety (two sites sharing initials → ASK, never guess) rides the EXISTING
// ambiguous-auto path unchanged — no new branch in resolveProject.
//
// RED-FIRST: "SRC" against a roster with exactly one SRC project → today project_id null + a which-site ask;
// after the bump → resolves to that project and the create lands on it.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const base = () => ({ wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }], user_profiles: [{ id: 'u1', name: 'Ramesh' }], site_narration_id: 'narr-1' })
// decompose yields a progress item carrying the initialism as project_hint (so it reaches the unit, not A2);
// resolveInbound then reports a fresh snag → the create lands on whatever project resolveProject picked.
const dec = (hint: string) => JSON.stringify({ project_hint: hint, items: [{ type: 'progress', text: 'slab honeycombing on 2nd floor', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: hint }] })
const NEWISSUE = (hint: string) => JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'slab honeycombing', location: '2nd floor', project_hint: hint, confidence: 'high' }] }, update_found: { found: false, updates: [] } })
const model = (hint: string) => (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? NEWISSUE(hint) : dec(hint))
const asked = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
const resolvedTo = (fake: ReturnType<typeof fakeSupabase>, pid: string) => fake.writesTo('site_narrations').some((w) => w.op === 'update' && w.payload?.project_id === pid)

suite('siteops — A1 abbreviation resolution (exact initialism resolves; ambiguous initials ask)', () => {
  // (abbrev) exactly one project has initials SRC → the initialism resolves to it; the snag lands on it, no ask.
  test('(abbrev) "SRC" → resolves to the sole SRC project, create lands there, no which-site ask', async () => {
    const seed: Seed = { ...base(), projects: [{ project_id: 'P-src', name: 'Sri Raghavendra Constructions' }, { project_id: 'P-asm', name: 'ASM Elite' }, { project_id: 'P-snd', name: 'Soundharya Residency' }] }
    const fake = fakeSupabase(seed)
    await runSiteops(ctxFor(fake), 'SRC — slab honeycombing on 2nd floor', { callModel: model('SRC') })

    expect(resolvedTo(fake, 'P-src')).toBe(true)            // the initialism resolved (was CONFIRM-band, discarded)
    expect(asked(fake)).toBe(false)                          // no needless which-site ask
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P-src')).toBe(true)   // create landed on it
  })

  // (guard) two projects share the initials SRC → genuinely ambiguous → ASK, never silently guess one.
  test('(guard) "SRC" with two SRC projects → ambiguous → asks, resolves to neither', async () => {
    const seed: Seed = { ...base(), projects: [{ project_id: 'P-src', name: 'Sri Raghavendra Constructions' }, { project_id: 'P-src2', name: 'Sai Ram Colony' }] }
    const fake = fakeSupabase(seed)
    await runSiteops(ctxFor(fake), 'SRC — slab honeycombing on 2nd floor', { callModel: model('SRC') })

    expect(asked(fake)).toBe(true)                           // disambiguate
    expect(resolvedTo(fake, 'P-src')).toBe(false)
    expect(resolvedTo(fake, 'P-src2')).toBe(false)
    expect(fake.writesTo('problems').some((w) => w.op === 'insert')).toBe(false)   // nothing created on a guess
  })
})

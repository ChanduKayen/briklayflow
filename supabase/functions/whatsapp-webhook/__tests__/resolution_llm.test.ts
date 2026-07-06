// UNIFIED INBOUND RESOLUTION v2 — MODEL WIRING (Phase 1b) gate. Wiring exists here, so RED-FIRST is the
// rule: the risk is the shell, not the pure planner. Two things must hold no matter what the model does:
// (1) validation REJECTS a malformed response (never repairs it into a guessed contract), and (2) an
// unreadable/absent response PARKS with parked_reason + honest reply — the no-miss guarantee surviving the
// model being down (exercised for free: the harness has no LLM key, so callLLM returns '' → park).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import {
  validateContract, disposeRawResponse, buildCandidateSet, resolveInbound,
  nearCandidateIds, RESOLUTION_SYSTEM, type Candidate,
} from '../_siteops_resolution_llm.ts'

const validRaw = (over = ''): string => over || JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: 'x', target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'done' }] },
})

suite('siteops resolution v2 — validateContract (REJECTS, never repairs)', () => {
  test('a well-formed response parses to a contract', () => {
    const c = validateContract(validRaw())
    expect(c !== null).toBe(true)
    expect(c!.update_found.updates[0].target_id).toBe('x')
  })
  test('```json fence is tolerated', () => {
    expect(validateContract('```json\n' + validRaw() + '\n```') !== null).toBe(true)
  })
  test('empty / non-JSON → null (park, not repair)', () => {
    expect(validateContract('')).toBeNull()
    expect(validateContract('not json')).toBeNull()
    expect(validateContract('{"update_found":')).toBeNull()
  })
  test('missing closure_explicit on an update → null (no default filled)', () => {
    const bad = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: 'x', target_kind: 'issue', action: 'resolve', confidence: 'high', reason: 'done' }] } })
    expect(validateContract(bad)).toBeNull()
  })
  test('off-enum confidence → null', () => {
    const bad = validRaw(JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: 'x', target_kind: 'issue', action: 'resolve', confidence: 'sure', closure_explicit: true, reason: 'r' }] } }))
    expect(validateContract(bad)).toBeNull()
  })
  test('found=true with an empty array is incoherent → null', () => {
    const bad = JSON.stringify({ issue_snag_found: { found: true, items: [] }, update_found: { found: false, updates: [] } })
    expect(validateContract(bad)).toBeNull()
  })
})

suite('siteops resolution v2 — disposeRawResponse (reject→park vs valid→terminals)', () => {
  test('valid update response → terminals', () => {
    const d = disposeRawResponse(validRaw(), new Set(['x']), false)
    expect(d.kind).toBe('terminals')
    expect(d.kind === 'terminals' && d.terminals[0].kind).toBe('object_updated')
  })
  test('valid both-false response → terminals (acked_didnt_catch)', () => {
    const raw = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })
    const d = disposeRawResponse(raw, new Set(['x']), false)
    expect(d.kind === 'terminals' && d.terminals[0].kind).toBe('acked_didnt_catch')
  })
  test('unreadable response → park (never a guessed contract)', () => {
    const d = disposeRawResponse('', new Set(['x']), false)
    expect(d.kind).toBe('park')
    expect(d.kind === 'park' && d.reason).toBe('llm_unreadable')
  })
})

suite('siteops resolution v2 — buildCandidateSet (open items, chased ranked top)', () => {
  const seed: Seed = {
    projects: [{ project_id: 'P1', name: 'ASM Elite' }],
    problems: {
      'iss-1': { id: 'iss-1', title: 'waterlogging', project_id: 'P1', status: 'OPEN' },
      'iss-2': { id: 'iss-2', title: 'cement short', project_id: 'P1', status: 'OPEN' },
      'iss-done': { id: 'iss-done', title: 'old', project_id: 'P1', status: 'RESOLVED' },
    },
    todos: { 'td-1': { id: 'td-1', title: 'call inspector', project_id: 'P1', status: 'OPEN' } },
    site_tasks: {
      'tk-1': { task_id: 'tk-1', name: '2F slab', project_id: 'P1', status: 'PENDING' },
      'tk-done': { task_id: 'tk-done', name: 'done task', project_id: 'P1', status: 'DONE' },
    },
  }

  test('loads open issues+todos+tasks, excludes resolved/done, ranks the chased item first', async () => {
    const fake = fakeSupabase(seed)
    const batch = { items: [{ kind: 'issue' as const, id: 'iss-2', orgId: 'org-1', projectId: 'P1', projectName: 'ASM Elite', title: 'cement short', taskName: null, cause: null }] }
    const cands = await buildCandidateSet(fake, 'org-1', batch)

    expect(cands.map((c) => c.id)).toEqual(['iss-2', 'iss-1', 'td-1', 'tk-1'])   // chased first, done/resolved dropped
    expect(cands[0].chased).toBe(true)
    expect(cands.some((c) => c.id === 'iss-done' || c.id === 'tk-done')).toBe(false)
  })

  // LIVE FAILURE (columns, 2026-07-05): the set offered FLAT legacy task rows (node_key null) alongside
  // their engine twins, the model targeted a flat "Columns", and the VM-guardrail correctly REFUSED the
  // write — so every task update held. The model can only mis-target what we offer: task candidates must
  // be ENGINE-VISIBLE only (node_key rows, deduped), exactly the rows applyProgress may write —
  // buildCandidateSet mirrors the agent's engineTasks preference, per project.
  test('task candidates are ENGINE-VISIBLE only — flat duplicates of engine rows are never offered', async () => {
    const fake = fakeSupabase({
      projects: [{ project_id: 'P1', name: 'ASM Elite' }],
      site_tasks: {
        'tk-flat': { task_id: 'tk-flat', name: 'Columns', project_id: 'P1', status: 'not_started', node_key: null },
        'tk-eng': { task_id: 'tk-eng', name: 'Columns', project_id: 'P1', status: 'not_started', node_key: 'stilt/columns', floor_label: 'Stilt' },
      },
    })
    const ids = (await buildCandidateSet(fake, 'org-1', null, 'P1')).filter((c) => c.kind === 'task').map((c) => c.id)
    expect(ids.includes('tk-eng')).toBe(true)
    expect(ids.includes('tk-flat')).toBe(false)
  })

  // …but a STACK-LESS project (no engine rows at all) still offers its flat tasks — there, writes are
  // legitimately unguarded and flat rows are the only identity that exists.
  test('a stack-less project (no engine rows) still offers its flat tasks', async () => {
    const fake = fakeSupabase({
      projects: [{ project_id: 'P1', name: 'ASM Elite' }],
      site_tasks: { 'tk-flat': { task_id: 'tk-flat', name: 'Boundary wall', project_id: 'P1', status: 'not_started', node_key: null } },
    })
    const ids = (await buildCandidateSet(fake, 'org-1', null, 'P1')).filter((c) => c.kind === 'task').map((c) => c.id)
    expect(ids).toEqual(['tk-flat'])
  })

  // THE PARKING LESSON (live 2026-07-05) — "The pride parking" photo could never match "Parking deck &
  // markings": the engine-only rule dropped EVERY flat row from a project that has engine rows, including
  // one-off manual Task-Manager tasks that have no engine identity at all. The model can't match what we
  // never show it. Rule: engine rows PLUS flat rows with NO engine name-twin in the same project; a flat
  // twin of an engine row stays invisible (the columns duplicate stays dead).
  test('a flat ONE-OFF with no engine name-twin IS offered alongside engine rows', async () => {
    const fake = fakeSupabase({
      projects: [{ project_id: 'P1', name: 'The Pride' }],
      site_tasks: {
        'tk-eng': { task_id: 'tk-eng', name: 'Columns', project_id: 'P1', status: 'not_started', node_key: 'stilt/columns', floor_label: 'Stilt' },
        'tk-flat-dup': { task_id: 'tk-flat-dup', name: 'Columns', project_id: 'P1', status: 'not_started', node_key: null },
        'tk-park': { task_id: 'tk-park', name: 'Parking deck & markings', project_id: 'P1', status: 'not_started', node_key: null },
      },
    })
    const tasks = (await buildCandidateSet(fake, 'org-1', null, 'P1')).filter((c) => c.kind === 'task')
    expect(tasks.some((c) => c.id === 'tk-park')).toBe(true)        // the one-off is a real identity
    expect(tasks.some((c) => c.id === 'tk-flat-dup')).toBe(false)   // the twin is still never offered
    expect(tasks.find((c) => c.id === 'tk-park')?.title).toBe('Parking deck & markings')
  })

  // Five floors of "Columns" are indistinguishable without the floor — the candidate TITLE must carry it,
  // or the model cannot honor "stilt floor columns" and picks a floor at random.
  test('task candidate titles carry the floor label', async () => {
    const fake = fakeSupabase({
      projects: [{ project_id: 'P1', name: 'ASM Elite' }],
      site_tasks: { 'tk-eng': { task_id: 'tk-eng', name: 'Columns', project_id: 'P1', status: 'not_started', node_key: 'stilt/columns', floor_label: 'Stilt' } },
    })
    const cands = await buildCandidateSet(fake, 'org-1', null, 'P1')
    expect(cands.find((c) => c.id === 'tk-eng')?.title).toBe('Columns — Stilt')
  })
})

suite('siteops resolution v2 — nearCandidateIds (lexical shortlist for the place_photo ask)', () => {
  const cand = (id: string, title: string): Candidate => ({ id, kind: 'task', title, project_id: 'P1', project_name: 'The Pride', chased: false })

  test('caption tokens hit the candidate title: "parking" → Parking deck & markings', () => {
    const cands = [cand('tk-col', 'Columns — Stilt'), cand('tk-park', 'Parking deck & markings')]
    const near = nearCandidateIds(cands, 'The pride parking -- Newly tiled parking area with tools and materials visible.')
    expect(near).toEqual(['tk-park'])
  })
  test('no lexical overlap → empty (the evidence floor stands; never the whole set)', () => {
    const cands = [cand('tk-col', 'Columns — Stilt'), cand('iss-t', 'tiles not arrived at site')]
    expect(nearCandidateIds(cands, 'Soundharya corridor -- corridor under construction')).toEqual([])
  })
  test('capped and score-ordered', () => {
    const cands = [cand('a', 'parking gate'), cand('b', 'parking deck markings'), cand('c', 'parking ramp'), cand('d', 'parking wall'), cand('e', 'plaster')]
    const near = nearCandidateIds(cands, 'parking deck markings done')
    expect(near.length <= 3).toBe(true)
    expect(near[0]).toBe('b')   // highest overlap first
  })
})

suite('siteops resolution v2 — prompt calibration (low is SAFE, false means UNRELATED)', () => {
  // The prompt's caution and the ladder's caution must not STACK: the ladder makes low safe by
  // construction (low only asks), so the prompt must SAY so, or borderline matches fall through both.
  test('RESOLUTION_SYSTEM teaches the ladder: low only asks — low is SAFE', () => {
    expect(/low only ASKS|low is SAFE/i.test(RESOLUTION_SYSTEM)).toBe(true)
  })
  test('RESOLUTION_SYSTEM reserves found:false for genuinely unrelated content', () => {
    expect(/genuinely unrelated/i.test(RESOLUTION_SYSTEM)).toBe(true)
  })
  test('RESOLUTION_SYSTEM explains the photo-caption message shape', () => {
    expect(/photo/i.test(RESOLUTION_SYSTEM)).toBe(true)
  })
})

suite('siteops resolution v2 — resolveInbound fail→park (no-miss survives the model down)', () => {
  // THE LIVE TRACE, end-to-end through the shell: captioned progress photo, model returns both-false,
  // "Parking deck & markings" is lexically near → the disposition is a place_photo QUESTION, not the
  // silent evidence park.
  test('image + both-false + near flat one-off → disposed place_photo carrying the shortlist', async () => {
    const fake = fakeSupabase({
      projects: [{ project_id: 'P1', name: 'The Pride' }],
      site_tasks: {
        'tk-eng': { task_id: 'tk-eng', name: 'Columns', project_id: 'P1', status: 'not_started', node_key: 'stilt/columns', floor_label: 'Stilt' },
        'tk-park': { task_id: 'tk-park', name: 'Parking deck & markings', project_id: 'P1', status: 'not_started', node_key: null },
      },
    })
    const bothFalse = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })
    const out = await resolveInbound(
      { supabase: fake, orgId: 'org-1', from: '919900000000', projectId: 'P1' },
      { message: 'The pride parking -- Newly tiled parking area with tools and materials visible.', image: { storagePath: 'wa_x.jpg', caption: 'The pride parking' } },
      null,
      async () => {},
      async () => bothFalse,
    )
    expect(out.kind).toBe('disposed')
    const t = out.kind === 'disposed' ? out.terminals[0] : null
    expect(t?.kind).toBe('question_asked')
    expect(t?.kind === 'question_asked' && t.about).toBe('place_photo')
    expect(t?.kind === 'question_asked' && (t.shortlistIds ?? []).includes('tk-park')).toBe(true)
  })

  test('unreadable model response → siteops_unplaced (parked_reason) + honest reply, nothing lost', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })
    const sent: string[] = []
    const out = await resolveInbound(
      { supabase: fake, orgId: 'org-1', from: '919900000000' },
      { message: 'వాటర్ లాగింగ్ రిసాల్వ్డ్' },   // harness has no LLM key → callLLM '' → unreadable → park
      null,
      async (b) => { sent.push(b) },
    )

    expect(out.kind).toBe('parked')
    expect(out.kind === 'parked' && out.reason).toBe('llm_unreadable')
    const park = fake.writesTo('siteops_unplaced')
    expect(park.length).toBe(1)
    expect(park[0].payload.reason).toBe('llm_unreadable')                 // parked_reason stamped
    expect(park[0].payload.observation).toBe('వాటర్ లాగింగ్ రిసాల్వ్డ్')  // raw text preserved, not dropped
    expect(sent.some((b) => /logged it for review/i.test(b))).toBe(true)  // honest reply
  })
})

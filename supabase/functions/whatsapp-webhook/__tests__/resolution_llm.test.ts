// UNIFIED INBOUND RESOLUTION v2 — MODEL WIRING (Phase 1b) gate. Wiring exists here, so RED-FIRST is the
// rule: the risk is the shell, not the pure planner. Two things must hold no matter what the model does:
// (1) validation REJECTS a malformed response (never repairs it into a guessed contract), and (2) an
// unreadable/absent response PARKS with parked_reason + honest reply — the no-miss guarantee surviving the
// model being down (exercised for free: the harness has no LLM key, so callLLM returns '' → park).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import {
  validateContract, disposeRawResponse, buildCandidateSet, resolveInbound,
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

suite('siteops resolution v2 — resolveInbound fail→park (no-miss survives the model down)', () => {
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

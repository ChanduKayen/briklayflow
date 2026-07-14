// UNIFIED INBOUND RESOLUTION v2 — MODEL WIRING (Phase 1b) gate. Wiring exists here, so RED-FIRST is the
// rule: the risk is the shell, not the pure planner. Two things must hold no matter what the model does:
// (1) validation REJECTS a malformed response (never repairs it into a guessed contract), and (2) an
// unreadable/absent response PARKS with parked_reason + honest reply — the no-miss guarantee surviving the
// model being down (exercised for free: the harness has no LLM key, so callLLM returns '' → park).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { loadTableColumns } from './table_columns'
import {
  validateContract, disposeRawResponse, buildCandidateSet, resolveInbound,
  nearCandidateIds, buildResolutionUser, RESOLUTION_SYSTEM, type Candidate,
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

  // #1 — a PLANNED snag with a due_date parses and carries planned/due_date through (the fields the create
  // path reads to write is_planned + the deadline). A malformed planned (non-bool) rejects, never repairs.
  test('a planned snag with due_date parses; planned/due_date survive', () => {
    const raw = JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'snag', detail: 'tap issues', location: null, project_hint: 'ASM Elite', confidence: 'high', planned: true, due_date: 'Monday' }] }, update_found: { found: false, updates: [] } })
    const c = validateContract(raw)
    expect(c !== null).toBe(true)
    expect(c!.issue_snag_found.items[0].planned).toBe(true)
    expect(c!.issue_snag_found.items[0].due_date).toBe('Monday')
  })
  test('planned of the wrong type → null (rejected, not repaired)', () => {
    const bad = JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'snag', detail: 'x', location: null, project_hint: null, confidence: 'high', planned: 'yes' }] }, update_found: { found: false, updates: [] } })
    expect(validateContract(bad)).toBeNull()
  })

  // NO-INFO-LOSS on create — cause + owner ride the contract (they used to be hard-coded away in toSiteItem).
  test('a new issue with cause + owner parses and carries both', () => {
    const raw = JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'cement short', location: '4th floor', project_hint: 'ASM Elite', confidence: 'high', cause: 'material', owner: 'Ramesh' }] }, update_found: { found: false, updates: [] } })
    const c = validateContract(raw)
    expect(c !== null).toBe(true)
    expect(c!.issue_snag_found.items[0].cause).toBe('material')
    expect(c!.issue_snag_found.items[0].owner).toBe('Ramesh')
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
      // A TO-DO IS A ROW IN HERE NOW (20260713000001): kind='snag', is_planned. It used to live in
      // `todos` — a second store the portal could not read, so an item closed in the Desk went on
      // being chased on WhatsApp forever. One store is the fix, and this seed IS the fix.
      'td-1': { id: 'td-1', title: 'call inspector', project_id: 'P1', status: 'OPEN', kind: 'snag', is_planned: true },
    },
    site_tasks: {
      'tk-1': { task_id: 'tk-1', name: '2F slab', project_id: 'P1', status: 'PENDING' },
      'tk-done': { task_id: 'tk-done', name: 'done task', project_id: 'P1', status: 'DONE' },
    },
  }

  test('loads open issues+snags+tasks from ONE store, excludes resolved/done, ranks the chased item first', async () => {
    const fake = fakeSupabase(seed)
    const batch = { items: [{ kind: 'issue' as const, id: 'iss-2', orgId: 'org-1', projectId: 'P1', projectName: 'ASM Elite', title: 'cement short', taskName: null, cause: null }] }
    const cands = await buildCandidateSet(fake, 'org-1', batch)

    // Tasks are now TYPES: '2F slab' → the type id `type:P1:2f slab` (not the row id tk-1).
    expect(cands.map((c) => c.id)).toEqual(['iss-2', 'iss-1', 'td-1', 'type:P1:2f slab'])   // chased first, done/resolved dropped
    expect(cands[0].chased).toBe(true)
    const task = cands.find((c) => c.kind === 'task')
    expect(task?.rows?.map((r) => r.id)).toEqual(['tk-1'])       // the type carries its open physical row
    expect(cands.some((c) => c.rows?.some((r) => r.id === 'tk-done'))).toBe(false)   // done row excluded
  })

  // TWO LIVE FAILURES, ONE ROOT: a to-do was a row in ANOTHER TABLE.
  //   · 2026-07-09 — this read `todos.title`; the column was `todos.text`. PostgREST rejected the
  //     select, the code discarded `error`, and to-dos read as "none": four chased items were
  //     invisible and five real updates resolved to nothing.
  //   · 2026-07-13 — the Site Desk could not see `todos` AT ALL, so an item closed in the portal was
  //     chased by WhatsApp forever. Nothing the founder clicked could ever stop it.
  // Both die the same way: there is one item store. A to-do is a problems row, it is loaded by the
  // same query as everything else, and it carries its title like everything else.
  test('a to-do is loaded from `problems` like any other item, and carries its title', async () => {
    const fake = fakeSupabase(seed)
    const cands = await buildCandidateSet(fake, 'org-1', null)
    const td = cands.find((c) => c.id === 'td-1')
    expect(td?.title).toBe('call inspector')
    expect(td?.project_id).toBe('P1')
  })

  // A candidate load that ERRORS must never read as "the org has none" — a partial set grounds the model on
  // a lie. It throws; the webhook's outer catch marks the job FAILED and replies honestly (the narration is
  // already captured). Simulated by pinning the schema BEFORE todos existed, so the select is a real 42703.
  test('a failed candidate load THROWS — never a silent empty set', async () => {
    // A REAL historical schema, not a fabricated one: site_tasks was created in 20260625000004 but did not
    // gain `node_key` until 20260628000000. Pinned before that stamp, the select is a genuine 42703 — the
    // same answer prod gave the `todos.title` read.
    const fake = fakeSupabase(seed, { columns: loadTableColumns({ before: '20260628000000' }) })
    let threw: string | null = null
    try { await buildCandidateSet(fake, 'org-1', null) } catch (e) { threw = (e as Error).message }
    expect(threw !== null).toBe(true)
    expect(/candidate load failed \(site_tasks\)/.test(threw ?? '')).toBe(true)
  })

  // CHASE INJECTION — the item we just asked about can never be missing from the set. Marking `chased` on a
  // row that happened to load is a decoration; injecting the batch item is the guarantee. Here the to-do row
  // is absent from the DB read (RLS, a stale row, a broken select) yet the chased item MUST still be offered.
  test('a chased item absent from the DB read is still injected, chased and ranked first', async () => {
    const fake = fakeSupabase({ ...seed, todos: {} })
    const batch = { items: [{ kind: 'todo' as const, id: 'td-gone', orgId: 'org-1', projectId: 'P1', projectName: 'ASM Elite', title: 'Plumber to put top point in kitchen', taskName: null, cause: null }] }
    const cands = await buildCandidateSet(fake, 'org-1', batch)

    const inj = cands.find((c) => c.id === 'td-gone')
    expect(inj?.chased).toBe(true)
    expect(inj?.kind).toBe('todo')
    expect(inj?.title).toBe('Plumber to put top point in kitchen')
    expect(cands[0].id).toBe('td-gone')            // chased ranks top
  })

  // …but a chase on ANOTHER project is not this message's context, and must never leak into THE project's set.
  test('a chased item on another project is never injected', async () => {
    const fake = fakeSupabase({ ...seed, todos: {} })
    const batch = { items: [{ kind: 'todo' as const, id: 'td-other', orgId: 'org-1', projectId: 'P2', projectName: 'Other Site', title: 'not this site', taskName: null, cause: null }] }
    const cands = await buildCandidateSet(fake, 'org-1', batch, 'P1')
    expect(cands.some((c) => c.id === 'td-other')).toBe(false)
  })

  // A healthy load must be COMPLETELY unchanged by the injection block (no duplicate row for a chased item
  // that loaded normally).
  test('injection never duplicates a chased item that loaded normally', async () => {
    const fake = fakeSupabase(seed)
    const batch = { items: [{ kind: 'todo' as const, id: 'td-1', orgId: 'org-1', projectId: 'P1', projectName: 'ASM Elite', title: 'call inspector', taskName: null, cause: null }] }
    const cands = await buildCandidateSet(fake, 'org-1', batch)
    expect(cands.filter((c) => c.id === 'td-1').length).toBe(1)
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
    const tasks = (await buildCandidateSet(fake, 'org-1', null, 'P1')).filter((c) => c.kind === 'task')
    // ONE type 'Columns', whose rows are ENGINE-VISIBLE only: tk-eng in, its flat twin tk-flat out.
    const cols = tasks.find((c) => c.name === 'Columns')
    const rowIds = cols?.rows?.map((r) => r.id) ?? []
    expect(rowIds.includes('tk-eng')).toBe(true)
    expect(rowIds.includes('tk-flat')).toBe(false)
  })

  // …but a STACK-LESS project (no engine rows at all) still offers its flat tasks — there, writes are
  // legitimately unguarded and flat rows are the only identity that exists.
  test('a stack-less project (no engine rows) still offers its flat tasks', async () => {
    const fake = fakeSupabase({
      projects: [{ project_id: 'P1', name: 'ASM Elite' }],
      site_tasks: { 'tk-flat': { task_id: 'tk-flat', name: 'Boundary wall', project_id: 'P1', status: 'not_started', node_key: null } },
    })
    const tasks = (await buildCandidateSet(fake, 'org-1', null, 'P1')).filter((c) => c.kind === 'task')
    expect(tasks.map((c) => c.id)).toEqual(['type:P1:boundary wall'])
    expect(tasks[0].rows?.map((r) => r.id)).toEqual(['tk-flat'])
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
    const rowIds = tasks.flatMap((c) => c.rows?.map((r) => r.id) ?? [])
    expect(rowIds.includes('tk-park')).toBe(true)        // the one-off is a real identity
    expect(rowIds.includes('tk-flat-dup')).toBe(false)   // the twin is still never offered
    const park = tasks.find((c) => c.name === 'Parking deck & markings')
    expect(park?.title).toBe('Parking deck & markings')  // the TYPE title is the bare name
  })

  // The model sees the bare TYPE name (no floor — it must not pick a floor). The floor lives on the ROW, whose
  // title is what a human sees when the pin has to ask ("Columns — Stilt").
  test('a task TYPE title is the bare name; its rows carry the floor', async () => {
    const fake = fakeSupabase({
      projects: [{ project_id: 'P1', name: 'ASM Elite' }],
      site_tasks: { 'tk-eng': { task_id: 'tk-eng', name: 'Columns', project_id: 'P1', status: 'not_started', node_key: 'stilt/columns', floor_label: 'Stilt' } },
    })
    const cols = (await buildCandidateSet(fake, 'org-1', null, 'P1')).find((c) => c.name === 'Columns')
    expect(cols?.title).toBe('Columns')                       // the model sees no floor
    expect(cols?.rows?.[0].title).toBe('Columns — Stilt')     // the human sees it on the row
    expect(cols?.rows?.[0].floor).toBe('Stilt')
  })

  // Two units on one floor collapse to ONE type, but their ROWS stay distinct (Fourth · A vs Fourth · B) — the
  // pin/ask offer the row titles, so the two units never render identical.
  test('a type groups same-name rows; the rows keep distinct floor·unit titles', async () => {
    const fake = fakeSupabase({
      projects: [{ project_id: 'P1', name: 'ASM Elite' }],
      site_tasks: {
        'tk-4a': { task_id: 'tk-4a', name: 'Sanitaryware / fittings', project_id: 'P1', status: 'not_started', node_key: 'sanitary@Fourth/UnitA', floor_label: 'Fourth', unit_label: 'Unit A' },
        'tk-4b': { task_id: 'tk-4b', name: 'Sanitaryware / fittings', project_id: 'P1', status: 'not_started', node_key: 'sanitary@Fourth/UnitB', floor_label: 'Fourth', unit_label: 'Unit B' },
      },
    })
    const tasks = (await buildCandidateSet(fake, 'org-1', null, 'P1')).filter((c) => c.kind === 'task')
    expect(tasks.length).toBe(1)                              // ONE type, not two rows
    const titles = new Map((tasks[0].rows ?? []).map((r) => [r.id, r.title]))
    expect(titles.get('tk-4a')).toBe('Sanitaryware / fittings — Fourth · Unit A')
    expect(titles.get('tk-4b')).toBe('Sanitaryware / fittings — Fourth · Unit B')
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
  // #1 — the prompt must TEACH that assigned/to-do work is a snag, never a both-false miss (the live drop).
  test('RESOLUTION_SYSTEM teaches planned/to-do work is a snag (never a miss)', () => {
    expect(/planned|to-do|assigned/i.test(RESOLUTION_SYSTEM)).toBe(true)
    expect(/NEVER a miss|not both-false|is a FINDING/i.test(RESOLUTION_SYSTEM)).toBe(true)
  })
  // task matching must be by MEANING (trade), not the name string; and the cause taxonomy must be present.
  test('RESOLUTION_SYSTEM teaches task meaning-matching (trade) + the cause taxonomy', () => {
    expect(/WHAT THE WORK IS|trade|switchboards/i.test(RESOLUTION_SYSTEM)).toBe(true)
    expect(/material.*labour.*rework/i.test(RESOLUTION_SYSTEM)).toBe(true)
  })
})

suite('siteops resolution v2 — buildResolutionUser (candidate lines the model reads)', () => {
  // a TASK line must carry its trade · phase MEANING so "switchboards pettaru" resolves to the electrical
  // task by WHAT IT IS — not the literal name. Issues/todos carry no such hint (their title IS the meaning).
  test('a task line appends (trade · phase); a bare-name task without them appends nothing', () => {
    const cands: Candidate[] = [
      { id: 't1', kind: 'task', title: 'Switchplates — Fourth', project_id: 'P1', project_name: 'ASM', chased: false, trade: 'electrical', phase: 'finishing' },
      { id: 't2', kind: 'task', title: 'Boundary wall', project_id: 'P1', project_name: 'ASM', chased: false, trade: null, phase: null },
      { id: 'i1', kind: 'issue', title: 'cement short', project_id: 'P1', project_name: 'ASM', chased: false },
    ]
    const u = buildResolutionUser(cands, 'switchboards pettaru')
    expect(/Switchplates — Fourth  \(electrical · finishing\)/.test(u)).toBe(true)
    expect(/Boundary wall(?!.*\()/.test(u.split('\n').find((l) => l.includes('Boundary')) ?? '')).toBe(true)   // no ()
    expect(/cement short/.test(u)).toBe(true)
  })
})

// ── FIX B — full-narration CONTEXT (an atomic decompose item is resolved WITH the whole message as
// background, so a clause that only makes sense in context — "transformer resolved BUT wiring broke after
// 2h" — is no longer read in isolation as "the issue is still present"). The context is BACKGROUND ONLY:
// the model resolves the MESSAGE item, never acts on the other clauses. Deterministic surface: the block
// is BUILT into the user prompt and DELIVERED to the model; the prompt TEACHES background-only. ────────────
suite('siteops resolution v2 — Fix B: full-narration context (background only)', () => {
  const cands: Candidate[] = [{ id: 'iss-w', kind: 'issue', title: 'wiring broke', project_id: 'P1', project_name: 'Soundharya', chased: false }]

  test('a distinct context is appended as a BACKGROUND block, MESSAGE still carries the atomic item', () => {
    const u = buildResolutionUser(cands, 'wiring broke after 2 hours of use', 'transformer issue resolved but wiring broke after 2 hours of use')
    expect(/transformer issue resolved but wiring broke/i.test(u)).toBe(true)   // full narration present
    expect(/background|context only|do not act/i.test(u)).toBe(true)            // framed as background-only
    expect(/MESSAGE:\n[^\n]*wiring broke after 2 hours of use/i.test(u)).toBe(true)   // the atomic item is still the MESSAGE
  })

  test('no context (or context === message) → NO background block, no redundant noise', () => {
    const bare = buildResolutionUser(cands, 'wiring broke after 2 hours of use')
    expect(/background|full narration/i.test(bare)).toBe(false)
    const same = buildResolutionUser(cands, 'wiring broke', 'wiring broke')
    expect(/background|full narration/i.test(same)).toBe(false)
  })

  test('resolveInbound FORWARDS input.context to the model (the full narration reaches the call)', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'Soundharya' }], problems: { 'iss-w': { id: 'iss-w', title: 'wiring broke', project_id: 'P1', status: 'OPEN' } } })
    let seenUser = ''
    const bothFalse = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })
    await resolveInbound(
      { supabase: fake, orgId: 'org-1', from: '919900000000', projectId: 'P1' },
      { message: 'wiring broke after 2 hours of use', context: 'transformer issue resolved but wiring broke after 2 hours of use' },
      null, async () => {},
      async (_sys, user) => { seenUser = user; return bothFalse },
    )
    expect(/transformer issue resolved but wiring broke/i.test(seenUser)).toBe(true)
  })

  test('RESOLUTION_SYSTEM teaches the CONTEXT block is background-only (resolve the item, not the rest)', () => {
    expect(/background|context/i.test(RESOLUTION_SYSTEM)).toBe(true)
    expect(/do not act on|resolve only|only the (message|item)/i.test(RESOLUTION_SYSTEM)).toBe(true)
  })
})

// ── FIX A·ii — `nearest` on the wire: validateContract PARSES it (tolerant when absent), and resolveInbound
// turns a both-false-with-nearest into a which_item ask end-to-end (the transformer recall floor). ──────────
suite('siteops resolution v2 — Fix A·ii: nearest recall floor (contract + end-to-end)', () => {
  test('validateContract parses update_found.nearest (array of guesses); absent nearest is fine', () => {
    const withN = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [], nearest: [{ target_id: 'iss-w', target_kind: 'issue', plausibility: 'med', action: 'resolve', closure_explicit: true, reason: 'transformer≈wiring' }] } })
    const c = validateContract(withN)
    expect(c !== null).toBe(true)
    expect(c!.update_found.nearest?.[0]?.target_id).toBe('iss-w')
    // absent nearest still validates (backward compatible)
    expect(validateContract(JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })) !== null).toBe(true)
  })
  test('a malformed nearest entry (off-enum plausibility) → null (rejected, not repaired)', () => {
    const bad = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [], nearest: [{ target_id: 'x', target_kind: 'issue', plausibility: 'maybe', action: 'resolve', closure_explicit: true, reason: 'r' }] } })
    expect(validateContract(bad)).toBeNull()
  })

  test('resolveInbound: both-false + nearest → disposed which_item ask (the transformer miss becomes a question)', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'Soundharya' }], problems: { 'iss-w': { id: 'iss-w', title: 'wiring broke', project_id: 'P1', status: 'OPEN', cause: 'rework' } } })
    const raw = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [], nearest: [{ target_id: 'iss-w', target_kind: 'issue', plausibility: 'med', action: 'resolve', closure_explicit: true, reason: 'transformer issue ≈ the wiring issue' }] } })
    const out = await resolveInbound(
      { supabase: fake, orgId: 'org-1', from: '919900000000', projectId: 'P1' },
      { message: 'transformer issue resolved' },
      null, async () => {}, async () => raw,
    )
    expect(out.kind).toBe('disposed')
    const t = out.kind === 'disposed' ? out.terminals[0] : null
    expect(t?.kind).toBe('question_asked')
    expect(t?.kind === 'question_asked' && t.about).toBe('which_item')
    expect(t?.kind === 'question_asked' && (t.shortlistIds ?? []).includes('iss-w')).toBe(true)
  })

  test('RESOLUTION_SYSTEM instructs the model to return nearest on found:false (name the closest by meaning)', () => {
    expect(/nearest/i.test(RESOLUTION_SYSTEM)).toBe(true)
  })
})

// ── FIX A·i — ISSUE meaning enrichment. Tasks match by trade · phase; issues used to render as a bare
// title, so "transformer resolved" couldn't bridge to a "wiring" issue. Enrich issue lines with a DEFECT
// vocabulary (its cause) — deliberately a DIFFERENT shape than a task's (trade · phase), so meaning-
// enrichment SHARPENS the task/issue boundary instead of blurring it. 'other'/null cause adds no noise. ───
suite('siteops resolution v2 — Fix A·i: issue meaning enrichment (defect vocabulary)', () => {
  test('an issue line appends its (cause) — distinct from a task’s (trade · phase); other/null adds nothing', () => {
    const cands: Candidate[] = [
      { id: 't1', kind: 'task', title: 'Wiring — Second', project_id: 'P1', project_name: 'ASM', chased: false, trade: 'electrical', phase: '2nd fix' },
      { id: 'i1', kind: 'issue', title: 'wiring broke after 2h', project_id: 'P1', project_name: 'ASM', chased: false, cause: 'rework' },
      { id: 'i2', kind: 'issue', title: 'vague problem', project_id: 'P1', project_name: 'ASM', chased: false, cause: 'other' },
      { id: 'i3', kind: 'issue', title: 'no-cause issue', project_id: 'P1', project_name: 'ASM', chased: false },
    ]
    const u = buildResolutionUser(cands, 'wiring done')
    expect(/wiring broke after 2h  \(rework\)/.test(u)).toBe(true)              // issue carries defect vocab
    expect(/Wiring — Second  \(electrical · 2nd fix\)/.test(u)).toBe(true)      // task keeps trade · phase (two tokens)
    const line = (s: string) => u.split('\n').find((l) => l.includes(s)) ?? ''
    expect(/\(/.test(line('vague problem'))).toBe(false)                        // 'other' → no noisy hint
    expect(/\(/.test(line('no-cause issue'))).toBe(false)                       // null cause → no hint
  })

  test('buildCandidateSet carries cause onto issue candidates', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM' }], problems: { 'iss-w': { id: 'iss-w', title: 'wiring broke', project_id: 'P1', status: 'OPEN', cause: 'rework' } } })
    const cands = await buildCandidateSet(fake, 'org-1', null, 'P1')
    expect(cands.find((c) => c.id === 'iss-w')?.cause).toBe('rework')
  })

  test('RESOLUTION_SYSTEM teaches the same-trade task-vs-issue discriminator (completion→task, failure→issue, overlap→ask)', () => {
    expect(/same[- ]trade/i.test(RESOLUTION_SYSTEM)).toBe(true)                          // an EXPLICIT discriminator rule
    expect(/completion.*task|"done".*task|finished.*task/i.test(RESOLUTION_SYSTEM)).toBe(true)   // completion → task
    expect(/failure.*issue|defect.*issue|broke.*issue/i.test(RESOLUTION_SYSTEM)).toBe(true)      // failure → issue
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

  // STRUCTURE-AWARE FLOOR/UNIT PIN — END-TO-END through the shell (the pure planner is pinned in
  // floor_unit_disambiguation.test.ts; here the WIRING: buildCandidateSet emits floor/unit → resolveInbound
  // builds taskStructure → the guard fires). Five floors of one trade, one unit each — the live "why Fourth".
  const fiveFloors = () => fakeSupabase({
    projects: [{ project_id: 'P1', name: 'ASM Elite' }],
    site_tasks: {
      'tk-g': { task_id: 'tk-g', name: 'Plumbing rough-in', project_id: 'P1', status: 'not_started', node_key: 'ground/plumb', floor_label: 'Ground', unit_label: null },
      'tk-1': { task_id: 'tk-1', name: 'Plumbing rough-in', project_id: 'P1', status: 'not_started', node_key: 'first/plumb', floor_label: 'First', unit_label: null },
      'tk-2': { task_id: 'tk-2', name: 'Plumbing rough-in', project_id: 'P1', status: 'not_started', node_key: 'second/plumb', floor_label: 'Second', unit_label: null },
      'tk-3': { task_id: 'tk-3', name: 'Plumbing rough-in', project_id: 'P1', status: 'not_started', node_key: 'third/plumb', floor_label: 'Third', unit_label: null },
      'tk-4': { task_id: 'tk-4', name: 'Plumbing rough-in', project_id: 'P1', status: 'not_started', node_key: 'fourth/plumb', floor_label: 'Fourth', unit_label: null },
    },
  })
  // The model returns the task TYPE id (it never sees or names a floor). WHERE comes from input.structure.
  const PLUMB = 'type:P1:plumbing rough in'   // normTaskName('Plumbing rough-in')
  const taskUpd = () => JSON.stringify({
    issue_snag_found: { found: false, items: [] },
    update_found: { found: true, updates: [{ target_id: PLUMB, target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'plumbing done' }] },
  })
  const slot = (over: Record<string, unknown> = {}) => ({ floor: null, unit: null, all: false, except: null, ...over })

  test('no floor in the slot, 5 rows → which_item ASK over all five (no silent write)', async () => {
    const fake = fiveFloors()
    const out = await resolveInbound(
      { supabase: fake, orgId: 'org-1', from: '919900000000', projectId: 'P1' },
      { message: 'ASM plumbing rough-in done', structure: slot() },
      null, async () => {}, async () => taskUpd(),
    )
    expect(out.kind).toBe('disposed')
    const t = out.kind === 'disposed' ? out.terminals[0] : null
    expect(t?.kind).toBe('question_asked')
    expect(t?.kind === 'question_asked' && t.about).toBe('which_item')
    expect(new Set(t?.kind === 'question_asked' ? (t.shortlistIds ?? []) : [])).toEqual(new Set(['tk-g', 'tk-1', 'tk-2', 'tk-3', 'tk-4']))
    expect(out.kind === 'disposed' && out.terminals.some((x) => x.kind === 'object_updated')).toBe(false)
  })

  test('slot names the floor ("4th") → CODE pins that row, APPLIES (no ask)', async () => {
    const fake = fiveFloors()
    const out = await resolveInbound(
      { supabase: fake, orgId: 'org-1', from: '919900000000', projectId: 'P1' },
      { message: 'ASM 4th floor plumbing rough-in done', structure: slot({ floor: '4th' }) },
      null, async () => {}, async () => taskUpd(),
    )
    expect(out.kind).toBe('disposed')
    const t = out.kind === 'disposed' ? out.terminals[0] : null
    expect(t?.kind).toBe('object_updated')
    expect(t?.kind === 'object_updated' && t.update.target_id).toBe('tk-4')   // the pinned physical Fourth
  })

  // An EXPLICIT "all" in the slot sweeps every row of the type — ONE object_updated, never a which_item ask.
  test('slot.all "all plumbing done" → object_updated sweeping all 5 (no ask)', async () => {
    const fake = fiveFloors()
    const out = await resolveInbound(
      { supabase: fake, orgId: 'org-1', from: '919900000000', projectId: 'P1' },
      { message: 'ASM all plumbing rough-in done', structure: slot({ all: true }) },
      null, async () => {}, async () => taskUpd(),
    )
    expect(out.kind).toBe('disposed')
    const terms = out.kind === 'disposed' ? out.terminals : []
    expect(terms[0]?.kind).toBe('object_updated')
    const ids = terms[0]?.kind === 'object_updated' ? (terms[0].collectiveTargetIds ?? []) : []
    expect(new Set(ids)).toEqual(new Set(['tk-g', 'tk-1', 'tk-2', 'tk-3', 'tk-4']))
    expect(terms.some((x) => x.kind === 'question_asked')).toBe(false)
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

// UNIFIED INBOUND RESOLUTION v2 — ENFORCEMENT calibration tier (deterministic, offline). The prod
// failures ARE the rubric's pins, expressed as hand-authored CONTRACTS (what the model returns) →
// asserting the authoritative TERMINALS executeResolution disposes. This tier proves "the enforcement
// layer is the point": no found item dropped, MED never resolves, HIGH resolves ONLY with explicit
// closure, an invented target can't touch state, both-false is a mandatory logged ack. The RUBRIC tier
// (does the real model return the rubric's HIGH/MED/LOW + closure_explicit) needs a live key and runs in
// its own lane — not here (this gate has no model).

import { suite, test, expect } from './harness'
import {
  executeResolution, assertNoDrop, composeReadback, assertAllApplied, NOTHING_TO_UPDATE, NO_TASK_LIST, ALL_TASKS_DONE, noPlaceReply,
  type ResolutionContract, type ResolutionContext, type Terminal, type AttachUpdate, type TerminalOutcome, type TaskRowRef,
} from '../_siteops_resolution.ts'

const base = (over: Partial<ResolutionContract> = {}): ResolutionContract => ({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: false, updates: [] },
  ...over,
})
const upd = (o: Partial<AttachUpdate> & { target_id: string }): AttachUpdate => ({
  target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: '', ...o,
})
const ctx = (ids: string[], isImage = false): ResolutionContext => ({ candidateIds: new Set(ids), isImage })
const kinds = (ts: Terminal[]) => ts.map((t) => t.kind)
// A task target is a TYPE id now; give it one open row so the pin applies (rowId = the row we want written).
const ctxTaskOneRow = (typeId: string, rowId: string, slot: Partial<import('../_siteops_resolution.ts').StructureSlot> = {}): ResolutionContext => ({
  candidateIds: new Set([typeId]), isImage: false,
  taskRowsByType: new Map([[typeId, [{ id: rowId, name: 'X', floor: null, unit: null, title: 'X' }]]]),
  structure: { floor: null, unit: null, all: false, except: null, ...slot },
})

suite('siteops resolution v2 — enforcement (prod failures as pins)', () => {
  // Telugu "waterlogging resolved" — HIGH referent + EXPLICIT closure → RESOLVE + undo.
  test('HIGH + resolve + closure_explicit → object_updated(resolve) + undo', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'water', closure_explicit: true, reason: 'explicit "resolved"' })] } })
    const t = executeResolution(c, ctx(['water']))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('object_updated')
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('resolve')
    expect(t[0].kind === 'object_updated' && t[0].undo).toBe(true)
  })

  // THE OVERTURN PIN — "that thing is sorted" against a lone chase: HIGH referent, but closure is VAGUE
  // (closure_explicit=false). The rubric's AND means this ADVANCES, never closes. If this passed without
  // the field it was passing for the wrong reason.
  test('HIGH + resolve + NOT closure_explicit ("that thing is sorted") → ADDRESSING, never resolve', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'water', action: 'resolve', confidence: 'high', closure_explicit: false, reason: 'vague "sorted"' })] } })
    const t = executeResolution(c, ctx(['water']))
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('addressing')
    expect(t[0].kind === 'object_updated' && t[0].undo).toBe(false)
  })

  // The eaten tiles blocker — a fresh issue arrives while an UNRELATED chase is open. Chase NONE + new
  // issue: exactly one creation, ZERO updates. The chase is untouched (Fix 1's guarantee, now structural).
  test('new issue + unrelated open chase → object_created only, chase untouched', () => {
    const c = base({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'tiles broken, blocking work', location: 'first floor', project_hint: 'ASM Elite', confidence: 'high' }] } })
    const t = executeResolution(c, ctx(['water']))   // waterlogging chase offered, NOT matched
    expect(kinds(t)).toEqual(['object_created'])
    expect(t.filter((x) => x.kind === 'object_updated').length).toBe(0)
  })

  // "sari" + lone chase — engagement, not closure → ADDRESSING. No fast path: the model read it against
  // the lone chase and returned a high-confidence addressing update (closure_explicit=false).
  test('bare ack + lone chase → object_updated(addressing), never resolve', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'water', action: 'addressing', closure_explicit: false, reason: 'ack, on it' })] } })
    const t = executeResolution(c, ctx(['water']))
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('addressing')
  })

  // MED overrides closure entirely — even an EXPLICIT closure on a MED (uncertain) referent may not close.
  test('MED + resolve + closure_explicit → ADDRESSING (MED never resolves, even with explicit closure)', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'a', confidence: 'med', closure_explicit: true, reason: 'ambiguous among 3' })] } })
    const t = executeResolution(c, ctx(['a', 'b', 'c']))
    expect(t[0].kind).toBe('object_updated')
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('addressing')   // NOT 'resolve'
  })

  // Both axes in one message — "waterlogging fixed, tiles broke" → one resolve + one new issue. Terminals
  // accumulate PER FINDING; order is stable (updates in contract order, then items) so the caller builds
  // ONE combined readback without re-deriving groupings.
  test('both axes true → object_updated(resolve) then object_created (stable per-finding order)', () => {
    const c = base({
      update_found: { found: true, updates: [upd({ target_id: 'water', closure_explicit: true, reason: 'fixed' })] },
      issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'tiles broke', location: null, project_hint: 'ASM Elite', confidence: 'high' }] },
    })
    const t = executeResolution(c, ctx(['water']))
    expect(kinds(t)).toEqual(['object_updated', 'object_created'])   // updates first, then items — deterministic
  })

  // Fix 2 guard, generalized — an update whose target_id was NOT in the offered candidate set (e.g. a
  // cross-project chase the message's project doesn't include) can NEVER touch state → ASK, not update.
  test('update on an un-offered target → question_asked (no cross-project state touch)', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'other-proj-chase', reason: 'model reached across projects' })] } })
    const t = executeResolution(c, ctx(['water']))   // 'other-proj-chase' not offered
    expect(t[0].kind).toBe('question_asked')
    expect(t.filter((x) => x.kind === 'object_updated').length).toBe(0)
  })

  // LOW update → ASK (uncertainty never touches existing state).
  test('LOW update → question_asked (pick-one w/ "it\'s new")', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'water', confidence: 'low', closure_explicit: false, reason: 'unsure' })] } })
    expect(executeResolution(c, ctx(['water']))[0].kind).toBe('question_asked')
  })

  // New item with no resolvable site → ASK which project (never mis-file to the wrong building).
  test('new item, no project_hint → question_asked(which_project)', () => {
    const c = base({ issue_snag_found: { found: true, items: [{ kind: 'snag', detail: 'crack in slab', location: null, project_hint: null, confidence: 'high' }] } })
    const t = executeResolution(c, ctx([]))
    expect(t[0].kind).toBe('question_asked')
    expect(t[0].kind === 'question_asked' && t[0].about).toBe('which_project')
  })

  // New item MED → create as a NOTE + upgrade offer (captured, not corrupt; never dropped).
  test('MED new item → object_created as note + upgrade offer', () => {
    const c = base({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'maybe a leak', location: '2F', project_hint: 'ASM Elite', confidence: 'med' }] } })
    const t = executeResolution(c, ctx([]))
    expect(t[0].kind).toBe('object_created')
    expect(t[0].kind === 'object_created' && t[0].as).toBe('note')
    expect(t[0].kind === 'object_created' && t[0].upgradeOffer).toBe(true)
  })

  // Both false, non-image → acked_didnt_catch is MANDATORY and carries the contract (auditable miss).
  test('both false + text → exactly one acked_didnt_catch, carrying the contract', () => {
    const t = executeResolution(base(), ctx(['water']))
    expect(kinds(t)).toEqual(['acked_didnt_catch'])
    expect(t[0].kind === 'acked_didnt_catch' && !!t[0].contract).toBe(true)
  })

  // Both false + image → queued_as_evidence (cautious: a photo is never dropped, never force-created).
  test('both false + image → queued_as_evidence', () => {
    expect(kinds(executeResolution(base(), ctx([], true)))).toEqual(['queued_as_evidence'])
  })

  // THE PARKING LESSON (live 2026-07-05) — a MED task target used to land object_updated(addressing),
  // which the executor can only HOLD (no soft rung exists for a task: applying IS the state change).
  // The design is "unconfident → ASK": a med task target asks the pick, exactly like low. Issues/todos
  // keep their med→addressing soft rung (unchanged above).
  test('MED + TASK target → question_asked(which_item), never a held object_updated', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'tk-park', target_kind: 'task', action: 'progress', confidence: 'med', closure_explicit: false, reason: 'probably the parking task' })] } })
    const t = executeResolution(c, ctx(['tk-park']))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('question_asked')
    expect(t[0].kind === 'question_asked' && t[0].about).toBe('which_item')
    expect(t[0].kind === 'question_asked' && t[0].update?.target_id).toBe('tk-park')
  })

  // ASK-BEFORE-EVIDENCE — both-false + image with NEAR candidates (lexical overlap computed by the
  // caller, passed in ctx) → ONE place_photo question carrying the shortlist, NOT a silent evidence
  // park. The park remains the floor when nothing is near (test above) or the pick can't be sent.
  test('both false + image + near candidates → question_asked(place_photo) carrying the shortlist', () => {
    const t = executeResolution(base(), { candidateIds: new Set(['tk-park']), isImage: true, nearCandidateIds: ['tk-park'] })
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('question_asked')
    expect(t[0].kind === 'question_asked' && t[0].about).toBe('place_photo')
    expect(t[0].kind === 'question_asked' && t[0].shortlistIds).toEqual(['tk-park'])
  })

  test('both false + image + EMPTY near list → queued_as_evidence (the floor stands)', () => {
    const t = executeResolution(base(), { candidateIds: new Set(['tk-park']), isImage: true, nearCandidateIds: [] })
    expect(kinds(t)).toEqual(['queued_as_evidence'])
  })

  // ── FIX A·ii — the `nearest` RECALL FLOOR. The model, on found:false, still names its meaning-ranked best
  // guess(es). A med/low nearest turns a would-be silent didn't-catch into a which_item ASK ("did you mean
  // X?"); a genuinely-off both-false (no nearest, no lexical belt) stays the honest ack. The transformer miss. ─
  const nearest = (o: Partial<{ target_id: string; target_kind: 'task' | 'issue' | 'todo'; plausibility: 'med' | 'low' | 'none'; action: 'progress' | 'addressing' | 'resolve'; closure_explicit: boolean; reason: string }> & { target_id: string }) =>
    ({ target_kind: 'issue' as const, plausibility: 'med' as const, action: 'resolve' as const, closure_explicit: true, reason: 'transformer ≈ the wiring issue', ...o })
  const withNearest = (arr: ReturnType<typeof nearest>[]) => base({ update_found: { found: false, updates: [], nearest: arr } } as Partial<ResolutionContract>)

  test('both-false + med nearest (in set) → question_asked(which_item) over the nearest, carrying its verdict', () => {
    const t = executeResolution(withNearest([nearest({ target_id: 'iss-w' })]), ctx(['iss-w']))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('question_asked')
    expect(t[0].kind === 'question_asked' && t[0].about).toBe('which_item')
    expect(t[0].kind === 'question_asked' && (t[0].shortlistIds ?? []).includes('iss-w')).toBe(true)
    // a SINGLE nearest carries its verdict so a confirm can RESOLVE (closure_explicit rides through)
    expect(t[0].kind === 'question_asked' && t[0].update?.closure_explicit).toBe(true)
    expect(t[0].kind === 'question_asked' && t[0].update?.target_id).toBe('iss-w')
  })

  test('both-false + NO nearest + NO belt → acked_didnt_catch (the honest miss stands)', () => {
    expect(kinds(executeResolution(withNearest([]), ctx(['iss-w'])))).toEqual(['acked_didnt_catch'])
  })

  test('both-false + nearest plausibility "none" only → acked_didnt_catch (none is not a guess)', () => {
    expect(kinds(executeResolution(withNearest([nearest({ target_id: 'iss-w', plausibility: 'none' })]), ctx(['iss-w'])))).toEqual(['acked_didnt_catch'])
  })

  test('both-false + nearest whose target is NOT in the candidate set → ignored → acked_didnt_catch (never ask an un-offered id)', () => {
    expect(kinds(executeResolution(withNearest([nearest({ target_id: 'ghost' })]), ctx(['iss-w'])))).toEqual(['acked_didnt_catch'])
  })

  // The lexical belt is IMAGE-ONLY (2026-07-09): it scored on SPELLING, so on the text path it offered every
  // task containing the word "wiring" and was blind to "fifth". A TEXT both-false asks over the model's
  // MEANING-ranked nearest ALONE; the belt survives only where a caption may be empty or pure Telugu and
  // place_photo still needs somewhere to point. (This test used to assert the union — it passed only because
  // the harness compared Sets via JSON.stringify, i.e. "{}" === "{}". Both halves are now real.)
  test('both-false, TEXT → shortlist is the model’s nearest ALONE; the lexical belt does not union in', () => {
    const t = executeResolution(withNearest([nearest({ target_id: 'iss-w' })]), { candidateIds: new Set(['iss-w', 'tk-belt']), isImage: false, nearCandidateIds: ['tk-belt'] })
    expect(t[0].kind).toBe('question_asked')
    expect(new Set(t[0].kind === 'question_asked' ? (t[0].shortlistIds ?? []) : [])).toEqual(new Set(['iss-w']))
  })

  test('both-false, IMAGE → the belt DOES union into the placement shortlist (deduped)', () => {
    const t = executeResolution(withNearest([nearest({ target_id: 'iss-w' })]), { candidateIds: new Set(['iss-w', 'tk-belt']), isImage: true, nearCandidateIds: ['tk-belt'] })
    expect(t[0].kind).toBe('question_asked')
    expect(t[0].kind === 'question_asked' && t[0].about).toBe('place_photo')
    expect(new Set(t[0].kind === 'question_asked' ? (t[0].shortlistIds ?? []) : [])).toEqual(new Set(['iss-w', 'tk-belt']))
  })
})

// LIVE FAILURE (2026-07-09): a supervisor reported "tiles not yet laid" / "ceilings not yet complete" against
// chased items. With only progress|addressing|resolve on the wire the model returned action "progress" with the
// reason "indicating NO progress on floor tiling" — the field contradicting its own justification — and a
// confirm would have logged progress on work that had not started. `blocked` is the truthful action: it
// advances nothing, closes nothing, and is therefore safe at med.
suite('siteops resolution v2 — BLOCKED (the negative report)', () => {
  test('HIGH + blocked → object_updated(blocked), never advances, never resolves, no undo', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'td-tiles', target_kind: 'todo', action: 'blocked', confidence: 'high', closure_explicit: false, reason: 'tiles not yet laid' })] } })
    const t = executeResolution(c, ctx(['td-tiles']))
    expect(t.length).toBe(1)
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('blocked')
    expect(t[0].kind === 'object_updated' && t[0].undo).toBe(false)
  })

  // Blocked changes no status, so the med→ADDRESSING rung must not swallow it: "not yet laid" recorded as
  // ADDRESSING would tell the supervisor the opposite of what they said.
  test('MED + blocked on an issue → blocked (NOT addressing)', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'iss-w', target_kind: 'issue', action: 'blocked', confidence: 'med', closure_explicit: false, reason: 'still no municipal water' })] } })
    const t = executeResolution(c, ctx(['iss-w']))
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('blocked')
  })

  // LOW still asks — uncertainty never touches state, blocked or not.
  test('LOW + blocked → which_item ask (uncertainty never writes)', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'iss-w', target_kind: 'issue', action: 'blocked', confidence: 'low', closure_explicit: false, reason: 'maybe the water one' })] } })
    const t = executeResolution(c, ctx(['iss-w']))
    expect(t[0].kind).toBe('question_asked')
  })

  // A med blocked TASK, pinned to one row → blocked (never advances/closes; safe at med). The pin removed the
  // floor ambiguity; the type match at med is enough for a status-free blocker.
  test('MED + blocked on a TASK (pinned to one row) → blocked', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'T', target_kind: 'task', action: 'blocked', confidence: 'med', closure_explicit: false, reason: 'tiles not yet laid' })] } })
    const t = executeResolution(c, ctxTaskOneRow('T', 'tk-tile'))
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('blocked')
    expect(t[0].kind === 'object_updated' && t[0].update.target_id).toBe('tk-tile')   // retargeted type → row
  })

  // An invented target is still untouchable.
  test('blocked on an un-offered target → ask, never a write', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'ghost', action: 'blocked', confidence: 'high', closure_explicit: false, reason: 'x' })] } })
    const t = executeResolution(c, ctx(['iss-w']))
    expect(t[0].kind).toBe('question_asked')
  })

  // The readback must never borrow progress vocabulary for a not-done report.
  test('readback says still open + chasing sooner — never "updated"/"resolved"/"on it"', () => {
    const o: TerminalOutcome = {
      terminal: { kind: 'object_updated', update: upd({ target_id: 'tk', target_kind: 'task', action: 'blocked' }), applied: 'blocked', undo: false, readback: '', reason: '' },
      status: 'ok', label: 'Floor tiling — Fourth',
    }
    const body = composeReadback([o])
    expect(body.includes('still open')).toBe(true)
    expect(body.includes('chasing sooner')).toBe(true)
    expect(/updated|resolved|on it/.test(body)).toBe(false)
  })
})

suite('siteops resolution v2 — combined readback (one message, consequence-ordered, partial-honest)', () => {
  const updResolve = (label: string, status: 'ok' | 'failed' = 'ok'): TerminalOutcome => ({
    terminal: { kind: 'object_updated', update: upd({ target_id: 't' }), applied: 'resolve', undo: true, readback: '', reason: '' }, status, label,
  })
  const created = (label: string, status: 'ok' | 'failed' = 'ok'): TerminalOutcome => ({
    terminal: { kind: 'object_created', item: { kind: 'issue', detail: label, location: null, project_hint: 'P', confidence: 'high' }, as: 'classified', upgradeOffer: false, reason: '' }, status, label,
  })

  // both-axes success — ONE reply, resolve FIRST (consequence), then the new item. Note the outcomes are
  // passed in axis order (created before resolve); the composer must re-order by consequence.
  test('both-axes success → "Got it — ✓ X resolved · logged new: Y" (resolve ordered first)', () => {
    const out = composeReadback([created('tiles broke'), updResolve('waterlogging')])
    expect(out).toBe('Got it — ✓ “waterlogging” resolved · logged new: “tiles broke”')
  })

  // both-axes PARTIAL failure — the resolve landed, the create failed. The reply tells the truth about
  // BOTH, never all-or-nothing.
  test('both-axes partial (create failed) → truthful about both halves', () => {
    const out = composeReadback([updResolve('waterlogging'), created('tiles broke', 'failed')])
    expect(out).toBe('Got it — ✓ “waterlogging” resolved · ⚠️ couldn\'t log “tiles broke” — saved for review')
  })

  test('lone didnt-catch → bare sentence, no "Got it" wrapper', () => {
    const t: Terminal = { kind: 'acked_didnt_catch', contract: base(), reason: '' }
    expect(composeReadback([{ terminal: t, status: 'ok', label: '' }])).toBe(NOTHING_TO_UPDATE)
  })

  // An UN-SENDABLE place_photo pick fell back to the evidence park (executor) — the readback must say the
  // honest terminal ("photo saved as evidence"), never "couldn't place 'photo'" over a photo that IS saved.
  test('un-sendable place_photo pick → the honest evidence line, not a ⚠️ failure', () => {
    const t: Terminal = { kind: 'question_asked', about: 'place_photo', ref: null, shortlistIds: ['x'], reason: '' }
    expect(composeReadback([{ terminal: t, status: 'failed', label: 'photo' }])).toBe('Got it — photo saved as evidence')
  })
})

suite('siteops resolution v2 — assertAllApplied (effect-side no-drop BITES)', () => {
  test('3 terminals but 2 outcomes → throws', () => {
    const terms: Terminal[] = [
      { kind: 'object_updated', update: upd({ target_id: 'a' }), applied: 'resolve', undo: true, readback: '', reason: '' },
      { kind: 'object_created', item: { kind: 'issue', detail: 'x', location: null, project_hint: 'P', confidence: 'high' }, as: 'classified', upgradeOffer: false, reason: '' },
      { kind: 'queued_as_evidence', reason: '' },
    ]
    const outs: TerminalOutcome[] = [{ terminal: terms[0], status: 'ok', label: 'a' }, { terminal: terms[1], status: 'ok', label: 'x' }]
    let threw = false
    try { assertAllApplied(terms, outs) } catch { threw = true }
    expect(threw).toBe(true)
  })
  test('equal counts → does not throw', () => {
    const terms: Terminal[] = [{ kind: 'queued_as_evidence', reason: '' }]
    assertAllApplied(terms, [{ terminal: terms[0], status: 'ok', label: '' }])
    expect(true).toBe(true)
  })
})

suite('siteops resolution v2 — the assertion BITES (no-drop is structural, per-finding)', () => {
  // 2 updates found but 0 terminals → throws.
  test('2 updates found but 0 terminals → assertNoDrop throws', () => {
    const c = base({ update_found: { found: true, updates: [upd({ target_id: 'a' }), upd({ target_id: 'b' })] } })
    let threw = false
    try { assertNoDrop(c, []) } catch { threw = true }
    expect(threw).toBe(true)
  })

  // MIXED message, per-finding: 1 update + 1 item, but only the UPDATE terminal — the item was dropped.
  // A per-message count would wrongly pass (2 findings, 1 terminal "close enough"); per-finding must bite.
  test('mixed (1 update + 1 item), only the update terminal → assertNoDrop throws (item dropped)', () => {
    const c = base({
      update_found: { found: true, updates: [upd({ target_id: 'water', closure_explicit: true })] },
      issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'tiles broke', location: null, project_hint: 'P', confidence: 'high' }] },
    })
    let threw = false
    try {
      assertNoDrop(c, [{ kind: 'object_updated', update: upd({ target_id: 'water' }), applied: 'resolve', undo: true, readback: '', reason: '' }])
    } catch { threw = true }
    expect(threw).toBe(true)
  })

  // RUBRIC tier — deferred to the live lane (this gate has no model key). Kept as a visible spec.
  test.skip(
    'RUBRIC: real model returns HIGH+resolve+closure_explicit for the Telugu "waterlogging resolved" transcript',
    'live-LLM lane only — the deterministic gate has no key; run in the rubric-calibration lane',
  )
})

// LIVE FAILURE (2026-07-09) — the recall floor asked about unrelated work, and the ask then trapped the thread.
//   "transformer arranged"  → "did you mean: Arrange for aggregate (kankara) and sand?"   (med, reason "may relate to")
//   "slab link done"        → "did you mean: plan properly tomorrow for required item?"   (med)
// A `low` used to ask exactly as loudly as a `med`, and a lexical belt of raw token overlap added more rows.
suite('siteops resolution v2 — the recall floor has a floor', () => {
  // The `reason` is the model BETTING on the match — because a hedged one ("may relate", "might be") is now
  // VETOED in code and never asks, however plausible the model called it (see type_tie.test.ts, HV1–HV3). This
  // fixture used to read "may relate" — the very phrase from the failure above — so it was asserting that a
  // hedged guess asks. It asserts the confident case now, which is what its name always claimed.
  const nearest = (plausibility: 'med' | 'low') => base({
    update_found: { found: false, updates: [], nearest: [{ target_id: 'iss-w', target_kind: 'issue', plausibility, action: 'progress', closure_explicit: false, reason: 'the message reports this same issue is fixed' }] },
  })

  test('a MED nearest asks (the recall floor still catches a real match)', () => {
    const t = executeResolution(nearest('med'), ctx(['iss-w']))
    expect(t[0].kind).toBe('question_asked')
  })

  test('a LOW nearest does NOT ask — it is a guess, and a wrong ask traps the thread', () => {
    const t = executeResolution(nearest('low'), ctx(['iss-w']))
    expect(t[0].kind).toBe('acked_didnt_catch')
  })

  // The belt is meaning-free token overlap. It matched "wiring" and was blind to "fifth".
  test('the lexical belt no longer raises a TEXT ask (image path only)', () => {
    const c = base({ update_found: { found: false, updates: [], nearest: [] } })
    const t = executeResolution(c, { candidateIds: new Set(['tk-1']), isImage: false, nearCandidateIds: ['tk-1'] })
    expect(t[0].kind).toBe('acked_didnt_catch')
    const img = executeResolution(c, { candidateIds: new Set(['tk-1']), isImage: true, nearCandidateIds: ['tk-1'] })
    expect(img[0].kind).toBe('question_asked')   // an image caption may be empty; place_photo still needs a shortlist
  })
})

// A progress report on a site whose tasks we do not track has nowhere to land. "Didn't catch" blamed the
// supervisor for our missing task list, and the recall floor turned it into a quiz about unrelated items.
suite('siteops resolution v2 — untracked work gets an honest terminal', () => {
  const bothFalse = base({ update_found: { found: false, updates: [], nearest: [] } })

  test('progress + NO task list → acked_untracked_work(none), and the reply says so', () => {
    const t = executeResolution(bothFalse, { candidateIds: new Set([]), isImage: false, taskCoverage: 'none', itemType: 'progress' })
    expect(t[0].kind).toBe('acked_untracked_work')
    expect(t[0].kind === 'acked_untracked_work' && t[0].coverage).toBe('none')
    expect(composeReadback([{ terminal: t[0], status: 'ok', label: '' }])).toBe(NO_TASK_LIST)
  })

  test('progress + tasks all done → acked_untracked_work(all_done), offers to reopen', () => {
    const t = executeResolution(bothFalse, { candidateIds: new Set([]), isImage: false, taskCoverage: 'all_done', itemType: 'progress' })
    expect(t[0].kind === 'acked_untracked_work' && t[0].coverage).toBe('all_done')
    expect(composeReadback([{ terminal: t[0], status: 'ok', label: '' }])).toBe(ALL_TASKS_DONE)
  })

  // A grunt is not work. Without this gate, "sari" would be answered "I don't track a task list for this site".
  test('a non-progress fragment on a task-less site is still an honest didn-t-catch', () => {
    const t = executeResolution(bothFalse, { candidateIds: new Set([]), isImage: false, taskCoverage: 'none', itemType: null })
    expect(t[0].kind).toBe('acked_didnt_catch')
  })
})

// "wiring completed for the entire apartment EXCEPT the fifth floor" — one update; all/except are in the SLOT.
suite('siteops resolution v2 — collective EXCEPT (all of X but Y)', () => {
  const rows = [
    { id: 'w1', name: 'Wiring', floor: 'First', unit: 'A', title: 'Wiring — First · A' },
    { id: 'w2', name: 'Wiring', floor: 'Second', unit: 'A', title: 'Wiring — Second · A' },
    { id: 'w5', name: 'Wiring', floor: 'Fifth', unit: 'A', title: 'Wiring — Fifth · A' },
  ]
  const ctxAll = (except: { floors: string[]; units: string[] } | null): ResolutionContext => ({
    candidateIds: new Set(['T']), isImage: false,
    taskRowsByType: new Map([['T', rows]]),
    structure: { floor: null, unit: null, all: true, except },
  })
  const c = base({ update_found: { found: true, updates: [upd({ target_id: 'T', target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false })] } })

  test('sweeps every sibling EXCEPT the named floor', () => {
    const t = executeResolution(c, ctxAll({ floors: ['Fifth'], units: [] }))
    const ids = t[0].kind === 'object_updated' ? [...(t[0].collectiveTargetIds ?? [])].sort() : []
    expect(ids).toEqual(['w1', 'w2'])
  })

  test('no exclusion → sweeps all of them', () => {
    const t = executeResolution(c, ctxAll(null))
    expect(t[0].kind === 'object_updated' && (t[0].collectiveTargetIds ?? []).length).toBe(3)
  })

  // "all done except all of them" is incoherent — ASK rather than sweep the very rows they carved out.
  test('an exclusion that removes EVERY sibling asks, never sweeps', () => {
    const t = executeResolution(c, ctxAll({ floors: ['First', 'Second', 'Fifth'], units: [] }))
    expect(t[0].kind).toBe('question_asked')
  })
})

// The user-facing text of the honest "couldn't place it" terminal (2026-07-11). Never a wrong write; never
// "didn't catch": the place is real, the task type just isn't tracked there — so there is nothing to pick
// between, and it points to the app. (The TWIN case — a floor that doesn't exist at all — is no longer a
// terminal at all: it is a which_item ask carrying the "no such floor" sentence. See no_such_floor_ask.test.ts.)
suite('siteops resolution v2 — acked_no_place readback (untracked task at a real place)', () => {
  const rows: TaskRowRef[] = [{ id: 'w4', name: 'Wiring', floor: 'Fourth', unit: null, title: 'Wiring — Fourth' }]
  const ctxOf = (slot: { floor?: string | null }, geometry: import('../_siteops_resolution.ts').Geometry | null): ResolutionContext => ({
    candidateIds: new Set(['T']), isImage: false,
    taskRowsByType: new Map([['T', rows]]),
    structure: { floor: slot.floor ?? null, unit: null, all: false, except: null },
    geometry,
  })
  const upd = (): AttachUpdate => ({ target_id: 'T', target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'x' })
  const c: ResolutionContract = { issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [upd()] } }

  test('the lone reply says the task isn’t tracked there, points to the app, never blames them', () => {
    // Fifth exists in geometry, but Wiring has no row there — nothing anywhere to pick between.
    const t = executeResolution(c, ctxOf({ floor: 'Fifth' }, { floors: ['Ground', 'Fourth', 'Fifth'], unitsByFloor: new Map() }))
    expect(t[0].kind).toBe('acked_no_place')
    const reply = composeReadback([{ terminal: t[0], status: 'ok', label: '' }])
    expect(reply).toBe(t[0].kind === 'acked_no_place' ? noPlaceReply(t[0]) : '')
    expect(/don't track.*Wiring.*Fifth/i.test(reply)).toBe(true)
    expect(/in the app/i.test(reply)).toBe(true)
    expect(/didn't catch/i.test(reply)).toBe(false)
  })
})

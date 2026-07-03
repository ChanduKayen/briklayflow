// UNIFIED INBOUND RESOLUTION v2 — ENFORCEMENT calibration tier (deterministic, offline). The prod
// failures ARE the rubric's pins, expressed as hand-authored CONTRACTS (what the model returns) →
// asserting the authoritative TERMINALS executeResolution disposes. This tier proves "the enforcement
// layer is the point": no found item dropped, MED never resolves, HIGH resolves ONLY with explicit
// closure, an invented target can't touch state, both-false is a mandatory logged ack. The RUBRIC tier
// (does the real model return the rubric's HIGH/MED/LOW + closure_explicit) needs a live key and runs in
// its own lane — not here (this gate has no model).

import { suite, test, expect } from './harness'
import {
  executeResolution, assertNoDrop, composeReadback, assertAllApplied,
  type ResolutionContract, type ResolutionContext, type Terminal, type AttachUpdate, type TerminalOutcome,
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
    expect(out).toBe('Got it — ✓ waterlogging resolved · logged new: tiles broke')
  })

  // both-axes PARTIAL failure — the resolve landed, the create failed. The reply tells the truth about
  // BOTH, never all-or-nothing.
  test('both-axes partial (create failed) → truthful about both halves', () => {
    const out = composeReadback([updResolve('waterlogging'), created('tiles broke', 'failed')])
    expect(out).toBe('Got it — ✓ waterlogging resolved · ⚠️ couldn\'t log tiles broke — saved for review')
  })

  test('lone didnt-catch → bare sentence, no "Got it" wrapper', () => {
    const t: Terminal = { kind: 'acked_didnt_catch', contract: base(), reason: '' }
    expect(composeReadback([{ terminal: t, status: 'ok', label: '' }])).toBe("Didn't catch a site update in that — try again if you meant to send one.")
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

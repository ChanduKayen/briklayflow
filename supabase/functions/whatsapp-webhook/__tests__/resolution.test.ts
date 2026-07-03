// UNIFIED INBOUND RESOLUTION v2 — ENFORCEMENT calibration tier (deterministic, offline). The prod
// failures ARE the rubric's pins, expressed as hand-authored CONTRACTS (what the model returns) →
// asserting the authoritative TERMINALS executeResolution disposes. This tier proves "the enforcement
// layer is the point": no found item dropped, MED never resolves, an invented target can't touch state,
// both-false is a mandatory logged ack. The RUBRIC tier (does the real model actually return HIGH for the
// Telugu resolve) needs a live key and runs in its own lane — not here (this gate has no model).

import { suite, test, expect } from './harness'
import {
  executeResolution, assertNoDrop,
  type ResolutionContract, type ResolutionContext, type Terminal,
} from '../_siteops_resolution.ts'

const base = (over: Partial<ResolutionContract> = {}): ResolutionContract => ({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: false, updates: [] },
  ...over,
})
const ctx = (ids: string[], isImage = false): ResolutionContext => ({ candidateIds: new Set(ids), isImage })
const kinds = (ts: Terminal[]) => ts.map((t) => t.kind)

suite('siteops resolution v2 — enforcement (prod failures as pins)', () => {
  // Telugu "waterlogging resolved" — HIGH + explicit closure → RESOLVE + undo. (The Telugu-ness is the
  // model's job; at the contract level it is a high-confidence resolve on the offered chase.)
  test('HIGH + resolve on an offered chase → object_updated(resolve) + undo', () => {
    const c = base({ update_found: { found: true, updates: [{ target_id: 'water', target_kind: 'issue', action: 'resolve', confidence: 'high', reason: 'closure language' }] } })
    const t = executeResolution(c, ctx(['water']))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('object_updated')
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('resolve')
    expect(t[0].kind === 'object_updated' && t[0].undo).toBe(true)
  })

  // The eaten tiles blocker — a fresh issue arrives while an UNRELATED chase is open. Chase NONE + new
  // issue: exactly one creation, ZERO updates. The chase is untouched (Fix 1's guarantee, now structural).
  test('new issue + unrelated open chase → object_created only, chase untouched', () => {
    const c = base({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'tiles broken, blocking work', location: 'first floor', project_hint: 'ASM Elite', confidence: 'high' }] } })
    const t = executeResolution(c, ctx(['water']))   // waterlogging chase offered, NOT matched
    expect(kinds(t)).toEqual(['object_created'])
    expect(t.filter((x) => x.kind === 'object_updated').length).toBe(0)
  })

  // "sari" + lone chase — engagement, not closure → ADDRESSING (no resolve). No fast path: the model read
  // it against the lone chase and returned a high-confidence addressing update.
  test('bare ack + lone chase → object_updated(addressing), never resolve', () => {
    const c = base({ update_found: { found: true, updates: [{ target_id: 'water', target_kind: 'issue', action: 'addressing', confidence: 'high', reason: 'ack, on it' }] } })
    const t = executeResolution(c, ctx(['water']))
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('addressing')
    expect(t[0].kind === 'object_updated' && t[0].undo).toBe(false)
  })

  // "that thing is sorted" + 3 items — MEDIUM: the model even said resolve, but MED NEVER resolves. Code
  // downgrades to ADDRESSING; existing state is advanced but not closed on an uncertain referent.
  test('MED + resolve → downgraded to ADDRESSING (MED never resolves)', () => {
    const c = base({ update_found: { found: true, updates: [{ target_id: 'a', target_kind: 'issue', action: 'resolve', confidence: 'med', reason: 'ambiguous among 3' }] } })
    const t = executeResolution(c, ctx(['a', 'b', 'c']))
    expect(t[0].kind).toBe('object_updated')
    expect(t[0].kind === 'object_updated' && t[0].applied).toBe('addressing')   // NOT 'resolve'
  })

  // Both axes in one message — "waterlogging fixed, tiles broke" → one resolve + one new issue.
  test('both axes true → object_updated(resolve) AND object_created', () => {
    const c = base({
      update_found: { found: true, updates: [{ target_id: 'water', target_kind: 'issue', action: 'resolve', confidence: 'high', reason: 'fixed' }] },
      issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'tiles broke', location: null, project_hint: 'ASM Elite', confidence: 'high' }] },
    })
    const t = executeResolution(c, ctx(['water']))
    expect(kinds(t).sort()).toEqual(['object_created', 'object_updated'])
  })

  // Fix 2 guard, generalized — an update whose target_id was NOT in the offered candidate set (e.g. a
  // cross-project chase the message's project doesn't include) can NEVER touch state → ASK, not update.
  test('update on an un-offered target → question_asked (no cross-project state touch)', () => {
    const c = base({ update_found: { found: true, updates: [{ target_id: 'other-proj-chase', target_kind: 'issue', action: 'resolve', confidence: 'high', reason: 'model reached across projects' }] } })
    const t = executeResolution(c, ctx(['water']))   // 'other-proj-chase' not offered
    expect(t[0].kind).toBe('question_asked')
    expect(t.filter((x) => x.kind === 'object_updated').length).toBe(0)
  })

  // LOW update → ASK (uncertainty never touches existing state).
  test('LOW update → question_asked (pick-one w/ "it\'s new")', () => {
    const c = base({ update_found: { found: true, updates: [{ target_id: 'water', target_kind: 'issue', action: 'resolve', confidence: 'low', reason: 'unsure' }] } })
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
    const c = base()
    const t = executeResolution(c, ctx(['water']))
    expect(kinds(t)).toEqual(['acked_didnt_catch'])
    expect(t[0].kind === 'acked_didnt_catch' && !!t[0].contract).toBe(true)
  })

  // Both false + image → queued_as_evidence (cautious: a photo is never dropped, never force-created).
  test('both false + image → queued_as_evidence', () => {
    expect(kinds(executeResolution(base(), ctx([], true)))).toEqual(['queued_as_evidence'])
  })
})

suite('siteops resolution v2 — the assertion BITES (no-drop is structural)', () => {
  // The backstop must actually throw when a (contract, terminals) pair drops a found item — otherwise the
  // "no code path may drop" guarantee is decorative. Feed a dropping pair directly.
  test('2 updates found but 0 terminals → assertNoDrop throws', () => {
    const c = base({ update_found: { found: true, updates: [
      { target_id: 'a', target_kind: 'issue', action: 'resolve', confidence: 'high', reason: '' },
      { target_id: 'b', target_kind: 'issue', action: 'resolve', confidence: 'high', reason: '' },
    ] } })
    let threw = false
    try { assertNoDrop(c, []) } catch { threw = true }
    expect(threw).toBe(true)
  })

  test('item found but only an unrelated evidence terminal → assertNoDrop throws', () => {
    const c = base({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'x', location: null, project_hint: 'P', confidence: 'high' }] } })
    let threw = false
    try { assertNoDrop(c, [{ kind: 'queued_as_evidence', reason: 'wrong' }]) } catch { threw = true }
    expect(threw).toBe(true)
  })

  // RUBRIC tier — deferred to the live lane (this gate has no model key). Kept as a visible spec.
  test.skip(
    'RUBRIC: real model returns HIGH+resolve for the Telugu "waterlogging resolved" transcript',
    'live-LLM lane only — the deterministic gate has no key; run in the rubric-calibration lane',
  )
})

// UNIFIED INBOUND RESOLUTION v2 — the ENFORCEMENT LAYER. "The LLM proposes, code disposes."
//
// One language-native LLM call (built + parsed in _siteops_resolution_llm — the caller, Phase 1b) answers
// TWO questions per inbound against the project's candidate set, and returns a ResolutionContract. This
// module is the code half: executeResolution() consumes that (advisory) contract and returns exactly
// one-or-more TERMINALS — the AUTHORITATIVE outcome. It re-derives every action from the LADDER regardless
// of what the model said (MED never resolves; an invented target can't touch state), and it ASSERTS that
// no found item is ever dropped. This is why the no-miss guarantee is code, not prompt: a prompt can
// promise; only `assertNoDrop` + a queryable terminal can enforce.
//
// PURE. No I/O, no model, no Deno. The caller applies the terminals' side effects (create/update/ask/
// evidence/park) and the LLM-failure park path; executeResolution only DECIDES, so the decision is
// provable offline against hand-authored contract fixtures (the enforcement calibration tier).

// ── THE CONTRACT (what the model returns; advisory) ──────────────────────────
export type Confidence = 'high' | 'med' | 'low'

// Axis 1 — OBSERVE. A new issue/snag the message reports. `project_hint` is the model's project pick
// (LOCKED: project resolution folds INTO the one call — no upstream scoreName heuristic); null when the
// site is genuinely unclear → the enforcement layer ASKS which site rather than mis-filing.
export interface ObserveItem {
  kind: 'issue' | 'snag'
  detail: string
  location: string | null
  project_hint: string | null
  confidence: Confidence
}

// Axis 2 — ATTACH. A grounded match onto an EXISTING candidate. `target_id` MUST be a member of the
// candidate set the call was given; the model reads closure vs progress into `action`, but the ladder
// (code) gates whether that action is allowed to LAND.
export interface AttachUpdate {
  target_id: string
  target_kind: 'task' | 'issue' | 'todo'
  action: 'progress' | 'addressing' | 'resolve'
  confidence: Confidence
  reason: string
}

export interface ResolutionContract {
  issue_snag_found: { found: boolean; items: ObserveItem[] }
  update_found: { found: boolean; updates: AttachUpdate[] }
}

// ── CONTEXT the code needs to DISPOSE (not the model's to decide) ────────────
export interface ResolutionContext {
  candidateIds: Set<string>   // the exact target_ids the call was given — an update targeting anything
                              // else is an INVENTED referent and may never touch state (→ ASK).
  isImage: boolean            // modality — a photo with nothing confident is queued as evidence, cautiously.
}

// ── THE TERMINALS (the authoritative, auditable outcomes) ────────────────────
// EXACTLY one-or-more per input. Every terminal carries a `reason` → written to the trail → the input's
// destination is queryable after the fact. `acked_didnt_catch` carries the full contract so a MISS is
// auditable, never silent.
export type Terminal =
  | { kind: 'object_created'; item: ObserveItem; as: 'classified' | 'note'; upgradeOffer: boolean; reason: string }
  | { kind: 'object_updated'; update: AttachUpdate; applied: 'resolve' | 'addressing'; undo: boolean; readback: string; reason: string }
  | { kind: 'question_asked'; about: 'which_item' | 'which_project'; ref: string | null; reason: string }
  | { kind: 'queued_as_evidence'; reason: string }
  | { kind: 'acked_didnt_catch'; contract: ResolutionContract; reason: string }

// ── THE LADDER (per update) — gates the ACTION, never the trail ──────────────
// HIGH + explicit closure (action=resolve) → RESOLVE + undo. HIGH + progress → ADDRESSING + re-time.
// MED → ADDRESSING, NEVER resolve (readback names the match). LOW → ASK (uncertainty never touches state).
// An unknown target_id (model invented/stale) → ASK: the model cannot resolve onto something we didn't offer.
function planUpdate(u: AttachUpdate, ctx: ResolutionContext): Terminal {
  if (!ctx.candidateIds.has(u.target_id)) {
    return { kind: 'question_asked', about: 'which_item', ref: u.target_id, reason: `target ${u.target_id} not in candidate set — cannot touch state on an un-offered referent` }
  }
  if (u.confidence === 'low') {
    return { kind: 'question_asked', about: 'which_item', ref: u.target_id, reason: `low confidence on ${u.target_id} — ask (pick-one w/ "it's new")` }
  }
  if (u.confidence === 'med') {
    return { kind: 'object_updated', update: u, applied: 'addressing', undo: false, readback: 'named the match — wrong item? tap', reason: `med confidence — ${u.reason} — ADDRESSING only, never resolve` }
  }
  // HIGH — trust the model's closure read, but only HIGH earns a resolve.
  const applied = u.action === 'resolve' ? 'resolve' : 'addressing'
  return { kind: 'object_updated', update: u, applied, undo: applied === 'resolve', readback: applied === 'resolve' ? 'resolved — undo?' : 'addressing', reason: `high confidence — ${u.reason}` }
}

// ── THE LADDER (per new item) — never dropped: create, or ask-for-site ───────
// HIGH → create as classified. MED/LOW → create as a NOTE + an upgrade offer (captured, not corrupt).
// No site → ASK which project (better than mis-filing to the wrong building). Never a task from a photo is
// the caller's concern (the model won't emit a task in Axis 1); here we only create issue/snag notes.
function planObserve(it: ObserveItem): Terminal {
  if (!it.project_hint) {
    return { kind: 'question_asked', about: 'which_project', ref: it.detail, reason: `new ${it.kind} with no resolvable site — ask which project` }
  }
  const as = it.confidence === 'high' ? 'classified' : 'note'
  return { kind: 'object_created', item: it, as, upgradeOffer: as === 'note', reason: `${it.confidence} — create ${it.kind} as ${as}` }
}

/**
 * Consume the (advisory) contract, return the (authoritative) terminals. PURE. Enforces:
 *  - every found update lands per the ladder, or is asked (never silently dropped)
 *  - every found item is created, or asked-for-site (never silently dropped)
 *  - an invented target_id can't touch state
 *  - an image with nothing confident → queued as evidence (cautious)
 *  - both axes false, non-image → acked_didnt_catch is MANDATORY, carrying the contract for audit
 * and finally re-checks the no-drop invariant by assertion (defense in depth; tested to bite).
 */
export function executeResolution(c: ResolutionContract, ctx: ResolutionContext): Terminal[] {
  const terminals: Terminal[] = []

  for (const u of c.update_found.found ? c.update_found.updates : []) terminals.push(planUpdate(u, ctx))
  for (const it of c.issue_snag_found.found ? c.issue_snag_found.items : []) terminals.push(planObserve(it))

  if (terminals.length === 0) {
    terminals.push(
      ctx.isImage
        ? { kind: 'queued_as_evidence', reason: 'image with no confident update or creation — queue as evidence, decide later' }
        : { kind: 'acked_didnt_catch', contract: c, reason: 'no issue/snag found and no update found on a non-image input' },
    )
  }

  assertNoDrop(c, terminals)
  return terminals
}

// ── THE ASSERTION — "no code path may drop a found item", made real ──────────
// Verifies the planner accounted for every found input. A found update must yield an object_updated OR a
// question_asked; a found item an object_created OR a question_asked; both-false must yield exactly one
// terminal (evidence for images, else didnt-catch). Throwing here is the backstop that makes the no-miss
// guarantee structural — tested to BITE on a deliberately-dropping (contract, terminals) pair.
export function assertNoDrop(c: ResolutionContract, terminals: Terminal[]): void {
  const foundUpdates = c.update_found.found ? c.update_found.updates.length : 0
  const foundItems = c.issue_snag_found.found ? c.issue_snag_found.items.length : 0

  const updated = terminals.filter((t) => t.kind === 'object_updated').length
  const created = terminals.filter((t) => t.kind === 'object_created').length
  const askedItem = terminals.filter((t) => t.kind === 'question_asked' && t.about === 'which_item').length
  const askedProject = terminals.filter((t) => t.kind === 'question_asked' && t.about === 'which_project').length

  if (updated + askedItem < foundUpdates) {
    throw new Error(`resolution invariant violated: ${foundUpdates} updates found but only ${updated + askedItem} landed/asked — an update was DROPPED`)
  }
  if (created + askedProject < foundItems) {
    throw new Error(`resolution invariant violated: ${foundItems} items found but only ${created + askedProject} created/asked — an item was DROPPED`)
  }
  if (foundUpdates === 0 && foundItems === 0 && terminals.length !== 1) {
    throw new Error(`resolution invariant violated: nothing found but ${terminals.length} terminals — a non-update produced ${terminals.length} outcomes (expected exactly one ack/evidence)`)
  }
}

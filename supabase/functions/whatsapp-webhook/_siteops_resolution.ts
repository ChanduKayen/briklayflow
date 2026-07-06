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
//
// `confidence` and `closure_explicit` are INDEPENDENT judgments — the rubric's top rung is HIGH referent
// AND explicit closure language, ANDed because they fail independently: "that thing is sorted" against a
// lone chase is an unambiguous referent (HIGH) with VAGUE closure. Folding them would let that auto-
// resolve and silently kill the chase — the exact case the ladder exists to stop. So both ride the wire.
export interface AttachUpdate {
  target_id: string
  target_kind: 'task' | 'issue' | 'todo'
  action: 'progress' | 'addressing' | 'resolve'
  confidence: Confidence
  closure_explicit: boolean   // did the reply use EXPLICIT closure language (not just a clear referent)?
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
  nearCandidateIds?: string[] // lexical near-misses (caller-computed, candidate members) — a both-false
                              // IMAGE with near candidates ASKS placement (place_photo) before it parks.
}

// ── THE TERMINALS (the authoritative, auditable outcomes) ────────────────────
// EXACTLY one-or-more per input. Every terminal carries a `reason` → written to the trail → the input's
// destination is queryable after the fact. `acked_didnt_catch` carries the full contract so a MISS is
// auditable, never silent.
export type Terminal =
  | { kind: 'object_created'; item: ObserveItem; as: 'classified' | 'note'; upgradeOffer: boolean; reason: string }
  | { kind: 'object_updated'; update: AttachUpdate; applied: 'resolve' | 'addressing'; undo: boolean; readback: string; reason: string }
  // carries its SOURCE so the executor can open the right pick AND the resume validates against exactly the
  // offered set (which_item → the update being confirmed; which_project → the new item awaiting a site;
  // place_photo → an unplaced photo with lexically-near candidates, shortlistIds carrying the offer).
  | { kind: 'question_asked'; about: 'which_item' | 'which_project' | 'place_photo'; ref: string | null; update?: AttachUpdate; item?: ObserveItem; shortlistIds?: string[]; reason: string }
  | { kind: 'queued_as_evidence'; reason: string }
  | { kind: 'acked_didnt_catch'; contract: ResolutionContract; reason: string }

// ── THE LADDER (per update) — gates the ACTION, never the trail ──────────────
// HIGH + resolve + closure_explicit → RESOLVE + undo. HIGH + resolve + !closure_explicit → ADDRESSING
// (clear referent, vague closure — advance, never close). HIGH + progress → ADDRESSING + re-time.
// MED → ADDRESSING, NEVER resolve (even with explicit closure — an uncertain referent may not be closed).
// LOW → ASK (uncertainty never touches state). Unknown target_id (invented/stale) → ASK: the model cannot
// resolve onto something we didn't offer.
function planUpdate(u: AttachUpdate, ctx: ResolutionContext): Terminal {
  if (!ctx.candidateIds.has(u.target_id)) {
    return { kind: 'question_asked', about: 'which_item', ref: u.target_id, update: u, reason: `target ${u.target_id} not in candidate set — cannot touch state on an un-offered referent` }
  }
  if (u.confidence === 'low') {
    return { kind: 'question_asked', about: 'which_item', ref: u.target_id, update: u, reason: `low confidence on ${u.target_id} — ask (pick-one w/ "it's new")` }
  }
  // MED on a TASK asks (the parking lesson): a task has NO soft rung — applying IS the state change, and
  // the old path could only hold it silently. Uncertainty on a task routes to the supervisor, not a park.
  if (u.confidence === 'med' && u.target_kind === 'task') {
    return { kind: 'question_asked', about: 'which_item', ref: u.target_id, update: u, reason: `med confidence on TASK ${u.target_id} — no soft rung for a task, ask instead of holding` }
  }
  if (u.confidence === 'med') {
    return { kind: 'object_updated', update: u, applied: 'addressing', undo: false, readback: 'named the match — wrong item? tap', reason: `med confidence — ${u.reason} — ADDRESSING only, never resolve` }
  }
  // HIGH — a resolve lands ONLY with explicit closure language (the rubric's AND). A clear referent with
  // vague closure ("that thing is sorted") ADVANCES, never closes — a wrong RESOLVE silently kills a chase.
  const applied = (u.action === 'resolve' && u.closure_explicit) ? 'resolve' : 'addressing'
  return {
    kind: 'object_updated', update: u, applied, undo: applied === 'resolve',
    readback: applied === 'resolve' ? 'resolved — undo?' : 'addressing',
    reason: applied === 'resolve' ? `high + explicit closure — ${u.reason}` : `high referent, vague/no closure — advance not close — ${u.reason}`,
  }
}

// ── THE LADDER (per new item) — never dropped: create, or ask-for-site ───────
// HIGH → create as classified. MED/LOW → create as a NOTE + an upgrade offer (captured, not corrupt).
// No site → ASK which project (better than mis-filing to the wrong building). Never a task from a photo is
// the caller's concern (the model won't emit a task in Axis 1); here we only create issue/snag notes.
function planObserve(it: ObserveItem): Terminal {
  if (!it.project_hint) {
    return { kind: 'question_asked', about: 'which_project', ref: it.detail, item: it, reason: `new ${it.kind} with no resolvable site — ask which project` }
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
    // ASK-BEFORE-EVIDENCE: a both-false image with lexically-NEAR candidates asks placement first —
    // the evidence park stays the floor (no near candidates, or the executor can't send the pick).
    terminals.push(
      ctx.isImage
        ? (ctx.nearCandidateIds?.length
            ? { kind: 'question_asked', about: 'place_photo', ref: null, shortlistIds: ctx.nearCandidateIds, reason: 'image with nothing confident but near candidates — ask placement before parking' }
            : { kind: 'queued_as_evidence', reason: 'image with no confident update or creation — queue as evidence, decide later' })
        : { kind: 'acked_didnt_catch', contract: c, reason: 'no issue/snag found and no update found on a non-image input' },
    )
  }

  assertNoDrop(c, terminals)
  return terminals
}

// ── THE COMBINED READBACK (one supervisor message → one reply) ───────────────
// A message that produced several terminals gets ONE reply, composed from what ACTUALLY terminated —
// per-terminal, not from what the planner intended. Two rules the single-terminal case doesn't need:
//   • PARTIAL-FAILURE HONEST — if the resolve landed but the create failed, the reply says BOTH truthfully
//     ("✓ X resolved · ⚠️ couldn't log Y — saved for review"), never an all-or-nothing claim that lies
//     about half the message. Each line reflects that terminal's real `status`.
//   • ORDERED BY CONSEQUENCE, not by axis — the RESOLVE first (the state change that stops a chase), then
//     the new item (the thing that starts one). "Resolved X · logged new Y" reads as a verifiable status.
// Questions are their own interactive message (sent by the executor), so they're excluded here.
export interface TerminalOutcome {
  terminal: Terminal
  // 'ok' effect landed · 'failed' effect errored (parked, read back as ⚠️ … saved for review) · 'held' the
  // executor UNDERSTOOD the update but can't act on it yet (a valid candidate outside this batch — the fresh
  // path owns it, unadopted). 'held' is NOT a failure — it reads back as understood-but-held, and its row is
  // parked distinguished (non_batch_target) for later replay.
  status: 'ok' | 'failed' | 'held'
  label: string            // short human label of the object/finding, for the reply line
}

// consequence rank: resolve (stops a chase) → addressing → created (starts one) → evidence → didnt-catch.
function consequenceRank(o: TerminalOutcome): number {
  const t = o.terminal
  if (t.kind === 'object_updated') return t.applied === 'resolve' ? 0 : 1
  if (t.kind === 'object_created') return 2
  if (t.kind === 'queued_as_evidence') return 3
  if (t.kind === 'acked_didnt_catch') return 5
  return 4   // question_asked — excluded below, ranked between for safety
}

// Labels are QUOTED in every line that names an item (probe C2): the reader must parse the label as the
// item's NAME, never as part of the sentence — an unquoted truncated title ("bathroom tiles not") followed
// by "resolved" read as its own negation. Label WIDTH is the caller's job (readbackLabel, length-capped).
function readbackLine(o: TerminalOutcome): string | null {
  const t = o.terminal
  const failed = o.status === 'failed'
  switch (t.kind) {
    case 'object_updated':
      // TASK targets speak progress, not chase-speak: "✓ … updated" (a task is work, not an issue to chase).
      if (t.update.target_kind === 'task') return failed ? `⚠️ couldn't update “${o.label}” — saved for review` : `✓ “${o.label}” updated`
      if (t.applied === 'resolve') return failed ? `⚠️ couldn't resolve “${o.label}” — saved for review` : `✓ “${o.label}” resolved`
      return failed ? `⚠️ couldn't update “${o.label}” — saved for review` : `“${o.label}” — on it, will check back`
    case 'object_created':
      return failed ? `⚠️ couldn't log “${o.label}” — saved for review` : `logged new: “${o.label}”`
    case 'queued_as_evidence':
      return failed ? `⚠️ couldn't save the photo — saved for review` : `photo saved as evidence`
    case 'acked_didnt_catch':
      return `Didn't catch a site update in that — try again if you meant to send one.`
    case 'question_asked':
      // A SENT question is its own interactive message (no readback line). An UN-SENT one (executor
      // couldn't open the pick) was parked — say so, never silence (the T3 silent-drop fix). An un-sent
      // place_photo fell back to the evidence park, which IS the honest terminal — never a ⚠️ over a
      // photo that was in fact saved.
      if (o.status === 'ok') return null
      if (t.about === 'place_photo') return `photo saved as evidence`
      return `⚠️ couldn't place “${o.label}” — saved for review`
  }
}

// UNDERSTOOD-BUT-HELD clause for one held update: "resolve tiles not arrived" / "update the transformer".
// Multiple held updates share ONE "couldn't … yet — saved for review" wrapper (see composeReadback) — the
// message is "I heard you, both true, holding them" — a categorically different thing than "⚠️ … failed".
function heldClause(o: TerminalOutcome): string {
  const t = o.terminal
  const verb = t.kind === 'object_updated' && t.applied === 'resolve' ? 'resolve' : 'update'
  return `${verb} “${o.label}”`
}

/** Compose the single reply from the terminals' REAL outcomes (consequence-ordered, partial-failure-honest).
 *  PURE. Held updates (understood but not applicable yet) group into ONE "couldn't … yet — saved for review"
 *  clause, distinct from a ⚠️ failure. A lone didn't-catch returns its bare sentence; else "Got it — <…>". */
export function composeReadback(outcomes: TerminalOutcome[]): string {
  const ordered = outcomes
    .filter((o) => o.terminal.kind !== 'question_asked' || o.status !== 'ok')   // sent questions are their own message; un-sent ones must be told
    .map((o, i) => ({ o, i }))
    .sort((a, b) => consequenceRank(a.o) - consequenceRank(b.o) || a.i - b.i)
    .map((x) => x.o)
  const held = ordered.filter((o) => o.status === 'held')
  const lines = ordered.filter((o) => o.status !== 'held').map(readbackLine).filter((l): l is string => !!l)
  if (held.length) lines.push(`couldn't ${held.map(heldClause).join(' or ')} yet — saved for review`)
  if (!lines.length) return 'Got it'
  if (lines.length === 1 && ordered.length === 1 && ordered[0].terminal.kind === 'acked_didnt_catch') return lines[0]
  return `Got it — ${lines.join(' · ')}`
}

/** Executor-level no-drop — EVERY terminal must produce exactly one outcome (ok or failed); a missing one
 *  is a dropped effect. Throws (tested to bite): the effect-side twin of assertNoDrop's planner-side check. */
export function assertAllApplied(terminals: Terminal[], outcomes: TerminalOutcome[]): void {
  if (outcomes.length !== terminals.length) {
    throw new Error(`executor invariant violated: ${terminals.length} terminals but ${outcomes.length} outcomes — an effect was DROPPED`)
  }
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

# Site-ops deferral log

Design/product decisions deliberately **not** built when they surfaced, parked here so they resurface as
decisions later — not as bug reports when the un-built behavior is hit. Each entry: what was deferred, why
it was out of scope, and what would reopen it.

---

## D1 — Should a status statement be actionable WITHOUT an open chase? (product decision)

**Surfaced:** the "waterlogging issue ASM Elite resolved" mirror-failure investigation (empty-decompose
wiring, Defect A).

**The question:** an unprompted "fixed it" / "waterlogging resolved" message arrives when there is **no
open chase** for it. Today decompose's POLARITY rule drops a self-resolved problem to nothing (correct for
fresh narration), so the statement vanishes. Defect A's wiring only rescues it **when a chase batch is
open** — the message reaches `handleBatchReply` and closes the chase. With no open chase, "waterlogging
resolved" is still a no-op. **Should it instead find the matching open issue and close it, proactively?**

**Why deferred (not this bug):** making status statements first-class outside a chase context is a genuine
feature, not a regression fix. A first-class "status update" decompose type would be **homeless** — not
progress, not issue, not todo — and would owe routing rules, a lifecycle, readback grammar, and a matcher
to find the target issue from free text. That is the heavier tool for a narrower problem; Defect A's seam
solves the reported regression surgically. Same shape as rejecting the ask-handshake in Step 2.

**What reopens it:** a product call that unprompted "X resolved / X done" messages should search open
issues and close the match (with the same no-false-match discipline the chase matcher uses). If taken, it
likely reuses the Defect B LLM matcher (below) against the project's open issues rather than a chase batch.

---

## D2 — Cross-script chase matching (pending FIX, tracked, not a product deferral)

**Surfaced:** same investigation, finding 4 (systemic).

`matchPieceToBatch` tokenises on `/[a-z0-9]+/` (ASCII only) and `interpretStatus`/`scoreName` compare Latin
strings, so a **Telugu-script** reply yields zero subject tokens and can never lexically match a Latin
chase title/project. For a **lone** open chase Defect A's force-match shortcut covers it (no content match
needed); for a **multi-item** batch it does not — the reply can't be sorted to the right chase and is
declined. Fix = **Defect B**: an LLM match-on-lexical-miss (reuse the `judgeResolution` pattern, already
language-capable), invoked ONLY when lexical matching misses AND a batch is open, with a mandatory
"NONE — it's new" escape so uncertain → decline (loud, recoverable), never uncertain → best-guess match.

**Tracked by:** the skipped journey spec `batch_journey.test` › test (2). Un-skip when Defect B lands.

---

## Discipline — RED-FIRST is mandatory wherever WIRING exists

Standing rule (from the v2 arc): tests are written and seen RED before the code, at every step that has a
wiring layer — 1b onward, every step. The wiring layer is exactly where this month's bugs lived (the
empty-decompose dead-end passed a 94-green pure gate). A pure, fully-specified function (e.g. the v2
enforcement planner) earns an exception — its tests ARE the spec, there's no wiring to be unreachable — and
that exception must be FLAGGED, not slipped. Recorded miss: Phase 1b's tests were written after the module;
the fail→park test was discriminating so coverage held, but the sequence was wrong. No 1b–4 wiring step
qualifies for the pure exception.

## D4 — v2 candidate-set scale cap (deferred, tracked)

`buildCandidateSet` offers open tasks+issues+todos across ALL the sender's active projects (no meaning
pre-filter, by design). If the open set grows large, a cap belongs here — by **recency/cardinality, never
by meaning** (a meaning filter reintroduces the deleted heuristic). Not built; flagged in the code.

## D3 — Journey matrix, remaining cells (test debt, tracked)

The journey harness (`__tests__/fake_supabase.ts`) now exists; the reachability matrix the ASM Elite
postmortem specced (open batch × open window × pending pick × modality) is cheap to extend. Filled so far:
lone-chase resolve (kept-open + resolve-and-close), no-batch decline, multi-item no-eat. **Still to add:**
pending-pick recovery via `answerSiteops` (a different entry point than `runSiteops`), and the image
modality (photo-as-chase-answer). Extend the harness's `datasetFor`/seed surface as those land.

## D5 — Engine entry: an open batch is a PRIOR on interpretation, never a ROUTER (Phase 3, opening move)

**Surfaced:** the live probe `"సౌందర్య సైట్ లోకి టైల్స్ వచ్చాయి. అలాగే ట్రాన్స్ఫర్మర్ పని చేయట్లేదు"` (tiles
arrived at Soundharya + transformer not working). A **compound fresh narration** — one existing issue to
resolve (tiles) plus a **brand-new** issue (transformer) — arrived while an **unrelated** chase batch was
open. Because a batch was open, `runSiteops` force-routed the whole message through `handleBatchReply`, whose
`resolveInbound` graded it against the full candidate set and produced two `object_updated` terminals onto
items **outside** the batch. Both then hit the executor's batch-scoped `itemsById` and could not be applied.

**The pattern (name it):** *batch-captures-fresh* — an open batch treated as a **lock on routing** rather than
a **prior on interpretation**. This is now the **third** distinct layer it has surfaced at: (1) `handleBatchReply`'s
original force-match, (2) the photo-orphan hijack (open-convo answer-shunt), (3) here, at the v2 engine's
entry. `convo:FRESH` measuring the *conversation* dimension while `chase_batches` silently gates *routing* is
the same orthogonal-state trap the empty-decompose investigation opened on.

**Why deferred (not patched on this branch):** fixing it means deciding *when an open batch captures a message
at the engine entry* — which is precisely Phase 3's fresh-path adoption question. Pulling that decision into a
tail-of-Phase-2 hotfix is exactly the condition that has produced every red-first slip. Held to Phase 3.

**Phase-2 honest scope, shipped instead (this branch):** a non-batch target is parked **distinguished**
(`siteops_unplaced.reason = 'non_batch_target'`, replay payload in `candidates`) and read back as
**understood-but-held** ("couldn't resolve X yet — saved for review"), never as a ⚠️ failure and never
surfacing the raw uuid. The rows are mechanically re-playable once Phase 3 lands. (Executor Defect-2 suite.)

**Phase-3 acceptance — CASE ONE (red-first, two commits):** compound fresh narration + unrelated open batch →
the resolve lands on the (non-batch) matched issue, the new item is created as a fresh issue, and the open
chase is left untouched. The open batch ranks its chased items top (a prior — the candidate set already does
this) but never captures the message into batch-only execution.

**What reopens it:** Phase 3 kickoff. Reframes fresh-path adoption from "the fresh path adopts the engine" to
"the engine's entry point decides batch-context vs fresh-context correctly."

## Landmine — v2 park reasons vs. the `siteops_unplaced.reason` CHECK (fixed by ALTER 20260703000002)

The v2 engine parks with `llm_unreadable` / `evidence_await_placement` / `v2_effect_failed` /
`v2_unhandled_terminal` / `non_batch_target`, none of which were in the CHECK on `siteops_unplaced.reason`
(`20260702000000`, only the conversation-era pick reasons). The table IS applied (confirmed: re-running
20260702000000 errors `42710: policy … already exists`) — it's just EMPTY, because every v2 park violates the
CHECK: the INSERT throws and the executor's best-effort `.catch(() => {})` swallows it, so the row is silently
dropped — "saved for review" was a lie for all v2 parks (conversation-era reasons, which ARE in the list,
parked fine). The offline gate stayed green because the test fake does not enforce CHECKs — a
pure-green-while-broken trap. Fix: a SEPARATE idempotent ALTER (`20260703000002`) drops + re-adds the
constraint with the full set — NOT an edit of the applied base migration (which wouldn't change prod and
re-running it errors on the policy). **Reminder for the fake:** it should learn to enforce column CHECKs for
the park table, or this class recurs invisibly.

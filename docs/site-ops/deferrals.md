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

## D3 — Journey matrix, remaining cells (test debt, tracked)

The journey harness (`__tests__/fake_supabase.ts`) now exists; the reachability matrix the ASM Elite
postmortem specced (open batch × open window × pending pick × modality) is cheap to extend. Filled so far:
lone-chase resolve (kept-open + resolve-and-close), no-batch decline, multi-item no-eat. **Still to add:**
pending-pick recovery via `answerSiteops` (a different entry point than `runSiteops`), and the image
modality (photo-as-chase-answer). Extend the harness's `datasetFor`/seed surface as those land.

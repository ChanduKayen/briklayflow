# SiteOps Constraint & Task-Generation Engine

A pure, headless, framework-free core (no React, no Supabase types) that turns a flat task list into
a **correctly-sequenced, state-evaluated dependency graph**. It runs unchanged in Node tests and in
a Deno edge function. It does **not** do scheduling (dates), the chase engine, or any UI — those
read this engine later.

```
node src/lib/siteOps/engine/__tests__/run-tests.mjs     # 55 golden tests, ~1s, no deps
```

## The six dimensions (the founder's constraint model)

Every relationship and task carries these — they are the contract (`types.ts`):

1. **NATURE** — a spectrum, not a boolean: `IMPOSSIBLE` (physics forbids → FORBID) · `DESTRUCTIVE`
   (ruins prior work → allow only with consequence) · `STRONG_PREF` (WARN) · `WEAK_PREF` (SUGGEST)
   · `INDIFFERENT` (ALLOW silently). **Only IMPOSSIBLE truly forbids** — that's what makes the
   engine respond *freely*.
2. **REASON** — `structural · concealment · curing_time · logistics · quality · policy`. Every
   constraint states *why*, so the engine can always explain itself.
3. **TWO AXES** — `sequence` (precedes/follows) vs `cohesion` (a bound-with bundle that relocates as
   one, internal order preserved). Never blurred.
4. **SCOPE** — `same_zone · same_floor · cross_floor(±n) · building_wide · external`. Without scope
   the engine false-blocks legal cross-zone moves.
5. **FREEDOM is positively asserted** via freedom sets — absence of an edge ≠ freedom; an asserted
   freedom set = freedom.
6. **STATE-EVALUATED** — the library is the *ruleset*; availability/freedom/priority are computed
   *live* against completion state and **grow** as blockers finish.

**SAFE DEFAULT (load-bearing):** anything not matched by a known IMPOSSIBLE/DESTRUCTIVE rule degrades
to a **warning**, never a silent "free." Unknown → caution, never unknown → allow.

## The five modules (build + test in order)

| # | File | Role | Purity |
|---|------|------|--------|
| M1 | `library.ts` | canonical task-types + relative constraints, authored from `constraint_model_schema.xlsx` | data + validators |
| M2 | `instantiate.ts` | geometry × library → concrete graph + topo-sorted `seq_no` | deterministic |
| M3 | `evaluate.ts` | availability · freedom · priority · why · checkMove · cohesion | pure |
| M4 | `classify.ts` | grounded+bounded placement of user tasks | LLM, validated |
| M5 | `persist.ts` | write `site_tasks` + sticky manual edits | integration |

Each module has its own goldens in `__tests__/` and nothing downstream is wired until the upstream
tests are green.

### M2 — why the topo sort matters

`seq_no` now comes from a real topological sort over the **hard** edges (IMPOSSIBLE + DESTRUCTIVE +
curing_time), not a hand-numbered guess. This fixes the old physically-nonsensical
"column-column-slab-slab" ordering. Proof in the goldens: `columns(F) → slab(F) → blockwork(F) →
columns(F+1)` reads correctly, the top floor has no `columns(+1)` edge, and wet-only tasks exist
only in wet zones. Ties within a topo rank break by (floor asc, layer structure<services<finishes,
id) so the default reads naturally.

## The bounded-classifier principle (M4) — why the LLM is caged

The library is a **closed contract** for known trades. The classifier is the **open door** for
user-typed tasks — but it admits them by **snapping them to library anchors**, never by authoring
new physics.

> A freeform LLM would happily write "marble cladding must precede electrical conduiting" and corrupt
> the graph. By forcing every edge to reference an **existing anchor id** with an **enum
> nature/reason**, then **validating against the real graph**, we get the LLM's construction
> knowledge *without* its hallucinations. The model's job is **recognition and mapping**, not
> *authoring physics*.

The validator is a hard, deterministic gate (`validateClassification`):

- Drops any `pred` that isn't a real `TaskTypeId`; coerces unknown nature/reason/scope to the safe
  default.
- **Acyclicity check** — tentatively inserts the new node (incoming placement edges + outgoing host
  edges) into the hard-edge graph; if it would create a cycle, **rejects those edges** and falls
  back.
- **Severity ceiling on low confidence** — demotes any proposed IMPOSSIBLE/DESTRUCTIVE to
  STRONG_PREF, so a low-confidence guess can never hard-block real work.

### The honesty valve

If the classifier can't confidently anchor a task, it does **not** invent a hard constraint. It
attaches it *loosely* — bound only by the layer's natural gateway (e.g. "after blockwork") as a
STRONG_PREF — and marks `needs_review`. **Unknown → loose + visible flag. Never unknown → silently
free, never unknown → confidently hard.** This mirrors the extraction "other" valve and is
non-negotiable. The `__tests__/classify.test.ts` "malicious output rejected" test is the proof the
bound holds.

## Stickiness (M5) — human intent wins and sticks

Re-instantiation (e.g. the user edits building geometry) must never clobber human work:

- `source='manual'` rows (incl. classified user tasks) are **never deleted**.
- `order_source='manual'` rows (a human dragged the order) **never have `seq_no` re-defaulted**.
- Only `order_source='auto'` rows are re-derived from the topo; obsolete authored-auto rows are
  deleted.

Same model as `owner_source` (migration `20260626000004`), now applied to ordering. The `reconcile`
planner is pure and fully unit-tested.

## Faithfulness notes (founder red-pen)

Authored natures/reasons are transcribed verbatim from the sheet — where one looked debatable it is
flagged in a code comment, **not** silently changed. Two decisions worth a founder glance:

- **Curing wait.** The sheet labels `slab → deshutter` as `CURING-WAIT`. Encoded as nature
  `DESTRUCTIVE` + reason `curing_time` (de-propping green concrete ruins the slab; reason flags it
  as a TIME wait for the future scheduler).
- **R8 floor-naming reconciliation.** The sheet authors `deshutter → blockwork` as `cross_floor(-1)`
  ("floor-below"), assuming a 1-indexed-slab naming. In our bottom-up floor index the slab directly
  overhead ground-floor walls is `slab@Ground` (de-propped at `shuttering_removal@Ground`) — i.e.
  the **same** floor index. Encoded `same_floor` so "no work under a propped slab" holds without an
  off-by-one that would shove all blockwork behind the whole frame.
- **`in_wall_plumbing` vs `plumb_rough`.** The sheet carries both; they overlap in practice. Kept
  distinct (not merged) per the guardrail; flagged for review.

## Migration

`supabase/migrations/20260628000000_siteops_engine_placement.sql` adds (additive, reversible,
RLS-inherited): `node_key`, `task_type_id`, `zone_id`, `placement_source`, `order_source`,
`needs_review`, `binding`.

# Site Desk — Integration & Connection Map

**Status:** discovery only. No code was modified in producing this document.
**Date:** 2026-07-12
**Scope:** what must be wired to make Site Desk (S1…X4) fully functional without breaking anything that works today.

---

## 0. Three corrections to the brief, before anything else

**(a) The stack in the brief is not the stack in this repo.** The brief describes "FastAPI backend, Next.js portal". Neither exists here. The actual system is:

| Layer | Reality |
|---|---|
| Portal | **Vite + React 18 + react-router-dom**, one flat `<Routes>` block in `src/App.tsx:468-528`. No Next.js, no SSR, no app-router. |
| Backend | **Supabase Edge Functions (Deno)** under `supabase/functions/*` — 18 functions. No FastAPI, no Python. |
| Data | Supabase Postgres, **163 migrations**, applied **by hand in the cloud SQL editor** (no CI applies them). |
| Data access | `supabase-js` called **directly from components**, wrapped in `@tanstack/react-query`. No repository layer, no generated client, no REST API of our own. |

Every plan below is written against the real stack. If the brief's stack description came from a different project, that is worth knowing before more design work is done.

**(b) Site Desk already exists and is live.** `/site-desk` → `src/pages/SiteDesk.tsx` (routed at `src/App.tsx:477`, nav-registered in `src/components/nav/navTokens.ts:56-65`). Today it renders: a stat-tile hero (open issues, overdue, snags, "to place"), a **site filter chip row**, an `UnplacedQueue` (`src/components/siteOps/UnplacedQueue.tsx`), and the shared `ItemsTable` (`src/components/siteOps/ItemsTable.tsx`). It queries `problems`, `todos`, `siteops_unplaced`, `projects`, `site_tasks`, with a Realtime channel on the first three.

This means the mission is **extend an existing surface**, not build a new one — and `/site-desk` is itself a zero-regression constraint. Several features the brief lists as new (site filter, issue/snag list, trail timeline, owner avatars, re-time control) are **already built** and must be preserved or deliberately superseded.

**(c) The HTML prototype was not attached** to the session. Everything below is derived from the S1…X4 inventory in the brief. Anywhere the prototype would have settled a question (exact copy, exact severity thresholds, exact close-modal wording), I have flagged it rather than invented it.

---

## 1. Inventory

### 1.1 Database (`supabase/migrations/`, 163 files)

**Projects / sites** — `public.projects`, PK `project_id text`.
- **`project_code text`** (`20260518000005_add_project_code.sql`, backfilled `20260623000001`) — **this is the per-site short code the brief calls DSR/ASM.** Format `^[A-Z0-9]{2,6}$`, derived from the project name.
- ⚠️ Its `NOT NULL` / `UNIQUE(org_id, project_code)` / `CHECK` constraints are step "1f" of that migration, and `20260623000001`'s own comment says 1f **"is still not applied in production."** Unverified.
- `construction_stack jsonb` (`20260625000005`) — the building shape: `{levels:[{label, kind: parking|habitable, zones:[{use, units}]}]}`.
- `unit_labels jsonb` (`20260630000003`) — display-only per-unit names.
- `supervisor_id`, `common_systems text[]`, `suppressed_tasks text[]`.
- **No separate site-registry table.** One column on `projects` is the whole registry.

**Problems** — `public.problems` (`20260626000003_siteops_block_a.sql` + 8 later migrations).
`id, org_id, project_id, task_id → site_tasks, source_narration_id, cause, title, owner_id, status, next_followup_at, status_history, owner_source, deadline, impact jsonb, source_note_id/kind, active_resolve_event → followup_events, kind, confidence, is_planned`
- `status text CHECK (OPEN|ADDRESSING|RESOLVED|DISMISSED)` — DISMISSED added `20260703000000`.
- **`kind text CHECK (issue|snag)`** — `20260707000000_siteops_problems_kind_confidence.sql`.
- `confidence text CHECK (high|med|low)` — low/med = a "note", no chase clock.
- `is_planned boolean` — `20260708000000`.
- **No outcome / resolution_note / closed_by / closed_at columns.** Closure today is a `status` transition plus a `followup_events` row.
- **No floor/unit/loc columns.** Location is reachable only indirectly via `task_id → site_tasks.floor_label/unit_label`.

**Todos** — `public.todos` (same Block A migration): `id, org_id, project_id, task_id, text, owner_id, due_date, status (OPEN|DONE|DISMISSED)`. Explicitly **no cause, no chase clock**.

**Tasks** — `public.site_tasks` (`20260625000004_site_tasks_and_qc.sql`).
`task_id, task_no (ST-YYYY-NNNN, real sequence), org_id, project_id, phase, trade, floor_label, unit_label, name, description, seq_no, status CHECK(not_started|active|done), source, owner_id, duration_days, node_key, task_type_id, zone_id, placement_source, order_source CHECK(auto|manual), needs_review, binding jsonb`
- **No `blocked_by` column. No task-edges table.** The dependency graph lives entirely in application code.
- **No `start_date` column** — so W4's "day X of Y" has no anchor today.
- Companions: `site_task_qc` (3 QC rows per task), `site_task_comments`.

**Trail / chase** —
- `cause_taxonomy` (global, 12 causes, `clock_days`/`cadence_days`/`idle_cost`).
- `follow_up_rules` (per-org override, PK `(org_id, cause_key)`).
- **`followup_events`** — the timeline substrate. `problem_id | todo_id` (exactly one, CHECK), `type CHECK(chase_sent|reply_received|status_changed|escalated|blocker_noted|comment|description_added|possible_photo_followup|reanalyzed|bare_ack|pending_stage2|reopened)`, `body`, `actor_kind(system|user)`, `actor_id`, `created_at`. Realtime-published.
- `chase_batches` — one OPEN row per `(org_id, sender_number)`, `items jsonb` = `BatchItem[]`.
- `siteops_unplaced` — the durable park queue; carries `question_wamid`.

**Media** — `public.attachments` (`20260701000002`): polymorphic `parent_type CHECK(problem|todo|site_task|site_task_comment|site_narration|siteops_unplaced)`, `parent_id`, **`role CHECK(creation|answer)`**, `bucket`, `object_path`, `caption`. No durable URL — signed at read time. Private bucket `rough-entry-media`.

**WhatsApp** — `wa_message_log` (IN/OUT audit, `wa_message_id`), `wa_registered_numbers` (phone ↔ user), `wa_conversations` (open-question state), `outbox` (+ `seq` FIFO, `20260711000001`), `processing_job`, **`wa_message_map`** (`20260702000004`: `outbound_wamid PK, ref_kind (readback|pick), object_refs jsonb`).

**Org / RLS** — `organizations`, `org_memberships` (roles: principal|management|supervisor|accountant), and the **canonical policy every siteops table uses verbatim**:
```sql
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.<t>
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
```
Server-internal tables (`outbox`, `wa_conversations`, `wa_message_map`, `processing_job`) instead enable RLS with **no policies** (service-role only). **Every new Site Desk table must pick one of these two patterns.**

**Existing numbering schemes — three coexist, none canonical:**
1. Real `CREATE SEQUENCE` + year: `rough_entry_seq` → `RE-2026-0001`; `site_task_seq` → `ST-2026-0001`. Global, not per-site.
2. **Per-project, site-code-embedded MAX+1**: `generate_document_id(org, project, type)` → `WO-{project_code}-{YYMMDD}-{NNN}`, with a collision-retry loop. **This is the closest precedent to `DSR-21`.**
3. Org-wide advisory-locked MAX+1: `generate_doc_number(prefix, table, col)` → `MR-2026-0001`, using `pg_advisory_xact_lock(hashtext(...))`.

### 1.2 WhatsApp pipeline

`index.ts` (HMAC-verified, dedup on `wamid`, 200-then-`waitUntil`) → `_normalize.ts` (text/image/voice/interactive/reaction; image → private bucket + cheap `describeImage()`; voice → Sarvam STT) → `_router.ts` (**one LLM classifier**, returns `{decision, intent_agent, confidence, reply_language, reasoning}`; SITEOPS is the ground state) → `_dispatch.ts` (the only place that writes `wa_conversations`) → `_registry.ts` → `_agents/siteops.ts:1598 runSiteops`.

**Resolution is "LLM proposes, code disposes"** (`_siteops_resolution_llm.ts` → `_siteops_resolution.ts`):
```ts
export type Terminal =
  | { kind: 'object_created'; ... }
  | { kind: 'object_updated'; update: AttachUpdate; applied: 'resolve'|'addressing'|'blocked'; undo: boolean; ... }
  | { kind: 'question_asked'; about: 'which_item'|'which_project'|'place_photo'; ... }
  | { kind: 'queued_as_evidence'; ... }
  | { kind: 'acked_untracked_work' | 'acked_no_place' | 'acked_didnt_catch'; ... }
```
The **closure-confidence ladder** (`_siteops_resolution.ts:387-424`) — this is the existing "auto-close proposal" engine P6 asks for:
> `HIGH + resolve + closure_explicit → RESOLVE + undo. HIGH + resolve + !closure_explicit → ADDRESSING. MED → ADDRESSING, NEVER resolve. LOW → ASK. Unknown target_id → ASK.`

A `target_id` not in the code-loaded candidate set can never write state.

**Outbound:** two paths. (a) Approved templates via `_shared/wa-templates.ts` (`teammate_welcome`, `procurement_approval`, `issue_followup`, `issue_assignment`) → `sendTemplate()` or the durable `outbox`. (b) Free-form session text via `send()` in `_format.ts:167`, drained by `wa-outbox-drainer`.
⚠️ **There is no generic "send this arbitrary text as the org's voice" endpoint.** Every free-text send is composed by specific agent code. The only place the **24h session window** is checked in code is `siteops-chase/index.ts:295 hasOpenSession()`.

**Reply→item linkage** — real, but narrow:
- `wa_message_map` binds an **outbound wamid** → `object_refs` (only for `ref_kind: readback | pick`).
- `siteops_unplaced.question_wamid` recovers a late answer to a parked question.
- Otherwise, a chase reply is matched by **meaning**: the open `chase_batches` items are injected into the resolver's candidate set as a ⭐ **prior, not a lock** (`_siteops_resolution_llm.ts:76`), and the LLM picks which candidate id it resolves. The old keyword matcher was deliberately deleted.
- **No ref-stamp exists in outgoing text today.**

### 1.3 Task / constraint engine (`src/lib/siteOps/engine/`)

Six modules: `library.ts` (M1: **~50+ authored task types**, not 12 — the "12 types" note is stale), `instantiate.ts` (M2: geometry × library → `ConcreteGraph` + **topological sort**), `evaluate.ts` (M3), `classify.ts` (M4: bounded LLM classifier), `persist.ts` (M5: reconcile + sticky manual edits), `viewModel.ts` (VM fold).

- **Constraint model:** `Nature = IMPOSSIBLE | DESTRUCTIVE | STRONG_PREF | WEAK_PREF | INDIFFERENT`. Topo sort runs over **hard edges only** (`isHardNature`: IMPOSSIBLE, DESTRUCTIVE, or `reason === 'curing_time'`), throws `CycleError` on a hard cycle.
- **`Evaluator.checkMove(node, targetSeqNo) → MoveResult`** already exists and is pure — `verdict: allow | suggest | warn | allow_with_consequence | forbid`, plus `movesBundle` (the cohesion set that must move together). **This is exactly what W5 needs and it is already written.**
- **Status:** stored `TaskStatus = not_started|active|done`. **Derived** `Availability = done|active|available|blocked` — computed live, never persisted. All `%` figures are derived in `viewModel.ts`, never stored.
- **Instancing is `per_zone | per_floor | building`.** Each habitable unit expands into a **fixed** `['dry','wet','balcony']` zone set. **There is no 2BHK/3BHK unit-type model anywhere.**
- `supabase/functions/_shared/siteops-engine.js` is a **generated esbuild bundle** of the engine (`scripts/build-engine-bundle.mjs`), re-run **by hand**. No CI guard against desync.
- ⚠️ Drag-reorder today is **display-only**: `ProjectSequence.tsx:191-210` re-implements `checkMove`'s severity logic client-side, and persist is gated off in `siteops-generate/index.ts:79-88` ("Step-5", code commented out).

### 1.4 Chase engine

`siteops-chase` fires from **pg_cron at 03:30 UTC = 09:00 IST, daily** (`20260701000000_siteops_chase_cron.sql`). Timing is three-layered (`_siteops_timing.ts`): L1 user-stated date → L2 cause clock/cadence → L3 the blocked task's schedule end. `problems.next_followup_at` is the stored next-chase timestamp (**already rendered in the UI** at `ItemsTable.tsx:457`).
Escalation: `SITEOPS_ESCALATE_AFTER` (default 2) unanswered chases → SILENCE; `SITEOPS_ESCALATE_AGE_DAYS` (default 5) → AGE. Target: `projects.supervisor_id`, else org principal.
**No per-item "nudge now" endpoint exists.** The only manual control is "Re-time" (pick a future date).

### 1.5 Portal conventions

- Routes: one flat block in `App.tsx`. Adding a route touches `App.tsx` (lazy import + `<Route>` + `getMobileTitle` + `BottomTabBar` + `MoreNavSheet`) and `BriklayRail.tsx` (`SECTIONS`, `siteMgmtItems`) and `navTokens.ts` (`SITE_MGMT_ROUTES`).
- Fetching: `useQuery` + direct `supabase.from(...)`, with a **RICH/BASE column-fallback idiom** (try the richest `select()`, degrade if a migration hasn't landed). Mutations are optimistic-then-persist. Realtime channels + `refetchInterval` as belt-and-braces.
- Auth: `useAuth()` → `{ authState, orgId, userId, can, isRole }`. Guarding is imperative in `App()`, plus one `PrincipalGuard`.
- **No feature-flag mechanism of any kind exists.** The only `import.meta.env` usage in `src/` is the two Supabase connection vars.
- **No persisted cross-page project scope.** Scope is URL-param or in-page filter only.
- Icons: `@tabler/icons-react` on all siteOps/nav surfaces (`lucide-react` also present in ~36 older files — use Tabler).

### 1.6 Tests

Three gates, **no test framework** — a custom zero-dep harness per suite, bundled with esbuild and run under Node.

| suite | command | count |
|---|---|---|
| engine | `npm run test:engine` | 72 |
| auth | `npm run test:auth` | 75 |
| webhook | `npm run test:extract` | **521 passed, 1 skipped** |

The webhook harness is the important one:
- **`table_columns.ts`** parses **every migration's `CREATE TABLE` / `ALTER TABLE ADD|DROP|RENAME COLUMN`** to derive the real schema, and a `select()` naming an unknown column returns a fake **`42703`**. New columns are picked up **automatically** — *provided the DDL is plain* (a `DO $$ … $$` block will not be parsed, and the column will silently look nonexistent to tests).
- **`check_constraints.ts`** does the same for `CHECK (col IN (...))` enums → fake **`23514`**. **Any new enum value must be in a migration CHECK or legitimate writes will look rejected in the gate.**
- `guardrail.test.ts` pins that a write to `site_tasks` is refused unless the row is visible in the VM.
- `resolution.test.ts` `assertNoDrop` pins that **every LLM finding produces a terminal** — no silent drops.

---

## 2. The blocking decision (read this before planning anything)

**There are two contradictory "snag" models live in the codebase, and nothing reconciles them.**

| Model | Evidence |
|---|---|
| **A: snag is `problems.kind='snag'`** | `20260707000000_siteops_problems_kind_confidence.sql` adds `kind CHECK(issue\|snag)` — "a found item is stored AS WHAT IT IS … no fork." The WhatsApp resolver creates snags this way. |
| **B: snag is the `todos` table** | `20260701000002_attachments.sql` comment: *"the frontend 'snag' is the `todos` table (DB-honest, not 'snag')"*. `SiteDesk.tsx:66` counts its **"snags" stat tile from `todos`**. `ProjectIssues.tsx` `?view=snags` shows `todos`. |

So the *portal* currently calls `todos` "snags" while the *pipeline* writes snags into `problems.kind`. **P1 (one unified list of `issue|snag`), P8 (snag needs a fix photo), and W2 (unit problem badges) are all undefined until this is settled.** I cannot resolve it from the code — both are deliberate, and they were written weeks apart.

**Recommendation (needs your ruling):** `problems.kind ∈ (issue, snag)` is the canonical model — it is the newer decision, it is what the capture pipeline actually writes, and it gives snags a cause, an owner, a chase clock, and a trail (all of which `todos` deliberately lacks and P3/P5/X2 all require). Re-cast `todos` as what its columns actually say it is: **lightweight to-dos / action items**, a third kind, not snags. The migration path is then **additive and non-destructive**: leave `todos` alone, stop labelling it "snags" in the UI, and let Site Desk read `problems` for `issue|snag`.

Everything below assumes that ruling. **If you rule the other way, P2/P6/P8 change materially** (refs and resolutions would have to span two tables).

---

## 3. Connection Map

Legend — **READY**: exists, wire it. **PARTIAL**: exists but incomplete (what's missing is named). **MISSING**: build it.

| # | Feature | Needs | Existing source | Status | Integration work (additive only) |
|---|---|---|---|---|---|
| **S1** | Project scope picker, persists across tabs | An active-site context | `SiteDesk.tsx:34` in-page chip filter; `BriklayRail.tsx:342` project tray (navigation only) | **PARTIAL** | New `ActiveSiteContext` (React context + `localStorage`, mirroring `briklay_rail_expanded`). No DB. Work Plan shows a pick-prompt at "All". |
| **S2** | Deep-link routes `/desk/{site\|all}/problems/{ref}`, `?loc=` | Param routes | `App.tsx:468-528`; param + query-param routing already in use (`ProjectIssues` `?view=`) | **PARTIAL** | Add routes in `App.tsx`; **keep `/site-desk` as a redirect** to `/desk/all/problems` (zero-regression). Nav in `BriklayRail.tsx` + `navTokens.ts`. |
| **S3** | Site registry with short codes | Per-site code | **`projects.project_code`** (`20260518000005`) — exactly DSR/ASM shape | **READY** ⚠️ | Verify the `NOT NULL`/`UNIQUE` constraints (step "1f") are actually applied in prod — the backfill migration says they may not be. If not, apply them **before** refs depend on them. |
| **P1** | One list of open `issue\|snag` | A unified item model | `problems.kind` (pending migration) vs `todos`-as-snags | **PARTIAL** ⛔ | **Blocked on §2.** Under the recommended ruling: read `problems` where `kind IN (issue,snag)`; retire the `todos`→"snag" label. |
| **P2** | Per-site atomic ref `DSR-21`, race-safe, shared across kinds | A per-site counter | **Nothing.** Three unrelated numbering schemes exist; none is per-site-per-item | **MISSING** | New `site_ref_counters(org_id, project_id, next_val)` + `SECURITY DEFINER next_site_ref(project)` using `UPDATE … RETURNING` (atomic, no `FOR UPDATE` race). New `problems.ref text`. **Backfill existing rows by `created_at ASC`.** Unique index `(project_id, ref)`. |
| **P3** | Severity sort (waiting-on-owner ▸ category bump ▸ age) | Deterministic ordering | All inputs exist: `owner_id`, `cause`, `created_at`, `next_followup_at`, `followup_events` (streak/silence) | **PARTIAL** | **Pure code floor** (constitutional): a `severityScore(item, trail)` function in `src/lib/siteOps/`. Not a view, not the model. Unit-tested. |
| **P4** | Row anatomy (ref, kind/loc, status line, waiting-on, age, photo dot) | Row fields | `ItemsTable.tsx` already renders owner avatar, age, trail; `useTrailStates` gives `lastChaseAt`/`lastReplyAt` | **PARTIAL** | Needs P2 (ref), the **loc columns** (see W2), a photo-exists flag (count from `attachments`), and the X4 status sentence. |
| **P5** | Detail: timeline + WA reply bubbles + photo strip + "Holding up" + composer | Trail, media, links, send | `followup_events` (+`reply_received`); `attachments` + `signedMediaUrl()`; `problems.impact jsonb` + `task_id`; `useItemTrail` | **PARTIAL** | Timeline/photos/holding-up are **wiring only**. **The composer is the real gap:** no arbitrary-text send path exists (§1.2). New edge fn `siteops-say` — 24h check via `hasOpenSession()`, free text in-window, `issue_followup` template out-of-window, ref-stamped, `capture` → `wa_message_map`. |
| **P6** | Close flow: outcome + note + audit, Undo, Reopen; auto-close proposals | Resolution record | `status` (RESOLVED/DISMISSED) + `active_resolve_event` + `followup_events.reopened` exist. **No outcome/note/by/when columns.** The **closure-confidence ladder already exists** and already proposes auto-closes | **PARTIAL** | New `problem_resolutions(problem_id, outcome CHECK(fixed\|client_ok\|not_a_problem\|duplicate_of), note, duplicate_of_ref, closed_by, closed_at)`. Reopen = keep the row + a `reopened` trail event (**never delete** — audit). Undo already has a bounded pattern to copy (`handleUndoResolve`). |
| **P7** | Resolved view | History + resolution | `status='RESOLVED'` filter + P6 join | **PARTIAL** | Trivial once P6 lands. |
| **P8** | Snag cannot be verified-closed without a fix photo | Photo-presence check at close | `attachments.role='answer'` is exactly this signal | **MISSING** | **Code floor + red-first test**, enforced in the close path *and* in the WhatsApp auto-close ladder (both doors, or the floor leaks). Logging without a photo stays allowed. |
| **W1** | Floor % (derived) + floor timeline | Per-floor rollup | `viewModel.ts:212` computes floor `pc` and timeline `fills` **already** | **READY** | Expose the VM. `siteops-generate` already returns a dry-run `ProjectVM` — reuse rather than recompute. |
| **W2** | site → (blocks) → floor → units + per-unit % / badges | Location model + problem↔loc | `construction_stack` (levels/zones/units), `unit_labels`; VM computes per-unit `overallPct` | **PARTIAL** | Two gaps: **(i) no block tier** in `construction_stack` (only levels→zones) — recommend deferring blocks (the brief says "only if >1"); **(ii) `problems` has no floor/unit columns** — a badge for `?loc=` cannot be computed. Additive: `problems.floor_label`, `problems.unit_label` (the vision/decompose path *already* produces a structure slot; it's just not persisted on the row). |
| **W3** | Unit checklists from **per-floor-type templates** (2BHK/3BHK) | Unit-type model | **Nothing.** Every unit expands to a fixed `['dry','wet','balcony']` zone set | **MISSING** | Real engine work: a `unitType` on the stack's zones + per-type zone sets + instancing changes. **Highest-cost item in the whole brief. Defer past the 5-user validation.** |
| **W4** | Task states hand-set; `After {task}` / `Blocked by {ref}` / `day X of Y` derived | Edges, links, dates | `hardPreds`/`hardDeps` on the VM (derived) ✅; `duration_days` ✅ | **PARTIAL** | `After {task}` = **READY** from the VM. `Blocked by {ref}` needs X1. **`day X of Y` has no anchor — `site_tasks` has no `start_date`.** Additive column, set when status → `active`. |
| **W5** | Drag reorder, **server-validated** by the constraint engine | Topo validation + persist | **`Evaluator.checkMove()` exists and is pure.** Persist is gated off (`siteops-generate:79-88`); client duplicates the verdict logic | **PARTIAL** | New endpoint that loads the graph, calls the **real** `checkMove`, and on allow persists with `order_source='manual'` (the stickiness invariant already in `persist.ts:115`). Then **delete the client-side duplicate** so there is one ruleset. |
| **W6** | Across-flats rollup ("Tiling 1/4") | Per-activity counts across units | VM has all task rows grouped by unit | **PARTIAL** | Pure derivation over the VM, grouped by `task_type_id`. Cheap. |
| **X1** | Bidirectional task↔issue links; snag spawns issue; closing unblocks | Link model | `problems.task_id` (one direction only); `problems.impact jsonb` (advisory blast radius) | **PARTIAL** | Additive: `site_tasks.blocked_by_problem_id` (or a link table if many-to-many is real — **confirm**), and `problems.parent_problem_id` for snag→issue. Closing an issue must clear the block **in code**, with a test. |
| **X2** | "Chases again at 6pm", Nudge-now, chase log in timeline, silence→severity | Schedule + manual fire | `next_followup_at` ✅ (already rendered); `followup_events` ✅; `useTrailStates` gives silence ✅ | **PARTIAL** | ⚠️ **The cron is DAILY at 09:00 IST** — "chases again at 6 pm" would be **a lie**. Either say "tomorrow morning" or make the cadence sub-daily (bigger change). **Nudge-now is MISSING**: new per-item endpoint (reuse `siteops-chase`'s digest + `hasOpenSession` logic; do **not** re-fire the org-wide sweep). |
| **X3** | Ref-stamped outgoing, replies auto-attach, "DSR-21 done" → ladder | wamid↔item + ref | `wa_message_map` (readback/pick) ✅; `chase_batches` ⭐ prior ✅; ladder ✅. **No ref stamp in text.** | **PARTIAL** | Stamp `[DSR-21]` on outgoing item messages **and feed the ref into the resolver's candidate labels** so the LLM can match on it by meaning (the codebase deliberately has no keyword matcher — do not add one). Extend `wa_message_map.ref_kind` with `'item'` — ⚠️ that's a CHECK change, so `check_constraints.ts` must see it. |
| **X4** | Status one-liners, guide lines, auto-close notes; bilingual-ready | Deterministic composers | `_siteops_readback.ts` (pure, no I/O) ✅; `composeReadback` ✅; bilingual: router `reply_language`, Sarvam STT, `_translit.ts` ✅ | **PARTIAL** | New **pure** composers next to `_siteops_readback.ts`. **Constitutional floor: these are templated from code-derived state, never model prose.** The existing architecture already enforces this — keep it. |

---

## 4. Gap List (the additive changes, consolidated)

**Migrations (all additive — no renames, no repurposing):**

1. `site_ref_counters` + `next_site_ref()` + `problems.ref` + backfill + unique index. *(P2)*
2. `problems.floor_label`, `problems.unit_label`. *(W2, P4)*
3. `problem_resolutions` table. *(P6, P7)*
4. `site_tasks.started_at` (or `start_date`). *(W4)*
5. `site_tasks.blocked_by_problem_id`, `problems.parent_problem_id`. *(X1)*
6. `wa_message_map.ref_kind` CHECK widened to admit `'item'`. *(X3)*

**Edge functions:**

7. `siteops-say` — the owner-voice composer send path (window-aware, ref-stamped). *(P5)*
8. `siteops-nudge` — per-item immediate chase. *(X2)*
9. `siteops-reorder` — server-validated drag persist via the real `Evaluator.checkMove`. *(W5)*

**Portal:**

10. `ActiveSiteContext` (scope, `localStorage`-persisted). *(S1)*
11. Feature flag — **none exists**; simplest additive option is an env var (`VITE_SITE_DESK=1`) mirroring the only existing `import.meta.env` pattern, or a column on `organizations` if per-org staging is wanted. *(constraint 3)*
12. `/desk/*` routes + nav, with `/site-desk` redirecting in. *(S2)*

**Pure code (constitutional floors — no model, no SQL):**

13. `severityScore()` *(P3)*, status/guide sentence composers *(X4)*, close-requires-photo guard *(P8)*, across-flats rollup *(W6)*.

**Deferred (real cost, not needed for 5-user validation):**

14. Unit-type (2BHK/3BHK) templates *(W3)* — engine surgery.
15. Block tier in the location model *(W2)* — only matters at >1 block.
16. Sub-daily chase cadence *(X2)* — only if "6 pm" copy is a hard requirement.

---

## 5. Ordered Plan

Each step leaves the system shippable. **Everything ships behind the flag from Step 1**, so the portal renders identically with Site Desk off.

| # | Step | Touches | Blast radius | Rollback | Needed for 5-user validation? |
|---|---|---|---|---|---|
| **0** | **Rule on the snag model (§2).** No code. | — | — | — | **Blocking** |
| **1** | Feature flag + `/desk/*` route shell + `ActiveSiteContext`. Renders an empty shell. `/site-desk` redirects in. | `App.tsx`, `BriklayRail.tsx`, `navTokens.ts` | Low — but it edits the 1100-line `App.tsx` and the nav, the two files everything shares | Flip flag off | ✅ |
| **2** | **Refs.** Migration 1 + backfill. Verify `project_code` constraints first (S3 ⚠️). | New table + `problems.ref` | **Medium** — a backfill over live rows. Do it `created_at ASC`, once, and never renumber | Ref column is additive; drop is safe pre-launch. **Post-launch: never.** | ✅ |
| **3** | **Loc + resolution columns.** Migrations 2, 3, 4. Persist the structure slot the decompose path *already computes* onto `problems`. | `problems`, new table, `site_tasks` | Low (additive columns) | Drop columns | ✅ |
| **4** | **Pure read-model floors**, red-first: `severityScore`, status/guide sentences, close-requires-photo, across-flats rollup. No UI, no DB. | `src/lib/siteOps/` + tests | **Zero** — pure functions | Delete | ✅ |
| **5** | **Problems tab** (P1/P3/P4/P6/P7). Reuses `ItemsTable` patterns; new list + detail + close modal. | New components; **read-only** against the pipeline | Low behind the flag | Flag | ✅ |
| **6** | **P8 photo floor** in *both* doors: the portal close path **and** the WhatsApp auto-close ladder. | `_siteops_resolution.ts` (extends), portal | **HIGH — this touches the live resolution ladder.** Red-first, and run the full 521 | Revert; the ladder is pure and well-tested | ✅ |
| **7** | **`siteops-say` composer** + ref-stamping + `wa_message_map.ref_kind='item'` (migration 6). | New fn; extends `_format.ts` `capture`; CHECK widened | **HIGH — outbound to real customers.** Window rule must be right | New function; stop calling it | ✅ (desktop composer) |
| **8** | **Chase surfaces**: next-chase line (**honest copy — daily, not 6 pm**), chase steps in the timeline, `siteops-nudge`. | New fn; read-only over `followup_events` | Medium (nudge sends a real message) | Remove the button | ⚠️ Nudge can defer |
| **9** | **Work Plan tab** (W1/W2/W4/W6) over the existing VM + `siteops-generate`. Unit badges need Step 3's loc columns. | Read-only over the engine | Low | Flag | ✅ (view only) |
| **10** | **X1 links** (migration 5) + "Holding up" + "Blocked by {ref}" + un-block on close. | `site_tasks`, `problems`, close path | Medium | Additive columns | ⚠️ Partly — `impact` already gives a read-only "holding up" |
| **11** | **W5 server-validated reorder** (`siteops-reorder`), then **delete the client duplicate**. | Un-gates the disabled persist path; engine bundle must be rebuilt | **HIGH — first write path into `site_tasks` ordering.** `guardrail.test.ts` applies | Keep persist gated | ❌ Defer |
| **12** | **W3 unit-type templates.** Engine surgery. | `library.ts`, `instantiate.ts`, stack shape | **Highest** — changes generated task sets for *existing* projects | Hard. Needs its own design | ❌ Defer |

---

## 6. Contracts

### `next_site_ref` (SQL, `SECURITY DEFINER`)
```sql
-- atomic, race-safe, monotonic, never reused
create or replace function public.next_site_ref(p_project_id text)
returns text language plpgsql security definer as $$
declare v_code text; v_n bigint;
begin
  select project_code into strict v_code from public.projects where project_id = p_project_id;
  insert into public.site_ref_counters (project_id, next_val) values (p_project_id, 2)
    on conflict (project_id) do update set next_val = site_ref_counters.next_val + 1
    returning next_val - 1 into v_n;                 -- UPDATE…RETURNING = one atomic statement
  return v_code || '-' || v_n::text;
end $$;
```
⚠️ `strict` throws if `project_code` is null — which is why S3's constraint check is a prerequisite.

### `POST /siteops-say`
```jsonc
// request
{ "problem_id": "uuid", "text": "Sir, any update on the seepage?", "as_org": true }
// response
{ "sent": true, "channel": "session" | "template", "wamid": "wamid.HBg…", "ref": "DSR-21" }
// 409 when out-of-window and no template fits:
{ "sent": false, "reason": "outside_24h_window_no_template" }
```
Outgoing text is stamped `[DSR-21]` and a `wa_message_map` row is written with `ref_kind:'item'`, `object_refs:[{kind:'problem', id}]`.

### `POST /siteops-nudge`
```jsonc
{ "problem_id": "uuid" }
→ { "chased": true, "owner": "Ramesh", "channel": "session", "next_followup_at": "2026-07-13T03:30:00Z" }
```
Reuses `siteops-chase`'s owner-resolution + `hasOpenSession()`; writes a `chase_sent` event; **does not** run the org-wide sweep.

### `POST /siteops-reorder`
```jsonc
{ "project_id": "PRJ-1", "node_key": "floor_tile@First#First-UnitA-dry", "target_seq_no": 42 }
// allowed
{ "ok": true, "moved": ["floor_tile@…", "screed@…"], "verdict": "allow_with_consequence",
  "message": "Screed must move with tiling (cohesion)." }
// rejected — the engine's own violation message, not a UI string
{ "ok": false, "verdict": "forbid", "reason": "IMPOSSIBLE",
  "message": "Floor tiling cannot precede screed." }
```

### Problem read-model (what the Problems tab renders)
```jsonc
{
  "ref": "DSR-21", "kind": "snag", "title": "Seepage in lift wall",
  "loc": { "floor": "First", "unit": "Unit A" },      // null for issues
  "category": "material",                              // cause; null for snags
  "status_line": "Waiting on Ramesh since Tuesday.",  // code-composed, never model prose
  "waiting_on": { "name": "Ramesh", "id": "uuid" },
  "age_days": 6, "age_alert": true,
  "has_photo": true, "photo_pending": false,
  "next_chase_at": "2026-07-13T03:30:00Z",
  "holding_up": [{ "task_id": "uuid", "name": "Plastering — First" }],
  "severity": 812                                      // severityScore(), deterministic
}
```

---

## 7. Verification Plan

### Red-first invariants (write these **before** wiring)

| Invariant | Suite | Why it must be red first |
|---|---|---|
| **Ref uniqueness + monotonicity per site**; two concurrent creates never collide; a delete never frees a number | webhook (`fake_supabase`) + a real concurrency probe | "Refs are forever" is unrecoverable if wrong |
| **Ref backfill is stable** — running it twice changes nothing | new | A second run must not renumber |
| **Severity derivation is deterministic** — same inputs → same score, no clock/model reads | engine-style pure test | Constitutional floor |
| **Snag close requires a fix photo**, in **both** doors (portal close **and** the WhatsApp auto-close ladder) | webhook (`resolution.test.ts` neighbours) | A floor enforced in one door is not a floor |
| **Close/reopen preserves audit** — reopen never deletes the resolution row; the trail keeps both events | webhook | `followup_events.reopened` already exists; this pins it |
| **Reorder rejects a constraint violation** with the **engine's** message (not a UI string) | engine | W5's whole point |
| **RLS isolation on every new table** — org B cannot read org A's refs/resolutions | new (mirror the canonical policy) | Multi-tenant |
| **`assertNoDrop` still holds** — every LLM finding still produces a terminal | webhook (existing) | Zero-regression on the pipeline |
| **`guardrail.test.ts` still holds** — no invisible `site_tasks` writes | webhook (existing) | Zero-regression |
| **All 521 + 72 + 75 stay green** | all three | The contract |

⚠️ **Test-harness gotcha:** every new column/CHECK must land via **plain `CREATE TABLE` / `ALTER TABLE ADD COLUMN` / `CHECK (col IN (...))`** DDL, or `table_columns.ts` / `check_constraints.ts` won't parse it and legitimate code will fail with a *fake* `42703`/`23514`. **No `DO $$ … $$` blocks in these migrations.**

### Live probe (mirrors the existing sprint-probe practice)

1. WhatsApp: *"BSR enclave 2nd slab seepage in lift wall first floor"* → item created, `kind=snag`, `ref=DSR-N`, `loc={First, —}`.
2. Portal `/desk/DSR/problems` → row appears: ref, loc, waiting-on, age, severity position.
3. Detail → composer → *"Any update?"* → arrives on WhatsApp **stamped `[DSR-N]`**.
4. Supervisor replies *"DSR-N fixed sir"* **without a photo** → ladder proposes close → **P8 floor holds**: not verified-closed; Babai asks for the photo.
5. Supervisor sends the fix photo → `attachments.role='answer'` → auto-close proposal → accept in portal → `problem_resolutions` row (`outcome=fixed`), animated removal, **Undo** works.
6. Reopen → item returns, resolution row **still present**, trail shows both events.
7. Nudge-now on a second item → chase fires immediately, `chase_sent` event appears in the timeline.
8. Confirm a **second org** sees none of it.

---

## 8. Uncertainties — what I'd need to confirm

1. **⛔ The snag model (§2).** Blocking. A product ruling, not a code question.
2. **The HTML prototype was never attached.** Exact copy, severity thresholds ("red at threshold" — which threshold?), and the close-modal wording are unspecified. I did not invent them.
3. **Which migrations are actually applied to prod.** Deploys are manual SQL-editor runs; the repo's own docs say some constraints "may not be applied". **`project_code`'s NOT NULL/UNIQUE (step 1f) is specifically in doubt — and P2's refs depend on it.** Confirm against `information_schema` before Step 2.
4. **"Chases again at 6 pm"** — the cron is **daily at 09:00 IST**. Is sub-daily cadence a requirement, or is honest copy ("tomorrow morning") acceptable? This changes X2's cost by an order of magnitude.
5. **Blocks tier** — the brief says "only if >1". `construction_stack` has no block level. Confirm no current customer has multiple blocks, and defer.
6. **Task↔issue cardinality** — can one task be blocked by many issues? That decides column-vs-link-table in X1.
7. **The "12 task types"** in your notes doesn't match the library (~50+ across 6 sections). Stale note, or a different grouping?
8. **`todos`' future.** Under the recommended ruling it stays as to-dos. Does Site Desk surface them at all, or is that a third tab later?

---

## 9. Top 5 risks to the zero-regression constraint

1. **P8 and X3 both reach into the live resolution ladder** (`_siteops_resolution.ts`), which is the single most-tested, most-load-bearing pure module in the system (it is *why* 521 tests exist). A photo-floor or a ref-stamp bolted on carelessly can silently convert a `resolve` into an `ask` for **every existing issue**, not just snags. *Mitigation: red-first, extend the pure planner only, run the full 521 before and after, and never touch `validateContract`.*

2. **The ref backfill is irreversible.** "Refs are forever" means a botched first backfill (wrong order, run twice, run before `project_code` is unique) can only be fixed by renumbering — which is precisely what is forbidden. *Mitigation: verify `project_code` constraints first; make the backfill idempotent; test it twice against a snapshot; do it in a single transaction.*

3. **The engine bundle desyncs silently.** `supabase/functions/_shared/siteops-engine.js` is a **hand-run** esbuild artifact of `src/lib/siteOps/engine/`. Nothing in CI checks it. W5 and W1 both put edge functions on the engine; the day someone edits `library.ts` and forgets `node scripts/build-engine-bundle.mjs`, the portal and the WhatsApp agent will be running **different constraint rulesets** — and the tests will pass. *Mitigation: add a staleness check to the test gate before Step 9. This is a pre-existing landmine, not one Site Desk creates — but Site Desk doubles the number of consumers.*

4. **`App.tsx` and `BriklayRail.tsx` are shared, unavoidable, and huge.** Every new route touches a 1,100-line file that every other page depends on, plus the nav rail, plus the mobile tab bar, plus `getMobileTitle`. A careless edit regresses navigation for *every* module. *Mitigation: Step 1 is route-shell-only behind the flag, reviewed on its own, shipped before any Site Desk logic exists.*

5. **The outbound composer sends real messages to real customers.** `siteops-say` is the first "arbitrary text as the org's voice" path in the codebase — deliberately, none has ever existed. Get the 24h window wrong and you either fail silently (out-of-window free text is rejected by Meta) or spam a template. *Mitigation: reuse `hasOpenSession()` verbatim; go through the durable `outbox` (so retries/TTL/FIFO behave like everything else); never bypass to `sendNow()`.*

**Honourable mention:** the migration-application gap. The repo's history shows the same CHECK constraint widened 3–4 times because code shipped a new enum value before the migration admitting it had been run in prod — each time a **silent** dropped row. Site Desk adds new enum values (`ref_kind='item'`, the outcome enum). *Apply the migration first, deploy the code second.*

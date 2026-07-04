# Phase 0 — Architecture Reconnaissance (singular-first restructure)

Recon date: 2026-07-04 · branch `fix/siteops-empty-decompose-wiring` @ `906f5ba` + uncommitted working tree.
Scope: the real system as built, the built-vs-deployed gap, and the reconciliation decisions the
singular-first restructure must respect. Companion to `deferrals.md` (D5 is this restructure's opening move).

---

## A. Database map — SiteOps-touching tables

Real names resolved up front: the chase-batch table is **`chase_batches`** (not `siteops_chase_batches`);
the send queue is **`outbox`**; **`wa_message_map`** is a separate durable wamid→object map. "Snag" in the
product maps to **`todos`** in the schema.

| Table | Created / altered by | Load-bearing columns & CHECKs | Written by | Read by | RLS |
|---|---|---|---|---|---|
| `site_tasks` | `20260625000004`; altered `…000000/…000002/…000004/20260628000000` | `status IN ('not_started','active','done')`; `node_key`, `binding jsonb`, `status_history jsonb`, `owner_id/owner_source` | siteops-generate, siteops-engine reconcile, webhook `_siteops_route.ts:379` | candidates/impact/timing loaders, `_agents/siteops.ts` | `get_my_org_ids()` |
| `site_task_qc` | `20260625000004`; altered `20260626000004` | `qc_status IN (NULL,'pending','confirmed','failed')`; one-critical partial index | webhook `_siteops_route.ts:363` | same + frontend | `get_my_org_ids()` |
| `problems` (issues) | `20260626000003`; altered `…000009/…000010/20260701000001/20260703000000×2` | `status IN ('OPEN','ADDRESSING','RESOLVED','DISMISSED')` (DISMISSED added `20260703000000_siteops_dismissed_status`); `active_resolve_event uuid FK→followup_events` (undo binding, `20260703000000_problems_active_resolve_event`); `impact jsonb`, `deadline`, `cause` (no FK to taxonomy) | webhook (resolve/undo/dismiss/correct), siteops-chase (`next_followup_at` advance), siteops-reanalyze | chase sweep, candidates, resolution engine | `get_my_org_ids()` |
| `todos` (snags) | `20260626000003`; altered `20260701000001/20260703000000` | `status IN ('OPEN','DONE','DISMISSED')` | webhook, reanalyze | chase sweep, candidates | `get_my_org_ids()` |
| `site_narrations` | `20260626000003`; altered `20260626000006` | `resolved_project_via IN ('named','selected','auto','unresolved','multi')`; `decomposed jsonb`; `raw_text` | webhook capture-first (`siteops.ts:823`), siteops-narrate | webhook resume paths | `get_my_org_ids()` |
| `site_task_comments` | `20260626000001` | append-only | **frontend only** (no edge-function `.from()`) | frontend | `get_my_org_ids()` |
| `attachments` | `20260701000002`; widened `20260702000001` | `parent_type IN ('problem','todo','site_task','site_task_comment','site_narration','siteops_unplaced')`; `role IN ('creation','answer')` | webhook `siteops.ts:182` | frontend (signed URLs) | `get_my_org_ids()` |
| `siteops_unplaced` | `20260702000000`; widened `20260703000002` (see ledger) | `reason` CHECK — base 6 (`disambig,typed_pick,project,photo_pick,batch_collision,floor`) + v2 5 (`llm_unreadable,evidence_await_placement,v2_effect_failed,v2_unhandled_terminal,non_batch_target`); `status IN ('unplaced','placed','dismissed')`; `observation jsonb`, `candidates jsonb` (replay payload), `question_wamid`, `has_payload` CHECK | v2 park (`_siteops_resolution_llm.ts:194`), executor parks (`siteops.ts:447,540,566,569,576`), interrupt-park (`siteops.ts:247`) | late-answer recovery (`siteops.ts:1240`), frontend queue (deferred) | `get_my_org_ids()` |
| `chase_batches` | `20260627000001` | `status IN ('OPEN','CLOSED')`; `items jsonb` (BatchItem[]); **one OPEN per (org, sender)** partial unique | `_siteops_batch.ts` (upsertOpenBatch from siteops-chase; close from webhook) | `getOpenBatch` (`_siteops_batch.ts:259`) — read at `_dispatch.ts:146` and `siteops.ts:817,1463` | `get_my_org_ids()` |
| `followup_events` (trail) | `20260627000000`; widened `20260702000002` | `type IN (chase_sent, reply_received, status_changed, escalated, blocker_noted, comment, description_added, possible_photo_followup, reanalyzed)` — **`bare_ack` MISSING, live trap, see Flags**; exactly-one-parent CHECK; `pending_reanalysis bool` | `trailEvent` (`siteops.ts:282`), siteops-chase, reanalyze | chase escalation scan, reanalyze harvest, `problems.active_resolve_event` FK | `get_my_org_ids()` |
| `cause_taxonomy` | `20260626000007` (seeds 12) | `idle_cost IN ('yes','partial','no','if_blocking')`; NULL cadence = not chased | service-role only | `_siteops_timing.ts:54` | authenticated read-all |
| `follow_up_rules` | `20260626000008` | PK (org_id, cause_key), NULL = don't chase | frontend | `_siteops_timing.ts:59` | `get_my_org_ids()` |
| `wa_conversations` | `20260613000008`; altered `…000013/20260620000004` | `status IN ('OPEN','CLOSED','ABANDONED')`; `slots_so_far jsonb`; `owning_agent`; `pending_question` | `_conversation.ts` | router view, resume | service-role-only (no policies) |
| `wa_message_map` | `20260702000004` | PK `outbound_wamid`; `ref_kind ('readback'\|'pick')`; `object_refs jsonb` | wa-outbox-drainer `:98` | quoted-reply recovery (`siteops.ts:267,462,1245`) | service-role-only |
| `outbox` | `20260613000008`; + `capture_ref` `20260702000004` | `status IN ('PENDING','SENDING','SENT','FAILED')`; `capture_ref jsonb`; `dedup_key` | `_spine.ts:77` send() | drainer via `outbox_claim()` RPC | service-role-only |
| support: `wa_registered_numbers`, `wa_message_log`, `wa_sessions`, `processing_job` | `20260513200000` / `20260613000008` | `processing_job.status` 6-value CHECK | webhook spine | sender→user resolution everywhere | raw membership policies (older style) / service-role-only |

**Written-but-never-read (edge layer):** `problems.status_history` is dead-legacy (superseded by
`followup_events` per `20260627000000`, no remaining writer/reader). `siteops_unplaced` is essentially
write-only in the edge layer except late-answer recovery — its review UI is the deferred "to place" queue.

## B. Cron layer

Two registration conventions: **SiteOps crons are real migrations** (fail loudly if the Vault bearer secret
is missing, so they can't be scheduled broken); **WA-spine crons are deliberately manual** (`docs/*.sql`,
because a pg_cron error would roll back the whole migration file — `20260613000010:119`).

| Job | Schedule | Invokes | Registered by | Populates → consumed by (dormant-code question) |
|---|---|---|---|---|
| `siteops-chase-daily` | 03:30 UTC (09:00 IST) | fn `siteops-chase` | migration `20260701000000` | **opens `chase_batches`** (one OPEN digest per owner phone) → armed the gate at `siteops.ts:882`; writes `followup_events(chase_sent/escalated)`, advances `problems.next_followup_at`, queues `outbox` |
| `siteops-reanalyze-hourly` | :15 hourly | fn `siteops-reanalyze` | migration `20260702000003` | harvests `followup_events.pending_reanalysis` markers → conservatively fills missing `cause`/`deadline`, writes `reanalyzed` trail, clears marker; no AI key → no-op |
| `wa-outbox-drain` | every 10s | fn `wa-outbox-drainer` | **manual** `docs/wa_outbox_drainer_cron.sql` — contains literal `REPLACE_WITH_WA_DRAINER_SECRET`; nothing in-repo proves it live | drains `outbox`, writes `wa_message_map` (which quoted-reply recovery consumes) |
| `wa-watchdog` / `wa-purge-conversations` / `wa-commit-abandoned` | 30s / 2m / 1m | SQL fns | **manual** `docs/wa_spine_cron.sql` | spine hygiene; `wa_commit_abandoned_conversations(5)` is what ABANDONs stale convos (so "unanswered pick" resolution passes through `commitInterrupted`-style paths, not silent expiry) |

Chase escalation: silence streak ≥ `SITEOPS_ESCALATE_AFTER` or age ≥ `SITEOPS_ESCALATE_AGE_DAYS` → project
supervisor → org principal. Out-of-24h-window sends require the approved `issue_followup` template or the
item is skipped and re-fires.

## C. Edge functions — dispatch chain and the gate seam

17 functions; SiteOps-relevant: `whatsapp-webhook`, `wa-outbox-drainer`, `siteops-chase`,
`siteops-reanalyze`, `siteops-enrich`, `siteops-narrate`, `siteops-note`, `siteops-generate`,
`siteops-notify-assignment`, `send-template` (+ `_shared`).

whatsapp-webhook chain:
`index.ts:81 serve` → `recordInbound :190` (dedup + org + `processing_job`) → `processJob :359` →
`normalize` (voice→Sarvam STT, image→vision) → reaction shortcut → `acquireSenderLock` → `_dispatch.ts:69
dispatch` → `getRouterView` → **batch read #1 `_dispatch.ts:146`** (routing bias only: flips a VAGUE reply
to SITEOPS — already a prior, keep) → `routeMessage` → registry → `runSiteops` (`_agents/siteops.ts:812`).

**The gate (what the restructure kills):** inside `runSiteops` —
- `:817` `getOpenBatch` loaded before anything else;
- `:870-877` empty-decompose sub-gate → `handleBatchReply` (Defect A's fix);
- **`:882-885` the hard gate: any open batch with items routes the whole message into `handleBatchReply`,
  which runs `resolveInbound` over an ALL-projects candidate set and applies terminals batch-scoped
  (`itemsById` = batch items only).** This is D5's *batch-captures-fresh*, third occurrence.
- Third batch read `:1463` (answerSiteops pick-recovery).

The all-projects drift: `buildCandidateSet` (`_siteops_resolution_llm.ts:39`) loads open
issues+todos+tasks across **ALL active projects** (comment says "deliberately"; D4 capped it "never by
meaning"). The owner's design overrides this: THE project only.

Env flags: `WA_SITEOPS_IMAGE_MODEL(_ANTHROPIC)` default `''` (vision falls back to base keys);
procurement `WA_FLOW_*_ID` unset (Flow send inert); `send-template` needs `verify_jwt` off after each
deploy.

## D. Live-state probes — run in the SQL editor, paste results back

Migrations are applied by hand here, so `schema_migrations` is not authoritative; these probe the objects
themselves. One block, labeled rows:

```sql
-- ── ledger probes: which repo migrations are actually live ──────────────────
select 'reason_check' k, pg_get_constraintdef(oid) v from pg_constraint where conrelid='public.siteops_unplaced'::regclass and conname='siteops_unplaced_reason_check'
union all
select 'followup_type_check', pg_get_constraintdef(oid) from pg_constraint where conrelid='public.followup_events'::regclass and conname like '%type%'
union all
select 'problems_status_check', pg_get_constraintdef(oid) from pg_constraint where conrelid='public.problems'::regclass and conname like '%status%'
union all
select 'active_resolve_event_col', count(*)::text from information_schema.columns where table_name='problems' and column_name='active_resolve_event'
union all
select 'pending_reanalysis_col', count(*)::text from information_schema.columns where table_name='followup_events' and column_name='pending_reanalysis'
union all
select 'wa_message_map_table', count(*)::text from information_schema.tables where table_name='wa_message_map'
union all
select 'outbox_capture_ref_col', count(*)::text from information_schema.columns where table_name='outbox' and column_name='capture_ref'
union all
select 'attachments_parent_check', pg_get_constraintdef(oid) from pg_constraint where conrelid='public.attachments'::regclass and conname like '%parent_type%'
union all
select 'cron_jobs', string_agg(jobname||' '||schedule, ' | ') from cron.job
union all
select 'media_mimes', array_to_string(allowed_mime_types,',') from storage.buckets where id='rough-entry-media';

-- ── live state that interacts with the restructure on day one ───────────────
select 'open_batches' k, count(*)::text, min(created_at)::text oldest from chase_batches where status='OPEN'
union all
select 'open_batch_items', coalesce(sum(jsonb_array_length(items)),0)::text, null from chase_batches where status='OPEN';

select reason, status, count(*) from siteops_unplaced group by 1,2 order by 1;      -- park backlog by reason
select owning_agent, status, count(*) from wa_conversations where status='OPEN' group by 1,2;
select 'unmapped_readbacks' k, count(*) from outbox o
  where o.status='SENT' and o.capture_ref is not null
  and not exists (select 1 from wa_message_map m where m.convo_id = (o.capture_ref->>'convo_id')::uuid);
```

Expected reads: `reason_check` containing `non_batch_target` ⇒ `20260703000002` applied;
`followup_type_check` will show whether `bare_ack` is admitted (repo says it is NOT — see Flags);
`siteops_unplaced` group-by ⇒ the backlog Stage 1/2 must not orphan and that `pending_stage2` will join.

**PROBED 2026-07-04 (results reviewed with rulings):** prod DB is FULLY caught up — every repo migration
is live, including `20260703000002` (hand-applied) and both crons; `rough-entry-media` admits audio. The
two absences are exactly the Stage-1 migration: `bare_ack` NOT in `followup_type_check` (landmine
confirmed by the constraint itself — every fast-path ack since the adoption deploy threw and was
swallowed) and `pending_stage2` NOT in `reason_check` (expected; Stage 1 introduces it). Live state:
**6 open `chase_batches`, oldest 2026-06-27 (a week), 19 items total** — six senders have had every
message intercepted by the gate for up to seven days; the Stage-1 prod probe MUST include one message
from a sender with an open batch (that population's behavior flips on deploy day). 4 unmapped readbacks
(pre-4a sends, no action). **Day-one snapshot INCOMPLETE:** the `siteops_unplaced`-backlog-by-reason and
open-`wa_conversations` queries were not run — complete them when convenient (they inform Step 6's
urgency, not Stage 1).

**Open question logged (not this stage's scope): what CLOSES a chase batch?** A week-old OPEN batch
suggests nothing sweeps them — the webhook closes a batch only when replies resolve it empty, and the
chase cron `upsertOpenBatch` replaces rather than expires. Under the new architecture a stale batch is
just annotation (ranking prior), but state-that-only-grows has bitten before. Revisit after Stage 2.

## Built-vs-deployed ledger

Git topology: branch = `main` (`444fe74`, Fixes 1–3) + 15 commits ending `906fb5a…906f5ba` (v2 phases 1a→
adoption) + **uncommitted working tree** (held/`non_batch_target` readback + `labelById`, i.e. the
executor Defect-2 suite) + **uncommitted migration `20260703000002`**.

| Layer | Live (evidence) | Not live |
|---|---|---|
| `whatsapp-webhook` fn | almost certainly the branch at/near `906f5ba` — the D5 live probe exercised the v2 engine's entry gate and the landmine text observed v2 parks bouncing *in prod*; **needs confirmation** (no CLI here) | the uncommitted working tree (held-park readback, labelById) |
| Migrations | `20260702000000` confirmed applied (42710 policy error on re-run). Everything after: **unknown until the probe block runs** — repo evidence says v2 parks were bouncing, i.e. `20260703000002` was NOT applied at probe time | `20260703000002` presumed pending; `20260703000000×2`, `20260703000001`, `20260702000002/3/4` unconfirmed |
| Crons | siteops-chase / reanalyze migrations fail loudly if secrets missing, so if applied they're genuinely live | `wa-outbox-drain` has no in-repo proof (manual + placeholder secret) — but readbacks demonstrably send, so it's live in practice; confirm via `cron_jobs` probe |
| Tests | 158 passed / 0 failed / 2 skipped offline (Node runner `run-tests.mjs`), incl. adoption journeys a–g of Phase 2 | the offline fake does not enforce CHECKs — twice now the cause of pure-green-while-broken |

**Ledger closed by the 2026-07-04 probe:** the built-vs-deployed gap is CODE ONLY — every migration and
both SiteOps crons are live; Stage 1's deploy is a clean cut (one migration + one function deploy).

**E5 latency cost, explicitly owned (ruling):** the interim double-LLM (decompose + resolveInbound,
sequential) puts the supervisor's readback wait near ~1.5s (p50 was 641ms for one call). Acceptable,
known, and scheduled to die in Phase 4 with the double-decompose cleanup.

## Flags (new findings, beyond the spec's known context)

1. **🔴 `followup_events.type='bare_ack'` violates the live CHECK — same class as the landmine, unfixed.**
   `trailEvent` writes `bare_ack` on the cardinality fast path (`siteops.ts:346`, callers `:631,:688`); no
   migration admits it; insert throws; `trailEvent` swallows (`:291`) → the trail line the fast path exists
   to leave is silently dropped in prod. Tests assert it and pass because the fake doesn't enforce CHECKs.
   → admit `'bare_ack'` in the same migration that adds the Stage-1 reasons (spend the line).
2. **The fake must learn CHECK enforcement** for `siteops_unplaced.reason` and `followup_events.type`
   before Stage-1 journeys are written, or the class recurs invisibly (deferrals already reminds this for
   the park table; the bare_ack find proves it's systemic).
3. `problems.status_history` is dead-legacy — candidate for a Phase-4 drop, not now.
4. `wa-outbox-drain` cron: manual, placeholder secret in the doc, no in-repo applied marker.

## E. Reconciliation decisions

**E1 — Where the singular unit enters; where the gate dies.** The unit's entry is `runSiteops` itself; the
seam that dies is `siteops.ts:882-885` (and the `:870-877` sub-gate's *batch* leg). New order inside
`runSiteops`: capture-first persist (unchanged, stays first) → decompose (kept in Stage 1 as
normalizer/splitter/project-hint source — see E5) → **bare-ack fast path** (the only pre-project batch
consumer: `isBareAck` + lone chase → no LLM; this is also where Defect A's empty-decompose rescue lives on)
→ resolve THE project, ask-first → `buildCandidateSet(projectId)` scoped to THAT project, batch items
flagged `chased` only if they survive the project filter (ranking falls out naturally — a batch on another
project is invisible because its items aren't in the set) → one `resolveInbound` → apply via the existing
ladder / create via `routeGroup` / didn't-catch. `handleBatchReply` is renamed `handleBatchReplyLegacy`,
unreachable, deleted in Phase 4. `_dispatch.ts:146` (routing bias) is already a prior — untouched.

**E2 — siteops_project resume slots: one additive jsonb field, no migration.** Today's resume
(`siteops.ts:1527`) routes stored `slots.items` through `finishRoute` — create-only, never
`resolveInbound`. The ask-first flow needs the resume to run the REMAINDER of the unit, and
`resolveInbound` needs the raw message text, which slots don't carry. Add `text` to the
`siteops_project` slots (jsonb — additive, zero schema change). Fetching `site_narrations.raw_text` by
`narration_id` was the alternative; rejected because `narration_id` is nullable (capture-first tolerates
insert failure) and the slots must be self-sufficient for the interrupt-park to stay honest.

**E3 — `pending_stage2` fragments: existing shape carries them; only the CHECK needs the word.**
`observation jsonb` (the fragment SiteItems) + `candidates jsonb` (replay payload — the `non_batch_target`
precedent) + `sender_number`/`narration_id`/`question_wamid` are sufficient. No new column. The `reason`
CHECK must admit `'pending_stage2'`: if `20260703000002` is still unapplied (probe D), add it THERE
(spend-the-line rule); if applied, one new ALTER that also admits `bare_ack` on `followup_events.type`.

**E4 — `no_project`: REPORTED DEVIATION — the park the spec asks for already exists as `reason='project'`.**
`commitInterrupted` (`siteops.ts:241-270`) already parks an interrupted/superseded project question with
the full payload (items in `observation`, pick list in `candidates`, `question_wamid` stamped) and
late-answer recovery already reconstructs it (`:1240`, `reconstructParkedSlots`). Conversations never
expire silently (`wa_commit_abandoned_conversations` sweeps them into the same interrupted fate). Decision:
**reuse `reason='project'`** rather than adding `'no_project'` — a second name for the same semantic splits
the review queue and the recovery path matches on the payload shape, not the reason string. If you want the
spec's name regardless, it's a one-word CHECK addition — say so and I'll comply; the mechanism is identical.

**E5 — Chicken-and-egg on project resolution (interim double-LLM, acknowledged).** The candidate set needs
THE project before the one call, but the project hint comes from `decompose` (an LLM call). Stage 1 keeps
`decompose` as normalizer + compound-splitter + project-hint source (the interim first-item rule needs the
split anyway); `resolveInbound` stays the meaning engine. This is the "double-decompose" the spec already
schedules for Phase-4 cleanup — not new debt, now explicitly owned. Small consequence: the v2 prompt's
per-item `project_hint` ("resolved by MEANING against the candidate projects") must be re-worded for a
single-project candidate set, or the model will keep trying to cross-project-hint.

**E6 — D4's scale cap mostly evaporates.** A single-project candidate set is naturally small; the
recency/cardinality cap stays deferred.

No spec line found that is *wrong*; E4 is the one place reality already implements the spec under a
different name, and E5 is the one place the spec's Stage-1/Phase-4 split has a hidden cost (two LLM calls
per message, interim) — both reported, neither silently adapted.

---

## Stage-gate checklist derived from this map (for the record; work starts only after review)

1. ✅ Probes confirmed → the Stage-1 migration is finalized at EXACTLY two CHECK additions
   (`20260704000000_siteops_stage1_check_additions.sql`): `followup_events.type` += `bare_ack` ·
   `siteops_unplaced.reason` += `pending_stage2`. Applies to prod immediately after review, independent
   of the code deploy — it retro-fixes the live trail-drop the moment it lands.
2. Teach `fake_supabase.ts` CHECK enforcement BEFORE writing journeys a–g (ratified as a GATE, not
   alongside). Requirements per ruling: constraints PARSED FROM THE MIGRATION FILES, never hand-copied
   (hand-copied constraints drift), so future migrations teach the fake automatically. The proof-red
   case: the `bare_ack` insert against the PRE-migration constraint must FAIL in the fake exactly as it
   fails in prod today.
3. Journeys a–g RED in their own commit (two-commit red-first, per the standing rule). Per ruling E4,
   journey (c)'s park assertions use `reason='project'` — the acceptance spec is pinned to this ruling
   so test and ruling cannot drift.
4. Singular unit (E1 order) green · deploy · prod probe (transformer / tiles / undo round-trip, AND one
   message from a sender with an open batch — the population whose behavior flips on deploy day).
5. Stage 2 loop; journeys h–j; the Telugu voice note as the final probe.

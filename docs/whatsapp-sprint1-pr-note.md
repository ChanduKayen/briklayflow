# WhatsApp Sprint 1 — the durable spine

Branch: `wa/sprint-1-spine`

Builds the infrastructure behind "no silent failure" and threads `org_id` through
every WhatsApp-written row, **wrapping** the existing `_session`/`_handlers`
processor (not replacing it). Sits on the just-landed tenancy foundation — every
new table inherits it (RLS enabled, server-internal = no client policies).

## New tables (migration `…0008`) — all RLS enabled, no client policies
| Table | Purpose | Notes |
|---|---|---|
| `processing_job` | promise-to-respond; `RECEIVED→PROCESSING→(WRITTEN\|FAILED)→(CONFIRMED\|CONFIRM_PENDING)` | `wamid` UNIQUE (idempotent), `org_id` NOT NULL, `failure_notified` for watchdog idempotency, partial index on PROCESSING |
| `outbox` | transactional outbox for outbound WA msgs | `status PENDING/SENDING/SENT/FAILED`, `attempts`/`next_attempt_at` backoff, `dedup_key` UNIQUE (idempotent enqueue) |
| `wa_conversations` | router state (schema only; **router populates later**) | full slot set per design; purge sweep deletes past `purge_at` |
| `wa_sender_locks` | per-sender serialization (pooler-safe) | session advisory locks are unreliable over Supabase's pooler → lock table with stale reclaim |

Server-internal: the webhook writes them as **service-role** (bypasses RLS). RLS is
ENABLED with **no policies** = deny-by-default for anon/authenticated (verified by the
harness). Org-scope them with the foundation helpers if ever surfaced to the client.

## Functions + sweeps (migration `…0010`)
- `wa_try_lock` / `wa_release_lock` — atomic acquire (insert-or-reclaim-expired) / own-lock release.
- `outbox_claim(limit)` — atomically flips due PENDING→SENDING (FOR UPDATE SKIP LOCKED) so concurrent drainers never double-claim.
- `wa_watchdog(timeout=30)` — flips `PROCESSING` past timeout → `FAILED` + enqueues **one** outbox failure (guarded by `failure_notified` + `dedup_key`; only touches PROCESSING). **pg_cron: every 30s.**
- `purge_wa_conversations()` — deletes past `purge_at`. **pg_cron: every 2 min.**
- All SECURITY DEFINER + locked `search_path`; EXECUTE granted only to `service_role`/`postgres`.

## Drainer (edge function `wa-outbox-drainer`)
Reads claimed outbox rows, sends via the WhatsApp Cloud API, marks `SENT`, or
reschedules with exponential backoff (30s·2^(attempts-1), capped 1h; `FAILED` after
`max_attempts`). Service-role-bearer gated. Scheduled via pg_cron + pg_net —
**run `docs/wa_outbox_drainer_cron.sql` once** (stores the key in Vault; project URL
prefilled). The atomic claim + dedup_key make it idempotent / no double-send.

## org_id threading (migration `…0009`, T1.6)
- `org_id` added to `wa_registered_numbers` (backfilled → active org) and `rough_entries`
  (backfilled: sender→registered, else created_by→membership, else active org).
- BEFORE INSERT triggers fill `org_id` automatically — **no handler or client edits**:
  `rough_entries` from `sender_number` (WhatsApp) or `auth.uid()` (UI);
  `wa_registered_numbers` from the registering admin's org.
- At ingest the webhook resolves org from the sender's registered number and
  **quarantines** (replies, writes nothing) a number with no resolvable org.

## Webhook wiring (`index.ts` + new `_spine.ts`, T1.7)
Ingest order: signature verify → `wamid` dedup → registration/org resolve (reject
un-orged) → `createJob(PROCESSING)` → `acquireSenderLock` → **`runLegacyProcessing`**
(the unchanged routing) → `markJob(WRITTEN)` on success / `markJob(FAILED)` +
`enqueueJobFailure` (outbox) on caught error → `releaseSenderLock` in `finally`.

## Decisions (per the prompt)
- **Replies:** happy-path replies stay **direct `sendWA`** (rewriting ~40 call sites
  is the out-of-scope handler rewrite). Only **watchdog/failure** messages go through
  the outbox now; full migration lands with the agents. *(Your choice.)*
- **pg_cron + pg_net:** confirmed enabled → watchdog/purge scheduled directly; drainer
  via pg_net. *(Your choice.)*
- **Locked defaults:** watchdog timeout **30s**, conversation purge **2 min** after CLOSED, sweeps on **pg_cron**.

## Verify (`docs/verify_wa_spine.sql`, transactional/ROLLBACK)
Proves: a stuck `PROCESSING` job → `FAILED` + exactly one outbox failure within the
timeout; **idempotent** on re-run; a fresh in-flight job is **not** false-positived;
and `authenticated` reads **0** rows from all four server-internal tables.

DoD demonstrations:
- **Stuck job → failure msg:** `verify_wa_spine.sql` (watchdog) + the drainer sends the enqueued row.
- **Replayed `wamid` → one job, once:** `wa_inbound_dedup` (Sprint 0) + `processing_job.wamid` UNIQUE both gate; `createJob` returns `{duplicate:true}` → stop.
- **Every WA row carries `org_id`:** triggers + ingest resolution; un-orged sender quarantined.

## Flagged (follow-ups, not done here)
- `rough_entries.org_id` left **NULLABLE** and its RLS still **role-based** (not
  org-scoped) to avoid breaking day-book UI inserts/reads. Make NOT NULL + org-scope
  it once UI inserts reliably set org_id. WhatsApp rows are never written un-orged
  (ingest rejects).
- **Caught-error coverage is limited by the legacy handlers**, which swallow many
  errors (`console.error`, no throw) — so a handler-internal failure may still mark
  the job `WRITTEN`. The **watchdog** is the real net for hard crashes/timeouts; full
  per-step failure semantics arrive with the agent cutover.
- New-registration inserts rely on the trigger for `org_id`; consider setting it
  explicitly in `Invitation.tsx`/`App.tsx` when those are next touched.

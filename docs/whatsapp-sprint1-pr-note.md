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
- `wa_watchdog(timeout=30)` — flips `PROCESSING` past timeout → `FAILED` + enqueues **one** outbox failure (guarded by `failure_notified` + `dedup_key`; only touches PROCESSING).
- `purge_wa_conversations()` — deletes past `purge_at`.
- All SECURITY DEFINER + locked `search_path`; EXECUTE granted only to `service_role`/`postgres`.

**Cron scheduling is separate** (`docs/wa_spine_cron.sql`): watchdog every 30s
(falls back to 1 min if this pg_cron rejects sub-minute), purge every 2 min. It's
kept out of the migration so a cron quirk can't roll back the function DDL (the SQL
editor runs a file as one transaction).

## Drainer (edge function `wa-outbox-drainer`)
Reads claimed outbox rows, sends via the WhatsApp Cloud API, marks `SENT`, or
reschedules with exponential backoff (30s·2^(attempts-1), capped 1h; `FAILED` after
`max_attempts`). Gated by a **dedicated `WA_DRAINER_SECRET`** (not the service-role
key — generate with `openssl rand -hex 32`, set as a function secret AND in Vault).
Scheduled via pg_cron + pg_net — **run `docs/wa_outbox_drainer_cron.sql` once**
(project URL prefilled). The atomic claim + dedup_key make it idempotent / no double-send.

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

## Durability fix — record before ack, keep background alive
The POST path was the unhealthy fire-and-ack shape: `processMessage(body).catch()` was
a **bare floating promise** (no `EdgeRuntime.waitUntil`) the runtime could kill right
after the 200, and the dedup + `createJob` writes happened **inside** that backgrounded
function — *after* the ack. An isolate kill post-200 = a message acked to Meta with **no
DB row** (silent loss). Restructured to the healthy shape:
- `recordInbound()` — dedup + audit + org resolve + `createJob` — is **awaited and
  committed before** `return 200`.
- The heavy `processJob()` (lock → legacy routing → terminal state) runs under
  **`EdgeRuntime.waitUntil()`** so it isn't killed; a crash there is recovered by the
  watchdog/outbox.
- Terminal replies for `unregistered`/`no_org` also go through `waitUntil`.

## Retry-storm hardening (post-deploy)
- **Always 200 after a valid signature** (`index.ts`): the only non-2xx is a
  failed/missing signature (correct — reject junk). A *signed* but unparseable body
  acks 200 (retrying can't fix it); verification can't throw into a 500 (fail-closed
  to 403). All downstream processing is fire-and-ack, so processing failures never
  surface as non-2xx — Meta never retries and multiplies the storm; failures are
  recovered by the watchdog/outbox.
- **`createJob` idempotent on `wamid`**: a duplicate/retried delivery hits the
  `wa_inbound_dedup` gate or `processing_job.wamid` UNIQUE → clean skip, no second
  reply, 200 (already-acked). A retry is a cheap no-op.
- **Outbox TTL** (`20260613000011` + drainer): `outbox_expire(15)` marks any PENDING
  reply whose inbound is older than ~15 min as `EXPIRED` instead of sending — no
  answering a 22:38 "Hi" at 07:14. The drainer expires before claiming each tick.

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

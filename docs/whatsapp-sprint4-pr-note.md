# WhatsApp Sprint 4 — Transaction Agent (commit-always)

Branch: `wa/sprint-4-transaction`

The real Transaction agent replaces the Sprint-3 legacy bridge + `wa_sessions` mirror.
Core principle: **a transaction always commits** — the moment there's an amount it
becomes a durable Day Book draft (`rough_entries`), and the conversation only enriches it.

## New / evolved files
- **`migrations/20260613000014_txn_agent.sql`** — atomic staging RPCs:
  `stage_rough_entry` (entry + ack outbox in one tx, builds the deep link from the new
  id), `update_rough_entry_reply` (resolve a slot + reply), `discard_rough_entry`
  (cancel), `wa_commit_abandoned_conversations` (timeout sweep).
- **`_match.ts`** — `matchPayee`/`matchProject` with bands (ported from
  `ai-extract-entry`'s matcher; co-located because Supabase bundles functions
  separately).
- **`_extract.ts`** — added `extractTransaction()` → `{amount,payee,project,direction,
  mode,note,ref}`, injection-hardened (message wrapped as `<msg>` data).
- **`_agents/transaction.ts`** — the agent.
- **`_dispatch.ts`** — rewritten: TRANSACTION → agent; cancel-vs-answer split; interrupt
  consolidation; lingering passthrough. Legacy bridge/mirror removed.
- **`_agents/concierge.ts`** — added `prefix` for consolidated interrupt messages.
- **`Logbook.tsx`** — `?entry=<id>` deep-link focus (scroll + highlight).
- **`docs/wa_spine_cron.sql`** — scheduled the abandoned-conversation sweep.

## TXN_* band thresholds
`TXN_AUTO_THRESHOLD = 0.82`, `TXN_CONFIRM_THRESHOLD = 0.60` (env-overridable). `auto`
→ use silently (this is the "for pride site" → The Pride fix: no project question);
`confirm` → use but surface ("→ The Pride?"); `open`/no-match → leave slot, ask only if
core. **Single active project auto-resolves** (no question) too.

## Deep-link target
`https://briklay.app/logbook?entry=<rough_entry_id>` (`WA_APP_LINK`
overridable). Added focus to the existing `/logbook` route (no per-entry route existed):
`Logbook.tsx` reads `?entry`, scrolls to and ring-highlights `#db-entry-<id>`. The link
is appended to the ack inside the staging RPC, so it's part of the same message + tx.

## The model (how commit-always resolves cleanly)
- **Amount present → commit immediately** (one `stage_rough_entry` call = entry + ack
  atomic), then CLOSE (lingering). `PENDING` if payee+project confident, else
  `AWAITING_CONTEXT`. If a core slot is genuinely open (project unmatched + multiple
  active), commit `AWAITING_CONTEXT` **and** ask the project in the *same* atomic write,
  keeping the convo OPEN with `staged_entry_id` — the entry is already safe.
- **Amount missing → ask once, NO entry** (OPEN `AWAIT_AMOUNT`). This is the only
  "pending without a row" state, where gate-1 (fail-no-blank) applies.

## Lingering reference resolution
On `ref` ("another 2000 to **him**", "same"), the agent reads the **lingering CLOSED
convo's `staged_entry_id`** and pulls `payee_name`/`project_name` from that committed
entry's `ai_extracted` — resolving the payee and committing, no "who?".

## Traces

**Complete** — "ramu 5000 cash for pride site" (The Pride active, payee Ramu mapped):
- `extractTransaction` → `{amount:5000, payee:"ramu", project:"pride", direction:"out", mode:"cash"}`
- `matchPayee("ramu")` → auto; `matchProject("pride")` → auto (The Pride). No question.
- `stage_rough_entry(status=PENDING, msg="Saved Ramu Rs 5,000 -> The Pride ✓")` → 1
  `rough_entries` row (PENDING) **+** 1 outbox row, one tx. Convo CLOSED (lingering).
- WA: `Saved Ramu Rs 5,000 -> The Pride ✓` + `…/logbook?entry=<id>`.

**Interrupted** — mid "Which project?" (entry already `AWAITING_CONTEXT`), then "how much did I pay suresh?":
- `commitInterrupted` closes A (entry already committed) → ack `"Saved Ramu Rs 5,000 (draft) -- …?entry=<id>"`.
- B is a query → ack sent, then `handleQuery` answers. (Pure chitchat/txn interrupts fold into **one** message via `prefix`; the legacy query bridge is the one 2-message exception — noted.)
- Result: A's row persists; no hanging "which project?".

**Abandoned** — ask a slot, no answer, TTL passes:
- `wa_commit_abandoned_conversations(5)` (cron, 1-min): convo has `staged_entry_id`
  (amount was present) → outbox `"Saved Ramu Rs 5,000 -- project not set, edit anytime"`
  + deep link, convo CLOSED. (If it was `AWAIT_AMOUNT` with no entry → `"Could not log
  that -- no amount"`, ABANDONED, **no row** — gate 1.)

**Cancel** — pending txn, "cancel"/"వద్దు": `isCancel` → `cancelTransaction` →
`discard_rough_entry` (draft → DISMISSED, if one was staged) + "Okay, discarded that.",
no surviving row.

## Transactional-outbox guarantee
Every commit path is one RPC that writes the `rough_entries` row **and** the outbox ack
in a single DB transaction → never an entry without a reply, never a reply without an
entry. Amount-present transactions never silently drop.

## Dispatcher/spine changes to retire the bridge
`_dispatch.ts` rewritten (no `wa_sessions`, no `mirrorTxnState`); dropped the legacy
`handleFinancial`/`handleSessionReply`/`getSession`/`clearSession` imports (those remain
in `_handlers.ts` but are **out of the live path**); kept only the `handleQuery` reporting
bridge. Spine (record-before-ack, `waitUntil`, 200-after-signature, outbox+TTL),
normalization, and the router are untouched.

## Apply / deploy
1. SQL editor: `20260613000014_txn_agent.sql`.
2. Redeploy `whatsapp-webhook`.
3. Re-run `docs/wa_spine_cron.sql` (adds `wa-commit-abandoned`).
4. (Optional) tune `TXN_AUTO_THRESHOLD`/`TXN_CONFIRM_THRESHOLD`.

## Flagged
- Query-interrupt is the one non-consolidated case (legacy `handleQuery` sends directly);
  consolidates when a Reporting agent replaces the bridge.
- Conversation-abandon TTL (5 min) is separate from the 30s job watchdog.

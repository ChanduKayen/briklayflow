# WhatsApp — Capture-First Transaction Redesign (revises Sprint 4–5)

**Philosophy:** whatever the user sends lands in the Day Book. The bot asks for exactly
**two essentials — amount + payee — and only when one is missing.** Those asks capture a
*raw value*; they never match against the DB. Everything else is taken-as-written or left
blank and tidied in the app. All matching/disambiguation moved to the **Day Book** as
one-tap suggestions. Every entry confirms back transparently with an Edit CTA.

Scope: this changes **what the Transaction agent *uses***, not the shared machinery.
`wa_conversations`, staging, lingering reference resolution, interrupt/parking, and the
`list`/`buttons`/`cta` formatter types all stay live for concierge / future agents.

## The two-essential gate (the only questions the agent ever sends — EN)
| Gap | Ask |
| --- | --- |
| amount missing (payee known) | `Paid <payee> — how much?` |
| amount missing (no payee) | `How much?` |
| payee missing (amount known) | `₹<amount> to whom?` |
| payee missing (no amount) | `Who did you pay?` |
| both missing | `Who did you pay, and how much?` |

A captured answer is taken **as-is** — no "did you mean…", no "which project?". The agent
still silently auto-links the answer if it near-exactly matches a registered entity.

## Confirmation (transparent, scannable, real https Edit CTA)
```
Saved ✓
Ramu (new contact) · ₹5,000
Project: The Pride
✏️ Edit in Day Book
```
- payee matched → registered name; unmatched → raw + `(new contact)`
- project matched → `Project: <name>`; heard-but-unmatched → `Understood '<raw>' — not a registered project`; absent → line omitted

## No DB-match question is ever sent to WhatsApp
`transaction.ts` no longer calls `mProjectList` (the "Which project?" LIST) or
`mConfirmPayee` / `mConfirmProject` (mid-confidence confirm BUTTONS). Those functions
remain in `_messages.ts` for other agents. The only pending states the Transaction agent
opens are `AWAIT_AMOUNT`, `AWAIT_PAYEE`, `AWAIT_BOTH`.

## Matching is silent, conservative, lives in the UI
- Auto-link only at near-exact (`TXN_PAYEE_AUTO`, default 0.95; `TXN_PROJECT_AUTO`, 0.82).
- Below that we **take exactly what's written — never substitute** and stash the nearest
  candidate as `ai_extracted.suggested_payee` / `suggested_project` `{id, name, score}`
  (stored in the entry's JSONB — no migration needed). Floor: `TXN_SUGGEST_FLOOR` (0.45).

### Rendered in `Logbook.tsx` (`ReviewCard.tsx`)
- payee near-miss → `Heard Ramu — did you mean **Raju**? [Use Raju] [Keep Ramu] [+ New contact]`
- project heard-but-unmatched → `greenfield — not a registered project [Use <suggestion>] [Pick project]`
- missing essentials stay as the amber `who was paid?` / `how much?` quick-fix chips
- one tap fills the card's draft → File.

## Capture-first / never-lose
The draft is **staged on ask** (capture-first), so an interrupt or the abandoned-sweep
timeout commits it flagged via the existing commit-always path — never blocked, never lost.
Lingering reference resolution ("another 2,000 to him") still resolves the payee from the
last entry silently (a read, not a question).

## `WA_APP_LINK`
The Edit CTA needs a real https URL (WhatsApp rejects `localhost`). `WA_APP_LINK` defaults
to `https://briklay.app/logbook` in both the agent and the staging RPCs — set it
to the production Day Book URL per environment; never localhost.

---

# Patch — Confirm-on-Commit, Explicit-on-Failure

Every entry either confirms **because it committed**, or tells the user **explicitly that it
didn't** — never a false "✓", never silence. Write-failure and delivery-failure are kept
strictly apart.

**Migration `20260614000100_wa_confirm_on_commit.sql` must be applied** (drops/recreates
`stage_entry_v2` with `p_reaction`; adds `wa_failed_writes`; extends `purge_wa_conversations`).

## Commit-gated success (Part 1)
The confirmation **and** the clean-entry ✓ **reaction** are enqueued **inside
`stage_entry_v2`'s transaction**, alongside the `rough_entries` insert — they can only send
if the row committed. The reaction is a new `OutMessage` kind `reaction` (`_format.ts`),
built by the agent and passed as `p_reaction`; it's emitted only for a clean `PENDING` entry.
(`update_entry_v2`, the answer-completion path, already enqueues its confirmation in-tx.)

## Explicit write-failure (Parts 2–3)
`stageV2` returning `null` (RPC error / rolled-back tx) means the entry does **not** exist.
The agent then:
1. persists the parsed values to **`wa_failed_writes`** `{replay_id, org_id, sender, parsed
   jsonb (ext + raw_text + lang), created_at, expires_at}` — RLS-on/no-policies
   (service-role only), 24h TTL, swept by the existing `purge_wa_conversations` cron;
2. sends the **explicit** failure via `send()` (independent of the rolled-back tx):
   `⚠️ I couldn't save this — Kumar · ₹12,000 · ASM Elite / Nothing was recorded…` with reply
   buttons `[Try again]` (id `retry_<replay_id>`) and `[Add in Day Book]`;
3. throws `WriteCommitFailed` → `processJob` marks the job **FAILED + failure_notified** and
   sends **no** generic message.

## Replay (Part 4)
`index.ts` already surfaces `button_reply.id`. `dispatch` intercepts it **before the router**:
`retry_<id>` → look up `wa_failed_writes`, re-run staging with the held `parsed`; success →
normal confirmation/reaction + delete the replay row; re-failure → fresh failure message +
new replay (the throw marks the job FAILED). Expired/missing → "That entry expired — just
send it again." `[Add in Day Book]` → a follow-up Day Book CTA link.

## Write- vs delivery-failure (Part 5)
The failure message is gated **only** on the staging-RPC result. A delivery failure happens
in the drainer *after* a successful commit — the agent never sees it, the entry is in the Day
Book, the outbox retries. By construction, no "not saved" can fire on a delivery failure.

## Watchdog (Part 6 — confirm-on-commit)
Handled write-failures mark the job terminal `FAILED` (the watchdog only acts on
`PROCESSING`), so it's skipped — no double-message. The watchdog remains the catch-all for
jobs that die **before** the handler (crash/isolate-kill), flipping them to FAILED + the
generic message. (Residual: an isolate death in the microsecond window between the explicit
`send()` and `markJob` could let the watchdog also fire — a rare double, never a silence,
squarely in the watchdog's crash-backstop domain.)

---

# Patch — Live copy + Tinglish amount parsing

**Live path (diagnosed Candidate 1):** inbound transactions run the new
`index.ts → _dispatch → _agents/transaction → _messages → send()` path; legacy
`_handlers.ts`/`sendWA` is reached only by the `QUERY_RE` reporting bridge. So the stale copy
was fixed in place in `_messages.ts` — no cutover (Sprint 6 still owns decommissioning legacy).

**Copy:** `mComplete` now reads **"Added to your Day Book"**; the CTA is tailored — matched
payee → **"Review in Day Book"**, new-contact → **"Review & add contact"**. No reaction was
rebuilt; registers/digest/taper were left to the separate build.

**Deterministic amount (`_amount.ts` `parseSpokenAmount`):** code-mixed numeral parser
(Telugu units/tens + Telugu/English multipliers + digits/k-L). Folds tens+units **before** the
multiplier — `muppai aidu vela` = (30+5)×1000 = **35,000** (the bug was the LLM dropping
`muppai`). Integrated in `_extract.ts.reconcileAmount`: when the text has word-numerals the
parser is **authoritative**; the LLM amount is only a reconcile signal. Confidence is **LOW**
(→ `ai.amount_confidence`) when the numeral span has an unrecognized token or the LLM
materially disagrees; a clean digit amount stays **HIGH**. `ReviewCard.tsx` renders a
"₹X — read that right?" flag on LOW (visible, not blocking). The agent's `AWAIT_AMOUNT` answer
path uses the same parser. Hindi (tees/pauntis/hazaar) is a noted fast-follow, not built here.

**Deploy (operational — run by you; the CLI isn't on PATH here, and deploy is outward-facing):**
no new migration this patch (amount_confidence rides in the `ai_extracted` JSONB). Redeploy the
edge function with JWT verification OFF on project `momzyincivvpngazvfgq`:
```
supabase functions deploy whatsapp-webhook --no-verify-jwt --project-ref momzyincivvpngazvfgq
```
(The earlier confirm-on-commit migration `20260614000100_wa_confirm_on_commit.sql` still needs
applying via the SQL editor if not already done.)

---

# Patch — Align router + transaction agent to the ITV → Router → Agent pattern

A surgical alignment pass (Sprint 3 router + Sprint 4 transaction agent), **absorbing** the
standalone amount-understanding work. Conversation-state machinery untouched.

## Router (Part A)
- **`_router.ts` is byte-unchanged** — its conversation-state logic (pending→ANSWERS_PENDING,
  three-tier view, NEW_INTENT/CHITCHAT/AMBIGUOUS, interrupt/parking) is off-limits, and leaving
  it untouched makes the 38-case eval invariant. (The eval — `_router/eval/run.ts` — imports
  `routeMessage` directly; it needs Deno + an API key, neither available in this environment, so
  it was not executed, but the file is unchanged so the result is identical.)
- **`slot_hints`: LEFT.** They're consumed only by `logRouterDecision` → `wa_router_decisions`
  (telemetry); no agent reads them (the transaction agent extracts independently). Removing them
  is a router-prompt/schema change that the guardrail says must be eval-verified, and the eval
  can't be run here — so per "used or uncertain → leave them," they stay. A few extra prompt
  tokens is cheaper than risking the router.

## Registry (Part A3) — `_registry.ts`
The intent→agent binding moved from hardcoded `_dispatch.ts` branches into a registry map:
`AGENTS = { TRANSACTION, CONCIERGE, PROCUREMENT, SITEOPS }`, each an `AgentDef` with
`run` / optional `answer` / optional `commitInterrupted`. `agentFor(intent)` resolves it
(unknown → concierge). PROCUREMENT/SITEOPS are registered but bridge to the concierge until
their agents ship — adding the real agent is a one-line swap in the registry, no dispatcher edit.
The dispatcher now calls `agentFor(...).answer/​commitInterrupted/​run`; **every routing decision
is identical** (ANSWERS_PENDING by stored owning-agent, the interrupt commit, the QUERY_RE
reporting bridge, the concierge fallback) — the registry only resolves *which function runs*.

## Raw ITV passthrough (Part A4 / Part 0)
Confirmed: text → `norm.text` (raw message) and voice → `norm.text` (raw transcript) reach the
agent as the raw artifact. Image stays on its current vision-at-normalize path — the **conscious,
documented deferral** (Part 0); not realigned here.

## Transaction amount understanding (Part B) — in `_extract.ts`
- Extraction now runs at **temperature 0** (OpenAI + Anthropic), with worked spoken/code-mixed
  numeral examples in the prompt (Telugu *and* Hindi `dedh/sava lakh`).
- Structured output adds **`amount_source_phrase`** (the exact span) + **`amount_confidence`**.
- "LLM understands; code decides": `reconcileAmount` runs the deterministic `parseSpokenAmount`
  on the source phrase — when the span is fully recognized or a pure digit, the parser's value is
  authoritative; confidence is LOW on parser/LLM disagreement, model self-low, or an unclean span.
- **One flag path**, keyed to `amount_confidence`: the Day Book card shows
  `read "muppai aidhu velu" as ₹35,000 — right?`. Clean/high → unflagged. The prior patch's
  separate numeral flag is consolidated into this one.
- **Policy stays deterministic** — the two-essential gate, ≥0.95 match-or-keep-raw, new-contact
  flag, stage, commit are all code; no LLM decides policy.

Deterministic tests (Node): the 8 B2 numeral cases + Hindi fractions all pass
(`muppai aidu vela`→35000, `rendu laksha`→200000, `dedh lakh`→150000, `sava lakh`→125000,
`35 vela`→35000, `muppai aidu thousand`→35000, `35k`→35000, `Paid 25000`→25000), and the
reconcile flags low-confidence correctly. No new migration; redeploy as above.

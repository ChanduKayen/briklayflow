# WhatsApp Sprint 5 — Message Craft & Trust (+ Sprint 4.1 fixes)

Branch: `wa/sprint-5-message-craft`

Replaces plain-text "Reply 1-5" lists and raw URLs with tappable, scannable, trust-framed
interactive messages, and fixes the four Sprint-4 gaps. Spine/router/normalization untouched.

## Part A — Sprint 4.1 fixes
- **A1 abandoned was effectively plain/at-risk → now a rich CTA, atomic with the close.**
  `wa_commit_abandoned_conversations` (migration 0015) enqueues a CTA "Saved … not set" +
  [Edit] (or the no-amount failure text) in the **same** statement that closes the convo —
  never silent.
- **A2 payee over-maps → split thresholds.** `_match.ts`: `TXN_PAYEE_AUTO_THRESHOLD=0.95`
  (near-exact for auto) vs `TXN_PROJECT_AUTO_THRESHOLD=0.82`. A fuzzy payee now falls to the
  **confirm band** (reply buttons), so "ramu" is never silently saved as "Raju".
- **A3 no-match payee → keep the raw token.** Agent uses `payeeM.name` only when matched,
  else the raw extracted token; the "someone" placeholder is gone.
- **A4 rapid second transaction → well-formed.** The interrupt path commits A, then runs B
  with A's ack folded into B's body via `applyPrefix`; B's project ask is a proper **LIST**,
  so the malformed "Reply 1-5" fragment can't occur.

## Part B — rich message system
**New `_messages.ts`** — every transaction string, keyed by language (`en`/`te`/`hi`,
driven by the router's `reply_language`). **EN filled; TE/HI are stubs that fall back to EN**
(`pick()`), for Chandu to fill — not auto-generated. Builders return Sprint-2 `OutMessage`s.

| Situation | Type | Builder |
|---|---|---|
| Project selection | **LIST** (rows id = project_id) | `mProjectList` |
| Complete | text + **CTA** [✏️ Edit] | `mComplete` |
| Mid-confidence payee/project | reply **BUTTONS** | `mConfirmPayee` / `mConfirmProject` |
| Interrupted (consolidated) | **LIST**, A-ack in body | `mProjectList` + `applyPrefix` |
| Amount missing | text | `mAmountMissing` |
| Abandoned | text + **CTA** | `mAbandoned` (+ SQL sweep) |
| Cancelled / Failure / Unsupported / Voice-soon / Disambiguate / Not-registered / No-org | text/buttons | `mCancelled` / `mFailureNoAmount` / `mUnsupported` / `mVoiceComingSoon` / `mDisambiguate` / `mNotRegistered` / `mNoOrg` |

Smoke-tested: every builder renders to a valid WA Cloud API body — list rows ≤24 chars (long
names truncated), ≤3 buttons, CTA URLs present, one interactive component per message.

**Atomic rich staging (migration 0015):** `stage_entry_v2` / `update_entry_v2` take the
**pre-rendered jsonb** body and insert `rough_entries` + `outbox` in one transaction. Edit-CTA
links use the placeholder `__ENTRY_LINK__`, which the RPC substitutes with
`<WA_APP_LINK>?entry=<id>` after the insert (the id only exists post-insert). So no raw URLs,
and every committed entry still has its reply in the same tx.

## Interactive id resolution (the "captured but not acted on" gap)
`index.ts` extracts `message.interactive.list_reply.id` / `button_reply.id` into
`ctx.interactiveId` (no normalization change) → threaded through the dispatcher to the agent.
The agent **resolves by id**: project by `project_id` (LIST row), confirm by button id
(`confirm_payee_yes/no`, `confirm_project_yes/no`), with title/number/name fallbacks. Cancel-vs-
answer is owned by the agent (a bare "no" = "someone else" at a confirm prompt, but "discard"
at an amount prompt).

## Trust framing
"Saved ✓" not "Pending"; acknowledge-before-ask; [Edit] always one tap; short/scannable;
typing indicator fires on every inbound (`sendTypingIndicator` in `processJob`, unchanged);
failure copy carries a reason + an example, never a stack trace.

## `WA_APP_LINK` guidance
CTA URL buttons require a real **https** URL. The default is
`https://briklay.app/logbook` (**not localhost**) — set `WA_APP_LINK` to the prod
https domain to override. localhost/http will not render a button.

## Apply / deploy
1. SQL editor: `20260613000015_txn_rich_messages.sql`.
2. Redeploy `whatsapp-webhook`.
3. (Cron `wa_commit_abandoned_conversations` is already scheduled from Sprint 4.)
4. Optional tuning: `TXN_PAYEE_AUTO_THRESHOLD`, `TXN_PROJECT_AUTO_THRESHOLD`, `WA_APP_LINK`.

## Flagged
- TE/HI copy are deliberate stubs (fall back to EN) — Chandu fills.
- Concierge replies are LLM-generated (already language-aware via `reply_language`), not
  template strings; everything else routes through `_messages.ts`.

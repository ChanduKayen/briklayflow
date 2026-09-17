# WhatsApp demo concierge — first-contact "see it work on my site" flow

**Status:** design spec, no code yet. Owner: (tbd). Grounded against the live webhook on 2026-09-17.

## 1. Intent

The landing "See it on my site" button opens `wa.me/917330872705` prefilled with:

> Hi Briklay, I'd like to see it work on my site.

Almost every brand-new inbound number arrives this way. Today it falls through to the generic prospect greet. This spec turns that first message into a **60-second guided demo** that hits the "aha" — *Briklay files your own words into a clean record* — before any signup, then invites them to set up their real site.

Design north star (from research): the first inbound is the highest-intent moment you'll get; spend it delivering value, not collecting a form. Superhuman's guided first-session doubled activation; the equivalent at builder scale is a scripted concierge that *shows, doesn't tell*.

## 2. Current system (do not break)

- `index.ts → recordInbound()` gates known-vs-prospect via `wa_registered_numbers`. Unknown number → `{kind:'prospect'}` (index.ts:269).
- `handleProspect()` (index.ts:343-360): `wa_prospect_touch` RPC (cap **8 replies/number/day**, returns `first_touch, capped`) → `runConcierge(mode:'prospect')`. Stays silent when `capped`.
- Prospects **never reach** `_router.ts` / `_dispatch.ts` / real-org agents — the path is already firewalled.
- Concierge persona **"Babai" (బాబాయ్)** (`_agents/concierge.ts`); prospect first-touch sends a **"Set up my site"** CTA button → `WA_SIGNUP_LINK`.
- `wa_prospects` table: PK `phone_number`, `first_message_text`, `reply_count`, `replies_today`, `nudged_at`, `lead_status` (`new|engaged|converted|ignored`, **manual today**). Migrations `20260618000006` / `...08`.
- Sending: `send()` → durable outbox; free-form (text/buttons/list/cta/flow) is valid **inside the 24h window opened by their inbound**; proactive/out-of-window needs an approved template.
- Guardrail tests: `concierge_invents_nothing` (prompt must never claim data/account or state a number/status), `adoption` (nothing eaten; a bare ack names nothing so moves nothing; questions never write).

## 3. Decisions (locked)

1. **The demo IS the default first-touch prospect experience** — no phrase/keyword matching (respects the "no lexical overrides" doctrine). Nearly all prospects arrive via the landing CTA anyway.
2. **Sandbox echo + a no-auth "view your record" link.** Parse only their typed fields, reply with a filed record, hand them a login-free dashboard link carrying that demo entry. **No DB write, ever.**
3. **Aha first, then invite.**
4. **Re-nudge at the 23rd hour** — still inside the 24h window → **free-form, no template** for v1.
5. **Demo is prospects-only.** A known member who taps the CTA gets a **funny welcome-back** instead (they already have it live).

## 4. The experience

Persona: Babai. Language auto-picked by `guessLang()`; ship EN + Telugu-English for each state.

### State A — Greeting (first-touch prospect, free-form)

**EN**
> 🙏 I'm *Babai* from Briklay. You wanted to see it work on your site — let's do it right now, nothing to install.
> Message me like your supervisor does. Try one:
> • Paid 24,000 to Raju for steel
> • Ravi gang 14, helpers 18 today
> • 1st slab honeycombs — photo pampistha
> Send any one line — I'll file it and show you.

**TE**
> 🙏 నేను Briklay నుంచి *బాబాయ్*. మీ సైట్‌లో ఎలా పని చేస్తుందో ఇప్పుడే చూపిస్తా — ఏ setup అవసరం లేదు.
> మీ supervisor లాగా ఒక message పంపండి:
> • Paid 24,000 to Raju for steel
> • Ravi gang 14, helpers 18 today
> • 1st slab honeycombs — photo pampistha
> ఏదైనా ఒక line పంపండి. నేను file చేసి చూపిస్తా.

### State B — The aha (they send a site line)

The `demo` agent extracts **only the fields present in their message** (kind, amount, payee, category, site, note). Never adds a field they didn't type; if it's too vague, it asks one short question instead of guessing.

**EN (payment example)**
> ✅ Filed to your Books — in 2 seconds, from your words:
> *₹24,000 · Paid to Raju · Steel · pending your approval*
> Nobody typed this into software. 👉 See it on your dashboard: {demo_link}
> _(No login — it's just your demo.)_

Attendance and issue examples mirror the landing demo's attendance grid / issue→follow-up.

### State C — Second trick (optional) → the turn

> That's the whole product — your team texts, Briklay files it: payments, attendance, issues, photos.
> Want it live on your real site from tomorrow morning? Free for 3 months.

**[ Set up my site 👇 ]**  ← existing CTA button → signup

### State D — Convert

Existing "Set up my site" CTA → signup → firm-name prefill (already shipped) into CreateWorkspace. On a completed demo echo, advance `wa_prospects.lead_status: new → engaged`.

## 5. The no-auth demo link

- New **public** route `briklay.app/demo?d=<payload>` — same class as `/privacy` / `/terms`, outside every auth gate.
- `payload` = base64url of `{ v:1, name?, entry:{ kind:'payment'|'attendance'|'issue', amount?, payee?, category?, site?, note? }, ts }`. **Only the words they typed** — no secrets, no IDs, no PII beyond their own input.
- Page renders the landing dashboard visuals with their row filed in — **read-only, client-only, zero DB, zero session**. Watermarked "Demo" so it's never mistaken for a real account.
- **Two hard rules:** the payload is untrusted → escape everything on render (no XSS); carry nothing but their demo entry.

## 6. The 23-hour in-window nudge (template-free)

- A scheduled job (pg_cron) finds prospects whose `last_seen_at` is ≈23h ago, who **engaged** the demo but are **not converted** and **not yet nudged** (`nudged_at` null), and sends **one free-form** message (still inside the 24h window → no template).
- Playful, references their own demo entry:

> Your demo's still open 🙂 You filed *₹24,000 to Raju* — want that happening for real on your site tomorrow? Free for 3 months. **[ Set up my site 👇 ]**

- Stamp `nudged_at`; respect the 8/day cap and per-wamid idempotency; exactly one nudge. **No post-window (>24h) template in v1.**

## 7. Known-member funny welcome-back (prospects-only guard)

A known member (has org) who taps the landing CTA hits the member router → concierge `SYSTEM_DEFAULT` (CHITCHAT). Add a prompt rule: if a **member** asks to "see it work / show the demo," reply with a warm, funny welcome-back that reminds them it's *already* live — never claim any number/data (preserve `concierge_invents_nothing`); point at the app.

> Arre 😄 you already have it running on your site, boss — you're logged in and it's filing itself. Welcome back. Your dashboard: {app_link}

## 8. Integration plan (no code — build map)

| | |
|---|---|
| **Reuse** | `handleProspect`, `wa_prospect_touch` + 8/day cap, `send()` outbox, `kind:'cta'`, `guessLang`, the 24h free-form window, "Set up my site" CTA → signup |
| **New** | concierge `mode:'demo'` + `SYSTEM_DEMO` prompt; a light "is this a site line?" branch inside the prospect path (LLM extraction, not regex); public `/demo` render page; pg_cron 23h-nudge job; `lead_status → engaged` on echo; a `SYSTEM_DEFAULT` rule for the member welcome-back |
| **Untouched** | member router, `_dispatch.ts`, transaction/siteops agents, every existing template |

## 9. Data changes (additive only)

- No new columns strictly required — `wa_prospects.nudged_at` and `lead_status` already exist and cover the nudge + engaged tracking.
- Optional: `wa_prospects.demo_entry JSONB` to persist the last echoed entry for the 23h nudge copy (else re-derive from `last_message_text`).

## 10. Guardrails to preserve

- `SYSTEM_PROSPECT` keeps its literal *"Never claim they have an account or any data."*
- New `SYSTEM_DEMO` floor: reflect **only** the user's typed fields, invent no number/status, frame explicitly as a demo, never claim a real account/data.
- Idempotency (dedup per wamid), always-200-to-Meta, 8/day cap, injection-hardening (their text is untrusted `<user_message>`; the `/demo` payload is untrusted on render).
- **Sandbox is absolute** — a prospect has no org; the demo never writes a real ledger row.

## 11. Suggested build sequence

1. Public `/demo` render page (safe, isolated, demoable on its own).
2. `mode:'demo'` + `SYSTEM_DEMO` + the site-line branch in `handleProspect`; wire the demo link.
3. `lead_status → engaged` on echo.
4. pg_cron 23h in-window nudge.
5. `SYSTEM_DEFAULT` member welcome-back rule.
6. Tests: extend `concierge_invents_nothing` for `SYSTEM_DEMO`; add a demo-journey test (greet → echo grounded in input → link → invite); nudge idempotency.

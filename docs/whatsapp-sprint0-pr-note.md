# Sprint 0 — Secure the WhatsApp webhook

Security-only hardening of the existing `whatsapp-webhook` edge function. No
orchestrator, agents, or schema beyond the dedup gate. The live path was
extended in place — not forked.

## What changed

**T0.2 — Meta webhook signature verification** (`supabase/functions/whatsapp-webhook/index.ts`)
- The POST branch now reads the body **once** via `req.text()` and validates the
  `X-Hub-Signature-256` header (`sha256=<hex>`) as `HMAC-SHA256(rawBody)` keyed by
  the Meta App Secret, computed over the **raw bytes as received** (the same string
  is then `JSON.parse`d — no re-serialization).
- Comparison is **constant-time** (`constantTimeEqual`, no early return).
- **Fails closed**: missing `WA_APP_SECRET`, or a missing/malformed/invalid
  signature → `403`, logged, never processed.
- The GET `hub.challenge` handshake is **unchanged**.

**T0.3 — Idempotency on `wamid`** (`index.ts` + new migration)
- New migration `supabase/migrations/20260613000002_wa_inbound_dedup.sql` adds
  `wa_inbound_dedup(wamid TEXT PRIMARY KEY, received_at TIMESTAMPTZ)`, RLS enabled.
- `processMessage` attempts an insert keyed by `wamid` **before** `logMessage`/
  dispatch. The unique violation (`23505`) **is** the dedup signal → return (already
  acked 200). Other DB errors are logged but don't drop a real message. No
  read-then-write race.
- Migration includes a **commented `pg_cron`** daily purge of rows older than 7 days.

**T0.1 / T0.4 — Secret hygiene & audit**
- No hardcoded tokens or `EAA…` strings anywhere in the repo. All function secrets
  read via `Deno.env.get`.

## New required function secret

| Secret | Where to get it | Notes |
|---|---|---|
| `WA_APP_SECRET` | Meta App → Settings → Basic → **App Secret** | **Distinct** from `WA_ACCESS_TOKEN`. Named with the repo's `WA_` prefix (spec called it `WHATSAPP_APP_SECRET`). If unset, the webhook rejects all POSTs (fail closed). |

Set it before deploy:
```
supabase secrets set WA_APP_SECRET=<meta app secret>
```

## Verification

Signature logic cross-checked against canonical HMAC (Web Crypto hex == `node:crypto`
HMAC hex): valid accepted; tampered body, wrong secret, missing header, and malformed
header all rejected. Manual smoke test against a deployed function:

```sh
URL=https://<project>.functions.supabase.co/whatsapp-webhook
BODY='{"entry":[{"changes":[{"value":{"messages":[{"id":"wamid.TEST","from":"91","type":"text","text":{"body":"hi"}}]}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WA_APP_SECRET" | sed 's/^.* //')

# 1. No signature -> 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL" -H 'content-type: application/json' -d "$BODY"
# 2. Valid signature -> 200 (and processes)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL" -H 'content-type: application/json' -H "x-hub-signature-256: sha256=$SIG" -d "$BODY"
# 3. Replay #2 -> 200, but duplicate wamid is skipped (see logs)
# 4. GET handshake unchanged:
curl -s "$URL?hub.mode=subscribe&hub.verify_token=$WA_VERIFY_TOKEN&hub.challenge=42"   # -> 42
```

## Follow-ups (out of scope for this sprint)

- **Rotate the leaked WhatsApp access token** in the *sibling* Babai project
  (`builder_out.py` — not in this repo). It is compromised; rotate it in that
  project's Meta app.
- **Client-bundle secret leaks (separate, pre-existing — flagged, not fixed here):**
  - `src/lib/supabase-admin.ts:7` ships `VITE_SUPABASE_SERVICE_ROLE_KEY` — the
    **service-role key bypasses RLS** and must never reach the browser.
  - `src/pages/Dashboard.tsx:243` ships `VITE_ANTHROPIC_API_KEY` to the browser.
  Both should move server-side (edge function / RPC) and be rotated.
- Sprint 1's `processing_job` table (also `wamid`-keyed) will subsume the
  `wa_inbound_dedup` gate.

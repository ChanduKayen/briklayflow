# Sprint 0.5 (INCIDENT) — Remove privileged keys from the client & verify RLS

Branch: `security/purge-client-privileged-keys`

Two privileged secrets were reaching the **browser bundle** via `VITE_`-prefixed
env vars. This PR removes them from the client, moves the privileged work into
edge functions that read keys from **function secrets**, and audits RLS on every
table the client touches.

## Key finding that shaped the fix
The browser's main Supabase client (`src/lib/supabase.ts`) **already uses the
publishable/anon key**. The service-role client (`supabase-admin.ts`) was used
**only** for `auth.admin` create/delete user — never for any data query. So no
table read/write secretly depended on service-role; removing it changes only the
two privileged operations below. (The RLS findings are pre-existing, not caused
by this change.)

## What changed

### S0.5-A / B — Purge privileged keys; client uses anon only
- **Deleted** `src/lib/supabase-admin.ts` (the only service-role client).
- `src/App.tsx`: removed the import, the "Missing Admin Key" banner, and the
  `!supabaseAdmin` disabled-states; create/delete user now call the `admin-users`
  edge function via a small `invokeAdminUsers()` helper.
- `src/pages/Dashboard.tsx`: the AI briefing now calls the `ai-briefing` edge
  function instead of `fetch('https://api.anthropic.com', { 'x-api-key': VITE_… })`.
- `.env.local`: removed `VITE_SUPABASE_SERVICE_ROLE_KEY` and the dead
  `VITE_OPENAI_API_KEY` (no longer referenced in `src/`). `.env.example`: added a
  comment banning privileged secrets from the `VITE_` namespace.
- **Verified**: `grep` finds neither key (nor `sb_secret_`/`sk-proj-`/`sk-ant-`/
  `service_role`) in `src/` or in a fresh `dist/` build — only the publishable key.
  `VITE_ANTHROPIC_API_KEY` was never actually set locally; the code path is gone.

### S0.5-D — Privileged work moved server-side
Two new edge functions, both auth-gated (verify caller JWT) and reading keys from
function secrets:
- **`admin-users`** — `auth.admin.createUser` / `deleteUser`. Authorizes the
  caller as an active `principal`/`management` member, enforces one-principal-per-
  org, runs `finalize_new_member`, rolls back the auth user if finalize fails, and
  restricts deletes to the caller's own org (and not self). Service-role key comes
  from the auto-injected `SUPABASE_SERVICE_ROLE_KEY`.
- **`ai-briefing`** — proxies the Anthropic call; key from `ANTHROPIC_API_KEY`.
  Degrades to a static briefing when the key is unset.

### S0.5-C — RLS audit & hardening
Full coverage matrix for all ~25 client-touched tables is in the task notes. All
core/org-scoped tables use the `org_id IN (select get_my_org_ids())` SECURITY
DEFINER pattern and are correct. Migration `20260613000003_rls_hardening.sql`
fixes two clear holes (safe — a correct alternative policy already exists):
- **`sku_alias_family_index`** had **RLS disabled** → open via the anon key. Now
  RLS enabled + authenticated-read (writes only via SECURITY DEFINER funcs/triggers).
- **`wo_milestones`** had permissive `USING (true)` policies (cross-org leak to any
  logged-in user) alongside the correct org-scoped policy. Dropped the permissive
  ones; `org member access` + `Principal full access` remain.

## New server-side secrets required
| Secret | Used by | How |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `admin-users` | Auto-injected by the Supabase runtime — nothing to set. |
| `ANTHROPIC_API_KEY` | `ai-briefing` | `supabase secrets set ANTHROPIC_API_KEY=…` |

Deploy: `supabase functions deploy admin-users && supabase functions deploy ai-briefing`

## ⚠️ Flagged for human decision (NOT changed — risk/ambiguity)
- **`org_invites` `"public read invite by token"` `USING (true)`** exposes every
  pending invite (email, role, **token**, org) to anyone with the anon key — a
  token-harvesting hole. Recommended: restrict SELECT to org admins and serve the
  public accept page via the existing `validate_invite_token()` SECURITY DEFINER
  RPC. Held back because it could break the invite-accept flow if that page does a
  direct token `select` — needs confirmation first.
- **`po_approvals`** is role-based only (no `org_id`) — not org-scoped. Fine for a
  single org; needs a schema decision before multi-org.
- **`documents` storage bucket is public-read** — uploaded bills/invoices are world-
  readable by URL. Pre-existing; consider a private bucket + signed URLs.
- **`organizations` UPDATE** is restricted to `owner_id` only; non-owner management
  can't edit org settings (`Settings.tsx`). Confirm intended.

## 🔑 Rotation required before/at merge (human dashboard action — not done here)
The exposed keys were live in the bundle and must be rotated:
- **Supabase service-role key** (`sb_secret_GDch7xGb6nwCbONb…`) — Supabase dashboard.
- **OpenAI key** (`sk-proj-lq0xeyNQ…`) — OpenAI dashboard.
- No real Anthropic key was found set (the var was never populated), so nothing to
  rotate there.
`.env.local` is gitignored (`*.local`) and not in git history — the leak reached
only the built bundle, not the repo.

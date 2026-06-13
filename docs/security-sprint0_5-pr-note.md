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

## ✅ Follow-up findings — now resolved (P1–P4)
- **P1 — `org_invites` public read (FIXED, `20260613000004`).** Dropped the
  `USING(true)` SELECT policy. Confirmed the public/unauthenticated accept page
  (`InviteAccept.tsx`) and auth resolver read invites only via SECURITY DEFINER
  RPCs; all direct selects are admin-only. Added explicit anon/authenticated
  EXECUTE grants on the accept-flow RPCs.
- **P3 — `po_approvals` org-scoping (FIXED, `20260613000005`).** Decision:
  multi-tenant. Added `org_id` (backfilled from parent PO, NOT NULL, indexed) +
  auto-fill trigger; replaced role-only policies with `org member access`.
- **P2 — `documents` bucket public-read (FIXED, `20260613000006`).** Bucket set
  private + authenticated-read; client serves docs via signed URLs
  (`src/lib/storage.ts`); reconcile flow sends a signed URL.
- **P4 — `organizations` UPDATE owner-only (CONFIRMED, no change).** The only org
  UPDATE is the workspace soft-delete; owner-only is intended.

## ⚠️ Still flagged for Sprint 1 (systemic multi-tenancy)
- **Non-org-aware `current_user_role()` policies + the global `"Principal full
  access"` policy** on `po_line_items`, `po_grn`, the procurement tables
  (`rfqs`/`rfq_items`/`rfq_quotes`/`material_requests`/…), and all core tables are
  the *same* cross-tenant hole P3 fixed on `po_approvals`. A principal/admin of one
  org can reach another org's rows. Needs the same org-scoping pass in Sprint 1.
- **`rough-entry-media` bucket is public-read** (WhatsApp proof images). Left public
  because the AI vision edge functions fetch those URLs directly; privatizing needs
  those functions to download via service-role/signed URLs first.

## 🔑 Rotation required before/at merge (human dashboard action — not done here)
The exposed keys were live in the bundle and must be rotated:
- **Supabase service-role key** (`sb_secret_GDch7xGb6nwCbONb…`) — Supabase dashboard.
- **OpenAI key** (`sk-proj-lq0xeyNQ…`) — OpenAI dashboard.
- No real Anthropic key was found set (the var was never populated), so nothing to
  rotate there.
`.env.local` is gitignored (`*.local`) and not in git history — the leak reached
only the built bundle, not the repo.

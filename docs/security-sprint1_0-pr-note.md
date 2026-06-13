# Sprint 1.0 — Systemic tenant isolation (core-table RLS)

Branch: `security/purge-client-privileged-keys`

Fixes the systemic tenant-isolation hole: the global **"Principal full access"**
policy and other **`current_user_role()`**-based role policies grant access by the
single *global* `user_profiles.role` with **no org check**. Because per-command RLS
policies are **OR-combined**, these overrode the correct `org member access`
(`org_id IN get_my_org_ids()`) policies — a principal/admin of org A could read AND
write org B's rows. (DB holds test data only, so latent, not an active breach.)

Role model confirmed: per-org role lives on `org_memberships(user_id, org_id, role,
status)`. No model change. `current_user_role()` stays for non-policy app logic but is
removed from **policies**.

## Files
- `supabase/migrations/20260613000007_tenant_isolation_core_rls.sql` — the fix.
- `docs/rollback_20260613000007_tenant_isolation.sql` — reversible rollback (⚠ re-opens the hole; manual).
- `docs/verify_tenant_isolation.sql` — T1.0-D harness (run in SQL editor; transactional, self-asserting, ROLLBACKs).

## T1.0-A — org-aware helper
`has_role_in_org(target_org uuid, variadic roles text[]) returns boolean` —
SECURITY DEFINER, STABLE, `SET search_path = public, pg_temp`, reads `org_memberships`
for `auth.uid()` + `target_org` (mirrors `get_my_org_ids()` to avoid RLS recursion).

## Inventory: offending policies (before) → replacement (after)

| Table | Dropped (role-without-org / global principal) | After |
|---|---|---|
| user_profiles | "Management can read all profiles", "Management can manage profiles", "Principal full access" (+ rebuilt self/profile policies) | self read, **org read** (`get_my_org_ids`), self update, **admin manage** (`has_role_in_org(org_id,'principal','management')`) |
| projects | "Management and Accountant can read all projects", "Supervisor can read assigned projects", "Management can insert/update projects", "Principal full access" | `org member access` |
| stakeholders, transactions, txn_allocations, work_orders, wo_milestones, purchase_orders | "Principal full access" | `org member access` |
| project_budgets | "Read budgets", "Management and accountant can upsert budgets", "Principal full access" | `org member access` |
| client_invoices, client_payments | "Client billing access", "Principal full access" | `org member access` (standardized to `get_my_org_ids`) |
| po_line_items | "Management and accountant full access…", "Supervisor select…", "Principal full access" | `org member access` (standardized) + **BEFORE INSERT trigger** to auto-fill `org_id` from parent PO (T1.0-C) |
| cost_codes | "Principal full access" | **authenticated read** (global catalog, no org_id — documented) |

`org member access` = `FOR ALL USING/CHECK (org_id IN (SELECT get_my_org_ids()))`.
Principals/management are members, so they keep full **same-org** CRUD; the regular-
member policy is preserved; **no policy grants cross-org access**. The drop step is a
*programmatic sweep* (any policy referencing `current_user_role` or named "Principal
full access") scoped to the in-scope tables — robust to naming, never touches
out-of-scope tables.

## Already correct — left as-is (verified by harness)
`po_approvals` (Sprint 0.5), `po_grn`, `po_grn_items` (org_id + `org member access`),
and procurement (`material_requests`, `rfqs`, `goods_receipts`, `vendor_invoices`
direct org_id; `mr_items`/`rfq_items`/`rfq_quotes`/`po_items`/`grn_items`/`invoice_items`
scope via parent `EXISTS` with an org check). These use `get_my_org_ids()` +
org-aware `has_role()` — no `current_user_role`, no global principal.

## T1.0-D — coverage matrix (what the harness asserts, per table)
For every core table with a direct `org_id`: relabel 1 row → org B, then —

| Check | Expectation |
|---|---|
| admin A (management) SELECT org-B rows | 0 |
| admin A same-org count | drops by exactly 1 (same-org intact) |
| admin A UPDATE / DELETE org-B rows | 0 rows affected |
| principal B SELECT own org-B row | ≥ 1 |
| dual A+B member SELECT org-B row | ≥ 1 |
| **principal C (third org)** SELECT org-B rows | 0 (proves principal-level cross-org denial) |

(The A-side privileged user is `management`, not `principal`: org A already has a real
principal and `enforce_one_principal` forbids a second. Principal-level cross-org denial
is proven by principal C — and principal B only seeing its own org.)

Tables verified: projects, stakeholders, transactions, txn_allocations, work_orders,
wo_milestones, purchase_orders, project_budgets, client_invoices, client_payments,
po_line_items, po_approvals, po_grn, po_grn_items, user_profiles, material_requests,
rfqs, goods_receipts, vendor_invoices. Parent-scoped children (no org_id) are skipped
with a logged notice (verified transitively via their parent; not modified this sprint).
`cost_codes` separately asserted readable by authenticated. The harness RAISEs on any
leak and prints `TENANT ISOLATION HARNESS PASSED` on success, then ROLLBACKs.

**Run order:** apply `20260613000007…`, then run `verify_tenant_isolation.sql`.

## SECURITY DEFINER RPC write paths
Untouched. `create_purchase_order`, `create_work_order`, `finalize_new_member`,
`accept_invite`, etc. bypass RLS by design and already gate org via
`get_my_org_ids()`/`has_role()`. The new po_line_items trigger only *fills* org_id and
is a no-op when the RPC already sets it.

## Flagged for human judgment (NOT changed — out of scope)
- **`sku_directory`** "Management manage SKUs" uses `current_user_role()` — but it's a
  **global shared catalog** (no org_id), so no cross-tenant row leak. If catalogs ever
  go per-org, this needs org-scoping.
- **`rough_entries`** (WhatsApp staging) uses role-based policies — **WhatsApp scope**,
  excluded per sprint boundary. Revisit when WhatsApp data is tenant-scoped.
- The repo migrations are **not a complete schema**: `transactions`, `stakeholders`,
  `work_orders`, `purchase_orders`, etc. have no `CREATE TABLE` in-repo (created
  directly in the cloud DB). Migrations only add `org_id`/policies. Worth reconciling
  the base schema into version control.

-- ═══════════════════════════════════════════════════════════════════════════
-- Sprint 1.0 — Systemic tenant isolation on core-table RLS
--
-- Problem: the global "Principal full access" policy (current_user_role()='principal')
-- and other current_user_role()-based role policies grant access by GLOBAL role with
-- NO org check. Because RLS policies for a command are OR-combined, these override the
-- correct org-scoped "org member access" policies — a principal/admin of org A could
-- read AND write org B's rows. current_user_role() reads the single global
-- user_profiles.role; the real per-org role lives on org_memberships.
--
-- Fix (this migration): add an org-aware role helper, drop every role-without-org
-- policy on the in-scope core tables, and ensure each ends with an org-scoped policy
-- so NO policy grants access to a row outside the caller's org(s).
--
-- Scope: core financial/tenant tables only. NOT touched: sku_directory (global
-- catalog), rough_entries / wa_* (WhatsApp), storage buckets. Already-clean tables
-- (po_approvals, po_grn, po_grn_items, procurement) are left as-is.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── T1.0-A: org-aware role helper ──────────────────────────────────────────────
-- "Is the caller an active member of THIS org with one of these roles?"
-- SECURITY DEFINER + locked search_path so reading org_memberships does not recurse
-- into org_memberships' own RLS (mirrors get_my_org_ids()).
CREATE OR REPLACE FUNCTION public.has_role_in_org(target_org uuid, VARIADIC roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.user_id = auth.uid()
      AND m.org_id  = target_org
      AND m.status  = 'active'
      AND m.role::text = ANY(roles)
  );
$$;

REVOKE ALL     ON FUNCTION public.has_role_in_org(uuid, text[]) FROM public;
GRANT  EXECUTE ON FUNCTION public.has_role_in_org(uuid, text[]) TO authenticated, anon, service_role;

-- ── T1.0-B (1): scoped sweep — drop every role-without-org policy ───────────────
-- Drops, on the in-scope core tables only, any policy whose USING/CHECK references
-- current_user_role() plus the global "Principal full access" policy. Programmatic
-- so it catches policies regardless of name; scoped so it never touches out-of-scope
-- tables (sku_directory, rough_entries, wa_*, procurement, etc.).
DO $$
DECLARE
  core_tables text[] := ARRAY[
    'user_profiles','projects','stakeholders','transactions','txn_allocations',
    'work_orders','wo_milestones','purchase_orders','project_budgets',
    'client_invoices','client_payments','po_line_items','cost_codes'
  ];
  r record;
BEGIN
  FOR r IN
    SELECT p.tablename, p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = ANY(core_tables)
      AND ( COALESCE(p.qual, '')       ILIKE '%current_user_role%'
         OR COALESCE(p.with_check, '') ILIKE '%current_user_role%'
         OR p.policyname = 'Principal full access' )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    RAISE NOTICE 'Dropped offending policy "%" on %', r.policyname, r.tablename;
  END LOOP;
END $$;

-- ── T1.0-B (2): re-assert one clean org-scoped policy per org table ─────────────
-- Principals/management are org_memberships members too, so "org member access"
-- (FOR ALL within their org set) already grants them full SAME-org CRUD. This is the
-- existing, correct regular-member policy — re-created uniformly with get_my_org_ids()
-- (standardizing the few that used a raw org_memberships subquery). No cross-org grant.
DO $$
DECLARE
  t text;
  org_tables text[] := ARRAY[
    'projects','stakeholders','transactions','txn_allocations','work_orders',
    'wo_milestones','purchase_orders','project_budgets','client_invoices',
    'client_payments','po_line_items'
  ];
BEGIN
  FOREACH t IN ARRAY org_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "org member access" ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY "org member access" ON public.%I
        FOR ALL
        USING      (org_id IN (SELECT public.get_my_org_ids()))
        WITH CHECK (org_id IN (SELECT public.get_my_org_ids()))
    $f$, t);
    RAISE NOTICE 'Re-asserted org member access on %', t;
  END LOOP;
END $$;

-- ── T1.0-B (3): user_profiles — org-scoped, self-aware ─────────────────────────
-- Rebuilt explicitly: self can always read/update own profile (needed pre-membership
-- during onboarding); members can read profiles in their org(s) (team lists); org
-- admins manage profiles in their org via the new org-aware helper. No global role.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "profile self access"        ON public.user_profiles;

CREATE POLICY "user_profiles self read" ON public.user_profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "user_profiles org read" ON public.user_profiles
  FOR SELECT USING (org_id IN (SELECT public.get_my_org_ids()));

CREATE POLICY "user_profiles self update" ON public.user_profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "user_profiles admin manage" ON public.user_profiles
  FOR ALL
  USING      (public.has_role_in_org(org_id, 'principal', 'management'))
  WITH CHECK (public.has_role_in_org(org_id, 'principal', 'management'));

-- ── T1.0-B (4): cost_codes — global catalog, not tenant data ───────────────────
-- cost_codes has no org_id (a shared, seed-loaded taxonomy identical for every org).
-- The dropped "Principal full access" wrongly restricted the shared catalog to
-- principals. Replace with authenticated read; writes happen only via migrations/seed.
ALTER TABLE public.cost_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cost_codes authenticated read" ON public.cost_codes;
CREATE POLICY "cost_codes authenticated read" ON public.cost_codes
  FOR SELECT TO authenticated USING (true);

-- ── T1.0-C: po_line_items — auto-fill org_id from parent PO ─────────────────────
-- org_id already exists (backfilled, NOT NULL, indexed). Add a BEFORE INSERT trigger
-- so direct/RPC inserts that omit org_id still get it from the parent PO — consistent
-- with the po_approvals fix.
CREATE OR REPLACE FUNCTION public.po_line_items_set_org_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT po.org_id INTO NEW.org_id
    FROM public.purchase_orders po
    WHERE po.po_id = NEW.po_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS po_line_items_set_org_id ON public.po_line_items;
CREATE TRIGGER po_line_items_set_org_id
  BEFORE INSERT ON public.po_line_items
  FOR EACH ROW EXECUTE FUNCTION public.po_line_items_set_org_id();

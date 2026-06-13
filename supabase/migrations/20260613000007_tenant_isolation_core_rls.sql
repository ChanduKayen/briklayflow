-- ===========================================================================
-- Sprint 1.0 - Systemic tenant isolation on core-table RLS
--
-- Problem: the global "Principal full access" policy (current_user_role()='principal')
-- and other current_user_role()-based role policies grant access by GLOBAL role with
-- NO org check. Because RLS policies for a command are OR-combined, these override the
-- correct org-scoped "org member access" policies - a principal/admin of org A could
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
-- ===========================================================================

-- -- T1.0-A: org-aware role helper ----------------------------------------------
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

-- -- T1.0-B (1+2): org tables - DROP EVERY existing policy, then create exactly one
-- org-scoped "org member access" policy.
--
-- Drop-ALL (not a targeted sweep): because migrations have been applied unevenly to
-- this DB, leftover permissive policies survive that a name/current_user_role-based
-- sweep would miss - e.g. wo_milestones still carried "Authenticated users can view"
-- with USING(true) (the Sprint 0.5 hardening was never applied here). RLS policies
-- are OR-combined, so ONE such policy defeats isolation. Dropping everything and
-- recreating the single correct policy is the only drift-proof guarantee.
--
-- Safe: "org member access" (FOR ALL within the caller's org set) is the maximal
-- SAME-org grant - every active member (incl. principal/management) keeps full CRUD
-- in their org. It can only remove cross-org leaks, never break same-org access.
-- (SECURITY DEFINER RPCs / service role bypass RLS and are unaffected.)
DO $$
DECLARE
  t text;
  pol record;
  org_tables text[] := ARRAY[
    'projects','stakeholders','transactions','txn_allocations','work_orders',
    'wo_milestones','purchase_orders','project_budgets','client_invoices',
    'client_payments','po_line_items'
  ];
BEGIN
  FOREACH t IN ARRAY org_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skip % (table absent in this DB)', t;
      CONTINUE;
    END IF;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
      RAISE NOTICE 'dropped policy "%" on %', pol.policyname, t;
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY "org member access" ON public.%I
        FOR ALL
        USING      (org_id IN (SELECT public.get_my_org_ids()))
        WITH CHECK (org_id IN (SELECT public.get_my_org_ids()))
    $f$, t);
    RAISE NOTICE 'org member access set on %', t;
  END LOOP;
END $$;

-- -- T1.0-B (3): user_profiles - org-scoped, self-aware -------------------------
-- Rebuilt explicitly: self can always read/update own profile (needed pre-membership
-- during onboarding); members can read profiles in their org(s) (team lists); org
-- admins manage profiles in their org via the new org-aware helper. No global role.
DO $$
DECLARE pol record;
BEGIN
  IF to_regclass('public.user_profiles') IS NULL THEN
    RAISE NOTICE 'skip user_profiles (table absent in this DB)';
    RETURN;
  END IF;

  ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_profiles' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_profiles', pol.policyname);
    RAISE NOTICE 'dropped policy "%" on user_profiles', pol.policyname;
  END LOOP;

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
END $$;

-- -- T1.0-B (4): cost_codes - global catalog, not tenant data -------------------
-- cost_codes has no org_id (a shared, seed-loaded taxonomy identical for every org).
-- The dropped "Principal full access" wrongly restricted the shared catalog to
-- principals. Replace with authenticated read; writes happen only via migrations/seed.
DO $$
DECLARE pol record;
BEGIN
  IF to_regclass('public.cost_codes') IS NULL THEN
    RAISE NOTICE 'skip cost_codes (table absent in this DB)';
    RETURN;
  END IF;
  ALTER TABLE public.cost_codes ENABLE ROW LEVEL SECURITY;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='cost_codes' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.cost_codes', pol.policyname);
    RAISE NOTICE 'dropped policy "%" on cost_codes', pol.policyname;
  END LOOP;
  CREATE POLICY "cost_codes authenticated read" ON public.cost_codes
    FOR SELECT TO authenticated USING (true);
END $$;

-- -- T1.0-C: po_line_items - auto-fill org_id from parent PO ---------------------
-- org_id already exists (backfilled, NOT NULL, indexed). Add a BEFORE INSERT trigger
-- so direct/RPC inserts that omit org_id still get it from the parent PO - consistent
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

DO $$
BEGIN
  IF to_regclass('public.po_line_items') IS NULL THEN
    RAISE NOTICE 'skip po_line_items trigger (table absent in this DB)';
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS po_line_items_set_org_id ON public.po_line_items;
  CREATE TRIGGER po_line_items_set_org_id
    BEFORE INSERT ON public.po_line_items
    FOR EACH ROW EXECUTE FUNCTION public.po_line_items_set_org_id();
END $$;

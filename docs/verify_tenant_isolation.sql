-- ===========================================================================
-- T1.0-D - Tenant isolation verification harness
--
-- Proves cross-org isolation on every core table that has a direct org_id, using
-- ONLY the org_id column (schema-agnostic - the core tables' full schemas don't
-- live in the repo). Strategy: take the existing test data (all in the one active
-- org = "A"), temporarily relabel ONE row per table into a synthetic org "B", then
-- assert, simulating each user via JWT claims:
--   * principal A: sees 0 of B's rows, and cannot UPDATE/DELETE them; same-org count
--     drops by exactly 1 (same-org access intact);
--   * principal B and a dual-A+B member: DO see B's row;
--   * principal C (third org): sees 0.
--
-- Runs in ONE transaction and ROLLBACKs at the end - no test data persists.
-- A failed assertion RAISEs (aborting the tx). Success prints a PASSED notice.
--
-- Run in the Supabase SQL editor. Requires the role to switch into 'authenticated'
-- (the SQL editor's postgres role can). Read the Messages/Notices for results.
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  a_org uuid; b_org uuid; c_org uuid;
  u_pa  uuid := gen_random_uuid();  -- privileged member (management) of A
                                    -- (A already has a real principal; enforce_one_principal
                                    --  forbids a second. Principal-level cross-org denial is
                                    --  still proven via principals B and C below.)
  u_ma  uuid := gen_random_uuid();  -- supervisor (regular member) of A
  u_pb  uuid := gen_random_uuid();  -- principal of B
  u_dab uuid := gen_random_uuid();  -- member of BOTH A and B
  u_pc  uuid := gen_random_uuid();  -- principal of C (third org)
  tbl text;
  core_tables text[] := ARRAY[
    'projects','stakeholders','transactions','txn_allocations','work_orders',
    'wo_milestones','purchase_orders','project_budgets','client_invoices',
    'client_payments','po_line_items','po_approvals','po_grn','po_grn_items',
    'user_profiles','material_requests','rfqs','goods_receipts','vendor_invoices',
    -- parent-scoped children (no direct org_id) - auto-skipped, listed for the record:
    'mr_items','rfq_items','rfq_quotes','po_items','grn_items','invoice_items'
  ];
  total int; a_before int; a_after int; a_sees_b int; a_upd int; a_del int;
  b_sees int; dab_sees int; c_sees int;
  tested int := 0; skipped int := 0; has_orgid boolean;
BEGIN
  SELECT org_id INTO a_org FROM public.organizations WHERE status='active' ORDER BY created_at LIMIT 1;
  IF a_org IS NULL THEN RAISE EXCEPTION 'No active org to use as org A'; END IF;

  -- Synthetic auth users (org_memberships.user_id FKs auth.users)
  INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES
   ('00000000-0000-0000-0000-000000000000', u_pa,  'authenticated','authenticated','iso_pa@test.local',  now(),now(),'{}','{}'),
   ('00000000-0000-0000-0000-000000000000', u_ma,  'authenticated','authenticated','iso_ma@test.local',  now(),now(),'{}','{}'),
   ('00000000-0000-0000-0000-000000000000', u_pb,  'authenticated','authenticated','iso_pb@test.local',  now(),now(),'{}','{}'),
   ('00000000-0000-0000-0000-000000000000', u_dab, 'authenticated','authenticated','iso_dab@test.local', now(),now(),'{}','{}'),
   ('00000000-0000-0000-0000-000000000000', u_pc,  'authenticated','authenticated','iso_pc@test.local',  now(),now(),'{}','{}');

  INSERT INTO public.organizations (name, slug, owner_id, status)
  VALUES ('ISO Test B','iso-test-b-'||substr(u_pb::text,1,8), u_pb, 'active') RETURNING org_id INTO b_org;
  INSERT INTO public.organizations (name, slug, owner_id, status)
  VALUES ('ISO Test C','iso-test-c-'||substr(u_pc::text,1,8), u_pc, 'active') RETURNING org_id INTO c_org;

  INSERT INTO public.org_memberships (org_id, user_id, role, status) VALUES
   (a_org, u_pa,  'management', 'active'),
   (a_org, u_ma,  'supervisor', 'active'),
   (b_org, u_pb,  'principal',  'active'),
   (a_org, u_dab, 'management', 'active'),
   (b_org, u_dab, 'management', 'active'),
   (c_org, u_pc,  'principal',  'active')
  ON CONFLICT (user_id, org_id) DO NOTHING;

  FOREACH tbl IN ARRAY core_tables LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=tbl AND column_name='org_id')
      INTO has_orgid;
    IF NOT has_orgid THEN skipped:=skipped+1; RAISE NOTICE 'SKIP %  (no direct org_id - parent-scoped or absent)', tbl; CONTINUE; END IF;

    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id=$1', tbl) INTO total USING a_org;
    IF total = 0 THEN skipped:=skipped+1; RAISE NOTICE 'SKIP %  (no org-A rows to relabel)', tbl; CONTINUE; END IF;

    -- baseline as principal A
    PERFORM set_config('request.jwt.claims', json_build_object('sub',u_pa::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO a_before;
    RESET ROLE;

    -- relabel one org-A row to org B (owner role bypasses RLS)
    EXECUTE format('UPDATE public.%I SET org_id=$1 WHERE ctid=(SELECT ctid FROM public.%I WHERE org_id=$2 LIMIT 1)', tbl, tbl)
      USING b_org, a_org;

    -- principal A: read + write must be denied on org B
    PERFORM set_config('request.jwt.claims', json_build_object('sub',u_pa::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id=$1', tbl) INTO a_sees_b USING b_org;
    EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO a_after;
    EXECUTE format('WITH x AS (UPDATE public.%I SET org_id=org_id WHERE org_id=$1 RETURNING 1) SELECT count(*) FROM x', tbl) INTO a_upd USING b_org;
    EXECUTE format('WITH x AS (DELETE FROM public.%I WHERE org_id=$1 RETURNING 1) SELECT count(*) FROM x', tbl) INTO a_del USING b_org;
    RESET ROLE;

    IF a_sees_b <> 0 THEN RAISE EXCEPTION 'READ LEAK: principal A sees % org-B row(s) in %', a_sees_b, tbl; END IF;
    IF a_after  <> a_before-1 THEN RAISE EXCEPTION 'SAME-ORG REGRESSION in %: A sees % (expected %)', tbl, a_after, a_before-1; END IF;
    IF a_upd <> 0 THEN RAISE EXCEPTION 'WRITE LEAK (UPDATE): principal A wrote % org-B row(s) in %', a_upd, tbl; END IF;
    IF a_del <> 0 THEN RAISE EXCEPTION 'WRITE LEAK (DELETE): principal A deleted % org-B row(s) in %', a_del, tbl; END IF;

    -- principal B sees own row
    PERFORM set_config('request.jwt.claims', json_build_object('sub',u_pb::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id=$1', tbl) INTO b_sees USING b_org;
    RESET ROLE;
    IF b_sees < 1 THEN RAISE EXCEPTION 'principal B cannot see own org-B row in %', tbl; END IF;

    -- dual A+B member sees B's row
    PERFORM set_config('request.jwt.claims', json_build_object('sub',u_dab::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id=$1', tbl) INTO dab_sees USING b_org;
    RESET ROLE;
    IF dab_sees < 1 THEN RAISE EXCEPTION 'dual A+B member cannot see org-B row in %', tbl; END IF;

    -- principal C (third org) sees nothing of B
    PERFORM set_config('request.jwt.claims', json_build_object('sub',u_pc::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id=$1', tbl) INTO c_sees USING b_org;
    RESET ROLE;
    IF c_sees <> 0 THEN RAISE EXCEPTION 'CROSS-ORG LEAK: principal C sees % org-B row(s) in %', c_sees, tbl; END IF;

    tested := tested+1;
    RAISE NOTICE 'OK   %  (A: %->%, B:%, dualAB:%, C:0)', tbl, a_before, a_after, b_sees, dab_sees;
  END LOOP;

  -- cost_codes: global catalog must be readable by any authenticated user
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_pc::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE 'SELECT count(*) FROM public.cost_codes' INTO total;
  RESET ROLE;

  RAISE NOTICE '----------------------------------------------------------';
  RAISE NOTICE 'TENANT ISOLATION HARNESS PASSED - % table(s) verified, % skipped.', tested, skipped;
  RAISE NOTICE 'cost_codes rows visible to authenticated: %', total;
  IF total = 0 THEN RAISE WARNING 'cost_codes empty or unreadable to authenticated - check catalog/policy'; END IF;
END $$;

ROLLBACK;

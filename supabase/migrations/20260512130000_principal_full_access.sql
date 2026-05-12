-- ═══════════════════════════════════════════════════════════════════════════
-- PRINCIPAL — FULL PLATFORM ACCESS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Principal is the owner/client. They have unrestricted SELECT, INSERT,
-- UPDATE, and DELETE on every table in this platform.
--
-- Strategy:
--   • One additive "Principal full access" FOR ALL policy per table.
--   • Existing policies for management / accountant / supervisor are
--     left completely untouched.
--   • Safe to re-run at any time: drops and recreates each policy so the
--     file is idempotent even if partially applied before.
--   • Tables that don't exist yet are silently skipped (no-op) so this
--     migration is order-independent relative to table-creation migrations.
--
-- Tables covered (all 12 in this project):
--   user_profiles, projects, stakeholders,
--   transactions, txn_allocations,
--   work_orders, wo_milestones,
--   purchase_orders, cost_codes,
--   project_budgets,
--   client_invoices, client_payments
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl  text;
  tbls text[] := ARRAY[
    -- ── Core ──────────────────────────────────────────────────────────────
    'user_profiles',
    'projects',
    'stakeholders',
    -- ── Transactions & Ledger ─────────────────────────────────────────────
    'transactions',
    'txn_allocations',
    -- ── Work Orders & Purchase Orders ─────────────────────────────────────
    'work_orders',
    'wo_milestones',
    'purchase_orders',
    -- ── Budgets & Cost Codes ──────────────────────────────────────────────
    'cost_codes',
    'project_budgets',
    -- ── Client Billing ────────────────────────────────────────────────────
    'client_invoices',
    'client_payments'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP

    -- Skip tables that haven't been created yet
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = tbl
    ) THEN
      RAISE NOTICE 'Table %.% does not exist yet — skipping.', 'public', tbl;
      CONTINUE;
    END IF;

    -- Ensure RLS is enabled (defensive — should already be set)
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    -- Drop the previous version of this policy if it exists
    EXECUTE format(
      'DROP POLICY IF EXISTS "Principal full access" ON public.%I', tbl
    );

    -- Create the bypass policy for principal
    EXECUTE format(
      $policy$
        CREATE POLICY "Principal full access"
          ON public.%I
          FOR ALL
          USING  (public.current_user_role() = 'principal')
          WITH CHECK (public.current_user_role() = 'principal')
      $policy$,
      tbl
    );

    RAISE NOTICE 'Principal full access policy applied to public.%.', tbl;

  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260613000007_tenant_isolation_core_rls.sql
--
-- ⚠️  WARNING: running this RE-OPENS the systemic tenant-isolation hole (global
--     "Principal full access" / current_user_role() policies). Only use to revert.
--     Run manually in the SQL editor; it is intentionally NOT in supabase/migrations.
-- ═══════════════════════════════════════════════════════════════════════════

-- Undo T1.0-C trigger + helper
DROP TRIGGER  IF EXISTS po_line_items_set_org_id ON public.po_line_items;
DROP FUNCTION IF EXISTS public.po_line_items_set_org_id();

-- Undo T1.0-B (3) user_profiles policies, restore prior set
DROP POLICY IF EXISTS "user_profiles self read"    ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles org read"     ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles self update"  ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles admin manage" ON public.user_profiles;
CREATE POLICY "Users can read own profile"   ON public.user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Management can read all profiles" ON public.user_profiles FOR SELECT USING (public.current_user_role() = 'management');
CREATE POLICY "Management can manage profiles"   ON public.user_profiles FOR ALL    USING (public.current_user_role() = 'management');

-- Undo T1.0-B (4) cost_codes
DROP POLICY IF EXISTS "cost_codes authenticated read" ON public.cost_codes;

-- Restore the prior role-without-org policies (THE HOLE)
-- projects
CREATE POLICY "Management and Accountant can read all projects" ON public.projects FOR SELECT USING (public.current_user_role() IN ('management','accountant'));
CREATE POLICY "Supervisor can read assigned projects" ON public.projects FOR SELECT USING (public.current_user_role() = 'supervisor' AND project_id = ANY(public.current_user_assigned_projects()));
CREATE POLICY "Management can insert projects" ON public.projects FOR INSERT WITH CHECK (public.current_user_role() = 'management');
CREATE POLICY "Management can update projects" ON public.projects FOR UPDATE USING (public.current_user_role() = 'management');
-- project_budgets
CREATE POLICY "Read budgets" ON public.project_budgets FOR SELECT USING (public.current_user_role() IN ('management','accountant','supervisor'));
CREATE POLICY "Management and accountant can upsert budgets" ON public.project_budgets FOR ALL USING (public.current_user_role() IN ('management','accountant')) WITH CHECK (public.current_user_role() IN ('management','accountant'));
-- client billing
CREATE POLICY "Client billing access" ON public.client_invoices FOR ALL USING (public.current_user_role() IN ('principal','management','accountant')) WITH CHECK (public.current_user_role() IN ('principal','management','accountant'));
CREATE POLICY "Client billing access" ON public.client_payments FOR ALL USING (public.current_user_role() IN ('principal','management','accountant')) WITH CHECK (public.current_user_role() IN ('principal','management','accountant'));
-- po_line_items
CREATE POLICY "Management and accountant full access on po_line_items" ON public.po_line_items FOR ALL USING (public.current_user_role() IN ('management','accountant')) WITH CHECK (public.current_user_role() IN ('management','accountant'));
CREATE POLICY "Supervisor select on po_line_items" ON public.po_line_items FOR SELECT USING (public.current_user_role() = 'supervisor' AND po_id IN (SELECT po.po_id FROM public.purchase_orders po WHERE po.project_id IN (SELECT unnest(up.assigned_projects) FROM public.user_profiles up WHERE up.id = auth.uid())));

-- Restore global "Principal full access" on the 12 + po_line_items tables
DO $$
DECLARE t text; tbls text[] := ARRAY[
  'user_profiles','projects','stakeholders','transactions','txn_allocations',
  'work_orders','wo_milestones','purchase_orders','cost_codes','project_budgets',
  'client_invoices','client_payments','po_line_items'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Principal full access" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Principal full access" ON public.%I FOR ALL USING (public.current_user_role() = ''principal'') WITH CHECK (public.current_user_role() = ''principal'')', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.has_role_in_org(uuid, text[]);

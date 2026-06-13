-- ── P3: org-scope po_approvals (multi-tenant) ────────────────────────────────
-- po_approvals had only role-based policies (current_user_role() in
-- management/accountant/supervisor/principal) with NO org_id — so any admin (or
-- principal) of ANY org could read another org's PO approval history. Harmless
-- with one org, a cross-tenant hole the moment a second org exists.
--
-- Fix: add org_id (derived from the parent PO), backfill, enforce NOT NULL, and
-- replace the role-only policies with the same org-scoped "org member access"
-- policy the other core/PO tables use (org_id IN get_my_org_ids()). Writes happen
-- via SECURITY DEFINER RPCs (which bypass RLS); a BEFORE INSERT trigger fills
-- org_id from the parent PO so callers never need to supply it.
--
-- NOTE (systemic — flagged for Sprint 1, NOT fixed here): the same
-- current_user_role()-based policies on po_line_items, po_grn, the procurement
-- tables (rfqs/rfq_items/rfq_quotes/material_requests/…), and especially the
-- global "Principal full access" policy applied to all core tables are ALSO
-- non-org-aware and become cross-tenant holes under multi-tenancy. They need the
-- same org-scoping pass.

-- ── 1. Add org_id (nullable first) ────────────────────────────────────────────
ALTER TABLE public.po_approvals
  ADD COLUMN IF NOT EXISTS org_id uuid
  REFERENCES public.organizations(org_id) ON DELETE RESTRICT;

-- ── 2. Backfill from the parent purchase order ────────────────────────────────
UPDATE public.po_approvals a
SET org_id = po.org_id
FROM public.purchase_orders po
WHERE po.po_id = a.po_id
  AND a.org_id IS NULL;

-- ── 3. Enforce NOT NULL (guard first) ─────────────────────────────────────────
DO $$
DECLARE v_null int;
BEGIN
  SELECT count(*) INTO v_null FROM public.po_approvals WHERE org_id IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'po_approvals: % row(s) still have null org_id after backfill', v_null;
  END IF;
  ALTER TABLE public.po_approvals ALTER COLUMN org_id SET NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_po_approvals_org_id ON public.po_approvals(org_id);

-- ── 4. Auto-fill org_id on insert from the parent PO ──────────────────────────
CREATE OR REPLACE FUNCTION public.po_approvals_set_org_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT po.org_id INTO NEW.org_id
    FROM public.purchase_orders po
    WHERE po.po_id = NEW.po_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS po_approvals_set_org_id ON public.po_approvals;
CREATE TRIGGER po_approvals_set_org_id
  BEFORE INSERT ON public.po_approvals
  FOR EACH ROW EXECUTE FUNCTION public.po_approvals_set_org_id();

-- ── 5. Replace role-only policies with org-scoped access ──────────────────────
DROP POLICY IF EXISTS "Management and accountant full access on po_approvals" ON public.po_approvals;
DROP POLICY IF EXISTS "Supervisor select on po_approvals"                      ON public.po_approvals;
DROP POLICY IF EXISTS "Principal full access"                                  ON public.po_approvals;

DROP POLICY IF EXISTS "org member access" ON public.po_approvals;
CREATE POLICY "org member access"
  ON public.po_approvals
  FOR ALL
  USING      (org_id IN (select public.get_my_org_ids()))
  WITH CHECK (org_id IN (select public.get_my_org_ids()));

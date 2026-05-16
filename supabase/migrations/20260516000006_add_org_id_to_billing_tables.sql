-- Add org_id to billing tables that were missed in T-04.
-- Tables: client_invoices, client_payments, po_line_items

-- ── PHASE 1: add nullable org_id ─────────────────────────────────

ALTER TABLE public.client_invoices
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(org_id) ON DELETE RESTRICT;

ALTER TABLE public.client_payments
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(org_id) ON DELETE RESTRICT;

ALTER TABLE public.po_line_items
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(org_id) ON DELETE RESTRICT;

-- ── PHASE 2: backfill ─────────────────────────────────────────────

-- client_invoices → derive via projects
UPDATE public.client_invoices ci
SET org_id = p.org_id
FROM public.projects p
WHERE ci.project_id = p.project_id
  AND ci.org_id IS NULL;

-- client_invoices with no project → use the one active org
UPDATE public.client_invoices ci
SET org_id = (SELECT org_id FROM public.organizations WHERE status = 'active' LIMIT 1)
WHERE ci.org_id IS NULL;

-- client_payments → derive via client_invoices
UPDATE public.client_payments cp
SET org_id = ci.org_id
FROM public.client_invoices ci
WHERE cp.invoice_id = ci.invoice_id
  AND cp.org_id IS NULL;

-- po_line_items → derive via purchase_orders
UPDATE public.po_line_items pl
SET org_id = po.org_id
FROM public.purchase_orders po
WHERE pl.po_id = po.po_id
  AND pl.org_id IS NULL;

-- ── PHASE 3: NOT NULL + index ─────────────────────────────────────

ALTER TABLE public.client_invoices  ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.client_payments  ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.po_line_items    ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_invoices_org_id ON public.client_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_client_payments_org_id ON public.client_payments(org_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_org_id   ON public.po_line_items(org_id);

-- ── PHASE 4: RLS ──────────────────────────────────────────────────

ALTER TABLE public.client_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_line_items   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org member access" ON public.client_invoices;
CREATE POLICY "org member access" ON public.client_invoices
  FOR ALL
  USING  (org_id IN (SELECT m.org_id FROM public.org_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active'))
  WITH CHECK (org_id IN (SELECT m.org_id FROM public.org_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active'));

DROP POLICY IF EXISTS "org member access" ON public.client_payments;
CREATE POLICY "org member access" ON public.client_payments
  FOR ALL
  USING  (org_id IN (SELECT m.org_id FROM public.org_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active'))
  WITH CHECK (org_id IN (SELECT m.org_id FROM public.org_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active'));

DROP POLICY IF EXISTS "org member access" ON public.po_line_items;
CREATE POLICY "org member access" ON public.po_line_items
  FOR ALL
  USING  (org_id IN (SELECT m.org_id FROM public.org_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active'))
  WITH CHECK (org_id IN (SELECT m.org_id FROM public.org_memberships m WHERE m.user_id = auth.uid() AND m.status = 'active'));

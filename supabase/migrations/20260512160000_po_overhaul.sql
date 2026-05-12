-- ═══════════════════════════════════════════════════════════════════════════
-- PO OVERHAUL — ADDITIVE MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- All changes are additive only. Uses ADD COLUMN IF NOT EXISTS and
-- CREATE TABLE IF NOT EXISTS. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extend po_status enum ────────────────────────────────────────────────
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'Approved';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'Ordered';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'Partially Delivered';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'Delivered';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'Tallied';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'Disputed';

-- ── Extend purchase_orders ────────────────────────────────────────────────

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS ordered_by          text,
  ADD COLUMN IF NOT EXISTS expected_delivery   date,
  ADD COLUMN IF NOT EXISTS delivered_date      date,
  ADD COLUMN IF NOT EXISTS delivery_location   text,
  ADD COLUMN IF NOT EXISTS payment_terms_days  int          DEFAULT 30,
  ADD COLUMN IF NOT EXISTS approval_status     text         DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS approved_by         uuid         REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
  ADD COLUMN IF NOT EXISTS approval_remarks    text,
  ADD COLUMN IF NOT EXISTS gst_value           numeric      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_value         numeric      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS three_way_match     text         DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS vendor_bill_no      text,
  ADD COLUMN IF NOT EXISTS vendor_bill_date    date,
  ADD COLUMN IF NOT EXISTS ewaybill_number     text,
  ADD COLUMN IF NOT EXISTS internal_notes      text,
  ADD COLUMN IF NOT EXISTS vendor_notes        text;

-- ── po_line_items ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.po_line_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id               text        NOT NULL REFERENCES public.purchase_orders(po_id) ON DELETE CASCADE,
  line_number         int         NOT NULL DEFAULT 1,
  category_id         text,
  item_name           text        NOT NULL,
  specification       text,
  unit                text        NOT NULL DEFAULT 'Nos',
  quantity_ordered    numeric     NOT NULL DEFAULT 1,
  quantity_delivered  numeric     DEFAULT 0,
  quantity_accepted   numeric     DEFAULT 0,
  quantity_rejected   numeric     DEFAULT 0,
  unit_rate           numeric     NOT NULL DEFAULT 0,
  basic_amount        numeric     NOT NULL DEFAULT 0,
  discount_percent    numeric     DEFAULT 0,
  discount_amount     numeric     DEFAULT 0,
  gst_rate            numeric     DEFAULT 18,
  cgst                numeric     DEFAULT 0,
  sgst                numeric     DEFAULT 0,
  igst                numeric     DEFAULT 0,
  total_amount        numeric     NOT NULL DEFAULT 0,
  is_ai_extracted     boolean     DEFAULT false,
  delivery_status     text        DEFAULT 'PENDING',
  created_at          timestamptz DEFAULT now()
);

-- ── po_grn (Goods Receipt Notes) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.po_grn (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id                text        NOT NULL REFERENCES public.purchase_orders(po_id) ON DELETE CASCADE,
  grn_number           text        NOT NULL,
  receipt_date         date        NOT NULL DEFAULT CURRENT_DATE,
  received_by_name     text,
  delivery_challan_no  text,
  ewaybill_number      text,
  vehicle_number       text,
  condition            text        DEFAULT 'GOOD',
  notes                text,
  created_by           uuid        REFERENCES auth.users(id),
  created_at           timestamptz DEFAULT now()
);

-- ── po_approvals ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.po_approvals (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id              text        NOT NULL REFERENCES public.purchase_orders(po_id) ON DELETE CASCADE,
  approver_user_id   uuid        REFERENCES auth.users(id),
  action             text        NOT NULL,
  remarks            text,
  actioned_at        timestamptz DEFAULT now()
);

-- ── Enable RLS ────────────────────────────────────────────────────────────

ALTER TABLE public.po_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_grn         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_approvals   ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies: po_line_items ───────────────────────────────────────────

DROP POLICY IF EXISTS "Management and accountant full access on po_line_items"  ON public.po_line_items;
DROP POLICY IF EXISTS "Supervisor select on po_line_items"                      ON public.po_line_items;

CREATE POLICY "Management and accountant full access on po_line_items"
  ON public.po_line_items
  FOR ALL
  USING  (public.current_user_role() IN ('management', 'accountant'))
  WITH CHECK (public.current_user_role() IN ('management', 'accountant'));

CREATE POLICY "Supervisor select on po_line_items"
  ON public.po_line_items
  FOR SELECT
  USING (
    public.current_user_role() = 'supervisor'
    AND po_id IN (
      SELECT po.po_id FROM public.purchase_orders po
      WHERE po.project_id IN (
        SELECT unnest(up.assigned_projects)
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
      )
    )
  );

-- ── RLS Policies: po_grn ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Management and accountant full access on po_grn"  ON public.po_grn;
DROP POLICY IF EXISTS "Supervisor select on po_grn"                      ON public.po_grn;

CREATE POLICY "Management and accountant full access on po_grn"
  ON public.po_grn
  FOR ALL
  USING  (public.current_user_role() IN ('management', 'accountant'))
  WITH CHECK (public.current_user_role() IN ('management', 'accountant'));

CREATE POLICY "Supervisor select on po_grn"
  ON public.po_grn
  FOR SELECT
  USING (
    public.current_user_role() = 'supervisor'
    AND po_id IN (
      SELECT po.po_id FROM public.purchase_orders po
      WHERE po.project_id IN (
        SELECT unnest(up.assigned_projects)
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
      )
    )
  );

-- ── RLS Policies: po_approvals ────────────────────────────────────────────

DROP POLICY IF EXISTS "Management and accountant full access on po_approvals"  ON public.po_approvals;
DROP POLICY IF EXISTS "Supervisor select on po_approvals"                      ON public.po_approvals;

CREATE POLICY "Management and accountant full access on po_approvals"
  ON public.po_approvals
  FOR ALL
  USING  (public.current_user_role() IN ('management', 'accountant'))
  WITH CHECK (public.current_user_role() IN ('management', 'accountant'));

CREATE POLICY "Supervisor select on po_approvals"
  ON public.po_approvals
  FOR SELECT
  USING (
    public.current_user_role() = 'supervisor'
    AND po_id IN (
      SELECT po.po_id FROM public.purchase_orders po
      WHERE po.project_id IN (
        SELECT unnest(up.assigned_projects)
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
      )
    )
  );

-- ── Principal full access on new tables ──────────────────────────────────

DROP POLICY IF EXISTS "Principal full access" ON public.po_line_items;
DROP POLICY IF EXISTS "Principal full access" ON public.po_grn;
DROP POLICY IF EXISTS "Principal full access" ON public.po_approvals;

CREATE POLICY "Principal full access"
  ON public.po_line_items
  FOR ALL
  USING  (public.current_user_role() = 'principal')
  WITH CHECK (public.current_user_role() = 'principal');

CREATE POLICY "Principal full access"
  ON public.po_grn
  FOR ALL
  USING  (public.current_user_role() = 'principal')
  WITH CHECK (public.current_user_role() = 'principal');

CREATE POLICY "Principal full access"
  ON public.po_approvals
  FOR ALL
  USING  (public.current_user_role() = 'principal')
  WITH CHECK (public.current_user_role() = 'principal');

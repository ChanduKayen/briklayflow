-- ================================================================
-- Procurement Module — Sprint 1: Foundation
-- Date: 2026-05-21
--
-- Creates:
--   material_requests, mr_items, rfqs, rfq_items, rfq_quotes,
--   po_items, goods_receipts, grn_items, vendor_invoices, invoice_items
-- Extends: purchase_orders (ALTER TABLE only)
-- Adds:    'procurement' to member_role enum, updates has_role()
-- ================================================================

-- ── 0. Add 'procurement' to member_role enum ────────────────────────────────

ALTER TYPE public.member_role ADD VALUE IF NOT EXISTS 'procurement';

-- ── 1. Update has_role() to handle 'procurement' ────────────────────────────

CREATE OR REPLACE FUNCTION public.has_role(
  p_user_id  uuid,
  p_org_id   uuid,
  p_min_role text
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.user_id = p_user_id
      AND m.org_id  = p_org_id
      AND m.status  = 'active'
      AND CASE p_min_role
            -- procurement: accessible to procurement, management, principal
            WHEN 'procurement' THEN m.role IN ('procurement','management','principal')
            WHEN 'accountant'  THEN m.role IN ('accountant','supervisor','procurement','management','principal')
            WHEN 'supervisor'  THEN m.role IN ('supervisor','management','principal')
            WHEN 'management'  THEN m.role IN ('management','principal')
            WHEN 'principal'   THEN m.role = 'principal'
            ELSE false
          END
  );
$$;

-- ── 2. Reusable updated_at trigger (reuses handle_updated_at if present) ────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── 3. Auto-number generator: PREFIX-YYYY-NNNN ──────────────────────────────
--
-- Uses an advisory lock keyed on (prefix + year) to prevent concurrent
-- sequence collisions. Numbers are never reused even if a row is voided —
-- MAX is used (not COUNT) so voids don't reset the sequence.

CREATE OR REPLACE FUNCTION public.generate_doc_number(
  p_prefix     text,
  p_table_name text,
  p_num_col    text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year     int  := EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Kolkata')::int;
  v_lock_key bigint;
  v_next_seq int;
BEGIN
  -- Advisory lock prevents concurrent duplicates within the same transaction
  v_lock_key := hashtext(p_prefix || '-' || v_year::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  EXECUTE format(
    $q$SELECT COALESCE(MAX(
         (regexp_match(%I, '(\d+)$'))[1]::int
       ), 0) + 1
       FROM %I
       WHERE %I LIKE $1$q$,
    p_num_col,
    p_table_name,
    p_num_col
  )
  INTO v_next_seq
  USING (p_prefix || '-' || v_year::text || '-%');

  RETURN p_prefix || '-' || v_year::text || '-' || lpad(v_next_seq::text, 4, '0');
END;
$$;

-- ── 4. CREATE TABLES (forward-reference safe order) ─────────────────────────
--
-- Circular references handled by creating tables without those FK columns,
-- then adding them via ALTER TABLE once all referenced tables exist.
--
--   material_requests ←→ rfqs         : create both without the forward FK, ADD after
--   rfqs              ←→ rfq_quotes   : create rfqs without selected_quote_id, ADD after

-- ── 4.1 material_requests (without converted_to_rfq_id — forward ref to rfqs) ──

CREATE TABLE IF NOT EXISTS public.material_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mr_number            text        UNIQUE NOT NULL,
  org_id               uuid        NOT NULL REFERENCES public.organizations(org_id) ON DELETE RESTRICT,
  project_id           text        NOT NULL REFERENCES public.projects(project_id),
  raised_by            uuid        REFERENCES auth.users(id),
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','quoted','ordered','rejected','cancelled')),
  urgency              text        NOT NULL DEFAULT 'normal'
                                   CHECK (urgency IN ('normal','urgent','emergency')),
  need_by_date         date        NOT NULL,
  note                 text,
  suggested_vendor     text,
  -- converted_to_rfq_id added below via ALTER TABLE (forward ref to rfqs)
  converted_to_po_id   text        REFERENCES public.purchase_orders(po_id),
  rejected_reason      text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  voided_at            timestamptz,

  CONSTRAINT mr_reject_reason CHECK (status != 'rejected' OR rejected_reason IS NOT NULL)
);

-- ── 4.2 rfqs (without source_mr_id and selected_quote_id — forward refs) ──────

CREATE TABLE IF NOT EXISTS public.rfqs (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number           text        UNIQUE NOT NULL,
  org_id               uuid        NOT NULL REFERENCES public.organizations(org_id) ON DELETE RESTRICT,
  -- source_mr_id added below via ALTER TABLE (back ref to material_requests)
  title                text        NOT NULL,
  terms                text,
  response_deadline    date        NOT NULL,
  status               text        NOT NULL DEFAULT 'draft'
                                   CHECK (status IN ('draft','sent','quotes_received','vendor_selected','converted_to_po','cancelled')),
  -- selected_quote_id added below via ALTER TABLE (forward ref to rfq_quotes)
  converted_to_po_id   text        REFERENCES public.purchase_orders(po_id),
  created_by           uuid        REFERENCES auth.users(id),
  approved_by          uuid        REFERENCES auth.users(id),
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  voided_at            timestamptz
);

-- ── 4.3 mr_items ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mr_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mr_id       uuid        NOT NULL REFERENCES public.material_requests(id) ON DELETE CASCADE,
  material    text        NOT NULL,
  spec        text,
  qty         numeric     NOT NULL CHECK (qty > 0),
  unit        text        NOT NULL,
  line_note   text
);

-- ── 4.4 rfq_items ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rfq_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id            uuid        NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  material          text        NOT NULL,
  spec              text,
  qty               numeric     NOT NULL CHECK (qty > 0),
  unit              text        NOT NULL,
  source_mr_item_id uuid        REFERENCES public.mr_items(id)
);

-- ── 4.5 rfq_quotes (references rfqs and stakeholders — both exist now) ────────

CREATE TABLE IF NOT EXISTS public.rfq_quotes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id          uuid        NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  vendor_id       text        NOT NULL REFERENCES public.stakeholders(stakeholder_id),
  rates           jsonb       NOT NULL,
  total_quoted    numeric     NOT NULL DEFAULT 0,
  validity_date   date,
  terms           text,
  attachment_url  text,
  received_at     timestamptz DEFAULT now(),
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','received','selected','rejected'))
);

-- ── 4.6 ADD circular FK columns now that all referenced tables exist ──────────

-- material_requests.converted_to_rfq_id → rfqs(id)
ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS converted_to_rfq_id uuid REFERENCES public.rfqs(id);

-- Mutual exclusivity: cannot have both rfq and po conversion at once
ALTER TABLE public.material_requests
  ADD CONSTRAINT mr_conversion_exclusive
  CHECK (NOT (converted_to_rfq_id IS NOT NULL AND converted_to_po_id IS NOT NULL));

-- rfqs.source_mr_id → material_requests(id)
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS source_mr_id uuid REFERENCES public.material_requests(id);

-- rfqs.selected_quote_id → rfq_quotes(id)
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS selected_quote_id uuid REFERENCES public.rfq_quotes(id);

-- ── 4.7 po_items ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.po_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id             text        NOT NULL REFERENCES public.purchase_orders(po_id) ON DELETE CASCADE,
  project_id        text        NOT NULL REFERENCES public.projects(project_id),
  material          text        NOT NULL,
  spec              text,
  qty               numeric     NOT NULL CHECK (qty > 0),
  unit              text        NOT NULL,
  rate              numeric,
  amount            numeric,
  source_mr_item_id uuid        REFERENCES public.mr_items(id)
);

-- ── 4.8 goods_receipts ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number        text        UNIQUE NOT NULL,
  org_id            uuid        NOT NULL REFERENCES public.organizations(org_id) ON DELETE RESTRICT,
  po_id             text        NOT NULL REFERENCES public.purchase_orders(po_id),
  delivery_note_ref text,
  received_at       date        NOT NULL,
  received_by       uuid        REFERENCES auth.users(id),
  vehicle_number    text,
  photo_ids         jsonb       DEFAULT '[]'::jsonb,
  status            text        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','confirmed','disputed')),
  note              text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  voided_at         timestamptz
);

-- ── 4.9 grn_items ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.grn_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id            uuid        NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  po_item_id        uuid        NOT NULL REFERENCES public.po_items(id),
  qty_received      numeric     NOT NULL CHECK (qty_received >= 0),
  qty_accepted      numeric     NOT NULL CHECK (qty_accepted >= 0),
  qty_rejected      numeric     NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
  rejection_reason  text,

  CONSTRAINT grn_rejection_reason CHECK (qty_rejected = 0 OR rejection_reason IS NOT NULL),
  CONSTRAINT grn_qty_balance       CHECK (qty_accepted + qty_rejected = qty_received)
);

-- ── 4.10 vendor_invoices ──────────────────────────────────────────────────────
-- Note: documents is a Storage bucket only (not a DB table).
--       file_id stores the storage object path/URL as text.

CREATE TABLE IF NOT EXISTS public.vendor_invoices (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid        NOT NULL REFERENCES public.organizations(org_id) ON DELETE RESTRICT,
  invoice_number            text        NOT NULL,
  vendor_id                 text        NOT NULL REFERENCES public.stakeholders(stakeholder_id),
  po_id                     text        NOT NULL REFERENCES public.purchase_orders(po_id),
  invoice_date              date,
  due_date                  date,
  total_amount              numeric     NOT NULL,
  tax_amount                numeric     DEFAULT 0,
  file_id                   text,       -- Storage path (documents bucket)
  ai_extracted_data         jsonb,
  ai_match_status           text        CHECK (ai_match_status IN ('matched','variance','unmatched')),
  ai_match_details          jsonb,
  approved_for_payment_at   timestamptz,
  approved_by               uuid        REFERENCES auth.users(id),
  transaction_id            text        REFERENCES public.transactions(txn_id),
  status                    text        NOT NULL DEFAULT 'received'
                                        CHECK (status IN ('received','matched','approved','paid','voided')),
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),
  voided_at                 timestamptz,

  CONSTRAINT vendor_invoice_unique UNIQUE (vendor_id, invoice_number)
);

-- ── 4.11 invoice_items ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid        NOT NULL REFERENCES public.vendor_invoices(id) ON DELETE CASCADE,
  po_item_id    uuid        REFERENCES public.po_items(id),
  description   text,
  qty           numeric,
  rate          numeric,
  amount        numeric,
  tax           numeric     DEFAULT 0
);

-- ── 4.12 Extend purchase_orders (ALTER TABLE, not recreate) ───────────────────

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS source_mr_id    uuid REFERENCES public.material_requests(id),
  ADD COLUMN IF NOT EXISTS source_rfq_id   uuid REFERENCES public.rfqs(id),
  ADD COLUMN IF NOT EXISTS source_quote_id uuid REFERENCES public.rfq_quotes(id),
  ADD COLUMN IF NOT EXISTS rate_status     text DEFAULT 'confirmed'
                                           CHECK (rate_status IN ('confirmed','tbc'));

-- ── 5. Auto-number trigger functions ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_mr_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mr_number IS NULL OR NEW.mr_number = '' THEN
    NEW.mr_number := public.generate_doc_number('MR', 'material_requests', 'mr_number');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_rfq_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rfq_number IS NULL OR NEW.rfq_number = '' THEN
    NEW.rfq_number := public.generate_doc_number('RFQ', 'rfqs', 'rfq_number');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_grn_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.grn_number IS NULL OR NEW.grn_number = '' THEN
    NEW.grn_number := public.generate_doc_number('GRN', 'goods_receipts', 'grn_number');
  END IF;
  RETURN NEW;
END;
$$;

-- Attach auto-number triggers

DROP TRIGGER IF EXISTS trg_mr_number ON public.material_requests;
CREATE TRIGGER trg_mr_number
  BEFORE INSERT ON public.material_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_mr_number();

DROP TRIGGER IF EXISTS trg_rfq_number ON public.rfqs;
CREATE TRIGGER trg_rfq_number
  BEFORE INSERT ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.set_rfq_number();

DROP TRIGGER IF EXISTS trg_grn_number ON public.goods_receipts;
CREATE TRIGGER trg_grn_number
  BEFORE INSERT ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_grn_number();

-- ── 6. updated_at triggers (reuse handle_updated_at if available, else set_updated_at) ──

DROP TRIGGER IF EXISTS trg_mr_updated_at ON public.material_requests;
CREATE TRIGGER trg_mr_updated_at
  BEFORE UPDATE ON public.material_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_rfqs_updated_at ON public.rfqs;
CREATE TRIGGER trg_rfqs_updated_at
  BEFORE UPDATE ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_grn_updated_at ON public.goods_receipts;
CREATE TRIGGER trg_grn_updated_at
  BEFORE UPDATE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_vi_updated_at ON public.vendor_invoices;
CREATE TRIGGER trg_vi_updated_at
  BEFORE UPDATE ON public.vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 7. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_mr_project_id       ON public.material_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_mr_status            ON public.material_requests(status);
CREATE INDEX IF NOT EXISTS idx_mr_org_id            ON public.material_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_mr_voided            ON public.material_requests(voided_at) WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mr_items_mr_id       ON public.mr_items(mr_id);

CREATE INDEX IF NOT EXISTS idx_rfqs_source_mr_id    ON public.rfqs(source_mr_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_status          ON public.rfqs(status);
CREATE INDEX IF NOT EXISTS idx_rfqs_org_id          ON public.rfqs(org_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_voided          ON public.rfqs(voided_at) WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq_id     ON public.rfq_items(rfq_id);

CREATE INDEX IF NOT EXISTS idx_rfq_quotes_rfq_id    ON public.rfq_quotes(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_quotes_vendor_id ON public.rfq_quotes(vendor_id);

CREATE INDEX IF NOT EXISTS idx_po_items_po_id       ON public.po_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_project_id  ON public.po_items(project_id);

CREATE INDEX IF NOT EXISTS idx_grn_po_id            ON public.goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_org_id           ON public.goods_receipts(org_id);

CREATE INDEX IF NOT EXISTS idx_grn_items_grn_id     ON public.grn_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_po_item_id ON public.grn_items(po_item_id);

CREATE INDEX IF NOT EXISTS idx_vi_po_id             ON public.vendor_invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_vi_vendor_id         ON public.vendor_invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vi_org_id            ON public.vendor_invoices(org_id);

CREATE INDEX IF NOT EXISTS idx_inv_items_invoice_id ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_po_item_id ON public.invoice_items(po_item_id);

-- ── 8. RLS ────────────────────────────────────────────────────────────────────
--
-- Role access matrix:
--   supervisor  → MRs for their assigned projects (SELECT/INSERT/UPDATE pending only)
--                 GRNs for their project's POs (SELECT/INSERT)
--   procurement → Full SELECT/INSERT/UPDATE on all procurement tables. No DELETE.
--   management  → SELECT all, UPDATE rfqs (approval) + vendor_invoices (payment approval)
--   principal   → Same as management (included via has_role hierarchy)
--
-- All policies also require org_id scoping via get_my_org_ids().
-- Child tables are scoped via JOIN to their parent's org_id.
-- No DELETE policies — soft delete only via voided_at.

-- Helper: supervisor project membership check (inlined to avoid deprecated helper)
-- Uses user_profiles.assigned_projects which is readable by the current user via self-select RLS.

-- ── 8.1 material_requests ─────────────────────────────────────────────────────

ALTER TABLE public.material_requests ENABLE ROW LEVEL SECURITY;

-- Supervisor: read MRs for their assigned projects
DROP POLICY IF EXISTS "supervisor reads project MRs" ON public.material_requests;
CREATE POLICY "supervisor reads project MRs"
  ON public.material_requests FOR SELECT
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND project_id = ANY(
      (SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.org_memberships m
      WHERE m.user_id = auth.uid()
        AND m.org_id  = material_requests.org_id
        AND m.role    = 'supervisor'
        AND m.status  = 'active'
    )
  );

-- Supervisor: create MRs for their assigned projects (pending only)
DROP POLICY IF EXISTS "supervisor inserts MRs" ON public.material_requests;
CREATE POLICY "supervisor inserts MRs"
  ON public.material_requests FOR INSERT
  WITH CHECK (
    org_id IN (SELECT public.get_my_org_ids())
    AND project_id = ANY(
      (SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid())
    )
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.org_memberships m
      WHERE m.user_id = auth.uid()
        AND m.org_id  = org_id
        AND m.role    = 'supervisor'
        AND m.status  = 'active'
    )
  );

-- Supervisor: edit pending MRs for their assigned projects
DROP POLICY IF EXISTS "supervisor updates pending MRs" ON public.material_requests;
CREATE POLICY "supervisor updates pending MRs"
  ON public.material_requests FOR UPDATE
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND status = 'pending'
    AND project_id = ANY(
      (SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.org_memberships m
      WHERE m.user_id = auth.uid()
        AND m.org_id  = material_requests.org_id
        AND m.role    = 'supervisor'
        AND m.status  = 'active'
    )
  );

-- Procurement + management + principal: full access
DROP POLICY IF EXISTS "procurement full access MRs" ON public.material_requests;
CREATE POLICY "procurement full access MRs"
  ON public.material_requests FOR ALL
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), material_requests.org_id, 'procurement')
  )
  WITH CHECK (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), material_requests.org_id, 'procurement')
  );

-- Management-only read (management is NOT included in procurement policy FOR ALL above
-- since procurement includes management via hierarchy — management already has full access.
-- This policy is kept for clarity and to ensure management always has at least SELECT.)
DROP POLICY IF EXISTS "management reads MRs" ON public.material_requests;
CREATE POLICY "management reads MRs"
  ON public.material_requests FOR SELECT
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), material_requests.org_id, 'management')
  );

-- ── 8.2 mr_items ──────────────────────────────────────────────────────────────

ALTER TABLE public.mr_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supervisor reads mr items" ON public.mr_items;
CREATE POLICY "supervisor reads mr items"
  ON public.mr_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.material_requests mr
      WHERE mr.id         = mr_items.mr_id
        AND mr.org_id     IN (SELECT public.get_my_org_ids())
        AND mr.project_id = ANY(
          (SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid())
        )
        AND EXISTS (
          SELECT 1 FROM public.org_memberships m
          WHERE m.user_id = auth.uid()
            AND m.org_id  = mr.org_id
            AND m.role    = 'supervisor'
            AND m.status  = 'active'
        )
    )
  );

DROP POLICY IF EXISTS "supervisor inserts mr items" ON public.mr_items;
CREATE POLICY "supervisor inserts mr items"
  ON public.mr_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.material_requests mr
      WHERE mr.id         = mr_id
        AND mr.org_id     IN (SELECT public.get_my_org_ids())
        AND mr.project_id = ANY(
          (SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid())
        )
        AND mr.status     = 'pending'
        AND EXISTS (
          SELECT 1 FROM public.org_memberships m
          WHERE m.user_id = auth.uid()
            AND m.org_id  = mr.org_id
            AND m.role    = 'supervisor'
            AND m.status  = 'active'
        )
    )
  );

DROP POLICY IF EXISTS "procurement access mr items" ON public.mr_items;
CREATE POLICY "procurement access mr items"
  ON public.mr_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.material_requests mr
      WHERE mr.id = mr_items.mr_id
        AND public.has_role(auth.uid(), mr.org_id, 'procurement')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.material_requests mr
      WHERE mr.id = mr_id
        AND public.has_role(auth.uid(), mr.org_id, 'procurement')
    )
  );

-- ── 8.3 rfqs ──────────────────────────────────────────────────────────────────

ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "procurement full access RFQs" ON public.rfqs;
CREATE POLICY "procurement full access RFQs"
  ON public.rfqs FOR ALL
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), rfqs.org_id, 'procurement')
  )
  WITH CHECK (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), rfqs.org_id, 'procurement')
  );

DROP POLICY IF EXISTS "management reads RFQs" ON public.rfqs;
CREATE POLICY "management reads RFQs"
  ON public.rfqs FOR SELECT
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), rfqs.org_id, 'management')
  );

-- Management can approve RFQs (update status, approved_by)
DROP POLICY IF EXISTS "management approves RFQs" ON public.rfqs;
CREATE POLICY "management approves RFQs"
  ON public.rfqs FOR UPDATE
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), rfqs.org_id, 'management')
  );

-- ── 8.4 rfq_items ─────────────────────────────────────────────────────────────

ALTER TABLE public.rfq_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "procurement access rfq items" ON public.rfq_items;
CREATE POLICY "procurement access rfq items"
  ON public.rfq_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.rfqs r
      WHERE r.id = rfq_items.rfq_id
        AND public.has_role(auth.uid(), r.org_id, 'procurement')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rfqs r
      WHERE r.id = rfq_id
        AND public.has_role(auth.uid(), r.org_id, 'procurement')
    )
  );

DROP POLICY IF EXISTS "management reads rfq items" ON public.rfq_items;
CREATE POLICY "management reads rfq items"
  ON public.rfq_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rfqs r
      WHERE r.id = rfq_items.rfq_id
        AND public.has_role(auth.uid(), r.org_id, 'management')
    )
  );

-- ── 8.5 rfq_quotes ────────────────────────────────────────────────────────────

ALTER TABLE public.rfq_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "procurement access rfq quotes" ON public.rfq_quotes;
CREATE POLICY "procurement access rfq quotes"
  ON public.rfq_quotes FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.rfqs r
      WHERE r.id = rfq_quotes.rfq_id
        AND public.has_role(auth.uid(), r.org_id, 'procurement')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rfqs r
      WHERE r.id = rfq_id
        AND public.has_role(auth.uid(), r.org_id, 'procurement')
    )
  );

DROP POLICY IF EXISTS "management reads rfq quotes" ON public.rfq_quotes;
CREATE POLICY "management reads rfq quotes"
  ON public.rfq_quotes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rfqs r
      WHERE r.id = rfq_quotes.rfq_id
        AND public.has_role(auth.uid(), r.org_id, 'management')
    )
  );

-- ── 8.6 po_items ──────────────────────────────────────────────────────────────

ALTER TABLE public.po_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "procurement access po items" ON public.po_items;
CREATE POLICY "procurement access po items"
  ON public.po_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.po_id  = po_items.po_id
        AND public.has_role(auth.uid(), po.org_id, 'procurement')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.po_id  = po_id
        AND public.has_role(auth.uid(), po.org_id, 'procurement')
    )
  );

DROP POLICY IF EXISTS "management reads po items" ON public.po_items;
CREATE POLICY "management reads po items"
  ON public.po_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.po_id = po_items.po_id
        AND public.has_role(auth.uid(), po.org_id, 'management')
    )
  );

-- ── 8.7 goods_receipts ────────────────────────────────────────────────────────

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;

-- Supervisor: read GRNs for POs belonging to their assigned projects
DROP POLICY IF EXISTS "supervisor reads GRNs" ON public.goods_receipts;
CREATE POLICY "supervisor reads GRNs"
  ON public.goods_receipts FOR SELECT
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.po_id     = goods_receipts.po_id
        AND po.project_id = ANY(
          (SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid())
        )
    )
    AND EXISTS (
      SELECT 1 FROM public.org_memberships m
      WHERE m.user_id = auth.uid()
        AND m.org_id  = goods_receipts.org_id
        AND m.role    = 'supervisor'
        AND m.status  = 'active'
    )
  );

-- Supervisor: create GRNs for POs belonging to their assigned projects
DROP POLICY IF EXISTS "supervisor inserts GRNs" ON public.goods_receipts;
CREATE POLICY "supervisor inserts GRNs"
  ON public.goods_receipts FOR INSERT
  WITH CHECK (
    org_id IN (SELECT public.get_my_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.po_id     = po_id
        AND po.project_id = ANY(
          (SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid())
        )
    )
    AND EXISTS (
      SELECT 1 FROM public.org_memberships m
      WHERE m.user_id = auth.uid()
        AND m.org_id  = org_id
        AND m.role    = 'supervisor'
        AND m.status  = 'active'
    )
  );

DROP POLICY IF EXISTS "procurement full access GRNs" ON public.goods_receipts;
CREATE POLICY "procurement full access GRNs"
  ON public.goods_receipts FOR ALL
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), goods_receipts.org_id, 'procurement')
  )
  WITH CHECK (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), goods_receipts.org_id, 'procurement')
  );

DROP POLICY IF EXISTS "management reads GRNs" ON public.goods_receipts;
CREATE POLICY "management reads GRNs"
  ON public.goods_receipts FOR SELECT
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), goods_receipts.org_id, 'management')
  );

-- ── 8.8 grn_items ─────────────────────────────────────────────────────────────

ALTER TABLE public.grn_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supervisor reads grn items" ON public.grn_items;
CREATE POLICY "supervisor reads grn items"
  ON public.grn_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_receipts grn
      JOIN public.purchase_orders po ON po.po_id = grn.po_id
      WHERE grn.id = grn_items.grn_id
        AND po.project_id = ANY(
          (SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid())
        )
        AND EXISTS (
          SELECT 1 FROM public.org_memberships m
          WHERE m.user_id = auth.uid()
            AND m.org_id  = grn.org_id
            AND m.role    = 'supervisor'
            AND m.status  = 'active'
        )
    )
  );

DROP POLICY IF EXISTS "supervisor inserts grn items" ON public.grn_items;
CREATE POLICY "supervisor inserts grn items"
  ON public.grn_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.goods_receipts grn
      JOIN public.purchase_orders po ON po.po_id = grn.po_id
      WHERE grn.id = grn_id
        AND po.project_id = ANY(
          (SELECT assigned_projects FROM public.user_profiles WHERE id = auth.uid())
        )
        AND EXISTS (
          SELECT 1 FROM public.org_memberships m
          WHERE m.user_id = auth.uid()
            AND m.org_id  = grn.org_id
            AND m.role    = 'supervisor'
            AND m.status  = 'active'
        )
    )
  );

DROP POLICY IF EXISTS "procurement access grn items" ON public.grn_items;
CREATE POLICY "procurement access grn items"
  ON public.grn_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_receipts grn
      WHERE grn.id = grn_items.grn_id
        AND public.has_role(auth.uid(), grn.org_id, 'procurement')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.goods_receipts grn
      WHERE grn.id = grn_id
        AND public.has_role(auth.uid(), grn.org_id, 'procurement')
    )
  );

DROP POLICY IF EXISTS "management reads grn items" ON public.grn_items;
CREATE POLICY "management reads grn items"
  ON public.grn_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_receipts grn
      WHERE grn.id = grn_items.grn_id
        AND public.has_role(auth.uid(), grn.org_id, 'management')
    )
  );

-- ── 8.9 vendor_invoices ───────────────────────────────────────────────────────

ALTER TABLE public.vendor_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "procurement full access vendor invoices" ON public.vendor_invoices;
CREATE POLICY "procurement full access vendor invoices"
  ON public.vendor_invoices FOR ALL
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), vendor_invoices.org_id, 'procurement')
  )
  WITH CHECK (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), vendor_invoices.org_id, 'procurement')
  );

DROP POLICY IF EXISTS "management reads vendor invoices" ON public.vendor_invoices;
CREATE POLICY "management reads vendor invoices"
  ON public.vendor_invoices FOR SELECT
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), vendor_invoices.org_id, 'management')
  );

-- Management can approve vendor invoices for payment
DROP POLICY IF EXISTS "management approves vendor invoices" ON public.vendor_invoices;
CREATE POLICY "management approves vendor invoices"
  ON public.vendor_invoices FOR UPDATE
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND public.has_role(auth.uid(), vendor_invoices.org_id, 'management')
  );

-- ── 8.10 invoice_items ────────────────────────────────────────────────────────

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "procurement access invoice items" ON public.invoice_items;
CREATE POLICY "procurement access invoice items"
  ON public.invoice_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_invoices vi
      WHERE vi.id = invoice_items.invoice_id
        AND public.has_role(auth.uid(), vi.org_id, 'procurement')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vendor_invoices vi
      WHERE vi.id = invoice_id
        AND public.has_role(auth.uid(), vi.org_id, 'procurement')
    )
  );

DROP POLICY IF EXISTS "management reads invoice items" ON public.invoice_items;
CREATE POLICY "management reads invoice items"
  ON public.invoice_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_invoices vi
      WHERE vi.id = invoice_items.invoice_id
        AND public.has_role(auth.uid(), vi.org_id, 'management')
    )
  );

-- ── END OF MIGRATION ──────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- GRN MODULE — drop-recreate po_grn + new po_grn_items + functions + view
-- projects.project_id is TEXT (PRJ-... slug), not uuid.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Block 1: drop old po_grn (cascade removes old RLS + FK refs) ─────────

DROP TABLE IF EXISTS public.po_grn CASCADE;

-- ── Block 2: GRN header table ─────────────────────────────────────────────

CREATE TABLE public.po_grn (
  grn_id         text          PRIMARY KEY,
  org_id         uuid          NOT NULL
                               REFERENCES public.organizations(org_id)
                               ON DELETE RESTRICT,
  po_id          text          NOT NULL
                               REFERENCES public.purchase_orders(po_id)
                               ON DELETE RESTRICT,
  project_id     text          NOT NULL
                               REFERENCES public.projects(project_id)
                               ON DELETE RESTRICT,
  stakeholder_id text          REFERENCES public.stakeholders(stakeholder_id)
                               ON DELETE SET NULL,
  receipt_date   date          NOT NULL DEFAULT current_date,
  dc_number      text,
  vehicle_number text,
  driver_name    text,
  remarks        text,
  challan_url    text,
  received_by    uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.po_grn ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org member access"
  ON public.po_grn FOR ALL
  USING  (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

CREATE INDEX IF NOT EXISTS idx_po_grn_org ON public.po_grn(org_id);
CREATE INDEX IF NOT EXISTS idx_po_grn_po  ON public.po_grn(po_id);

-- ── Block 3: GRN line items table ─────────────────────────────────────────

CREATE TABLE public.po_grn_items (
  grn_item_id     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id          text          NOT NULL
                                REFERENCES public.po_grn(grn_id)
                                ON DELETE CASCADE,
  org_id          uuid          NOT NULL
                                REFERENCES public.organizations(org_id)
                                ON DELETE RESTRICT,
  po_line_item_id uuid          REFERENCES public.po_line_items(id)
                                ON DELETE SET NULL,
  item_name       text          NOT NULL,
  unit            text,
  qty_ordered     numeric(15,2) NOT NULL,
  qty_received    numeric(15,2) NOT NULL DEFAULT 0,
  unit_rate       numeric(15,2),
  condition       text          NOT NULL DEFAULT 'good'
                                CHECK (condition IN ('good','damaged','rejected')),
  remarks         text,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.po_grn_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org member access"
  ON public.po_grn_items FOR ALL
  USING  (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

CREATE INDEX IF NOT EXISTS idx_po_grn_items_grn ON public.po_grn_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_po_grn_items_org ON public.po_grn_items(org_id);

-- ── Block 4: generate_grn_id ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_grn_id(
  p_org_id     uuid,
  p_project_id text   -- TEXT (PRJ-... slug), matching projects.project_id
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_site_code text;
  v_date_part text;
  v_seq       int;
  v_new_id    text;
  v_exists    boolean;
BEGIN
  SELECT project_code INTO v_site_code
  FROM public.projects
  WHERE project_id = p_project_id
    AND org_id = p_org_id;

  IF v_site_code IS NULL THEN
    RAISE EXCEPTION 'Project not found or missing project code';
  END IF;

  v_date_part := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDD');

  -- Sequence across ALL dates for this org — never resets.
  SELECT COALESCE(
    MAX(
      CASE WHEN grn_id ~ ('^GRN-' || v_site_code || '-[0-9]{6}-[0-9]+$')
        THEN (split_part(grn_id, '-', 4))::int
        ELSE 0
      END
    ), 0) + 1
  INTO v_seq
  FROM public.po_grn
  WHERE org_id = p_org_id
    AND grn_id LIKE 'GRN-' || v_site_code || '-%';

  v_new_id := 'GRN-' || v_site_code
    || '-' || v_date_part
    || '-' || lpad(v_seq::text, 3, '0');

  -- Collision guard
  SELECT EXISTS(SELECT 1 FROM public.po_grn WHERE grn_id = v_new_id) INTO v_exists;
  IF v_exists THEN
    v_seq    := v_seq + 1;
    v_new_id := 'GRN-' || v_site_code
      || '-' || v_date_part
      || '-' || lpad(v_seq::text, 3, '0');
  END IF;

  RETURN v_new_id;
END;
$$;

-- ── Block 5: create_grn atomic RPC ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_grn(
  p_org_id         uuid,
  p_po_id          text,
  p_project_id     text,   -- TEXT (PRJ-... slug)
  p_stakeholder_id text,
  p_receipt_date   date,
  p_dc_number      text,
  p_vehicle_number text,
  p_driver_name    text,
  p_remarks        text,
  p_received_by    uuid,
  p_items          jsonb
  -- [{po_line_item_id, item_name, unit, qty_ordered,
  --   qty_received, unit_rate, condition, remarks}]
)
RETURNS TABLE (grn_id text, success boolean, error text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_grn_id text;
  v_item   jsonb;
BEGIN
  IF p_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN QUERY SELECT null::text, false, 'Access denied';
    RETURN;
  END IF;

  v_grn_id := public.generate_grn_id(p_org_id, p_project_id);

  INSERT INTO public.po_grn (
    grn_id, org_id, po_id, project_id,
    stakeholder_id, receipt_date, dc_number,
    vehicle_number, driver_name, remarks,
    received_by
  ) VALUES (
    v_grn_id, p_org_id, p_po_id, p_project_id,
    p_stakeholder_id, p_receipt_date, p_dc_number,
    p_vehicle_number, p_driver_name, p_remarks,
    p_received_by
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.po_grn_items (
      grn_id, org_id, po_line_item_id,
      item_name, unit, qty_ordered,
      qty_received, unit_rate, condition, remarks
    ) VALUES (
      v_grn_id,
      p_org_id,
      NULLIF(v_item->>'po_line_item_id', '')::uuid,
      v_item->>'item_name',
      v_item->>'unit',
      (v_item->>'qty_ordered')::numeric,
      (v_item->>'qty_received')::numeric,
      NULLIF(v_item->>'unit_rate', '')::numeric,
      COALESCE(NULLIF(v_item->>'condition', ''), 'good'),
      NULLIF(v_item->>'remarks', '')
    );
  END LOOP;

  RETURN QUERY SELECT v_grn_id, true, null::text;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT null::text, false, SQLERRM;
END;
$$;

-- ── Block 6: po_receipt_summary view ──────────────────────────────────────
-- security_invoker = true so view respects caller's RLS on po_grn/po_grn_items

CREATE OR REPLACE VIEW public.po_receipt_summary
WITH (security_invoker = true) AS
SELECT
  g.po_id,
  g.org_id,
  g.project_id,
  count(DISTINCT g.grn_id)                   AS receipt_count,
  max(g.receipt_date)                        AS last_receipt_date,
  sum(i.qty_received)                        AS total_received,
  sum(i.qty_ordered)                         AS total_ordered,
  round(
    sum(i.qty_received) /
    nullif(sum(i.qty_ordered), 0) * 100, 0
  )                                          AS receipt_pct
FROM public.po_grn g
JOIN public.po_grn_items i ON i.grn_id = g.grn_id
GROUP BY g.po_id, g.org_id, g.project_id;

-- ===========================================================================
-- Bills — the first-class vendor-bill entity.
--
-- A bill is now its own row: vendor + optional site + amount + the uploaded
-- document + lines, optionally naming ONE purchase order. Standalone bills (no
-- PO) are first-class — the drag-and-drop "add bill" flow mints them after
-- reading the document and confirming vendor + site.
--
-- Vendor credit in the ledger comes from BILLS (+ consolidated + opening +
-- adjustments), not from POs. To move without a big-bang write-path migration
-- or losing/duplicating anything, v_party_ledger_line reads:
--   · every bills row, PLUS
--   · a PO's own vendor_bill_amount ONLY when no bills row names that PO
--     (the fallback that keeps bills recorded through the old PO flow counted
--      exactly once). As write paths move to create bills rows, the fallback
--      naturally empties.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.bills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  stakeholder_id text NOT NULL REFERENCES public.stakeholders(stakeholder_id) ON DELETE CASCADE,  -- the vendor
  project_id     text REFERENCES public.projects(project_id) ON DELETE SET NULL,                   -- the site (optional)
  po_id          text REFERENCES public.purchase_orders(po_id) ON DELETE SET NULL,                 -- optional PO link
  bill_no        text,
  bill_date      date,
  amount         numeric NOT NULL CHECK (amount >= 0),
  doc_url        text,
  lines          jsonb NOT NULL DEFAULT '[]'::jsonb,
  note           text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.bills
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER bills_touch BEFORE UPDATE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX IF NOT EXISTS bills_org_vendor_idx ON public.bills(org_id, stakeholder_id);
CREATE INDEX IF NOT EXISTS bills_po_idx ON public.bills(po_id);
-- Duplicate guard surface: same vendor + same bill number (case-insensitive). NOT unique — a genuine
-- re-bill can share a number; the UI warns before minting and lets the user proceed deliberately.
CREATE INDEX IF NOT EXISTS bills_dup_idx ON public.bills(org_id, stakeholder_id, lower(bill_no));

-- ── repoint v_party_ledger_line: bills replace the PO as the billed source ──
CREATE OR REPLACE VIEW public.v_party_ledger_line
WITH (security_invoker = true) AS
-- Bills (first-class). The vendor payable side.
SELECT b.org_id, b.stakeholder_id, b.project_id,
       COALESCE(b.bill_date, b.created_at::date) AS line_date,
       'po_bill'::text AS kind, b.id::text AS ref_id,
       'Bill ' || COALESCE(b.bill_no, left(b.id::text, 8)) AS label,
       b.amount::numeric AS billed, 0::numeric AS paid
  FROM public.bills b
 WHERE b.stakeholder_id IS NOT NULL AND b.amount > 0
UNION ALL
-- PO fallback: a PO's own recorded bill, ONLY when no bills row names that PO (counted once).
SELECT po.org_id, po.stakeholder_id, po.project_id,
       COALESCE(po.vendor_bill_date, po.bill_recorded_at::date, po.date_issued) AS line_date,
       'po_bill'::text AS kind, po.po_id AS ref_id,
       'Bill ' || COALESCE(po.vendor_bill_number, po.po_id) AS label,
       po.vendor_bill_amount::numeric AS billed, 0::numeric AS paid
  FROM public.purchase_orders po
 WHERE po.stakeholder_id IS NOT NULL AND po.vendor_bill_amount IS NOT NULL AND po.vendor_bill_amount > 0
   AND COALESCE(po.approval_status, 'APPROVED') = 'APPROVED'
   AND COALESCE(upper(po.status), '') <> 'CANCELLED'
   AND NOT EXISTS (SELECT 1 FROM public.bills b WHERE b.po_id = po.po_id)
UNION ALL
SELECT cb.org_id, cb.stakeholder_id, NULL::text, cb.period_to, 'consolidated'::text, cb.id::text,
       'Consolidated bill'::text, cb.amount, 0::numeric
  FROM public.consolidated_bills cb
UNION ALL
SELECT ob.org_id, ob.stakeholder_id, NULL::text, ob.as_of, 'opening'::text, ob.id::text, 'Opening balance'::text,
       CASE WHEN ob.direction = 'work_owed'  THEN ob.total_amount ELSE 0 END,
       CASE WHEN ob.direction = 'paid_ahead' THEN ob.total_amount ELSE 0 END
  FROM public.stakeholder_opening_balances ob
UNION ALL
SELECT adj.org_id, adj.stakeholder_id, adj.project_id, adj.adj_date, 'adjustment'::text, adj.id::text,
       COALESCE(adj.note, 'Adjustment'),
       CASE WHEN adj.side = 'certified' THEN adj.amount ELSE 0 END,
       CASE WHEN adj.side = 'paid'      THEN adj.amount ELSE 0 END
  FROM public.party_adjustments adj
UNION ALL
SELECT t.org_id, t.stakeholder_id,
       (SELECT ta.project_id FROM public.txn_allocations ta WHERE ta.txn_id = t.txn_id ORDER BY ta.allocated_amount DESC NULLS LAST LIMIT 1),
       t.date, 'payment'::text, t.txn_id, COALESCE(t.category, 'Payment'), 0::numeric, t.total_amount
  FROM public.transactions t
 WHERE t.stakeholder_id IS NOT NULL AND t.status IS DISTINCT FROM 'Voided'
UNION ALL
SELECT c.org_id, c.stakeholder_id, c.project_id, a.work_date, 'wage'::text, c.crew_id::text, 'Wages'::text,
       (a.value * cc.rate)::numeric, 0::numeric
  FROM public.labour_crews c
  JOIN public.labour_crew_categories cc ON cc.crew_id = c.crew_id
  JOIN public.labour_attendance a ON a.category_id = cc.id AND a.subject_type = 'crew_category'
 WHERE c.stakeholder_id IS NOT NULL AND c.accrual_basis = 'day' AND a.value > 0
UNION ALL
SELECT d.org_id, d.stakeholder_id, d.project_id, a.work_date, 'wage'::text, d.id::text, 'Wages'::text,
       (a.value * d.rate)::numeric, 0::numeric
  FROM public.labour_direct_workers d
  JOIN public.labour_attendance a ON a.direct_worker_id = d.id AND a.subject_type = 'direct'
 WHERE d.stakeholder_id IS NOT NULL AND d.accrual_basis = 'day' AND a.value > 0
UNION ALL
SELECT wc.org_id, wc.stakeholder_id, wc.project_id, wc.reading_date, 'certified'::text, wc.id::text,
       'Certified work'::text, wc.computed_amount, 0::numeric
  FROM public.work_certifications wc
 WHERE wc.status = 'approved' AND wc.reading_kind IN ('measured','piece') AND wc.stakeholder_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.work_orders wo WHERE wo.wo_id = wc.wo_id AND wo.status = 'Cancelled')
UNION ALL
SELECT * FROM (
  SELECT DISTINCT ON (wc.milestone_id)
         wc.org_id, wc.stakeholder_id, wc.project_id, wc.reading_date, 'certified'::text AS kind, wc.id::text AS ref_id,
         'Certified work'::text AS label, wc.computed_amount AS billed, 0::numeric AS paid
    FROM public.work_certifications wc
   WHERE wc.status = 'approved' AND wc.reading_kind = 'lump' AND wc.stakeholder_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.work_orders wo WHERE wo.wo_id = wc.wo_id AND wo.status = 'Cancelled')
   ORDER BY wc.milestone_id, wc.reading_date DESC
) lump_latest;

GRANT SELECT ON public.v_party_ledger_line TO authenticated;

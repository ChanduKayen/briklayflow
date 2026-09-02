-- ===========================================================================
-- Party ledger — the ONE derived source of "what's owed", in the standard
-- subsidiary-ledger shape. Everything (the party-ledger hero, Payables) reads
-- these, so the two can never drift again.
--
--   v_party_ledger_line  : one signed line per ledger event — a PO bill, a
--                          consolidated bill, an opening balance, an adjustment,
--                          or a payment — with its billed / paid amounts.
--   v_party_balance      : per vendor, the rolled-up billed / paid / without_bills
--                          and the two SEPARATE figures — to_pay (dues) and
--                          advance (paid ahead) — never merged into one net.
--
-- Derived, not stored: a view can't drift, so this is a single source of truth
-- without the parallel-store risk. It mirrors loadPartyLedger()/fix #1 exactly:
--   billed  = PO bills (vendor_bill_amount) + consolidated + opening(work_owed) + adj(certified)
--   paid    = payments (total_amount) + opening(paid_ahead) + adj(paid)
--   to_pay  = max(0, billed − paid)
--   advance = max(0, paid − billed − without_bills)
-- Scoped to vendors (workers' "certified" comes from attendance, not bills).
--
-- security_invoker = true so the views run under the CALLER's RLS.
-- Depends on: purchase_orders, transactions, txn_allocations, consolidated_bills
-- (20260904), stakeholder_opening_balances / party_adjustments (20260903).
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_party_ledger_line
WITH (security_invoker = true) AS
-- PO bills — the payable ("billed") side. Any PO carrying a bill amount (mirrors loadPartyLedger).
SELECT po.org_id, po.stakeholder_id, po.project_id,
       COALESCE(po.vendor_bill_date, po.bill_recorded_at::date, po.date_issued) AS line_date,
       'po_bill'::text AS kind, po.po_id AS ref_id,
       'Bill ' || COALESCE(po.vendor_bill_number, po.po_id) AS label,
       po.vendor_bill_amount::numeric AS billed, 0::numeric AS paid
  FROM public.purchase_orders po
 WHERE po.stakeholder_id IS NOT NULL
   AND po.vendor_bill_amount IS NOT NULL AND po.vendor_bill_amount > 0
UNION ALL
-- Consolidated bills — billed side (a real bill covering many small payments).
SELECT cb.org_id, cb.stakeholder_id, NULL::text AS project_id,
       cb.period_to AS line_date, 'consolidated'::text, cb.id::text,
       'Consolidated bill'::text, cb.amount, 0::numeric
  FROM public.consolidated_bills cb
UNION ALL
-- Opening balance — work_owed lands on billed, paid_ahead on paid.
SELECT ob.org_id, ob.stakeholder_id, NULL::text AS project_id,
       ob.as_of AS line_date, 'opening'::text, ob.id::text, 'Opening balance'::text,
       CASE WHEN ob.direction = 'work_owed'  THEN ob.total_amount ELSE 0 END,
       CASE WHEN ob.direction = 'paid_ahead' THEN ob.total_amount ELSE 0 END
  FROM public.stakeholder_opening_balances ob
UNION ALL
-- Manual adjustments — certified behaves like a bill, paid like a payment.
SELECT adj.org_id, adj.stakeholder_id, adj.project_id,
       adj.adj_date AS line_date, 'adjustment'::text, adj.id::text, COALESCE(adj.note, 'Adjustment'),
       CASE WHEN adj.side = 'certified' THEN adj.amount ELSE 0 END,
       CASE WHEN adj.side = 'paid'      THEN adj.amount ELSE 0 END
  FROM public.party_adjustments adj
UNION ALL
-- Payments — the paid side. One row per non-voided transaction, project = its largest allocation.
SELECT t.org_id, t.stakeholder_id,
       (SELECT ta.project_id FROM public.txn_allocations ta
         WHERE ta.txn_id = t.txn_id ORDER BY ta.allocated_amount DESC NULLS LAST LIMIT 1) AS project_id,
       t.date AS line_date, 'payment'::text, t.txn_id, COALESCE(t.category, 'Payment'),
       0::numeric, t.total_amount
  FROM public.transactions t
 WHERE t.stakeholder_id IS NOT NULL AND t.status IS DISTINCT FROM 'Voided';

GRANT SELECT ON public.v_party_ledger_line TO authenticated;


CREATE OR REPLACE VIEW public.v_party_balance
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT l.* FROM public.v_party_ledger_line l
    JOIN public.stakeholders s ON s.stakeholder_id = l.stakeholder_id AND s.type = 'Vendor'
),
agg AS (
  SELECT org_id, stakeholder_id, SUM(billed) AS billed, SUM(paid) AS paid
    FROM lines GROUP BY org_id, stakeholder_id
),
-- "paid without bills": non-voided vendor payments neither PO/WO-linked nor
-- inside any consolidated bill's [from, to] window (mirrors covers() in loadPartyLedger).
without AS (
  SELECT t.org_id, t.stakeholder_id, SUM(t.total_amount) AS without_bills
    FROM public.transactions t
    JOIN public.stakeholders s ON s.stakeholder_id = t.stakeholder_id AND s.type = 'Vendor'
   WHERE t.status IS DISTINCT FROM 'Voided'
     AND NOT EXISTS (SELECT 1 FROM public.txn_allocations ta
                      WHERE ta.txn_id = t.txn_id AND ta.order_type IN ('PO','WO'))
     AND NOT EXISTS (SELECT 1 FROM public.consolidated_bills cb
                      WHERE cb.stakeholder_id = t.stakeholder_id
                        AND t.date BETWEEN cb.period_from AND cb.period_to)
   GROUP BY t.org_id, t.stakeholder_id
)
SELECT
  a.org_id, a.stakeholder_id,
  a.billed, a.paid,
  COALESCE(w.without_bills, 0)                                       AS without_bills,
  GREATEST(0, a.billed - a.paid)                                     AS to_pay,
  GREATEST(0, a.paid - a.billed - COALESCE(w.without_bills, 0))      AS advance,
  (a.paid - a.billed)                                               AS net_ahead  -- signed: + paid ahead / − owed
FROM agg a
LEFT JOIN without w ON w.org_id = a.org_id AND w.stakeholder_id = a.stakeholder_id;

GRANT SELECT ON public.v_party_balance TO authenticated;

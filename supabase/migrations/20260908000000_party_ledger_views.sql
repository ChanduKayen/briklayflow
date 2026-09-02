-- ===========================================================================
-- Party ledger — the ONE derived source of "what's owed", in the standard
-- subsidiary-ledger shape. Everything (the party-ledger hero, Payables) reads
-- these, so they can never drift again. Covers VENDORS and WORKERS.
--
--   v_party_ledger_line  : one signed line per ledger event — a PO bill, a
--                          consolidated bill, an opening balance, an adjustment,
--                          a payment, a worker WAGE accrual (attendance × rate)
--                          or a CERTIFIED contract measurement — with billed/paid.
--   v_party_balance      : per party, the rolled-up billed / paid / without_bills
--                          and the two SEPARATE figures — to_pay (dues) and
--                          advance (paid ahead) — never merged into one net.
--
-- Derived, not stored: a view can't drift, so this is a single source of truth
-- without the parallel-store risk. It mirrors loadPartyLedger() exactly:
--   billed  = PO bills + consolidated + opening(work_owed) + adj(certified)
--           + worker WAGES (NMR attendance × rate) + worker CERTIFIED (stages)
--   paid    = payments (total_amount) + opening(paid_ahead) + adj(paid)
--   to_pay  = max(0, billed − paid)
--   advance = max(0, paid − billed − without_bills)
--
-- WORKER OBLIGATION (the locked accrual model):
--   · NO-CONTRACT crew / direct worker → each attendance day is measured value
--     → a wage credit (units × rate). Contract crews are PRESENCE ONLY here.
--   · CONTRACT work → certified measurement per milestone: measured = rate × Σqty,
--     lump = planned_amount × latest%/100 — attributed to the work order's party.
--
-- security_invoker = true so the views run under the CALLER's RLS.
-- Depends on: purchase_orders, transactions, txn_allocations, consolidated_bills
-- (20260904), stakeholder_opening_balances / party_adjustments (20260903),
-- labour_crews / labour_crew_categories / labour_direct_workers / labour_attendance
-- / wo_milestones / work_orders (20260901).
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
 WHERE t.stakeholder_id IS NOT NULL AND t.status IS DISTINCT FROM 'Voided'
UNION ALL
-- Worker WAGE accrual (NMR) — a crew skill-row's attendance day × its rate. Only NON-contract
-- crews (presence on a contract crew accrues nothing — that's certified below). One line per day.
SELECT c.org_id, c.stakeholder_id, c.project_id,
       a.work_date AS line_date, 'wage'::text, c.crew_id::text, 'Wages'::text,
       (a.value * cc.rate)::numeric AS billed, 0::numeric AS paid
  FROM public.labour_crews c
  JOIN public.labour_crew_categories cc ON cc.crew_id = c.crew_id
  JOIN public.labour_attendance a ON a.category_id = cc.id AND a.subject_type = 'crew_category'
 WHERE c.stakeholder_id IS NOT NULL AND c.is_contract IS NOT TRUE AND c.wo_id IS NULL
   AND a.value > 0
UNION ALL
-- Worker WAGE accrual (NMR) — a direct worker's attendance day × their rate.
SELECT d.org_id, d.stakeholder_id, d.project_id,
       a.work_date AS line_date, 'wage'::text, d.id::text, 'Wages'::text,
       (a.value * d.rate)::numeric, 0::numeric
  FROM public.labour_direct_workers d
  JOIN public.labour_attendance a ON a.direct_worker_id = d.id AND a.subject_type = 'direct'
 WHERE d.stakeholder_id IS NOT NULL AND a.value > 0
UNION ALL
-- CERTIFIED contract work — MEASURED milestone: rate × Σ(daily qty). Attributed to the work order's
-- party (one WO = one party, unambiguous). One line per milestone.
SELECT wo.org_id, wo.stakeholder_id, wo.project_id,
       MAX(a.work_date) AS line_date, 'certified'::text, m.milestone_id::text, m.name,
       (m.rate * SUM(a.value))::numeric, 0::numeric
  FROM public.wo_milestones m
  JOIN public.work_orders wo ON wo.wo_id = m.wo_id
  JOIN public.labour_attendance a ON a.milestone_id = m.milestone_id AND a.subject_type = 'stage'
 WHERE wo.stakeholder_id IS NOT NULL AND COALESCE(m.unit_type, 'LS') <> 'LS'
 GROUP BY wo.org_id, wo.stakeholder_id, wo.project_id, m.milestone_id, m.name, m.rate
UNION ALL
-- CERTIFIED contract work — LUMP milestone: planned_amount × latest %/100 (readings are cumulative %).
SELECT wo.org_id, wo.stakeholder_id, wo.project_id,
       lr.work_date AS line_date, 'certified'::text, m.milestone_id::text, m.name,
       (m.planned_amount * lr.value / 100.0)::numeric, 0::numeric
  FROM public.wo_milestones m
  JOIN public.work_orders wo ON wo.wo_id = m.wo_id
  JOIN LATERAL (
    SELECT a.value, a.work_date FROM public.labour_attendance a
     WHERE a.milestone_id = m.milestone_id AND a.subject_type = 'stage'
     ORDER BY a.work_date DESC LIMIT 1
  ) lr ON true
 WHERE wo.stakeholder_id IS NOT NULL AND COALESCE(m.unit_type, 'LS') = 'LS';

GRANT SELECT ON public.v_party_ledger_line TO authenticated;


CREATE OR REPLACE VIEW public.v_party_balance
WITH (security_invoker = true) AS
WITH lines AS (
  -- Vendors AND workers — the two party types that carry a payable. (Clients settle the other way.)
  SELECT l.* FROM public.v_party_ledger_line l
    JOIN public.stakeholders s ON s.stakeholder_id = l.stakeholder_id AND s.type IN ('Vendor', 'Worker')
),
agg AS (
  SELECT org_id, stakeholder_id, SUM(billed) AS billed, SUM(paid) AS paid
    FROM lines GROUP BY org_id, stakeholder_id
),
-- "paid without bills": non-voided VENDOR payments neither PO/WO-linked nor inside any consolidated
-- bill's [from, to] window (mirrors covers() in loadPartyLedger). A worker has no such concept → 0.
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

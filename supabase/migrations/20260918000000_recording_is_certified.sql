-- ===========================================================================
-- "Recording is certified" — a contract STAGE reading on the muster is itself the
-- certification. Re-certifying past work is a meaningless ceremony: the reading is
-- the fact, the work is done (and usually already paid against the contract), so an
-- extra approval step adds nothing. This mirrors how day-wages already auto-certify.
--
-- Change is confined to v_party_ledger_line (v_party_balance / v_party_site_balance
-- read it, columns unchanged). It is a RESTATE of 20260915000000 with two edits:
--
--   1. Two NEW 'certified' unions source contract credit DIRECTLY from stage
--      readings (labour_attendance subject_type='stage'):
--        · measured / piece milestone → rate × Σ(readings)      (GROUP BY milestone)
--        · lump milestone             → planned × latest%/100    (latest by work_date)
--      matching the earned math the wizard used (and the 20260909000002 backfill).
--
--   2. The existing work_certifications unions gain a de-dup guard: they SKIP any
--      milestone that has a stage reading. So a milestone is counted EXACTLY once —
--      by the reading union if it has readings, otherwise by its certification
--      (wages settled into a phase, or piece work, which have no muster reading).
--      No double-count, nothing dropped, and it is retroactive with no backfill.
--
-- Governance note: this intentionally drops the manual certify gate for stage
-- readings (recording is the accountable event). Wages-settlement, piece work, and
-- opening/adjustment paths are untouched.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_party_ledger_line
WITH (security_invoker = true) AS
-- Bills (first-class). The vendor payable side — every bills row is billed.
SELECT b.org_id, b.stakeholder_id, b.project_id,
       COALESCE(b.bill_date, b.created_at::date) AS line_date,
       'po_bill'::text AS kind, b.id::text AS ref_id,
       'Bill ' || COALESCE(b.bill_no, left(b.id::text, 8)) AS label,
       b.amount::numeric AS billed, 0::numeric AS paid
  FROM public.bills b
 WHERE b.stakeholder_id IS NOT NULL AND b.amount > 0
UNION ALL
-- PO fallback: a PO's own recorded bill, ONLY when no bills row names that PO (so each bill counts once).
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
-- Opening balance, exploded per site. by_site → one line per project…
SELECT ob.org_id, ob.stakeholder_id, bs.key AS project_id, ob.as_of, 'opening'::text,
       ob.id::text || ':' || bs.key AS ref_id, 'Opening balance'::text,
       CASE WHEN ob.direction = 'work_owed'  THEN bs.value::numeric ELSE 0 END,
       CASE WHEN ob.direction = 'paid_ahead' THEN bs.value::numeric ELSE 0 END
  FROM public.stakeholder_opening_balances ob
  CROSS JOIN LATERAL jsonb_each_text(COALESCE(ob.by_site, '{}'::jsonb)) AS bs(key, value)
 WHERE bs.value::numeric <> 0
UNION ALL
-- …plus the unassigned remainder (total − Σ by_site) as a NULL-project line.
SELECT ob.org_id, ob.stakeholder_id, NULL::text, ob.as_of, 'opening'::text, ob.id::text, 'Opening balance'::text,
       CASE WHEN ob.direction = 'work_owed'  THEN rem.amt ELSE 0 END,
       CASE WHEN ob.direction = 'paid_ahead' THEN rem.amt ELSE 0 END
  FROM public.stakeholder_opening_balances ob
  CROSS JOIN LATERAL (
    SELECT ob.total_amount - COALESCE((SELECT SUM(v::numeric) FROM jsonb_each_text(COALESCE(ob.by_site, '{}'::jsonb)) AS x(k, v)), 0) AS amt
  ) rem
 WHERE rem.amt <> 0
UNION ALL
SELECT adj.org_id, adj.stakeholder_id, adj.project_id, adj.adj_date, 'adjustment'::text, adj.id::text,
       COALESCE(adj.note, 'Adjustment'),
       CASE WHEN adj.side = 'certified' THEN adj.amount ELSE 0 END,
       CASE WHEN adj.side = 'paid'      THEN adj.amount ELSE 0 END
  FROM public.party_adjustments adj
UNION ALL
-- Payments (debit) — never a voided one.
SELECT t.org_id, t.stakeholder_id,
       (SELECT ta.project_id FROM public.txn_allocations ta WHERE ta.txn_id = t.txn_id ORDER BY ta.allocated_amount DESC NULLS LAST LIMIT 1),
       t.date, 'payment'::text, t.txn_id, COALESCE(t.category, 'Payment'), 0::numeric, t.total_amount
  FROM public.transactions t
 WHERE t.stakeholder_id IS NOT NULL AND t.status IS DISTINCT FROM 'Voided'
UNION ALL
-- Worker WAGE — crew, day basis. Settled rows (folded into a contract phase) no longer accrue a wage.
SELECT c.org_id, c.stakeholder_id, c.project_id, a.work_date, 'wage'::text, c.crew_id::text, 'Wages'::text,
       (a.value * cc.rate)::numeric, 0::numeric
  FROM public.labour_crews c
  JOIN public.labour_crew_categories cc ON cc.crew_id = c.crew_id
  JOIN public.labour_attendance a ON a.category_id = cc.id AND a.subject_type = 'crew_category'
 WHERE c.stakeholder_id IS NOT NULL AND c.accrual_basis = 'day' AND a.value > 0 AND a.settled_at IS NULL
UNION ALL
-- Worker WAGE — direct workers, day basis. Same settled-row exclusion.
SELECT d.org_id, d.stakeholder_id, d.project_id, a.work_date, 'wage'::text, d.id::text, 'Wages'::text,
       (a.value * d.rate)::numeric, 0::numeric
  FROM public.labour_direct_workers d
  JOIN public.labour_attendance a ON a.direct_worker_id = d.id AND a.subject_type = 'direct'
 WHERE d.stakeholder_id IS NOT NULL AND d.accrual_basis = 'day' AND a.value > 0 AND a.settled_at IS NULL
UNION ALL
-- CERTIFIED — approved measured/piece certifications, contract not cancelled.
-- De-dup: skip a milestone that has a muster stage reading — that reading now carries
-- the credit (see the reading unions below). Certs that survive here are the ones with
-- NO reading: wages settled into a phase, piece jobs, party-page adjustments.
SELECT wc.org_id, wc.stakeholder_id, wc.project_id, wc.reading_date, 'certified'::text, wc.id::text,
       'Certified work'::text, wc.computed_amount, 0::numeric
  FROM public.work_certifications wc
 WHERE wc.status = 'approved' AND wc.reading_kind IN ('measured','piece') AND wc.stakeholder_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.work_orders wo WHERE wo.wo_id = wc.wo_id AND wo.status = 'Cancelled')
   AND NOT EXISTS (SELECT 1 FROM public.labour_attendance a
                    WHERE a.subject_type = 'stage' AND a.milestone_id = wc.milestone_id)
UNION ALL
-- CERTIFIED — approved LUMP certifications: latest per milestone, contract not cancelled. Same de-dup.
SELECT * FROM (
  SELECT DISTINCT ON (wc.milestone_id)
         wc.org_id, wc.stakeholder_id, wc.project_id, wc.reading_date, 'certified'::text AS kind, wc.id::text AS ref_id,
         'Certified work'::text AS label, wc.computed_amount AS billed, 0::numeric AS paid
    FROM public.work_certifications wc
   WHERE wc.status = 'approved' AND wc.reading_kind = 'lump' AND wc.stakeholder_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.work_orders wo WHERE wo.wo_id = wc.wo_id AND wo.status = 'Cancelled')
     AND NOT EXISTS (SELECT 1 FROM public.labour_attendance a
                      WHERE a.subject_type = 'stage' AND a.milestone_id = wc.milestone_id)
   ORDER BY wc.milestone_id, wc.reading_date DESC
) lump_latest
UNION ALL
-- CERTIFIED (recording) — measured/piece stage readings ARE the certification.
-- rate × Σ(readings) per milestone. One line per (milestone, project).
SELECT a.org_id, wo.stakeholder_id, a.project_id, MAX(a.work_date) AS line_date,
       'certified'::text AS kind, 'read-m:' || m.milestone_id::text AS ref_id,
       'Certified work (recorded)'::text AS label,
       (m.rate * SUM(a.value))::numeric AS billed, 0::numeric AS paid
  FROM public.labour_attendance a
  JOIN public.wo_milestones m ON m.milestone_id = a.milestone_id
  JOIN public.work_orders wo  ON wo.wo_id = m.wo_id
 WHERE a.subject_type = 'stage' AND COALESCE(m.unit_type, 'LS') <> 'LS'
   AND wo.stakeholder_id IS NOT NULL AND wo.status IS DISTINCT FROM 'Cancelled'
 GROUP BY a.org_id, wo.stakeholder_id, a.project_id, m.milestone_id, m.rate
HAVING (m.rate * SUM(a.value)) <> 0
UNION ALL
-- CERTIFIED (recording) — lump stage readings: planned × latest%/100 (latest reading by date).
SELECT * FROM (
  SELECT DISTINCT ON (a.milestone_id)
         a.org_id, wo.stakeholder_id, a.project_id, a.work_date AS line_date,
         'certified'::text AS kind, 'read-l:' || m.milestone_id::text AS ref_id,
         'Certified work (recorded)'::text AS label,
         (m.planned_amount * a.value / 100.0)::numeric AS billed, 0::numeric AS paid
    FROM public.labour_attendance a
    JOIN public.wo_milestones m ON m.milestone_id = a.milestone_id
    JOIN public.work_orders wo  ON wo.wo_id = m.wo_id
   WHERE a.subject_type = 'stage' AND COALESCE(m.unit_type, 'LS') = 'LS'
     AND wo.stakeholder_id IS NOT NULL AND wo.status IS DISTINCT FROM 'Cancelled'
   ORDER BY a.milestone_id, a.work_date DESC
) lump_reads
 WHERE lump_reads.billed <> 0;

GRANT SELECT ON public.v_party_ledger_line TO authenticated;

NOTIFY pgrst, 'reload schema';

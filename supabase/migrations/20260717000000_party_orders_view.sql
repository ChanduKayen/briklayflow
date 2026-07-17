-- v_party_orders — what a party ORDERED and what they BILLED us. Facts, not a verdict.
--
-- One row per (org_id, stakeholder_id, project_id, party_kind) — so every number is answerable
-- PER PROJECT (filter) and OVERALL (sum), with no third computation anywhere.
--
-- ══ WHY THIS REPLACES v_worker_balance BEFORE IT EVER SHIPPED ═══════════════════════════════
--
-- v_worker_balance (written earlier today, never successfully applied) exposed a single derived
-- `owed`, mirroring v_vendor_balance. A live probe of Pattabhi Traders killed that design:
--
--   v_vendor_balance said       ₹31,375 owed
--   the Track hub said          ₹41,375 owed   (vendorTrackingApi, its own per-PO sum)
--   the ledger drawer said      ₹96,640 IN CREDIT
--
-- Three numbers, one vendor, same second. The truth was the third: they had billed ₹33,375 and
-- been paid ₹1,30,015. The view's ₹31,375 was an artefact of three separate faults in deriving
-- `owed` — each of which this view refuses to have, by computing nothing:
--
--   1. IT NETTED ACROSS POs WITHIN A PROJECT. A ₹10,000 payment tagged to DR.SITE00068 was
--      subtracted from PO-2026-0006's order, which had been paid nothing. That netting produced
--      the exact ₹8,375 a user was shown. Grouping by project was never a rounding error; it
--      let any payment cancel any order.
--   2. IT MEASURED ORDERS, NOT BILLS. DR.SITE00068: order_value 0, total_value 0,
--      vendor_bill_amount ₹15,000, status BILLED. `COALESCE(total_value, order_value, 0)`
--      returns 0 — coalesce skips NULL, not zero — so a real ₹15,000 bill counted as nothing
--      while its payment still subtracted. Ordered is a COMMITMENT; the liability is the BILL.
--   3. GREATEST(0, …) HID THE ANSWER. Pattabhi is ₹96,640 in credit. The clamp turned that into
--      0 and then reported ₹8,375 owed. A clamp cannot be right when the sign is the finding.
--
-- So this view emits `ordered` and `billed` and stops. The balance (billed − paid, signed, no
-- clamp) is composed by the caller from these facts plus the payments it already reads. Nothing
-- here decides what anything means.
--
-- ══ NOT DROPPED: v_vendor_balance ══════════════════════════════════════════════════════════
-- It is applied, and dropping a live view from under an unknown reader is not this migration's
-- job. Nothing reads it any more — the WhatsApp card now composes from here, and the Track hub
-- never read it despite its header claiming so. It is dead code in the database; retire it in
-- its own migration once that is confirmed.
--
-- security_invoker = true so the view runs under the CALLER's RLS. The WhatsApp agent calls as
-- service role, where RLS scopes nothing — it filters org_id explicitly, and a gate proves it.

DROP VIEW IF EXISTS public.v_worker_balance;

CREATE OR REPLACE VIEW public.v_party_orders
WITH (security_invoker = true) AS

-- ── VENDORS: purchase orders ────────────────────────────────────────────────────────────────
-- Only APPROVED POs are commitments. COALESCE(upper(status),'') because purchase_orders.status
-- is TEXT and nullable: a bare `upper(status) <> 'CANCELLED'` evaluates NULL for a NULL status
-- and drops the row, silently losing a real order. (v_vendor_balance has that hole today.)
SELECT
  po.org_id,
  po.stakeholder_id,
  po.project_id,
  'Vendor'::text                                              AS party_kind,
  SUM(COALESCE(po.total_value, po.order_value, 0))            AS ordered,
  SUM(COALESCE(po.vendor_bill_amount, 0))                     AS billed
FROM public.purchase_orders po
WHERE po.stakeholder_id IS NOT NULL
  AND po.approval_status = 'APPROVED'
  AND COALESCE(upper(po.status), '') <> 'CANCELLED'
GROUP BY po.org_id, po.stakeholder_id, po.project_id

UNION ALL

-- ── WORKERS: work orders ────────────────────────────────────────────────────────────────────
-- `billed` is 0 and not null: a work order has no bill. A worker's nearest equivalent is a
-- CERTIFIED MILESTONE (wo_milestones.status = 'PAID' — what the ledger drawer credits him for),
-- which is deliberately NOT read here. Until it is, a worker's card shows Ordered and Paid and
-- claims no balance, because billed − paid has no `billed` to stand on.
--
-- work_orders.status is the ENUM wo_status (purchase_orders.status is text — hence upper() up
-- there and not here; `upper(wo_status)` is not a function and Postgres says so). IS DISTINCT
-- FROM is NULL-safe: a work order with no status set is still a commitment.
SELECT
  wo.org_id,
  wo.stakeholder_id,
  wo.project_id,
  'Worker'::text                                              AS party_kind,
  SUM(COALESCE(wo.order_value, 0))                            AS ordered,
  0                                                           AS billed
FROM public.work_orders wo
WHERE wo.stakeholder_id IS NOT NULL
  AND wo.status IS DISTINCT FROM 'Cancelled'
GROUP BY wo.org_id, wo.stakeholder_id, wo.project_id;

GRANT SELECT ON public.v_party_orders TO authenticated;

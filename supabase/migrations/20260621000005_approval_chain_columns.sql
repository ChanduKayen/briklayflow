-- Approval routing columns.
--
-- higher_approver_id: each member's escalation target. When a PO's GST-inclusive total
-- exceeds a member's procurement_approval_limit, approval routes UP this chain until a
-- member whose limit covers it (or who is unlimited) signs off. Set in the UI
-- ("Add approver"). procurement_approval_limit already exists (NULL = unlimited).
ALTER TABLE public.org_memberships
  ADD COLUMN IF NOT EXISTS higher_approver_id uuid REFERENCES auth.users(id);

-- Who submitted a PO into the approval queue, and when (drives the approver
-- notification + queue ordering). Distinct from approved_by/approved_at.
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS submitted_by uuid;
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

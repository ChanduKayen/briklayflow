-- ===========================================================================
-- Attendance: which phases of a contract a crew actually works.
--
-- When a crew is put on a contract that has multiple phases/stages (wo_milestones),
-- the user picks WHICH phases apply — only those show in the crew's stage tracking
-- (the "payments" section: earned / paid / % complete). NULL or empty = all phases.
--
-- Same pattern as purchase_requests.selected_vendor_ids (a user-chosen subset of a set).
-- ===========================================================================

ALTER TABLE public.labour_crews
  ADD COLUMN IF NOT EXISTS stage_ids uuid[];

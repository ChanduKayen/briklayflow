-- ===========================================================================
-- attachments — widen parent_type to carry the "never invisible" floor parents.
--
-- WHY: the SiteOps image flow guarantees every photo terminates in exactly one
-- VISIBLE place — answer-evidence, an attached object, a fresh issue/snag, or the
-- "to place" queue. Two of those floor destinations were not valid attachment
-- parents under 20260701000002's original CHECK (problem|todo|site_task|
-- site_task_comment):
--     'site_narration'   → a photo logged as a plain NOTE with no task to hang on
--                          (the confidence-floor "degrade to note" path) attaches
--                          to its site_narrations row (uuid PK).
--     'siteops_unplaced' → burst/parked photos that couldn't be placed hang off the
--                          one siteops_unplaced queue row (uuid PK) as one-to-many
--                          evidence, beyond that row's single object_path column.
-- Both parents have uuid PKs, so parent_id (uuid) stays honest; parent_type remains
-- app-enforced (polymorphic, no single FK) exactly like the original four.
--
-- IDEMPOTENT: drop-then-add so a hand-run in the SQL editor is safe to re-apply.
-- Widening a CHECK to a superset never violates existing rows — no backfill, no risk.
-- ===========================================================================

ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_parent_type_check;

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_parent_type_check
  CHECK (parent_type IN (
    'problem', 'todo', 'site_task', 'site_task_comment',   -- original four (20260701000002)
    'site_narration',                                       -- degrade-to-note floor
    'siteops_unplaced'                                      -- to-place queue evidence
  ));

-- ROLLBACK (restore the original four):
--   ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_parent_type_check;
--   ALTER TABLE public.attachments
--     ADD CONSTRAINT attachments_parent_type_check
--     CHECK (parent_type IN ('problem', 'todo', 'site_task', 'site_task_comment'));

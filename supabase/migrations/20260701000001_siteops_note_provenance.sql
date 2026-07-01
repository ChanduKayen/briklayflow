-- ===========================================================================
-- Note → Snag/Issue provenance.
--
-- When a task note is turned into a first-class Snag (todos) or Issue (problems),
-- stamp WHICH note it came from so the task feed can HIDE the raw note and render
-- the object's live chip in its place (the "mark-and-hide" rule — one thing in the
-- feed, not "note" + "created from note").
--
-- The TASK link itself is the existing `task_id` ("optional provenance reference")
-- — no new task column. A note has two possible source tables, so source_note_kind
-- distinguishes them:
--   'comment'   → site_task_comments.id  (UI note)
--   'narration' → site_narrations.id     (WhatsApp update)
--
-- Additive + reversible. No backfill (existing objects simply have NULL provenance).
-- ===========================================================================

ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS source_note_id   uuid,
  ADD COLUMN IF NOT EXISTS source_note_kind text
    CHECK (source_note_kind IN ('comment', 'narration'));

ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS source_note_id   uuid,
  ADD COLUMN IF NOT EXISTS source_note_kind text
    CHECK (source_note_kind IN ('comment', 'narration'));

-- The task-feed chip fetches a task's linked objects by task_id — index it on both.
CREATE INDEX IF NOT EXISTS problems_task_idx ON public.problems(task_id);
CREATE INDEX IF NOT EXISTS todos_task_idx    ON public.todos(task_id);

-- ROLLBACK:
--   ALTER TABLE public.problems DROP COLUMN IF EXISTS source_note_id, DROP COLUMN IF EXISTS source_note_kind;
--   ALTER TABLE public.todos    DROP COLUMN IF EXISTS source_note_id, DROP COLUMN IF EXISTS source_note_kind;
--   DROP INDEX IF EXISTS problems_task_idx;  DROP INDEX IF EXISTS todos_task_idx;

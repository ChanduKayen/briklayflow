-- THE CHASE BATCH STILL POINTS AT THE DEAD TODOS (live, 2026-07-13).
--
-- 20260713000001 folded `todos` into `problems` — one item store, one answer to "what is an open item?".
-- It moved the rows and stamped `problems.legacy_todo_id` so the old id could always be found again.
--
-- It did NOT move the OPEN CHASE BATCHES. `chase_batches.items` is a jsonb array of BatchItem
-- ({kind:'todo'|'issue', id, …}), and every live batch still holds the ORIGINAL todo ids. So the candidate
-- set the WhatsApp resolver builds now offers each chased item TWICE — once as the batch's ⭐ `todo` (the
-- dead id) and once as the migrated `problem` (the live id):
--
--     ⭐ 3ddf7a19 | todo  | Plumber to put top point in kitchen
--        134c3c21 | issue | Plumber to put top point in kitchen
--     ⭐ 0af24802 | todo  | ceilings to be completed by day after tomorrow
--        eb166b28 | issue | ceilings to be completed by day after tomorrow
--
-- The model is being shown the same item twice under two ids and asked to pick one. When it picks the ⭐
-- todo — which is ranked FIRST, as the chase prior — the write lands on a row nothing reads any more:
-- resolving it does not resolve the problem the Desk shows, and the chase cron will ask again about an item
-- the supervisor has already told us is done.
--
-- REMAP, don't rebuild. `legacy_todo_id` is exactly the key we need, and it is unique.

UPDATE public.chase_batches b
SET    items = remapped.items,
       updated_at = now()
FROM (
  SELECT
    b2.id AS batch_id,
    jsonb_agg(
      CASE
        -- a todo that MIGRATED: point it at the problem row, and call it what it now is
        WHEN item->>'kind' = 'todo' AND p.id IS NOT NULL
          THEN jsonb_set(jsonb_set(item, '{id}', to_jsonb(p.id::text)), '{kind}', '"todo"'::jsonb)
        -- anything else (an issue, or a todo with no migrated twin) rides through untouched
        ELSE item
      END
      ORDER BY ord
    ) AS items
  FROM public.chase_batches b2
  CROSS JOIN LATERAL jsonb_array_elements(b2.items) WITH ORDINALITY AS t(item, ord)
  LEFT JOIN public.problems p
    ON  item->>'kind' = 'todo'
    AND p.legacy_todo_id IS NOT NULL
    AND p.legacy_todo_id::text = item->>'id'
  WHERE b2.status = 'OPEN'
  GROUP BY b2.id
) AS remapped
WHERE b.id = remapped.batch_id;

-- WHY `kind` STAYS 'todo': the BatchItem kind drives how the item is SPOKEN about ("📋 to-do" vs "⚠ issue")
-- and how the resolver's ladder treats it. `problems.kind` already carries the real classification; the
-- batch's `kind` is a display/handling hint, and changing it here would silently re-label every chased
-- to-do as an issue in the next digest. The ID is the bug. Fix the id, leave the voice alone.
--
-- IDEMPOTENT: after this runs, no OPEN batch item's id matches a `legacy_todo_id` any more (the ids are now
-- the problem ids), so the LEFT JOIN finds nothing and a re-run is a no-op.
--
-- Rollback: there isn't a clean one, and there does not need to be — the old todo ids are still recoverable
-- from problems.legacy_todo_id, and a batch pointing at a dead row was never correct.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- ONE ITEM STORE. `todos` FOLDS INTO `problems`.
--
-- THE BUG THIS FIXES IS LIVE, AND IT IS THE WORST KIND: the app told the founder something was
-- closed while WhatsApp kept chasing it.
--
-- The inbound router forked on item type. An `issue` became a `problems` row — and a snag was just
-- `problems.kind='snag'`, the same table. But a to-do became a `todos` row instead: a second item
-- store, with no ref, no kind, no follow-up clock, and no way to record WHY it was closed
-- (problem_resolutions is FK'd to problems only). The Site Desk reads `problems` and nothing else,
-- so it could not see a `todos` row, let alone close one. The chase cron, meanwhile, chased BOTH
-- tables. So the founder closed an item in the Desk, the Desk showed it closed — and the row the
-- cron was actually chasing was a different row, in a table no screen could reach.
--
-- The fix is not to teach the Desk about `todos`. It is to stop having two answers to "what is an
-- item". A to-do IS a snag someone has been asked to fix by a date — which the model already has:
-- kind='snag', is_planned=true, deadline. (See 20260708000000_problems_is_planned.sql: "to-do /
-- assigned work captured as a PLANNED snag".) That work built the shape; this migration moves the
-- rows into it.
--
-- IDEMPOTENT. legacy_todo_id is unique, so re-running moves nothing twice. `todos` is NOT dropped —
-- it becomes a read-only archive, and nothing writes to it again (the router and the chase engine
-- are changed in the same commit). Dropping it can happen once this has been in prod long enough to
-- trust; deleting the evidence in the same breath as the migration is how a bad backfill becomes
-- unprovable.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

-- ══ 1. where each migrated row came from ═════════════════════════════════════════════════════════
alter table public.problems add column if not exists legacy_todo_id uuid;

create unique index if not exists problems_legacy_todo_idx
  on public.problems(legacy_todo_id) where legacy_todo_id is not null;

comment on column public.problems.legacy_todo_id is
  'The public.todos row this problem was migrated from (20260713000001). Null for everything created since.';


-- ══ 2. the move ══════════════════════════════════════════════════════════════════════════════════
--
-- STATUS MAPS HONESTLY, and DONE becomes RESOLVED rather than being dropped: a finished to-do is a
-- closed snag, and a migration that silently discards completed work would make the site's history
-- lie about what was done.
--
--   todos.OPEN      → problems.OPEN       (still live; still chased)
--   todos.DONE      → problems.RESOLVED   (already finished)
--   todos.DISMISSED → problems.DISMISSED  (retracted)
--
-- THE CHASE CLOCK. A to-do was chased off `due_date` (siteops-chase leg 2). A problem is chased off
-- `next_followup_at`. So an OPEN to-do carries its due date across as the follow-up date, and is
-- chased tomorrow exactly as it would have been today — the cadence does not silently reset, and an
-- overdue item does not silently go quiet. An OPEN to-do with NO due date was never chased (leg 2
-- required due_date), so it stays unchased: next_followup_at null. That is the "note" semantics the
-- problems table already has, and it is the truthful mapping.
insert into public.problems (
  org_id, project_id, task_id, source_narration_id,
  title, owner_id, owner_source, status,
  kind, is_planned, confidence,
  deadline, next_followup_at,
  source_note_id, source_note_kind,
  created_at, updated_at,
  legacy_todo_id
)
select
  t.org_id,
  t.project_id,
  t.task_id,
  -- the provenance columns are a later migration on todos; read them only if they are there
  case when exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='todos' and column_name='source_note_id')
       then (to_jsonb(t) ->> 'source_note_id')::uuid end,
  t.text,
  t.owner_id,
  'auto',
  case t.status when 'DONE' then 'RESOLVED' when 'DISMISSED' then 'DISMISSED' else 'OPEN' end,
  'snag',          -- a to-do IS a snag…
  true,            -- …that someone has been ASKED to fix (is_planned)
  'high',          -- it was captured as an explicit instruction, not an inference
  t.due_date,      -- → problems.deadline
  case when t.status = 'OPEN' and t.due_date is not null
       then t.due_date::timestamptz          -- keep being chased, on the same day it was due
       end,                                  -- no due date → never was chased → still isn't
  case when exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='todos' and column_name='source_note_id')
       then (to_jsonb(t) ->> 'source_note_id')::uuid end,
  case when exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='todos' and column_name='source_note_kind')
       then (to_jsonb(t) ->> 'source_note_kind') end,
  t.created_at,
  t.updated_at,
  t.id
from public.todos t
where not exists (select 1 from public.problems p where p.legacy_todo_id = t.id);

-- refs: problems has a BEFORE INSERT trigger (20260712000000) that stamps {CODE}-{n} per project, so
-- every migrated row gets one on the way in — which is how it becomes addressable in the Desk and
-- quotable in a WhatsApp readback. A to-do never had one.


-- ══ 3. a closed to-do gets its reason on file ════════════════════════════════════════════════════
--
-- The Desk refuses to close an item without recording WHY (problem_resolutions — the audit floor).
-- Migrated DONE rows have no reason: nobody ever recorded one, because the table had nowhere to put
-- it. So they are marked as what they truthfully are — closed, by the migration, reason unknown —
-- rather than back-filled with an invented outcome. An honest gap beats a plausible fiction.
insert into public.problem_resolutions (org_id, problem_id, outcome, note, closed_by, auto_closed)
select p.org_id, p.id, 'fixed', 'Closed before the to-do list was merged into problems — original reason not recorded.', null, true
from public.problems p
where p.legacy_todo_id is not null
  and p.status = 'RESOLVED'
  and not exists (select 1 from public.problem_resolutions r where r.problem_id = p.id);


-- ══ 4. nothing writes to `todos` again ═══════════════════════════════════════════════════════════
-- The router and the chase engine stop using it in this same change. The table stays as an archive
-- (and as the proof that this backfill was faithful), but a stray writer would recreate the exact
-- split this migration exists to end — so it is made read-only at the database, not merely by
-- convention. Service-role writers bypass RLS, hence a trigger rather than a policy.
create or replace function public.tg_todos_are_closed()
returns trigger
language plpgsql as $$
begin
  raise exception
    'todos is retired — a to-do is now a planned snag: problems(kind=''snag'', is_planned=true, deadline). See 20260713000001.'
    using errcode = '0A000';
end $$;

drop trigger if exists todos_no_new_writes on public.todos;
create trigger todos_no_new_writes
  before insert or update on public.todos
  for each row execute function public.tg_todos_are_closed();

comment on table public.todos is
  'RETIRED 2026-07-13 — folded into problems(kind=snag, is_planned). Read-only archive; see problems.legacy_todo_id.';

notify pgrst, 'reload schema';

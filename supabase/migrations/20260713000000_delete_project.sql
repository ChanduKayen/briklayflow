-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- DELETING A PROJECT
--
-- Until now there was no way to. The UI fired a raw `delete from projects` and Postgres stopped it
-- at the first foreign key that does not cascade — `work_orders_project_id_fkey` was simply the
-- first one it reached; there are at least seven more behind it (po_grn RESTRICT, po_items,
-- material_requests, client_invoices, purchase_requests, purchase_orders, transactions).
--
-- THE BLOCKERS ARE ALMOST ALL FINANCIAL, AND THAT IS NOT AN ACCIDENT. A goods-receipt note, a
-- purchase order, a work order and an invoice are records that MONEY MOVED. Whoever wrote
-- `po_grn ... on delete restrict` meant it. So this migration does NOT blanket-cascade them, which
-- would turn "delete project" into a button that quietly destroys an accounting trail. Instead:
--
--   · delete_project_preflight() COUNTS what a delete would destroy, and names it.
--   · delete_project() refuses while any protected (financial) child exists — unless the caller
--     passes p_force, having been shown exactly what they are about to lose.
--
-- AND IT CLOSES THE OTHER LEAK. problems / todos / site_narrations / siteops_unplaced /
-- wa_message_map are `on delete set null`: they never BLOCKED a delete, they SURVIVED it, as rows
-- with a null project — invisible in every UI, still owned by the org, still being chased by the
-- follow-up cron. Those are project-scoped rows; when the project dies, they die. Fixed below.
--
-- DEFENSIVE ON PURPOSE. work_orders, purchase_orders, transactions, txn_allocations and
-- wo_milestones have NO DDL in this repo — they were created by hand in the dashboard. So every
-- statement here is guarded by to_regclass / information_schema: this migration must be correct on a
-- database it cannot fully see, and it must not fail on one where a table simply is not there.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

-- ══ 1. THE ORPHAN LEAK: project-scoped rows now die WITH the project ══════════════════════════════
-- (nullable stays nullable — a problem can still be unplaced. This changes only what happens when
--  the project it belongs to is deleted.)
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('problems',          'problems_project_id_fkey'),
      ('todos',             'todos_project_id_fkey'),
      ('site_narrations',   'site_narrations_project_id_fkey'),
      ('siteops_unplaced',  'siteops_unplaced_project_id_fkey'),
      ('wa_message_map',    'wa_message_map_project_id_fkey')
    ) as v(tbl, con)
  loop
    if to_regclass('public.' || t.tbl) is not null then
      execute format('alter table public.%I drop constraint if exists %I', t.tbl, t.con);
      execute format(
        'alter table public.%I add constraint %I foreign key (project_id)
           references public.projects(project_id) on delete cascade',
        t.tbl, t.con);
    end if;
  end loop;
end $$;


-- ══ 2. PREFLIGHT: what would this delete destroy? ═════════════════════════════════════════════════
--
-- Returns a jsonb the UI can read out loud:
--   { "ok": true }                                              -- nothing protected; safe to delete
--   { "ok": false, "blocked": [ {"what":"work orders","count":3}, ... ] }
--
-- "Protected" means financial: a record that money moved. Everything else (tasks, problems, photos,
-- narrations) is site chatter and goes without asking.
create or replace function public.delete_project_preflight(p_project_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id   uuid;
  v_blocked  jsonb := '[]'::jsonb;
  v_count    bigint;
  t          record;
begin
  select org_id into v_org_id from public.projects where project_id = p_project_id;
  if v_org_id is null then
    raise exception 'project % not found', p_project_id using errcode = 'P0002';
  end if;

  -- ONLY A PRINCIPAL. Deleting a project is not an operational act.
  if not public.has_role(auth.uid(), v_org_id, 'principal') then
    raise exception 'only a principal can delete a project' using errcode = '42501';
  end if;

  for t in
    select * from (values
      ('work_orders',       'project_id',    'work orders'),
      ('purchase_orders',   'project_id',    'purchase orders'),
      ('po_grn',            'project_id',    'goods receipts'),
      ('po_items',          'project_id',    'PO line items'),
      ('material_requests', 'project_id',    'material requests'),
      ('purchase_requests', 'site_id',       'purchase requests'),
      ('client_invoices',   'project_id',    'client invoices'),
      ('transactions',      'project_id',    'transactions'),
      ('txn_allocations',   'project_id',    'transaction allocations'),
      ('project_budgets',   'project_id',    'budgets')
    ) as v(tbl, col, label)
  loop
    -- the table may not exist here, and the column may not be the one we think: ask, do not assume
    if to_regclass('public.' || t.tbl) is not null
       and exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = t.tbl and column_name = t.col
       )
    then
      execute format('select count(*) from public.%I where %I = $1', t.tbl, t.col)
        into v_count using p_project_id;
      if v_count > 0 then
        v_blocked := v_blocked || jsonb_build_object('what', t.label, 'count', v_count);
      end if;
    end if;
  end loop;

  if jsonb_array_length(v_blocked) = 0 then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'blocked', v_blocked);
end $$;


-- ══ 3. THE CHILD-SWEEPER ═════════════════════════════════════════════════════════════════════════
--
-- STOP GUESSING COLUMN NAMES — ASK THE CATALOG.
--
-- I first wrote the wo_milestones step by hand, assuming `work_orders.work_order_id`. The column is
-- `wo_id`, the delete failed, and it would have failed again on the next dashboard-made table whose
-- shape I cannot read from the repo. So this does not guess: given a parent table, it finds every
-- child that references it with a NON-cascading foreign key — by name, from pg_constraint — and
-- deletes that child's rows for this project, through whatever columns the FK actually uses.
--
-- Children whose FK already cascades are left alone: deleting the parent takes them.
create or replace function public.sweep_children_of(p_parent text, p_project_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if to_regclass('public.' || p_parent) is null then return; end if;

  -- the parent must itself be reachable from a project, or there is nothing to scope the sweep to
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_parent and column_name = 'project_id'
  ) then
    return;
  end if;

  for r in
    select cl.relname       as child,
           att.attname      as child_col,
           patt.attname     as parent_col
    from pg_constraint con
    join pg_class  cl   on cl.oid = con.conrelid
    join pg_class  par  on par.oid = con.confrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    join lateral unnest(con.conkey)  with ordinality as k(attnum, ord)  on true
    join lateral unnest(con.confkey) with ordinality as f(attnum, ord)  on f.ord = k.ord
    join pg_attribute att  on att.attrelid  = con.conrelid  and att.attnum  = k.attnum
    join pg_attribute patt on patt.attrelid = con.confrelid and patt.attnum = f.attnum
    where con.contype = 'f'
      and par.relname = p_parent
      and ns.nspname  = 'public'
      and con.confdeltype in ('a', 'r')          -- NO ACTION / RESTRICT — the ones that would block
  loop
    execute format(
      'delete from public.%I where %I in (select %I from public.%I where project_id = $1)',
      r.child, r.child_col, r.parent_col, p_parent)
      using p_project_id;
  end loop;
end $$;

revoke all on function public.sweep_children_of(text, text) from public;


-- ══ 4. THE DELETE ════════════════════════════════════════════════════════════════════════════════
--
-- One transaction. Children first, in dependency order, then the project. p_force is the second
-- confirmation: it does not skip the preflight, it ANSWERS it — the caller has been shown the
-- financial records by name and has said yes anyway.
create or replace function public.delete_project(p_project_id text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id  uuid;
  v_pre     jsonb;
  v_name    text;
  t         record;
begin
  select org_id, name into v_org_id, v_name from public.projects where project_id = p_project_id;
  if v_org_id is null then
    raise exception 'project % not found', p_project_id using errcode = 'P0002';
  end if;
  if not public.has_role(auth.uid(), v_org_id, 'principal') then
    raise exception 'only a principal can delete a project' using errcode = '42501';
  end if;

  -- LOOK BEFORE YOU LEAP, EVERY TIME. Even a forced delete runs the preflight, so the caller gets
  -- back a truthful record of what it destroyed rather than a bare "done".
  v_pre := public.delete_project_preflight(p_project_id);
  if not (v_pre->>'ok')::boolean and not p_force then
    return v_pre;                                  -- refused, and it says exactly why
  end if;

  -- ── children, in dependency order ──────────────────────────────────────────────────────────────
  --
  -- Each row: the table, and the column by which IT belongs to a project. Before deleting any of
  -- them, sweep_children_of() clears whatever hangs off it with a non-cascading FK (wo_milestones
  -- off work_orders, and anything else the dashboard put there that this repo has never seen).
  -- Grandchildren whose FK already cascades — po_items→purchase_orders, po_grn_items→po_grn,
  -- mr_items→material_requests, client_payments→client_invoices, site_task_qc/comments→site_tasks,
  -- followup_events→problems — need no help: their parent takes them.
  for t in
    select * from (values
      -- money moves first: allocations before the transactions they point at
      (1,  'txn_allocations',        'project_id'),
      (2,  'transactions',           'project_id'),
      (3,  'work_orders',            'project_id'),
      (4,  'po_grn',                 'project_id'),
      (5,  'po_items',               'project_id'),
      (6,  'purchase_orders',        'project_id'),
      (7,  'material_requests',      'project_id'),
      (8,  'purchase_request_items', 'site_override'),
      (9,  'purchase_requests',      'site_id'),
      (10, 'client_invoices',        'project_id'),
      (11, 'project_budgets',        'project_id'),
      -- then the site. These cascade from `projects` after section 1, but they are deleted
      -- explicitly so this function is still correct on a database where section 1 has not run.
      (12, 'site_tasks',             'project_id'),
      (13, 'problems',               'project_id'),
      (14, 'todos',                  'project_id'),
      (15, 'siteops_unplaced',       'project_id'),
      (16, 'wa_message_map',         'project_id'),
      (17, 'site_narrations',        'project_id'),
      (18, 'site_ref_counters',      'project_id'),
      (19, 'rough_entries',          'project_id')
      -- STAKEHOLDERS ARE NOT ON THIS LIST, ON PURPOSE. A vendor is the ORG's, not the project's —
      -- he works on the next site too. Deleting a project must never delete the people you buy from.
    ) as v(ord, tbl, col)
    order by ord
  loop
    continue when to_regclass('public.' || t.tbl) is null;
    continue when not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t.tbl and column_name = t.col
    );

    perform public.sweep_children_of(t.tbl, p_project_id);   -- whatever hangs off it, by name
    execute format('delete from public.%I where %I = $1', t.tbl, t.col) using p_project_id;
  end loop;

  delete from public.projects where project_id = p_project_id;

  return jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object('project_id', p_project_id, 'name', v_name),
    'destroyed', coalesce(v_pre->'blocked', '[]'::jsonb)   -- what the force actually cost
  );
exception
  when foreign_key_violation then
    -- A table we do not know about is holding on. Say so — do NOT pretend the project is gone.
    raise exception
      'Could not delete %: something still references it (%). Tell the team — a table is missing from delete_project().',
      p_project_id, SQLERRM
      using errcode = '23503';
end $$;

revoke all on function public.delete_project_preflight(text) from public;
revoke all on function public.delete_project(text, boolean) from public;
grant execute on function public.delete_project_preflight(text) to authenticated;
grant execute on function public.delete_project(text, boolean) to authenticated;

comment on function public.delete_project(text, boolean) is
  'Delete a project and its children. Refuses while financial records exist unless p_force. Principal only.';

-- PostgREST caches the schema. Without this, the function exists and the app still cannot see it:
-- "Could not find the function public.delete_project(p_force, p_project_id) in the schema cache".
notify pgrst, 'reload schema';

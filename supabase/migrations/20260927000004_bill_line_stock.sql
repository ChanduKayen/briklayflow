-- ─────────────────────────────────────────────────────────────────────────────
-- STOCK — bills feed stock: resolve each bill line to a material.
--
-- A bill's lines (bills.lines jsonb: {name, spec, unit, qty, rate, amount}) start life as
-- raw vendor wording. The Stock page's "N bill lines need a material" queue lets the buyer
-- say once what each line is: a material (its quantity enters stock as a 'bill' movement),
-- an expense (a consumable — recorded, no stock), or a skip. A resolution is recorded per
-- line so it leaves the queue whichever way it went, and can't be materialised twice.
--
-- DESIGN NOTE: a bill is NOT proof of physical receipt — so a bill-sourced stock movement is
-- kind='bill' (distinct from a GRN receipt), and the resolve is an explicit per-line confirm.
-- GRN receipts remain the authoritative "arrived at site" signal.
--
-- ROLLBACK:
--   drop function if exists public.resolve_bill_line(uuid,uuid,int,text,text,text,numeric,numeric);
--   drop view if exists public.v_bill_lines_unresolved;
--   drop table if exists public.bill_line_resolutions;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bill_line_resolutions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  bill_id        uuid not null references public.bills(id) on delete cascade,
  line_index     int  not null,
  action         text not null check (action in ('material', 'expense', 'skip')),
  material_name  text,
  unit           text,
  stock_entry_id uuid references public.stock_ledger(entry_id) on delete set null,
  resolved_by    uuid,
  resolved_at    timestamptz not null default now(),
  unique (bill_id, line_index)
);
create index if not exists bill_line_resolutions_org_idx on public.bill_line_resolutions (org_id);

alter table public.bill_line_resolutions enable row level security;
drop policy if exists "bill_line_resolutions read" on public.bill_line_resolutions;
create policy "bill_line_resolutions read" on public.bill_line_resolutions for select
  using (org_id in (select public.get_my_org_ids()));
-- Writes go through resolve_bill_line (SECURITY DEFINER); no direct client insert policy.

-- Every UNRESOLVED bill line, with its vendor + (site) — the resolve queue reads this.
create or replace view public.v_bill_lines_unresolved
with (security_invoker = true) as
select
  b.id            as bill_id,
  b.org_id,
  b.project_id,
  b.stakeholder_id,
  b.bill_no,
  b.bill_date,
  b.created_at    as bill_created_at,
  st.name         as vendor_name,
  st.category     as vendor_category,
  (x.ord - 1)     as line_index,
  x.ln->>'name'   as raw_name,
  x.ln->>'spec'   as spec,
  x.ln->>'unit'   as unit,
  nullif(x.ln->>'qty', '')::numeric    as qty,
  nullif(x.ln->>'rate', '')::numeric   as rate,
  nullif(x.ln->>'amount', '')::numeric as amount
from public.bills b
join public.stakeholders st on st.stakeholder_id = b.stakeholder_id
cross join lateral jsonb_array_elements(coalesce(b.lines, '[]'::jsonb)) with ordinality as x(ln, ord)
where coalesce(x.ln->>'name', '') <> ''
  and not exists (
    select 1 from public.bill_line_resolutions r
    where r.bill_id = b.id and r.line_index = (x.ord - 1)
  );

-- Resolve one bill line. 'material' brings its quantity into stock (a 'bill' movement on the bill's site);
-- 'expense'/'skip' just record the decision. Idempotent on (bill_id, line_index).
create or replace function public.resolve_bill_line(
  p_org_id       uuid,
  p_bill_id      uuid,
  p_line_index   int,
  p_action       text,
  p_material_name text default null,
  p_unit         text default null,
  p_qty          numeric default null,
  p_rate         numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project text; v_bill_org uuid; v_entry uuid;
begin
  if p_org_id not in (select public.get_my_org_ids()) then
    return jsonb_build_object('ok', false, 'error', 'Access denied');
  end if;
  if p_action not in ('material', 'expense', 'skip') then
    return jsonb_build_object('ok', false, 'error', 'invalid action');
  end if;

  select org_id, project_id into v_bill_org, v_project from public.bills where id = p_bill_id;
  if v_bill_org is null or v_bill_org <> p_org_id then
    return jsonb_build_object('ok', false, 'error', 'bill not found');
  end if;

  -- Already resolved? Stay idempotent — the queue simply drops it.
  if exists (select 1 from public.bill_line_resolutions where bill_id = p_bill_id and line_index = p_line_index) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_action = 'material' then
    if coalesce(btrim(p_material_name), '') = '' or coalesce(p_qty, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'a material and a positive quantity are required');
    end if;
    if v_project is null then
      return jsonb_build_object('ok', false, 'error', 'this bill has no site — set the site on the bill first');
    end if;
    insert into public.stock_ledger (org_id, project_id, item_name, unit, qty, direction, kind, unit_rate, ref_type, ref_id, created_by)
    values (p_org_id, v_project, btrim(p_material_name), nullif(btrim(coalesce(p_unit, '')), ''), p_qty, 'in', 'bill', p_rate, 'bill', p_bill_id::text, auth.uid())
    returning entry_id into v_entry;
  end if;

  insert into public.bill_line_resolutions (org_id, bill_id, line_index, action, material_name, unit, stock_entry_id, resolved_by)
  values (p_org_id, p_bill_id, p_line_index, p_action,
          case when p_action = 'material' then btrim(p_material_name) else null end,
          case when p_action = 'material' then nullif(btrim(coalesce(p_unit, '')), '') else null end,
          v_entry, auth.uid());

  return jsonb_build_object('ok', true, 'stock_entry_id', v_entry);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.resolve_bill_line(uuid,uuid,int,text,text,text,numeric,numeric) from anon, public;
grant  execute on function public.resolve_bill_line(uuid,uuid,int,text,text,text,numeric,numeric) to authenticated;

notify pgrst, 'reload schema';

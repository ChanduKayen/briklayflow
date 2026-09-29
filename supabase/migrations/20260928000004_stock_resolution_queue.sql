-- ─────────────────────────────────────────────────────────────────────────────
-- STOCK — the doubtful inbox. Received goods that couldn't be confidently resolved
-- wait here for a human to clarify; everything clear goes straight to stock.
--
-- Receive actions (a bill's "Receive stock" button, or a GRN) write the arrived quantity
-- to stock_ledger immediately (so on-hand is right), then triage resolves each item:
--   · confident match to an existing material  → identity attached, done
--   · clean unambiguous read, no match          → enriched identity auto-created, done
--   · AMBIGUOUS (vague read, or a near-tie)      → a row here, shown in the panel
-- One row per (site, raw name, unit). Resolving it adopts the identity onto the matching
-- unmapped stock rows (or expenses them) and clears the row.
--
-- ROLLBACK:
--   drop function if exists public.resolve_stock_queue(uuid,text,uuid,text,text,text,text,text,text);
--   drop function if exists public.enqueue_stock_resolution(uuid,text,text,text,text,text,numeric,numeric,jsonb,jsonb);
--   drop function if exists public.receive_bill_into_stock(uuid);
--   alter table public.bills drop column if exists stock_received_at;
--   drop table if exists public.stock_resolution_queue;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.stock_resolution_queue (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  project_id  text not null,
  source      text not null default 'bill',        -- 'bill' | 'grn' | 'manual'
  source_ref  text,                                 -- bill_id / grn_id
  raw_name    text not null,
  unit        text,
  qty         numeric,                              -- arrived quantity awaiting a name (for display)
  rate        numeric,
  canonical   jsonb,                                -- observe-never-invent read {item,variant,dimension,grade,unit,category}
  candidates  jsonb,                                -- [{inventory_id, display_name, confidence}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists stock_resolution_queue_key
  on public.stock_resolution_queue (org_id, project_id, lower(btrim(raw_name)), coalesce(unit, ''));
create index if not exists stock_resolution_queue_proj on public.stock_resolution_queue (org_id, project_id);

alter table public.stock_resolution_queue enable row level security;
drop policy if exists "stock_resolution_queue read" on public.stock_resolution_queue;
create policy "stock_resolution_queue read" on public.stock_resolution_queue for select
  using (org_id in (select public.get_my_org_ids()));
-- Writes go through the SECURITY DEFINER RPCs below.

alter table public.bills add column if not exists stock_received_at timestamptz;

-- ── Receive a bill's goods into stock (unmapped); triage names them afterwards. ──
-- Idempotent per bill via bills.stock_received_at. Only lines with a name + positive qty.
create or replace function public.receive_bill_into_stock(p_bill_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_proj text; v_when timestamptz; x record; v_added int := 0;
begin
  select org_id, project_id, stock_received_at into v_org, v_proj, v_when from public.bills where id = p_bill_id;
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'bill not found'); end if;
  if v_org not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  if v_proj is null then return jsonb_build_object('ok', false, 'error', 'this bill has no site — set the site on the bill first'); end if;
  if v_when is not null then return jsonb_build_object('ok', true, 'already', true); end if;

  for x in
    select ln->>'name' as name, ln->>'unit' as unit,
           nullif(ln->>'qty', '')::numeric as qty, nullif(ln->>'rate', '')::numeric as rate
    from jsonb_array_elements(coalesce((select lines from public.bills where id = p_bill_id), '[]'::jsonb)) as ln
    where coalesce(ln->>'name', '') <> '' and coalesce(nullif(ln->>'qty', '')::numeric, 0) > 0
  loop
    insert into public.stock_ledger (org_id, project_id, item_name, unit, qty, direction, kind, unit_rate, ref_type, ref_id, created_by)
    values (v_org, v_proj, btrim(x.name), nullif(btrim(coalesce(x.unit, '')), ''), x.qty, 'in', 'bill', x.rate, 'bill', p_bill_id::text, auth.uid());
    v_added := v_added + 1;
  end loop;

  update public.bills set stock_received_at = now() where id = p_bill_id;
  return jsonb_build_object('ok', true, 'project_id', v_proj, 'added', v_added);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.receive_bill_into_stock(uuid) from anon, public;
grant  execute on function public.receive_bill_into_stock(uuid) to authenticated;

-- ── Triage enqueues an AMBIGUOUS arrival here (upsert on the site+name+unit key). ──
create or replace function public.enqueue_stock_resolution(
  p_org_id uuid, p_project_id text, p_source text, p_source_ref text,
  p_raw_name text, p_unit text, p_qty numeric, p_rate numeric,
  p_canonical jsonb, p_candidates jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_org_id not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  if coalesce(btrim(coalesce(p_raw_name, '')), '') = '' then return jsonb_build_object('ok', false, 'error', 'raw_name required'); end if;
  insert into public.stock_resolution_queue (org_id, project_id, source, source_ref, raw_name, unit, qty, rate, canonical, candidates)
  values (p_org_id, p_project_id, coalesce(p_source, 'bill'), p_source_ref, btrim(p_raw_name), nullif(btrim(coalesce(p_unit, '')), ''), p_qty, p_rate, p_canonical, p_candidates)
  on conflict (org_id, project_id, lower(btrim(raw_name)), coalesce(unit, ''))
  do update set qty = excluded.qty, rate = excluded.rate, canonical = excluded.canonical, candidates = excluded.candidates, updated_at = now();
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.enqueue_stock_resolution(uuid,text,text,text,text,text,numeric,numeric,jsonb,jsonb) from anon, public;
grant  execute on function public.enqueue_stock_resolution(uuid,text,text,text,text,text,numeric,numeric,jsonb,jsonb) to authenticated;

-- ── Resolve one queued item: attach an identity (existing or new) to the matching
--    unmapped stock rows, or expense them away. Then clear the queue row. ──
create or replace function public.resolve_stock_queue(
  p_id           uuid,
  p_action       text,                         -- 'material' | 'expense'
  p_inventory_id uuid    default null,         -- existing identity to attach
  p_item         text    default null,         -- or create-from-buckets
  p_variant      text    default null,
  p_dimension    text    default null,
  p_grade        text    default null,
  p_category     text    default null,
  p_unit         text    default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare q record; v_inv uuid; v_n int;
begin
  select * into q from public.stock_resolution_queue where id = p_id;
  if q.id is null then return jsonb_build_object('ok', true, 'already', true); end if;
  if q.org_id not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;

  if p_action = 'expense' then
    delete from public.stock_ledger
     where org_id = q.org_id and project_id = q.project_id and inventory_id is null
       and lower(btrim(item_name)) = lower(btrim(q.raw_name)) and coalesce(unit, '') = coalesce(q.unit, '');
    delete from public.stock_resolution_queue where id = p_id;
    return jsonb_build_object('ok', true, 'expensed', true);
  end if;

  if p_action <> 'material' then return jsonb_build_object('ok', false, 'error', 'invalid action'); end if;

  if p_inventory_id is not null then
    if not exists (select 1 from public.inventory_items where inventory_id = p_inventory_id and org_id = q.org_id) then
      return jsonb_build_object('ok', false, 'error', 'material not found');
    end if;
    v_inv := p_inventory_id;
  else
    if coalesce(btrim(coalesce(p_item, '')), '') = '' then return jsonb_build_object('ok', false, 'error', 'a material is required'); end if;
    v_inv := public.create_inventory_item(q.org_id, p_item, p_variant, p_dimension, p_grade, p_category, coalesce(p_unit, q.unit), q.raw_name, null);
  end if;

  perform public.append_inventory_alias(v_inv, q.raw_name);
  update public.stock_ledger
     set inventory_id = v_inv
   where org_id = q.org_id and project_id = q.project_id and inventory_id is null
     and lower(btrim(item_name)) = lower(btrim(q.raw_name)) and coalesce(unit, '') = coalesce(q.unit, '');
  get diagnostics v_n = row_count;

  delete from public.stock_resolution_queue where id = p_id;
  return jsonb_build_object('ok', true, 'inventory_id', v_inv, 'rows', v_n);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.resolve_stock_queue(uuid,text,uuid,text,text,text,text,text,text) from anon, public;
grant  execute on function public.resolve_stock_queue(uuid,text,uuid,text,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';

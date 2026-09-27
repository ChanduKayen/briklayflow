-- ─────────────────────────────────────────────────────────────────────────────
-- INVENTORY — matching, commit-to-stock, and folding the stock view on identity.
--
-- 1. inventory_match  — org-scoped trgm/word-similarity search over inventory_items
--    (+ their aliases). A direct mirror of trgm_match_sku's scoring, pointed at the
--    per-org master instead of the global sku_directory. This is the algorithmic
--    "candidate finder" the resolver ranks; category is a SOFT boost, never a filter.
--
-- 2. commit_bill_line — the inventory-aware successor to resolve_bill_line. A 'material'
--    line writes a 'bill' stock movement CARRYING inventory_id (creating the material
--    from its buckets if needed), learns the raw wording as an alias, and records the
--    resolution. 'expense'/'skip' just record the decision. Idempotent per (bill,line).
--
-- 3. v_stock_material — now folds on inventory_id when a row has one (else on name+unit,
--    exactly as before). Mapped duplicates collapse into one material shown by its
--    display_name and standard unit; unmapped rows are unchanged. Adds inventory_id so
--    the page can read a material's ledger by identity.
--
-- ROLLBACK:
--   drop function if exists public.commit_bill_line(uuid,uuid,int,text,uuid,text,numeric,numeric,text,text,text,text,text,text);
--   drop function if exists public.inventory_match(uuid,text,text,int,float);
--   (restore v_stock_material from 20260927000003_stock_material_view.sql)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Candidate finder ────────────────────────────────────────────────────────
create or replace function public.inventory_match(
  p_org_id      uuid,
  p_search_term text,
  p_category    text  default null,
  p_limit       int   default 6,
  p_threshold   float default 0.10
)
returns table (
  inventory_id uuid,
  display_name text,
  item         text,
  variant      text,
  dimension    text,
  grade        text,
  category     text,
  unit         text,
  aliases      text,
  similarity   float
)
language sql security definer stable set search_path = public as $$
  with scored as (
    select
      i.inventory_id, i.display_name, i.item, i.variant, i.dimension, i.grade, i.category, i.unit,
      array_to_string(i.aliases, ', ') as aliases,
      greatest(
        similarity(coalesce(i.display_name, i.item),                 p_search_term),
        similarity(i.item,                                           p_search_term),
        word_similarity(p_search_term, coalesce(i.display_name, i.item) || ' ' || array_to_string(i.aliases, ' ')),
        coalesce((
          select max(greatest(
                   similarity(lower(a), lower(p_search_term)),
                   word_similarity(lower(p_search_term), lower(a))
                 ))
          from unnest(i.aliases) a), 0.0)
      )
      -- category is a soft hint: a match in the same category gets a small nudge, never a filter.
      + case when p_category is not null and lower(coalesce(i.category, '')) = lower(p_category) then 0.05 else 0.0 end
        as sim
    from public.inventory_items i
    where i.org_id = p_org_id
      and i.org_id in (select public.get_my_org_ids())
  )
  select inventory_id, display_name, item, variant, dimension, grade, category, unit, aliases,
         least(1.0, sim)::float as similarity
  from scored
  where sim > p_threshold
  order by sim desc
  limit p_limit;
$$;
revoke execute on function public.inventory_match(uuid,text,text,int,float) from anon, public;
grant  execute on function public.inventory_match(uuid,text,text,int,float) to authenticated;

-- ── 2. Commit a bill line to stock, carrying identity ──────────────────────────
create or replace function public.commit_bill_line(
  p_org_id       uuid,
  p_bill_id      uuid,
  p_line_index   int,
  p_action       text,                         -- material | expense | skip
  p_inventory_id uuid    default null,         -- an existing material to map to
  p_raw_name     text    default null,         -- the vendor's wording (kept + learned as alias)
  p_qty          numeric default null,
  p_rate         numeric default null,
  -- create-from-buckets (used when action='material' and p_inventory_id is null):
  p_item         text default null,
  p_variant      text default null,
  p_dimension    text default null,
  p_grade        text default null,
  p_category     text default null,
  p_unit         text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bill_org uuid; v_project text; v_inv uuid; v_unit text; v_name text; v_entry uuid;
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

  -- Idempotent — the queue simply drops an already-resolved line.
  if exists (select 1 from public.bill_line_resolutions where bill_id = p_bill_id and line_index = p_line_index) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_action = 'material' then
    if v_project is null then
      return jsonb_build_object('ok', false, 'error', 'this bill has no site — set the site on the bill first');
    end if;
    if coalesce(p_qty, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'a positive quantity is required');
    end if;

    if p_inventory_id is not null then
      if not exists (select 1 from public.inventory_items where inventory_id = p_inventory_id and org_id = p_org_id) then
        return jsonb_build_object('ok', false, 'error', 'material not found');
      end if;
      v_inv := p_inventory_id;
      if coalesce(btrim(coalesce(p_raw_name, '')), '') <> '' then perform public.append_inventory_alias(v_inv, p_raw_name); end if;
    else
      if coalesce(btrim(coalesce(p_item, '')), '') = '' then
        return jsonb_build_object('ok', false, 'error', 'a material is required');
      end if;
      v_inv := public.create_inventory_item(p_org_id, p_item, p_variant, p_dimension, p_grade, p_category, p_unit, p_raw_name, null);
    end if;

    select unit, item into v_unit, v_name from public.inventory_items where inventory_id = v_inv;
    v_unit := coalesce(nullif(btrim(coalesce(p_unit, '')), ''), v_unit);   -- explicit unit wins, else the standard unit
    v_name := coalesce(nullif(btrim(coalesce(p_raw_name, '')), ''), v_name);

    insert into public.stock_ledger (org_id, project_id, item_name, unit, qty, direction, kind, unit_rate, ref_type, ref_id, inventory_id, created_by)
    values (p_org_id, v_project, v_name, v_unit, p_qty, 'in', 'bill', p_rate, 'bill', p_bill_id::text, v_inv, auth.uid())
    returning entry_id into v_entry;
  end if;

  insert into public.bill_line_resolutions (org_id, bill_id, line_index, action, material_name, unit, stock_entry_id, inventory_id, resolved_by)
  values (p_org_id, p_bill_id, p_line_index, p_action,
          case when p_action = 'material' then (select item from public.inventory_items where inventory_id = v_inv) else null end,
          case when p_action = 'material' then v_unit else null end,
          v_entry, v_inv, auth.uid());

  return jsonb_build_object('ok', true, 'stock_entry_id', v_entry, 'inventory_id', v_inv);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.commit_bill_line(uuid,uuid,int,text,uuid,text,numeric,numeric,text,text,text,text,text,text) from anon, public;
grant  execute on function public.commit_bill_line(uuid,uuid,int,text,uuid,text,numeric,numeric,text,text,text,text,text,text) to authenticated;

-- ── 2b. Manual movements (+Arrived / −Used) can carry the identity too ──────────
-- Extends record_stock_movement with an optional inventory_id so a manual adjustment on a
-- MAPPED material folds onto it instead of splitting back out under the raw name+unit.
drop function if exists public.record_stock_movement(uuid,text,text,text,numeric,text,numeric,text);
create or replace function public.record_stock_movement(
  p_org_id       uuid,
  p_project_id   text,
  p_item_name    text,
  p_unit         text,
  p_qty          numeric,
  p_direction    text,                        -- 'in' (arrived) | 'out' (used)
  p_unit_rate    numeric default null,
  p_note         text    default null,
  p_inventory_id uuid    default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_org_id not in (select public.get_my_org_ids()) then
    return jsonb_build_object('ok', false, 'error', 'Access denied');
  end if;
  if p_direction not in ('in', 'out') then
    return jsonb_build_object('ok', false, 'error', 'direction must be in or out');
  end if;
  if coalesce(p_qty, 0) <= 0 or coalesce(btrim(p_item_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'a positive quantity and an item are required');
  end if;
  if p_inventory_id is not null and not exists (
       select 1 from public.inventory_items where inventory_id = p_inventory_id and org_id = p_org_id) then
    return jsonb_build_object('ok', false, 'error', 'material not found');
  end if;

  insert into public.stock_ledger (org_id, project_id, item_name, unit, qty, direction, kind, unit_rate, note, inventory_id, created_by)
  values (p_org_id, p_project_id, btrim(p_item_name), nullif(btrim(coalesce(p_unit, '')), ''), p_qty, p_direction,
          case p_direction when 'in' then 'manual_in' else 'issue' end, p_unit_rate, nullif(btrim(coalesce(p_note, '')), ''), p_inventory_id, auth.uid())
  returning entry_id into v_id;

  return jsonb_build_object('ok', true, 'entry_id', v_id);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.record_stock_movement(uuid,text,text,text,numeric,text,numeric,text,uuid) from anon, public;
grant  execute on function public.record_stock_movement(uuid,text,text,text,numeric,text,numeric,text,uuid) to authenticated;

-- ── 3. Fold the stock view on identity ─────────────────────────────────────────
-- Dropped + recreated (not CREATE OR REPLACE): the new inventory_id column sits mid-list,
-- and REPLACE can only append columns at the end. Only the Stock page reads this view.
drop view if exists public.v_stock_material;
create view public.v_stock_material
with (security_invoker = true) as
with base as (
  select
    s.org_id, s.project_id, s.item_name, s.unit, s.qty, s.direction, s.unit_rate, s.created_at,
    s.kind, s.po_line_item_id, s.inventory_id,
    li.specification as spec,
    li.brand         as brand,
    st.category      as vendor_category
  from public.stock_ledger s
  left join public.po_line_items  li on li.id = s.po_line_item_id
  left join public.purchase_orders po on po.po_id = li.po_id
  left join public.stakeholders   st on st.stakeholder_id = po.stakeholder_id
),
keyed as (
  select b.*,
    -- fold on the identity when present, else on the old name+unit key (no regression)
    coalesce(b.inventory_id::text, lower(btrim(b.item_name)) || '|' || coalesce(b.unit, '')) as fold_key
  from base b
)
select
  k.org_id,
  k.project_id,
  k.fold_key                                                            as item_key,
  k.inventory_id                                                        as inventory_id,
  coalesce(inv.display_name, max(k.item_name))                         as item_name,
  coalesce(inv.unit, max(k.unit))                                       as unit,
  coalesce(sum(k.qty) filter (where k.direction = 'in'), 0)
    - coalesce(sum(k.qty) filter (where k.direction = 'out'), 0)        as on_hand,
  coalesce(sum(k.qty) filter (where k.direction = 'in'), 0)            as total_in,
  coalesce(sum(k.qty) filter (where k.direction = 'out'), 0)           as total_out,
  coalesce(sum(k.qty * coalesce(k.unit_rate, 0)) filter (where k.direction = 'in'), 0)
    - coalesce(sum(k.qty * coalesce(k.unit_rate, 0)) filter (where k.direction = 'out'), 0) as stock_value,
  case when coalesce(sum(k.qty) filter (where k.direction = 'in'), 0) > 0
       then coalesce(sum(k.qty * coalesce(k.unit_rate, 0)) filter (where k.direction = 'in'), 0) / sum(k.qty) filter (where k.direction = 'in')
       else null end                                                    as avg_rate,
  max(k.created_at)                                                     as last_movement_at,
  (array_agg(k.created_at order by k.created_at desc) filter (where k.direction = 'in'))[1] as last_delivery_at,
  (array_agg(k.qty        order by k.created_at desc) filter (where k.direction = 'in'))[1] as last_delivery_qty,
  coalesce(inv.category, (array_remove(array_agg(k.vendor_category order by k.created_at desc), null))[1]) as category,
  (array_remove(array_agg(k.spec  order by k.created_at desc), null))[1] as spec,
  (array_remove(array_agg(k.brand order by k.created_at desc), null))[1] as brand
from keyed k
left join public.inventory_items inv on inv.inventory_id = k.inventory_id
group by k.org_id, k.project_id, k.fold_key, k.inventory_id, inv.display_name, inv.unit, inv.category;

notify pgrst, 'reload schema';

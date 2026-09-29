-- ─────────────────────────────────────────────────────────────────────────────
-- STOCK PAGE v2 — the data the redesigned page needs.
--
-- Adds a low-stock alert level per material, exposes aliases + "used since the last
-- delivery" on the material view (for the row's since-bar and the "N days left" read),
-- and a delete RPC (removes a material and its movements, on confirm) + an alert setter.
--
-- ROLLBACK:
--   drop function if exists public.delete_inventory_item(uuid,uuid);
--   drop function if exists public.set_material_alert(uuid,uuid,numeric);
--   alter table public.inventory_items drop column if exists alert_qty;
--   (restore v_stock_material from 20260928000000_stock_category_unify.sql)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.inventory_items add column if not exists alert_qty numeric;

-- ── v_stock_material — now carries inventory_id's aliases, the alert level, and the
--    quantity used since the most recent delivery (for the since-bar / days-left). ──
create or replace view public.v_stock_material
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
    coalesce(b.inventory_id::text, lower(btrim(b.item_name)) || '|' || coalesce(b.unit, '')) as fold_key
  from base b
),
win as (
  select k.*,
    max(k.created_at) filter (where k.direction = 'in') over (partition by k.org_id, k.project_id, k.fold_key) as last_in_at
  from keyed k
)
select
  w.org_id,
  w.project_id,
  w.fold_key                                                            as item_key,
  w.inventory_id                                                        as inventory_id,
  coalesce(inv.display_name, max(w.item_name))                         as item_name,
  coalesce(inv.unit, max(w.unit))                                       as unit,
  coalesce(sum(w.qty) filter (where w.direction = 'in'), 0)
    - coalesce(sum(w.qty) filter (where w.direction = 'out'), 0)        as on_hand,
  coalesce(sum(w.qty) filter (where w.direction = 'in'), 0)            as total_in,
  coalesce(sum(w.qty) filter (where w.direction = 'out'), 0)           as total_out,
  coalesce(sum(w.qty) filter (where w.direction = 'out' and w.created_at >= w.last_in_at), 0) as used_since,
  coalesce(sum(w.qty * coalesce(w.unit_rate, 0)) filter (where w.direction = 'in'), 0)
    - coalesce(sum(w.qty * coalesce(w.unit_rate, 0)) filter (where w.direction = 'out'), 0) as stock_value,
  case when coalesce(sum(w.qty) filter (where w.direction = 'in'), 0) > 0
       then coalesce(sum(w.qty * coalesce(w.unit_rate, 0)) filter (where w.direction = 'in'), 0) / sum(w.qty) filter (where w.direction = 'in')
       else null end                                                    as avg_rate,
  max(w.created_at)                                                     as last_movement_at,
  (array_agg(w.created_at order by w.created_at desc) filter (where w.direction = 'in'))[1] as last_delivery_at,
  (array_agg(w.qty        order by w.created_at desc) filter (where w.direction = 'in'))[1] as last_delivery_qty,
  coalesce(
    inv.category,
    public.vendor_to_material_category((array_remove(array_agg(w.vendor_category order by w.created_at desc), null))[1])
  )                                                                     as category,
  (array_remove(array_agg(w.spec  order by w.created_at desc), null))[1] as spec,
  (array_remove(array_agg(w.brand order by w.created_at desc), null))[1] as brand,
  inv.alert_qty                                                         as alert_qty,
  coalesce(inv.aliases, '{}')                                          as aliases
from win w
left join public.inventory_items inv on inv.inventory_id = w.inventory_id
group by w.org_id, w.project_id, w.fold_key, w.inventory_id, inv.display_name, inv.unit, inv.category, inv.alert_qty, inv.aliases;

-- ── Set (or clear) a material's low-stock alert level. ──
create or replace function public.set_material_alert(p_org_id uuid, p_inventory_id uuid, p_alert numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_org_id not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  update public.inventory_items set alert_qty = case when coalesce(p_alert, 0) > 0 then p_alert else null end, updated_at = now()
   where inventory_id = p_inventory_id and org_id = p_org_id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.set_material_alert(uuid,uuid,numeric) from anon, public;
grant  execute on function public.set_material_alert(uuid,uuid,numeric) to authenticated;

-- ── Quick rename (item name only — keeps the specs) and unit change. ──
create or replace function public.rename_inventory_item(p_org_id uuid, p_inventory_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_org_id not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  if coalesce(btrim(coalesce(p_name, '')), '') = '' then return jsonb_build_object('ok', false, 'error', 'a name is required'); end if;
  update public.inventory_items set item = btrim(p_name), aliases = case when exists (select 1 from unnest(aliases) a where lower(btrim(a)) = lower(btrim(item))) then aliases else aliases || array[item] end, updated_at = now()
   where inventory_id = p_inventory_id and org_id = p_org_id;
  return jsonb_build_object('ok', true);
exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end $$;
revoke execute on function public.rename_inventory_item(uuid,uuid,text) from anon, public;
grant  execute on function public.rename_inventory_item(uuid,uuid,text) to authenticated;

create or replace function public.set_material_unit(p_org_id uuid, p_inventory_id uuid, p_unit text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_org_id not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  update public.inventory_items set unit = nullif(btrim(coalesce(p_unit, '')), ''), updated_at = now()
   where inventory_id = p_inventory_id and org_id = p_org_id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.set_material_unit(uuid,uuid,text) from anon, public;
grant  execute on function public.set_material_unit(uuid,uuid,text) to authenticated;

-- ── Delete a material: removes the identity and its stock movements at this site. ──
create or replace function public.delete_inventory_item(p_org_id uuid, p_inventory_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_moved int;
begin
  if p_org_id not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  if not exists (select 1 from public.inventory_items where inventory_id = p_inventory_id and org_id = p_org_id) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  delete from public.stock_ledger where inventory_id = p_inventory_id and org_id = p_org_id;
  get diagnostics v_moved = row_count;
  delete from public.inventory_items where inventory_id = p_inventory_id and org_id = p_org_id;
  return jsonb_build_object('ok', true, 'removed_movements', v_moved);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.delete_inventory_item(uuid,uuid) from anon, public;
grant  execute on function public.delete_inventory_item(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';

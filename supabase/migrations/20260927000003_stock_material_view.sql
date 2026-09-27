-- ─────────────────────────────────────────────────────────────────────────────
-- STOCK — the Stock page's data: one row per material on a site, and a movement RPC.
--
-- v_stock_material aggregates stock_ledger into what the page shows per material: on-hand,
-- value, average received rate, last delivery (date + qty), used-since, the supplying
-- VENDOR'S category (for the category rail/grouping) and the spec from its PO line.
--
-- record_stock_movement lets the page's +Arrived / −Used pills post a manual movement
-- (a stock-in / issue, distinct from a GRN receipt) and have on-hand update at once.
--
-- ROLLBACK:
--   drop function if exists public.record_stock_movement(uuid,text,text,text,numeric,text,numeric,text);
--   drop view if exists public.v_stock_material;
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.v_stock_material
with (security_invoker = true) as
with base as (
  select
    s.org_id, s.project_id,
    lower(btrim(s.item_name)) as item_key,
    s.item_name, s.unit, s.qty, s.direction, s.unit_rate, s.created_at, s.kind, s.po_line_item_id,
    li.specification as spec,
    li.brand        as brand,
    st.category     as vendor_category
  from public.stock_ledger s
  left join public.po_line_items  li on li.id = s.po_line_item_id
  left join public.purchase_orders po on po.po_id = li.po_id
  left join public.stakeholders   st on st.stakeholder_id = po.stakeholder_id
)
select
  org_id,
  project_id,
  item_key,
  max(item_name)                                                       as item_name,
  unit,
  coalesce(sum(qty) filter (where direction = 'in'), 0)
    - coalesce(sum(qty) filter (where direction = 'out'), 0)           as on_hand,
  coalesce(sum(qty) filter (where direction = 'in'), 0)               as total_in,
  coalesce(sum(qty) filter (where direction = 'out'), 0)              as total_out,
  coalesce(sum(qty * coalesce(unit_rate, 0)) filter (where direction = 'in'), 0)
    - coalesce(sum(qty * coalesce(unit_rate, 0)) filter (where direction = 'out'), 0) as stock_value,
  case when coalesce(sum(qty) filter (where direction = 'in'), 0) > 0
       then coalesce(sum(qty * coalesce(unit_rate, 0)) filter (where direction = 'in'), 0) / sum(qty) filter (where direction = 'in')
       else null end                                                   as avg_rate,
  max(created_at)                                                      as last_movement_at,
  (array_agg(created_at order by created_at desc) filter (where direction = 'in'))[1] as last_delivery_at,
  (array_agg(qty        order by created_at desc) filter (where direction = 'in'))[1] as last_delivery_qty,
  (array_remove(array_agg(vendor_category order by created_at desc), null))[1]        as category,
  (array_remove(array_agg(spec            order by created_at desc), null))[1]        as spec,
  (array_remove(array_agg(brand           order by created_at desc), null))[1]        as brand
from base
group by org_id, project_id, item_key, unit;

-- A manual stock movement from the Stock page (+Arrived / −Used). Distinct from a GRN receipt.
create or replace function public.record_stock_movement(
  p_org_id     uuid,
  p_project_id text,
  p_item_name  text,
  p_unit       text,
  p_qty        numeric,
  p_direction  text,                 -- 'in' (arrived) | 'out' (used)
  p_unit_rate  numeric default null,
  p_note       text    default null
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

  insert into public.stock_ledger (org_id, project_id, item_name, unit, qty, direction, kind, unit_rate, note, created_by)
  values (p_org_id, p_project_id, btrim(p_item_name), nullif(btrim(coalesce(p_unit, '')), ''), p_qty, p_direction,
          case p_direction when 'in' then 'manual_in' else 'issue' end, p_unit_rate, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning entry_id into v_id;

  return jsonb_build_object('ok', true, 'entry_id', v_id);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.record_stock_movement(uuid,text,text,text,numeric,text,numeric,text) from anon, public;
grant  execute on function public.record_stock_movement(uuid,text,text,text,numeric,text,numeric,text) to authenticated;

notify pgrst, 'reload schema';

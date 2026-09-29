-- ─────────────────────────────────────────────────────────────────────────────
-- STOCK — one category vocabulary for the rail.
--
-- v_stock_material.category was coalesce(inventory category, raw VENDOR TRADE). A mapped
-- material shows the clean material category ("Cement"); an unmapped one showed the
-- supplier's trade ("Cement Supplier") — the SAME group under two labels, so the category
-- rail split into duplicates ("Cement" vs "Cement Supplier", "Steel" vs "Steel / TMT Bar
-- Supplier", ...).
--
-- Fix: normalize the vendor trade to the material category the inventory already uses
-- (the first sku_directory category each trade supplies, mirroring the resolver's
-- VENDOR_TO_SKU_CATEGORIES). Now both a mapped and an unmapped cement row read "Cement".
--
-- ROLLBACK: restore v_stock_material from 20260927000006_inventory_match_commit.sql;
--           drop function if exists public.vendor_to_material_category(text);
-- ─────────────────────────────────────────────────────────────────────────────

-- Maps every MATERIAL-supplying vendor trade (src/lib/trades.ts ALL_VENDOR_TRADES) onto the
-- rail's material vocabulary (the 18 sku_directory categories, so mapped + unmapped unify).
-- Dual suppliers resolve to the primary (Sand & Aggregate → Aggregate; Bricks / Blocks → Brick).
-- Everything else — services, labour, transport, furniture, décor, consultants, fuel — is NOT a
-- material trade and keeps its own label (the else branch), so it stays its own rail group.
create or replace function public.vendor_to_material_category(p text)
returns text language sql immutable as $$
  select case lower(btrim(coalesce(p, '')))
    -- Building Materials
    when 'cement supplier'                              then 'Cement'
    when 'ready mix concrete (rmc) plant'                then 'Cement'
    when 'sand & aggregate supplier'                     then 'Aggregate'
    when 'bricks / blocks supplier'                      then 'Brick'
    when 'steel / tmt bar supplier'                      then 'Steel'
    when 'waterproofing materials supplier'              then 'Waterproofing'
    when 'admixture supplier'                            then 'Admixture'
    -- Finishing Materials
    when 'tiles supplier'                                then 'Tile'
    when 'marble / granite supplier'                     then 'Tile'
    when 'flooring materials supplier'                   then 'Tile'
    when 'paint supplier'                                then 'Paint'
    when 'hardware & fittings supplier'                  then 'Hardware'
    when 'glass & aluminium supplier'                    then 'Glass'
    when 'false ceiling materials supplier'              then 'Hardware'
    -- MEP Materials
    when 'electrical materials supplier'                 then 'Electrical'
    when 'plumbing materials supplier'                   then 'Plumbing'
    when 'hvac materials supplier'                       then 'Electrical'
    when 'sanitary ware supplier'                        then 'Plumbing'
    when 'lighting supplier'                             then 'Electrical'
    when 'cables & conduits supplier'                    then 'Electrical'
    -- Carpentry & Woodwork (material suppliers only; the contractors/CNC keep their own label)
    when 'wood & plywood supplier'                       then 'Plywood'
    when 'laminate & veneer supplier'                    then 'Plywood'
    when 'hardware fittings supplier (hinges / channels)' then 'Hardware'
    when 'wood polish & lacquer supplier'                then 'Paint'
    -- Interior / Décor material suppliers (the designers/contractors keep their own label)
    when 'decorative laminates supplier'                 then 'Plywood'
    when 'wallpaper / wall texture vendor'               then 'Paint'
    when 'decorative lighting supplier'                  then 'Electrical'
    -- Machinery & Equipment (only the two that sell hardware; rental/fuel keep their own label)
    when 'scaffolding supplier'                          then 'Hardware'
    when 'tools & machinery vendor'                      then 'Hardware'
    else nullif(btrim(p), '')   -- non-material trade: keep its own label
  end
$$;

-- Recreate the view with the normalized category (columns/order unchanged → REPLACE is fine).
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
  coalesce(
    inv.category,
    public.vendor_to_material_category((array_remove(array_agg(k.vendor_category order by k.created_at desc), null))[1])
  )                                                                     as category,
  (array_remove(array_agg(k.spec  order by k.created_at desc), null))[1] as spec,
  (array_remove(array_agg(k.brand order by k.created_at desc), null))[1] as brand
from keyed k
left join public.inventory_items inv on inv.inventory_id = k.inventory_id
group by k.org_id, k.project_id, k.fold_key, k.inventory_id, inv.display_name, inv.unit, inv.category;

notify pgrst, 'reload schema';

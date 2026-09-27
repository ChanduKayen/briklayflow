-- ─────────────────────────────────────────────────────────────────────────────
-- INVENTORY — one-time backfill: seed the org master from resolved POs, for free.
--
-- Every PO line the org already resolved carries a global sku_id whose five parts
-- decompose cleanly into our four buckets. So we can seed a high-quality per-org base
-- with NO LLM: one inventory_item per (org, sku_id), buckets + unit + sku_id link from
-- sku_directory, and aliases seeded from the actual vendor wordings that resolved there
-- (so the cheap-match path works from minute one). Then we stamp inventory_id onto the
-- existing GRN stock rows via po_line_item_id, so received stock de-duplicates at once.
--
-- Bill/manual stock rows keep inventory_id NULL and map lazily through the resolve queue.
-- Idempotent: re-running inserts nothing new and stamps only still-null rows.
--
-- ROLLBACK (only if you want to undo the seed — destructive to learned aliases):
--   update public.stock_ledger set inventory_id = null where inventory_id is not null;
--   delete from public.inventory_items where sku_id is not null;
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Seed materials from distinct resolved (org, sku_id) pairs.
insert into public.inventory_items (org_id, item, variant, dimension, grade, category, unit, aliases, sku_id)
select
  li.org_id,
  sd.sub_category,
  sd.variant,
  sd.dimension,
  sd.grade,
  sd.category,
  sd.standard_unit,
  coalesce((
    select array_agg(distinct btrim(v))
    from unnest(array_agg(li.item_name)) v
    where coalesce(btrim(v), '') <> ''
  ), '{}'),
  li.sku_id
from public.po_line_items li
join public.sku_directory sd on sd.sku_id = li.sku_id
where li.sku_id is not null
group by li.org_id, li.sku_id, sd.sub_category, sd.variant, sd.dimension, sd.grade, sd.category, sd.standard_unit
on conflict (org_id, public.inv_norm(item), public.inv_norm(variant), public.inv_norm(dimension), public.inv_norm(grade))
do nothing;

-- 2. Attach the identity to existing GRN stock rows (received goods), where still unmapped.
update public.stock_ledger s
set inventory_id = inv.inventory_id
from public.po_line_items li
join public.inventory_items inv on inv.org_id = li.org_id and inv.sku_id = li.sku_id
where s.po_line_item_id = li.id
  and s.inventory_id is null
  and li.sku_id is not null;

notify pgrst, 'reload schema';

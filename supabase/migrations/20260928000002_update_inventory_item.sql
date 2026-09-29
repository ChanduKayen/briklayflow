-- ─────────────────────────────────────────────────────────────────────────────
-- INVENTORY — edit a material's identity: fix the buckets, set the standard unit,
-- curate the aliases.
--
-- The unit is an attribute of the identity, so setting it here is the "edit stock units to
-- a standard" control — v_stock_material shows inv.unit for a mapped row, so the change is
-- immediate. display_name is generated, so it rebuilds from the edited buckets automatically.
--
-- Guards the identity: refuses an edit that would collide the four buckets with ANOTHER of
-- the org's materials (that case is a merge, a separate tool — not an edit).
--
-- ROLLBACK: drop function if exists public.update_inventory_item(uuid,uuid,text,text,text,text,text,text,text[]);
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.update_inventory_item(
  p_inventory_id uuid,
  p_org_id       uuid,
  p_item         text,
  p_variant      text    default null,
  p_dimension    text    default null,
  p_grade        text    default null,
  p_category     text    default null,
  p_unit         text    default null,
  p_aliases      text[]  default null   -- null = leave aliases unchanged; else replace with this set
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_org_id not in (select public.get_my_org_ids()) then
    return jsonb_build_object('ok', false, 'error', 'Access denied');
  end if;
  if not exists (select 1 from public.inventory_items where inventory_id = p_inventory_id and org_id = p_org_id) then
    return jsonb_build_object('ok', false, 'error', 'material not found');
  end if;
  if coalesce(btrim(coalesce(p_item, '')), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'a material name is required');
  end if;

  -- Would the new buckets collide with a different material? That's a merge, not an edit.
  if exists (
    select 1 from public.inventory_items
     where org_id = p_org_id
       and inventory_id <> p_inventory_id
       and public.inv_norm(item)      = public.inv_norm(p_item)
       and public.inv_norm(variant)   = public.inv_norm(p_variant)
       and public.inv_norm(dimension) = public.inv_norm(p_dimension)
       and public.inv_norm(grade)     = public.inv_norm(p_grade)
  ) then
    return jsonb_build_object('ok', false, 'error', 'Another material already has these details — merge them instead');
  end if;

  update public.inventory_items set
    item      = btrim(p_item),
    variant   = nullif(btrim(coalesce(p_variant, '')), ''),
    dimension = nullif(btrim(coalesce(p_dimension, '')), ''),
    grade     = nullif(btrim(coalesce(p_grade, '')), ''),
    category  = nullif(btrim(coalesce(p_category, '')), ''),
    unit      = nullif(btrim(coalesce(p_unit, '')), ''),
    aliases   = case when p_aliases is null then aliases
                     else coalesce((select array_agg(distinct btrim(a))
                                    from unnest(p_aliases) a
                                    where coalesce(btrim(a), '') <> ''), '{}') end,
    updated_at = now()
  where inventory_id = p_inventory_id and org_id = p_org_id;

  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.update_inventory_item(uuid,uuid,text,text,text,text,text,text,text[]) from anon, public;
grant  execute on function public.update_inventory_item(uuid,uuid,text,text,text,text,text,text,text[]) to authenticated;

notify pgrst, 'reload schema';

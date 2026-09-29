-- ─────────────────────────────────────────────────────────────────────────────
-- INVENTORY — merge two materials into one.
--
-- Auto-create is faithful to the words on the bill, so it can mint a near-duplicate
-- ("Iron 12mm" beside "TMT Bar 12mm"). This folds one identity into another: all its
-- stock movements and resolutions repoint to the target, its wordings become the target's
-- aliases (so future bills match the survivor), and the merged identity is deleted.
--
-- ROLLBACK: drop function if exists public.merge_inventory_items(uuid,uuid,uuid);
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.merge_inventory_items(
  p_org_id uuid,
  p_from   uuid,   -- the duplicate to fold away
  p_into   uuid    -- the material that survives
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_from record; v_into record; v_moved int;
begin
  if p_org_id not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  if p_from = p_into then return jsonb_build_object('ok', false, 'error', 'pick a different material'); end if;

  select * into v_from from public.inventory_items where inventory_id = p_from and org_id = p_org_id;
  select * into v_into from public.inventory_items where inventory_id = p_into and org_id = p_org_id;
  if v_from.inventory_id is null or v_into.inventory_id is null then return jsonb_build_object('ok', false, 'error', 'material not found'); end if;

  -- repoint everything that pointed at the duplicate
  update public.stock_ledger          set inventory_id = p_into where inventory_id = p_from and org_id = p_org_id;
  get diagnostics v_moved = row_count;
  update public.bill_line_resolutions set inventory_id = p_into where inventory_id = p_from and org_id = p_org_id;

  -- fold the duplicate's wordings into the survivor's aliases (its name + display too), deduped
  update public.inventory_items set
    aliases = (
      select coalesce(array_agg(distinct x), '{}')
      from (
        select btrim(unnest(
          coalesce(v_into.aliases, '{}') || coalesce(v_from.aliases, '{}')
          || array[v_from.item] || array[coalesce(v_from.display_name, '')]
        )) as x
      ) s
      where coalesce(btrim(x), '') <> ''
    ),
    updated_at = now()
  where inventory_id = p_into;

  delete from public.inventory_items where inventory_id = p_from and org_id = p_org_id;

  return jsonb_build_object('ok', true, 'moved', v_moved);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.merge_inventory_items(uuid,uuid,uuid) from anon, public;
grant  execute on function public.merge_inventory_items(uuid,uuid,uuid) to authenticated;

notify pgrst, 'reload schema';

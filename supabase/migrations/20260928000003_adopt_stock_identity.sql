-- ─────────────────────────────────────────────────────────────────────────────
-- INVENTORY — adopt raw stock rows onto the identities the enricher resolved.
--
-- inventory-enrich canonicalizes each un-identified stock row (observe, never invent) and
-- returns { item_name, unit, inventory_id }. This RPC stamps that inventory_id onto every
-- still-unmapped stock_ledger row on the site whose raw name + unit match — folding the raw
-- rows into the clean identity. Idempotent: only touches rows where inventory_id is null.
--
-- ROLLBACK: drop function if exists public.adopt_stock_identity(uuid,text,jsonb);
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.adopt_stock_identity(
  p_org_id     uuid,
  p_project_id text,
  p_map        jsonb   -- [{ "item_name": "...", "unit": "...", "inventory_id": "uuid" }, ...]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare e jsonb; v_inv uuid; v_total int := 0; v_n int;
begin
  if p_org_id not in (select public.get_my_org_ids()) then
    return jsonb_build_object('ok', false, 'error', 'Access denied');
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) loop
    v_inv := nullif(e->>'inventory_id', '')::uuid;
    if v_inv is null then continue; end if;
    -- the identity must belong to this org
    if not exists (select 1 from public.inventory_items where inventory_id = v_inv and org_id = p_org_id) then continue; end if;

    update public.stock_ledger
       set inventory_id = v_inv
     where org_id = p_org_id
       and project_id = p_project_id
       and inventory_id is null
       and lower(btrim(item_name)) = lower(btrim(e->>'item_name'))
       and coalesce(unit, '') = coalesce(e->>'unit', '');
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  return jsonb_build_object('ok', true, 'updated', v_total);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.adopt_stock_identity(uuid,text,jsonb) from anon, public;
grant  execute on function public.adopt_stock_identity(uuid,text,jsonb) to authenticated;

notify pgrst, 'reload schema';

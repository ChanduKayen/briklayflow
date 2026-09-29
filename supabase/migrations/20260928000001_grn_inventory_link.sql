-- ─────────────────────────────────────────────────────────────────────────────
-- STOCK — goods received at site land on a clean inventory identity.
--
-- Bills flow through the resolver (→ inventory_id), but GRN receipts wrote stock the old
-- way: free-text name + unit, no identity. That was masked by the one-time backfill; after
-- a fresh start, NEW receipts would come back in as unmapped junk ("12 MM Iron", Nos).
--
-- A received PO line already carries a global sku_id whose five parts decompose straight
-- into our four buckets — so create_grn can find-or-create the org's inventory item from it
-- (no LLM) and stamp inventory_id on the movement. Received stock is then clean by
-- construction, and receipts of the same material fold onto one row.
--
-- ROLLBACK: restore create_grn from 20260927000000_stock_ledger.sql;
--           drop function if exists public.ensure_inventory_from_sku(uuid,text,text);
-- ─────────────────────────────────────────────────────────────────────────────

-- Find-or-create the org's inventory item for a resolved sku_id (buckets from sku_directory).
-- Returns null when there's no sku_id or the sku isn't found — the receipt still succeeds.
create or replace function public.ensure_inventory_from_sku(
  p_org_id uuid,
  p_sku_id text,
  p_alias  text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare sd record; v_id uuid;
begin
  if coalesce(btrim(coalesce(p_sku_id, '')), '') = '' then return null; end if;
  select category, sub_category, dimension, variant, grade, standard_unit
    into sd from public.sku_directory where sku_id = p_sku_id;
  if not found then return null; end if;
  v_id := public.create_inventory_item(
            p_org_id, sd.sub_category, sd.variant, sd.dimension, sd.grade,
            sd.category, sd.standard_unit, p_alias, p_sku_id);
  return v_id;
end $$;
revoke execute on function public.ensure_inventory_from_sku(uuid,text,text) from anon, public;
grant  execute on function public.ensure_inventory_from_sku(uuid,text,text) to authenticated;

-- ── Recreate create_grn — identical to 20260927000000, but each GOOD line's stock movement
--    now carries inventory_id resolved from the PO line's sku_id (best-effort). ──
create or replace function public.create_grn(
  p_org_id         uuid,
  p_po_id          text,
  p_project_id     text,
  p_stakeholder_id text,
  p_receipt_date   date,
  p_dc_number      text,
  p_vehicle_number text,
  p_driver_name    text,
  p_remarks        text,
  p_received_by    uuid,
  p_items          jsonb
) returns table (grn_id text, success boolean, error text)
language plpgsql security definer as $$
declare
  v_grn_id    text;
  v_item      jsonb;
  v_condition text;
  v_qty       numeric;
  v_inv       uuid;
begin
  if p_org_id not in (select public.get_my_org_ids()) then
    return query select null::text, false, 'Access denied';
    return;
  end if;

  v_grn_id := public.generate_grn_id(p_org_id, p_project_id);

  insert into public.po_grn (
    grn_id, org_id, po_id, project_id, stakeholder_id, receipt_date,
    dc_number, vehicle_number, driver_name, remarks, received_by
  ) values (
    v_grn_id, p_org_id, p_po_id, p_project_id, p_stakeholder_id, p_receipt_date,
    p_dc_number, p_vehicle_number, p_driver_name, p_remarks, p_received_by
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_condition := coalesce(nullif(v_item->>'condition', ''), 'good');
    v_qty       := (v_item->>'qty_received')::numeric;

    insert into public.po_grn_items (
      grn_id, org_id, po_line_item_id, item_name, unit,
      qty_ordered, qty_received, unit_rate, condition, remarks
    ) values (
      v_grn_id, p_org_id, nullif(v_item->>'po_line_item_id', '')::uuid,
      v_item->>'item_name', v_item->>'unit',
      (v_item->>'qty_ordered')::numeric, v_qty,
      nullif(v_item->>'unit_rate', '')::numeric, v_condition, nullif(v_item->>'remarks', '')
    );

    -- Goods received in good condition become stock on this site, on their inventory identity.
    if v_condition = 'good' and coalesce(v_qty, 0) > 0 then
      v_inv := null;
      begin
        v_inv := public.ensure_inventory_from_sku(
          p_org_id,
          (select sku_id from public.po_line_items where id = nullif(v_item->>'po_line_item_id', '')::uuid),
          v_item->>'item_name'
        );
      exception when others then
        v_inv := null;   -- never let identity resolution break a receipt
      end;

      insert into public.stock_ledger (
        org_id, project_id, item_name, unit, qty, direction, kind, condition,
        unit_rate, ref_type, ref_id, po_line_item_id, inventory_id, created_by
      ) values (
        p_org_id, p_project_id, v_item->>'item_name', v_item->>'unit', v_qty, 'in', 'grn_receipt', 'good',
        nullif(v_item->>'unit_rate', '')::numeric, 'grn', v_grn_id, nullif(v_item->>'po_line_item_id', '')::uuid, v_inv, p_received_by
      );
    end if;
  end loop;

  return query select v_grn_id, true, null::text;

exception when others then
  return query select null::text, false, sqlerrm;
end;
$$;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- BILLS → STOCK — confirm a bill's delivery from the Bills page (no PO).
--
-- The Bills page "Reached site?" panel lets the office confirm what actually reached the
-- site, line by line (short amounts allowed), then writes the same kind of stock receipt the
-- PO/GRN path writes — kind='bill', on the bill's site. Idempotent-ish: sets stock_received_at
-- once. (PO-linked bills go through the PO receive panel instead.)
--
-- ROLLBACK: drop function if exists public.receive_bill_lines(uuid,jsonb,text,text);
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.receive_bill_lines(
  p_bill_id uuid,
  p_items   jsonb,   -- [{ "name": "...", "unit": "...", "qty": <received>, "rate": <n> }, ...]
  p_challan text default null,
  p_notes   text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_proj text; x jsonb; v_qty numeric; v_added int := 0;
begin
  select org_id, project_id into v_org, v_proj from public.bills where id = p_bill_id;
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'bill not found'); end if;
  if v_org not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  if v_proj is null then return jsonb_build_object('ok', false, 'error', 'this bill has no site — set the site on the bill first'); end if;

  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_qty := nullif(x->>'qty', '')::numeric;
    if coalesce(v_qty, 0) > 0 and coalesce(x->>'name', '') <> '' then
      insert into public.stock_ledger (org_id, project_id, item_name, unit, qty, direction, kind, unit_rate, note, ref_type, ref_id, created_by)
      values (v_org, v_proj, btrim(x->>'name'), nullif(btrim(coalesce(x->>'unit', '')), ''), v_qty, 'in', 'bill',
              nullif(x->>'rate', '')::numeric, nullif(btrim(coalesce(p_notes, '')), ''), 'bill', p_bill_id::text, auth.uid());
      v_added := v_added + 1;
    end if;
  end loop;

  update public.bills set stock_received_at = coalesce(stock_received_at, now()) where id = p_bill_id;
  return jsonb_build_object('ok', true, 'project_id', v_proj, 'added', v_added);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.receive_bill_lines(uuid,jsonb,text,text) from anon, public;
grant  execute on function public.receive_bill_lines(uuid,jsonb,text,text) to authenticated;

notify pgrst, 'reload schema';

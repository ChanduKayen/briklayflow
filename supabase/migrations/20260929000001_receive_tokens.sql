-- ─────────────────────────────────────────────────────────────────────────────
-- SUPERVISOR RECEIVE LINK — the "Ask Raju" flow (phase B).
--
-- The office taps "Ask Raju" → create_receive_token mints a one-time link. Raju opens it on
-- his phone (public, no login: /receive/<token>), confirms what came, and sends. The submit
-- writes a GRN exactly like the office panel — → stock, identity attached from the PO's sku.
-- The token is the authority (no org membership needed); load/submit are granted to anon.
--
-- ROLLBACK:
--   drop function if exists public.receive_token_submit(text,jsonb,text,text);
--   drop function if exists public.receive_token_load(text);
--   drop function if exists public.create_receive_token(uuid,text);
--   drop table if exists public.receive_tokens;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.receive_tokens (
  token          text primary key,
  org_id         uuid not null,
  po_id          text not null,
  project_id     text not null,
  stakeholder_id text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '7 days',
  used_at        timestamptz,
  grn_id         text
);
alter table public.receive_tokens enable row level security;
-- No direct policies — reached only through the SECURITY DEFINER RPCs below.

-- ── Office: mint a link for a PO. ──
create or replace function public.create_receive_token(p_org_id uuid, p_po_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tok text; v_org uuid; v_proj text; v_stk text;
begin
  if p_org_id not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  select org_id, project_id, stakeholder_id into v_org, v_proj, v_stk from public.purchase_orders where po_id = p_po_id;
  if v_org is null or v_org <> p_org_id then return jsonb_build_object('ok', false, 'error', 'PO not found'); end if;
  v_tok := replace(gen_random_uuid()::text, '-', '');
  insert into public.receive_tokens (token, org_id, po_id, project_id, stakeholder_id, created_by)
  values (v_tok, p_org_id, p_po_id, v_proj, v_stk, auth.uid());
  return jsonb_build_object('ok', true, 'token', v_tok);
end $$;
revoke execute on function public.create_receive_token(uuid,text) from anon, public;
grant  execute on function public.create_receive_token(uuid,text) to authenticated;

-- ── Public: what Raju sees — the PO's lines, ordered vs already received. ──
create or replace function public.receive_token_load(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; v_vendor text; v_site text; v_items jsonb;
begin
  select * into t from public.receive_tokens where token = p_token;
  if t.token is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'This link has expired.'); end if;

  select name into v_vendor from public.stakeholders where stakeholder_id = t.stakeholder_id;
  select name into v_site   from public.projects     where project_id = t.project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'po_line_item_id', li.id, 'item_name', li.item_name, 'unit', coalesce(li.unit, 'Nos'),
           'quantity_ordered', li.quantity_ordered, 'unit_rate', li.unit_rate,
           'received_so_far', coalesce((select sum(g.qty_received) from public.po_grn_items g where g.po_line_item_id = li.id), 0)
         ) order by li.line_number), '[]'::jsonb)
    into v_items
  from public.po_line_items li where li.po_id = t.po_id;

  return jsonb_build_object('ok', true, 'used', t.used_at is not null, 'po_id', t.po_id,
    'vendor', coalesce(v_vendor, 'Vendor'), 'site', v_site, 'items', v_items);
end $$;
revoke execute on function public.receive_token_load(text) from public;
grant  execute on function public.receive_token_load(text) to anon, authenticated;

-- ── Public: Raju sends what came → writes a GRN (→ stock), marks the link used. ──
create or replace function public.receive_token_submit(p_token text, p_items jsonb, p_challan text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; v_grn text; v_item jsonb; v_qty numeric; v_inv uuid; v_sku text;
begin
  select * into t from public.receive_tokens where token = p_token for update;
  if t.token is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'This link has expired.'); end if;
  if t.used_at is not null then return jsonb_build_object('ok', true, 'already', true, 'grn_id', t.grn_id); end if;

  v_grn := public.generate_grn_id(t.org_id, t.project_id);
  insert into public.po_grn (grn_id, org_id, po_id, project_id, stakeholder_id, receipt_date, dc_number, remarks, received_by)
  values (v_grn, t.org_id, t.po_id, t.project_id, t.stakeholder_id, current_date, nullif(btrim(coalesce(p_challan, '')), ''), nullif(btrim(coalesce(p_notes, '')), '') , t.created_by);

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_qty := nullif(v_item->>'qty_received', '')::numeric;
    insert into public.po_grn_items (grn_id, org_id, po_line_item_id, item_name, unit, qty_ordered, qty_received, unit_rate, condition, remarks)
    values (v_grn, t.org_id, nullif(v_item->>'po_line_item_id', '')::uuid, v_item->>'item_name', v_item->>'unit',
            nullif(v_item->>'qty_ordered', '')::numeric, v_qty, nullif(v_item->>'unit_rate', '')::numeric, 'good', nullif(v_item->>'remarks', ''));

    if coalesce(v_qty, 0) > 0 then
      v_inv := null;
      begin
        select sku_id into v_sku from public.po_line_items where id = nullif(v_item->>'po_line_item_id', '')::uuid;
        v_inv := public.ensure_inventory_from_sku(t.org_id, v_sku, v_item->>'item_name');
      exception when others then v_inv := null; end;
      insert into public.stock_ledger (org_id, project_id, item_name, unit, qty, direction, kind, condition, unit_rate, ref_type, ref_id, po_line_item_id, inventory_id, created_by)
      values (t.org_id, t.project_id, v_item->>'item_name', v_item->>'unit', v_qty, 'in', 'grn_receipt', 'good',
              nullif(v_item->>'unit_rate', '')::numeric, 'grn', v_grn, nullif(v_item->>'po_line_item_id', '')::uuid, v_inv, t.created_by);
    end if;
  end loop;

  update public.receive_tokens set used_at = now(), grn_id = v_grn where token = p_token;
  return jsonb_build_object('ok', true, 'grn_id', v_grn);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.receive_token_submit(text,jsonb,text,text) from public;
grant  execute on function public.receive_token_submit(text,jsonb,text,text) to anon, authenticated;

notify pgrst, 'reload schema';

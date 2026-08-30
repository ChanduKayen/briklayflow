-- ─────────────────────────────────────────────────────────────────────────────
-- RFQ · Phase 3 — the comparison page
--
-- • rfq_recipients.source — where a quote came from ('link' | 'photo' | 'manual').
-- • rfqs write policy (finance) — so the comparison page can close / extend / cancel.
-- • rfq_by_token now returns the enquiry status; submit_rfq_quote refuses a closed
--   enquiry (ordering closes it → the vendor page stops accepting rates).
-- • add_manual_quote — record a quote captured from a photo/PDF or typed in.
--
-- ROLLBACK:
--   drop function if exists public.add_manual_quote(uuid,text,text,jsonb,jsonb);
--   drop policy if exists "rfq write" on public.rfqs;
--   alter table public.rfq_recipients drop column if exists source;
--   (re-apply the 20260831000001 versions of rfq_by_token / submit_rfq_quote)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.rfq_recipients add column if not exists source text not null default 'link';

-- Finance may update an rfq (close on order, extend the deadline, cancel).
drop policy if exists "rfq write" on public.rfqs;
create policy "rfq write" on public.rfqs for update
  using      (org_id in (select public.get_my_org_ids()) and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]))
  with check (org_id in (select public.get_my_org_ids()) and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]));

-- rfq_by_token — now returns status so the public page can show a closed enquiry.
create or replace function public.rfq_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.rfq_recipients%rowtype; v_f public.rfqs%rowtype; v_builder text; v_existing jsonb;
begin
  select * into v_r from public.rfq_recipients where token = p_token;
  if v_r.recipient_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select * into v_f from public.rfqs where rfq_id = v_r.rfq_id;
  select name into v_builder from public.organizations where org_id = v_r.org_id;

  if v_r.status = 'sent' and v_f.status = 'open' then
    update public.rfq_recipients set status = 'opened', opened_at = now() where recipient_id = v_r.recipient_id;
  end if;

  select jsonb_agg(jsonb_build_object('line', line, 'unit_rate', unit_rate, 'supplied', supplied, 'variant_note', variant_note))
    into v_existing from public.rfq_quotes where recipient_id = v_r.recipient_id;

  return jsonb_build_object(
    'ok', true,
    'ref', 'ENQ-' || upper(substr(v_r.rfq_id::text, 1, 6)),
    'status', v_f.status,
    'builder_name', coalesce(v_builder, 'The builder'),
    'vendor_name', coalesce(v_r.vendor_name, 'you'),
    'delivery_location', v_f.delivery_location,
    'quote_by', v_f.quote_by,
    'items', coalesce(v_f.items, '[]'::jsonb),
    'already_quoted', v_r.status = 'quoted',
    'extras', jsonb_build_object('transport_included', v_r.transport_included, 'gst_included', v_r.gst_included,
                                 'valid_days', v_r.valid_days, 'vendor_note', v_r.vendor_note),
    'existing', coalesce(v_existing, '[]'::jsonb)
  );
end $$;
grant execute on function public.rfq_by_token(uuid) to anon, authenticated;

-- submit_rfq_quote — refuse a closed / cancelled enquiry.
create or replace function public.submit_rfq_quote(p_token uuid, p_lines jsonb, p_extras jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.rfq_recipients%rowtype; v_status text; v_line jsonb;
begin
  select * into v_r from public.rfq_recipients where token = p_token;
  if v_r.recipient_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select status into v_status from public.rfqs where rfq_id = v_r.rfq_id;
  if v_status is distinct from 'open' then return jsonb_build_object('ok', false, 'error', 'closed'); end if;

  delete from public.rfq_quotes where recipient_id = v_r.recipient_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.rfq_quotes (recipient_id, rfq_id, org_id, line, item_name, unit_rate, supplied, variant_note)
    values (v_r.recipient_id, v_r.rfq_id, v_r.org_id, (v_line->>'line')::int, v_line->>'item_name',
            nullif(v_line->>'unit_rate', '')::numeric, coalesce((v_line->>'supplied')::boolean, true), nullif(v_line->>'variant_note', ''));
  end loop;

  update public.rfq_recipients set
    status = 'quoted', quoted_at = now(),
    transport_included = coalesce((p_extras->>'transport_included')::boolean, transport_included),
    gst_included       = coalesce((p_extras->>'gst_included')::boolean, gst_included),
    valid_days         = coalesce((p_extras->>'valid_days')::int, valid_days),
    vendor_note        = nullif(p_extras->>'vendor_note', ''),
    quoted_total       = coalesce((p_extras->>'quoted_total')::numeric, 0)
  where recipient_id = v_r.recipient_id;

  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
grant execute on function public.submit_rfq_quote(uuid, jsonb, jsonb) to anon, authenticated;

-- add_manual_quote — a quote captured from a photo/PDF or typed in by the buyer.
create or replace function public.add_manual_quote(
  p_rfq_id uuid, p_vendor_name text, p_stakeholder_id text, p_lines jsonb, p_extras jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_rid uuid; v_line jsonb;
begin
  select org_id into v_org from public.rfqs where rfq_id = p_rfq_id;
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_role_in_org(v_org, variadic array['accountant'::text,'management'::text,'principal'::text]) then
    return jsonb_build_object('ok', false, 'error', 'Access denied');
  end if;

  insert into public.rfq_recipients (rfq_id, org_id, stakeholder_id, vendor_name, status, quoted_at, source,
                                     transport_included, gst_included, valid_days, vendor_note, quoted_total)
  values (p_rfq_id, v_org, nullif(p_stakeholder_id, ''), p_vendor_name, 'quoted', now(), 'photo',
          (p_extras->>'transport_included')::boolean, (p_extras->>'gst_included')::boolean,
          (p_extras->>'valid_days')::int, nullif(p_extras->>'vendor_note', ''), coalesce((p_extras->>'quoted_total')::numeric, 0))
  returning recipient_id into v_rid;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.rfq_quotes (recipient_id, rfq_id, org_id, line, item_name, unit_rate, supplied, variant_note)
    values (v_rid, p_rfq_id, v_org, (v_line->>'line')::int, v_line->>'item_name',
            nullif(v_line->>'unit_rate', '')::numeric, coalesce((v_line->>'supplied')::boolean, true), nullif(v_line->>'variant_note', ''));
  end loop;

  return jsonb_build_object('ok', true, 'recipient_id', v_rid);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.add_manual_quote(uuid,text,text,jsonb,jsonb) from anon, public;
grant  execute on function public.add_manual_quote(uuid,text,text,jsonb,jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RFQ · add_manual_quote — allow REPLACING an existing photo quote in place.
--
-- The compare page reads a vendor quotation from a photo/PDF and lets the buyer
-- review it before saving. Re-reading to fix a mis-read used to create a SECOND
-- "Photo quote" column. This adds an optional p_recipient_id: when given (and it
-- is a photo-sourced recipient on this same enquiry), the quote is UPDATED in
-- place — its terms refreshed and its lines re-written — instead of inserted.
--
-- Signature changes (5 → 6 args, the 6th defaulted), so we drop the old function
-- first. Existing callers that pass the five named args still resolve (the sixth
-- defaults to null → insert, the previous behaviour).
--
-- ROLLBACK:
--   drop function if exists public.add_manual_quote(uuid,text,text,jsonb,jsonb,uuid);
--   (re-apply the 20260831000002 version)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.add_manual_quote(uuid, text, text, jsonb, jsonb);

create or replace function public.add_manual_quote(
  p_rfq_id uuid, p_vendor_name text, p_stakeholder_id text, p_lines jsonb, p_extras jsonb,
  p_recipient_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_rid uuid; v_line jsonb;
begin
  select org_id into v_org from public.rfqs where rfq_id = p_rfq_id;
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_role_in_org(v_org, variadic array['accountant'::text,'management'::text,'principal'::text]) then
    return jsonb_build_object('ok', false, 'error', 'Access denied');
  end if;

  if p_recipient_id is not null then
    -- Replace an existing PHOTO quote on this enquiry, in place (never a link/manual vendor's own quote).
    update public.rfq_recipients set
      vendor_name        = p_vendor_name,
      stakeholder_id     = coalesce(nullif(p_stakeholder_id, ''), stakeholder_id),
      status             = 'quoted', quoted_at = now(),
      transport_included = (p_extras->>'transport_included')::boolean,
      gst_included       = (p_extras->>'gst_included')::boolean,
      valid_days         = (p_extras->>'valid_days')::int,
      vendor_note        = nullif(p_extras->>'vendor_note', ''),
      quoted_total       = coalesce((p_extras->>'quoted_total')::numeric, 0)
    where recipient_id = p_recipient_id and rfq_id = p_rfq_id and source = 'photo'
    returning recipient_id into v_rid;
    if v_rid is null then return jsonb_build_object('ok', false, 'error', 'not_replaceable'); end if;
    delete from public.rfq_quotes where recipient_id = v_rid;
  else
    insert into public.rfq_recipients (rfq_id, org_id, stakeholder_id, vendor_name, status, quoted_at, source,
                                       transport_included, gst_included, valid_days, vendor_note, quoted_total)
    values (p_rfq_id, v_org, nullif(p_stakeholder_id, ''), p_vendor_name, 'quoted', now(), 'photo',
            (p_extras->>'transport_included')::boolean, (p_extras->>'gst_included')::boolean,
            (p_extras->>'valid_days')::int, nullif(p_extras->>'vendor_note', ''), coalesce((p_extras->>'quoted_total')::numeric, 0))
    returning recipient_id into v_rid;
  end if;

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
revoke execute on function public.add_manual_quote(uuid,text,text,jsonb,jsonb,uuid) from anon, public;
grant  execute on function public.add_manual_quote(uuid,text,text,jsonb,jsonb,uuid) to authenticated;

notify pgrst, 'reload schema';

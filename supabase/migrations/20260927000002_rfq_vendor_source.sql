-- ─────────────────────────────────────────────────────────────────────────────
-- RFQ · vendor quote reply — keep the ORIGINAL file(s), and MERGE multi-image pages.
--
-- A vendor answers an RFQ on WhatsApp with a photo / PDF of their rates. Two gaps:
--  1) The buyer never saw the paper — only the extracted numbers — so a handwritten
--     quote could not be verified. We now store the vendor's file URL(s) on the
--     recipient (source_urls) and show them on the compare page.
--  2) A quote sent as SEVERAL images arrives as several messages; submit_rfq_quote
--     replaced all lines each time, so only the last image survived. merge_rfq_quote
--     UPSERTs the lines an image priced and KEEPS the rest, so pages accumulate.
--
-- ROLLBACK:
--   drop function if exists public.merge_rfq_quote(uuid, jsonb, jsonb);
--   drop function if exists public.rfq_add_source_url(uuid, text);
--   alter table public.rfq_recipients drop column if exists source_urls;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.rfq_recipients add column if not exists source_urls text[];

-- Append a source file URL to a recipient (atomic — several pages can land at once).
create or replace function public.rfq_add_source_url(p_token uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rid uuid;
begin
  update public.rfq_recipients
     set source_urls = array_append(coalesce(source_urls, '{}'), p_url)
   where token = p_token and coalesce(p_url, '') <> ''
  returning recipient_id into v_rid;
  return jsonb_build_object('ok', v_rid is not null);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.rfq_add_source_url(uuid, text) from public;
grant  execute on function public.rfq_add_source_url(uuid, text) to anon, authenticated, service_role;

-- Merge one page's rates into a recipient's quote: UPSERT the supplied lines, leave the rest, keep terms
-- unless this page states them. Recomputes quoted_total from ALL of the recipient's lines × the enquiry qty.
create or replace function public.merge_rfq_quote(p_token uuid, p_lines jsonb, p_extras jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.rfq_recipients%rowtype; v_f public.rfqs%rowtype; v_line jsonb; v_total numeric;
begin
  select * into v_r from public.rfq_recipients where token = p_token;
  if v_r.recipient_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select * into v_f from public.rfqs where rfq_id = v_r.rfq_id;
  if v_f.status is distinct from 'open' then return jsonb_build_object('ok', false, 'error', 'closed'); end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    -- Re-price just this line (keep every other line the recipient already has).
    delete from public.rfq_quotes where recipient_id = v_r.recipient_id and line = (v_line->>'line')::int;
    insert into public.rfq_quotes (recipient_id, rfq_id, org_id, line, item_name, unit_rate, supplied, variant_note)
    values (v_r.recipient_id, v_r.rfq_id, v_r.org_id, (v_line->>'line')::int, v_line->>'item_name',
            nullif(v_line->>'unit_rate', '')::numeric, coalesce((v_line->>'supplied')::boolean, true), nullif(v_line->>'variant_note', ''));
  end loop;

  -- Recompute the all-in total from every supplied line × the enquiry's quantity for that line.
  select coalesce(sum(q.unit_rate * coalesce(itq.qty, 0)), 0) into v_total
  from public.rfq_quotes q
  left join lateral (
    select (elem->>'qty')::numeric as qty
    from jsonb_array_elements(coalesce(v_f.items, '[]'::jsonb)) elem
    where (elem->>'line')::int = q.line
    limit 1
  ) itq on true
  where q.recipient_id = v_r.recipient_id and q.supplied is true and q.unit_rate is not null;

  update public.rfq_recipients set
    status = 'quoted', quoted_at = now(),
    transport_included = coalesce((p_extras->>'transport_included')::boolean, transport_included),
    gst_included       = coalesce((p_extras->>'gst_included')::boolean, gst_included),
    valid_days         = coalesce((p_extras->>'valid_days')::int, valid_days),
    vendor_note        = coalesce(nullif(p_extras->>'vendor_note', ''), vendor_note),
    quoted_total       = v_total
  where recipient_id = v_r.recipient_id;

  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.merge_rfq_quote(uuid, jsonb, jsonb) from public;
grant  execute on function public.merge_rfq_quote(uuid, jsonb, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

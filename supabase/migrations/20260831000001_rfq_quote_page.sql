-- ─────────────────────────────────────────────────────────────────────────────
-- RFQ · Phase 2 — the public vendor quote page
--
-- Adds the per-vendor quote fields, and two token-scoped anon RPCs that power the
-- no-login page at www.briklay.app/quote/<token>: read the enquiry, submit rates.
-- These are the ONLY anon entry points — they return/write nothing beyond the one
-- RFQ the token addresses (unlike a table-level anon policy).
--
-- ROLLBACK:
--   drop function if exists public.submit_rfq_quote(uuid,jsonb,jsonb);
--   drop function if exists public.rfq_by_token(uuid);
--   alter table public.rfq_recipients drop column if exists transport_included, drop column if exists gst_included,
--     drop column if exists valid_days, drop column if exists vendor_note, drop column if exists quoted_total,
--     drop column if exists opened_at;
--   alter table public.rfq_quotes drop column if exists item_name, drop column if exists supplied, drop column if exists variant_note;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.rfq_recipients
  add column if not exists transport_included boolean,
  add column if not exists gst_included       boolean,
  add column if not exists valid_days          int,
  add column if not exists vendor_note         text,
  add column if not exists quoted_total        numeric,
  add column if not exists opened_at           timestamptz;

alter table public.rfq_quotes
  add column if not exists item_name    text,
  add column if not exists supplied     boolean not null default true,
  add column if not exists variant_note text;

-- Read the enquiry for a token (marks it opened). Returns only this RFQ's data.
create or replace function public.rfq_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.rfq_recipients%rowtype; v_f public.rfqs%rowtype; v_builder text; v_existing jsonb;
begin
  select * into v_r from public.rfq_recipients where token = p_token;
  if v_r.recipient_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select * into v_f from public.rfqs where rfq_id = v_r.rfq_id;
  select name into v_builder from public.organizations where org_id = v_r.org_id;

  if v_r.status = 'sent' then
    update public.rfq_recipients set status = 'opened', opened_at = now() where recipient_id = v_r.recipient_id;
  end if;

  select jsonb_agg(jsonb_build_object('line', line, 'unit_rate', unit_rate, 'supplied', supplied, 'variant_note', variant_note))
    into v_existing from public.rfq_quotes where recipient_id = v_r.recipient_id;

  return jsonb_build_object(
    'ok', true,
    'ref', 'ENQ-' || upper(substr(v_r.rfq_id::text, 1, 6)),
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

-- Submit (or re-submit) this vendor's rates for the token.
create or replace function public.submit_rfq_quote(p_token uuid, p_lines jsonb, p_extras jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.rfq_recipients%rowtype; v_line jsonb;
begin
  select * into v_r from public.rfq_recipients where token = p_token;
  if v_r.recipient_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  delete from public.rfq_quotes where recipient_id = v_r.recipient_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.rfq_quotes (recipient_id, rfq_id, org_id, line, item_name, unit_rate, supplied, variant_note)
    values (v_r.recipient_id, v_r.rfq_id, v_r.org_id,
            (v_line->>'line')::int, v_line->>'item_name',
            nullif(v_line->>'unit_rate', '')::numeric,
            coalesce((v_line->>'supplied')::boolean, true),
            nullif(v_line->>'variant_note', ''));
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

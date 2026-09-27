-- ─────────────────────────────────────────────────────────────────────────────
-- RFQ · negotiation round — ask a vendor to sharpen their price.
--
-- After the quotes are in, the buyer can go back to a vendor with a short message
-- and a link to REVISE their rates (the vendor page already pre-fills their last
-- quote and re-submits). This adds the builder's note + a round counter so the
-- vendor sees the message when they reopen the link, and the compare page can show
-- "asked to revise" until they send fresh rates.
--
-- The recipient keeps status = 'quoted' through a negotiation, so their current
-- quote stays in the comparison; only quoted_at moves forward when they re-submit.
--
-- ROLLBACK:
--   (restore rfq_by_token from 20260831000001_rfq_quote_page.sql)
--   alter table public.rfq_recipients
--     drop column if exists negotiation_note, drop column if exists revise_requested_at,
--     drop column if exists negotiation_round;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.rfq_recipients
  add column if not exists negotiation_note    text,
  add column if not exists revise_requested_at timestamptz,
  add column if not exists negotiation_round   int not null default 0;

-- Re-create rfq_by_token to also return the builder's negotiation note + when it was
-- asked, so the vendor page shows the message and frames the reopen as a revision.
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
    -- a live negotiation: the builder's message + whether it is newer than their last submission
    'negotiation_note', v_r.negotiation_note,
    'revise_requested', (v_r.revise_requested_at is not null
                         and (v_r.quoted_at is null or v_r.revise_requested_at > v_r.quoted_at)),
    'extras', jsonb_build_object('transport_included', v_r.transport_included, 'gst_included', v_r.gst_included,
                                 'valid_days', v_r.valid_days, 'vendor_note', v_r.vendor_note),
    'existing', coalesce(v_existing, '[]'::jsonb)
  );
end $$;
grant execute on function public.rfq_by_token(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- ===========================================================================
-- Site-Cash Wallet — pass the wallet dimension through the SPLIT insert RPC too, so a
-- wallet spend split across sites tags every split row. Identical to 20260830000004's
-- insert_split_transactions EXCEPT each row now also reads wallet_id / wallet_dir /
-- is_transfer from p_base (shared across the splits, like date/mode/category). Callers
-- that don't send them get NULL / NULL / false — exactly a plain payment, as before.
-- ===========================================================================
create or replace function public.insert_split_transactions(p_base jsonb, p_splits jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_org_id uuid;
  v_split  jsonb;
  v_txn_id text;
  v_ids    text[] := '{}';
begin
  v_org_id := (p_base->>'org_id')::uuid;

  if v_org_id not in (select public.get_my_org_ids()) then
    raise exception 'Access denied: not a member of that org';
  end if;
  if not public.has_role_in_org(v_org_id, variadic array['accountant'::text,'management'::text,'principal'::text]) then
    raise exception 'Access denied: your role may not record money';
  end if;

  if p_splits is null or jsonb_array_length(p_splits) = 0 then
    raise exception 'no splits provided';
  end if;

  for v_split in select * from jsonb_array_elements(p_splits)
  loop
    v_txn_id := v_split->>'txn_id';
    insert into public.transactions (
      txn_id, stakeholder_id, date, total_amount, payment_mode,
      category, remarks, bill_doc_url, proof_document_url,
      ai_flag_status, ai_flag_data, entered_by, org_id,
      wallet_id, wallet_dir, is_transfer
    ) values (
      v_txn_id, nullif(p_base->>'stakeholder_id', ''), (p_base->>'date')::date,
      (v_split->>'total_amount')::numeric, (p_base->>'payment_mode')::public.payment_mode,
      p_base->>'category', p_base->>'remarks', p_base->>'bill_doc_url', p_base->>'proof_document_url',
      (p_base->>'ai_flag_status')::public.ai_flag_status, coalesce(p_base->'ai_flag_data', '{}'::jsonb),
      auth.uid(), v_org_id,
      nullif(p_base->>'wallet_id','')::uuid, nullif(p_base->>'wallet_dir',''),
      coalesce((p_base->>'is_transfer')::boolean, false)
    );
    insert into public.txn_allocations (
      txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id
    ) values (
      v_txn_id, v_split->>'project_id',
      nullif(v_split->>'order_type', '')::public.order_type_enum,
      nullif(v_split->>'order_ref', ''), nullif(v_split->>'milestone_id', '')::uuid,
      (v_split->>'total_amount')::numeric, v_org_id
    );
    v_ids := array_append(v_ids, v_txn_id);
  end loop;

  return jsonb_build_object('success', true, 'txn_ids', to_jsonb(v_ids));
end;
$function$;

NOTIFY pgrst, 'reload schema';

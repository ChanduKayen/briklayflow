-- ─────────────────────────────────────────────────────────────────────────────
-- P0b · Org + role guards inside the money-write RPCs  (completes P0)
--
-- P0 revoked these from anon/public. This adds the in-body check so an authenticated
-- user can't pass a foreign org_id (or a wrong-role user can't record money) through
-- the SECURITY DEFINER path, which bypasses RLS. Full CREATE OR REPLACE of each,
-- preserving the existing body and only inserting the guard.
--   finance = accountant + management + principal
--
-- ROLLBACK: re-apply the prior definitions (the pre-guard versions from the
-- capture) — this migration only adds guard lines.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 ── insert_transaction_with_allocations : add org + role guard
create or replace function public.insert_transaction_with_allocations(p_txn jsonb, p_allocations jsonb)
returns jsonb language plpgsql security definer as $function$
declare
  v_txn_id text;
  v_org_id uuid;
  v_alloc  jsonb;
begin
  v_org_id := (p_txn->>'org_id')::uuid;

  if v_org_id not in (select public.get_my_org_ids()) then
    raise exception 'Access denied: not a member of that org';
  end if;
  if not public.has_role_in_org(v_org_id, variadic array['accountant'::text,'management'::text,'principal'::text]) then
    raise exception 'Access denied: your role may not record money';
  end if;

  insert into public.transactions (
    txn_id, stakeholder_id, date, total_amount, payment_mode,
    category, remarks, bill_doc_url, proof_document_url,
    ai_flag_status, ai_flag_data, entered_by, org_id
  ) values (
    p_txn->>'txn_id', p_txn->>'stakeholder_id', (p_txn->>'date')::date,
    (p_txn->>'total_amount')::numeric, (p_txn->>'payment_mode')::public.payment_mode,
    p_txn->>'category', p_txn->>'remarks', p_txn->>'bill_doc_url', p_txn->>'proof_document_url',
    (p_txn->>'ai_flag_status')::public.ai_flag_status, coalesce(p_txn->'ai_flag_data', '{}'::jsonb),
    auth.uid(), v_org_id
  ) returning txn_id into v_txn_id;

  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.txn_allocations (
      txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id
    ) values (
      v_txn_id, v_alloc->>'project_id',
      nullif(v_alloc->>'order_type', '')::public.order_type_enum,
      nullif(v_alloc->>'order_ref', ''), nullif(v_alloc->>'milestone_id', '')::uuid,
      (v_alloc->>'allocated_amount')::numeric, v_org_id
    );
  end loop;

  return jsonb_build_object('success', true, 'txn_id', v_txn_id);
end;
$function$;

-- 2 ── insert_split_transactions : add org + role guard
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
      ai_flag_status, ai_flag_data, entered_by, org_id
    ) values (
      v_txn_id, nullif(p_base->>'stakeholder_id', ''), (p_base->>'date')::date,
      (v_split->>'total_amount')::numeric, (p_base->>'payment_mode')::public.payment_mode,
      p_base->>'category', p_base->>'remarks', p_base->>'bill_doc_url', p_base->>'proof_document_url',
      (p_base->>'ai_flag_status')::public.ai_flag_status, coalesce(p_base->'ai_flag_data', '{}'::jsonb),
      auth.uid(), v_org_id
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

-- 3 ── import_transactions : per-row org + role guard (bad rows recorded, loop continues)
create or replace function public.import_transactions(p_rows jsonb, p_batch_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_row jsonb; v_row_no int; v_org_id uuid; v_txn_id text;
  v_uid uuid := auth.uid();
  v_inserted jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb; v_failed jsonb := '[]'::jsonb;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then raise exception 'no rows provided'; end if;
  if p_batch_id is null or p_batch_id = '' then raise exception 'a batch id is required'; end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_no := (v_row->>'row_no')::int;
    v_org_id := (v_row->>'org_id')::uuid;
    v_txn_id := null;

    if v_org_id not in (select public.get_my_org_ids())
       or not public.has_role_in_org(v_org_id, variadic array['accountant'::text,'management'::text,'principal'::text]) then
      v_failed := v_failed || jsonb_build_object('row_no', v_row_no, 'error', 'access denied for that org');
      continue;
    end if;

    begin
      insert into public.transactions (
        txn_id, stakeholder_id, date, total_amount, payment_mode,
        category, remarks, bill_doc_url, proof_document_url,
        ai_flag_status, ai_flag_data, entered_by, org_id, import_batch_id, import_row_no
      ) values (
        v_row->>'txn_id', nullif(v_row->>'stakeholder_id', ''), (v_row->>'date')::date,
        (v_row->>'total_amount')::numeric, nullif(v_row->>'payment_mode', '')::public.payment_mode,
        nullif(v_row->>'category', ''), v_row->>'remarks',
        nullif(v_row->>'bill_doc_url', ''), nullif(v_row->>'proof_document_url', ''),
        coalesce(nullif(v_row->>'ai_flag_status', '')::public.ai_flag_status, 'Clean'),
        coalesce(v_row->'ai_flag_data', '{}'::jsonb), v_uid, v_org_id, p_batch_id, v_row_no
      )
      on conflict (org_id, import_batch_id, import_row_no) where import_batch_id is not null
      do nothing
      returning txn_id into v_txn_id;

      if v_txn_id is null then
        v_skipped := v_skipped || to_jsonb(v_row_no);
      else
        if nullif(v_row->>'project_id', '') is not null then
          insert into public.txn_allocations (
            txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id
          ) values (
            v_txn_id, v_row->>'project_id',
            nullif(v_row->>'order_type', '')::public.order_type_enum,
            nullif(v_row->>'order_ref', ''), nullif(v_row->>'milestone_id', '')::uuid,
            (v_row->>'total_amount')::numeric, v_org_id
          );
        end if;
        v_inserted := v_inserted || jsonb_build_object('row_no', v_row_no, 'txn_id', v_txn_id);
      end if;
    exception when others then
      v_failed := v_failed || jsonb_build_object('row_no', v_row_no, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('success', true, 'inserted', v_inserted, 'skipped', v_skipped, 'failed', v_failed);
end;
$function$;

-- 4 ── void_import_batch : scope to the caller's finance orgs (was global, unscoped)
create or replace function public.void_import_batch(p_batch_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_count int;
begin
  if p_batch_id is null or p_batch_id = '' then raise exception 'a batch id is required'; end if;

  update public.transactions
     set status = 'Voided'
   where import_batch_id = p_batch_id
     and status = 'Active'
     and org_id in (
       select m.org_id from public.org_memberships m
        where m.user_id = auth.uid() and m.status = 'active'
          and public.has_role_in_org(m.org_id, variadic array['accountant'::text,'management'::text,'principal'::text]));

  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'voided', v_count);
end;
$function$;

-- 5 ── set_txn_allocations : add role check (org check already present)
create or replace function public.set_txn_allocations(p_txn_id text, p_org_id uuid, p_parts jsonb)
returns jsonb language plpgsql security definer as $function$
declare v_p jsonb;
begin
  if p_org_id not in (select public.get_my_org_ids()) then
    return jsonb_build_object('success', false, 'error', 'Access denied');
  end if;
  if not public.has_role_in_org(p_org_id, variadic array['accountant'::text,'management'::text,'principal'::text]) then
    return jsonb_build_object('success', false, 'error', 'Access denied: your role may not record money');
  end if;

  set constraints all deferred;

  delete from public.txn_allocations where txn_id = p_txn_id and org_id = p_org_id;

  for v_p in select * from jsonb_array_elements(p_parts)
  loop
    insert into public.txn_allocations (
      txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id
    ) values (
      p_txn_id, nullif(v_p->>'project_id', ''),
      nullif(v_p->>'order_type', '')::public.order_type_enum,
      nullif(v_p->>'order_ref', ''), nullif(v_p->>'milestone_id', '')::uuid,
      (v_p->>'allocated_amount')::numeric, p_org_id
    );
  end loop;

  return jsonb_build_object('success', true);
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$function$;

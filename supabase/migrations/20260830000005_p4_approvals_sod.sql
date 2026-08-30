-- ─────────────────────────────────────────────────────────────────────────────
-- P4 · Approvals & segregation of duties (purchase orders)
--
-- Signed-off rules: tier-only approval (management or principal), a principal's own
-- creations auto-approve, everyone else needs a DIFFERENT approver (creator ≠ approver).
-- Limits stay off (procurement_approval_limit is null = unlimited).
--
-- Changes vs live:
--   • create_purchase_order — only management/principal may create; and only a
--     PRINCIPAL's PO auto-approves (management's now goes PENDING for a second pair
--     of eyes). NOTE: this is a behaviour change — a management-created PO is no
--     longer live on creation; it must be approved via decide_purchase_order.
--   • decide_purchase_order — authorize by ROLE (management/principal) OR the
--     per-member can_approve_procurement flag; and the PO's creator may not approve
--     their own PO unless they are a principal.
--
-- Work-order approval is a direct client UPDATE today; enforcing creator≠approver
-- there needs a decide_work_order RPC — deferred (tracked in the plan), not here.
--
-- ROLLBACK: re-apply the pre-P4 definitions from the capture.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.create_purchase_order(p_po_data jsonb, p_line_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_org_id uuid; v_project_id text; v_po_id text; v_li jsonb;
  v_role text; v_status text; v_approval text; v_approver uuid; v_approon timestamptz;
begin
  v_org_id     := (p_po_data->>'org_id')::uuid;
  v_project_id := p_po_data->>'project_id';

  if v_org_id not in (select public.get_my_org_ids()) then
    return jsonb_build_object('success', false, 'error', 'Access denied');
  end if;

  -- only management/principal may raise a PO directly (supervisors raise material requests)
  if not public.has_role_in_org(v_org_id, variadic array['management'::text,'principal'::text]) then
    return jsonb_build_object('success', false, 'error', 'Only management or principal can create a purchase order');
  end if;

  select role::text into v_role
  from public.org_memberships
  where user_id = auth.uid() and org_id = v_org_id and status = 'active'
  limit 1;

  -- SoD: only a PRINCIPAL's own PO auto-approves; management's needs a second approver
  if v_role = 'principal' then
    v_approval := 'APPROVED'; v_approver := auth.uid(); v_approon := now();
  else
    v_approval := 'PENDING';  v_approver := null;       v_approon := null;
  end if;

  v_status := case
    when p_po_data->>'status' in ('ORDERED','BILLED','PARTIAL','PAID','CANCELLED','RFQ') then p_po_data->>'status'
    else 'ORDERED'
  end;

  v_po_id := public.generate_document_id(v_org_id, v_project_id, 'PO');

  insert into public.purchase_orders (
    po_id, org_id, project_id, stakeholder_id,
    items, order_value, total_value, gst_value, status,
    approval_status, approved_by, approved_at,
    date_issued, expected_delivery, delivery_location,
    payment_terms_days, ordered_by, vendor_notes, internal_notes, created_by
  ) values (
    v_po_id, v_org_id, v_project_id, p_po_data->>'stakeholder_id',
    p_po_data->'items', (p_po_data->>'order_value')::numeric, (p_po_data->>'total_value')::numeric,
    (p_po_data->>'gst_value')::numeric, v_status, v_approval, v_approver, v_approon,
    (p_po_data->>'date_issued')::date, nullif(p_po_data->>'expected_delivery', '')::date,
    nullif(p_po_data->>'delivery_location', ''), (p_po_data->>'payment_terms_days')::int,
    nullif(p_po_data->>'ordered_by', ''), nullif(p_po_data->>'vendor_notes', ''),
    nullif(p_po_data->>'internal_notes', ''), (p_po_data->>'created_by')::uuid
  );

  for v_li in select * from jsonb_array_elements(p_line_items)
  loop
    insert into public.po_line_items (
      po_id, org_id, line_number, category_id, item_name, specification,
      unit, quantity_ordered, unit_rate, basic_amount,
      discount_percent, discount_amount, gst_rate, cgst, sgst, igst, total_amount
    ) values (
      v_po_id, v_org_id, (v_li->>'line_number')::int, nullif(v_li->>'category_id', ''),
      v_li->>'item_name', nullif(v_li->>'specification', ''), v_li->>'unit',
      (v_li->>'quantity_ordered')::numeric, (v_li->>'unit_rate')::numeric, (v_li->>'basic_amount')::numeric,
      (v_li->>'discount_percent')::numeric, (v_li->>'discount_amount')::numeric, (v_li->>'gst_rate')::numeric,
      (v_li->>'cgst')::numeric, (v_li->>'sgst')::numeric, (v_li->>'igst')::numeric, (v_li->>'total_amount')::numeric
    );
  end loop;

  return jsonb_build_object('success', true, 'po_id', v_po_id, 'approval_status', v_approval);
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$function$;


create or replace function public.decide_purchase_order(p_po_id text, p_action text, p_remarks text default null::text, p_actor_id uuid default null::uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_po     public.purchase_orders%rowtype;
  v_uid    uuid := coalesce(auth.uid(), p_actor_id);
  v_can    boolean; v_limit numeric; v_higher uuid; v_amount numeric;
begin
  if auth.uid() is not null and p_actor_id is not null and auth.uid() <> p_actor_id then
    return jsonb_build_object('success', false, 'error', 'Approver mismatch');
  end if;
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in');
  end if;

  select * into v_po from public.purchase_orders where po_id = p_po_id;
  if v_po.po_id is null then
    return jsonb_build_object('success', false, 'error', 'PO not found');
  end if;

  select can_approve_procurement, procurement_approval_limit, higher_approver_id
    into v_can, v_limit, v_higher
  from public.org_memberships
  where user_id = v_uid and org_id = v_po.org_id and status = 'active';

  -- Authorize by role (management/principal) OR the per-member approval flag
  if not (public.has_role(v_uid, v_po.org_id, 'management') or coalesce(v_can, false)) then
    return jsonb_build_object('success', false, 'error', 'Not authorized to approve procurement');
  end if;

  if v_po.approval_status is distinct from 'PENDING' then
    return jsonb_build_object('success', true, 'already', true, 'approval_status', v_po.approval_status);
  end if;

  if p_action = 'APPROVE' then
    -- SoD: the creator may not approve their own PO (unless they are a principal)
    if v_po.created_by = v_uid and not public.has_role(v_uid, v_po.org_id, 'principal') then
      return jsonb_build_object('success', false, 'error', 'The creator of a PO cannot approve it');
    end if;

    v_amount := coalesce(v_po.total_value, v_po.order_value, 0);
    if v_limit is not null and v_amount > v_limit then
      return jsonb_build_object('success', false, 'error', 'above_limit', 'amount', v_amount, 'limit', v_limit, 'escalate_to', v_higher);
    end if;
    update public.purchase_orders set approval_status = 'APPROVED', approved_by = v_uid, approved_at = now() where po_id = p_po_id;
    insert into public.po_approvals (org_id, po_id, approver_user_id, action, remarks) values (v_po.org_id, p_po_id, v_uid, 'APPROVED', p_remarks);
    return jsonb_build_object('success', true, 'approval_status', 'APPROVED');

  elsif p_action = 'SEND_BACK' then
    insert into public.po_approvals (org_id, po_id, approver_user_id, action, remarks) values (v_po.org_id, p_po_id, v_uid, 'SENT_BACK', p_remarks);
    return jsonb_build_object('success', true, 'approval_status', 'PENDING', 'sent_back', true);

  elsif p_action = 'REJECT' then
    update public.purchase_orders set approval_status = 'REJECTED' where po_id = p_po_id;
    insert into public.po_approvals (org_id, po_id, approver_user_id, action, remarks) values (v_po.org_id, p_po_id, v_uid, 'REJECTED', p_remarks);
    return jsonb_build_object('success', true, 'approval_status', 'REJECTED');
  end if;

  return jsonb_build_object('success', false, 'error', 'Unknown action');
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$function$;

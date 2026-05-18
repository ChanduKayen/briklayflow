-- Block 4: create_purchase_order — generate po_id internally, strip it from p_po_data

CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_po_data    jsonb,   -- purchase_order fields WITHOUT po_id
  p_line_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id     uuid;
  v_project_id text;
  v_po_id      text;
  v_li         jsonb;
BEGIN
  v_org_id     := (p_po_data->>'org_id')::uuid;
  v_project_id := p_po_data->>'project_id';

  IF v_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  v_po_id := public.generate_document_id(v_org_id, v_project_id, 'PO');

  INSERT INTO public.purchase_orders (
    po_id, org_id, project_id, stakeholder_id,
    items, order_value, total_value, gst_value, status,
    date_issued, expected_delivery, delivery_location,
    payment_terms_days, ordered_by, vendor_notes, internal_notes, created_by
  ) VALUES (
    v_po_id,
    v_org_id,
    v_project_id,
    p_po_data->>'stakeholder_id',
    p_po_data->'items',
    (p_po_data->>'order_value')::numeric,
    (p_po_data->>'total_value')::numeric,
    (p_po_data->>'gst_value')::numeric,
    p_po_data->>'status',
    (p_po_data->>'date_issued')::date,
    NULLIF(p_po_data->>'expected_delivery', '')::date,
    NULLIF(p_po_data->>'delivery_location', ''),
    (p_po_data->>'payment_terms_days')::int,
    NULLIF(p_po_data->>'ordered_by', ''),
    NULLIF(p_po_data->>'vendor_notes', ''),
    NULLIF(p_po_data->>'internal_notes', ''),
    (p_po_data->>'created_by')::uuid
  );

  FOR v_li IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    INSERT INTO public.po_line_items (
      po_id, org_id, line_number, category_id, item_name, specification,
      unit, quantity_ordered, unit_rate, basic_amount,
      discount_percent, discount_amount, gst_rate, cgst, sgst, igst, total_amount
    ) VALUES (
      v_po_id,
      v_org_id,
      (v_li->>'line_number')::int,
      NULLIF(v_li->>'category_id', ''),
      v_li->>'item_name',
      NULLIF(v_li->>'specification', ''),
      v_li->>'unit',
      (v_li->>'quantity_ordered')::numeric,
      (v_li->>'unit_rate')::numeric,
      (v_li->>'basic_amount')::numeric,
      (v_li->>'discount_percent')::numeric,
      (v_li->>'discount_amount')::numeric,
      (v_li->>'gst_rate')::numeric,
      (v_li->>'cgst')::numeric,
      (v_li->>'sgst')::numeric,
      (v_li->>'igst')::numeric,
      (v_li->>'total_amount')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'po_id', v_po_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

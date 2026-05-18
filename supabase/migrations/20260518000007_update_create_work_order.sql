-- Block 3: create_work_order — remove p_wo_id param, generate ID internally

CREATE OR REPLACE FUNCTION public.create_work_order(
  p_org_id         uuid,
  p_project_id     text,
  p_stakeholder_id text,
  p_scope          text,
  p_order_value    numeric,
  p_date_issued    date,
  p_source         text,
  p_milestones     jsonb  -- [{seq_no,name,unit_type,quantity,rate,planned_amount,ai_extracted}]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wo_id text;
BEGIN
  IF p_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  v_wo_id := public.generate_document_id(p_org_id, p_project_id, 'WO');

  INSERT INTO public.work_orders (
    wo_id, org_id, project_id, stakeholder_id,
    scope_of_work, order_value, date_issued, source, status
  ) VALUES (
    v_wo_id, p_org_id, p_project_id, p_stakeholder_id,
    p_scope, p_order_value, p_date_issued, p_source::public.wo_source, 'Draft'
  );

  INSERT INTO public.wo_milestones (
    wo_id, org_id, seq_no, name, unit_type, quantity, rate,
    planned_amount, status, ai_extracted
  )
  SELECT
    v_wo_id,
    p_org_id,
    (m->>'seq_no')::int,
    m->>'name',
    m->>'unit_type',
    (m->>'quantity')::numeric,
    (m->>'rate')::numeric,
    (m->>'planned_amount')::numeric,
    'Pending',
    (m->>'ai_extracted')::boolean
  FROM jsonb_array_elements(p_milestones) AS m;

  RETURN jsonb_build_object('success', true, 'wo_id', v_wo_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

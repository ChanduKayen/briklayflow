-- PR-101 E: atomically record a client invoice receipt.
-- Wraps: client_payments.insert + client_invoices.update (paid_amount/status)
-- + (if integrated mode) transactions.insert + txn_allocations.insert
--   + client_payments.update (backlink txn_id)
CREATE OR REPLACE FUNCTION public.record_invoice_receipt(
  p_invoice_id    text,
  p_org_id        uuid,
  p_amount        numeric,
  p_payment_date  date,
  p_payment_mode  text,
  p_reference     text,     -- nullable
  p_notes         text,     -- nullable
  p_new_paid      numeric,
  p_new_status    text,
  -- integrated-mode fields (ignored when p_is_integrated = false)
  p_is_integrated boolean,
  p_txn_id        text,     -- client-generated txn id
  p_client_id     text,     -- nullable
  p_project_id    text,     -- nullable
  p_remarks       text      -- txn remarks
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_id uuid;
BEGIN
  IF p_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  -- Step 1: record the payment
  INSERT INTO public.client_payments (
    invoice_id, amount, payment_date, payment_mode,
    reference, notes, created_by, org_id
  ) VALUES (
    p_invoice_id, p_amount, p_payment_date, p_payment_mode,
    NULLIF(p_reference, ''), NULLIF(p_notes, ''),
    auth.uid(), p_org_id
  ) RETURNING payment_id INTO v_payment_id;

  -- Step 2: update invoice running total + status
  UPDATE public.client_invoices
  SET paid_amount = p_new_paid, status = p_new_status
  WHERE invoice_id = p_invoice_id;

  -- Steps 3a-3c: ledger integration (when enabled and invoice has client + project)
  IF p_is_integrated AND p_client_id IS NOT NULL AND p_project_id IS NOT NULL THEN
    INSERT INTO public.transactions (
      txn_id, org_id, stakeholder_id, date, total_amount,
      payment_mode, category, remarks, ai_flag_status, ai_flag_data, entered_by
    ) VALUES (
      p_txn_id, p_org_id, p_client_id, p_payment_date, p_amount,
      p_payment_mode::public.payment_mode,
      'CLIENT-RECEIPT', p_remarks,
      'Clean',
      jsonb_build_object('type', 'client_receipt', 'invoice_id', p_invoice_id),
      auth.uid()
    );

    INSERT INTO public.txn_allocations (
      txn_id, project_id, order_type, order_ref, allocated_amount, org_id
    ) VALUES (
      p_txn_id, p_project_id, NULL, NULL, p_amount, p_org_id
    );

    -- Backlink: use the exact payment_id we just inserted (no guessing)
    UPDATE public.client_payments
    SET txn_id = p_txn_id
    WHERE payment_id = v_payment_id;
  END IF;

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

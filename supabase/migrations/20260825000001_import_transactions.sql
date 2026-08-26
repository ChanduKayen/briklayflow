-- ===========================================================================
-- Bulk transaction import — the write path for the Transactions Excel/CSV importer.
--
-- Mirrors insert_transaction_with_allocations (same columns, casts, SECURITY DEFINER,
-- entered_by = auth.uid(), org_id from the payload) but takes MANY rows at once and adds
-- three things the single-insert path doesn't need:
--
--   1. A BATCH STAMP (import_batch_id + import_row_no) on every row it writes, so a whole
--      import can be undone in one call (void_import_batch) and a re-upload of the same file
--      is idempotent (the partial unique index below + ON CONFLICT DO NOTHING).
--   2. PER-ROW exception handling — one bad row (a null the client missed, a bad cast) is
--      caught and reported, it does NOT sink the other 299. Returns {inserted, skipped, failed}.
--   3. One allocation per row for the FULL amount when a project resolved (no split, no WO/PO
--      link — a plain project expense); rows with no project get no allocation.
--
-- CONTRACT the client (importCommit.ts) must honour:
--   • total_amount is the POSITIVE magnitude; direction is derived downstream (deriveDirection)
--     from stakeholder type / an ai_flag_data.type='client_receipt' marker for income rows.
--   • txn_id is deterministic per (batch, row) — e.g. 'IMP-<batch>-<row_no>' — so a re-run maps
--     to the same rows and the idempotent skip works.
--   • category (cost code) is left null on import by design; it is filed later.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.import_transactions(jsonb, text);
--   DROP FUNCTION IF EXISTS public.void_import_batch(text);
--   DROP INDEX  IF EXISTS public.transactions_import_batch_row_uidx;
--   ALTER TABLE public.transactions DROP COLUMN IF EXISTS import_batch_id, DROP COLUMN IF EXISTS import_row_no;
-- ===========================================================================

-- 1. Batch-stamp columns + the idempotency backstop (partial: only import rows are constrained,
--    normal transactions with a null batch are untouched).
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS import_batch_id text,
  ADD COLUMN IF NOT EXISTS import_row_no   int;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_import_batch_row_uidx
  ON public.transactions (org_id, import_batch_id, import_row_no)
  WHERE import_batch_id IS NOT NULL;

-- 2. The bulk insert.
CREATE OR REPLACE FUNCTION public.import_transactions(
  p_rows     jsonb,
  p_batch_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      jsonb;
  v_row_no   int;
  v_org_id   uuid;
  v_txn_id   text;
  v_uid      uuid := auth.uid();
  v_inserted jsonb := '[]'::jsonb;
  v_skipped  jsonb := '[]'::jsonb;
  v_failed   jsonb := '[]'::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'no rows provided';
  END IF;
  IF p_batch_id IS NULL OR p_batch_id = '' THEN
    RAISE EXCEPTION 'a batch id is required';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_row_no := (v_row->>'row_no')::int;
    v_org_id := (v_row->>'org_id')::uuid;
    v_txn_id := NULL;

    -- Per-row subtransaction: an error here rolls back ONLY this row (txn + its allocation),
    -- records the reason, and the loop carries on. No orphan transactions, no all-or-nothing.
    BEGIN
      INSERT INTO public.transactions (
        txn_id, stakeholder_id, date, total_amount, payment_mode,
        category, remarks, bill_doc_url, proof_document_url,
        ai_flag_status, ai_flag_data, entered_by, org_id,
        import_batch_id, import_row_no
      ) VALUES (
        v_row->>'txn_id',
        NULLIF(v_row->>'stakeholder_id', ''),
        (v_row->>'date')::date,
        (v_row->>'total_amount')::numeric,
        NULLIF(v_row->>'payment_mode', '')::public.payment_mode,
        NULLIF(v_row->>'category', ''),
        v_row->>'remarks',
        NULLIF(v_row->>'bill_doc_url', ''),
        NULLIF(v_row->>'proof_document_url', ''),
        COALESCE(NULLIF(v_row->>'ai_flag_status', '')::public.ai_flag_status, 'Clean'),
        COALESCE(v_row->'ai_flag_data', '{}'::jsonb),
        v_uid,
        v_org_id,
        p_batch_id,
        v_row_no
      )
      ON CONFLICT (org_id, import_batch_id, import_row_no) WHERE import_batch_id IS NOT NULL
      DO NOTHING
      RETURNING txn_id INTO v_txn_id;

      IF v_txn_id IS NULL THEN
        -- Already written under this (batch, row) → idempotent re-upload, skip quietly.
        v_skipped := v_skipped || to_jsonb(v_row_no);
      ELSE
        IF NULLIF(v_row->>'project_id', '') IS NOT NULL THEN
          INSERT INTO public.txn_allocations (
            txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id
          ) VALUES (
            v_txn_id,
            v_row->>'project_id',
            NULLIF(v_row->>'order_type', '')::public.order_type_enum,
            NULLIF(v_row->>'order_ref', ''),
            NULLIF(v_row->>'milestone_id', '')::uuid,
            (v_row->>'total_amount')::numeric,
            v_org_id
          );
        END IF;
        v_inserted := v_inserted || jsonb_build_object('row_no', v_row_no, 'txn_id', v_txn_id);
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_object('row_no', v_row_no, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success',  true,
    'inserted', v_inserted,   -- [{row_no, txn_id}]
    'skipped',  v_skipped,    -- [row_no] already present (idempotent)
    'failed',   v_failed      -- [{row_no, error}]
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.import_transactions(jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.import_transactions(jsonb, text) TO authenticated;

-- 3. One-click undo — void every transaction an import wrote. Voids (keeps the audit row), does
--    not delete. Batch ids are client-generated randoms; this trusts the authenticated caller the
--    same way insert_split_transactions trusts org_id in its payload.
CREATE OR REPLACE FUNCTION public.void_import_batch(p_batch_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  IF p_batch_id IS NULL OR p_batch_id = '' THEN
    RAISE EXCEPTION 'a batch id is required';
  END IF;
  UPDATE public.transactions
     SET status = 'Voided'
   WHERE import_batch_id = p_batch_id
     AND status = 'Active';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'voided', v_count);
END;
$$;

REVOKE ALL  ON FUNCTION public.void_import_batch(text) FROM public;
GRANT EXECUTE ON FUNCTION public.void_import_batch(text) TO authenticated;

-- Verify:
--   SELECT proname FROM pg_proc WHERE proname IN ('import_transactions','void_import_batch');
--   \d public.transactions   -- import_batch_id / import_row_no present
--   SELECT indexname FROM pg_indexes WHERE indexname = 'transactions_import_batch_row_uidx';

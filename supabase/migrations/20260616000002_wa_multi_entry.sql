-- WhatsApp multi-entry: per-entry idempotency + suppressible staging ─────────────
-- One WhatsApp message can carry many payments. We loop the existing single-entry
-- commit once per payment; the durable guarantee against any re-stage (the manual
-- [Try again], a bounded in-loop retry, or a future replay) is a PER-ENTRY
-- idempotency key on rough_entries: (org_id, wa_message_id, entry_index).
--
-- Diagnosis note: this spine's watchdog does NOT re-invoke/​re-extract a stalled job
-- (it only flips PROCESSING→FAILED and sends one notice), and inbound dedup is the
-- UNIQUE processing_job.wamid. So extraction runs once per wamid and entry_index is
-- already stable — no need to persist the extracted array. The key below is what
-- makes the re-stage paths no-op safely.

-- 1) Per-entry columns + idempotency key ──────────────────────────────────────
ALTER TABLE public.rough_entries ADD COLUMN IF NOT EXISTS wa_message_id text;
ALTER TABLE public.rough_entries ADD COLUMN IF NOT EXISTS entry_index    int;

-- Partial: only WhatsApp-staged rows carry these; UI entries (null) are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rough_entries_wa_entry
  ON public.rough_entries (org_id, wa_message_id, entry_index)
  WHERE wa_message_id IS NOT NULL;

-- 2) Forced-failure sentinel for the live partial test (DoD #4) ────────────────
-- Production no-op: only fires when the test session sets `SET wa.fail_sentinel='on'`.
-- With it on, staging an entry of exactly ₹99,999 RAISES, so that one entry lands as
-- "not saved" while its siblings commit. (`true` = missing_ok, so an unset GUC is fine.)
CREATE OR REPLACE FUNCTION public.wa_fail_sentinel(p_ai jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('wa.fail_sentinel', true) = 'on'
     AND (p_ai->>'amount') = '99999' THEN
    RAISE EXCEPTION 'wa_fail_sentinel: forced failure on amount 99999';
  END IF;
END $$;

-- 3) stage_entry_v3 — idempotent staging, card optional ────────────────────────
-- Returns jsonb {id, committed, conflict}, NEVER null:
--   • fresh insert      -> {id, committed:true, conflict:false} (+ enqueues card/reaction
--                          in-tx IFF p_rendered given — the single-entry, commit-gated path)
--   • ON CONFLICT (same wamid+index already landed) -> SELECT the existing row and return
--     {id, committed:true, conflict:true}. This is idempotent SUCCESS, not a failure — a
--     null here would be misread by confirm-on-commit as "couldn't save" for a row that
--     is in fact safely in the ledger.
-- The batch path passes p_rendered = NULL (no per-entry card) and sends ONE aggregated
-- card after the loop. A genuine failure RAISES (caller sees the error and reports it).
CREATE OR REPLACE FUNCTION public.stage_entry_v3(
  p_org_id uuid, p_sender text, p_wamid text, p_entry_index int,
  p_status text, p_source text, p_sender_name text, p_raw_text text, p_ai jsonb,
  p_payload  jsonb DEFAULT NULL,
  p_rendered jsonb DEFAULT NULL,
  p_link_base text DEFAULT 'https://briklay.app/logbook',
  p_reaction jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_existing uuid; v_link text; v_rendered jsonb; v_payload jsonb;
BEGIN
  PERFORM public.wa_fail_sentinel(p_ai);   -- production no-op unless the test GUC is on

  INSERT INTO public.rough_entries
    (org_id, source, raw_text, sender_name, sender_number, ai_extracted, status, wa_message_id, entry_index)
  VALUES
    (p_org_id, p_source, p_raw_text, p_sender_name, p_sender, p_ai, p_status, p_wamid, p_entry_index)
  ON CONFLICT (org_id, wa_message_id, entry_index) WHERE wa_message_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- already landed in this/a prior execution -> idempotent success
    SELECT id INTO v_existing FROM public.rough_entries
      WHERE org_id = p_org_id AND wa_message_id = p_wamid AND entry_index = p_entry_index;
    RETURN jsonb_build_object('id', v_existing, 'committed', true, 'conflict', true);
  END IF;

  -- single-entry path: confirmation + ✓ reaction enqueued in-tx (commit-gated)
  IF p_rendered IS NOT NULL THEN
    v_link     := p_link_base || '?entry=' || v_id::text;
    v_rendered := replace(p_rendered::text, '__ENTRY_LINK__', v_link)::jsonb;
    v_payload  := replace(COALESCE(p_payload, '{}'::jsonb)::text, '__ENTRY_LINK__', v_link)::jsonb;
    INSERT INTO public.outbox (org_id, target, payload, rendered, wamid)
    VALUES (p_org_id, p_sender, v_payload, v_rendered, p_wamid);
  END IF;
  IF p_reaction IS NOT NULL THEN
    INSERT INTO public.outbox (org_id, target, payload, rendered, wamid)
    VALUES (p_org_id, p_sender, jsonb_build_object('kind','reaction'), p_reaction, p_wamid);
  END IF;

  RETURN jsonb_build_object('id', v_id, 'committed', true, 'conflict', false);
END $$;

GRANT EXECUTE ON FUNCTION public.stage_entry_v3(uuid,text,text,int,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb)
  TO authenticated, anon, service_role;

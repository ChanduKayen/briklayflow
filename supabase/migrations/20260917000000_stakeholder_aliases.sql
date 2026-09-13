-- ===========================================================================
-- Party aliases — the other names a party is called by.
--
-- Aliases are NEVER displayed (the canonical `name` always is); they exist only so name-matching
-- (WhatsApp, the importer, bill intake, the Day Book picker, search) can find a party by a nickname
-- or a romanisation spelling. Mirrors the proven `sku_directory.aliases text[]` pattern.
--
-- Learned two ways: added by hand in the party editor, and captured (with a one-tap yes) when someone
-- corrects a captured name to an existing party in the Day Book.
-- ===========================================================================

ALTER TABLE public.stakeholders ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

-- ── fold aliases into the merge: a merged-away party's name + aliases become aliases of the survivor,
--    so every old spelling still resolves. Re-declares merge_stakeholders (20260916000000) with that step. ──
CREATE OR REPLACE FUNCTION public.merge_stakeholders(
  p_org_id   uuid,
  p_survivor text,
  p_losers   text[],
  p_new_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        record;
  v_type   text;
  v_count  int;
  v_net    numeric;
  v_asof   date;
  v_dir    text;
BEGIN
  -- ── guards ──
  IF p_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RAISE EXCEPTION 'not a member of this org';
  END IF;
  IF p_survivor IS NULL OR p_losers IS NULL OR array_length(p_losers, 1) IS NULL THEN
    RAISE EXCEPTION 'a survivor and at least one other party are required';
  END IF;
  IF p_survivor = ANY(p_losers) THEN
    RAISE EXCEPTION 'the survivor cannot also be in the merge list';
  END IF;

  SELECT type::text INTO v_type FROM public.stakeholders WHERE stakeholder_id = p_survivor AND org_id = p_org_id;
  IF v_type IS NULL THEN RAISE EXCEPTION 'survivor not found in this org'; END IF;

  SELECT count(*) INTO v_count FROM public.stakeholders
    WHERE stakeholder_id = ANY(p_losers) AND org_id = p_org_id AND type::text = v_type;
  IF v_count <> array_length(p_losers, 1) THEN
    RAISE EXCEPTION 'all parties must be in the same org and of the same type (%)', v_type;
  END IF;

  -- ── the losers' names + aliases become aliases of the survivor (so old spellings still resolve) ──
  UPDATE public.stakeholders s SET aliases = (
    SELECT array(
      SELECT DISTINCT x
        FROM unnest(
          COALESCE(s.aliases, '{}')
          || COALESCE((SELECT array_agg(l.name) FROM public.stakeholders l WHERE l.stakeholder_id = ANY(p_losers)), '{}')
          || COALESCE((SELECT array_agg(al) FROM public.stakeholders l, unnest(COALESCE(l.aliases, '{}')) al WHERE l.stakeholder_id = ANY(p_losers)), '{}')
        ) x
       WHERE x IS NOT NULL AND btrim(x) <> '' AND lower(btrim(x)) <> lower(btrim(COALESCE(NULLIF(btrim(p_new_name), ''), s.name)))
    )
  ) WHERE s.stakeholder_id = p_survivor;

  -- ── net the opening balances across the whole set (advance = +, owed = −) ──
  IF to_regclass('public.stakeholder_opening_balances') IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN direction = 'paid_ahead' THEN total_amount ELSE -total_amount END), 0),
           MIN(as_of)
      INTO v_net, v_asof
      FROM public.stakeholder_opening_balances
     WHERE org_id = p_org_id
       AND stakeholder_id = ANY(ARRAY[p_survivor] || p_losers);

    DELETE FROM public.stakeholder_opening_balances
     WHERE org_id = p_org_id AND stakeholder_id = ANY(p_losers);

    IF v_asof IS NOT NULL THEN
      v_dir := CASE WHEN v_net >= 0 THEN 'paid_ahead' ELSE 'work_owed' END;
      INSERT INTO public.stakeholder_opening_balances
        (org_id, stakeholder_id, as_of, direction, total_amount, by_site, note)
        VALUES (p_org_id, p_survivor, v_asof, v_dir, abs(v_net), '{}'::jsonb, 'Merged opening')
      ON CONFLICT (org_id, stakeholder_id) DO UPDATE
        SET direction    = EXCLUDED.direction,
            total_amount = EXCLUDED.total_amount,
            as_of        = LEAST(public.stakeholder_opening_balances.as_of, EXCLUDED.as_of),
            by_site      = '{}'::jsonb,
            note         = 'Merged opening';
    END IF;
  END IF;

  IF to_regclass('public.ledger_projection') IS NOT NULL THEN
    DELETE FROM public.ledger_projection WHERE stakeholder_id = ANY(p_losers);
  END IF;

  -- ── repoint every OTHER foreign-key child from the losers onto the survivor ──
  FOR r IN
    SELECT (c.conrelid::regclass)::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.confrelid = 'public.stakeholders'::regclass AND c.contype = 'f'
  LOOP
    IF r.tbl IN ('stakeholder_opening_balances', 'public.stakeholder_opening_balances',
                 'ledger_projection', 'public.ledger_projection',
                 'stakeholders', 'public.stakeholders') THEN
      CONTINUE;
    END IF;
    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = ANY($2)', r.tbl, r.col, r.col)
      USING p_survivor, p_losers;
  END LOOP;

  -- ── soft-delete the losers + rename the survivor ──
  UPDATE public.stakeholders SET merged_into = p_survivor WHERE stakeholder_id = ANY(p_losers);
  IF p_new_name IS NOT NULL AND length(btrim(p_new_name)) > 0 THEN
    UPDATE public.stakeholders SET name = btrim(p_new_name) WHERE stakeholder_id = p_survivor;
  END IF;

  BEGIN PERFORM public.fn_recompute_party(p_survivor); EXCEPTION WHEN OTHERS THEN NULL; END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_stakeholders(uuid, text, text[], text) TO authenticated;

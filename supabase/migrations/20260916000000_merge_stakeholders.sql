-- ===========================================================================
-- Merge duplicate stakeholders into one.
--
-- Picks ONE survivor and folds the others ("losers") into it: every record that references a loser is
-- repointed onto the survivor, their opening balances are NETTED together, the survivor is renamed to
-- the chosen name, and the losers are SOFT-deleted (stakeholders.merged_into = survivor) so the merge
-- is auditable and the ids never dangle. All-or-nothing — any failure rolls the whole thing back.
--
-- The repoint is generic: it walks every foreign key that references stakeholders(stakeholder_id) and
-- moves the losers' rows to the survivor. Two tables are handled specially first, because their key
-- shape would collide on a blind repoint:
--   • stakeholder_opening_balances — UNIQUE(org_id, stakeholder_id): netted, then losers deleted.
--   • ledger_projection            — PK is stakeholder_id: losers deleted, survivor recomputed at end.
-- ===========================================================================

-- soft-delete marker: a loser points at the survivor it folded into (NULL = a live, un-merged party).
ALTER TABLE public.stakeholders ADD COLUMN IF NOT EXISTS merged_into text
  REFERENCES public.stakeholders(stakeholder_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS stakeholders_merged_into_idx ON public.stakeholders(merged_into);

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

  -- `type` is an enum (stakeholder_type); compare it as text throughout
  SELECT type::text INTO v_type FROM public.stakeholders WHERE stakeholder_id = p_survivor AND org_id = p_org_id;
  IF v_type IS NULL THEN RAISE EXCEPTION 'survivor not found in this org'; END IF;

  -- every loser must be in the same org and of the same type as the survivor
  SELECT count(*) INTO v_count FROM public.stakeholders
    WHERE stakeholder_id = ANY(p_losers) AND org_id = p_org_id AND type::text = v_type;
  IF v_count <> array_length(p_losers, 1) THEN
    RAISE EXCEPTION 'all parties must be in the same org and of the same type (%)', v_type;
  END IF;

  -- ── net the opening balances across the whole set (advance = +, owed = −) ──
  -- (guarded: the party-ledger migrations may not be applied on every database)
  IF to_regclass('public.stakeholder_opening_balances') IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN direction = 'paid_ahead' THEN total_amount ELSE -total_amount END), 0),
           MIN(as_of)
      INTO v_net, v_asof
      FROM public.stakeholder_opening_balances
     WHERE org_id = p_org_id
       AND stakeholder_id = ANY(ARRAY[p_survivor] || p_losers);

    -- the losers' openings would collide with the survivor's on repoint — drop them
    DELETE FROM public.stakeholder_opening_balances
     WHERE org_id = p_org_id AND stakeholder_id = ANY(p_losers);

    -- if anyone in the set had an opening, the survivor carries the netted figure
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

  -- the per-party projection is keyed by stakeholder_id (PK) — drop losers; survivor recomputed below
  -- (guarded: the allocation-ledger projection may not be applied on every database)
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
    -- skip the two handled above, and the self-referential merged_into column on stakeholders itself
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

  -- refresh the survivor's cached figures (never let a projection hiccup fail the merge)
  BEGIN PERFORM public.fn_recompute_party(p_survivor); EXCEPTION WHEN OTHERS THEN NULL; END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_stakeholders(uuid, text, text[], text) TO authenticated;

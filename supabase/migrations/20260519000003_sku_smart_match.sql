-- ============================================================
-- SKU SMART MATCH — v2
--
-- Algorithm upgrades over v1 (pure pg_trgm similarity):
--
--  1. word_similarity() instead of similarity() for alias matching.
--     word_similarity(A, B) = "how well is A a *word* inside B?"
--     Fixes: similarity('jelly', '…20mm jelly…') = 0.08
--            word_similarity('jelly', '…20mm jelly…') = 0.47  ← catches it
--
--  2. Domain synonym expansion (sku_normalize_query).
--     Maps Indian/regional construction shorthand to canonical terms
--     BEFORE any fuzzy matching — same approach used by Amazon SNAP,
--     SAP Ariba material normalization, and Coupa's taxonomy pipeline.
--     e.g. "jelly" → "aggregate", "tor" → "tmt", "ita" → "clay brick"
--
--  3. Full-text search (tsvector/tsquery) as a third signal.
--     FTS handles exact token matching well; trgm handles typos.
--     Combining both maximises recall.
--
--  4. Multi-signal score fusion: greatest(trgm_full, trgm_word, fts_rank).
--     Each signal catches a different class of miss; take the best.
-- ============================================================

-- ── 1. Full-text search vector column ────────────────────────────
ALTER TABLE public.sku_directory
  ADD COLUMN IF NOT EXISTS fts_vector tsvector;

UPDATE public.sku_directory SET fts_vector =
  to_tsvector('simple',
    coalesce(sub_category, '') || ' ' ||
    coalesce(dimension,    '') || ' ' ||
    coalesce(variant,      '') || ' ' ||
    coalesce(grade,        '') || ' ' ||
    coalesce(array_to_string(aliases, ' '), '')
  );

CREATE OR REPLACE FUNCTION public.sku_fts_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.fts_vector := to_tsvector('simple',
    coalesce(NEW.sub_category, '') || ' ' ||
    coalesce(NEW.dimension,    '') || ' ' ||
    coalesce(NEW.variant,      '') || ' ' ||
    coalesce(NEW.grade,        '') || ' ' ||
    coalesce(array_to_string(NEW.aliases, ' '), '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sku_fts_trigger ON public.sku_directory;
CREATE TRIGGER sku_fts_trigger
  BEFORE INSERT OR UPDATE ON public.sku_directory
  FOR EACH ROW EXECUTE FUNCTION public.sku_fts_vector_update();

CREATE INDEX IF NOT EXISTS idx_sku_fts_vector
  ON public.sku_directory USING gin(fts_vector);

-- ── 2. Construction synonym normalizer ───────────────────────────
-- Maps regional/trade shorthand → canonical search terms.
-- Run on the user's query BEFORE any fuzzy matching, so the
-- trgm and FTS engines see clean, standard vocabulary.
CREATE OR REPLACE FUNCTION public.sku_normalize_query(q text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(
                          regexp_replace(
                            regexp_replace(
                              regexp_replace(
                                regexp_replace(
                                  regexp_replace(
                                    lower(trim(q)),
                                  -- aggregates / stone
                                  '\bjelly\b',                       'coarse aggregate', 'gi'),
                                '\b(?<!\w)metal(?!\s*(?:pipe|work|sheet|door|window|frame))\b', 'coarse aggregate', 'gi'),
                                '\bstone chips\b',                   'coarse aggregate', 'gi'),
                              -- steel
                              '\btor\b(?!\s*bar)',                   'tmt', 'gi'),
                            '\btor bar\b|\brebar\b|\breinforcement bar\b', 'tmt bar', 'gi'),
                          -- bricks
                          '\bita\b|\bmitti\b',                       'clay brick', 'gi'),
                        '\bcountry brick\b|\bcommon brick\b',        'clay brick', 'gi'),
                      -- sand
                      '\bmsand\b|\bm\.?\s*sand\b|\brobo sand\b|\bmanufactured sand\b', 'm-sand', 'gi'),
                    '\bfine agg(?:regate)?\b|\bfa\b',               'sand', 'gi'),
                  '\bcoarse agg(?:regate)?\b|\bca\b',               'coarse aggregate', 'gi'),
                -- cement
                '\b53\s*grade\b',                                    'opc 53', 'gi'),
              '\b43\s*grade\b',                                      'opc 43', 'gi'),
            -- electrical
            '\b(\d+)\s*sqmm\b',                                     '\1 sq.mm', 'gi'),
          '\b(\d+)\s*mm\s*dia\b',                                    '\1mm', 'gi'),
        -- general
        '\bpipe\s*(\d+)\s*inch\b',                                   '\1 inch pipe', 'gi'),
      '\bswr\b',                                                     'upvc drainage', 'gi'),
    '\s+', ' ', 'g'
  ))
$$;

-- ── 3. Improved trgm_match_sku ────────────────────────────────────
-- Drop old single-param version first to avoid overload conflicts
DROP FUNCTION IF EXISTS public.trgm_match_sku(text, text, int, float);

CREATE OR REPLACE FUNCTION public.trgm_match_sku(
  p_search_term text,
  p_category    text    DEFAULT NULL,
  p_limit       int     DEFAULT 6,
  p_threshold   float   DEFAULT 0.10,
  p_categories  text[]  DEFAULT NULL
)
RETURNS TABLE (
  sku_id     text,
  item_name  text,
  category   text,
  unit       text,
  aliases    text,
  similarity float
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
WITH
  -- Normalize the query: expand synonyms then lower+trim
  norm AS (
    SELECT public.sku_normalize_query(p_search_term) AS q
  ),
  -- FTS query from normalized term (prefix matching)
  fts_q AS (
    SELECT plainto_tsquery('simple', (SELECT q FROM norm)) AS query
  ),
  scored AS (
    SELECT
      s.sku_id,
      public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade)
        AS item_name,
      s.category,
      s.standard_unit AS unit,
      array_to_string(s.aliases, ', ') AS raw_aliases,

      -- Combined target string: built name + all aliases
      public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade)
        || ' ' || coalesce(public.sku_aliases_text(s.aliases), '')
        AS target,

      greatest(
        -- Signal A: full-string trgm on both raw and normalised query
        similarity(
          public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade),
          p_search_term),
        similarity(
          coalesce(public.sku_aliases_text(s.aliases), ''),
          p_search_term),
        similarity(
          public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade),
          (SELECT q FROM norm)),
        similarity(
          coalesce(public.sku_aliases_text(s.aliases), ''),
          (SELECT q FROM norm)),

        -- Signal B: word_similarity — "is the query a word inside the target?"
        -- This is the KEY fix: catches short queries against long alias strings.
        word_similarity(
          p_search_term,
          public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade)
            || ' ' || coalesce(public.sku_aliases_text(s.aliases), '')),
        word_similarity(
          (SELECT q FROM norm),
          public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade)
            || ' ' || coalesce(public.sku_aliases_text(s.aliases), '')),

        -- Signal C: reverse word_similarity — "is the SKU name a phrase inside the query?"
        -- Catches queries like 'opc 53 cement 50kg bag standard' matching 'OPC 53 Cement'
        word_similarity(
          public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade),
          (SELECT q FROM norm))

      ) AS trgm_score,

      -- Signal D: FTS rank (0 if no FTS hit, small bonus if hit)
      CASE WHEN s.fts_vector @@ (SELECT query FROM fts_q)
           THEN ts_rank_cd(s.fts_vector, (SELECT query FROM fts_q), 1)
           ELSE 0.0
      END AS fts_rank

    FROM public.sku_directory s
    WHERE
      s.is_active = true
      AND (
        (p_category IS NULL AND p_categories IS NULL)
        OR (p_category IS NOT NULL AND s.category = p_category)
        OR (p_categories IS NOT NULL AND s.category = ANY(p_categories))
      )
  )
SELECT
  sku_id,
  item_name,
  category,
  unit,
  raw_aliases AS aliases,
  -- Final score: trgm score + small FTS bonus (capped at 1.0)
  LEAST(1.0, trgm_score + fts_rank * 0.12)::float AS similarity
FROM scored
WHERE trgm_score > p_threshold OR fts_rank > 0.05
ORDER BY similarity DESC
LIMIT p_limit;
$$;

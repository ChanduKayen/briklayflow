# New PO redesign — follow-up tickets

Spun out of the `ui/new-po-redesign` work. **None of the SQL below has been run.**
Executed by a human after review, per decision 3.

---

## TICKET 1 (launch-blocking-adjacent) — Catalog: mis-filed "Coarse Aggregate" family

**Why now:** the redesign's new "which one" disambiguation UI makes catalog
duplicates *visible*. Typing `kankara` returns **two families with the same
display name** in different categories (read-only probe, anon key):

| matched_term | category | sub_category | family_size |
|---|---|---|---|
| kankara | Aggregate | Coarse Aggregate | 24 |
| kankara | **Sand** | Coarse Aggregate | **2** |

The Sand-category family surfaces in the picker as **"Sand · sold by Nos"**.
Top offending SKU from `trgm_match_sku('kankara')`:

```
sku_id:    SAND-COARSEAGGR-50
item_name: "Coarse Aggregate 50  "   (note trailing spaces)
category:  Sand
unit:      Nos
aliases:   kankara
similarity: 1.0
```

⚠️ **Data smell:** "Coarse Aggregate **50**", unit **Nos**, is almost certainly
junk/test data — real coarse aggregate is sized 12/20/40 mm and sold by **MT**.
So **DELETE is the primary path**; reclassify/merge is the *fallback* used only
if live `po_line_items` already reference these rows (we must not orphan them).
The family reports `family_size 2`, so there is a second member; the snapshot in
Step 1 captures both for inspection/rollback.

### Run as ONE transaction (review inside the txn, COMMIT or ROLLBACK at the end)

```sql
BEGIN;

-- ── Step 1: inspect + snapshot (read + durable backup for rollback/audit) ──
SELECT sku_id, item_name, category, sub_category, dimension, variant, grade, unit, aliases
FROM sku_directory
WHERE category = 'Sand' AND sub_category = 'Coarse Aggregate';

CREATE TABLE IF NOT EXISTS backup_sand_coarse_aggregate_20260611 AS
SELECT * FROM sku_directory
WHERE category = 'Sand' AND sub_category = 'Coarse Aggregate';

-- ── Step 2: FK check — does any live PO line reference these rows? ──
-- Decides the path. Expected for junk data: 0.
SELECT li.po_id, li.sku_id, li.item_name
FROM po_line_items li
JOIN sku_directory s ON s.sku_id = li.sku_id
WHERE s.category = 'Sand' AND s.sub_category = 'Coarse Aggregate';

-- ── Step 3a: PRIMARY PATH — DELETE (run ONLY if Step 2 returned 0 rows) ──
DELETE FROM sku_directory
WHERE category = 'Sand' AND sub_category = 'Coarse Aggregate';

-- ── Step 3b: FALLBACK PATH — reclassify/merge (run INSTEAD of 3a iff Step 2
--            returned rows; keep sku_id so the referencing PO lines stay valid) ──
-- UPDATE sku_directory
-- SET category = 'Aggregate', unit = 'MT', item_name = trim(item_name)
-- WHERE category = 'Sand' AND sub_category = 'Coarse Aggregate';

-- ── Step 4: alias survival check — 'kankara' must still resolve to coarse
--            aggregate (it is also an alias on the AGG-COARSE-* SKUs, so DELETE
--            must NOT lose coverage). Expect ≥1 row, all category 'Aggregate'. ──
SELECT sku_id, category, sub_category, unit, aliases
FROM sku_directory
WHERE aliases ILIKE '%kankara%';

COMMIT;   -- or ROLLBACK; if Step 4 / the path outcome looks wrong
```

### Step 5: refresh the alias index (after COMMIT)
`search_alias_family` reads `sku_alias_family_index`. Verify its object type
first, then refresh accordingly:
```sql
-- If it is a materialized view:
REFRESH MATERIALIZED VIEW CONCURRENTLY sku_alias_family_index;
-- If it is a trigger-maintained table, no action; if a plain view, no action.
```

### Step 6: verify (read-only, outside the transaction)
Re-run the probes; expect only the `Aggregate` family for `kankara`, and no
"Sand · Nos" candidate:
```sql
SELECT * FROM search_alias_family('kankara', 5);
SELECT sku_id, item_name, category, unit, similarity
FROM trgm_match_sku('kankara', 8, 0.10);
```

---

## TICKET 2 — Cleanup (non-blocking; left untouched in `ui/new-po-redesign` per amendment E + decision 4)

In `src/pages/NewPurchaseOrder.tsx`:
- Remove debug `console.log`s left in production paths:
  - `:3775` `console.log('[EXTRACT]', val, extractAttrs(val))`
  - `:3995` `console.log('[CHIP-RENDER]', …)` (commented `// TEMP`)
  - `:1627` `console.log('[DYM]', q, '→', data)` (commented `// TEMP — remove after verifying`)
- Remove the dead import `matchSKUsFromText` (`:14`) — imported, never called.

Dead component:
- `src/components/InlineAttributePills.tsx` is imported nowhere (only referenced
  in a code comment at `NewPurchaseOrder.tsx:3935`). Safe to delete in a cleanup
  pass. **Not deleted in this branch** by instruction.

---

## TICKET 3 — Landing AuthPanel / Login.tsx auth duplication (from `ui/landing-page`)

The landing page's `AuthPanel` (`src/components/landing/AuthPanel.tsx`) replicates
`Login.tsx`'s Supabase calls (`signUp` with `options.data.full_name`, the
empty-`identities` "already exists" check, `signInWithPassword`, and the
`resend({ type: 'signup' })` confirmation flow). This is intentional duplication
for launch.
- **Unify both into a shared `useAuth` hook** so the panel and the login page
  call one implementation. The mirror comment in `AuthPanel.tsx` marks the call site.
- **Password reset flow + restore the "Forgot password?" link on the landing.**
  The link was removed from `AuthPanel` for launch (no reset flow exists yet);
  restore it once the reset flow ships.

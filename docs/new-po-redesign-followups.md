# New PO redesign — follow-up tickets

Spun out of the `ui/new-po-redesign` work. **None of the SQL below has been run.**
Execute after review — by a human, per decision 3.

---

## TICKET 1 (launch-blocking-adjacent) — Catalog: mis-filed "Coarse Aggregate" family

**Why now:** the redesign's new "which one" disambiguation UI makes catalog
duplicates *visible*. Typing `kankara` returns **two families with the same
display name** in different categories (read-only probe, anon key):

| matched_term | category | sub_category | family_size |
|---|---|---|---|
| kankara | Aggregate | Coarse Aggregate | 24 |
| kankara | **Sand** | Coarse Aggregate | **2** |

The Sand-category family surfaces as a candidate reading **"Sand · sold by Nos"**.
Top offending SKU from `trgm_match_sku('kankara')`:

```
sku_id:    SAND-COARSEAGGR-50
item_name: "Coarse Aggregate 50  "   (note trailing spaces)
category:  Sand
unit:      Nos
aliases:   kankara
similarity: 1.0
```

⚠️ **Data smell to confirm before acting:** "Coarse Aggregate **50**" with unit
**Nos** is suspicious — real coarse aggregate is sized 12/20/40 mm and sold by
**MT**. The `Sand::Coarse Aggregate` family reports `family_size 2`, so there is
**one more member** I did not see in the top-8; inspect both before choosing
path A or path B.

### Step 0 — inspect (read-only, run first)
```sql
SELECT sku_id, item_name, category, sub_category, dimension, variant, grade, unit, aliases
FROM sku_directory
WHERE category = 'Sand' AND sub_category = 'Coarse Aggregate';
```

### Path A — reclassify/merge into Aggregate (preferred if the rows are real)
`sku_id` is left unchanged on purpose — it is the stable key referenced by
`po_line_items.sku_id`; updating the row in place keeps every existing PO line
intact. (The literal "SAND-" prefix becomes cosmetically stale; a key rename is
a separate, riskier migration and is explicitly **out of scope**.)

```sql
UPDATE sku_directory
SET category  = 'Aggregate',
    unit      = 'MT',
    item_name = trim(item_name)      -- strip the trailing spaces in 'Coarse Aggregate 50  '
WHERE category = 'Sand' AND sub_category = 'Coarse Aggregate';
```

### Path B — delete (only if Step 0 shows these are junk/test rows)
Guard against orphaning live PO lines first:
```sql
-- Must return 0 rows before deleting:
SELECT li.*
FROM po_line_items li
JOIN sku_directory s ON s.sku_id = li.sku_id
WHERE s.category = 'Sand' AND s.sub_category = 'Coarse Aggregate';

-- Then, only if the above is empty:
DELETE FROM sku_directory
WHERE category = 'Sand' AND sub_category = 'Coarse Aggregate';
```

### Step 2 — refresh the alias index
`search_alias_family` reads `sku_alias_family_index`. If that object is a
materialized view / derived table (verify), refresh or rebuild it so the stale
`Sand::Coarse Aggregate` family stops being returned. Re-run the Step-0 probe
and `trgm_match_sku('kankara')` to confirm only the `Aggregate` family remains.

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

-- ============================================================
-- Fix polluted SKU categories.
-- Prior to 20260523120000, autoAddItemToDictionary and
-- handleApproveParametricSku stored the raw vendor trade label
-- (e.g. "Plumbing Materials Supplier") as the SKU category instead
-- of the material category (e.g. "Plumbing").
-- This migration remaps every known polluted value to the correct
-- first entry of VENDOR_TO_SKU_CATEGORIES for that trade label.
-- ============================================================

BEGIN;

UPDATE public.sku_directory SET category = 'Cement'         WHERE category = 'Cement Supplier';
UPDATE public.sku_directory SET category = 'Sand'           WHERE category = 'Sand & Aggregate Supplier';
UPDATE public.sku_directory SET category = 'Brick'          WHERE category = 'Bricks / Blocks Supplier';
UPDATE public.sku_directory SET category = 'Steel'          WHERE category = 'Steel / TMT Bar Supplier';
UPDATE public.sku_directory SET category = 'Waterproofing'  WHERE category = 'Waterproofing Materials Supplier';
UPDATE public.sku_directory SET category = 'Admixture'      WHERE category = 'Admixture Supplier';
UPDATE public.sku_directory SET category = 'Tile'           WHERE category = 'Tiles Supplier';
UPDATE public.sku_directory SET category = 'Tile'           WHERE category = 'Marble / Granite Supplier';
UPDATE public.sku_directory SET category = 'Paint'          WHERE category = 'Paint Supplier';
UPDATE public.sku_directory SET category = 'Hardware'       WHERE category = 'Hardware & Fittings Supplier';
UPDATE public.sku_directory SET category = 'Glass'          WHERE category = 'Glass & Aluminium Supplier';
UPDATE public.sku_directory SET category = 'Hardware'       WHERE category = 'False Ceiling Materials Supplier';
UPDATE public.sku_directory SET category = 'Tile'           WHERE category = 'Flooring Materials Supplier';
UPDATE public.sku_directory SET category = 'Electrical'     WHERE category = 'Electrical Materials Supplier';
UPDATE public.sku_directory SET category = 'Plumbing'       WHERE category = 'Plumbing Materials Supplier';
UPDATE public.sku_directory SET category = 'Electrical'     WHERE category = 'HVAC Materials Supplier';
UPDATE public.sku_directory SET category = 'Plumbing'       WHERE category = 'Sanitary Ware Supplier';
UPDATE public.sku_directory SET category = 'Electrical'     WHERE category = 'Lighting Supplier';
UPDATE public.sku_directory SET category = 'Electrical'     WHERE category = 'Cables & Conduits Supplier';
UPDATE public.sku_directory SET category = 'Hardware'       WHERE category = 'Scaffolding Supplier';
UPDATE public.sku_directory SET category = 'Hardware'       WHERE category = 'Tools & Machinery Vendor';
UPDATE public.sku_directory SET category = 'Cement'         WHERE category = 'Ready Mix Concrete (RMC) Plant';

-- SKUs that landed in category = 'General Supplies' (old handleApproveParametricSku default)
-- cannot be auto-remapped without knowing the item type. Log a count so the team can review.
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.sku_directory WHERE category = 'General Supplies';
  IF v_count > 0 THEN
    RAISE WARNING 'sku_directory has % row(s) with category=''General Supplies'' that need manual category assignment.', v_count;
  END IF;
END $$;

COMMIT;

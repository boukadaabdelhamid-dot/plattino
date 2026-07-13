import type { Pool } from "pg";
import { logger } from "./logger";

// Idempotent cleanup of duplicate rows in product_families, product_brands, and
// product_colors that were created by repeated Excel imports before the unique
// index on (store_id, lower(name_fr)) was introduced.
//
// Strategy:
//   1. For each table, identify groups sharing (store_id, lower(name_fr)) and pick
//      the row with the lowest id as the canonical survivor.
//   2. Re-point all products.family_id / brand_id / color_id FKs from duplicate
//      ids onto the canonical id.
//   3. Delete the non-canonical duplicate rows.
//
// Hardened with to_regclass guards so it is a safe no-op on a fresh DB where the
// tables may not exist yet (before the first schema push).
// The unique indexes (product_families_store_lower_name_fr_key etc.) are created
// separately by runAttributeUniqueIndexMigration and tolerate this migration
// running before them — duplicates are removed here first, so index creation
// cannot conflict.
export const PRODUCT_ATTRIBUTE_DEDUP_SQL = `
DO $attr_dedup$
BEGIN
  PERFORM pg_advisory_xact_lock(742318992);

  -- Bail out early if the tables do not exist yet (fresh DB before schema push).
  IF to_regclass('public.product_families') IS NULL
     OR to_regclass('public.product_brands') IS NULL
     OR to_regclass('public.product_colors') IS NULL
     OR to_regclass('public.products') IS NULL THEN
    RETURN;
  END IF;

  -- ─── product_families ──────────────────────────────────────────────────────
  CREATE TEMP TABLE _family_map ON COMMIT DROP AS
  SELECT pf.id AS old_id, canon.canonical_id
  FROM product_families pf
  JOIN (
    SELECT store_id, lower(name_fr) AS key, MIN(id) AS canonical_id
    FROM product_families
    GROUP BY store_id, lower(name_fr)
    HAVING COUNT(*) > 1
  ) canon ON canon.store_id = pf.store_id AND lower(pf.name_fr) = canon.key
  WHERE pf.id <> canon.canonical_id;

  IF EXISTS (SELECT 1 FROM _family_map) THEN
    -- products.family_id may not exist on very old schemas; guard with column check.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'products' AND column_name = 'family_id'
    ) THEN
      UPDATE products p
      SET family_id = m.canonical_id
      FROM _family_map m
      WHERE p.family_id = m.old_id;
    END IF;

    DELETE FROM product_families WHERE id IN (SELECT old_id FROM _family_map);
  END IF;

  -- ─── product_brands ────────────────────────────────────────────────────────
  CREATE TEMP TABLE _brand_map ON COMMIT DROP AS
  SELECT pb.id AS old_id, canon.canonical_id
  FROM product_brands pb
  JOIN (
    SELECT store_id, lower(name_fr) AS key, MIN(id) AS canonical_id
    FROM product_brands
    GROUP BY store_id, lower(name_fr)
    HAVING COUNT(*) > 1
  ) canon ON canon.store_id = pb.store_id AND lower(pb.name_fr) = canon.key
  WHERE pb.id <> canon.canonical_id;

  IF EXISTS (SELECT 1 FROM _brand_map) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'products' AND column_name = 'brand_id'
    ) THEN
      UPDATE products p
      SET brand_id = m.canonical_id
      FROM _brand_map m
      WHERE p.brand_id = m.old_id;
    END IF;

    DELETE FROM product_brands WHERE id IN (SELECT old_id FROM _brand_map);
  END IF;

  -- ─── product_colors ────────────────────────────────────────────────────────
  CREATE TEMP TABLE _color_map ON COMMIT DROP AS
  SELECT pc.id AS old_id, canon.canonical_id
  FROM product_colors pc
  JOIN (
    SELECT store_id, lower(name_fr) AS key, MIN(id) AS canonical_id
    FROM product_colors
    GROUP BY store_id, lower(name_fr)
    HAVING COUNT(*) > 1
  ) canon ON canon.store_id = pc.store_id AND lower(pc.name_fr) = canon.key
  WHERE pc.id <> canon.canonical_id;

  IF EXISTS (SELECT 1 FROM _color_map) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'products' AND column_name = 'color_id'
    ) THEN
      UPDATE products p
      SET color_id = m.canonical_id
      FROM _color_map m
      WHERE p.color_id = m.old_id;
    END IF;

    DELETE FROM product_colors WHERE id IN (SELECT old_id FROM _color_map);
  END IF;

END
$attr_dedup$;
`;

export async function runProductAttributeDedupMigration(pool: Pool): Promise<void> {
  try {
    await pool.query(PRODUCT_ATTRIBUTE_DEDUP_SQL);
    logger.info("Product attribute dedup migration applied.");
  } catch (err) {
    logger.error({ err }, "Product attribute dedup migration FAILED");
    throw err;
  }
}

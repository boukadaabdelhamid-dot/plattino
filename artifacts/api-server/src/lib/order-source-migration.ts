import type { Pool } from "pg";

/**
 * Idempotent migration: adds `order_source` column to the `orders` table.
 * 'pos'  = quick POS sale (default for all existing rows)
 * 'bon'  = formal bon de vente created via the Bons de Vente page
 * null   = online / storefront order (legacy, not explicitly tagged)
 */
export async function runOrderSourceMigration(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_source TEXT DEFAULT 'pos';
    `);
  } catch (err) {
    // Non-fatal if already exists or partial failure
    console.warn("[order-source-migration] skipped:", (err as Error).message);
  }
}

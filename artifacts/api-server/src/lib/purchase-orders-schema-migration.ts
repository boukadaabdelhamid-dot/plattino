import type { Pool } from "pg";

/**
 * Idempotent migration: adds `receipt_image_url` column to `purchase_orders`.
 * This column was added to the Drizzle schema but can be missing from the
 * production DB if a Railway deployment ran before the schema push completed.
 * Running IF NOT EXISTS here makes every boot self-healing.
 */
export async function runPurchaseOrdersSchemaMigration(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS receipt_image_url TEXT;
    `);
    console.info("[purchase-orders-schema-migration] Applied.");
  } catch (err) {
    console.warn("[purchase-orders-schema-migration] skipped:", (err as Error).message);
  }
}

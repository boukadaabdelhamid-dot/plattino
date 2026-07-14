import type { Pool } from "pg";

/**
 * Idempotent migration: adds `payment_method` column to the `orders` table.
 * 'comptant' = cash paid immediately at clôture (credits caisse)
 * 'a_terme'  = credit sale (creates a customer receivable at clôture)
 */
export async function runPaymentMethodMigration(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'comptant';
    `);
    console.info("[payment-method-migration] Applied.");
  } catch (err) {
    console.warn("[payment-method-migration] skipped:", (err as Error).message);
  }
}

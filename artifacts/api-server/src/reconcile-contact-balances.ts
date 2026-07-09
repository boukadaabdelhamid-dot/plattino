// Standalone one-time contact-identity balance reconciliation runner.
//
// Reconciles PRE-EXISTING cross-store balance divergence for global_contact_id
// groups (BOTH the customer side and the supplier side of customer_supplier
// contacts) against DATABASE_URL and exits. See
// lib/contact-balance-reconcile-migration.ts for the full strategy, idempotency
// guarantees, the pre-divergence report to eyeball first, and the operator
// double-entry CAUTION.
//
// Run this AFTER runContactGlobalLinkMigration has executed at least once (server
// boot does this automatically) so global_contact_id groups actually exist.
//
// Idempotent: a no-op once every linked contact's balance is unified per role, so
// it is safe to re-run. This is an explicit runbook step (NOT auto-wired into
// deploy or boot) precisely so the pre-divergence report can be reviewed before
// the first production run. Invoke with:
//   node --enable-source-maps dist/reconcile-contact-balances.mjs
import { pool } from "./lib/db";
import { logger } from "./lib/logger";
import { runContactBalanceReconcileMigration } from "./lib/contact-balance-reconcile-migration";

async function main(): Promise<void> {
  try {
    const { remainingDivergent } = await runContactBalanceReconcileMigration(pool);
    logger.info({ remainingDivergent }, "Contact-balance reconciliation complete.");
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Contact-balance reconciliation FAILED");
    process.exit(1);
  });

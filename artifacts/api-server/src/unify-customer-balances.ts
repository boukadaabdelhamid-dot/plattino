// Standalone one-time customer-balance unification runner.
//
// Reconciles PRE-EXISTING cross-store customer balance divergence against
// DATABASE_URL and exits. See lib/customer-balance-unify-migration.ts for the
// full strategy, idempotency guarantees, the pre-divergence report to eyeball
// first, and the operator double-entry CAUTION.
//
// Idempotent: a no-op once every linked customer's balance is unified, so it is
// safe to re-run. This is an explicit runbook step (NOT auto-wired into deploy or
// boot) precisely so the pre-divergence report can be reviewed before the first
// production run. Invoke with:
//   node --enable-source-maps dist/unify-customer-balances.mjs
import { pool } from "./lib/db";
import { logger } from "./lib/logger";
import { runCustomerBalanceUnifyMigration } from "./lib/customer-balance-unify-migration";

async function main(): Promise<void> {
  try {
    const { remainingDivergent } = await runCustomerBalanceUnifyMigration(pool);
    logger.info({ remainingDivergent }, "Customer-balance unification complete.");
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Customer-balance unification FAILED");
    process.exit(1);
  });

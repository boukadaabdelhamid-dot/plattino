// Standalone pre-push caisse consolidation runner.
//
// Runs the idempotent global-caisse consolidation against DATABASE_URL and exits.
// It MUST run BEFORE `drizzle-kit push --force` on deploy (see railway.json): the
// Drizzle schema declares the global partial-unique indexes on `caisses`, and push
// would try to create them on still-duplicated production data and fail. Running
// this first leaves clean, conformant data so push (and the server boot safety
// net) succeed. Safe no-op on fresh/partial databases.
import { pool } from "./lib/db";
import { logger } from "./lib/logger";
import { runCaisseGlobalMigration } from "./lib/caisse-global-migration";

async function main(): Promise<void> {
  try {
    await runCaisseGlobalMigration(pool);
    logger.info("Pre-push caisse consolidation complete.");
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Pre-push caisse consolidation FAILED");
    process.exit(1);
  });

import type { Pool } from "pg";
import { logger } from "./logger";

// One-time (idempotent) reconciliation of PRE-EXISTING cross-store customer
// balance divergence.
//
// Customers linked across stores share one global identity
// (customer_profiles.user_id). Historically each store accumulated its own
// customer-side balance independently, so the same person could show a different
// balance per store. Going forward, syncLinkedCustomerBalances (balance-sync.ts)
// keeps the linked profiles in lockstep after every mutation; this migration
// reconciles rows that diverged BEFORE that sync existed.
//
// Strategy: for every user with >1 store profile whose balances DIFFER, set each
// linked profile's current_balance to the SUM of the per-store balances (the
// per-store balances represent disjoint per-store activity, so their sum is the
// true unified total), then recompute each affected contact's canonical balance
// (= customer_profiles + suppliers), exactly like recomputeContactBalance.
//
// Idempotency: the update is GATED on divergent groups
// (COUNT(*) > 1 AND COUNT(DISTINCT current_balance) > 1). After it runs once the
// linked balances are equal (distinct = 1), so a re-run is a no-op. Runs inside a
// single advisory-locked transaction (the DO block) so it applies atomically.
//
// CAUTION (operator double-entry): if the SAME real debt was manually entered in
// two stores as two DIFFERENT current_balance values (e.g. via the PUT absolute
// balance override) instead of being accumulated from disjoint activity, the SUM
// double-counts it. Before the FIRST run on a populated production database, run
// the pre-divergence report below and eyeball any group with >1 nonzero balance.
// (On dev this was reviewed and applied.) For this reason the migration is NOT
// auto-wired into server boot or the deploy start command — it is an explicit,
// auditable runbook step (see src/unify-customer-balances.ts).
//
// Pre-divergence report (run manually before the first production execution):
//   SELECT user_id,
//          ARRAY_AGG(store_id ORDER BY store_id)                    AS stores,
//          ARRAY_AGG(current_balance::text ORDER BY store_id)       AS balances,
//          COUNT(*) FILTER (WHERE COALESCE(current_balance,0) <> 0) AS nonzero
//   FROM customer_profiles
//   WHERE user_id IS NOT NULL
//   GROUP BY user_id
//   HAVING COUNT(*) > 1 AND COUNT(DISTINCT current_balance) > 1
//   ORDER BY nonzero DESC, user_id;

export const CUSTOMER_BALANCE_UNIFY_MIGRATION_SQL = `
DO $customer_balance_unify$
DECLARE
  affected_users int[];
BEGIN
  -- Serialize concurrent runs so reconciliation applies exactly once at a time.
  PERFORM pg_advisory_xact_lock(742318971);

  -- Nothing to do until the customer_profiles table exists (fresh DB).
  IF to_regclass('public.customer_profiles') IS NULL THEN
    RETURN;
  END IF;

  -- Divergent cross-store customer groups: same user_id in >1 store, differing balances.
  SELECT ARRAY_AGG(user_id) INTO affected_users
  FROM (
    SELECT user_id
    FROM customer_profiles
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT current_balance) > 1
  ) d;

  IF affected_users IS NULL THEN
    RETURN;
  END IF;

  -- 1) Unify each divergent user's per-store balance to the SUM of disjoint per-store activity.
  UPDATE customer_profiles cp
  SET current_balance = g.total, updated_at = NOW()
  FROM (
    SELECT user_id, SUM(COALESCE(current_balance,0)) AS total
    FROM customer_profiles
    WHERE user_id = ANY(affected_users)
    GROUP BY user_id
  ) g
  WHERE cp.user_id = g.user_id;

  -- 2) Recompute canonical contact balance = customer_profiles + suppliers for every
  --    contact linked to an affected profile (mirrors recomputeContactBalance).
  IF to_regclass('public.contacts') IS NOT NULL AND to_regclass('public.suppliers') IS NOT NULL THEN
    UPDATE contacts c
    SET current_balance = COALESCE(cp.bal,0) + COALESCE(sp.bal,0), updated_at = NOW()
    FROM (
      SELECT DISTINCT contact_id FROM customer_profiles
      WHERE user_id = ANY(affected_users) AND contact_id IS NOT NULL
    ) ac
    LEFT JOIN (SELECT contact_id, current_balance AS bal FROM customer_profiles WHERE contact_id IS NOT NULL) cp ON cp.contact_id = ac.contact_id
    LEFT JOIN (SELECT contact_id, current_balance AS bal FROM suppliers WHERE contact_id IS NOT NULL) sp ON sp.contact_id = ac.contact_id
    WHERE c.id = ac.contact_id;
  END IF;

  RAISE NOTICE 'customer-balance-unify: reconciled % user(s): %', array_length(affected_users, 1), affected_users;
END $customer_balance_unify$;
`;

// Runs the reconciliation, then verifies no divergent linked customers remain.
// Returns the number of still-divergent users (should be 0 after a successful run).
export async function runCustomerBalanceUnifyMigration(pool: Pool): Promise<{ remainingDivergent: number }> {
  await pool.query(CUSTOMER_BALANCE_UNIFY_MIGRATION_SQL);

  const { rows } = await pool.query<{ user_id: number }>(`
    SELECT user_id
    FROM customer_profiles
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT current_balance) > 1
  `);

  if (rows.length > 0) {
    logger.warn(
      { users: rows.map((r) => r.user_id) },
      "customer-balance-unify: divergent linked customers REMAIN after reconciliation (review manually)",
    );
  } else {
    logger.info("customer-balance-unify: all linked customers have a single unified balance across stores");
  }
  return { remainingDivergent: rows.length };
}

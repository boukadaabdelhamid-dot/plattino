import type { Pool } from "pg";
import { logger } from "./logger";

// One-time (idempotent) reconciliation of PRE-EXISTING cross-store balance
// divergence for contact-linked (global_contact_id) groups — the contact-identity
// equivalent of customer-balance-unify-migration.ts, extended to cover BOTH the
// customer side and the supplier side of a customer_supplier contact (the
// customer-only migration never looked at suppliers, which is exactly how a
// dual-role contact's two roles could drift apart independently).
//
// Strategy per role, per global_contact_id group: for groups with >1 row (i.e.
// >1 store) whose balances DIFFER, set every row's current_balance to the SUM of
// the per-store balances (disjoint per-store activity, so the sum is the true
// unified total — same reasoning as the customer-only migration), then recompute
// contacts.current_balance for every affected contact.
//
// Idempotency: gated on divergent groups (COUNT(*) > 1 AND COUNT(DISTINCT
// current_balance) > 1); a re-run after unification is a no-op.
//
// CAUTION (operator double-entry) — identical concern to the customer-only
// migration: if the SAME real debt was entered independently in two stores
// (e.g. via an absolute-balance override) rather than accumulated from disjoint
// activity, summing double-counts it. Run the pre-divergence report below and
// review any group with >1 nonzero balance BEFORE the first run on a populated
// database. For this reason this migration is NOT auto-wired into server boot —
// it is an explicit, auditable runbook step (see src/reconcile-contact-balances.ts).
//
// Pre-divergence report — customer side:
//   SELECT c.global_contact_id,
//          ARRAY_AGG(cp.store_id ORDER BY cp.store_id)               AS stores,
//          ARRAY_AGG(cp.current_balance::text ORDER BY cp.store_id)  AS balances
//   FROM customer_profiles cp JOIN contacts c ON c.id = cp.contact_id
//   WHERE c.global_contact_id IS NOT NULL
//   GROUP BY c.global_contact_id
//   HAVING COUNT(*) > 1 AND COUNT(DISTINCT cp.current_balance) > 1;
// Pre-divergence report — supplier side: same query against `suppliers s JOIN
// contacts c ON c.id = s.contact_id`.

export const CONTACT_BALANCE_RECONCILE_MIGRATION_SQL = `
DO $contact_balance_reconcile$
DECLARE
  affected_customer_groups text[];
  affected_supplier_groups text[];
  affected_contacts int[];
BEGIN
  PERFORM pg_advisory_xact_lock(742318979);

  IF to_regclass('public.contacts') IS NULL
     OR to_regclass('public.customer_profiles') IS NULL
     OR to_regclass('public.suppliers') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'global_contact_id'
  ) THEN
    RETURN;
  END IF;

  -- Divergent customer-side groups.
  SELECT ARRAY_AGG(gcid) INTO affected_customer_groups
  FROM (
    SELECT c.global_contact_id AS gcid
    FROM customer_profiles cp JOIN contacts c ON c.id = cp.contact_id
    WHERE c.global_contact_id IS NOT NULL
    GROUP BY c.global_contact_id
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT cp.current_balance) > 1
  ) d;

  IF affected_customer_groups IS NOT NULL THEN
    UPDATE customer_profiles cp
    SET current_balance = g.total, updated_at = NOW()
    FROM (
      SELECT c.global_contact_id AS gcid, SUM(COALESCE(cp2.current_balance, 0)) AS total
      FROM customer_profiles cp2 JOIN contacts c ON c.id = cp2.contact_id
      WHERE c.global_contact_id = ANY(affected_customer_groups)
      GROUP BY c.global_contact_id
    ) g
    JOIN contacts c2 ON c2.global_contact_id = g.gcid
    WHERE cp.contact_id = c2.id;
  END IF;

  -- Divergent supplier-side groups.
  SELECT ARRAY_AGG(gcid) INTO affected_supplier_groups
  FROM (
    SELECT c.global_contact_id AS gcid
    FROM suppliers s JOIN contacts c ON c.id = s.contact_id
    WHERE c.global_contact_id IS NOT NULL
    GROUP BY c.global_contact_id
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT s.current_balance) > 1
  ) d;

  IF affected_supplier_groups IS NOT NULL THEN
    UPDATE suppliers s
    SET current_balance = g.total
    FROM (
      SELECT c.global_contact_id AS gcid, SUM(COALESCE(s2.current_balance, 0)) AS total
      FROM suppliers s2 JOIN contacts c ON c.id = s2.contact_id
      WHERE c.global_contact_id = ANY(affected_supplier_groups)
      GROUP BY c.global_contact_id
    ) g
    JOIN contacts c2 ON c2.global_contact_id = g.gcid
    WHERE s.contact_id = c2.id;
  END IF;

  IF affected_customer_groups IS NULL AND affected_supplier_groups IS NULL THEN
    RETURN;
  END IF;

  -- Recompute contacts.current_balance for every contact in either affected group.
  SELECT ARRAY_AGG(DISTINCT c.id) INTO affected_contacts
  FROM contacts c
  WHERE c.global_contact_id = ANY(COALESCE(affected_customer_groups, ARRAY[]::text[]))
     OR c.global_contact_id = ANY(COALESCE(affected_supplier_groups, ARRAY[]::text[]));

  UPDATE contacts c
  SET current_balance = COALESCE(cp.bal, 0) + COALESCE(sp.bal, 0), updated_at = NOW()
  FROM (SELECT id FROM contacts WHERE id = ANY(affected_contacts)) ac
  LEFT JOIN (SELECT contact_id, current_balance AS bal FROM customer_profiles WHERE contact_id IS NOT NULL) cp ON cp.contact_id = ac.id
  LEFT JOIN (SELECT contact_id, current_balance AS bal FROM suppliers WHERE contact_id IS NOT NULL) sp ON sp.contact_id = ac.id
  WHERE c.id = ac.id;

  RAISE NOTICE 'contact-balance-reconcile: customer groups=%, supplier groups=%, contacts recomputed=%',
    affected_customer_groups, affected_supplier_groups, affected_contacts;
END $contact_balance_reconcile$;
`;

export async function runContactBalanceReconcileMigration(pool: Pool): Promise<{ remainingDivergent: number }> {
  await pool.query(CONTACT_BALANCE_RECONCILE_MIGRATION_SQL);

  const { rows } = await pool.query<{ gcid: string }>(`
    SELECT gcid FROM (
      SELECT c.global_contact_id AS gcid
      FROM customer_profiles cp JOIN contacts c ON c.id = cp.contact_id
      WHERE c.global_contact_id IS NOT NULL
      GROUP BY c.global_contact_id
      HAVING COUNT(*) > 1 AND COUNT(DISTINCT cp.current_balance) > 1
      UNION
      SELECT c.global_contact_id AS gcid
      FROM suppliers s JOIN contacts c ON c.id = s.contact_id
      WHERE c.global_contact_id IS NOT NULL
      GROUP BY c.global_contact_id
      HAVING COUNT(*) > 1 AND COUNT(DISTINCT s.current_balance) > 1
    ) d
  `);

  if (rows.length > 0) {
    logger.warn({ groups: rows.map((r) => r.gcid) }, "contact-balance-reconcile: divergent linked contacts REMAIN after reconciliation (review manually)");
  } else {
    logger.info("contact-balance-reconcile: all cross-store-linked contacts have a single unified balance per role");
  }
  return { remainingDivergent: rows.length };
}

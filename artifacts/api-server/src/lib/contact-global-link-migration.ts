import type { Pool } from "pg";
import { logger } from "./logger";

// Idempotent backfill of contacts.globalContactId for links that already exist
// via the two legacy per-role keys. This is metadata-only (no balance figures are
// changed) so it is safe to run automatically at every boot, unlike the balance
// drift reconciliation in contact-balance-reconcile-migration.ts (a deliberate,
// operator-run step because it can move money-figure columns).
//
// Two passes:
//   A. Contacts linked via a shared suppliers.globalSupplierId (already a
//      cross-store group) get a shared globalContactId.
//   B. Contacts linked via a shared customer_profiles.userId group get a shared
//      globalContactId — reusing whatever id Pass A already assigned to a member
//      of the group instead of minting a second, disconnected id. This is exactly
//      the reconciliation for the reported bug: a customer_supplier contact whose
//      customer side and supplier side were each cross-store-linked independently
//      now gets ONE identity covering both.
// Hardened with `to_regclass`/column-existence guards so it is a safe no-op before
// the ADD COLUMN statement above has run (fresh DB) or on a partial database.
export const CONTACT_GLOBAL_LINK_MIGRATION_SQL = `
DO $contact_global_link$
BEGIN
  PERFORM pg_advisory_xact_lock(742318977);

  IF to_regclass('public.contacts') IS NULL
     OR to_regclass('public.suppliers') IS NULL
     OR to_regclass('public.customer_profiles') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'global_contact_id'
  ) THEN
    RETURN;
  END IF;

  -- Pass A: supplier-side global groups.
  CREATE TEMP TABLE _gcid_supplier_groups ON COMMIT DROP AS
  SELECT s.global_supplier_id AS gsid,
         COALESCE(
           (SELECT c2.global_contact_id FROM suppliers s2 JOIN contacts c2 ON c2.id = s2.contact_id
            WHERE s2.global_supplier_id = s.global_supplier_id AND c2.global_contact_id IS NOT NULL LIMIT 1),
           gen_random_uuid()::text
         ) AS gcid
  FROM suppliers s
  WHERE s.contact_id IS NOT NULL AND s.global_supplier_id IS NOT NULL
  GROUP BY s.global_supplier_id;

  -- Same same-store collision guard as Pass B below: if this store already holds a
  -- DIFFERENT contact under the target gcid, skip rather than risk violating
  -- contacts_one_global_per_store and crashing boot on messy pre-existing data.
  UPDATE contacts c
  SET global_contact_id = g.gcid, updated_at = NOW()
  FROM suppliers s
  JOIN _gcid_supplier_groups g ON g.gsid = s.global_supplier_id
  WHERE c.id = s.contact_id
    AND (c.global_contact_id IS NULL OR c.global_contact_id <> g.gcid)
    AND NOT EXISTS (
      SELECT 1 FROM contacts other
      WHERE other.store_id = c.store_id AND other.global_contact_id = g.gcid AND other.id <> c.id
    );

  -- Pass B: customer-side global groups (userId shared by >1 contact-linked profile).
  -- Reuses an existing gcid from Pass A when a group member already has one, so a
  -- dual-role contact's two independently-linked groups merge into one identity.
  CREATE TEMP TABLE _gcid_customer_groups ON COMMIT DROP AS
  SELECT cp.user_id AS uid,
         COALESCE(
           (SELECT c2.global_contact_id FROM customer_profiles cp2 JOIN contacts c2 ON c2.id = cp2.contact_id
            WHERE cp2.user_id = cp.user_id AND c2.global_contact_id IS NOT NULL LIMIT 1),
           gen_random_uuid()::text
         ) AS gcid
  FROM customer_profiles cp
  WHERE cp.contact_id IS NOT NULL
  GROUP BY cp.user_id
  HAVING COUNT(*) > 1;

  -- Skip any contact whose store already holds a DIFFERENT contact row under the
  -- target gcid. This means the customer role and supplier role for this person
  -- were, pre-fix, split across two separate unlinked contact rows in the same
  -- store — genuinely ambiguous pre-existing data that a boot migration must not
  -- guess about. It is left unlinked here and surfaces via
  -- balance-consistency-check.ts for manual review, instead of crashing boot.
  UPDATE contacts c
  SET global_contact_id = g.gcid, updated_at = NOW()
  FROM customer_profiles cp
  JOIN _gcid_customer_groups g ON g.uid = cp.user_id
  WHERE c.id = cp.contact_id
    AND (c.global_contact_id IS NULL OR c.global_contact_id <> g.gcid)
    AND NOT EXISTS (
      SELECT 1 FROM contacts other
      WHERE other.store_id = c.store_id AND other.global_contact_id = g.gcid AND other.id <> c.id
    );
END
$contact_global_link$;
`;

export async function runContactGlobalLinkMigration(pool: Pool): Promise<void> {
  try {
    await pool.query(CONTACT_GLOBAL_LINK_MIGRATION_SQL);
    logger.info("Contact global-link backfill migration applied.");
  } catch (err) {
    logger.error({ err }, "Contact global-link backfill migration FAILED");
    throw err;
  }
}

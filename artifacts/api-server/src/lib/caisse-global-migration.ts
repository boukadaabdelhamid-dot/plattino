import type { Pool } from "pg";
import { logger } from "./logger";

// Idempotent consolidation to the GLOBAL caisse model: ONE org-wide main caisse
// and ONE personal caisse per user (store-agnostic). It conserves balances,
// re-points every caisse FK onto the surviving canonical caisse, drops the legacy
// per-store unique indexes, detaches caisses from any store, refunds + cancels
// pending self-transfers, and (re)creates the global unique indexes.
//
// IMPORTANT — this MUST run BEFORE `drizzle-kit push --force` on deploy: the
// Drizzle schema declares the global partial-unique indexes, and push would try
// to create them on still-duplicated production data and fail. Consolidating
// first leaves clean data so push (and this migration) succeed. It also runs
// again at server boot as an idempotent safety net.
//
// Hardened with `to_regclass` guards so it is a safe no-op on fresh or partial
// databases (e.g. before the very first schema push) where some tables are absent.
export const CAISSE_GLOBAL_MIGRATION_SQL = `
DO $caisse_global$
BEGIN
  -- Serialize concurrent boots/deploys so consolidation runs exactly once at a time.
  PERFORM pg_advisory_xact_lock(742318964);

  -- Nothing to do until the core caisse tables exist (fresh DB before schema push).
  IF to_regclass('public.caisses') IS NULL OR to_regclass('public.caisse_movements') IS NULL THEN
    RETURN;
  END IF;

  -- Global caisses are not bound to a store.
  BEGIN ALTER TABLE caisses ALTER COLUMN store_id DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END;
  IF to_regclass('public.caisse_transfers') IS NOT NULL THEN
    BEGIN ALTER TABLE caisse_transfers ALTER COLUMN store_id DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END;
  END IF;

  -- Drop legacy per-store unique indexes so consolidation cannot conflict.
  DROP INDEX IF EXISTS caisses_one_main_per_store;
  DROP INDEX IF EXISTS caisses_one_per_owner_store;

  -- Map every caisse to its canonical survivor: lowest id per (kind, owner).
  -- Mains share one partition (owner is NULL); staff are grouped per owner.
  CREATE TEMP TABLE _caisse_map ON COMMIT DROP AS
  SELECT c.id AS old_id, g.canonical_id
  FROM caisses c
  JOIN (
    SELECT kind, owner_user_id, MIN(id) AS canonical_id
    FROM caisses GROUP BY kind, owner_user_id
  ) g ON g.kind = c.kind AND g.owner_user_id IS NOT DISTINCT FROM c.owner_user_id;

  -- Re-point every reference from duplicate caisses onto the survivor.
  UPDATE caisse_movements t SET caisse_id = m.canonical_id FROM _caisse_map m WHERE t.caisse_id = m.old_id AND t.caisse_id <> m.canonical_id;
  UPDATE caisse_movements t SET counterparty_caisse_id = m.canonical_id FROM _caisse_map m WHERE t.counterparty_caisse_id = m.old_id AND t.counterparty_caisse_id <> m.canonical_id;

  IF to_regclass('public.caisse_sessions') IS NOT NULL THEN
    UPDATE caisse_sessions t SET caisse_id = m.canonical_id FROM _caisse_map m WHERE t.caisse_id = m.old_id AND t.caisse_id <> m.canonical_id;
  END IF;
  IF to_regclass('public.customer_operations') IS NOT NULL THEN
    UPDATE customer_operations t SET caisse_id = m.canonical_id FROM _caisse_map m WHERE t.caisse_id = m.old_id AND t.caisse_id <> m.canonical_id;
  END IF;
  IF to_regclass('public.supplier_operations') IS NOT NULL THEN
    UPDATE supplier_operations t SET caisse_id = m.canonical_id FROM _caisse_map m WHERE t.caisse_id = m.old_id AND t.caisse_id <> m.canonical_id;
  END IF;
  IF to_regclass('public.caisse_transfers') IS NOT NULL THEN
    UPDATE caisse_transfers t SET sender_caisse_id = m.canonical_id FROM _caisse_map m WHERE t.sender_caisse_id = m.old_id AND t.sender_caisse_id <> m.canonical_id;
    UPDATE caisse_transfers t SET recipient_caisse_id = m.canonical_id FROM _caisse_map m WHERE t.recipient_caisse_id = m.old_id AND t.recipient_caisse_id <> m.canonical_id;
  END IF;

  -- Conserve money: each survivor absorbs the summed balance of its partition.
  UPDATE caisses c SET balance = agg.total
  FROM (SELECT m.canonical_id, SUM(src.balance) AS total FROM _caisse_map m JOIN caisses src ON src.id = m.old_id GROUP BY m.canonical_id) agg
  WHERE c.id = agg.canonical_id;

  -- Remove the now-merged duplicates.
  DELETE FROM caisses c USING _caisse_map m WHERE c.id = m.old_id AND m.old_id <> m.canonical_id;

  -- Detach surviving global caisses from any store.
  UPDATE caisses SET store_id = NULL WHERE store_id IS NOT NULL;

  IF to_regclass('public.caisse_transfers') IS NOT NULL THEN
    -- Pending transfers whose endpoints collapsed onto one caisse must be cancelled.
    -- Current transfers are no-hold (nothing reserved -> nothing to refund), but a
    -- legacy *held* transfer debited the sender at creation; cancelling it as-is
    -- would lose that money. Credit the held amount back and log a transfer_refund
    -- so consolidation stays balance-conserving. Idempotent: once cancelled below,
    -- the status='pending' guard prevents any re-refund on subsequent runs.
    UPDATE caisses c SET balance = c.balance + ct.amount
    FROM caisse_transfers ct
    WHERE ct.status = 'pending'
      AND ct.sender_caisse_id = ct.recipient_caisse_id
      AND c.id = ct.sender_caisse_id
      AND EXISTS (
        SELECT 1 FROM caisse_movements mh
        WHERE mh.caisse_transfer_id = ct.id
          AND mh.reason = 'transfer_hold' AND mh.type = 'debit'
      );

    INSERT INTO caisse_movements
      (caisse_id, type, amount, reason, counterparty_caisse_id, caisse_transfer_id, actor_user_id, notes)
    SELECT ct.sender_caisse_id, 'credit', ct.amount, 'transfer_refund',
           ct.recipient_caisse_id, ct.id, ct.requested_by_user_id,
           'Held self-transfer refunded during global caisse consolidation'
    FROM caisse_transfers ct
    WHERE ct.status = 'pending'
      AND ct.sender_caisse_id = ct.recipient_caisse_id
      AND EXISTS (
        SELECT 1 FROM caisse_movements mh
        WHERE mh.caisse_transfer_id = ct.id
          AND mh.reason = 'transfer_hold' AND mh.type = 'debit'
      );

    UPDATE caisse_transfers SET status = 'cancelled' WHERE status = 'pending' AND sender_caisse_id = recipient_caisse_id;
  END IF;

  -- Enforce the global invariants going forward. Creating these here (before the
  -- Drizzle push that also declares them) closes the race where an old instance
  -- could insert a new per-store caisse between consolidation and push.
  CREATE UNIQUE INDEX IF NOT EXISTS caisses_one_main_global ON caisses (kind) WHERE kind = 'main';
  CREATE UNIQUE INDEX IF NOT EXISTS caisses_one_per_owner ON caisses (owner_user_id) WHERE owner_user_id IS NOT NULL;
END
$caisse_global$;
`;

export async function runCaisseGlobalMigration(pool: Pool): Promise<void> {
  try {
    await pool.query(CAISSE_GLOBAL_MIGRATION_SQL);
    logger.info("Caisse global consolidation migration applied.");
  } catch (err) {
    logger.error({ err }, "Caisse global consolidation migration FAILED");
    throw err;
  }
}

import type { Pool } from "pg";

// Read-only consistency guardrail for the unified cross-store balance model.
// Used both as a manual/CI check and inside the integration test script
// (test-balance-sync.ts) to assert a scenario left the data in a valid state.
//
// A "violation" here always means: something wrote a balance without going
// through mutateCustomerBalance/mutateSupplierBalance + the sync helpers in
// balance-sync.ts, or linked two contacts without linkContactsGlobally.

export type BalanceViolation =
  | { kind: "contact_unified_mismatch"; contactId: number; contactBalance: string; expected: string }
  | { kind: "customer_cross_store_mismatch"; globalContactId: string; profiles: { storeId: number; userId: number; balance: string }[] }
  | { kind: "supplier_cross_store_mismatch"; globalContactId: string; suppliers: { storeId: number; supplierId: number; balance: string }[] }
  | { kind: "legacy_customer_mismatch"; userId: number; profiles: { storeId: number; balance: string }[] }
  | { kind: "legacy_supplier_mismatch"; globalSupplierId: string; suppliers: { storeId: number; supplierId: number; balance: string }[] };

export async function checkBalanceConsistency(pool: Pool): Promise<BalanceViolation[]> {
  const violations: BalanceViolation[] = [];

  // 1) contacts.current_balance must equal customer_profiles.current_balance +
  //    suppliers.current_balance for every customer_supplier contact.
  const mismatched = await pool.query<{ id: number; current_balance: string; expected: string }>(`
    SELECT c.id, c.current_balance,
      (COALESCE(cp.bal, 0) + COALESCE(sp.bal, 0))::text AS expected
    FROM contacts c
    LEFT JOIN (SELECT contact_id, current_balance AS bal FROM customer_profiles WHERE contact_id IS NOT NULL) cp ON cp.contact_id = c.id
    LEFT JOIN (SELECT contact_id, current_balance AS bal FROM suppliers WHERE contact_id IS NOT NULL) sp ON sp.contact_id = c.id
    WHERE c.contact_type = 'customer_supplier'
      AND ROUND(c.current_balance::numeric, 2) <> ROUND((COALESCE(cp.bal, 0) + COALESCE(sp.bal, 0))::numeric, 2)
  `);
  for (const row of mismatched.rows) {
    violations.push({ kind: "contact_unified_mismatch", contactId: row.id, contactBalance: row.current_balance, expected: row.expected });
  }

  // 2) Customer-side balances must agree across every store sharing the same
  //    contacts.global_contact_id.
  const custGroups = await pool.query<{ global_contact_id: string; store_id: number; user_id: number; balance: string }>(`
    SELECT c.global_contact_id, cp.store_id, cp.user_id, cp.current_balance AS balance
    FROM customer_profiles cp
    JOIN contacts c ON c.id = cp.contact_id
    WHERE c.global_contact_id IS NOT NULL
  `);
  violations.push(...groupMismatches(
    custGroups.rows,
    (r) => r.global_contact_id,
    (rows, gcid) => ({
      kind: "customer_cross_store_mismatch" as const,
      globalContactId: gcid,
      profiles: rows.map((r) => ({ storeId: r.store_id, userId: r.user_id, balance: r.balance })),
    }),
  ));

  // 3) Supplier-side balances must agree across every store sharing the same
  //    contacts.global_contact_id.
  const supGroups = await pool.query<{ global_contact_id: string; store_id: number; supplier_id: number; balance: string }>(`
    SELECT c.global_contact_id, s.store_id, s.id AS supplier_id, s.current_balance AS balance
    FROM suppliers s
    JOIN contacts c ON c.id = s.contact_id
    WHERE c.global_contact_id IS NOT NULL
  `);
  violations.push(...groupMismatches(
    supGroups.rows,
    (r) => r.global_contact_id,
    (rows, gcid) => ({
      kind: "supplier_cross_store_mismatch" as const,
      globalContactId: gcid,
      suppliers: rows.map((r) => ({ storeId: r.store_id, supplierId: r.supplier_id, balance: r.balance })),
    }),
  ));

  // 4) Legacy customer rows with NO linked contact must still agree across stores
  //    (userId-keyed sync path).
  const legacyCust = await pool.query<{ user_id: number; store_id: number; balance: string }>(`
    SELECT cp.user_id, cp.store_id, cp.current_balance AS balance
    FROM customer_profiles cp
    WHERE cp.contact_id IS NULL
  `);
  violations.push(...groupMismatches(
    legacyCust.rows,
    (r) => String(r.user_id),
    (rows) => ({
      kind: "legacy_customer_mismatch" as const,
      userId: rows[0].user_id,
      profiles: rows.map((r) => ({ storeId: r.store_id, balance: r.balance })),
    }),
  ));

  // 5) Legacy supplier rows with NO linked contact must still agree across stores
  //    (globalSupplierId-keyed sync path).
  const legacySup = await pool.query<{ global_supplier_id: string; store_id: number; supplier_id: number; balance: string }>(`
    SELECT s.global_supplier_id, s.store_id, s.id AS supplier_id, s.current_balance AS balance
    FROM suppliers s
    WHERE s.contact_id IS NULL AND s.global_supplier_id IS NOT NULL
  `);
  violations.push(...groupMismatches(
    legacySup.rows,
    (r) => r.global_supplier_id,
    (rows, gsid) => ({
      kind: "legacy_supplier_mismatch" as const,
      globalSupplierId: gsid,
      suppliers: rows.map((r) => ({ storeId: r.store_id, supplierId: r.supplier_id, balance: r.balance })),
    }),
  ));

  return violations;
}

function groupMismatches<Row extends { balance: string }, V>(
  rows: Row[],
  keyOf: (r: Row) => string,
  toViolation: (rows: Row[], key: string) => V,
): V[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key);
    if (list) list.push(row); else groups.set(key, [row]);
  }
  const out: V[] = [];
  for (const [key, groupRows] of groups) {
    if (groupRows.length < 2) continue;
    const distinct = new Set(groupRows.map((r) => Number(r.balance).toFixed(2)));
    if (distinct.size > 1) out.push(toViolation(groupRows, key));
  }
  return out;
}

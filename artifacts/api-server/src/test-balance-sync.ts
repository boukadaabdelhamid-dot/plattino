// Standalone integration test for the unified cross-store contact balance sync
// (structural fix). Exercises balance-sync.ts against the real dev database using
// disposable scratch stores/contacts/roles, then cleans up. No test framework is
// used anywhere else in this monorepo, so this follows the existing standalone
// `tsx`-runnable script convention (see unify-customer-balances.ts).
//
// Run with:
//   npx tsx src/test-balance-sync.ts
import { randomUUID } from "node:crypto";
import { db, pool, schema } from "./lib/db";
import { and, eq } from "drizzle-orm";
import {
  linkContactsGlobally,
  mutateCustomerBalance,
  mutateSupplierBalance,
  recomputeContactBalance,
} from "./lib/balance-sync";
import { checkBalanceConsistency, type BalanceViolation } from "./lib/balance-consistency-check";

const RUN_TAG = `test-balsync-${Date.now()}`;
let failures = 0;
const scratchStoreIds: number[] = [];
const scratchUserIds: number[] = [];

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const a = typeof actual === "number" ? actual.toFixed(2) : actual;
  const e = typeof expected === "number" ? expected.toFixed(2) : expected;
  if (a !== e) {
    failures++;
    console.error(`  FAIL ${label}: expected ${e}, got ${a}`);
  } else {
    console.log(`  ok   ${label} = ${a}`);
  }
}

function assertNoScratchViolations(label: string, violations: BalanceViolation[], scratchContactIds: Set<number>): void {
  const relevant = violations.filter((v) => {
    if (v.kind === "contact_unified_mismatch") return scratchContactIds.has(v.contactId);
    return true; // group-keyed kinds are cross-checked by gcid string below, filtered by caller when needed
  });
  if (relevant.length > 0) {
    failures++;
    console.error(`  FAIL ${label}: consistency violations found:`, JSON.stringify(relevant, null, 2));
  } else {
    console.log(`  ok   ${label}: no consistency violations`);
  }
}

async function makeStore(suffix: string): Promise<number> {
  const [store] = await db.insert(schema.storesTable).values({
    nameAr: `${RUN_TAG}-${suffix}`,
    nameEn: `${RUN_TAG}-${suffix}`,
    slug: `${RUN_TAG}-${suffix}`,
  }).returning({ id: schema.storesTable.id });
  scratchStoreIds.push(store.id);
  return store.id;
}

async function makeCustomerUser(suffix: string): Promise<number> {
  const [user] = await db.insert(schema.usersTable).values({
    name: `${RUN_TAG}-${suffix}`,
    email: `${RUN_TAG}-${suffix}@example.test`,
    passwordHash: "x",
    role: "customer",
  }).returning({ id: schema.usersTable.id });
  scratchUserIds.push(user.id);
  return user.id;
}

async function makeContact(storeId: number, name: string, contactType: "customer" | "supplier" | "customer_supplier"): Promise<number> {
  const [c] = await db.insert(schema.contactsTable).values({ storeId, name, contactType }).returning({ id: schema.contactsTable.id });
  return c.id;
}

async function makeCustomerProfile(userId: number, storeId: number, contactId: number, contactType: "customer" | "customer_supplier"): Promise<void> {
  await db.insert(schema.customerProfilesTable).values({ userId, storeId, contactId, contactType, currentBalance: "0" });
}

async function makeSupplier(storeId: number, name: string, contactId: number, contactType: "supplier" | "customer_supplier"): Promise<number> {
  const [s] = await db.insert(schema.suppliersTable).values({ storeId, name, contactId, contactType, currentBalance: "0" }).returning({ id: schema.suppliersTable.id });
  return s.id;
}

async function getContactBalance(contactId: number): Promise<number> {
  const [c] = await db.select({ b: schema.contactsTable.currentBalance }).from(schema.contactsTable).where(eq(schema.contactsTable.id, contactId));
  return Number(c?.b ?? 0);
}

async function scenarioCustomerOnlyCrossStore(): Promise<void> {
  console.log("\n[1] Customer-only cross-store linking");
  const storeA = await makeStore("cust-a");
  const storeB = await makeStore("cust-b");
  const userId = await makeCustomerUser("cust");
  const contactA = await makeContact(storeA, "Cust Only", "customer");
  const contactB = await makeContact(storeB, "Cust Only", "customer");
  await makeCustomerProfile(userId, storeA, contactA, "customer");
  await makeCustomerProfile(userId, storeB, contactB, "customer");

  await db.transaction(async (tx) => {
    await linkContactsGlobally(tx, contactA, contactB);
  });
  await db.transaction(async (tx) => {
    await mutateCustomerBalance(tx, userId, storeA, { delta: 100 });
  });

  const [profB] = await db.select({ b: schema.customerProfilesTable.currentBalance })
    .from(schema.customerProfilesTable)
    .where(eq(schema.customerProfilesTable.contactId, contactB));
  assertEqual("store B customer profile adopts store A's delta", Number(profB?.b ?? 0), 100);
  assertEqual("contact A unified balance", await getContactBalance(contactA), 100);
  assertEqual("contact B unified balance", await getContactBalance(contactB), 100);
}

async function scenarioSupplierOnlyCrossStore(): Promise<void> {
  console.log("\n[2] Supplier-only cross-store linking");
  const storeA = await makeStore("sup-a");
  const storeB = await makeStore("sup-b");
  const contactA = await makeContact(storeA, "Sup Only", "supplier");
  const contactB = await makeContact(storeB, "Sup Only", "supplier");
  const supplierA = await makeSupplier(storeA, "Sup Only", contactA, "supplier");
  const supplierB = await makeSupplier(storeB, "Sup Only", contactB, "supplier");

  await db.transaction(async (tx) => {
    await linkContactsGlobally(tx, contactA, contactB);
  });
  await db.transaction(async (tx) => {
    await mutateSupplierBalance(tx, supplierA, { delta: -50 });
  });

  const [supB] = await db.select({ b: schema.suppliersTable.currentBalance })
    .from(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierB));
  assertEqual("store B supplier adopts store A's delta", Number(supB?.b ?? 0), -50);
  assertEqual("contact A unified balance", await getContactBalance(contactA), -50);
  assertEqual("contact B unified balance", await getContactBalance(contactB), -50);
}

async function scenarioDualRoleCrossStore(): Promise<{ contactA: number; contactB: number }> {
  console.log("\n[3] Dual-role (customer_supplier) linked cross-store — the reported bug scenario");
  const storeA = await makeStore("dual-a");
  const storeB = await makeStore("dual-b");
  const userId = await makeCustomerUser("dual");
  const contactA = await makeContact(storeA, "Dual Role", "customer_supplier");
  const contactB = await makeContact(storeB, "Dual Role", "customer_supplier");
  await makeCustomerProfile(userId, storeA, contactA, "customer_supplier");
  await makeCustomerProfile(userId, storeB, contactB, "customer_supplier");
  const supplierA = await makeSupplier(storeA, "Dual Role", contactA, "customer_supplier");
  const supplierB = await makeSupplier(storeB, "Dual Role", contactB, "customer_supplier");

  await db.transaction(async (tx) => {
    await linkContactsGlobally(tx, contactA, contactB);
  });

  // Customer-side sale on credit in store A.
  await db.transaction(async (tx) => {
    await mutateCustomerBalance(tx, userId, storeA, { delta: 100 });
  });
  assertEqual("after store-A customer delta: contact A", await getContactBalance(contactA), 100);
  assertEqual("after store-A customer delta: contact B (cross-store, cross-role sync)", await getContactBalance(contactB), 100);

  // Supplier-side purchase in store B (a different store AND a different role from
  // the mutation above) — this is exactly the case the old two-independent-keys
  // design could never keep in sync.
  await db.transaction(async (tx) => {
    await mutateSupplierBalance(tx, supplierB, { delta: -30 });
  });
  assertEqual("after store-B supplier delta: contact B", await getContactBalance(contactB), 70);
  assertEqual("after store-B supplier delta: contact A (cross-store, cross-role sync)", await getContactBalance(contactA), 70);

  const [supA] = await db.select({ b: schema.suppliersTable.currentBalance }).from(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierA));
  assertEqual("store A supplier row mirrored the store-B supplier delta", Number(supA?.b ?? 0), -30);

  return { contactA, contactB };
}

async function scenarioLinkContactsGloballyMerge(): Promise<void> {
  console.log("\n[4] linkContactsGlobally merge-safety (both sides already in different groups)");
  // Each of the 4 contacts must live in its OWN store: the (storeId, globalContactId)
  // unique index means a single store can only ever hold one contact per identity —
  // merging two groups into one gcid would otherwise collide if two of the four
  // pre-existing contacts happened to share a store (that would mean the same
  // store already has two separate rows for the same person, a pre-existing data
  // problem the constraint correctly refuses to paper over).
  const storeA = await makeStore("merge-a");
  const storeB = await makeStore("merge-b");
  const storeC = await makeStore("merge-c");
  const storeD = await makeStore("merge-d");
  const c1 = await makeContact(storeA, "Merge 1", "supplier");
  const c2 = await makeContact(storeB, "Merge 1", "supplier");
  const c3 = await makeContact(storeC, "Merge 2", "supplier");
  const c4 = await makeContact(storeD, "Merge 2", "supplier"); // separate store for group 2's 2nd member

  await db.transaction(async (tx) => {
    await linkContactsGlobally(tx, c1, c2); // group 1: {c1, c2}
    await linkContactsGlobally(tx, c3, c4); // group 2: {c3, c4}
    await linkContactsGlobally(tx, c1, c3); // merge group 2 onto group 1
  });

  const rows = await db.select({ id: schema.contactsTable.id, gcid: schema.contactsTable.globalContactId })
    .from(schema.contactsTable).where(eq(schema.contactsTable.storeId, storeA));
  const allRows = await Promise.all([c1, c2, c3, c4].map(async (id) => {
    const [r] = await db.select({ gcid: schema.contactsTable.globalContactId }).from(schema.contactsTable).where(eq(schema.contactsTable.id, id));
    return r?.gcid ?? null;
  }));
  const distinct = new Set(allRows);
  if (distinct.size === 1 && allRows[0] != null) {
    console.log(`  ok   all 4 contacts merged onto one globalContactId`);
  } else {
    failures++;
    console.error(`  FAIL merge did not converge on one id:`, allRows);
  }
  void rows;
}

async function scenarioRecomputeIdempotent(contactA: number, contactB: number): Promise<void> {
  console.log("\n[5] recomputeContactBalance + syncLinkedContactBalances re-run is a no-op (idempotency)");
  const before = [await getContactBalance(contactA), await getContactBalance(contactB)];
  await db.transaction(async (tx) => {
    await recomputeContactBalance(tx, contactA);
    await recomputeContactBalance(tx, contactB);
  });
  const after = [await getContactBalance(contactA), await getContactBalance(contactB)];
  assertEqual("contact A unchanged after re-recompute", after[0], before[0]);
  assertEqual("contact B unchanged after re-recompute", after[1], before[1]);
}

async function scenarioConcurrentDualRoleNoGcid(): Promise<number> {
  console.log("\n[7] Concurrent customer+supplier mutations on a same-store dual-role contact with NO globalContactId (lost-update guard)");
  // This contact is NOT cross-store linked (no globalContactId) — before the
  // identity-lock fix, mutateCustomerBalance and mutateSupplierBalance had no
  // shared lock key in this case (`cust:${userId}` vs `sup:${supplierId}`), so
  // concurrent customer-side and supplier-side mutations on the SAME contact's
  // two roles could interleave their read-then-write recomputeContactBalance
  // calls and drop one side's delta. The fix locks both on `contact:${contactId}`.
  const storeA = await makeStore("race");
  const userId = await makeCustomerUser("race");
  const contactId = await makeContact(storeA, "Race Dual", "customer_supplier");
  await makeCustomerProfile(userId, storeA, contactId, "customer_supplier");
  const supplierId = await makeSupplier(storeA, "Race Dual", contactId, "customer_supplier");

  // Fire a batch of interleaved customer-side and supplier-side deltas concurrently.
  const customerDeltas = [40, 15, 25, 10, 5]; // sum 95
  const supplierDeltas = [-8, -12, -3, -7, -5]; // sum -35
  await Promise.all([
    ...customerDeltas.map((d) => db.transaction((tx) => mutateCustomerBalance(tx, userId, storeA, { delta: d }))),
    ...supplierDeltas.map((d) => db.transaction((tx) => mutateSupplierBalance(tx, supplierId, { delta: d }))),
  ]);

  const expected = customerDeltas.reduce((a, b) => a + b, 0) + supplierDeltas.reduce((a, b) => a + b, 0);
  assertEqual("contact balance reflects every concurrent delta (no lost update)", await getContactBalance(contactId), expected);
  const [cp] = await db.select({ b: schema.customerProfilesTable.currentBalance }).from(schema.customerProfilesTable).where(eq(schema.customerProfilesTable.contactId, contactId));
  const [sup] = await db.select({ b: schema.suppliersTable.currentBalance }).from(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierId));
  assertEqual("customer-side role balance", Number(cp?.b ?? 0), customerDeltas.reduce((a, b) => a + b, 0));
  assertEqual("supplier-side role balance", Number(sup?.b ?? 0), supplierDeltas.reduce((a, b) => a + b, 0));
  return contactId;
}

async function scenarioConcurrentLegacyCrossStoreNoGcid(): Promise<void> {
  console.log("\n[8] Concurrent cross-store legacy (no contact link) customer + supplier fan-out races");
  // Pure legacy rows (contactId left null) linked ONLY by userId / globalSupplierId,
  // pre-dating the unified contact identity. Before the fix, mutateCustomerBalance
  // locked `cust:userId` and mutateSupplierBalance locked `globalSupplierId`
  // correctly in isolation, but the earlier (broken) version of this fix
  // prioritized a `contact:contactId` key that doesn't even apply here — this
  // scenario pins down that the userId/globalSupplierId group key is still what
  // actually gets locked, so two concurrent deltas on DIFFERENT stores converge
  // to the same unified value in both, instead of diverging.
  const storeA = await makeStore("legacy-a");
  const storeB = await makeStore("legacy-b");
  const userId = await makeCustomerUser("legacy");
  await db.insert(schema.customerProfilesTable).values({ userId, storeId: storeA, currentBalance: "0" });
  await db.insert(schema.customerProfilesTable).values({ userId, storeId: storeB, currentBalance: "0" });

  await Promise.all([
    db.transaction((tx) => mutateCustomerBalance(tx, userId, storeA, { delta: 100 })),
    db.transaction((tx) => mutateCustomerBalance(tx, userId, storeB, { delta: 50 })),
  ]);

  const [profA] = await db.select({ b: schema.customerProfilesTable.currentBalance }).from(schema.customerProfilesTable)
    .where(and(eq(schema.customerProfilesTable.userId, userId), eq(schema.customerProfilesTable.storeId, storeA)));
  const [profB] = await db.select({ b: schema.customerProfilesTable.currentBalance }).from(schema.customerProfilesTable)
    .where(and(eq(schema.customerProfilesTable.userId, userId), eq(schema.customerProfilesTable.storeId, storeB)));
  assertEqual("legacy customer store A converges to unified sum", Number(profA?.b ?? 0), 150);
  assertEqual("legacy customer store B converges to unified sum", Number(profB?.b ?? 0), 150);

  const storeC = await makeStore("legacy-sup-a");
  const storeD = await makeStore("legacy-sup-b");
  const gsid = randomUUID();
  const supplierC = await (async () => {
    const [s] = await db.insert(schema.suppliersTable).values({ storeId: storeC, name: "Legacy Sup", globalSupplierId: gsid, currentBalance: "0" }).returning({ id: schema.suppliersTable.id });
    return s.id;
  })();
  const supplierD = await (async () => {
    const [s] = await db.insert(schema.suppliersTable).values({ storeId: storeD, name: "Legacy Sup", globalSupplierId: gsid, currentBalance: "0" }).returning({ id: schema.suppliersTable.id });
    return s.id;
  })();

  await Promise.all([
    db.transaction((tx) => mutateSupplierBalance(tx, supplierC, { delta: -20 })),
    db.transaction((tx) => mutateSupplierBalance(tx, supplierD, { delta: -30 })),
  ]);

  const [supC] = await db.select({ b: schema.suppliersTable.currentBalance }).from(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierC));
  const [supD] = await db.select({ b: schema.suppliersTable.currentBalance }).from(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierD));
  assertEqual("legacy supplier store C converges to unified sum", Number(supC?.b ?? 0), -50);
  assertEqual("legacy supplier store D converges to unified sum", Number(supD?.b ?? 0), -50);
}

async function runConsistencyGuardrail(scratchContactIds: number[]): Promise<void> {
  console.log("\n[6] Consistency guardrail over all scratch contacts");
  const violations = await checkBalanceConsistency(pool);
  assertNoScratchViolations("checkBalanceConsistency", violations, new Set(scratchContactIds));
}

async function cleanup(): Promise<void> {
  console.log("\nCleaning up scratch data...");
  for (const storeId of scratchStoreIds) {
    await db.delete(schema.customerOperationsTable).where(eq(schema.customerOperationsTable.storeId, storeId));
    await db.delete(schema.supplierOperationsTable).where(eq(schema.supplierOperationsTable.storeId, storeId));
    await db.delete(schema.suppliersTable).where(eq(schema.suppliersTable.storeId, storeId));
    await db.delete(schema.customerProfilesTable).where(eq(schema.customerProfilesTable.storeId, storeId));
    await db.delete(schema.contactsTable).where(eq(schema.contactsTable.storeId, storeId));
    await db.delete(schema.storesTable).where(eq(schema.storesTable.id, storeId));
  }
  for (const userId of scratchUserIds) {
    await db.delete(schema.usersTable).where(eq(schema.usersTable.id, userId));
  }
  console.log(`Deleted ${scratchStoreIds.length} scratch store(s), ${scratchUserIds.length} scratch user(s).`);
}

async function main(): Promise<void> {
  const scratchContactIds: number[] = [];
  try {
    await scenarioCustomerOnlyCrossStore();
    await scenarioSupplierOnlyCrossStore();
    const { contactA, contactB } = await scenarioDualRoleCrossStore();
    scratchContactIds.push(contactA, contactB);
    await scenarioLinkContactsGloballyMerge();
    await scenarioRecomputeIdempotent(contactA, contactB);
    const raceContactId = await scenarioConcurrentDualRoleNoGcid();
    scratchContactIds.push(raceContactId);
    await scenarioConcurrentLegacyCrossStoreNoGcid();
    await runConsistencyGuardrail(scratchContactIds);
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${failures === 0 ? "ALL SCENARIOS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("Test script crashed:", err);
  try { await cleanup(); await pool.end(); } catch { /* best-effort */ }
  process.exit(1);
});

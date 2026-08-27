// Standalone integration test for the unified Dashboard créances/dettes
// balances (getUnifiedDashboardBalances in routes/erp.ts). Exercises it
// against the real dev database using disposable scratch stores/contacts/
// roles, then cleans up. Follows the existing standalone `tsx`-runnable
// script convention used by test-balance-sync.ts (no test framework is used
// anywhere else in this monorepo).
//
// Guards against the exact regressions the Dashboard totals are prone to:
//   - a contact registered as BOTH customer and supplier (customer_supplier)
//     must be counted exactly once, at its NET balance — not once per role.
//   - a positive/negative balance must land in the correct section
//     (créances = receivable = balance > 0, dettes = payable = balance < 0).
//   - a zero balance must be excluded from both sections.
//   - the storeId filter must be respected (and "all stores" must include
//     every store).
//
// Run with:
//   npx tsx src/test-dashboard-balances.ts
import { db, pool, schema } from "./lib/db";
import { eq } from "drizzle-orm";
import { getUnifiedDashboardBalances, type DashboardBalanceDirection } from "./routes/erp";
import { mutateCustomerBalance, mutateSupplierBalance } from "./lib/balance-sync";

const RUN_TAG = `test-dashbal-${Date.now()}`;
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

function assertTrue(label: string, condition: boolean, detail?: unknown): void {
  if (!condition) {
    failures++;
    console.error(`  FAIL ${label}`, detail !== undefined ? JSON.stringify(detail, null, 2) : "");
  } else {
    console.log(`  ok   ${label}`);
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

async function makeCustomerProfile(userId: number, storeId: number, contactId: number | null, contactType: "customer" | "customer_supplier"): Promise<void> {
  await db.insert(schema.customerProfilesTable).values({ userId, storeId, contactId, contactType, currentBalance: "0" });
}

async function makeSupplier(storeId: number, name: string, contactId: number | null, contactType: "supplier" | "customer_supplier"): Promise<number> {
  const [s] = await db.insert(schema.suppliersTable).values({ storeId, name, contactId, contactType, currentBalance: "0" }).returning({ id: schema.suppliersTable.id });
  return s.id;
}

// Looks up a scratch name in either the receivable or payable dashboard list
// for the given store filter.
async function findRow(storeId: number | null, direction: DashboardBalanceDirection, name: string) {
  const result = await getUnifiedDashboardBalances(storeId, direction);
  return (result.rows as Array<{ id: string; name: string; party_type: string; balance: string }>).filter((r) => r.name === name);
}

async function scenarioCustomerPositiveBalance(): Promise<void> {
  console.log("\n[1] Customer-only contact with a POSITIVE balance → appears once in créances, absent from dettes");
  // NOTE: the customer-only branch of getUnifiedDashboardBalances surfaces the
  // linked users.name (not contacts.name) as the display name — so the test
  // user and contact are given the SAME name here to make identity lookups by
  // name reflect the real query output faithfully in either direction.
  const storeId = await makeStore("cust-pos");
  const userId = await makeCustomerUser("CustPos");
  const contactId = await makeContact(storeId, `${RUN_TAG}-CustPos`, "customer");
  await makeCustomerProfile(userId, storeId, contactId, "customer");
  await db.transaction((tx) => mutateCustomerBalance(tx, userId, storeId, { delta: 250 }));

  const receivable = await findRow(storeId, "receivable", `${RUN_TAG}-CustPos`);
  const payable = await findRow(storeId, "payable", `${RUN_TAG}-CustPos`);
  assertTrue("appears exactly once in créances", receivable.length === 1, receivable);
  assertEqual("créance amount", receivable[0]?.balance, "250.00");
  assertTrue("absent from dettes", payable.length === 0, payable);
}

async function scenarioCustomerNegativeBalance(): Promise<void> {
  console.log("\n[2] Customer-only contact with a NEGATIVE balance (avance/overpayment) → appears once in dettes, absent from créances");
  const storeId = await makeStore("cust-neg");
  const userId = await makeCustomerUser("CustNeg");
  const contactId = await makeContact(storeId, `${RUN_TAG}-CustNeg`, "customer");
  await makeCustomerProfile(userId, storeId, contactId, "customer");
  await db.transaction((tx) => mutateCustomerBalance(tx, userId, storeId, { delta: -80 }));

  const receivable = await findRow(storeId, "receivable", `${RUN_TAG}-CustNeg`);
  const payable = await findRow(storeId, "payable", `${RUN_TAG}-CustNeg`);
  assertTrue("absent from créances", receivable.length === 0, receivable);
  assertTrue("appears exactly once in dettes", payable.length === 1, payable);
  assertEqual("dette amount", payable[0]?.balance, "-80.00");
}

async function scenarioSupplierNegativeBalance(): Promise<void> {
  console.log("\n[3] Supplier-only contact with a NEGATIVE balance (store owes supplier) → appears once in dettes, absent from créances");
  const storeId = await makeStore("sup-neg");
  const contactId = await makeContact(storeId, `${RUN_TAG}-SupNeg`, "supplier");
  const supplierId = await makeSupplier(storeId, `${RUN_TAG}-SupNeg`, contactId, "supplier");
  await db.transaction((tx) => mutateSupplierBalance(tx, supplierId, { delta: -420 }));

  const receivable = await findRow(storeId, "receivable", `${RUN_TAG}-SupNeg`);
  const payable = await findRow(storeId, "payable", `${RUN_TAG}-SupNeg`);
  assertTrue("absent from créances", receivable.length === 0, receivable);
  assertTrue("appears exactly once in dettes", payable.length === 1, payable);
  assertEqual("dette amount", payable[0]?.balance, "-420.00");
}

async function scenarioSupplierPositiveBalance(): Promise<void> {
  console.log("\n[4] Supplier-only contact with a POSITIVE balance (supplier owes store) → appears once in créances, absent from dettes");
  const storeId = await makeStore("sup-pos");
  const contactId = await makeContact(storeId, `${RUN_TAG}-SupPos`, "supplier");
  const supplierId = await makeSupplier(storeId, `${RUN_TAG}-SupPos`, contactId, "supplier");
  await db.transaction((tx) => mutateSupplierBalance(tx, supplierId, { delta: 60 }));

  const receivable = await findRow(storeId, "receivable", `${RUN_TAG}-SupPos`);
  const payable = await findRow(storeId, "payable", `${RUN_TAG}-SupPos`);
  assertTrue("appears exactly once in créances", receivable.length === 1, receivable);
  assertEqual("créance amount", receivable[0]?.balance, "60.00");
  assertTrue("absent from dettes", payable.length === 0, payable);
}

async function scenarioDualRoleCountedOnceNetPositive(): Promise<void> {
  console.log("\n[5] customer_supplier contact (registered as BOTH customer and supplier) with a net POSITIVE balance → counted ONCE at its net value, not once per role");
  const storeId = await makeStore("dual-net-pos");
  const userId = await makeCustomerUser("dual-net-pos");
  const contactId = await makeContact(storeId, `${RUN_TAG}-DualNetPos`, "customer_supplier");
  await makeCustomerProfile(userId, storeId, contactId, "customer_supplier");
  const supplierId = await makeSupplier(storeId, `${RUN_TAG}-DualNetPos`, contactId, "customer_supplier");

  // Customer side owes 300 (receivable-leaning), supplier side owes 120 back
  // to the contact (payable-leaning) — net should be +180, one single row.
  await db.transaction((tx) => mutateCustomerBalance(tx, userId, storeId, { delta: 300 }));
  await db.transaction((tx) => mutateSupplierBalance(tx, supplierId, { delta: -120 }));

  const receivableAll = await getUnifiedDashboardBalances(storeId, "receivable");
  const payableAll = await getUnifiedDashboardBalances(storeId, "payable");
  const matchesReceivable = (receivableAll.rows as Array<{ name: string }>).filter((r) => r.name === `${RUN_TAG}-DualNetPos`);
  const matchesPayable = (payableAll.rows as Array<{ name: string }>).filter((r) => r.name === `${RUN_TAG}-DualNetPos`);
  assertTrue("appears exactly once across both lists combined", matchesReceivable.length + matchesPayable.length === 1, { matchesReceivable, matchesPayable });
  assertTrue("lands in créances (net positive), not dettes", matchesReceivable.length === 1 && matchesPayable.length === 0);
  assertEqual("net créance amount is 300 - 120 = 180 (not 300, not 420)", (matchesReceivable[0] as any)?.balance, "180.00");
}

async function scenarioDualRoleCountedOnceNetNegative(): Promise<void> {
  console.log("\n[6] customer_supplier contact with a net NEGATIVE balance → counted ONCE at its net value, in dettes not créances");
  const storeId = await makeStore("dual-net-neg");
  const userId = await makeCustomerUser("dual-net-neg");
  const contactId = await makeContact(storeId, `${RUN_TAG}-DualNetNeg`, "customer_supplier");
  await makeCustomerProfile(userId, storeId, contactId, "customer_supplier");
  const supplierId = await makeSupplier(storeId, `${RUN_TAG}-DualNetNeg`, contactId, "customer_supplier");

  // Customer side owes only 50, supplier side is owed 200 back (store owes
  // the contact) — net should be -150, one single row, in dettes.
  await db.transaction((tx) => mutateCustomerBalance(tx, userId, storeId, { delta: 50 }));
  await db.transaction((tx) => mutateSupplierBalance(tx, supplierId, { delta: -200 }));

  const receivableAll = await getUnifiedDashboardBalances(storeId, "receivable");
  const payableAll = await getUnifiedDashboardBalances(storeId, "payable");
  const matchesReceivable = (receivableAll.rows as Array<{ name: string }>).filter((r) => r.name === `${RUN_TAG}-DualNetNeg`);
  const matchesPayable = (payableAll.rows as Array<{ name: string; balance: string }>).filter((r) => r.name === `${RUN_TAG}-DualNetNeg`);
  assertTrue("appears exactly once across both lists combined", matchesReceivable.length + matchesPayable.length === 1, { matchesReceivable, matchesPayable });
  assertTrue("lands in dettes (net negative), not créances", matchesPayable.length === 1 && matchesReceivable.length === 0);
  assertEqual("net dette amount is 50 - 200 = -150 (not -200, not -250)", matchesPayable[0]?.balance, "-150.00");
}

async function scenarioDualRoleZeroNetExcluded(): Promise<void> {
  console.log("\n[7] customer_supplier contact whose net balance is exactly ZERO → excluded from both créances and dettes");
  const storeId = await makeStore("dual-net-zero");
  const userId = await makeCustomerUser("dual-net-zero");
  const contactId = await makeContact(storeId, `${RUN_TAG}-DualNetZero`, "customer_supplier");
  await makeCustomerProfile(userId, storeId, contactId, "customer_supplier");
  const supplierId = await makeSupplier(storeId, `${RUN_TAG}-DualNetZero`, contactId, "customer_supplier");

  await db.transaction((tx) => mutateCustomerBalance(tx, userId, storeId, { delta: 90 }));
  await db.transaction((tx) => mutateSupplierBalance(tx, supplierId, { delta: -90 }));

  const receivable = await findRow(storeId, "receivable", `${RUN_TAG}-DualNetZero`);
  const payable = await findRow(storeId, "payable", `${RUN_TAG}-DualNetZero`);
  assertTrue("absent from créances", receivable.length === 0, receivable);
  assertTrue("absent from dettes", payable.length === 0, payable);
}

async function scenarioZeroBalanceExcludedPlainRoles(): Promise<void> {
  console.log("\n[8] Plain customer and plain supplier at exactly ZERO balance → excluded from both lists");
  const storeId = await makeStore("zero-plain");
  const userId = await makeCustomerUser("ZeroCust");
  const custContactId = await makeContact(storeId, `${RUN_TAG}-ZeroCust`, "customer");
  await makeCustomerProfile(userId, storeId, custContactId, "customer");
  const supContactId = await makeContact(storeId, `${RUN_TAG}-ZeroSup`, "supplier");
  await makeSupplier(storeId, `${RUN_TAG}-ZeroSup`, supContactId, "supplier");
  // Balances default to "0" — no mutation performed.

  const custReceivable = await findRow(storeId, "receivable", `${RUN_TAG}-ZeroCust`);
  const custPayable = await findRow(storeId, "payable", `${RUN_TAG}-ZeroCust`);
  const supReceivable = await findRow(storeId, "receivable", `${RUN_TAG}-ZeroSup`);
  const supPayable = await findRow(storeId, "payable", `${RUN_TAG}-ZeroSup`);
  assertTrue("zero-balance customer excluded from créances", custReceivable.length === 0, custReceivable);
  assertTrue("zero-balance customer excluded from dettes", custPayable.length === 0, custPayable);
  assertTrue("zero-balance supplier excluded from créances", supReceivable.length === 0, supReceivable);
  assertTrue("zero-balance supplier excluded from dettes", supPayable.length === 0, supPayable);
}

async function scenarioStoreFilterRespected(): Promise<void> {
  console.log("\n[9] storeId filter is respected — a store's créance is invisible to another store, but visible under \"all stores\"");
  const storeA = await makeStore("filter-a");
  const storeB = await makeStore("filter-b");
  const userId = await makeCustomerUser("FilterCust");
  const contactId = await makeContact(storeA, `${RUN_TAG}-FilterCust`, "customer");
  await makeCustomerProfile(userId, storeA, contactId, "customer");
  await db.transaction((tx) => mutateCustomerBalance(tx, userId, storeA, { delta: 500 }));

  const inOwnStore = await findRow(storeA, "receivable", `${RUN_TAG}-FilterCust`);
  const inOtherStore = await findRow(storeB, "receivable", `${RUN_TAG}-FilterCust`);
  const inAllStores = await findRow(null, "receivable", `${RUN_TAG}-FilterCust`);
  assertTrue("visible when filtering by its own store", inOwnStore.length === 1, inOwnStore);
  assertTrue("invisible when filtering by a different store", inOtherStore.length === 0, inOtherStore);
  assertTrue("visible under \"all stores\" (storeId = null)", inAllStores.length === 1, inAllStores);
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
  try {
    await scenarioCustomerPositiveBalance();
    await scenarioCustomerNegativeBalance();
    await scenarioSupplierNegativeBalance();
    await scenarioSupplierPositiveBalance();
    await scenarioDualRoleCountedOnceNetPositive();
    await scenarioDualRoleCountedOnceNetNegative();
    await scenarioDualRoleZeroNetExcluded();
    await scenarioZeroBalanceExcludedPlainRoles();
    await scenarioStoreFilterRespected();
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

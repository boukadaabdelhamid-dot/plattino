// Standalone API integration test for importing a supplier that is also a
// customer into another store. It starts the Express app on an ephemeral local
// port, uses disposable database rows, and cleans everything up afterwards.
//
// Run with:
//   npx tsx src/test-supplier-import.ts
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import app from "./app";
import { db, pool, schema } from "./lib/db";
import { signToken } from "./lib/auth";
import { mutateSupplierBalance, recomputeContactBalance } from "./lib/balance-sync";

const RUN_TAG = `test-supplier-import-${Date.now()}-${randomUUID().slice(0, 8)}`;
const storeIds: number[] = [];
const userIds: number[] = [];
let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const normalizedActual = typeof actual === "number" ? actual.toFixed(2) : actual;
  const normalizedExpected = typeof expected === "number" ? expected.toFixed(2) : expected;
  if (normalizedActual !== normalizedExpected) {
    failures++;
    console.error(`  FAIL ${label}: expected ${normalizedExpected}, got ${normalizedActual}`);
  } else {
    console.log(`  ok   ${label} = ${normalizedActual}`);
  }
}

function assertTrue(label: string, condition: boolean, detail?: unknown): void {
  if (!condition) {
    failures++;
    console.error(`  FAIL ${label}`, detail ?? "");
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
  storeIds.push(store.id);
  return store.id;
}

async function makeUser(
  suffix: string,
  role: "admin" | "customer",
  email?: string,
): Promise<number> {
  const [user] = await db.insert(schema.usersTable).values({
    name: `${RUN_TAG}-${suffix}`,
    email: email ?? `${RUN_TAG}-${suffix}@example.test`,
    passwordHash: "test-only",
    role,
  }).returning({ id: schema.usersTable.id });
  userIds.push(user.id);
  return user.id;
}

async function requestJson(
  baseUrl: string,
  path: string,
  token: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function verifyImportedDualRole(
  storeId: number,
  expectedCustomerBalance: number,
  expectedSupplierBalance: number,
): Promise<number> {
  const [supplier] = await db.select().from(schema.suppliersTable)
    .where(and(
      eq(schema.suppliersTable.storeId, storeId),
      eq(schema.suppliersTable.name, `${RUN_TAG}-dual`),
    )).limit(1);
  assertTrue("target supplier exists", Boolean(supplier), { storeId });
  if (!supplier) return 0;

  assertEqual("target supplier type", supplier.contactType, "customer_supplier");
  assertEqual("target supplier raw balance", Number(supplier.currentBalance), expectedSupplierBalance);
  assertTrue("target supplier has a contact", supplier.contactId != null);

  const [contact] = supplier.contactId == null
    ? []
    : await db.select().from(schema.contactsTable)
      .where(eq(schema.contactsTable.id, supplier.contactId)).limit(1);
  assertEqual("target contact type", contact?.contactType, "customer_supplier");
  assertEqual(
    "target contact unified balance",
    Number(contact?.currentBalance ?? 0),
    expectedCustomerBalance + expectedSupplierBalance,
  );

  const [customer] = supplier.contactId == null
    ? []
    : await db.select().from(schema.customerProfilesTable)
      .where(and(
        eq(schema.customerProfilesTable.storeId, storeId),
        eq(schema.customerProfilesTable.contactId, supplier.contactId),
      )).limit(1);
  assertTrue("target customer role exists", Boolean(customer));
  assertEqual("target customer type", customer?.contactType, "customer_supplier");
  assertEqual("target customer raw balance", Number(customer?.currentBalance ?? 0), expectedCustomerBalance);
  return supplier.id;
}

async function cleanup(): Promise<void> {
  console.log("\nCleaning up scratch data...");
  if (storeIds.length > 0) {
    await db.delete(schema.customerOperationsTable)
      .where(inArray(schema.customerOperationsTable.storeId, storeIds));
    await db.delete(schema.supplierOperationsTable)
      .where(inArray(schema.supplierOperationsTable.storeId, storeIds));
    await db.delete(schema.customerProfilesTable)
      .where(inArray(schema.customerProfilesTable.storeId, storeIds));
    await db.delete(schema.suppliersTable)
      .where(inArray(schema.suppliersTable.storeId, storeIds));
    await db.delete(schema.contactsTable)
      .where(inArray(schema.contactsTable.storeId, storeIds));
  }
  if (userIds.length > 0) {
    await db.delete(schema.userStoresTable)
      .where(inArray(schema.userStoresTable.userId, userIds));
  }
  if (storeIds.length > 0) {
    await db.delete(schema.storesTable).where(inArray(schema.storesTable.id, storeIds));
  }
  if (userIds.length > 0) {
    await db.delete(schema.usersTable).where(inArray(schema.usersTable.id, userIds));
  }
}

async function main(): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const sourceStoreId = await makeStore("source");
    const freshTargetStoreId = await makeStore("fresh-target");
    const legacyTargetStoreId = await makeStore("legacy-target");
    const noEmailTargetStoreId = await makeStore("no-email-target");
    const supplierOnlySourceStoreId = await makeStore("supplier-only-source");
    const existingDualTargetStoreId = await makeStore("existing-dual-target");
    const adminId = await makeUser("admin", "admin");
    const dualEmail = `${RUN_TAG}-dual@example.test`;
    const customerUserId = await makeUser("dual", "customer", dualEmail);

    await db.insert(schema.userStoresTable).values(
      storeIds.map((storeId) => ({ userId: adminId, storeId })),
    );

    const [sourceContact] = await db.insert(schema.contactsTable).values({
      storeId: sourceStoreId,
      name: `${RUN_TAG}-dual`,
      email: dualEmail,
      contactType: "customer_supplier",
    }).returning({ id: schema.contactsTable.id });
    await db.insert(schema.customerProfilesTable).values({
      userId: customerUserId,
      storeId: sourceStoreId,
      contactId: sourceContact.id,
      contactType: "customer_supplier",
      currentBalance: "125",
    });
    const [sourceSupplier] = await db.insert(schema.suppliersTable).values({
      storeId: sourceStoreId,
      name: `${RUN_TAG}-dual`,
      email: dualEmail,
      contactId: sourceContact.id,
      contactType: "customer_supplier",
      currentBalance: "0",
    }).returning({ id: schema.suppliersTable.id });
    await db.transaction((tx) => recomputeContactBalance(tx, sourceContact.id));

    const sourceToken = signToken({
      id: adminId,
      email: `${RUN_TAG}-admin@example.test`,
      role: "admin",
      currentStoreId: sourceStoreId,
    });

    console.log("\n[1] Fresh import with customer balance 125 and supplier balance 0");
    const freshImport = await requestJson(
      baseUrl,
      `/api/erp/suppliers/${sourceSupplier.id}/import-to-stores`,
      sourceToken,
      { method: "POST", body: JSON.stringify({ targetStoreIds: [freshTargetStoreId] }) },
    );
    assertEqual("fresh import HTTP status", freshImport.status, 200);
    assertEqual("fresh import result", freshImport.body?.results?.[0]?.status, "created");
    const freshTargetSupplierId = await verifyImportedDualRole(freshTargetStoreId, 125, 0);

    const freshTargetToken = signToken({
      id: adminId,
      email: `${RUN_TAG}-admin@example.test`,
      role: "admin",
      currentStoreId: freshTargetStoreId,
    });
    const supplierList = await requestJson(baseUrl, "/api/erp/suppliers?limit=100", freshTargetToken);
    const listedSupplier = supplierList.body?.data?.find((row: { id: number }) => row.id === freshTargetSupplierId);
    assertEqual("supplier list exposes unified balance, not raw zero", Number(listedSupplier?.currentBalance ?? 0), 125);

    console.log("\n[2] Re-import repairs an older partially-linked zero-balance supplier");
    const [sourceAfterImport] = await db.select({
      globalSupplierId: schema.suppliersTable.globalSupplierId,
    }).from(schema.suppliersTable)
      .where(eq(schema.suppliersTable.id, sourceSupplier.id)).limit(1);
    await db.insert(schema.suppliersTable).values({
      storeId: legacyTargetStoreId,
      name: `${RUN_TAG}-dual`,
      email: dualEmail,
      contactType: "supplier",
      currentBalance: "0",
      globalSupplierId: sourceAfterImport.globalSupplierId,
    });
    const repairedImport = await requestJson(
      baseUrl,
      `/api/erp/suppliers/${sourceSupplier.id}/import-to-stores`,
      sourceToken,
      { method: "POST", body: JSON.stringify({ targetStoreIds: [legacyTargetStoreId] }) },
    );
    assertEqual("repair import HTTP status", repairedImport.status, 200);
    assertEqual("repair import result", repairedImport.body?.results?.[0]?.status, "already_linked");
    await verifyImportedDualRole(legacyTargetStoreId, 125, 0);

    console.log("\n[3] Existing linked contact without email is completed atomically");
    const [noEmailContact] = await db.insert(schema.contactsTable).values({
      storeId: noEmailTargetStoreId,
      name: `${RUN_TAG}-dual`,
      contactType: "supplier",
    }).returning({ id: schema.contactsTable.id });
    await db.insert(schema.suppliersTable).values({
      storeId: noEmailTargetStoreId,
      name: `${RUN_TAG}-dual`,
      contactId: noEmailContact.id,
      contactType: "supplier",
      currentBalance: "0",
      globalSupplierId: sourceAfterImport.globalSupplierId,
    });
    const noEmailImport = await requestJson(
      baseUrl,
      `/api/erp/suppliers/${sourceSupplier.id}/import-to-stores`,
      sourceToken,
      { method: "POST", body: JSON.stringify({ targetStoreIds: [noEmailTargetStoreId] }) },
    );
    assertEqual("no-email repair HTTP status", noEmailImport.status, 200);
    await verifyImportedDualRole(noEmailTargetStoreId, 125, 0);
    const [repairedContact] = await db.select({ email: schema.contactsTable.email })
      .from(schema.contactsTable).where(eq(schema.contactsTable.id, noEmailContact.id)).limit(1);
    assertEqual("missing target email backfilled from source identity", repairedContact?.email, dualEmail);

    console.log("\n[4] Supplier-only import does not downgrade an existing dual-role target");
    const pureSupplierName = `${RUN_TAG}-pure-supplier`;
    const [pureSourceContact] = await db.insert(schema.contactsTable).values({
      storeId: supplierOnlySourceStoreId,
      name: pureSupplierName,
      contactType: "supplier",
    }).returning({ id: schema.contactsTable.id });
    const [pureSourceSupplier] = await db.insert(schema.suppliersTable).values({
      storeId: supplierOnlySourceStoreId,
      name: pureSupplierName,
      contactId: pureSourceContact.id,
      contactType: "supplier",
      currentBalance: "-40",
    }).returning({ id: schema.suppliersTable.id });

    const existingDualEmail = `${RUN_TAG}-existing-dual@example.test`;
    const existingDualUserId = await makeUser("existing-dual", "customer", existingDualEmail);
    const [existingDualContact] = await db.insert(schema.contactsTable).values({
      storeId: existingDualTargetStoreId,
      name: pureSupplierName,
      email: existingDualEmail,
      contactType: "customer_supplier",
    }).returning({ id: schema.contactsTable.id });
    await db.insert(schema.customerProfilesTable).values({
      userId: existingDualUserId,
      storeId: existingDualTargetStoreId,
      contactId: existingDualContact.id,
      contactType: "customer_supplier",
      currentBalance: "10",
    });
    const [existingDualSupplier] = await db.insert(schema.suppliersTable).values({
      storeId: existingDualTargetStoreId,
      name: pureSupplierName,
      contactId: existingDualContact.id,
      contactType: "customer_supplier",
      currentBalance: "0",
    }).returning({ id: schema.suppliersTable.id });
    await db.transaction((tx) => recomputeContactBalance(tx, existingDualContact.id));

    const pureSourceToken = signToken({
      id: adminId,
      email: `${RUN_TAG}-admin@example.test`,
      role: "admin",
      currentStoreId: supplierOnlySourceStoreId,
    });
    const preserveDualImport = await requestJson(
      baseUrl,
      `/api/erp/suppliers/${pureSourceSupplier.id}/import-to-stores`,
      pureSourceToken,
      { method: "POST", body: JSON.stringify({ targetStoreIds: [existingDualTargetStoreId] }) },
    );
    assertEqual("supplier-only import HTTP status", preserveDualImport.status, 200);
    assertEqual("supplier-only import links existing row", preserveDualImport.body?.results?.[0]?.status, "linked_existing");
    const [preservedSupplier] = await db.select().from(schema.suppliersTable)
      .where(eq(schema.suppliersTable.id, existingDualSupplier.id)).limit(1);
    const [preservedContact] = await db.select().from(schema.contactsTable)
      .where(eq(schema.contactsTable.id, existingDualContact.id)).limit(1);
    assertEqual("existing target supplier remains dual-role", preservedSupplier?.contactType, "customer_supplier");
    assertEqual("existing target customer balance is preserved", Number(preservedContact?.currentBalance ?? 0), -30);

    console.log("\n[5] Later supplier-side changes keep all imported stores unified");
    await db.transaction((tx) => mutateSupplierBalance(tx, sourceSupplier.id, { absolute: -25 }));
    await verifyImportedDualRole(freshTargetStoreId, 125, -25);
    await verifyImportedDualRole(legacyTargetStoreId, 125, -25);
    await verifyImportedDualRole(noEmailTargetStoreId, 125, -25);
  } finally {
    server.close();
    await cleanup();
    await pool.end();
  }

  console.log(`\n${failures === 0 ? "ALL SCENARIOS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("Test script crashed:", error);
  try {
    await cleanup();
    await pool.end();
  } catch {
    // Best-effort cleanup after an unexpected setup failure.
  }
  process.exit(1);
});
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import app from "./app";
import { db, pool, schema } from "./lib/db";
import { signToken } from "./lib/auth";

const tag = `test-supplier-location-${Date.now()}-${randomUUID().slice(0, 8)}`;
let storeId: number | undefined;
let userId: number | undefined;
let supplierId: number | undefined;
let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    failures++;
    console.error(`FAIL ${label}: expected ${String(expected)}, got ${String(actual)}`);
    return;
  }
  console.log(`ok   ${label} = ${String(actual)}`);
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
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function cleanup(): Promise<void> {
  if (supplierId !== undefined) {
    const [supplier] = await db.select({ contactId: schema.suppliersTable.contactId })
      .from(schema.suppliersTable)
      .where(eq(schema.suppliersTable.id, supplierId))
      .limit(1);
    await db.delete(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierId));
    if (supplier?.contactId != null) {
      await db.delete(schema.contactsTable).where(eq(schema.contactsTable.id, supplier.contactId));
    }
  }
  if (userId !== undefined && storeId !== undefined) {
    await db.delete(schema.userStoresTable).where(and(
      eq(schema.userStoresTable.userId, userId),
      eq(schema.userStoresTable.storeId, storeId),
    ));
  }
  if (userId !== undefined) {
    await db.delete(schema.usersTable).where(eq(schema.usersTable.id, userId));
  }
  if (storeId !== undefined) {
    await db.delete(schema.storesTable).where(eq(schema.storesTable.id, storeId));
  }
}

async function main(): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const [store] = await db.insert(schema.storesTable).values({
      nameAr: tag,
      nameEn: tag,
      slug: tag,
    }).returning({ id: schema.storesTable.id });
    storeId = store.id;

    const [user] = await db.insert(schema.usersTable).values({
      name: tag,
      email: `${tag}@example.test`,
      passwordHash: "test-only",
      role: "admin",
    }).returning({ id: schema.usersTable.id });
    userId = user.id;
    await db.insert(schema.userStoresTable).values({ userId, storeId });

    const token = signToken({
      id: userId,
      email: `${tag}@example.test`,
      role: "admin",
      currentStoreId: storeId,
    });

    const created = await requestJson(baseUrl, "/api/erp/suppliers", token, {
      method: "POST",
      body: JSON.stringify({
        name: tag,
        wilaya: "Alger",
        commune: "Bab Ezzouar",
      }),
    });
    assertEqual("create status", created.status, 201);
    supplierId = created.body?.id;
    assertEqual("create response wilaya", created.body?.wilaya, "Alger");
    assertEqual("create response commune", created.body?.commune, "Bab Ezzouar");

    const createdList = await requestJson(baseUrl, "/api/erp/suppliers?limit=100", token);
    const createdReload = createdList.body?.data?.find((row: { id: number }) => row.id === supplierId);
    assertEqual("reload after create wilaya", createdReload?.wilaya, "Alger");
    assertEqual("reload after create commune", createdReload?.commune, "Bab Ezzouar");

    const updated = await requestJson(baseUrl, `/api/erp/suppliers/${supplierId}`, token, {
      method: "PUT",
      body: JSON.stringify({
        name: tag,
        wilaya: "Oran",
        commune: "Bir El Djir",
      }),
    });
    assertEqual("update status", updated.status, 200);
    assertEqual("update response wilaya", updated.body?.wilaya, "Oran");
    assertEqual("update response commune", updated.body?.commune, "Bir El Djir");

    const updatedList = await requestJson(baseUrl, "/api/erp/suppliers?limit=100", token);
    const updatedReload = updatedList.body?.data?.find((row: { id: number }) => row.id === supplierId);
    assertEqual("reload after update wilaya", updatedReload?.wilaya, "Oran");
    assertEqual("reload after update commune", updatedReload?.commune, "Bir El Djir");

    const [stored] = await db.select({
      wilaya: schema.suppliersTable.wilaya,
      commune: schema.suppliersTable.commune,
    }).from(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierId!)).limit(1);
    assertEqual("database wilaya", stored?.wilaya, "Oran");
    assertEqual("database commune", stored?.commune, "Bir El Djir");
  } finally {
    await cleanup();
    // The app also registers a WebSocket server on the HTTP listener. Do not
    // wait indefinitely for its close callback when no client was connected.
    server.closeAllConnections();
    server.close();
    await pool.end();
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await cleanup().catch(() => undefined);
  await pool.end().catch(() => undefined);
});
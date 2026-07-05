import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "./db";

export type DbLike = Pick<typeof db, "select" | "insert" | "update" | "delete">;

// ── Contacts unified balance ───────────────────────────────────────────────────
// contacts.current_balance is the single canonical balance for customer_supplier
// contacts. It equals customer_profiles.current_balance + suppliers.current_balance.
// Positive = contact owes the store (net receivable).

// Increments contacts.current_balance by delta (no-op for delta=0).
// Use this after any raw SQL that already updated the role table.
export async function applyContactDelta(tx: DbLike, contactId: number, delta: number): Promise<void> {
  if (delta === 0) return;
  await tx.update(schema.contactsTable)
    .set({ currentBalance: sql`COALESCE(current_balance, '0') + ${delta.toFixed(2)}`, updatedAt: new Date() })
    .where(eq(schema.contactsTable.id, contactId));
}

// Recomputes contacts.current_balance = cp.current_balance + suppliers.current_balance.
// Use after any absolute-set operation (ajustement, manual balance override).
export async function recomputeContactBalance(tx: DbLike, contactId: number): Promise<void> {
  const [cpRow] = await tx.select({ bal: schema.customerProfilesTable.currentBalance })
    .from(schema.customerProfilesTable)
    .where(eq(schema.customerProfilesTable.contactId, contactId));
  const cpBal = parseFloat(cpRow?.bal ?? "0");

  const [supRow] = await tx.select({ bal: schema.suppliersTable.currentBalance })
    .from(schema.suppliersTable)
    .where(eq(schema.suppliersTable.contactId, contactId));
  const supBal = parseFloat(supRow?.bal ?? "0");

  await tx.update(schema.contactsTable)
    .set({ currentBalance: (cpBal + supBal).toFixed(2), updatedAt: new Date() })
    .where(eq(schema.contactsTable.id, contactId));
}

// ── Customer-side balance ──────────────────────────────────────────────────────
// applyNetBalanceDelta: legacy name kept for backward compat with orders.ts call
// sites. Since all orders.ts callers already update customer_profiles via raw SQL
// before calling this, this function only updates contacts.current_balance — the
// double-apply on customer_profiles is intentionally removed.
export async function applyNetBalanceDelta(tx: DbLike, contactId: number, delta: number): Promise<void> {
  await applyContactDelta(tx, contactId, delta);
}

// Absolute set of customer_profiles.current_balance + recompute contacts.
export async function setNetBalance(tx: DbLike, contactId: number, newBalance: number): Promise<void> {
  await tx.update(schema.customerProfilesTable)
    .set({ currentBalance: newBalance.toFixed(2), updatedAt: new Date() })
    .where(eq(schema.customerProfilesTable.contactId, contactId));
  await recomputeContactBalance(tx, contactId);
}

// ── Cross-store customer balance sync ──────────────────────────────────────────
// Customers linked across stores share ONE global identity: customer_profiles.user_id
// (a single global users.id — the same person always has the same user_id in every
// store). This is the customer-side mirror of syncLinkedSupplierBalances (which is
// keyed on suppliers.globalSupplierId): after any balance-changing operation on a
// customer in one store, COPY that store's resulting customer_profiles.current_balance
// to the SAME user's profile in every other store, and recompute the canonical contact
// balance for each linked profile that has a contact. No-op when the customer only
// exists in one store. `sourceStoreId` is the store whose balance is authoritative
// (the store that was just updated, or an existing store when a new profile adopts the
// already-unified balance).
export async function syncLinkedCustomerBalances(
  tx: DbLike,
  userId: number,
  sourceStoreId: number,
): Promise<void> {
  const [source] = await tx.select({ currentBalance: schema.customerProfilesTable.currentBalance })
    .from(schema.customerProfilesTable)
    .where(and(
      eq(schema.customerProfilesTable.userId, userId),
      eq(schema.customerProfilesTable.storeId, sourceStoreId),
    ))
    .limit(1);
  if (!source) return;
  const linked = await tx.select({ id: schema.customerProfilesTable.id, contactId: schema.customerProfilesTable.contactId })
    .from(schema.customerProfilesTable)
    .where(and(
      eq(schema.customerProfilesTable.userId, userId),
      ne(schema.customerProfilesTable.storeId, sourceStoreId),
    ));
  for (const row of linked) {
    await tx.update(schema.customerProfilesTable)
      .set({ currentBalance: source.currentBalance, updatedAt: new Date() })
      .where(eq(schema.customerProfilesTable.id, row.id));
    if (row.contactId) await recomputeContactBalance(tx, row.contactId);
  }
}

// ── Supplier-side balance ──────────────────────────────────────────────────────
// Increments suppliers.current_balance + mirrors delta to contacts.current_balance.
export async function applySupplierBalanceDelta(tx: DbLike, contactId: number, delta: number): Promise<void> {
  if (delta === 0) return;
  await tx.update(schema.suppliersTable)
    .set({ currentBalance: sql`COALESCE(current_balance, '0') + ${delta.toFixed(2)}` })
    .where(eq(schema.suppliersTable.contactId, contactId));
  await applyContactDelta(tx, contactId, delta);
}

// Absolute set of suppliers.current_balance + recompute contacts.
export async function setSupplierBalance(tx: DbLike, contactId: number, newBalance: number): Promise<void> {
  await tx.update(schema.suppliersTable)
    .set({ currentBalance: newBalance.toFixed(2) })
    .where(eq(schema.suppliersTable.contactId, contactId));
  await recomputeContactBalance(tx, contactId);
}

// ── Mirror helper (kept for legacy compatibility) ─────────────────────────────
// Sets the same absolute balance on both role tables + contacts.
export async function mirrorNetBalance(tx: DbLike, contactId: number, balance: string): Promise<void> {
  await tx.update(schema.customerProfilesTable)
    .set({ currentBalance: balance, updatedAt: new Date() })
    .where(eq(schema.customerProfilesTable.contactId, contactId));
  await tx.update(schema.suppliersTable)
    .set({ currentBalance: balance })
    .where(eq(schema.suppliersTable.contactId, contactId));
  await tx.update(schema.contactsTable)
    .set({ currentBalance: balance, updatedAt: new Date() })
    .where(eq(schema.contactsTable.id, contactId));
}

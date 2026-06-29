import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db";

export type DbLike = Pick<typeof db, "select" | "insert" | "update" | "delete">;

// ── Customer-side balance (customer_profiles.current_balance) ─────────────────
// Operates on the row whose contact_id = contactId. Per-store: each contact
// belongs to exactly one store. No-op if no customer_profiles row is linked.

export async function applyNetBalanceDelta(tx: DbLike, contactId: number, delta: number): Promise<void> {
  if (delta === 0) return;
  await tx.update(schema.customerProfilesTable)
    .set({ currentBalance: sql`COALESCE(current_balance, '0') + ${delta.toFixed(2)}`, updatedAt: new Date() })
    .where(eq(schema.customerProfilesTable.contactId, contactId));
}

export async function setNetBalance(tx: DbLike, contactId: number, newBalance: number): Promise<void> {
  await tx.update(schema.customerProfilesTable)
    .set({ currentBalance: newBalance.toFixed(2), updatedAt: new Date() })
    .where(eq(schema.customerProfilesTable.contactId, contactId));
}

// ── Supplier-side balance (suppliers.current_balance) ─────────────────────────
// Operates on the suppliers row whose contact_id = contactId. Per-store.
// No-op if no suppliers row is linked.

export async function applySupplierBalanceDelta(tx: DbLike, contactId: number, delta: number): Promise<void> {
  if (delta === 0) return;
  await tx.update(schema.suppliersTable)
    .set({ currentBalance: sql`COALESCE(current_balance, '0') + ${delta.toFixed(2)}` })
    .where(eq(schema.suppliersTable.contactId, contactId));
}

export async function setSupplierBalance(tx: DbLike, contactId: number, newBalance: number): Promise<void> {
  await tx.update(schema.suppliersTable)
    .set({ currentBalance: newBalance.toFixed(2) })
    .where(eq(schema.suppliersTable.contactId, contactId));
}

// ── Mirror helper (kept for legacy compatibility) ─────────────────────────────
// Writes an absolute balance to both role rows; each update is a no-op when
// the matching row doesn't exist.

export async function mirrorNetBalance(tx: DbLike, contactId: number, balance: string): Promise<void> {
  await tx.update(schema.customerProfilesTable)
    .set({ currentBalance: balance, updatedAt: new Date() })
    .where(eq(schema.customerProfilesTable.contactId, contactId));
  await tx.update(schema.suppliersTable)
    .set({ currentBalance: balance })
    .where(eq(schema.suppliersTable.contactId, contactId));
}

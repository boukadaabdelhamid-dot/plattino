import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db";

export type DbLike = Pick<typeof db, "select" | "insert" | "update" | "delete">;

// Mirror a resolved balance to every customer_profiles row and suppliers row
// that points at this contact (within the same store — filtered by contactId FK).
// Pure-customer / pure-supplier contacts only have one side populated, so the
// update on the other table is always a no-op.
export async function mirrorNetBalance(tx: DbLike, contactId: number, balance: string): Promise<void> {
  await tx.update(schema.customerProfilesTable)
    .set({ currentBalance: balance, updatedAt: new Date() })
    .where(eq(schema.customerProfilesTable.contactId, contactId));
  await tx.update(schema.suppliersTable)
    .set({ currentBalance: balance })
    .where(eq(schema.suppliersTable.contactId, contactId));
}

// Apply a signed delta to contacts.current_balance and propagate the new
// value to all linked role rows (customer_profiles + suppliers) for the
// SAME contact (per-store — no cross-store propagation).
// Only operates on customer_supplier contacts; no-op for pure roles.
export async function applyNetBalanceDelta(tx: DbLike, contactId: number, delta: number): Promise<void> {
  const [contact] = await tx.select({
    contactType: schema.contactsTable.contactType,
  }).from(schema.contactsTable).where(eq(schema.contactsTable.id, contactId)).limit(1);
  if (!contact || contact.contactType !== "customer_supplier") return;
  if (delta === 0) return;

  await tx.update(schema.contactsTable)
    .set({ currentBalance: sql`COALESCE(current_balance, 0) + ${delta.toFixed(2)}`, updatedAt: new Date() })
    .where(eq(schema.contactsTable.id, contactId));
  const [updated] = await tx.select({ currentBalance: schema.contactsTable.currentBalance })
    .from(schema.contactsTable).where(eq(schema.contactsTable.id, contactId)).limit(1);
  const newBal = updated?.currentBalance ?? "0";

  await mirrorNetBalance(tx, contactId, newBal);
}

// Set contacts.current_balance to an absolute value and propagate everywhere
// within the same store (no cross-store propagation).
// Only operates on customer_supplier contacts; no-op for pure roles.
export async function setNetBalance(tx: DbLike, contactId: number, newBalance: number): Promise<void> {
  const [contact] = await tx.select({
    contactType: schema.contactsTable.contactType,
  }).from(schema.contactsTable).where(eq(schema.contactsTable.id, contactId)).limit(1);
  if (!contact || contact.contactType !== "customer_supplier") return;
  const newBalFixed = newBalance.toFixed(2);

  await tx.update(schema.contactsTable)
    .set({ currentBalance: newBalFixed, updatedAt: new Date() })
    .where(eq(schema.contactsTable.id, contactId));
  await mirrorNetBalance(tx, contactId, newBalFixed);
}

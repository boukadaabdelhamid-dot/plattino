import { eq, and, ne, sql } from "drizzle-orm";
import { db, schema } from "./db";

export type DbLike = Pick<typeof db, "select" | "insert" | "update" | "delete">;

// Mirror a resolved balance to every customer_profiles row and suppliers row
// that points at this contact. Pure-customer / pure-supplier contacts only
// have one of those tables populated, so the extra update is always a no-op.
export async function mirrorNetBalance(tx: DbLike, contactId: number, balance: string): Promise<void> {
  await tx.update(schema.customerProfilesTable)
    .set({ currentBalance: balance, updatedAt: new Date() })
    .where(eq(schema.customerProfilesTable.contactId, contactId));
  await tx.update(schema.suppliersTable)
    .set({ currentBalance: balance })
    .where(eq(schema.suppliersTable.contactId, contactId));
}

// Apply a signed delta to contacts.current_balance and propagate the new
// value to ALL linked role rows (customer_profiles + suppliers) and to any
// sibling contacts sharing the same global_contact_id.
// No-op for pure-customer or pure-supplier contacts.
export async function applyNetBalanceDelta(tx: DbLike, contactId: number, delta: number): Promise<void> {
  const [contact] = await tx.select({
    contactType: schema.contactsTable.contactType,
    globalContactId: schema.contactsTable.globalContactId,
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

  if (!contact.globalContactId) return;
  const siblings = await tx.select({ id: schema.contactsTable.id })
    .from(schema.contactsTable)
    .where(and(
      eq(schema.contactsTable.globalContactId, contact.globalContactId),
      ne(schema.contactsTable.id, contactId),
    ));
  for (const sib of siblings) {
    await tx.update(schema.contactsTable)
      .set({ currentBalance: newBal, updatedAt: new Date() })
      .where(eq(schema.contactsTable.id, sib.id));
    await mirrorNetBalance(tx, sib.id, newBal);
  }
}

// Set contacts.current_balance to an absolute value and propagate everywhere.
// No-op for pure-customer or pure-supplier contacts.
export async function setNetBalance(tx: DbLike, contactId: number, newBalance: number): Promise<void> {
  const [contact] = await tx.select({
    contactType: schema.contactsTable.contactType,
    globalContactId: schema.contactsTable.globalContactId,
  }).from(schema.contactsTable).where(eq(schema.contactsTable.id, contactId)).limit(1);
  if (!contact || contact.contactType !== "customer_supplier") return;
  const newBalFixed = newBalance.toFixed(2);

  const allIds: number[] = [contactId];
  if (contact.globalContactId) {
    const siblings = await tx.select({ id: schema.contactsTable.id })
      .from(schema.contactsTable)
      .where(eq(schema.contactsTable.globalContactId, contact.globalContactId));
    siblings.forEach((s) => { if (s.id !== contactId) allIds.push(s.id); });
  }
  for (const cid of allIds) {
    await tx.update(schema.contactsTable)
      .set({ currentBalance: newBalFixed, updatedAt: new Date() })
      .where(eq(schema.contactsTable.id, cid));
    await mirrorNetBalance(tx, cid, newBalFixed);
  }
}

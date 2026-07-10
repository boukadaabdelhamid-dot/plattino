import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "./db";

export type DbLike = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

// Serializes every balance-changing operation that touches a given identity onto
// one or more Postgres advisory locks for the lifetime of the current
// transaction. Without this, two concurrent transactions mutating DIFFERENT
// roles of the SAME dual-role contact (e.g. a customer-side sale and a
// supplier-side payment) could each read the other's role balance mid-flight
// while computing contacts.current_balance, dropping one side's delta (lost
// update) — and the same race exists for two SAME-role mutations fanning out
// across a legacy (pre-globalContactId) cross-store group via userId /
// globalSupplierId.
//
// Once a contact has a globalContactId, that single key already unifies every
// role in every linked store, so locking on it alone is sufficient. Before one
// exists, no single key covers both axes (cross-store same-role fan-out keys on
// userId/globalSupplierId; same-store dual-role fan-out keys on contactId), so
// callers pass BOTH applicable keys. Keys are de-duplicated and sorted into one
// fixed, deterministic global order (shared by every caller) before acquiring
// them one at a time — this is what prevents a lock-ordering deadlock between,
// say, a concurrent customer-side transaction (locking cust:X then contact:Y)
// and a supplier-side transaction (locking sup:Z then contact:Y): both instead
// acquire their locks in the same sorted order, so a cycle can't form.
async function lockIdentityGroup(tx: DbLike, keys: Array<string | null | undefined>): Promise<void> {
  const uniqueSorted = [...new Set(keys.filter((k): k is string => !!k))].sort();
  for (const key of uniqueSorted) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  }
}

// ── Caisse balance snapshots ("ancien solde" / "nouveau solde") ────────────────
// Caisses have no shared advisory-lock mutator (they're global with no cross-store
// sync — see memory), so every call site applies its own delta directly. This
// helper centralizes the read-lock-write so every site captures the exact
// before/after balance instead of guessing it later from the movements list.
// Row-locking via FOR UPDATE is safe here (no advisory lock to invert order
// against) and matches the pattern already used by the admin/adjust endpoint.
export async function applyCaisseDelta(
  tx: DbLike,
  caisseId: number,
  delta: number,
): Promise<{ oldBalance: number; newBalance: number }> {
  const [row] = await tx.select({ balance: schema.caissesTable.balance })
    .from(schema.caissesTable)
    .where(eq(schema.caissesTable.id, caisseId))
    .for("update");
  const oldBalance = parseFloat(row?.balance ?? "0");
  const newBalance = oldBalance + delta;
  await tx.update(schema.caissesTable)
    .set({ balance: newBalance.toFixed(2) })
    .where(eq(schema.caissesTable.id, caisseId));
  return { oldBalance, newBalance };
}

// Locks two-or-more caisse rows for the duration of the transaction, always in
// ascending-id order regardless of which caisse is logically the "source" or
// "destination" at the call site. The admin deposit/withdraw endpoints move
// money between the SAME pair of caisses (a staff caisse and the main caisse)
// but in opposite logical directions — deposit's source is withdraw's
// destination and vice versa. If each endpoint locked source-then-destination
// independently, concurrent opposite calls would lock the pair in opposite
// row order and could deadlock. Locking by a fixed id order sidesteps that
// regardless of which endpoint is "source" vs "destination".
export async function lockCaissesById(
  tx: DbLike,
  caisseIds: number[],
): Promise<Map<number, number>> {
  const uniqueIds = [...new Set(caisseIds)];
  const rows = await tx.select({ id: schema.caissesTable.id, balance: schema.caissesTable.balance })
    .from(schema.caissesTable)
    .where(inArray(schema.caissesTable.id, uniqueIds))
    .orderBy(asc(schema.caissesTable.id))
    .for("update");
  const balances = new Map<number, number>();
  for (const row of rows) balances.set(row.id, parseFloat(row.balance ?? "0"));
  return balances;
}

// ── Contacts unified balance ───────────────────────────────────────────────────
// contacts.current_balance is the single canonical balance for customer_supplier
// contacts. It equals customer_profiles.current_balance + suppliers.current_balance.
// Positive = contact owes the store (net receivable).

// Recomputes contacts.current_balance = cp.current_balance + suppliers.current_balance.
// Call after ANY change to either role's balance for this contact.
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

// ── THE cross-store link ───────────────────────────────────────────────────────
// contacts.globalContactId is the single identity key shared by every per-store
// contact row representing the same physical person/company. Because BOTH the
// customer role and the supplier role point at the contact via contactId, syncing
// through this ONE key keeps both roles connected across every linked store —
// structurally impossible to link one role without the other.
//
// After ANY balance-changing operation on a contact-linked role, call this with
// the contact whose role just changed: it copies that role's new balance to every
// sibling contact's SAME role (customer→customer, supplier→supplier), then
// recomputes each sibling's canonical unified balance. No-op when the contact has
// no globalContactId (not cross-store linked).
export async function syncLinkedContactBalances(tx: DbLike, contactId: number): Promise<void> {
  const [source] = await tx.select({ globalContactId: schema.contactsTable.globalContactId })
    .from(schema.contactsTable)
    .where(eq(schema.contactsTable.id, contactId))
    .limit(1);
  if (!source?.globalContactId) return;
  const gcid = source.globalContactId;

  const [srcCp] = await tx.select({ currentBalance: schema.customerProfilesTable.currentBalance })
    .from(schema.customerProfilesTable)
    .where(eq(schema.customerProfilesTable.contactId, contactId))
    .limit(1);
  const [srcSup] = await tx.select({ currentBalance: schema.suppliersTable.currentBalance })
    .from(schema.suppliersTable)
    .where(eq(schema.suppliersTable.contactId, contactId))
    .limit(1);

  const siblings = await tx.select({ id: schema.contactsTable.id })
    .from(schema.contactsTable)
    .where(and(eq(schema.contactsTable.globalContactId, gcid), ne(schema.contactsTable.id, contactId)));

  for (const sib of siblings) {
    if (srcCp) {
      await tx.update(schema.customerProfilesTable)
        .set({ currentBalance: srcCp.currentBalance, updatedAt: new Date() })
        .where(eq(schema.customerProfilesTable.contactId, sib.id));
    }
    if (srcSup) {
      await tx.update(schema.suppliersTable)
        .set({ currentBalance: srcSup.currentBalance })
        .where(eq(schema.suppliersTable.contactId, sib.id));
    }
    await recomputeContactBalance(tx, sib.id);
  }
}

// Links two contacts (usually in different stores) into the same global identity
// so they always stay balance-synced going forward. Idempotent and merge-safe:
// - Neither has a globalContactId yet → both get a freshly minted one.
// - One already has one → the other adopts it.
// - Both already have DIFFERENT ones (rare: two previously-separate link chains
//   turn out to be the same identity) → the whole second group is merged onto
//   the first group's id so nothing is silently left half-linked.
// This is the ONLY place a contact's globalContactId should be assigned — every
// cross-store linking/import flow (customer-first or supplier-first) must call
// this so linking one role can never leave the other role unlinked.
export async function linkContactsGlobally(tx: DbLike, contactIdA: number, contactIdB: number): Promise<void> {
  if (contactIdA === contactIdB) return;
  const rows = await tx.select({ id: schema.contactsTable.id, gcid: schema.contactsTable.globalContactId })
    .from(schema.contactsTable)
    .where(inArray(schema.contactsTable.id, [contactIdA, contactIdB]));
  const aRow = rows.find((r) => r.id === contactIdA);
  const bRow = rows.find((r) => r.id === contactIdB);
  if (!aRow || !bRow) return;
  if (aRow.gcid && bRow.gcid && aRow.gcid === bRow.gcid) return; // already linked

  const gcid = aRow.gcid ?? bRow.gcid ?? randomUUID();

  if (bRow.gcid && bRow.gcid !== gcid) {
    // B belongs to an existing, different group — merge that whole group onto gcid.
    await tx.update(schema.contactsTable)
      .set({ globalContactId: gcid, updatedAt: new Date() })
      .where(eq(schema.contactsTable.globalContactId, bRow.gcid));
  } else if (!bRow.gcid) {
    await tx.update(schema.contactsTable)
      .set({ globalContactId: gcid, updatedAt: new Date() })
      .where(eq(schema.contactsTable.id, contactIdB));
  }
  if (!aRow.gcid) {
    await tx.update(schema.contactsTable)
      .set({ globalContactId: gcid, updatedAt: new Date() })
      .where(eq(schema.contactsTable.id, contactIdA));
  }
}

// ── Legacy per-role cross-store sync (kept for rows with NO linked contact) ───
// Pre-dating the unified contact identity, customers were linked across stores
// purely via customer_profiles.userId (a global users.id) and suppliers purely
// via suppliers.globalSupplierId. These still run for legacy rows that were
// never linked to a `contacts` row (contactId IS NULL) — for anything with a
// contactId, syncLinkedContactBalances (above) is the authoritative sync path.

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

export async function syncLinkedSupplierBalances(
  tx: DbLike,
  supplierId: number,
  globalSupplierId: string | null | undefined,
): Promise<void> {
  if (!globalSupplierId) return;
  const [source] = await tx.select({ currentBalance: schema.suppliersTable.currentBalance })
    .from(schema.suppliersTable)
    .where(eq(schema.suppliersTable.id, supplierId))
    .limit(1);
  if (!source) return;
  const linked = await tx.select({ id: schema.suppliersTable.id, contactId: schema.suppliersTable.contactId })
    .from(schema.suppliersTable)
    .where(and(
      eq(schema.suppliersTable.globalSupplierId, globalSupplierId),
      ne(schema.suppliersTable.id, supplierId),
    ));
  for (const row of linked) {
    await tx.update(schema.suppliersTable)
      .set({ currentBalance: source.currentBalance })
      .where(eq(schema.suppliersTable.id, row.id));
    if (row.contactId) await recomputeContactBalance(tx, row.contactId);
  }
}

// ── Centralized balance mutation — THE only way a role balance should change ──
// Every balance-changing operation (sale on credit, payment, return, adjustment)
// must go through mutateCustomerBalance / mutateSupplierBalance instead of
// writing customer_profiles / suppliers directly. Each call, in order:
//   1. Applies the delta or absolute value to the role table (upserting the
//      customer profile row if this is its first-ever balance-changing op).
//   2. Runs the legacy per-role cross-store sync (userId / globalSupplierId) —
//      a safety net for rows with no linked contact yet.
//   3. Resolves the linked contactId (if any), recomputes that contact's unified
//      balance, and fans it out to every sibling contact via
//      syncLinkedContactBalances — covering BOTH roles for customer_supplier
//      contacts, regardless of which role triggered the change.
// No call site can skip a step because there is only one path to call.

type BalanceOp = { delta: number; absolute?: undefined } | { absolute: number; delta?: undefined };

// Resolves and acquires the identity-scoped advisory lock(s) for a customer role
// WITHOUT applying any balance change. Exported so callers that need to read the
// balance, compute something off it, and only then call mutateCustomerBalance
// (e.g. the adjustment endpoint) can take this SAME lock first. Acquiring an
// explicit row lock (SELECT ... FOR UPDATE) instead for that purpose would
// invert the lock order against every other mutateCustomerBalance caller
// (which take this advisory lock before ever touching the row), opening a
// deadlock window under concurrency. Advisory locks are reentrant per
// transaction, so calling this and then mutateCustomerBalance (which acquires
// the same key) in the same transaction is safe and effectively free the
// second time.
export async function lockCustomerIdentity(
  tx: DbLike,
  userId: number,
  storeId: number,
): Promise<{ contactId: number | null }> {
  // Once globalContactId exists it alone unifies every role in every linked
  // store, so lock on it alone. Before it exists, lock on BOTH: `cust:userId`
  // (covers legacy cross-store customer-side fan-out, keyed the same way
  // syncLinkedCustomerBalances resolves siblings) AND `contact:contactId`
  // (covers same-store customer-vs-supplier dual-role fan-out, shared with
  // mutateSupplierBalance's lock below) — see lockIdentityGroup for why both
  // are needed and why the ordering is safe.
  const [existing] = await tx.select({
    contactId: schema.customerProfilesTable.contactId,
    gcid: schema.contactsTable.globalContactId,
  })
    .from(schema.customerProfilesTable)
    .leftJoin(schema.contactsTable, eq(schema.contactsTable.id, schema.customerProfilesTable.contactId))
    .where(and(eq(schema.customerProfilesTable.userId, userId), eq(schema.customerProfilesTable.storeId, storeId)))
    .limit(1);
  await lockIdentityGroup(
    tx,
    existing?.gcid
      ? [existing.gcid]
      : [`cust:${userId}`, existing?.contactId != null ? `contact:${existing.contactId}` : null],
  );
  return { contactId: existing?.contactId ?? null };
}

export async function mutateCustomerBalance(
  tx: DbLike,
  userId: number,
  storeId: number,
  op: BalanceOp,
): Promise<{ contactId: number | null; oldBalance: number; newBalance: number }> {
  await lockCustomerIdentity(tx, userId, storeId);

  // Read the raw customer-role balance BEFORE mutating it — this is the real
  // "ancien solde" for this operation. Safe to read-then-write (rather than an
  // atomic SQL increment) because lockCustomerIdentity above already serializes
  // every mutator of this identity for the duration of the transaction.
  const [before] = await tx.select({ currentBalance: schema.customerProfilesTable.currentBalance })
    .from(schema.customerProfilesTable)
    .where(and(eq(schema.customerProfilesTable.userId, userId), eq(schema.customerProfilesTable.storeId, storeId)))
    .limit(1);
  const oldBalance = parseFloat(before?.currentBalance ?? "0");
  let newBalance = oldBalance;

  if (op.absolute !== undefined) {
    newBalance = op.absolute;
    const balStr = newBalance.toFixed(2);
    await tx.insert(schema.customerProfilesTable)
      .values({ userId, storeId, currentBalance: balStr })
      .onConflictDoUpdate({
        target: [schema.customerProfilesTable.userId, schema.customerProfilesTable.storeId],
        set: { currentBalance: balStr, updatedAt: new Date() },
      });
  } else if (op.delta !== 0) {
    newBalance = oldBalance + op.delta;
    const balStr = newBalance.toFixed(2);
    await tx.insert(schema.customerProfilesTable)
      .values({ userId, storeId, currentBalance: balStr })
      .onConflictDoUpdate({
        target: [schema.customerProfilesTable.userId, schema.customerProfilesTable.storeId],
        set: { currentBalance: balStr, updatedAt: new Date() },
      });
  }

  await syncLinkedCustomerBalances(tx, userId, storeId);

  const [prof] = await tx.select({ contactId: schema.customerProfilesTable.contactId })
    .from(schema.customerProfilesTable)
    .where(and(eq(schema.customerProfilesTable.userId, userId), eq(schema.customerProfilesTable.storeId, storeId)))
    .limit(1);
  const contactId = prof?.contactId ?? null;
  if (contactId != null) {
    await recomputeContactBalance(tx, contactId);
    await syncLinkedContactBalances(tx, contactId);
  }
  return { contactId, oldBalance, newBalance };
}

// Mirrors lockCustomerIdentity for the supplier role — see there for why callers
// that read-then-mutate (e.g. the adjustment endpoint) must take this lock
// first instead of an explicit row lock.
export async function lockSupplierIdentity(
  tx: DbLike,
  supplierId: number,
): Promise<{ contactId: number | null }> {
  // Mirrors mutateCustomerBalance's lock resolution: gcid alone once linked;
  // otherwise BOTH the legacy cross-store supplier-side key (globalSupplierId
  // once imported to other stores, else this row's own id) AND
  // `contact:contactId` — the same shared key mutateCustomerBalance locks —
  // so a same-store customer-vs-supplier dual-role race is always caught even
  // before a globalContactId exists.
  const [existing] = await tx.select({
    contactId: schema.suppliersTable.contactId,
    gcid: schema.contactsTable.globalContactId,
    globalSupplierId: schema.suppliersTable.globalSupplierId,
  })
    .from(schema.suppliersTable)
    .leftJoin(schema.contactsTable, eq(schema.contactsTable.id, schema.suppliersTable.contactId))
    .where(eq(schema.suppliersTable.id, supplierId))
    .limit(1);
  await lockIdentityGroup(
    tx,
    existing?.gcid
      ? [existing.gcid]
      : [
          existing?.globalSupplierId ? `sup-g:${existing.globalSupplierId}` : `sup:${supplierId}`,
          existing?.contactId != null ? `contact:${existing.contactId}` : null,
        ],
  );
  return { contactId: existing?.contactId ?? null };
}

export async function mutateSupplierBalance(
  tx: DbLike,
  supplierId: number,
  op: BalanceOp,
): Promise<{ contactId: number | null; oldBalance: number; newBalance: number }> {
  await lockSupplierIdentity(tx, supplierId);

  // Read the raw supplier-role balance BEFORE mutating it — the real "ancien
  // solde" for this operation. Safe to read-then-write because
  // lockSupplierIdentity above already serializes every mutator of this
  // identity for the duration of the transaction.
  const [before] = await tx.select({ currentBalance: schema.suppliersTable.currentBalance })
    .from(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierId)).limit(1);
  const oldBalance = parseFloat(before?.currentBalance ?? "0");
  let newBalance = oldBalance;

  if (op.absolute !== undefined) {
    newBalance = op.absolute;
    await tx.update(schema.suppliersTable)
      .set({ currentBalance: newBalance.toFixed(2) })
      .where(eq(schema.suppliersTable.id, supplierId));
  } else if (op.delta !== 0) {
    newBalance = oldBalance + op.delta;
    await tx.update(schema.suppliersTable)
      .set({ currentBalance: newBalance.toFixed(2) })
      .where(eq(schema.suppliersTable.id, supplierId));
  }

  const [supplier] = await tx.select({
    contactId: schema.suppliersTable.contactId,
    globalSupplierId: schema.suppliersTable.globalSupplierId,
  }).from(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierId)).limit(1);

  await syncLinkedSupplierBalances(tx, supplierId, supplier?.globalSupplierId);

  const contactId = supplier?.contactId ?? null;
  if (contactId != null) {
    await recomputeContactBalance(tx, contactId);
    await syncLinkedContactBalances(tx, contactId);
  }
  return { contactId, oldBalance, newBalance };
}

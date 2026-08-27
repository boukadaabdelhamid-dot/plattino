import { Router } from "express";
import { randomUUID } from "node:crypto";
import { eq, desc, asc, sql, and, gt, ne, or, inArray, isNull, notLike, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, schema } from "../lib/db";
import { authenticate, requireAdmin, requireStaff, requireStore, isAdmin, requirePermission, normalizeEmail, isEmailUniqueViolation, type AuthRequest } from "../lib/auth";
import { broadcastToAdmins, broadcastCaisseChanged } from "../lib/ws";
import { ensureCaisse } from "./caisses";
import {
  recomputeContactBalance,
  syncLinkedCustomerBalances,
  syncLinkedContactBalances,
  linkContactsGlobally,
  mutateCustomerBalance,
  mutateSupplierBalance,
  lockCustomerIdentity,
  lockSupplierIdentity,
  applyCaisseDelta,
  type DbLike,
} from "../lib/balance-sync";

const router = Router();

const pid = (req: { params: Record<string, string | string[]> }, key: string): number =>
  parseInt(req.params[key] as string);

// ─── Unified contacts identity helpers (Phase 2, additive) ───────────────────
// A `contacts` row is the single source of truth for shared fields (name, email,
// phone, address, notes, contactType). The customer role (users + customer_profiles)
// and the supplier role (suppliers) link to it via a nullable contact_id. Each role
// keeps its own native row, so the existing customer/supplier list queries are
// unchanged — a `customer_supplier` simply owns BOTH role rows under ONE contact.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ContactSharedInput = {
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  contactType: "customer" | "supplier" | "customer_supplier";
};

// Thrown by role helpers to surface a specific HTTP status from inside a transaction.
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function insertContact(tx: Tx, storeId: number, s: ContactSharedInput): Promise<number> {
  const [c] = await tx.insert(schema.contactsTable).values({
    storeId,
    name: s.name,
    contactName: s.contactName ?? null,
    email: s.email ?? null,
    phone: s.phone ?? null,
    address: s.address ?? null,
    notes: s.notes ?? null,
    contactType: s.contactType,
  }).returning({ id: schema.contactsTable.id });
  return c.id;
}

async function updateContactFields(tx: Tx, contactId: number, s: Partial<ContactSharedInput>): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (s.name !== undefined) set.name = s.name;
  if (s.contactName !== undefined) set.contactName = s.contactName ?? null;
  if (s.email !== undefined) set.email = s.email ?? null;
  if (s.phone !== undefined) set.phone = s.phone ?? null;
  if (s.address !== undefined) set.address = s.address ?? null;
  if (s.notes !== undefined) set.notes = s.notes ?? null;
  if (s.contactType !== undefined) set.contactType = s.contactType;
  await tx.update(schema.contactsTable).set(set).where(eq(schema.contactsTable.id, contactId));
}

// Ensure the customer-role extension (user + profile) exists for a contact.
// Requires an email to create the login; throws HttpError otherwise. Idempotent.
async function ensureCustomerRole(tx: Tx, storeId: number, contactId: number, s: ContactSharedInput): Promise<number> {
  // Idempotency: scope check to (contactId, storeId) so a user imported to
  // multiple stores can have one profile per store.
  const [existing] = await tx.select({ userId: schema.customerProfilesTable.userId })
    .from(schema.customerProfilesTable)
    .where(and(
      eq(schema.customerProfilesTable.contactId, contactId),
      eq(schema.customerProfilesTable.storeId, storeId),
    )).limit(1);
  if (existing) return existing.userId;
  const email = normalizeEmail(s.email);
  if (!email) throw new HttpError(400, "email is required to create the customer side of a customer/supplier contact");
  // If a user with this email already exists, reuse them and just create a
  // profile for this store rather than throwing a 409.
  const [dup] = await tx.select({ id: schema.usersTable.id })
    .from(schema.usersTable).where(sql`lower(trim(${schema.usersTable.email})) = ${email}`).limit(1);
  let uid: number;
  if (dup) {
    uid = dup.id;
  } else {
    const passwordHash = await bcrypt.hash(Math.random().toString(36).slice(2, 12), 10);
    const [user] = await tx.insert(schema.usersTable).values({
      name: s.name, email, passwordHash, role: "customer", preferredLang: "ar",
      phone: s.phone ?? null, address: s.address ?? null, notes: s.notes ?? null,
    }).returning({ id: schema.usersTable.id });
    uid = user.id;
  }
  await tx.insert(schema.customerProfilesTable).values({
    userId: uid, storeId, contactId,
    contactType: s.contactType === "customer_supplier" ? "customer_supplier" : "customer",
  }).onConflictDoNothing();
  return uid;
}

// Ensure the supplier-role extension exists for a contact. Idempotent.
async function ensureSupplierRole(tx: Tx, storeId: number, contactId: number, s: ContactSharedInput): Promise<number> {
  const [existing] = await tx.select({ id: schema.suppliersTable.id })
    .from(schema.suppliersTable)
    .where(eq(schema.suppliersTable.contactId, contactId)).limit(1);
  if (existing) return existing.id;
  const [supplier] = await tx.insert(schema.suppliersTable).values({
    storeId, name: s.name, contactName: s.contactName ?? null, email: s.email ?? null,
    phone: s.phone ?? null, address: s.address ?? null, notes: s.notes ?? null,
    contactType: s.contactType === "customer_supplier" ? "customer_supplier" : "supplier",
    contactId,
  }).returning({ id: schema.suppliersTable.id });
  return supplier.id;
}

// Propagates a contact's just-changed effective type (promotion to customer_supplier,
// or downgrade back to a single role) to every sibling contact sharing the same
// globalContactId — a contact is a single identity across the stores that share it,
// so it must never show as a different type (or be missing a role entirely) in a
// linked sibling store. No-op when the contact has no globalContactId (not
// cross-store linked). Role rows are NEVER deleted here, mirroring local behavior:
// on downgrade only labels are reset. Balances are NOT synced here — call
// syncLinkedContactBalances afterwards, which fans out each role's already-correct
// balance to every (now-existing) sibling role row and recomputes their unified total.
async function propagateContactTypeToSiblings(
  tx: Tx,
  localContactId: number,
  effType: "customer" | "supplier" | "customer_supplier",
): Promise<void> {
  const [local] = await tx.select({ globalContactId: schema.contactsTable.globalContactId })
    .from(schema.contactsTable).where(eq(schema.contactsTable.id, localContactId)).limit(1);
  if (!local?.globalContactId) return;

  // Deterministic ascending-id order prevents a lock-ordering deadlock if two
  // concurrent promotions both fan out to the same sibling set simultaneously.
  const siblings = await tx.select().from(schema.contactsTable)
    .where(and(
      eq(schema.contactsTable.globalContactId, local.globalContactId),
      ne(schema.contactsTable.id, localContactId),
    ))
    .orderBy(asc(schema.contactsTable.id));

  for (const sib of siblings) {
    await tx.update(schema.contactsTable)
      .set({ contactType: effType, updatedAt: new Date() })
      .where(eq(schema.contactsTable.id, sib.id));
    // Relabel whichever role rows already exist at this sibling — a no-op where
    // that role doesn't exist there yet.
    await tx.update(schema.suppliersTable)
      .set({ contactType: effType === "customer" ? "supplier" : effType })
      .where(eq(schema.suppliersTable.contactId, sib.id));
    await tx.update(schema.customerProfilesTable)
      .set({ contactType: effType === "supplier" ? "customer" : effType, updatedAt: new Date() })
      .where(eq(schema.customerProfilesTable.contactId, sib.id));

    if (effType === "customer_supplier") {
      // Ensure BOTH roles exist at the sibling too, using the sibling's OWN contact
      // fields (never the local store's — each store keeps its own contact row).
      const sibShared: ContactSharedInput = {
        name: sib.name, contactName: sib.contactName, email: sib.email,
        phone: sib.phone, address: sib.address, notes: sib.notes,
        contactType: "customer_supplier",
      };
      await ensureSupplierRole(tx, sib.storeId, sib.id, sibShared);
      // The customer role needs an email to create a login. If this sibling
      // contact has none on file, skip creating it there instead of failing the
      // whole promotion over an unrelated store's missing data — the contactType
      // label above already reflects the change everywhere, and the customer
      // role can be added later once an email is on file for that store.
      if ((sibShared.email ?? "").trim()) {
        await ensureCustomerRole(tx, sib.storeId, sib.id, sibShared);
      }
    }
  }
}

// Legacy fallback: resolves cross-store siblings via the supplier's globalSupplierId
// when no globalContactId link exists yet (accounts imported before the unified
// contact system, or never linked because the group predates a contact row),
// retrofitting a contact row + globalContactId link for each sibling — mirroring
// what the supplier import-to-stores flow already does on first import. Must run
// BEFORE propagateContactTypeToSiblings so a legacy group gets the same promotion
// fan-out as a group already linked via globalContactId. No-op when the supplier
// has no globalSupplierId.
async function linkLegacySupplierSiblings(tx: Tx, contactId: number, supplierId: number): Promise<void> {
  const [supplier] = await tx.select({ globalSupplierId: schema.suppliersTable.globalSupplierId })
    .from(schema.suppliersTable).where(eq(schema.suppliersTable.id, supplierId)).limit(1);
  if (!supplier?.globalSupplierId) return;
  // Ascending-id order for deterministic lock acquisition (deadlock safety).
  const siblingSuppliers = await tx.select()
    .from(schema.suppliersTable)
    .where(and(
      eq(schema.suppliersTable.globalSupplierId, supplier.globalSupplierId),
      ne(schema.suppliersTable.id, supplierId),
    ))
    .orderBy(asc(schema.suppliersTable.id));
  for (const sib of siblingSuppliers) {
    let sibContactId = sib.contactId;
    if (sibContactId == null) {
      const [newContact] = await tx.insert(schema.contactsTable).values({
        storeId: sib.storeId, name: sib.name, contactName: sib.contactName, email: sib.email,
        phone: sib.phone, address: sib.address, notes: sib.notes, contactType: sib.contactType,
      }).returning({ id: schema.contactsTable.id });
      sibContactId = newContact.id;
      await tx.update(schema.suppliersTable).set({ contactId: sibContactId }).where(eq(schema.suppliersTable.id, sib.id));
    }
    await linkContactsGlobally(tx, contactId, sibContactId);
  }
}

// Customer-side equivalent of linkLegacySupplierSiblings: for every sibling
// customer_profiles row linked by userId but lacking a contactId (legacy
// pre-unified-contact data), creates a contact row in that sibling store and
// calls linkContactsGlobally so propagateContactTypeToSiblings can reach it via
// the globalContactId path. No-op when all sibling profiles already have a
// contactId or when there are no sibling profiles.
async function linkLegacyCustomerSiblings(
  tx: Tx,
  contactId: number,
  userId: number,
  localStoreId: number,
): Promise<void> {
  // Ascending-id order for deterministic lock acquisition (deadlock safety).
  const siblingProfiles = await tx.select()
    .from(schema.customerProfilesTable)
    .where(and(
      eq(schema.customerProfilesTable.userId, userId),
      ne(schema.customerProfilesTable.storeId, localStoreId),
    ))
    .orderBy(asc(schema.customerProfilesTable.id));
  if (siblingProfiles.length === 0) return;
  // Read user once for the shared name/email needed when creating contact rows.
  const [u] = await tx.select().from(schema.usersTable)
    .where(eq(schema.usersTable.id, userId)).limit(1);
  if (!u) return;
  for (const sib of siblingProfiles) {
    let sibContactId = sib.contactId;
    if (sibContactId == null) {
      const [newContact] = await tx.insert(schema.contactsTable).values({
        storeId: sib.storeId, name: u.name, contactName: null, email: u.email,
        phone: u.phone ?? null, address: u.address ?? null, notes: u.notes ?? null,
        contactType: sib.contactType,
      }).returning({ id: schema.contactsTable.id });
      sibContactId = newContact.id;
      await tx.update(schema.customerProfilesTable)
        .set({ contactId: sibContactId })
        .where(eq(schema.customerProfilesTable.id, sib.id));
    }
    await linkContactsGlobally(tx, contactId, sibContactId);
  }
}

// ─── Dashboard — Général ───────────────────────────────────────────
// Single endpoint for all KPIs shown in the "Général" dashboard tab.
// Add new fields here as the tab grows (receivables, caisse balance, etc.)
// ─── Dashboard helper: resolve effective storeId (null = all stores) ─
function dashboardStoreId(req: AuthRequest): number | null {
  const rawSid = req.query["storeId"] as string | undefined;
  if (req.user?.role === "admin") {
    if (rawSid && rawSid !== "all") {
      const n = parseInt(rawSid, 10);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }
  return req.currentStoreId ?? null;
}

export type DashboardBalanceDirection = "receivable" | "payable";

/**
 * Returns one net balance per financial contact across customer and supplier
 * roles. Positive balances are owed to the store; negative balances are owed
 * by the store.
 *
 * Exported (in addition to being used by the routes below) so the standalone
 * integration test (src/test-dashboard-balances.ts) can exercise it directly
 * against scratch data without going through the HTTP/auth stack.
 */
export async function getUnifiedDashboardBalances(
  storeId: number | null,
  direction: DashboardBalanceDirection,
) {
  const customerStoreFilter = storeId !== null ? sql` AND cp.store_id = ${storeId}` : sql``;
  const supplierStoreFilter = storeId !== null ? sql` AND s.store_id = ${storeId}` : sql``;
  const contactStoreFilter = storeId !== null ? sql` AND c.store_id = ${storeId}` : sql``;
  const balanceFilter = direction === "receivable" ? sql`> 0` : sql`< 0`;
  const sortDirection = direction === "receivable" ? sql`DESC` : sql`ASC`;

  return db.execute(sql`
    WITH balance_sources AS (
      -- Customer-only contacts retain their customer-role balance.
      SELECT
        COALESCE('contact:' || c.global_contact_id, 'customer:' || u.id::text) AS identity_key,
        u.name,
        'customer'::text AS party_type,
        ROUND(CAST(cp.current_balance AS numeric), 2) AS balance
      FROM customer_profiles cp
      JOIN users u ON u.id = cp.user_id
      LEFT JOIN contacts c ON c.id = cp.contact_id
      WHERE cp.contact_type <> 'customer_supplier'
      ${customerStoreFilter}

      UNION ALL

      -- Supplier-only contacts retain their supplier-role balance.
      SELECT
        COALESCE(
          'supplier:' || s.global_supplier_id,
          'contact:' || c.global_contact_id,
          'supplier:' || s.id::text
        ) AS identity_key,
        s.name,
        'supplier'::text AS party_type,
        ROUND(CAST(s.current_balance AS numeric), 2) AS balance
      FROM suppliers s
      LEFT JOIN contacts c ON c.id = s.contact_id
      WHERE s.contact_type <> 'customer_supplier'
      ${supplierStoreFilter}

      UNION ALL

      -- A customer_supplier contact is represented once by its canonical net
      -- balance, rather than once per role.
      SELECT
        COALESCE('contact:' || c.global_contact_id, 'contact:' || c.id::text) AS identity_key,
        c.name,
        'customer_supplier'::text AS party_type,
        ROUND(CAST(c.current_balance AS numeric), 2) AS balance
      FROM contacts c
      WHERE c.contact_type = 'customer_supplier'
      ${contactStoreFilter}
    )
    SELECT identity_key AS id, name, party_type, balance
    FROM (
      SELECT DISTINCT ON (identity_key)
        identity_key, name, party_type, balance
      FROM balance_sources
      WHERE balance ${balanceFilter}
      ORDER BY identity_key, name
    ) deduped
    ORDER BY balance ${sortDirection}, name ASC
  `);
}

router.get("/erp/dashboard/general", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const storeCondition = sid !== null
      ? and(eq(schema.productsTable.storeId, sid), gt(schema.productsTable.stock, 0))
      : gt(schema.productsTable.stock, 0);
    const [{ stockValue }] = await db
      .select({
        stockValue: sql<number>`COALESCE(SUM(${schema.productsTable.stock} * CAST(${schema.productsTable.costPrice} AS numeric)), 0)`,
      })
      .from(schema.productsTable)
      .where(storeCondition);
    // Count products with stock > 0 but costPrice NULL or 0 — used for the warning badge
    const noCostCondition = sid !== null
      ? and(eq(schema.productsTable.storeId, sid), gt(schema.productsTable.stock, 0), sql`(${schema.productsTable.costPrice} IS NULL OR CAST(${schema.productsTable.costPrice} AS numeric) = 0)`)
      : and(gt(schema.productsTable.stock, 0), sql`(${schema.productsTable.costPrice} IS NULL OR CAST(${schema.productsTable.costPrice} AS numeric) = 0)`);
    const [{ productsWithoutCost }] = await db
      .select({ productsWithoutCost: sql<number>`COUNT(*)` })
      .from(schema.productsTable)
      .where(noCostCondition);
    res.json({ stockValue: Number(stockValue), productsWithoutCost: Number(productsWithoutCost) });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Employees ─────────────────────────────────────────────────────
// ─── Dashboard — Stock Detail (drill-down) ────────────────────────
router.get("/erp/dashboard/stock-detail", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const storeCondition = sid !== null
      ? and(eq(schema.productsTable.storeId, sid), gt(schema.productsTable.stock, 0))
      : gt(schema.productsTable.stock, 0);
    const rows = await db
      .select({
        id: schema.productsTable.id,
        nameEn: schema.productsTable.nameEn,
        nameAr: schema.productsTable.nameAr,
        reference: schema.productsTable.reference,
        stock: schema.productsTable.stock,
        costPrice: schema.productsTable.costPrice,
        valeur: sql<string>`COALESCE(ROUND(CAST(${schema.productsTable.stock} AS numeric) * CAST(${schema.productsTable.costPrice} AS numeric), 2), 0)`,
      })
      .from(schema.productsTable)
      .where(storeCondition)
      .orderBy(desc(sql`COALESCE(${schema.productsTable.stock} * CAST(${schema.productsTable.costPrice} AS numeric), 0)`));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Dashboard — Créances (all positive balances) ─────────────────
router.get("/erp/dashboard/client-receivables", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const result = await getUnifiedDashboardBalances(dashboardStoreId(req), "receivable");
    res.json(result.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Dashboard — Dettes (all negative balances) ───────────────────
router.get("/erp/dashboard/supplier-debts", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const result = await getUnifiedDashboardBalances(dashboardStoreId(req), "payable");
    res.json(result.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/dashboard/caisses", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    // Global caisse model: the dashboard widget shows the org-wide set
    // (the single main caisse + every user's personal caisse).
    const result = await db.execute(sql`
      SELECT c.id, c.kind, ROUND(CAST(c.balance AS numeric), 2) AS balance,
             u.name AS owner_name
      FROM caisses c
      LEFT JOIN users u ON c.owner_user_id = u.id
      ORDER BY c.kind ASC, u.name ASC
    `);
    const caisses = result.rows as { id: number; kind: string; balance: string; owner_name: string | null }[];
    const total = caisses.reduce((s, c) => s + Number(c.balance ?? 0), 0);
    res.json({ total: total.toFixed(2), caisses });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/dashboard/ventes", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const { groupBy = "jour", dateFrom, dateTo, source } = req.query as Record<string, string | undefined>;
    const fromDate = dateFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const toDate = dateTo ?? new Date().toISOString().slice(0, 10);
    const periodFmt = groupBy === "annee" ? "YYYY" : groupBy === "mois" ? "YYYY-MM" : "YYYY-MM-DD";
    const ordersStoreFilter = sid !== null ? sql` AND o.store_id = ${sid}` : sql``;
    const retoursStoreFilter = sid !== null ? sql` AND br.store_id = ${sid}` : sql``;
    const chargesStoreFilter = sid !== null ? sql` AND t.store_id = ${sid}` : sql``;
    const allowedSources = ["pos", "bon", "online"] as const;
    const sourceFilter = allowedSources.includes(source as (typeof allowedSources)[number])
      ? source === "online"
        // Mirror the safe orders-endpoint predicate: explicitly-tagged 'online' rows OR
        // legacy NULL rows that have no seller (seller-present NULLs are POS and are
        // caught by the boot backfill, but we guard here too for safety).
        ? sql` AND (o.order_source = 'online' OR (o.order_source IS NULL AND o.seller_user_id IS NULL))`
        : sql` AND o.order_source = ${source}`
      : sql``;
    // Date window mirrors Rapport mensuel exactly: BETWEEN from::timestamp AND (to::timestamp + 1 day).
    const ordersDateFilter = sql` AND o.created_at BETWEEN ${fromDate}::timestamp AND (${toDate}::timestamp + INTERVAL '1 day')`;
    const retoursDateFilter = sql` AND br.created_at BETWEEN ${fromDate}::timestamp AND (${toDate}::timestamp + INTERVAL '1 day')`;
    const chargesDateFilter = sql` AND t.created_at BETWEEN ${fromDate}::timestamp AND (${toDate}::timestamp + INTERVAL '1 day')`;

    // Dashboard profit mirrors the official P&L (Analytics / Rapport mensuel):
    //   marge          = revenue(Σ orders.total_amount) − COGS(Σ order_items.cost_price×qty)
    //   benefice (net) = marge − returned profit − operating expenses
    // CRITICAL: order-level revenue/discount are aggregated from `orders` ALONE
    // (order_rev CTE). COGS is item-level and lives in its OWN CTE (order_cogs).
    // If revenue summed over an orders⋈order_items join, a multi-line order would
    // multiply total_amount by its item count (this is what the customer/product
    // reports in orders.ts also guard against). Returns and expenses likewise sit
    // in independent CTEs so the joins never inflate them.
    // RETURNS DEDUCT LOST PROFIT, not the refunded amount: a bon retour restocks
    // the goods (stock += qty), so the item cost is recovered as inventory and only
    // the margin is lost. retours = Σ qty × (unit_price − cost), cost sourced from
    // the original order_items (the exact COGS booked) and falling back to the
    // product cost for orderless comptoir returns. Subtracting the full refund here
    // would also wipe the recovered cost and overstate losses — a fully-returned +
    // restocked sale must net to 0, not −COGS. The full cash refund is recorded
    // separately in the caisse/treasury ledger. Cash-refund RETOUR-% expense
    // transactions stay excluded from charges because each refund's profit impact
    // is already captured by this returns CTE — counting both double-deducts. All
    // CTEs bucket by the order/record created_at; the UNION of period keys keeps
    // periods that have only returns/expenses (no sales) visible with a negative net.
    const rows = await db.execute(sql`
      WITH order_rev AS (
        SELECT TO_CHAR(o.created_at, ${periodFmt}) AS period,
               SUM(CAST(o.total_amount AS numeric)) AS montant,
               SUM(CAST(o.discount_amount AS numeric)) AS reduction
        FROM orders o
        WHERE o.status NOT IN ('cancelled', 'draft')
          ${ordersDateFilter}
          ${ordersStoreFilter}
          ${sourceFilter}
        GROUP BY 1
      ),
      order_cogs AS (
        SELECT TO_CHAR(o.created_at, ${periodFmt}) AS period,
               SUM(COALESCE(CAST(oi.cost_price AS numeric), 0) * CAST(oi.quantity AS numeric)) AS cogs
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'draft')
          ${ordersDateFilter}
          ${ordersStoreFilter}
          ${sourceFilter}
        GROUP BY 1
      ),
      retours AS (
        SELECT TO_CHAR(br.created_at, ${periodFmt}) AS period,
               SUM(CAST(bri.quantity AS numeric) * (CAST(bri.unit_price AS numeric) - COALESCE(oc.cost_price, CAST(p.cost_price AS numeric), 0))) AS retours
        FROM bon_retour_items bri
        JOIN bon_retours br ON br.id = bri.bon_retour_id
        LEFT JOIN (
          SELECT order_id, product_id, MAX(CAST(cost_price AS numeric)) AS cost_price
          FROM order_items GROUP BY order_id, product_id
        ) oc ON oc.order_id = br.original_order_id AND oc.product_id = bri.product_id
        LEFT JOIN products p ON p.id = bri.product_id
        WHERE TRUE
          ${retoursDateFilter}
          ${retoursStoreFilter}
        GROUP BY 1
      ),
      charges AS (
        SELECT TO_CHAR(t.created_at, ${periodFmt}) AS period,
               SUM(CAST(t.amount AS numeric)) AS charges
        FROM transactions t
        WHERE t.type = 'expense'
          AND t.category <> 'purchase'
          AND (t.reference IS NULL OR t.reference NOT LIKE 'RETOUR-%')
          AND (t.reference IS NULL OR t.reference NOT LIKE 'PO-%')
          ${chargesDateFilter}
          ${chargesStoreFilter}
        GROUP BY 1
      ),
      periods AS (
        SELECT period FROM order_rev
        UNION SELECT period FROM order_cogs
        UNION SELECT period FROM retours
        UNION SELECT period FROM charges
      )
      SELECT
        p.period AS date,
        ROUND(COALESCE(orev.montant, 0), 2) AS montant,
        ROUND(COALESCE(orev.reduction, 0), 2) AS reduction,
        ROUND(COALESCE(orev.montant, 0) - COALESCE(ocogs.cogs, 0), 2) AS marge,
        ROUND(COALESCE(r.retours, 0), 2) AS retours,
        ROUND(COALESCE(c.charges, 0), 2) AS charges,
        ROUND(COALESCE(orev.montant, 0) - COALESCE(ocogs.cogs, 0) - COALESCE(r.retours, 0) - COALESCE(c.charges, 0), 2) AS benefice
      FROM periods p
      LEFT JOIN order_rev orev ON orev.period = p.period
      LEFT JOIN order_cogs ocogs ON ocogs.period = p.period
      LEFT JOIN retours r ON r.period = p.period
      LEFT JOIN charges c ON c.period = p.period
      ORDER BY p.period DESC
    `);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/dashboard/ventes-produits", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const { dateFrom, dateTo, source } = req.query as Record<string, string | undefined>;
    const fromDate = dateFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const toDate = dateTo ?? new Date().toISOString().slice(0, 10);
    const fromTs = `${fromDate}T00:00:00`;
    const toTs = `${toDate}T23:59:59`;
    const storeFilter = sid !== null ? sql` AND o.store_id = ${sid}` : sql``;
    const retoursStoreFilter = sid !== null ? sql` AND br.store_id = ${sid}` : sql``;
    const allowedSourcesVP = ["pos", "bon", "online"] as const;
    const vpSourceFilter = allowedSourcesVP.includes(source as (typeof allowedSourcesVP)[number])
      ? source === "online"
        ? sql` AND (o.order_source = 'online' OR (o.order_source IS NULL AND o.seller_user_id IS NULL))`
        : sql` AND o.order_source = ${source}`
      : sql``;
    const rows = await db.execute(sql`
      WITH combined AS (
        -- Sales rows (positive)
        SELECT
          'vente'::text AS row_type,
          p.id,
          COALESCE(p.name_en, p.name_ar) AS designation,
          COALESCE(pb.name_fr, p.brand, '') AS marque,
          COALESCE(pf.name_fr, '') AS famille,
          p.reference,
          p.barcode,
          p.stock,
          CAST(p.price AS text) AS price,
          CAST(p.cost_price AS text) AS cost_price_product,
          SUM(CAST(oi.quantity AS numeric)) AS qte_vendue,
          ROUND(SUM(CAST(oi.unit_price AS numeric) * CAST(oi.quantity AS numeric)) / NULLIF(SUM(CAST(oi.quantity AS numeric)), 0), 2) AS pu,
          ROUND(SUM(CAST(oi.unit_price AS numeric) * CAST(oi.quantity AS numeric)), 2) AS montant,
          ROUND(
            SUM(CAST(oi.unit_price AS numeric) * CAST(oi.quantity AS numeric))
            - SUM(COALESCE(CAST(p.cost_price AS numeric), 0) * CAST(oi.quantity AS numeric)),
          2) AS benefice
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_families pf ON pf.id = p.family_id
        LEFT JOIN product_brands pb ON pb.id = p.brand_id
        WHERE o.status NOT IN ('cancelled', 'draft')
          AND o.created_at >= ${fromTs}
          AND o.created_at <= ${toTs}
          ${storeFilter}
          ${vpSourceFilter}
        GROUP BY p.id, p.name_en, p.name_ar, pb.name_fr, p.brand, pf.name_fr,
                 p.reference, p.barcode, p.stock, p.price, p.cost_price

        UNION ALL

        -- Return rows (negative — each return subtracts from bénéfice as its own line)
        SELECT
          'retour'::text AS row_type,
          p.id,
          COALESCE(p.name_en, p.name_ar) AS designation,
          COALESCE(pb.name_fr, p.brand, '') AS marque,
          COALESCE(pf.name_fr, '') AS famille,
          p.reference,
          p.barcode,
          p.stock,
          CAST(p.price AS text) AS price,
          CAST(p.cost_price AS text) AS cost_price_product,
          -SUM(CAST(bri.quantity AS numeric)) AS qte_vendue,
          ROUND(SUM(CAST(bri.unit_price AS numeric) * CAST(bri.quantity AS numeric)) / NULLIF(SUM(CAST(bri.quantity AS numeric)), 0), 2) AS pu,
          -ROUND(SUM(CAST(bri.unit_price AS numeric) * CAST(bri.quantity AS numeric)), 2) AS montant,
          -ROUND(
            SUM(CAST(bri.unit_price AS numeric) * CAST(bri.quantity AS numeric))
            - SUM(COALESCE(CAST(p.cost_price AS numeric), 0) * CAST(bri.quantity AS numeric)),
          2) AS benefice
        FROM bon_retour_items bri
        JOIN bon_retours br ON br.id = bri.bon_retour_id
        JOIN products p ON p.id = bri.product_id
        LEFT JOIN product_families pf ON pf.id = p.family_id
        LEFT JOIN product_brands pb ON pb.id = p.brand_id
        WHERE br.created_at >= ${fromTs}
          AND br.created_at <= ${toTs}
          ${retoursStoreFilter}
        GROUP BY p.id, p.name_en, p.name_ar, pb.name_fr, p.brand, pf.name_fr,
                 p.reference, p.barcode, p.stock, p.price, p.cost_price
      ),
      vente_montant AS (
        -- Rank products by their sales montant so retour rows appear below their parent vente row
        SELECT id,
               COALESCE(MAX(CASE WHEN row_type = 'vente' THEN CAST(montant AS numeric) END), 0) AS vm
        FROM combined GROUP BY id
      )
      SELECT c.row_type, c.id, c.designation, c.marque, c.famille, c.reference, c.barcode,
             c.stock, c.price, c.cost_price_product, c.qte_vendue, c.pu, c.montant, c.benefice
      FROM combined c
      JOIN vente_montant vm ON vm.id = c.id
      ORDER BY vm.vm DESC, c.id, CASE c.row_type WHEN 'vente' THEN 0 ELSE 1 END
    `);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Permissions ────────────────────────────────────────────────────────────

// GET /erp/permissions/me — current user's own permissions (for employees)
router.get("/erp/permissions/me", authenticate, requireStore, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const rows = await db.select().from(schema.userPermissionsTable)
      .where(eq(schema.userPermissionsTable.userId, userId));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/permissions/users — admin: list all non-customer users for permissions management
router.get("/erp/permissions/users", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const users = await db
      .select({
        userId: schema.usersTable.id,
        name: schema.usersTable.name,
        email: schema.usersTable.email,
        role: schema.usersTable.role,
        position: schema.employeesTable.position,
        status: schema.employeesTable.status,
      })
      .from(schema.usersTable)
      .leftJoin(schema.employeesTable, eq(schema.employeesTable.userId, schema.usersTable.id))
      .where(ne(schema.usersTable.role, "customer"))
      .orderBy(schema.usersTable.id);
    console.log(`[permissions/users] Retrieved ${users.length} non-customer users`);
    res.json(users);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/permissions/:userId — admin: read any employee's permissions
router.get("/erp/permissions/:userId", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const userId = pid(req, "userId");
    if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }
    const rows = await db.select().from(schema.userPermissionsTable)
      .where(eq(schema.userPermissionsTable.userId, userId));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /erp/permissions/:userId — admin: bulk-upsert permissions for an employee
router.put("/erp/permissions/:userId", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const userId = pid(req, "userId");
    if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }
    const perms = req.body as { section: string; action: string; granted: boolean }[];
    if (!Array.isArray(perms) || perms.length === 0) { res.status(400).json({ error: "perms array required" }); return; }
    const VALID_SECTIONS = new Set(["dashboard", "orders", "products", "inventory", "customers", "purchases", "settings", "caisse", "suppliers", "employees", "realtime", "attendance", "leaves", "accounting", "web_store", "payroll", "alerts", "transfers"]);
    const VALID_ACTIONS = new Set([
      // base actions (all modules)
      "view", "create", "edit", "delete",
      // orders
      "close", "print", "change_payment", "edit_line_price", "view_profit", "view_sale_orders",
      // products
      "edit_price", "view_purchase_price", "expose", "manage_stock",
      "manage_images", "manage_barcodes", "duplicate", "copy_to_store", "import",
      "print_barcode", "view_history", "bulk_actions",
      // purchases
      "receive", "manage_charges", "column_settings",
      // inventory
      "count",
      // settings
      "edit_store_name", "edit_default_customer", "manage_permissions", "manage_stores",
      // customers (granular)
      "view_balance",
      // web_store
      "edit_settings", "manage_featured", "manage_orders",
    ]);
    for (const p of perms) {
      if (!VALID_SECTIONS.has(p.section) || !VALID_ACTIONS.has(p.action)) {
        res.status(400).json({ error: `Invalid section/action: ${p.section}/${p.action}` });
        return;
      }
    }
    for (const p of perms) {
      await db.execute(sql`
        INSERT INTO user_permissions (user_id, section, action, granted)
        VALUES (${userId}, ${p.section}, ${p.action}, ${p.granted})
        ON CONFLICT (user_id, section, action)
        DO UPDATE SET granted = ${p.granted}
      `);
    }
    const rows = await db.select().from(schema.userPermissionsTable)
      .where(eq(schema.userPermissionsTable.userId, userId));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Employees — unified source ─────────────────────────────────────────────
// Every employee has a user account (users.id = employees.user_id).
// The list is built from the employees table joined to users + caisses so that
// all screens (Employees page, Dashboard EmployésTab, Leaves/Attendance
// dropdowns) share the exact same source and the same row count.
router.get("/erp/employees", authenticate, requireStaff, requireStore, requirePermission("employees", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const result = await db.execute(sql`
      SELECT
        e.id,
        e.store_id        AS "storeId",
        e.user_id         AS "userId",
        e.name,
        e.email,
        e.phone,
        e.position,
        e.salary,
        e.status,
        e.hire_date       AS "hireDate",
        e.created_at      AS "createdAt",
        u.role,
        u.is_active       AS "isActive",
        COALESCE(ROUND(c.balance, 2)::text, '0.00') AS solde
      FROM employees e
      LEFT JOIN users u
        ON u.id = e.user_id
      LEFT JOIN caisses c
        ON c.owner_user_id = e.user_id
        AND c.kind         = 'staff'
      WHERE e.store_id = ${storeId}
      ORDER BY e.name
    `);
    res.json(result.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST — create employee + user account + caisse
router.post("/erp/employees", authenticate, requireStaff, requireStore, requirePermission("employees", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { name, email: rawEmail, phone, position, salary, hireDate, password, matricule, cnasNumber, bankAccount } = req.body;
    const email = rawEmail ? normalizeEmail(rawEmail) : rawEmail;
    if (!name || !position || !salary || !hireDate) {
      res.status(400).json({ error: "name, position, salary, hireDate are required" });
      return;
    }
    if (matricule) {
      const [dupe] = await db.select({ id: schema.employeesTable.id })
        .from(schema.employeesTable).where(eq(schema.employeesTable.matricule, matricule)).limit(1);
      if (dupe) { res.status(409).json({ error: "Matricule already in use" }); return; }
    }

    const result = await db.transaction(async (tx) => {
      // 1. Create user account
      let userId: number | null = null;
      if (email) {
        const existing = await tx.select({ id: schema.usersTable.id })
          .from(schema.usersTable).where(sql`lower(trim(${schema.usersTable.email})) = ${email}`).limit(1);
        if (existing.length > 0) {
          // Reuse existing user — just update role if needed
          userId = existing[0].id;
          await tx.update(schema.usersTable)
            .set({ role: "employee", isActive: true, name, phone: phone || null })
            .where(eq(schema.usersTable.id, userId));
        } else {
          const pwHash = await bcrypt.hash(password || "midanic2026", 10);
          const [u] = await tx.insert(schema.usersTable).values({
            name, email, passwordHash: pwHash,
            role: "employee", preferredLang: "ar",
            phone: phone || null, isActive: true,
          }).returning({ id: schema.usersTable.id });
          userId = u.id;
        }
        // Link user to store
        await tx.execute(sql`
          INSERT INTO user_stores (user_id, store_id)
          VALUES (${userId}, ${storeId})
          ON CONFLICT DO NOTHING
        `);
      }

      // 2. Create employee record
      const [emp] = await tx.insert(schema.employeesTable).values({
        storeId, userId: userId ?? undefined,
        name, email: email || null, phone: phone || null,
        position, salary, hireDate,
        matricule: matricule || null, cnasNumber: cnasNumber || null, bankAccount: bankAccount || null,
      }).returning();

      // 3. Ensure caisse exists for this user
      if (userId) await ensureCaisse(storeId, userId, tx);

      return emp;
    });

    // Return enriched row
    const [enriched] = await db.execute(sql`
      SELECT e.*, u.role, u.is_active AS "isActive",
             COALESCE(ROUND(c.balance,2)::text,'0.00') AS solde
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN caisses c ON c.owner_user_id=e.user_id AND c.kind='staff'
      WHERE e.id = ${result.id}
    `).then(r => r.rows);
    res.status(201).json(enriched);
  } catch (err) {
    if (isEmailUniqueViolation(err)) { res.status(409).json({ error: "Email already in use" }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// PUT — update employee + sync user account
router.put("/erp/employees/:id", authenticate, requireStaff, requireStore, requirePermission("employees", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const empId = pid(req, "id");
    const { name, email: rawEmpEmail, phone, position, salary, hireDate, status, matricule, cnasNumber, bankAccount } = req.body;
    const email = rawEmpEmail === undefined ? undefined : (rawEmpEmail ? normalizeEmail(rawEmpEmail) : rawEmpEmail);

    const [existing] = await db.select().from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.id, empId), eq(schema.employeesTable.storeId, storeId)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    if (matricule && matricule !== existing.matricule) {
      const [dupe] = await db.select({ id: schema.employeesTable.id })
        .from(schema.employeesTable)
        .where(and(eq(schema.employeesTable.matricule, matricule), ne(schema.employeesTable.id, empId)))
        .limit(1);
      if (dupe) { res.status(409).json({ error: "Matricule already in use" }); return; }
    }

    // Email change syncs to the linked user account — enforce canonical uniqueness.
    if (email && existing.userId) {
      const [dupUser] = await db.select({ id: schema.usersTable.id })
        .from(schema.usersTable)
        .where(and(sql`lower(trim(${schema.usersTable.email})) = ${email}`, ne(schema.usersTable.id, existing.userId)))
        .limit(1);
      if (dupUser) { res.status(409).json({ error: "Email already in use" }); return; }
    }

    await db.transaction(async (tx) => {
      // Update employee record
      const empUpdate: Partial<typeof schema.employeesTable.$inferInsert> = {};
      if (name     !== undefined) empUpdate.name     = name;
      if (email    !== undefined) empUpdate.email    = email;
      if (phone    !== undefined) empUpdate.phone    = phone;
      if (position !== undefined) empUpdate.position = position;
      if (salary   !== undefined) empUpdate.salary   = salary;
      if (hireDate !== undefined) empUpdate.hireDate = hireDate;
      if (status   !== undefined) empUpdate.status   = status;
      if (matricule   !== undefined) empUpdate.matricule   = matricule || null;
      if (cnasNumber  !== undefined) empUpdate.cnasNumber  = cnasNumber || null;
      if (bankAccount !== undefined) empUpdate.bankAccount = bankAccount || null;
      await tx.update(schema.employeesTable).set(empUpdate)
        .where(eq(schema.employeesTable.id, empId));

      // Sync user account if linked
      if (existing.userId) {
        const userUpdate: Record<string, unknown> = {};
        if (name  !== undefined) userUpdate.name  = name;
        if (email !== undefined) userUpdate.email = email;
        if (phone !== undefined) userUpdate.phone = phone;
        // If employee becomes inactive → block login
        if (status === "inactive" || status === "terminated") {
          userUpdate.isActive = false;
        } else if (status === "active" || status === "on_leave") {
          userUpdate.isActive = true;
        }
        if (Object.keys(userUpdate).length > 0) {
          await tx.update(schema.usersTable)
            .set(userUpdate as { name?: string; email?: string; phone?: string; isActive?: boolean })
            .where(eq(schema.usersTable.id, existing.userId));
        }
      }
    });

    const [enriched] = await db.execute(sql`
      SELECT e.*, u.role, u.is_active AS "isActive",
             COALESCE(ROUND(c.balance,2)::text,'0.00') AS solde
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN caisses c ON c.owner_user_id=e.user_id AND c.kind='staff'
      WHERE e.id = ${empId}
    `).then(r => r.rows);
    res.json(enriched);
  } catch (err) {
    if (isEmailUniqueViolation(err)) { res.status(409).json({ error: "Email already in use" }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE — set inactive + block login
router.delete("/erp/employees/:id", authenticate, requireStaff, requireStore, requirePermission("employees", "delete"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const empId = pid(req, "id");
    const [emp] = await db.select().from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.id, empId), eq(schema.employeesTable.storeId, storeId)))
      .limit(1);
    if (!emp) { res.status(404).json({ error: "Not found" }); return; }
    await db.transaction(async (tx) => {
      await tx.update(schema.employeesTable).set({ status: "inactive" })
        .where(eq(schema.employeesTable.id, empId));
      if (emp.userId) {
        await tx.update(schema.usersTable).set({ isActive: false })
          .where(eq(schema.usersTable.id, emp.userId));
      }
    });
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Attendance
router.get("/erp/attendance", authenticate, requireStaff, requireStore, requirePermission("attendance", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { employeeId } = req.query as Record<string, string>;
    const conditions = [eq(schema.attendanceTable.storeId, storeId)];
    if (employeeId) conditions.push(eq(schema.attendanceTable.employeeId, parseInt(employeeId)));
    const records = await db.select().from(schema.attendanceTable)
      .where(and(...conditions))
      .orderBy(desc(schema.attendanceTable.date));
    res.json(records);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/attendance", authenticate, requireStaff, requireStore, requirePermission("attendance", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const employeeId = Number(req.body?.employeeId);
    if (!Number.isInteger(employeeId)) {
      res.status(400).json({ error: "employeeId required" });
      return;
    }
    const [emp] = await db.select({ id: schema.employeesTable.id })
      .from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.id, employeeId), eq(schema.employeesTable.storeId, storeId)))
      .limit(1);
    if (!emp) { res.status(403).json({ error: "Employee does not belong to current store" }); return; }
    const body = { ...req.body, storeId };
    const [record] = await db.insert(schema.attendanceTable).values(body).returning();
    res.status(201).json(record);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Leaves
router.get("/erp/leaves", authenticate, requireStaff, requireStore, requirePermission("leaves", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const leaves = await db.select().from(schema.leavesTable)
      .where(eq(schema.leavesTable.storeId, storeId))
      .orderBy(desc(schema.leavesTable.createdAt));
    res.json(leaves);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/leaves", authenticate, requireStaff, requireStore, requirePermission("leaves", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const employeeId = Number(req.body?.employeeId);
    if (!Number.isInteger(employeeId)) {
      res.status(400).json({ error: "employeeId required" });
      return;
    }
    const [emp] = await db.select({ id: schema.employeesTable.id })
      .from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.id, employeeId), eq(schema.employeesTable.storeId, storeId)))
      .limit(1);
    if (!emp) { res.status(403).json({ error: "Employee does not belong to current store" }); return; }
    const body = { ...req.body, storeId };
    const [leave] = await db.insert(schema.leavesTable).values(body).returning();
    res.status(201).json(leave);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/leaves/:id/status", authenticate, requireStaff, requireStore, requirePermission("leaves", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const [leave] = await db.update(schema.leavesTable).set({ status: req.body.status })
      .where(and(eq(schema.leavesTable.id, pid(req, "id")), eq(schema.leavesTable.storeId, storeId)))
      .returning();
    if (!leave) { res.status(404).json({ error: "Not found" }); return; }
    const [employee] = await db.select({ name: schema.employeesTable.name })
      .from(schema.employeesTable).where(eq(schema.employeesTable.id, leave.employeeId)).limit(1);
    broadcastToAdmins({
      type: "leave_status_changed",
      storeId,
      status: leave.status,
      employeeName: employee?.name ?? `Employee #${leave.employeeId}`,
      leaveType: leave.type,
      startDate: leave.startDate,
      endDate: leave.endDate,
    });
    res.json(leave);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Payroll ─────────────────────────────────────────────────────────────────
// One payroll_run = one bulk generation for all active employees over an
// (admin-editable) period. Adjustments (avance/retenue/prime) are free-standing
// until a run folds them in — at that point their payslip_id is set and they
// become immutable (the period is effectively locked).

router.get("/erp/payroll/adjustments", authenticate, requireStaff, requireStore, requirePermission("payroll", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { employeeId } = req.query as Record<string, string | undefined>;
    const conditions = [eq(schema.payrollAdjustmentsTable.storeId, storeId)];
    if (employeeId) conditions.push(eq(schema.payrollAdjustmentsTable.employeeId, parseInt(employeeId)));
    const rows = await db.select({
      id: schema.payrollAdjustmentsTable.id,
      employeeId: schema.payrollAdjustmentsTable.employeeId,
      employeeName: schema.employeesTable.name,
      type: schema.payrollAdjustmentsTable.type,
      amount: schema.payrollAdjustmentsTable.amount,
      reason: schema.payrollAdjustmentsTable.reason,
      date: schema.payrollAdjustmentsTable.date,
      payslipId: schema.payrollAdjustmentsTable.payslipId,
      createdAt: schema.payrollAdjustmentsTable.createdAt,
    })
      .from(schema.payrollAdjustmentsTable)
      .leftJoin(schema.employeesTable, eq(schema.employeesTable.id, schema.payrollAdjustmentsTable.employeeId))
      .where(and(...conditions))
      .orderBy(desc(schema.payrollAdjustmentsTable.date), desc(schema.payrollAdjustmentsTable.id));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/payroll/adjustments", authenticate, requireStaff, requireStore, requirePermission("payroll", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const actorUserId = req.user!.id;
    const employeeId = Number(req.body?.employeeId);
    const type = req.body?.type as "advance" | "deduction" | "bonus";
    const amount = Number(req.body?.amount);
    const date = req.body?.date as string | undefined;
    const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
    if (!Number.isInteger(employeeId) || !["advance", "deduction", "bonus"].includes(type) ||
        !Number.isFinite(amount) || amount <= 0 || !date) {
      res.status(400).json({ error: "employeeId, type (advance|deduction|bonus), amount > 0, date are required" });
      return;
    }
    const [emp] = await db.select({ id: schema.employeesTable.id, name: schema.employeesTable.name })
      .from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.id, employeeId), eq(schema.employeesTable.storeId, storeId)))
      .limit(1);
    if (!emp) { res.status(403).json({ error: "Employee does not belong to current store" }); return; }

    // Advance and bonus are immediate cash disbursements from the main caisse.
    // Deductions are purely accounting entries that reduce the monthly net salary.
    const isCashed = type === "advance" || type === "bonus";
    const typeLabel = type === "advance" ? "Avance" : type === "bonus" ? "Prime" : "Retenue";

    const row = await db.transaction(async (tx) => {
      const [adj] = await tx.insert(schema.payrollAdjustmentsTable).values({
        storeId, employeeId, type, amount: amount.toFixed(2), reason, date,
        createdByUserId: actorUserId, isCashed,
      }).returning();

      if (isCashed) {
        const mainCaisse = await ensureCaisse(null, null, tx);
        const { oldBalance, newBalance } = await applyCaisseDelta(tx, mainCaisse.id, -amount);
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: mainCaisse.id, type: "debit", amount: amount.toFixed(2),
          reason: "salary_payment", actorUserId,
          notes: `${typeLabel} — ${emp.name}${reason ? ` (${reason})` : ""}`,
          balanceBefore: oldBalance.toFixed(2), balanceAfter: newBalance.toFixed(2),
        });
        await tx.insert(schema.transactionsTable).values({
          storeId, type: "expense", category: "salary",
          amount: amount.toFixed(2),
          description: `${typeLabel} — ${emp.name}${reason ? ` (${reason})` : ""}`,
          date, reference: `ADJ-${adj.id}`,
        });
      }

      return adj;
    });

    res.status(201).json(row);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/payroll/adjustments/:id", authenticate, requireStaff, requireStore, requirePermission("payroll", "delete"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const [row] = await db.select().from(schema.payrollAdjustmentsTable)
      .where(and(eq(schema.payrollAdjustmentsTable.id, id), eq(schema.payrollAdjustmentsTable.storeId, storeId)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (row.payslipId) { res.status(409).json({ error: "Cette période est déjà clôturée par une paie générée" }); return; }
    if (row.isCashed) { res.status(409).json({ error: "Ce paiement a déjà été versé depuis la caisse et ne peut pas être supprimé" }); return; }
    await db.delete(schema.payrollAdjustmentsTable).where(eq(schema.payrollAdjustmentsTable.id, id));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/payroll/runs", authenticate, requireStaff, requireStore, requirePermission("payroll", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const rows = await db.select({
      id: schema.payrollRunsTable.id,
      periodStart: schema.payrollRunsTable.periodStart,
      periodEnd: schema.payrollRunsTable.periodEnd,
      createdAt: schema.payrollRunsTable.createdAt,
      employeeCount: sql<number>`count(${schema.payslipsTable.id})`,
      totalNet: sql<string>`coalesce(sum(${schema.payslipsTable.netAmount}), 0)`,
    })
      .from(schema.payrollRunsTable)
      .leftJoin(schema.payslipsTable, eq(schema.payslipsTable.payrollRunId, schema.payrollRunsTable.id))
      .where(eq(schema.payrollRunsTable.storeId, storeId))
      .groupBy(schema.payrollRunsTable.id)
      .orderBy(desc(schema.payrollRunsTable.periodStart));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/payroll/payslips", authenticate, requireStaff, requireStore, requirePermission("payroll", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { runId, employeeId } = req.query as Record<string, string | undefined>;
    const conditions = [eq(schema.payslipsTable.storeId, storeId)];
    if (runId) conditions.push(eq(schema.payslipsTable.payrollRunId, parseInt(runId)));
    if (employeeId) conditions.push(eq(schema.payslipsTable.employeeId, parseInt(employeeId)));
    const rows = await db.select({
      id: schema.payslipsTable.id,
      payrollRunId: schema.payslipsTable.payrollRunId,
      employeeId: schema.payslipsTable.employeeId,
      employeeName: schema.employeesTable.name,
      matricule: schema.employeesTable.matricule,
      position: schema.employeesTable.position,
      cnasNumber: schema.employeesTable.cnasNumber,
      bankAccount: schema.employeesTable.bankAccount,
      baseSalary: schema.payslipsTable.baseSalary,
      bonusAmount: schema.payslipsTable.bonusAmount,
      advancesAmount: schema.payslipsTable.advancesAmount,
      deductionsAmount: schema.payslipsTable.deductionsAmount,
      netAmount: schema.payslipsTable.netAmount,
      periodStart: schema.payrollRunsTable.periodStart,
      periodEnd: schema.payrollRunsTable.periodEnd,
      createdAt: schema.payslipsTable.createdAt,
    })
      .from(schema.payslipsTable)
      .leftJoin(schema.employeesTable, eq(schema.employeesTable.id, schema.payslipsTable.employeeId))
      .leftJoin(schema.payrollRunsTable, eq(schema.payrollRunsTable.id, schema.payslipsTable.payrollRunId))
      .where(and(...conditions))
      .orderBy(desc(schema.payslipsTable.id));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST — generate payroll for ALL active employees over [periodStart, periodEnd]
// in one batch: folds in every not-yet-locked adjustment dated inside the
// period, produces one payslip per employee, and books a single expense
// (main caisse debit + accounting transaction) for the combined net total.
router.post("/erp/payroll/generate", authenticate, requireStaff, requireStore, requirePermission("payroll", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const actorUserId = req.user!.id;
    const periodStart = req.body?.periodStart as string | undefined;
    const periodEnd = req.body?.periodEnd as string | undefined;
    if (!periodStart || !periodEnd || periodStart > periodEnd) {
      res.status(400).json({ error: "periodStart and periodEnd (periodStart <= periodEnd) are required" });
      return;
    }
    const [existingRun] = await db.select({ id: schema.payrollRunsTable.id })
      .from(schema.payrollRunsTable)
      .where(and(
        eq(schema.payrollRunsTable.storeId, storeId),
        eq(schema.payrollRunsTable.periodStart, periodStart),
        eq(schema.payrollRunsTable.periodEnd, periodEnd),
      )).limit(1);
    if (existingRun) { res.status(409).json({ error: "Une paie a déjà été générée pour cette période exacte" }); return; }

    const employees = await db.select().from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.storeId, storeId), eq(schema.employeesTable.status, "active")));
    if (employees.length === 0) { res.status(400).json({ error: "Aucun employé actif" }); return; }

    const result = await db.transaction(async (tx) => {
      const [run] = await tx.insert(schema.payrollRunsTable).values({
        storeId, periodStart, periodEnd, generatedByUserId: actorUserId,
      }).returning();

      let totalNet = 0;
      const payslips: (typeof schema.payslipsTable.$inferSelect)[] = [];

      for (const emp of employees) {
        const adjustments = await tx.select().from(schema.payrollAdjustmentsTable)
          .where(and(
            eq(schema.payrollAdjustmentsTable.employeeId, emp.id),
            isNull(schema.payrollAdjustmentsTable.payslipId),
            sql`${schema.payrollAdjustmentsTable.date} >= ${periodStart}`,
            sql`${schema.payrollAdjustmentsTable.date} <= ${periodEnd}`,
          ));
        const sumOf = (type: "advance" | "deduction" | "bonus", cashedFilter?: boolean) =>
          adjustments
            .filter(a => a.type === type && (cashedFilter === undefined || a.isCashed === cashedFilter))
            .reduce((s, a) => s + parseFloat(a.amount), 0);
        // Only count bonuses NOT yet cashed (cashed bonuses were already debited
        // from caisse at creation time; including them again would double-count).
        const bonus = sumOf("bonus", false);
        // Advances are always deducted from net regardless of is_cashed: the advance
        // was a prepayment, so the remaining salary is salary − advance. Total caisse
        // = advance + (salary − advance) = salary ✓ — no double-count.
        const advances = sumOf("advance");
        const deductions = sumOf("deduction");
        const baseSalary = parseFloat(emp.salary);
        const netAmount = baseSalary + bonus - advances - deductions;
        totalNet += netAmount;

        const [payslip] = await tx.insert(schema.payslipsTable).values({
          payrollRunId: run.id, storeId, employeeId: emp.id,
          baseSalary: baseSalary.toFixed(2), bonusAmount: bonus.toFixed(2),
          advancesAmount: advances.toFixed(2), deductionsAmount: deductions.toFixed(2),
          netAmount: netAmount.toFixed(2),
        }).returning();
        payslips.push(payslip);

        if (adjustments.length > 0) {
          await tx.update(schema.payrollAdjustmentsTable)
            .set({ payslipId: payslip.id })
            .where(inArray(schema.payrollAdjustmentsTable.id, adjustments.map(a => a.id)));
        }
      }

      // Book the combined expense once: main caisse debit + accounting transaction.
      if (totalNet > 0) {
        const mainCaisse = await ensureCaisse(null, null, tx);
        const { oldBalance, newBalance } = await applyCaisseDelta(tx, mainCaisse.id, -totalNet);
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: mainCaisse.id, type: "debit", amount: totalNet.toFixed(2),
          reason: "salary_payment", actorUserId,
          notes: `Paie ${periodStart} → ${periodEnd} (${payslips.length} employés)`,
          balanceBefore: oldBalance.toFixed(2), balanceAfter: newBalance.toFixed(2),
        });
        await tx.insert(schema.transactionsTable).values({
          storeId, type: "expense", category: "salary",
          amount: totalNet.toFixed(2),
          description: `Paie ${periodStart} → ${periodEnd} (${payslips.length} employés)`,
          date: periodEnd, reference: `PAYROLL-${run.id}`,
        });
      }

      return { run, payslips };
    });

    res.status(201).json(result);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Suppliers ─────────────────────────────────────────────────────
// Balance mutation goes through mutateSupplierBalance / mutateCustomerBalance
// (lib/balance-sync.ts) exclusively — it applies the delta/absolute value, runs
// the legacy globalSupplierId cross-store sync, and (if the supplier is linked to
// a `contacts` row) recomputes + fans out via the unified globalContactId link.

router.get("/erp/suppliers", authenticate, requireStaff, requireStore, requirePermission("suppliers", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { page = "1", limit = "10", search } = req.query as Record<string, string | undefined>;
    const pageNum  = Math.max(1, parseInt(page  || "1")  || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit || "10") || 10));
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [eq(schema.suppliersTable.storeId, storeId)];
    if (search) conditions.push(ilike(schema.suppliersTable.name, `%${search}%`));

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.suppliersTable)
      .where(and(...conditions));

    const suppliers = await db.select().from(schema.suppliersTable)
      .where(and(...conditions))
      .orderBy(schema.suppliersTable.name)
      .limit(limitNum).offset(offset);

    const csContactIds = suppliers
      .filter((s) => s.contactType === "customer_supplier" && s.contactId != null)
      .map((s) => s.contactId!);

    if (csContactIds.length > 0) {
      const contactRows = await db.select({ id: schema.contactsTable.id, currentBalance: schema.contactsTable.currentBalance })
        .from(schema.contactsTable).where(inArray(schema.contactsTable.id, csContactIds));
      const balMap = new Map(contactRows.map((c) => [c.id, c.currentBalance]));
      res.json({
        data: suppliers.map((s) =>
          s.contactType === "customer_supplier" && s.contactId != null && balMap.has(s.contactId)
            ? { ...s, currentBalance: balMap.get(s.contactId)! }
            : s
        ),
        total: Number(count), page: pageNum, limit: limitNum,
      });
      return;
    }
    res.json({ data: suppliers, total: Number(count), page: pageNum, limit: limitNum });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/suppliers", authenticate, requireStaff, requireStore, requirePermission("suppliers", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const b = req.body || {};
    // Whitelist shared fields only — currentBalance / globalSupplierId / storeId are
    // never mass-assignable here (globalSupplierId is owned by the import-to-stores flow).
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const contactType: "supplier" | "customer_supplier" =
      b.contactType === "customer_supplier" ? "customer_supplier" : "supplier";
    const shared: ContactSharedInput = {
      name,
      contactName: b.contactName ?? null,
      email: b.email ?? null,
      phone: b.phone ?? null,
      address: b.address ?? null,
      notes: b.notes ?? null,
      contactType,
    };
    // A customer/supplier needs an email so the customer-side login can be created.
    if (contactType === "customer_supplier" && !(typeof b.email === "string" && b.email.trim())) {
      res.status(400).json({ error: "email is required for a customer/supplier contact" });
      return;
    }
    const supplier = await db.transaction(async (tx) => {
      const contactId = await insertContact(tx, storeId, shared);
      const supplierId = await ensureSupplierRole(tx, storeId, contactId, shared);
      if (contactType === "customer_supplier") {
        await ensureCustomerRole(tx, storeId, contactId, shared);
      }
      const [row] = await tx.select().from(schema.suppliersTable)
        .where(eq(schema.suppliersTable.id, supplierId)).limit(1);
      return row;
    });
    res.status(201).json(supplier);
  } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/erp/suppliers/:id", authenticate, requireStaff, requireStore, requirePermission("suppliers", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const b = req.body || {};
    const [current] = await db.select().from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, id), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!current) { res.status(404).json({ error: "Not found" }); return; }
    // Whitelist editable shared fields — never storeId / globalSupplierId / currentBalance.
    const set: Record<string, unknown> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.contactName !== undefined) set.contactName = b.contactName ?? null;
    if (b.email !== undefined) set.email = b.email ?? null;
    if (b.phone !== undefined) set.phone = b.phone ?? null;
    if (b.address !== undefined) set.address = b.address ?? null;
    if (b.notes !== undefined) set.notes = b.notes ?? null;
    const newType: "supplier" | "customer_supplier" | undefined =
      b.contactType === "customer_supplier" ? "customer_supplier"
      : b.contactType === "supplier" ? "supplier" : undefined;
    if (newType !== undefined) set.contactType = newType;

    const supplier = await db.transaction(async (tx) => {
      // Acquire the identity advisory lock FIRST — before any row writes — to
      // match the ordering guarantee of mutateSupplierBalance / mutateCustomerBalance
      // (advisory-lock → row-write, never the reverse). This prevents a deadlock
      // cycle with a concurrent mutator: PUT holds row lock then waits for advisory;
      // mutator holds advisory then waits for row lock. Advisory locks are reentrant
      // within the same transaction, so the later lockSupplierIdentity calls (after
      // legacy sibling linking establishes a fresh gcid) are safe no-ops for already-
      // held keys and add the gcid key once it exists.
      await lockSupplierIdentity(tx, id);
      const requestedType: "supplier" | "customer_supplier" =
        newType ?? (current.contactType === "customer_supplier" ? "customer_supplier" : "supplier");
      // Both directions are allowed: supplier→customer_supplier (promotion) and
      // customer_supplier→supplier (downgrade). Role rows are NEVER deleted — on
      // downgrade the customer_profiles row keeps its financial history and only its
      // contactType label is reset to "customer".
      const hasCustomerRole = current.contactId != null && (await tx.select({ userId: schema.customerProfilesTable.userId })
        .from(schema.customerProfilesTable)
        .where(eq(schema.customerProfilesTable.contactId, current.contactId)).limit(1)).length > 0;
      const effType: "supplier" | "customer_supplier" = requestedType;
      set.contactType = effType;
      await tx.update(schema.suppliersTable).set(set).where(eq(schema.suppliersTable.id, id));
      const shared: ContactSharedInput = {
        name: (set.name as string | undefined) ?? current.name,
        contactName: (set.contactName as string | null | undefined) ?? current.contactName,
        email: (set.email as string | null | undefined) ?? current.email,
        phone: (set.phone as string | null | undefined) ?? current.phone,
        address: (set.address as string | null | undefined) ?? current.address,
        notes: (set.notes as string | null | undefined) ?? current.notes,
        contactType: effType,
      };
      let contactId = current.contactId;
      if (contactId == null) {
        contactId = await insertContact(tx, storeId, shared);
        await tx.update(schema.suppliersTable).set({ contactId }).where(eq(schema.suppliersTable.id, id));
      } else {
        await updateContactFields(tx, contactId, shared);
      }
      if (effType === "customer_supplier") {
        await ensureCustomerRole(tx, storeId, contactId, shared);
      } else if (hasCustomerRole && contactId != null) {
        // Downgrade: reset the linked customer-profile label to "customer" so the
        // contact is no longer displayed as customer_supplier on the customer side.
        await tx.update(schema.customerProfilesTable)
          .set({ contactType: "customer", updatedAt: new Date() })
          .where(eq(schema.customerProfilesTable.contactId, contactId));
      }
      // The unified balance must be freshly correct the moment this contact starts
      // being displayed via it (bug: a stale/never-recomputed contacts.current_balance
      // otherwise surfaces as the balance appearing to reset to 0 right after
      // promotion). Then propagate the type change and the newly-ensured role to
      // every cross-store sibling — retrofitting a globalContactId link first for
      // suppliers only linked via the legacy globalSupplierId — and finally fan out
      // every role's balance to those (now-existing) sibling role rows.
      // linkLegacySupplierSiblings may establish a globalContactId (no balance
      // writes), so the advisory lock is taken afterward so it captures the final
      // gcid and correctly serializes all subsequent balance reads/writes against
      // concurrent mutateSupplierBalance / mutateCustomerBalance callers.
      await linkLegacySupplierSiblings(tx, contactId, id);
      await lockSupplierIdentity(tx, id);
      await recomputeContactBalance(tx, contactId);
      await propagateContactTypeToSiblings(tx, contactId, effType);
      await syncLinkedContactBalances(tx, contactId);
      const [row] = await tx.select().from(schema.suppliersTable)
        .where(eq(schema.suppliersTable.id, id)).limit(1);
      return row;
    });
    res.json(supplier);
  } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// Supplier Operations (GET unified statement + POST payment)
// For customer_supplier contacts the statement merges supplier_operations AND
// customer_operations so the ledger reflects the full net position.
// contactBalance (from contacts.current_balance) is returned so the frontend can
// display the canonical unified balance in the header.
router.get("/erp/suppliers/:id/operations", authenticate, requireStaff, requireStore, requirePermission("suppliers", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const supplierId = pid(req, "id");
    const [supplier] = await db.select().from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

    // Phase 2: balances are store-scoped — statement shows only this store's operations.
    const supplierRows = await db.select({
      op: schema.supplierOperationsTable,
      storeNameAr: schema.storesTable.nameAr,
      storeNameEn: schema.storesTable.nameEn,
    })
      .from(schema.supplierOperationsTable)
      .leftJoin(schema.storesTable, eq(schema.supplierOperationsTable.storeId, schema.storesTable.id))
      .where(eq(schema.supplierOperationsTable.supplierId, supplierId))
      .orderBy(asc(schema.supplierOperationsTable.date), asc(schema.supplierOperationsTable.createdAt));

    // Unified delta: positive = contact owes us more (or our debt decreases).
    // Supplier: purchase → −amount (we owe more). payment/ajustement → +amount.
    // Customer: vente_a_terme/remboursement → +amount. versement/avoir_retour → −amount.
    const unifiedDelta = (source: "supplier" | "customer", type: string, amount: number): number => {
      if (source === "supplier") return type === "purchase" ? -amount : amount;
      return (type === "versement" || type === "avoir_retour") ? -amount : amount;
    };

    type MergedEntry = {
      id: number; date: string; type: string; amount: string | null;
      reference: string | null; note: string | null;
      storeNameAr: string | null; storeNameEn: string | null;
      source: "supplier" | "customer"; createdAt: Date | string | null;
      // Real per-role balance snapshot captured at write time (via mutateSupplierBalance/
      // mutateCustomerBalance), NOT the unified contact balance — see the columns'
      // definition on their own tables. NULL for rows created before these columns
      // existed; never guessed/backfilled here.
      balanceBefore: string | null; balanceAfter: string | null;
      runningBalance: string;
    };

    let contactBalance: string | null = null;

    // Check if the supplier is linked to a customer_supplier contact.
    if (supplier.contactId) {
      const [contact] = await db.select({
        contactType: schema.contactsTable.contactType,
        currentBalance: schema.contactsTable.currentBalance,
      }).from(schema.contactsTable).where(eq(schema.contactsTable.id, supplier.contactId)).limit(1);

      if (contact?.contactType === "customer_supplier") {
        // Read canonical unified balance directly from contacts.current_balance.
        contactBalance = contact.currentBalance ?? null;

        const contactIds = [supplier.contactId];

        // Customer user IDs linked to this contact (per-store, no cross-store).
        const cpRows = await db.select({ userId: schema.customerProfilesTable.userId })
          .from(schema.customerProfilesTable)
          .where(inArray(schema.customerProfilesTable.contactId, contactIds));
        const customerUserIds = [...new Set(cpRows.map((r) => r.userId))];

        type RawEntry = Omit<MergedEntry, "runningBalance">;
        const allRaw: RawEntry[] = [];

        // Supplier side
        for (const { op, storeNameAr, storeNameEn } of supplierRows) {
          allRaw.push({ id: op.id, date: op.date, type: op.type, amount: op.amount,
            reference: op.reference ?? null, note: op.note ?? null,
            storeNameAr: storeNameAr ?? null, storeNameEn: storeNameEn ?? null,
            source: "supplier", createdAt: op.createdAt,
            balanceBefore: op.balanceBefore ?? null, balanceAfter: op.balanceAfter ?? null });
        }

        // Customer side
        if (customerUserIds.length > 0) {
          const custOpRows = await db.select({
            op: schema.customerOperationsTable,
            storeNameAr: schema.storesTable.nameAr,
            storeNameEn: schema.storesTable.nameEn,
          })
            .from(schema.customerOperationsTable)
            .leftJoin(schema.storesTable, eq(schema.customerOperationsTable.storeId, schema.storesTable.id))
            .where(inArray(schema.customerOperationsTable.customerId, customerUserIds));
          for (const { op, storeNameAr, storeNameEn } of custOpRows) {
            allRaw.push({ id: op.id, date: op.date, type: op.type, amount: op.amount,
              reference: op.reference ?? null, note: op.note ?? null,
              storeNameAr: storeNameAr ?? null, storeNameEn: storeNameEn ?? null,
              source: "customer", createdAt: op.createdAt,
              balanceBefore: op.balanceBefore ?? null, balanceAfter: op.balanceAfter ?? null });
          }
        }

        allRaw.sort((a, b) => {
          const d = a.date.localeCompare(b.date);
          if (d !== 0) return d;
          const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt ?? 0).getTime();
          const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt ?? 0).getTime();
          return ta - tb;
        });

        let running = 0;
        const opsWithBalance: MergedEntry[] = allRaw.map((op) => {
          running += unifiedDelta(op.source, op.type, parseFloat(op.amount ?? "0"));
          return { ...op, runningBalance: running.toFixed(2) };
        });

        res.json({ supplier, operations: opsWithBalance, contactBalance });
        return;
      }
    }

    // Pure supplier (no customer_supplier contact): original sign convention
    // (positive running balance = store owes the supplier).
    let running = 0;
    const opsWithBalance = supplierRows.map(({ op, storeNameAr, storeNameEn }) => {
      const amt = parseFloat(op.amount ?? "0");
      if (op.type === "purchase") running += amt;
      else running -= amt;
      return { ...op, storeNameAr, storeNameEn, runningBalance: running.toFixed(2), source: "supplier" as const };
    });
    res.json({ supplier, operations: opsWithBalance, contactBalance: null });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Import (link) a supplier into other stores — establishes a shared global account.
// All linked records share one globalSupplierId + one synced balance.
router.post("/erp/suppliers/:id/import-to-stores", authenticate, requireStaff, requireStore, requirePermission("suppliers", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const supplierId = pid(req, "id");
    const { targetStoreIds } = req.body as { targetStoreIds?: unknown };

    if (!Array.isArray(targetStoreIds) || targetStoreIds.length === 0) {
      res.status(400).json({ error: "targetStoreIds must be a non-empty array" });
      return;
    }
    const tidArr = [...new Set((targetStoreIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n !== storeId))];
    if (tidArr.length === 0) {
      res.status(400).json({ error: "No valid target stores (cannot import into the same store)" });
      return;
    }

    const [src] = await db.select().from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!src) { res.status(404).json({ error: "Supplier not found" }); return; }

    // Authorization: a user may only import into stores they are a member of.
    const memberships = await db.select({ storeId: schema.userStoresTable.storeId })
      .from(schema.userStoresTable)
      .where(eq(schema.userStoresTable.userId, req.user!.id));
    const accessibleStoreIds = new Set(memberships.map((m) => m.storeId));

    type ImportResult = {
      targetStoreId: number;
      status: "created" | "linked_existing" | "already_linked" | "conflict" | "error";
      supplierId?: number;
      message?: string;
    };
    const results: ImportResult[] = [];

    const globalSupplierId = await db.transaction(async (tx) => {
      // Lock the source row so concurrent first-imports can't generate split groups.
      const [srcLocked] = await tx.select().from(schema.suppliersTable)
        .where(eq(schema.suppliersTable.id, src.id)).for("update").limit(1);

      // Generate a shared id on first import; reuse it on subsequent imports.
      let gsid = srcLocked.globalSupplierId;
      if (!gsid) {
        gsid = randomUUID();
        await tx.update(schema.suppliersTable)
          .set({ globalSupplierId: gsid })
          .where(eq(schema.suppliersTable.id, srcLocked.id));
      }
      // Copy source balance so all linked stores start with the same shared balance.
      const sharedBalance = srcLocked.currentBalance ?? "0.00";

      // Load source contact identity (for copying fields into the target store contact)
      let srcContact: typeof schema.contactsTable.$inferSelect | undefined;
      if (srcLocked.contactId != null) {
        const [c] = await tx.select().from(schema.contactsTable)
          .where(eq(schema.contactsTable.id, srcLocked.contactId)).limit(1);
        srcContact = c;
      }

      for (const targetStoreId of tidArr) {
        if (!accessibleStoreIds.has(targetStoreId)) {
          results.push({ targetStoreId, status: "error", message: "You do not have access to this store" });
          continue;
        }
        const [store] = await tx.select({ id: schema.storesTable.id })
          .from(schema.storesTable)
          .where(and(eq(schema.storesTable.id, targetStoreId), eq(schema.storesTable.isActive, true)))
          .limit(1);
        if (!store) { results.push({ targetStoreId, status: "error", message: "Store not found or inactive" }); continue; }

        // Already part of this global group in the target store?
        const [alreadyLinked] = await tx.select({ id: schema.suppliersTable.id })
          .from(schema.suppliersTable)
          .where(and(eq(schema.suppliersTable.storeId, targetStoreId), eq(schema.suppliersTable.globalSupplierId, gsid)))
          .limit(1);
        if (alreadyLinked) { results.push({ targetStoreId, status: "already_linked", supplierId: alreadyLinked.id }); continue; }

        // A same-name supplier already exists in the target store.
        const [existingByName] = await tx.select().from(schema.suppliersTable)
          .where(and(eq(schema.suppliersTable.storeId, targetStoreId), eq(schema.suppliersTable.name, src.name)))
          .limit(1);

        let targetSupplierId: number;
        if (existingByName) {
          if (existingByName.globalSupplierId && existingByName.globalSupplierId !== gsid) {
            // Linked to a different global group — refuse to silently merge.
            results.push({ targetStoreId, status: "conflict", supplierId: existingByName.id, message: "Same-name supplier already linked to another global account" });
            continue;
          }
          // Link first; the shared balance itself is set below via
          // mutateSupplierBalance so it goes through the centralized mutator
          // (lock + legacy sync + contact recompute/fan-out) instead of a raw write.
          await tx.update(schema.suppliersTable)
            .set({ globalSupplierId: gsid })
            .where(eq(schema.suppliersTable.id, existingByName.id));
          results.push({ targetStoreId, status: "linked_existing", supplierId: existingByName.id });
          targetSupplierId = existingByName.id;
        } else {
          // Create a fresh linked supplier (starts at 0; the shared balance is set
          // below via mutateSupplierBalance once globalSupplierId is in place).
          const [created] = await tx.insert(schema.suppliersTable).values({
            storeId: targetStoreId,
            name: src.name,
            contactName: src.contactName,
            email: src.email,
            phone: src.phone,
            address: src.address,
            notes: src.notes,
            globalSupplierId: gsid,
          }).returning();
          results.push({ targetStoreId, status: "created", supplierId: created.id });
          targetSupplierId = created.id;
        }
        // Establish the shared starting balance through the centralized mutator —
        // covers legacy globalSupplierId fan-out immediately, before the contact
        // link (below) exists yet.
        await mutateSupplierBalance(tx, targetSupplierId, { absolute: parseFloat(sharedBalance) });

        // ── Ensure the target supplier has a contact, then link it to the source
        // contact's globalContactId. This is the fix for the known gap: it makes
        // the supplier-side import ALSO establish the same cross-store identity
        // link the customer side uses, so a customer_supplier's two roles can
        // never drift apart again once either side is imported.
        if (srcContact) {
          const [targetRow] = await tx.select({ contactId: schema.suppliersTable.contactId })
            .from(schema.suppliersTable)
            .where(eq(schema.suppliersTable.id, targetSupplierId))
            .limit(1);

          let targetContactId = targetRow?.contactId ?? null;
          if (targetContactId == null) {
            const [newContact] = await tx.insert(schema.contactsTable).values({
              storeId: targetStoreId,
              name: srcContact.name,
              contactName: srcContact.contactName,
              email: srcContact.email,
              phone: srcContact.phone,
              address: srcContact.address,
              notes: srcContact.notes,
              contactType: srcContact.contactType,
            }).returning({ id: schema.contactsTable.id });
            await tx.update(schema.suppliersTable)
              .set({ contactId: newContact.id })
              .where(eq(schema.suppliersTable.id, targetSupplierId));
            targetContactId = newContact.id;
          }

          await linkContactsGlobally(tx, srcContact.id, targetContactId);
          // Recompute this target contact's unified balance from its own roles
          // (supplier balance just set + any existing customer balance).
          // Do NOT fan out yet — the source contact's customer balance is the
          // authoritative value and must not be overwritten by a freshly-created
          // target whose customer_profile starts at 0.
          await recomputeContactBalance(tx, targetContactId);
        }
      }

      // Fan out ONCE from the source contact after all target stores are set up.
      // This copies the source's correct customer balance (and supplier balance) to
      // every newly-linked sibling, without the source being overwritten by a
      // zero-initialised target inside the loop.
      if (srcContact) await syncLinkedContactBalances(tx, srcContact.id);

      return gsid;
    });

    res.json({ globalSupplierId, results });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/suppliers/:id/operations", authenticate, requireStaff, requireStore, requirePermission("suppliers", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const actorUserId = req.user!.id;
    const supplierId = pid(req, "id");
    const { amount, date, reference, note, poId } = req.body;

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) { res.status(400).json({ error: "amount must be a positive number" }); return; }
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "date is required (YYYY-MM-DD)" }); return; }

    const [supplier] = await db.select().from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

    // Validate poId if provided — must belong to this supplier + store
    let resolvedPoId: number | null = null;
    if (poId) {
      const parsedPoId = Number(poId);
      if (!Number.isInteger(parsedPoId)) { res.status(400).json({ error: "poId must be an integer" }); return; }
      const [po] = await db.select({ id: schema.purchaseOrdersTable.id })
        .from(schema.purchaseOrdersTable)
        .where(and(
          eq(schema.purchaseOrdersTable.id, parsedPoId),
          eq(schema.purchaseOrdersTable.supplierId, supplierId),
          eq(schema.purchaseOrdersTable.storeId, storeId),
        )).limit(1);
      if (!po) { res.status(400).json({ error: "Purchase order not found or does not belong to this supplier" }); return; }
      resolvedPoId = parsedPoId;
    }

    const amtFixed = parsedAmount.toFixed(2);

    const { op, caisseId } = await db.transaction(async (tx) => {
      // Global model: the payment auto-debits the acting user's personal caisse.
      const payingCaisse = await ensureCaisse(null, actorUserId, tx);

      // Payment increases balance (reduces debt): Solde = Versements - Achats
      const { oldBalance: supOld, newBalance: supNew } = await mutateSupplierBalance(tx, supplierId, { delta: parsedAmount });

      // Record supplier operation — optionally linked to a specific PO
      const [operation] = await tx.insert(schema.supplierOperationsTable).values({
        supplierId,
        storeId,
        type: "payment",
        amount: amtFixed,
        date,
        reference: reference ?? undefined,
        note: note ?? undefined,
        caisseId: payingCaisse.id,
        balanceBefore: supOld.toFixed(2),
        balanceAfter: supNew.toFixed(2),
        ...(resolvedPoId !== null ? { poId: resolvedPoId } : {}),
      }).returning();

      // Debit the actor's caisse
      const { oldBalance: caisseOld, newBalance: caisseNew } = await applyCaisseDelta(tx, payingCaisse.id, -parseFloat(amtFixed));

      await tx.insert(schema.caisseMovementsTable).values({
        caisseId: payingCaisse.id,
        type: "debit",
        amount: amtFixed,
        reason: "supplier_payment",
        supplierOperationId: operation.id,
        actorUserId,
        notes: `Règlement fournisseur: ${supplier.name}${note ? ` — ${note}` : ""}`,
        balanceBefore: caisseOld.toFixed(2),
        balanceAfter: caisseNew.toFixed(2),
      });

      return { op: operation, caisseId: payingCaisse.id };
    });

    await broadcastCaisseChanged(storeId, [caisseId]);
    res.status(201).json(op);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Supplier Balance Adjustment
router.post("/erp/suppliers/:id/adjust", authenticate, requireStaff, requireStore, requirePermission("suppliers", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const supplierId = pid(req, "id");
    const { targetBalance, date, note } = req.body;

    const parsedTarget = parseFloat(targetBalance);
    if (!Number.isFinite(parsedTarget)) { res.status(400).json({ error: "targetBalance must be a finite number" }); return; }
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "date is required (YYYY-MM-DD)" }); return; }

    const [supplierCheck] = await db.select({ id: schema.suppliersTable.id }).from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!supplierCheck) { res.status(404).json({ error: "Supplier not found" }); return; }

    const op = await db.transaction(async (tx) => {
      // Take the SAME identity-scoped advisory lock mutateSupplierBalance itself
      // acquires (rather than an explicit row lock) for the whole
      // read-compute-write, so two concurrent adjustments can't both compute
      // their delta off the same stale "old balance" and drift the result away
      // from the last-submitted target. Using the shared advisory lock instead
      // of SELECT ... FOR UPDATE keeps lock acquisition order identical to every
      // other balance-mutating call site — an explicit row lock taken before
      // this call would invert that order and open a deadlock window against
      // concurrent mutateSupplierBalance callers on the same identity.
      await lockSupplierIdentity(tx, supplierId);
      const [supplier] = await tx.select().from(schema.suppliersTable)
        .where(eq(schema.suppliersTable.id, supplierId));

      // "Old balance" must be the value actually shown to the user, i.e. what
      // GET /erp/suppliers returns: the unified contact balance (supplier role +
      // customer role) for customer_supplier contacts, or the plain supplier
      // balance otherwise. Computing the delta against the raw supplier-role
      // balance instead (while the UI displays the unified one) makes the
      // resulting unified balance diverge from the target the user typed.
      let oldBalance = parseFloat(supplier.currentBalance ?? "0");
      if (supplier.contactType === "customer_supplier" && supplier.contactId != null) {
        const [contact] = await tx.select({ currentBalance: schema.contactsTable.currentBalance })
          .from(schema.contactsTable).where(eq(schema.contactsTable.id, supplier.contactId));
        if (contact) oldBalance = parseFloat(contact.currentBalance ?? "0");
      }

      const newBalanceFixed = parsedTarget.toFixed(2);
      const deltaNum = parsedTarget - oldBalance;
      const delta = deltaNum.toFixed(2);
      const autoNote = `Ancien: ${oldBalance.toFixed(2)} DA → Nouveau: ${newBalanceFixed} DA${note ? ` — ${note}` : ""}`;

      // Apply the delta (not an absolute set) to the supplier role only, so the
      // resulting unified balance = oldBalance(displayed) + delta = target.
      await mutateSupplierBalance(tx, supplierId, { delta: deltaNum });

      const [operation] = await tx.insert(schema.supplierOperationsTable).values({
        supplierId,
        storeId,
        type: "ajustement",
        amount: delta,
        date,
        note: autoNote,
        actorUserId: req.user!.id,
        // The displayed "ancien/nouveau solde" for an adjustment must match the
        // unified balance shown to the user (see oldBalance computation above),
        // not the raw supplier-role balance mutateSupplierBalance operates on.
        balanceBefore: oldBalance.toFixed(2),
        balanceAfter: newBalanceFixed,
      }).returning();

      return operation;
    });

    res.status(201).json(op);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Purchase Orders
/**
 * Recalculate CUMP for a product across all received purchase orders in a store,
 * including any annexe charge allocations distributed to individual purchase items.
 * Call inside a transaction after any change that affects charge lines or item costs.
 */
async function recalcProductCump(tx: DbLike, productId: number, storeId: number) {
  const [cumpRow] = await (tx as typeof db)
    .select({
      cump: sql<string>`ROUND(
        SUM(
          ${schema.purchaseItemsTable.quantity} * CAST(${schema.purchaseItemsTable.unitCost} AS numeric)
          + COALESCE((
              SELECT SUM(CAST(cl.allocated_amount AS numeric))
              FROM purchase_annexe_charge_lines cl
              WHERE cl.purchase_item_id = ${schema.purchaseItemsTable.id}
            ), 0)
        )
        / NULLIF(SUM(${schema.purchaseItemsTable.quantity}), 0),
      2)`,
    })
    .from(schema.purchaseItemsTable)
    .innerJoin(
      schema.purchaseOrdersTable,
      eq(schema.purchaseItemsTable.purchaseOrderId, schema.purchaseOrdersTable.id),
    )
    .where(and(
      eq(schema.purchaseItemsTable.productId, productId),
      eq(schema.purchaseOrdersTable.storeId, storeId),
      eq(schema.purchaseOrdersTable.status, "received"),
    ));
  if (cumpRow?.cump != null) {
    await (tx as typeof db).update(schema.productsTable)
      .set({ costPrice: String(cumpRow.cump) })
      .where(eq(schema.productsTable.id, productId));
  }
}

router.get("/erp/purchase-orders", authenticate, requireStaff, requireStore, requirePermission("purchases", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { page = "1", limit = "10", status } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 10));
    const offset   = (pageNum - 1) * limitNum;

    const baseWhere = status
      ? and(eq(schema.purchaseOrdersTable.storeId, storeId), eq(schema.purchaseOrdersTable.status, status))
      : eq(schema.purchaseOrdersTable.storeId, storeId);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.purchaseOrdersTable)
      .where(baseWhere);

    const pos = await db.select().from(schema.purchaseOrdersTable)
      .where(baseWhere)
      .orderBy(desc(schema.purchaseOrdersTable.createdAt))
      .limit(limitNum).offset(offset);

    res.json({ data: pos, total: Number(count), page: pageNum, limit: limitNum });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/purchase-orders", authenticate, requireStaff, requireStore, requirePermission("purchases", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { supplierId, items, notes, paymentMethod: pmRaw, receiptImageUrl } = req.body;
    const paymentMethod = pmRaw === "comptant" ? "comptant" : "a_terme";
    // Verify supplier belongs to this store
    const [sup] = await db.select({ id: schema.suppliersTable.id }).from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!sup) { res.status(400).json({ error: "Supplier not found in this store" }); return; }
    // Verify every productId belongs to this store before inserting items
    for (const item of (items || [])) {
      const [prod] = await db.select({ id: schema.productsTable.id }).from(schema.productsTable)
        .where(and(eq(schema.productsTable.id, item.productId), eq(schema.productsTable.storeId, storeId))).limit(1);
      if (!prod) { res.status(400).json({ error: `Product ${item.productId} not found in this store` }); return; }
    }
    let total = 0;
    for (const item of (items || [])) { total += item.quantity * item.unitCost; }
    const [po] = await db.insert(schema.purchaseOrdersTable).values({
      storeId, supplierId, notes, paymentMethod, totalAmount: total.toFixed(2),
      receiptImageUrl: receiptImageUrl || null,
    }).returning();
    for (const item of (items || [])) {
      await db.insert(schema.purchaseItemsTable).values({ purchaseOrderId: po.id, ...item });
    }
    res.status(201).json(po);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/purchase-orders/:id/items", authenticate, requireStaff, requireStore, requirePermission("purchases", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const poId = pid(req, "id");
    // Make sure the PO belongs to this store
    const [po] = await db.select({ id: schema.purchaseOrdersTable.id }).from(schema.purchaseOrdersTable)
      .where(and(eq(schema.purchaseOrdersTable.id, poId), eq(schema.purchaseOrdersTable.storeId, storeId))).limit(1);
    if (!po) { res.status(404).json({ error: "Not found" }); return; }
    const items = await db.select({
      id: schema.purchaseItemsTable.id,
      purchaseOrderId: schema.purchaseItemsTable.purchaseOrderId,
      productId: schema.purchaseItemsTable.productId,
      quantity: schema.purchaseItemsTable.quantity,
      unitCost: schema.purchaseItemsTable.unitCost,
      productNameEn: schema.productsTable.nameEn,
      productNameAr: schema.productsTable.nameAr,
      // Sum of all annexe charge allocations for this item across all charge records
      totalCharges: sql<string>`COALESCE((
        SELECT SUM(CAST(cl.allocated_amount AS numeric))
        FROM purchase_annexe_charge_lines cl
        WHERE cl.purchase_item_id = ${schema.purchaseItemsTable.id}
      ), '0')`,
    })
      .from(schema.purchaseItemsTable)
      // Only join product names when the product belongs to current store
      .leftJoin(schema.productsTable,
        and(
          eq(schema.productsTable.id, schema.purchaseItemsTable.productId),
          eq(schema.productsTable.storeId, storeId),
        ))
      .where(eq(schema.purchaseItemsTable.purchaseOrderId, poId));
    res.json(items);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/purchase-orders/:id", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const poId = pid(req, "id");

    const [existing] = await db.select({ status: schema.purchaseOrdersTable.status })
      .from(schema.purchaseOrdersTable)
      .where(and(eq(schema.purchaseOrdersTable.id, poId), eq(schema.purchaseOrdersTable.storeId, storeId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Purchase order not found" }); return; }
    if (existing.status !== "pending") {
      res.status(409).json({ error: `Cannot delete a purchase order with status "${existing.status}"` }); return;
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.purchaseItemsTable)
        .where(eq(schema.purchaseItemsTable.purchaseOrderId, poId));
      await tx.delete(schema.purchaseOrdersTable)
        .where(and(eq(schema.purchaseOrdersTable.id, poId), eq(schema.purchaseOrdersTable.storeId, storeId)));
    });

    res.status(204).send();
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /erp/purchase-orders/:id — update a pending purchase order (header + items)
router.put("/erp/purchase-orders/:id", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const poId = pid(req, "id");
    const { supplierId, items, notes, paymentMethod: pmRaw, receiptImageUrl } = req.body;
    const paymentMethod = pmRaw === "comptant" ? "comptant" : "a_terme";

    const [existing] = await db.select({ status: schema.purchaseOrdersTable.status })
      .from(schema.purchaseOrdersTable)
      .where(and(eq(schema.purchaseOrdersTable.id, poId), eq(schema.purchaseOrdersTable.storeId, storeId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Purchase order not found" }); return; }
    if (existing.status !== "pending") {
      res.status(409).json({ error: `Cannot edit a purchase order with status "${existing.status}"` }); return;
    }

    // Verify supplier belongs to this store
    const [sup] = await db.select({ id: schema.suppliersTable.id }).from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!sup) { res.status(400).json({ error: "Supplier not found in this store" }); return; }

    // Verify every productId belongs to this store
    for (const item of (items || [])) {
      const [prod] = await db.select({ id: schema.productsTable.id }).from(schema.productsTable)
        .where(and(eq(schema.productsTable.id, item.productId), eq(schema.productsTable.storeId, storeId))).limit(1);
      if (!prod) { res.status(400).json({ error: `Product ${item.productId} not found in this store` }); return; }
    }

    let total = 0;
    for (const item of (items || [])) { total += item.quantity * item.unitCost; }

    const [po] = await db.transaction(async (tx) => {
      const [updated] = await tx.update(schema.purchaseOrdersTable)
        .set({ supplierId, notes, paymentMethod, totalAmount: total.toFixed(2), receiptImageUrl: receiptImageUrl ?? undefined })
        .where(and(eq(schema.purchaseOrdersTable.id, poId), eq(schema.purchaseOrdersTable.storeId, storeId)))
        .returning();
      await tx.delete(schema.purchaseItemsTable).where(eq(schema.purchaseItemsTable.purchaseOrderId, poId));
      for (const item of (items || [])) {
        await tx.insert(schema.purchaseItemsTable).values({ purchaseOrderId: poId, ...item });
      }
      return [updated];
    });

    res.json(po);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/purchase-orders/:id/receive", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const actorUserId = req.user!.id;
    const poId = pid(req, "id");
    let comptantCaisseId: number | null = null;

    const result = await db.transaction(async (tx) => {
      // Guard: only transition pending → received (idempotency guard)
      const [po] = await tx.update(schema.purchaseOrdersTable)
        .set({ status: "received", receivedAt: new Date() })
        .where(and(
          eq(schema.purchaseOrdersTable.id, poId),
          eq(schema.purchaseOrdersTable.storeId, storeId),
          eq(schema.purchaseOrdersTable.status, "pending"),
        ))
        .returning();

      if (!po) return null;

      const items = await tx.select().from(schema.purchaseItemsTable)
        .where(eq(schema.purchaseItemsTable.purchaseOrderId, poId));

      for (const item of items) {
        const [product] = await tx.select().from(schema.productsTable)
          .where(and(eq(schema.productsTable.id, item.productId), eq(schema.productsTable.storeId, storeId))).limit(1);
        if (product) {
          // Update stock
          await tx.update(schema.productsTable).set({ stock: product.stock + item.quantity }).where(eq(schema.productsTable.id, item.productId));
          await tx.insert(schema.inventoryMovementsTable).values({
            storeId,
            productId: item.productId, type: "in", quantity: item.quantity,
            reason: "Purchase Order", reference: `PO-${poId}`,
          });

          // Recalculate CUMP (Coût Unitaire Moyen Pondéré) across ALL received POs for this product.
          // The current PO is already marked 'received' above, so it is included in this query.
          // Annexe charge allocations (frais de transport, douanes…) are included via a correlated
          // subquery so that effective unit cost = unitCost + (total_charges / qty) per item.
          await recalcProductCump(tx, item.productId, storeId);
        }
      }

      const totalAmount = parseFloat(po.totalAmount ?? "0");
      const today = new Date().toISOString().slice(0, 10);

      // À terme only: purchase creates a supplier debt (Comptant = paid immediately, no debt)
      if (po.paymentMethod !== "comptant") {
        const { oldBalance: poSupOld, newBalance: poSupNew } = await mutateSupplierBalance(tx, po.supplierId, { delta: -totalAmount });

        await tx.insert(schema.supplierOperationsTable).values({
          supplierId: po.supplierId,
          storeId,
          type: "purchase",
          amount: totalAmount.toFixed(2),
          date: today,
          reference: `PO-${poId}`,
          note: po.notes ?? undefined,
          poId,
          balanceBefore: poSupOld.toFixed(2),
          balanceAfter: poSupNew.toFixed(2),
        });
      }

      // Achat comptant: auto-debit the acting user's personal caisse immediately.
      // No supplier balance change here (paid in full now, no debt) — the supplier
      // operation row has no balanceBefore/After since nothing was mutated; the
      // caisse side below still captures its own snapshot.
      if (po.paymentMethod === "comptant" && totalAmount > 0) {
        const payingCaisse = await ensureCaisse(null, actorUserId, tx);

        const [supplierOp] = await tx.insert(schema.supplierOperationsTable).values({
          supplierId: po.supplierId,
          storeId,
          type: "purchase_comptant",
          amount: totalAmount.toFixed(2),
          date: today,
          reference: `PO-${poId}`,
          poId,
        }).returning();

        const { oldBalance: comptantCaisseOld, newBalance: comptantCaisseNew } = await applyCaisseDelta(tx, payingCaisse.id, -totalAmount);

        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: payingCaisse.id,
          type: "debit",
          amount: totalAmount.toFixed(2),
          reason: "purchase_payment",
          supplierOperationId: supplierOp.id,
          actorUserId,
          notes: `Achat comptant BCA N°${poId}`,
          balanceBefore: comptantCaisseOld.toFixed(2),
          balanceAfter: comptantCaisseNew.toFixed(2),
        });

        comptantCaisseId = payingCaisse.id;
      }

      // NOTE: purchasing goods is an inventory asset acquisition, NOT an operating
      // expense. No transaction is inserted here. Profit is recognised at the point
      // of sale via order_items.cost_price (COGS), not at the point of purchase.

      return po;
    });

    if (!result) {
      // Distinguish "not found in store" from "already received/cancelled"
      const [existing] = await db.select({ status: schema.purchaseOrdersTable.status })
        .from(schema.purchaseOrdersTable)
        .where(and(eq(schema.purchaseOrdersTable.id, poId), eq(schema.purchaseOrdersTable.storeId, storeId)))
        .limit(1);
      if (!existing) { res.status(404).json({ error: "Purchase order not found" }); return; }
      res.status(409).json({ error: `Purchase order is already ${existing.status}` }); return;
    }

    const [supplier] = await db.select({ name: schema.suppliersTable.name })
      .from(schema.suppliersTable).where(eq(schema.suppliersTable.id, result.supplierId)).limit(1);
    broadcastToAdmins({
      type: "purchase_received",
      storeId,
      purchaseOrderId: poId,
      supplierName: supplier?.name ?? `Supplier #${result.supplierId}`,
      totalAmount: result.totalAmount,
    });
    if (comptantCaisseId !== null) {
      await broadcastCaisseChanged(storeId, [comptantCaisseId]);
    }
    res.json(result);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Purchase Annexe Charges ─────────────────────────────────────────────────

// GET /erp/purchase-annexe-charges — list all charges for this store with linked bon IDs
router.get("/erp/purchase-annexe-charges", authenticate, requireStaff, requireStore, requirePermission("purchases", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const charges = await db.select().from(schema.purchaseAnnexeChargesTable)
      .where(eq(schema.purchaseAnnexeChargesTable.storeId, storeId))
      .orderBy(desc(schema.purchaseAnnexeChargesTable.createdAt));
    const result = await Promise.all(charges.map(async (c) => {
      const orders = await db.select({ purchaseOrderId: schema.purchaseAnnexeChargeOrdersTable.purchaseOrderId })
        .from(schema.purchaseAnnexeChargeOrdersTable)
        .where(eq(schema.purchaseAnnexeChargeOrdersTable.chargeId, c.id));
      return { ...c, purchaseOrderIds: orders.map(o => o.purchaseOrderId) };
    }));
    res.json(result);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/purchase-annexe-charges — create charge and distribute proportionally across all items in selected bons
router.post("/erp/purchase-annexe-charges", authenticate, requireStaff, requireStore, requirePermission("purchases", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { description, totalAmount: rawAmount, date: rawDate, notes, purchaseOrderIds } = req.body;

    if (!description?.trim()) { res.status(400).json({ error: "Description is required" }); return; }
    const totalAmount = parseFloat(rawAmount);
    if (isNaN(totalAmount) || totalAmount <= 0) { res.status(400).json({ error: "totalAmount must be > 0" }); return; }
    if (!Array.isArray(purchaseOrderIds) || purchaseOrderIds.length === 0) {
      res.status(400).json({ error: "purchaseOrderIds must be a non-empty array" }); return;
    }

    // Verify all bons belong to this store
    const bons = await db.select({ id: schema.purchaseOrdersTable.id, status: schema.purchaseOrdersTable.status })
      .from(schema.purchaseOrdersTable)
      .where(and(inArray(schema.purchaseOrdersTable.id, purchaseOrderIds), eq(schema.purchaseOrdersTable.storeId, storeId)));
    if (bons.length !== purchaseOrderIds.length) {
      res.status(400).json({ error: "One or more purchase orders not found in this store" }); return;
    }

    // Get all purchase items for the selected bons
    const items = await db.select({
      id: schema.purchaseItemsTable.id,
      purchaseOrderId: schema.purchaseItemsTable.purchaseOrderId,
      productId: schema.purchaseItemsTable.productId,
      quantity: schema.purchaseItemsTable.quantity,
      unitCost: schema.purchaseItemsTable.unitCost,
    }).from(schema.purchaseItemsTable)
      .where(inArray(schema.purchaseItemsTable.purchaseOrderId, purchaseOrderIds));
    if (items.length === 0) { res.status(400).json({ error: "Selected purchase orders have no items" }); return; }

    // Total line value = denominator for proportional distribution
    const totalValue = items.reduce((s, it) => s + parseFloat(it.unitCost) * it.quantity, 0);
    if (totalValue === 0) { res.status(400).json({ error: "Total value of items is zero — cannot distribute charges" }); return; }

    const actorUserId = req.user!.id;

    const result = await db.transaction(async (tx) => {
      const today = rawDate ?? new Date().toISOString().slice(0, 10);
      const [charge] = await tx.insert(schema.purchaseAnnexeChargesTable).values({
        storeId, description: description.trim(), totalAmount: totalAmount.toFixed(2), date: today,
        notes: notes?.trim() || null,
      }).returning();

      // Link charge to selected bons
      await tx.insert(schema.purchaseAnnexeChargeOrdersTable).values(
        purchaseOrderIds.map((poId: number) => ({ chargeId: charge.id, purchaseOrderId: poId }))
      );

      // Distribute charge proportionally: allocation_i = (value_i / total_value) × totalAmount
      for (const item of items) {
        const itemValue = parseFloat(item.unitCost) * item.quantity;
        const allocated = (itemValue / totalValue) * totalAmount;
        await tx.insert(schema.purchaseAnnexeChargeLinesTable).values({
          chargeId: charge.id, purchaseItemId: item.id, purchaseOrderId: item.purchaseOrderId,
          productId: item.productId, allocatedAmount: allocated.toFixed(2),
        });
      }

      // Recalculate CUMP for products that appear in received bons only
      const receivedBonIds = new Set(bons.filter(b => b.status === "received").map(b => b.id));
      if (receivedBonIds.size > 0) {
        const affectedProductIds = [...new Set(
          items.filter(it => receivedBonIds.has(it.purchaseOrderId)).map(it => it.productId)
        )];
        for (const productId of affectedProductIds) {
          await recalcProductCump(tx, productId, storeId);
        }
      }

      // Debit the acting user's caisse for the charge amount
      const payingCaisse = await ensureCaisse(null, actorUserId, tx);
      const { oldBalance: caisseOld, newBalance: caisseNew } = await applyCaisseDelta(tx, payingCaisse.id, -totalAmount);
      await tx.insert(schema.caisseMovementsTable).values({
        caisseId: payingCaisse.id,
        type: "debit",
        amount: totalAmount.toFixed(2),
        reason: "purchase_payment",
        actorUserId,
        notes: `Charge annexe: ${description.trim()}`,
        balanceBefore: caisseOld.toFixed(2),
        balanceAfter: caisseNew.toFixed(2),
      });

      return charge;
    });

    res.status(201).json(result);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// DELETE /erp/purchase-annexe-charges/:id — delete charge and revert CUMP for affected received bons
router.delete("/erp/purchase-annexe-charges/:id", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const chargeId = pid(req, "id");

    const [charge] = await db.select({ id: schema.purchaseAnnexeChargesTable.id })
      .from(schema.purchaseAnnexeChargesTable)
      .where(and(eq(schema.purchaseAnnexeChargesTable.id, chargeId), eq(schema.purchaseAnnexeChargesTable.storeId, storeId)))
      .limit(1);
    if (!charge) { res.status(404).json({ error: "Charge not found" }); return; }

    // Capture affected products + received bons BEFORE deleting
    const lines = await db.select({ productId: schema.purchaseAnnexeChargeLinesTable.productId, purchaseOrderId: schema.purchaseAnnexeChargeLinesTable.purchaseOrderId })
      .from(schema.purchaseAnnexeChargeLinesTable).where(eq(schema.purchaseAnnexeChargeLinesTable.chargeId, chargeId));
    const poIds = [...new Set(lines.map(l => l.purchaseOrderId))];
    const receivedPOs = poIds.length > 0
      ? await db.select({ id: schema.purchaseOrdersTable.id }).from(schema.purchaseOrdersTable)
        .where(and(inArray(schema.purchaseOrdersTable.id, poIds), eq(schema.purchaseOrdersTable.status, "received")))
      : [];
    const receivedPoIds = new Set(receivedPOs.map(p => p.id));
    const affectedProductIds = [...new Set(lines.filter(l => receivedPoIds.has(l.purchaseOrderId)).map(l => l.productId))];

    await db.transaction(async (tx) => {
      // CASCADE on charge_id deletes charge_orders + charge_lines automatically
      await tx.delete(schema.purchaseAnnexeChargesTable)
        .where(and(eq(schema.purchaseAnnexeChargesTable.id, chargeId), eq(schema.purchaseAnnexeChargesTable.storeId, storeId)));
      // Recalculate CUMP now that this charge's allocations are gone
      for (const productId of affectedProductIds) {
        await recalcProductCump(tx, productId, storeId);
      }
    });

    res.status(204).send();
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Product History ───────────────────────────────────────────────
router.get("/erp/products/:productId/history", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const productId = pid(req, "productId");

    // ── Accessible stores + peer products (shared by all history sections) ──
    // 1. Stores this admin can access (membership-based; respects permissions).
    const storeRows = await db.select({ storeId: schema.userStoresTable.storeId })
      .from(schema.userStoresTable)
      .where(eq(schema.userStoresTable.userId, req.user!.id));
    const accessibleStoreIds = Array.from(new Set<number>([...storeRows.map(r => r.storeId), storeId]));

    // 2. Resolve peer product IDs (same physical product across stores).
    //    Layer A — explicit transfer links; Layer B — barcode/reference fallback.
    const linkRows = await db.select({
      sourceProductId: schema.stockTransferItemsTable.sourceProductId,
      destinationProductId: schema.stockTransferItemsTable.destinationProductId,
    })
      .from(schema.stockTransferItemsTable)
      .where(or(
        eq(schema.stockTransferItemsTable.sourceProductId, productId),
        eq(schema.stockTransferItemsTable.destinationProductId, productId),
      ));
    const productIdSet = new Set<number>([productId]);
    for (const l of linkRows) {
      productIdSet.add(l.sourceProductId);
      if (l.destinationProductId != null) productIdSet.add(l.destinationProductId);
    }
    const [thisProduct] = await db.select({
      reference: schema.productsTable.reference,
      barcode: schema.productsTable.barcode,
    }).from(schema.productsTable).where(eq(schema.productsTable.id, productId)).limit(1);
    const matchClauses = [];
    if (thisProduct?.reference) matchClauses.push(eq(schema.productsTable.reference, thisProduct.reference));
    if (thisProduct?.barcode) matchClauses.push(eq(schema.productsTable.barcode, thisProduct.barcode));
    if (matchClauses.length > 0) {
      const matched = await db.select({ id: schema.productsTable.id })
        .from(schema.productsTable)
        .where(and(or(...matchClauses), inArray(schema.productsTable.storeId, accessibleStoreIds)));
      for (const m of matched) productIdSet.add(m.id);
    }
    const allProductIds = Array.from(productIdSet);

    // ── Purchase history (all accessible stores + peer products) ──
    const purchases = await db.select({
      purchaseOrderId: schema.purchaseItemsTable.purchaseOrderId,
      quantity: schema.purchaseItemsTable.quantity,
      unitCost: schema.purchaseItemsTable.unitCost,
      status: schema.purchaseOrdersTable.status,
      createdAt: schema.purchaseOrdersTable.createdAt,
      receivedAt: schema.purchaseOrdersTable.receivedAt,
      supplierName: schema.suppliersTable.name,
      storeId: schema.purchaseOrdersTable.storeId,
      storeNameAr: schema.storesTable.nameAr,
      storeNameEn: schema.storesTable.nameEn,
    })
      .from(schema.purchaseItemsTable)
      .innerJoin(schema.purchaseOrdersTable, and(
        eq(schema.purchaseItemsTable.purchaseOrderId, schema.purchaseOrdersTable.id),
        inArray(schema.purchaseOrdersTable.storeId, accessibleStoreIds),
      ))
      .leftJoin(schema.suppliersTable, eq(schema.purchaseOrdersTable.supplierId, schema.suppliersTable.id))
      .leftJoin(schema.storesTable, eq(schema.purchaseOrdersTable.storeId, schema.storesTable.id))
      .where(inArray(schema.purchaseItemsTable.productId, allProductIds))
      .orderBy(desc(schema.purchaseOrdersTable.createdAt));

    // ── Sales history (all accessible stores + peer products) ──
    const sales = await db.select({
      orderId: schema.orderItemsTable.orderId,
      quantity: schema.orderItemsTable.quantity,
      unitPrice: schema.orderItemsTable.unitPrice,
      customerName: schema.ordersTable.customerName,
      customerPhone: schema.ordersTable.customerPhone,
      status: schema.ordersTable.status,
      createdAt: schema.ordersTable.createdAt,
      storeId: schema.ordersTable.storeId,
      storeNameAr: schema.storesTable.nameAr,
      storeNameEn: schema.storesTable.nameEn,
    })
      .from(schema.orderItemsTable)
      .innerJoin(schema.ordersTable, and(
        eq(schema.orderItemsTable.orderId, schema.ordersTable.id),
        inArray(schema.ordersTable.storeId, accessibleStoreIds),
      ))
      .leftJoin(schema.storesTable, eq(schema.ordersTable.storeId, schema.storesTable.id))
      .where(inArray(schema.orderItemsTable.productId, allProductIds))
      .orderBy(desc(schema.ordersTable.createdAt));

    // 3. Inventory movements (exclude transfer rows — those come from transfer
    //    events below, to avoid double-counting the receive-time stock move).
    const movements = await db.select({
      id: schema.inventoryMovementsTable.id,
      storeId: schema.inventoryMovementsTable.storeId,
      type: schema.inventoryMovementsTable.type,
      quantity: schema.inventoryMovementsTable.quantity,
      reason: schema.inventoryMovementsTable.reason,
      reference: schema.inventoryMovementsTable.reference,
      createdAt: schema.inventoryMovementsTable.createdAt,
    })
      .from(schema.inventoryMovementsTable)
      .where(and(
        inArray(schema.inventoryMovementsTable.productId, allProductIds),
        inArray(schema.inventoryMovementsTable.storeId, accessibleStoreIds),
        or(
          isNull(schema.inventoryMovementsTable.reference),
          notLike(schema.inventoryMovementsTable.reference, "TR-%"),
        ),
      ))
      .orderBy(desc(schema.inventoryMovementsTable.createdAt));

    // 4. Transfer events (full lifecycle of every transfer involving this product).
    const transferRows = await db.select({
      eventId: schema.stockTransferEventsTable.id,
      transferId: schema.stockTransfersTable.id,
      status: schema.stockTransferEventsTable.status,
      createdAt: schema.stockTransferEventsTable.createdAt,
      sourceStoreId: schema.stockTransfersTable.sourceStoreId,
      destinationStoreId: schema.stockTransfersTable.destinationStoreId,
      quantity: schema.stockTransferItemsTable.quantity,
    })
      .from(schema.stockTransferEventsTable)
      .innerJoin(schema.stockTransfersTable, eq(schema.stockTransferEventsTable.transferId, schema.stockTransfersTable.id))
      .innerJoin(schema.stockTransferItemsTable, and(
        eq(schema.stockTransferItemsTable.transferId, schema.stockTransfersTable.id),
        or(
          inArray(schema.stockTransferItemsTable.sourceProductId, allProductIds),
          inArray(schema.stockTransferItemsTable.destinationProductId, allProductIds),
        ),
      ))
      .where(or(
        inArray(schema.stockTransfersTable.sourceStoreId, accessibleStoreIds),
        inArray(schema.stockTransfersTable.destinationStoreId, accessibleStoreIds),
      ))
      .orderBy(desc(schema.stockTransferEventsTable.createdAt));

    // 5a. Supplier returns (bon_retour_fournisseur) for the product across accessible stores.
    const supplierReturnRows = await db.select({
      id: schema.bonRetourFournisseurItemsTable.id,
      bonRetourFournisseurId: schema.bonRetourFournisseurItemsTable.bonRetourFournisseurId,
      quantity: schema.bonRetourFournisseurItemsTable.quantity,
      unitCost: schema.bonRetourFournisseurItemsTable.unitCost,
      createdAt: schema.bonRetourFournisseurTable.createdAt,
      reason: schema.bonRetourFournisseurTable.reason,
      originalPurchaseOrderId: schema.bonRetourFournisseurTable.originalPurchaseOrderId,
      supplierName: schema.suppliersTable.name,
    })
      .from(schema.bonRetourFournisseurItemsTable)
      .innerJoin(schema.bonRetourFournisseurTable, and(
        eq(schema.bonRetourFournisseurItemsTable.bonRetourFournisseurId, schema.bonRetourFournisseurTable.id),
        inArray(schema.bonRetourFournisseurTable.storeId, accessibleStoreIds),
      ))
      .leftJoin(schema.suppliersTable, eq(schema.bonRetourFournisseurTable.supplierId, schema.suppliersTable.id))
      .where(inArray(schema.bonRetourFournisseurItemsTable.productId, allProductIds))
      .orderBy(desc(schema.bonRetourFournisseurTable.createdAt));

    const supplierReturns = supplierReturnRows.map(r => ({
      id: r.id,
      bonRetourFournisseurId: r.bonRetourFournisseurId,
      date: r.createdAt,
      supplierName: r.supplierName ?? null,
      originalPurchaseOrderId: r.originalPurchaseOrderId ?? null,
      reason: r.reason ?? null,
      quantity: r.quantity,
      unitCost: r.unitCost,
    }));

    // 5b. Client returns (bon_retour_items → bon_retours) for the product across accessible stores.
    const returnRows = await db.select({
      id: schema.bonRetourItemsTable.id,
      bonRetourId: schema.bonRetourItemsTable.bonRetourId,
      quantity: schema.bonRetourItemsTable.quantity,
      unitPrice: schema.bonRetourItemsTable.unitPrice,
      createdAt: schema.bonRetoursTable.createdAt,
      retourType: schema.bonRetoursTable.retourType,
      reason: schema.bonRetoursTable.reason,
      clientName: schema.bonRetoursTable.clientName,
      originalOrderId: schema.bonRetoursTable.originalOrderId,
      orderCustomerName: schema.ordersTable.customerName,
    })
      .from(schema.bonRetourItemsTable)
      .innerJoin(schema.bonRetoursTable, and(
        eq(schema.bonRetourItemsTable.bonRetourId, schema.bonRetoursTable.id),
        inArray(schema.bonRetoursTable.storeId, accessibleStoreIds),
      ))
      .leftJoin(schema.ordersTable, eq(schema.bonRetoursTable.originalOrderId, schema.ordersTable.id))
      .where(inArray(schema.bonRetourItemsTable.productId, allProductIds))
      .orderBy(desc(schema.bonRetoursTable.createdAt));

    const returns = returnRows.map(r => ({
      id: r.id,
      bonRetourId: r.bonRetourId,
      date: r.createdAt,
      customerName: r.clientName ?? r.orderCustomerName ?? null,
      originalOrderId: r.originalOrderId ?? null,
      retourType: r.retourType ?? null,
      reason: r.reason ?? null,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
    }));

    // 6. Batch-resolve store names for movements + transfers.
    const storeIdSet = new Set<number>();
    for (const m of movements) storeIdSet.add(m.storeId);
    for (const t of transferRows) { storeIdSet.add(t.sourceStoreId); storeIdSet.add(t.destinationStoreId); }
    const storeList = storeIdSet.size > 0
      ? await db.select({ id: schema.storesTable.id, nameAr: schema.storesTable.nameAr, nameEn: schema.storesTable.nameEn })
          .from(schema.storesTable).where(inArray(schema.storesTable.id, Array.from(storeIdSet)))
      : [];
    const storeMap = new Map(storeList.map(s => [s.id, s]));

    // 7. Merge into a single chronological timeline (newest first).
    const timeline = [
      ...movements.map(m => ({
        kind: "movement" as const,
        id: `movement-${m.id}`,
        date: m.createdAt,
        movementType: m.type,
        quantity: m.quantity,
        reason: m.reason,
        reference: m.reference,
        storeId: m.storeId,
        storeNameAr: storeMap.get(m.storeId)?.nameAr ?? null,
        storeNameEn: storeMap.get(m.storeId)?.nameEn ?? null,
      })),
      ...transferRows.map(t => ({
        kind: "transfer" as const,
        id: `transfer-${t.eventId}`,
        date: t.createdAt,
        status: t.status,
        transferId: t.transferId,
        quantity: t.quantity,
        sourceStoreId: t.sourceStoreId,
        sourceStoreNameAr: storeMap.get(t.sourceStoreId)?.nameAr ?? null,
        sourceStoreNameEn: storeMap.get(t.sourceStoreId)?.nameEn ?? null,
        destStoreId: t.destinationStoreId,
        destStoreNameAr: storeMap.get(t.destinationStoreId)?.nameAr ?? null,
        destStoreNameEn: storeMap.get(t.destinationStoreId)?.nameEn ?? null,
      })),
    ].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });

    res.json({ purchases, sales, timeline, returns, supplierReturns, currentStoreId: storeId });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Inventory ─────────────────────────────────────────────────────
router.get("/erp/inventory/stock", authenticate, requireStaff, requireStore, requirePermission("inventory", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const products = await db.select({
      id: schema.productsTable.id,
      nameEn: schema.productsTable.nameEn,
      nameAr: schema.productsTable.nameAr,
      stock: schema.productsTable.stock,
    }).from(schema.productsTable)
      .where(eq(schema.productsTable.storeId, storeId))
      .orderBy(schema.productsTable.stock);

    const result = products.map((p) => ({
      ...p,
      status: p.stock <= 3 ? "critical" : p.stock <= 10 ? "low" : "ok",
    }));

    res.json(result);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/inventory", authenticate, requireStaff, requireStore, requirePermission("inventory", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const movements = await db.select({
      id: schema.inventoryMovementsTable.id,
      type: schema.inventoryMovementsTable.type,
      quantity: schema.inventoryMovementsTable.quantity,
      reason: schema.inventoryMovementsTable.reason,
      reference: schema.inventoryMovementsTable.reference,
      createdAt: schema.inventoryMovementsTable.createdAt,
      productId: schema.inventoryMovementsTable.productId,
      product: { id: schema.productsTable.id, nameAr: schema.productsTable.nameAr, nameEn: schema.productsTable.nameEn },
    })
      .from(schema.inventoryMovementsTable)
      .leftJoin(schema.productsTable, eq(schema.inventoryMovementsTable.productId, schema.productsTable.id))
      .where(eq(schema.inventoryMovementsTable.storeId, storeId))
      .orderBy(desc(schema.inventoryMovementsTable.createdAt))
      .limit(100);
    res.json(movements);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/inventory/adjust", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { productId, quantity, reason } = req.body;
    const [product] = await db.select().from(schema.productsTable)
      .where(and(eq(schema.productsTable.id, productId), eq(schema.productsTable.storeId, storeId))).limit(1);
    if (!product) { res.status(404).json({ error: "Product not found in this store" }); return; }
    const newStock = product.stock + quantity;
    if (newStock < 0) {
      res.status(400).json({ error: `Adjustment would result in negative stock (${newStock}). Current stock: ${product.stock}.` });
      return;
    }
    await db.update(schema.productsTable).set({ stock: newStock })
      .where(eq(schema.productsTable.id, productId));
    const [mv] = await db.insert(schema.inventoryMovementsTable).values({
      storeId, productId, type: "adjustment", quantity, reason, userId: req.user!.id,
    }).returning();
    res.json(mv);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Inventory Physical Count (jrd) ─────────────────────────────────
// List past + in-progress count sessions for the current store, newest first.
router.get("/erp/inventory/count-sessions", authenticate, requireStaff, requireStore, requirePermission("inventory", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const sessions = await db.select({
      id: schema.inventoryCountSessionsTable.id,
      status: schema.inventoryCountSessionsTable.status,
      notes: schema.inventoryCountSessionsTable.notes,
      createdAt: schema.inventoryCountSessionsTable.createdAt,
      completedAt: schema.inventoryCountSessionsTable.completedAt,
      createdByName: schema.usersTable.name,
    })
      .from(schema.inventoryCountSessionsTable)
      .leftJoin(schema.usersTable, eq(schema.inventoryCountSessionsTable.createdByUserId, schema.usersTable.id))
      .where(eq(schema.inventoryCountSessionsTable.storeId, storeId))
      .orderBy(desc(schema.inventoryCountSessionsTable.createdAt));

    if (sessions.length === 0) { res.json([]); return; }

    const sessionIds = sessions.map((s) => s.id);
    const itemStats = await db.select({
      sessionId: schema.inventoryCountItemsTable.sessionId,
      itemCount: sql<number>`count(*)::int`,
      countedCount: sql<number>`count(*) filter (where ${schema.inventoryCountItemsTable.countedQuantity} is not null)::int`,
      totalVariance: sql<number>`coalesce(sum(abs(${schema.inventoryCountItemsTable.countedQuantity} - ${schema.inventoryCountItemsTable.systemQuantity})) filter (where ${schema.inventoryCountItemsTable.countedQuantity} is not null), 0)`,
    })
      .from(schema.inventoryCountItemsTable)
      .where(inArray(schema.inventoryCountItemsTable.sessionId, sessionIds))
      .groupBy(schema.inventoryCountItemsTable.sessionId);
    const statsMap = new Map(itemStats.map((s) => [s.sessionId, s]));

    res.json(sessions.map((s) => ({
      ...s,
      itemCount: statsMap.get(s.id)?.itemCount ?? 0,
      countedCount: statsMap.get(s.id)?.countedCount ?? 0,
      totalVariance: statsMap.get(s.id)?.totalVariance ?? 0,
    })));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Start a new count session — snapshots current stock for every product in the store.
router.post("/erp/inventory/count-sessions", authenticate, requireStaff, requireStore, requirePermission("inventory", "count"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { notes } = req.body ?? {};

    const [existingOpen] = await db.select({ id: schema.inventoryCountSessionsTable.id })
      .from(schema.inventoryCountSessionsTable)
      .where(and(eq(schema.inventoryCountSessionsTable.storeId, storeId), eq(schema.inventoryCountSessionsTable.status, "open")))
      .limit(1);
    if (existingOpen) {
      res.status(409).json({ error: "Une session de comptage est déjà en cours pour ce magasin.", sessionId: existingOpen.id });
      return;
    }

    const session = await db.transaction(async (tx) => {
      const [session] = await tx.insert(schema.inventoryCountSessionsTable).values({
        storeId, notes: notes || null, createdByUserId: req.user!.id,
      }).returning();

      const products = await tx.select({ id: schema.productsTable.id, stock: schema.productsTable.stock })
        .from(schema.productsTable)
        .where(eq(schema.productsTable.storeId, storeId));

      if (products.length > 0) {
        await tx.insert(schema.inventoryCountItemsTable).values(
          products.map((p) => ({ sessionId: session.id, productId: p.id, systemQuantity: p.stock }))
        );
      }
      return session;
    });

    res.status(201).json(session);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Session detail with all count lines (product names + live difference).
router.get("/erp/inventory/count-sessions/:id", authenticate, requireStaff, requireStore, requirePermission("inventory", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const sessionId = pid(req, "id");
    const [session] = await db.select().from(schema.inventoryCountSessionsTable)
      .where(and(eq(schema.inventoryCountSessionsTable.id, sessionId), eq(schema.inventoryCountSessionsTable.storeId, storeId))).limit(1);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }

    const items = await db.select({
      id: schema.inventoryCountItemsTable.id,
      productId: schema.inventoryCountItemsTable.productId,
      systemQuantity: schema.inventoryCountItemsTable.systemQuantity,
      countedQuantity: schema.inventoryCountItemsTable.countedQuantity,
      nameEn: schema.productsTable.nameEn,
      nameAr: schema.productsTable.nameAr,
      familyId: schema.productsTable.familyId,
      brandId: schema.productsTable.brandId,
    })
      .from(schema.inventoryCountItemsTable)
      .innerJoin(schema.productsTable, eq(schema.inventoryCountItemsTable.productId, schema.productsTable.id))
      .where(eq(schema.inventoryCountItemsTable.sessionId, sessionId))
      .orderBy(asc(schema.productsTable.nameEn));

    res.json({
      ...session,
      items: items.map((it) => ({
        ...it,
        difference: it.countedQuantity == null ? null : it.countedQuantity - it.systemQuantity,
      })),
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Families & brands for the current store — powers the family/marque filter dropdowns
// in the physical count screen. Gated on inventory:view (same as the session detail
// endpoint above) rather than settings:view, since any staff counting stock should be
// able to filter without needing settings access.
router.get("/erp/inventory/filter-options", authenticate, requireStaff, requireStore, requirePermission("inventory", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const [families, brands] = await Promise.all([
      db.select({ id: schema.productFamiliesTable.id, nameFr: schema.productFamiliesTable.nameFr, nameAr: schema.productFamiliesTable.nameAr })
        .from(schema.productFamiliesTable)
        .where(eq(schema.productFamiliesTable.storeId, storeId))
        .orderBy(schema.productFamiliesTable.nameFr),
      db.select({ id: schema.productBrandsTable.id, nameFr: schema.productBrandsTable.nameFr, nameAr: schema.productBrandsTable.nameAr })
        .from(schema.productBrandsTable)
        .where(eq(schema.productBrandsTable.storeId, storeId))
        .orderBy(schema.productBrandsTable.nameFr),
    ]);
    res.json({ families, brands });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Enter/update the counted quantity for one product line of an open session.
router.patch("/erp/inventory/count-sessions/:id/items/:itemId", authenticate, requireStaff, requireStore, requirePermission("inventory", "count"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const sessionId = pid(req, "id");
    const itemId = pid(req, "itemId");
    const { countedQuantity } = req.body ?? {};
    if (countedQuantity === undefined || countedQuantity === null || isNaN(Number(countedQuantity))) {
      res.status(400).json({ error: "countedQuantity is required" });
      return;
    }
    if (Number(countedQuantity) < 0) {
      res.status(400).json({ error: "countedQuantity cannot be negative" });
      return;
    }

    const [session] = await db.select().from(schema.inventoryCountSessionsTable)
      .where(and(eq(schema.inventoryCountSessionsTable.id, sessionId), eq(schema.inventoryCountSessionsTable.storeId, storeId))).limit(1);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    if (session.status !== "open") { res.status(400).json({ error: "Cette session de comptage est déjà clôturée." }); return; }

    const [updated] = await db.update(schema.inventoryCountItemsTable)
      .set({ countedQuantity: Number(countedQuantity) })
      .where(and(eq(schema.inventoryCountItemsTable.id, itemId), eq(schema.inventoryCountItemsTable.sessionId, sessionId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Item not found" }); return; }

    res.json({ ...updated, difference: updated.countedQuantity! - updated.systemQuantity });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Validate the session: apply stock adjustments for every counted line whose
// count differs from the system quantity, record traceable movements, lock it.
router.post("/erp/inventory/count-sessions/:id/complete", authenticate, requireStaff, requireStore, requirePermission("inventory", "count"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const sessionId = pid(req, "id");
    const [session] = await db.select().from(schema.inventoryCountSessionsTable)
      .where(and(eq(schema.inventoryCountSessionsTable.id, sessionId), eq(schema.inventoryCountSessionsTable.storeId, storeId))).limit(1);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    if (session.status !== "open") { res.status(400).json({ error: "Cette session de comptage est déjà clôturée." }); return; }

    const result = await db.transaction(async (tx) => {
      const items = await tx.select().from(schema.inventoryCountItemsTable)
        .where(eq(schema.inventoryCountItemsTable.sessionId, sessionId));

      let adjustedCount = 0;
      for (const item of items) {
        if (item.countedQuantity == null) continue;
        const diff = item.countedQuantity - item.systemQuantity;
        if (diff === 0) continue;

        const [product] = await tx.select({ id: schema.productsTable.id, stock: schema.productsTable.stock })
          .from(schema.productsTable).where(eq(schema.productsTable.id, item.productId)).limit(1);
        if (!product) continue;

        // Re-derive the real delta against the CURRENT stock (may have moved
        // since the session started via sales/purchases) but land exactly on
        // the physically counted quantity — that's the whole point of a jrd.
        const realDelta = item.countedQuantity - product.stock;
        if (realDelta !== 0) {
          await tx.update(schema.productsTable).set({ stock: item.countedQuantity })
            .where(eq(schema.productsTable.id, item.productId));
          await tx.insert(schema.inventoryMovementsTable).values({
            storeId, productId: item.productId, type: "adjustment", quantity: realDelta,
            reason: "Jrd physique — régularisation d'écart", reference: `COUNT-${sessionId}`,
            userId: req.user!.id,
          });
        }
        adjustedCount++;
      }

      const [completed] = await tx.update(schema.inventoryCountSessionsTable)
        .set({ status: "completed", completedByUserId: req.user!.id, completedAt: new Date() })
        .where(eq(schema.inventoryCountSessionsTable.id, sessionId))
        .returning();
      return { completed, adjustedCount };
    });

    res.json(result.completed);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Reopen a completed count session for further editing.
// Fails if another session is already open for this store.
router.patch("/erp/inventory/count-sessions/:id/reopen", authenticate, requireStaff, requireStore, requirePermission("inventory", "count"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const sessionId = pid(req, "id");

    const [session] = await db.select().from(schema.inventoryCountSessionsTable)
      .where(and(eq(schema.inventoryCountSessionsTable.id, sessionId), eq(schema.inventoryCountSessionsTable.storeId, storeId))).limit(1);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    if (session.status === "open") { res.status(400).json({ error: "Cette session est déjà ouverte." }); return; }

    // Refuse if another session is already open (only one active session per store)
    const [existingOpen] = await db.select({ id: schema.inventoryCountSessionsTable.id })
      .from(schema.inventoryCountSessionsTable)
      .where(and(eq(schema.inventoryCountSessionsTable.storeId, storeId), eq(schema.inventoryCountSessionsTable.status, "open")))
      .limit(1);
    if (existingOpen) {
      res.status(409).json({ error: "Une session de comptage est déjà en cours pour ce magasin." });
      return;
    }

    const [updated] = await db.update(schema.inventoryCountSessionsTable)
      .set({ status: "open", completedAt: null, completedByUserId: null })
      .where(eq(schema.inventoryCountSessionsTable.id, sessionId))
      .returning();

    res.json(updated);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Accounting ────────────────────────────────────────────────────
router.get("/erp/transactions", authenticate, requireStaff, requireStore, requirePermission("accounting", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const transactions = await db.select().from(schema.transactionsTable)
      .where(eq(schema.transactionsTable.storeId, storeId))
      .orderBy(desc(schema.transactionsTable.date)).limit(200);
    res.json(transactions);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/transactions", authenticate, requireStaff, requireStore, requirePermission("accounting", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const actorUserId = req.user!.id;
    const body = { ...req.body, storeId };
    const amount = parseFloat(body.amount ?? "0");
    const isExpense = body.type === "expense";

    const result = await db.transaction(async (dbTx) => {
      const [transaction] = await dbTx.insert(schema.transactionsTable).values(body).returning();

      if (isExpense && amount > 0) {
        // Deduct from the staff member's caisse
        const staffCaisse = await ensureCaisse(storeId, actorUserId, dbTx);
        const { oldBalance, newBalance } = await applyCaisseDelta(dbTx, staffCaisse.id, -amount);
        await dbTx.insert(schema.caisseMovementsTable).values({
          caisseId: staffCaisse.id,
          type: "debit",
          amount: amount.toFixed(2),
          reason: "expense",
          actorUserId,
          notes: body.description || body.category || "Charge",
          balanceBefore: oldBalance.toFixed(2),
          balanceAfter: newBalance.toFixed(2),
        });
        broadcastCaisseChanged(storeId, staffCaisse.id);
      }

      return transaction;
    });

    res.status(201).json(result);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/accounting-summary", authenticate, requireStaff, requireStore, requirePermission("accounting", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const [{ income }] = await db.select({ income: sql<number>`coalesce(sum(amount),0)` })
      .from(schema.transactionsTable)
      .where(and(eq(schema.transactionsTable.type, "income"), eq(schema.transactionsTable.storeId, storeId)));
    const [{ expenses }] = await db.select({ expenses: sql<number>`coalesce(sum(amount),0)` })
      .from(schema.transactionsTable)
      .where(and(eq(schema.transactionsTable.type, "expense"), eq(schema.transactionsTable.storeId, storeId)));
    const monthly = await db.execute(sql`
      SELECT TO_CHAR(date::date, 'YYYY-MM') as month,
        SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses
      FROM transactions
      WHERE date::date >= NOW() - INTERVAL '12 months' AND store_id = ${storeId}
      GROUP BY month ORDER BY month
    `);
    res.json({ totalIncome: Number(income), totalExpenses: Number(expenses), netBalance: Number(income) - Number(expenses), monthly: monthly.rows });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── CRM ───────────────────────────────────────────────────────────
// Customers are scoped to the store via their ORDER history (or direct creation).
router.get("/erp/customers", authenticate, requireStaff, requireStore, requirePermission("customers", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { search, wilaya, classificationId, priceTierId, page = "1", limit = "10" } = req.query as Record<string, string | undefined>;
    const pageNum  = Math.max(1, parseInt(page  || "1")  || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit || "10") || 10));
    const offset   = (pageNum - 1) * limitNum;

    const searchCond = search
      ? sql`(lower(u.name) LIKE ${'%' + search.toLowerCase() + '%'} OR lower(u.email) LIKE ${'%' + search.toLowerCase() + '%'} OR lower(coalesce(u.phone,'')) LIKE ${'%' + search.toLowerCase() + '%'})`
      : sql`true`;
    const wilayaCond  = wilaya          ? sql`cp.wilaya = ${wilaya}`                                 : sql`true`;
    const classifCond = classificationId ? sql`cp.classification_id = ${parseInt(classificationId)}` : sql`true`;
    const tierCond    = priceTierId      ? sql`cp.price_tier_id = ${parseInt(priceTierId)}`          : sql`true`;

    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM (
        SELECT u.id
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id AND o.store_id = ${storeId}
        LEFT JOIN customer_profiles cp ON cp.user_id = u.id AND cp.store_id = ${storeId}
        WHERE u.role = 'customer'
          AND COALESCE(cp.contact_type, 'customer') IN ('customer', 'customer_supplier')
          AND (${searchCond}) AND (${wilayaCond}) AND (${classifCond}) AND (${tierCond})
        GROUP BY u.id, cp.store_id
        HAVING COUNT(o.id) > 0 OR cp.store_id = ${storeId}
      ) AS subq
    `);
    const total = Number((countResult.rows[0] as Record<string, unknown>)?.count ?? 0);

    const customers = await db.execute(sql`
      SELECT u.id, u.name, u.email, u.phone, u.address, u.city, u.created_at,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(o.total_amount), 0) as total_spent,
        cp.contact_id, cp.wilaya, cp.contact_type, cp.rc, cp.nif, cp.ai, cp.nis,
        cp.account_number, cp.credit_limit,
        COALESCE(CASE WHEN cp.contact_type = 'customer_supplier' AND cp.contact_id IS NOT NULL THEN (SELECT current_balance FROM contacts WHERE id = cp.contact_id LIMIT 1) ELSE NULL END, cp.current_balance, 0) as current_balance,
        cp.min_balance_alert, cp.foreign_currency,
        CASE WHEN cc.id IS NOT NULL THEN json_build_object(
          'id', cc.id, 'labelFr', cc.label_fr, 'labelAr', cc.label_ar,
          'color', cc.color, 'sortOrder', cc.sort_order
        ) ELSE NULL END as classification,
        CASE WHEN pt.id IS NOT NULL THEN json_build_object(
          'id', pt.id, 'labelFr', pt.label_fr, 'labelAr', pt.label_ar,
          'code', pt.code, 'sortOrder', pt.sort_order
        ) ELSE NULL END as "priceTier"
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id AND o.store_id = ${storeId}
      LEFT JOIN customer_profiles cp ON cp.user_id = u.id AND cp.store_id = ${storeId}
      LEFT JOIN customer_classifications cc ON cc.id = cp.classification_id
      LEFT JOIN price_tiers pt ON pt.id = cp.price_tier_id
      WHERE u.role = 'customer'
        AND COALESCE(cp.contact_type, 'customer') IN ('customer', 'customer_supplier')
        AND (${searchCond}) AND (${wilayaCond}) AND (${classifCond}) AND (${tierCond})
      GROUP BY u.id, u.name, u.email, u.phone, u.address, u.city, u.created_at,
        cp.contact_id, cp.wilaya, cp.contact_type, cp.rc, cp.nif, cp.ai, cp.nis,
        cp.account_number, cp.credit_limit, cp.current_balance,
        cp.min_balance_alert, cp.foreign_currency, cp.store_id,
        cc.id, cc.label_fr, cc.label_ar, cc.color, cc.sort_order,
        pt.id, pt.label_fr, pt.label_ar, pt.code, pt.sort_order
      HAVING COUNT(o.id) > 0 OR cp.store_id = ${storeId}
      ORDER BY total_spent DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `);
    const data = isAdmin(req)
      ? customers.rows
      : customers.rows.map((r: Record<string, unknown>) => { const { total_spent: _ts, ...rest } = r; return rest; });
    res.json({ data, total, page: pageNum, limit: limitNum });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Returns the current store's configured default comptoir customer directly by ID,
// independent of the paginated/total-spent-sorted list above. The POS relies on this
// as a guaranteed fallback: a low-activity default customer could otherwise rank
// outside the general list's page/limit and silently disappear from it.
router.get("/erp/customers/default-comptoir", authenticate, requireStaff, requireStore, requirePermission("customers", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const [storeRow] = await db.select({ defaultComptoirCustomerId: schema.storesTable.defaultComptoirCustomerId })
      .from(schema.storesTable).where(eq(schema.storesTable.id, storeId)).limit(1);
    const customerId = storeRow?.defaultComptoirCustomerId ?? null;
    if (customerId == null) { res.json({ customer: null }); return; }
    const result = await db.execute(sql`
      SELECT u.id, u.name, u.email, u.phone, u.address, u.city, u.created_at,
        cp.contact_id, cp.wilaya, cp.contact_type, cp.rc, cp.nif, cp.ai, cp.nis,
        cp.account_number, cp.credit_limit,
        COALESCE(CASE WHEN cp.contact_type = 'customer_supplier' AND cp.contact_id IS NOT NULL THEN (SELECT current_balance FROM contacts WHERE id = cp.contact_id LIMIT 1) ELSE NULL END, cp.current_balance, 0) as current_balance,
        cp.min_balance_alert, cp.foreign_currency,
        CASE WHEN cc.id IS NOT NULL THEN json_build_object(
          'id', cc.id, 'labelFr', cc.label_fr, 'labelAr', cc.label_ar,
          'color', cc.color, 'sortOrder', cc.sort_order
        ) ELSE NULL END as classification,
        CASE WHEN pt.id IS NOT NULL THEN json_build_object(
          'id', pt.id, 'labelFr', pt.label_fr, 'labelAr', pt.label_ar,
          'code', pt.code, 'sortOrder', pt.sort_order
        ) ELSE NULL END as "priceTier"
      FROM users u
      LEFT JOIN customer_profiles cp ON cp.user_id = u.id AND cp.store_id = ${storeId}
      LEFT JOIN customer_classifications cc ON cc.id = cp.classification_id
      LEFT JOIN price_tiers pt ON pt.id = cp.price_tier_id
      WHERE u.id = ${customerId} AND u.role = 'customer'
      LIMIT 1
    `);
    res.json({ customer: result.rows[0] ?? null });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/customers", authenticate, requireStaff, requireStore, requirePermission("customers", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const {
      name, email, password, preferredLang, phone, address, city, notes,
      contactType, wilaya, commune, gps, classificationId, priceTierId, accountNumber,
      creditLimit, minBalanceAlert, currentBalance, foreignCurrency,
      rc, nif, ai, nis,
    } = req.body || {};
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const cpType: "customer" | "customer_supplier" =
      contactType === "customer_supplier" ? "customer_supplier" : "customer";
    const shared: ContactSharedInput = {
      name, contactName: null, email,
      phone: phone || null, address: address || null, notes: notes || null,
      contactType: cpType,
    };

    // Email is optional. If provided, reuse an existing customer account with that
    // email (cross-store support). If omitted, a synthetic placeholder is generated
    // so the users table NOT NULL constraint is satisfied; it can be replaced later.
    const trimmedEmail = normalizeEmail(typeof email === "string" ? email : "");
    const [existingUser] = trimmedEmail
      ? await db.select().from(schema.usersTable).where(sql`lower(trim(${schema.usersTable.email})) = ${trimmedEmail}`).limit(1)
      : [undefined];
    if (existingUser && existingUser.role !== "customer") {
      res.status(409).json({ error: "Email belongs to a non-customer account" });
      return;
    }

    const user = await db.transaction(async (tx) => {
      let u: typeof schema.usersTable.$inferSelect;
      if (existingUser) {
        u = existingUser;
      } else {
        const finalEmail = trimmedEmail || `no-email-${randomUUID()}@placeholder.invalid`;
        const pwd = (password && String(password).length >= 6) ? String(password) : Math.random().toString(36).slice(2, 12);
        const passwordHash = await bcrypt.hash(pwd, 10);
        const [newUser] = await tx.insert(schema.usersTable).values({
          name, email: finalEmail, passwordHash,
          role: "customer",
          preferredLang: preferredLang === "en" ? "en" : "ar",
          phone: phone || null,
          address: address || null,
          city: city || null,
          notes: notes || null,
        }).returning();
        u = newUser;
      }

      // A profile for this exact (user, store) pair may already exist when
      // reusing an existingUser — check BEFORE creating a contact, so a repeat
      // POST can never leave a fresh, orphaned contact row behind (the contact
      // created below is always the one actually attached to the profile).
      const [existingProfile] = await tx.select({ contactId: schema.customerProfilesTable.contactId })
        .from(schema.customerProfilesTable)
        .where(and(eq(schema.customerProfilesTable.userId, u.id), eq(schema.customerProfilesTable.storeId, storeId)))
        .limit(1);
      if (existingProfile) {
        // Already associated with this store — nothing to create; treat as idempotent.
        return u;
      }

      const contactId = await insertContact(tx, storeId, shared);
      // Always insert at "0" — the requested opening balance (if any) is applied
      // below via mutateCustomerBalance so it goes through the centralized
      // mutator (lock + legacy sync + contact recompute/fan-out) instead of a
      // raw write, and so a sibling store's adopted balance (which takes
      // priority — see below) is never raced against a competing raw write.
      await tx.insert(schema.customerProfilesTable).values({
        userId: u.id,
        storeId,
        contactId,
        contactType: cpType,
        wilaya: wilaya || null,
        commune: commune || null,
        gps: gps || null,
        classificationId: classificationId ? Number(classificationId) : null,
        priceTierId: priceTierId ? Number(priceTierId) : null,
        accountNumber: accountNumber || null,
        creditLimit: creditLimit != null ? String(creditLimit) : null,
        minBalanceAlert: minBalanceAlert != null ? String(minBalanceAlert) : null,
        currentBalance: "0",
        foreignCurrency: foreignCurrency ?? false,
        rc: rc || null, nif: nif || null, ai: ai || null, nis: nis || null,
      });
      if (cpType === "customer_supplier") {
        await ensureSupplierRole(tx, storeId, contactId, shared);
      }
      // Cross-store: if this person already exists in another store, the new profile
      // must carry the same unified balance (never diverge). Adopt it from a sibling
      // store rather than applying this store's requested opening balance, and link
      // the two contacts into the same global identity — this is what makes a
      // supplier role added later (in either store) stay connected automatically.
      const [balSibling] = await tx.select({
        storeId: schema.customerProfilesTable.storeId,
        contactId: schema.customerProfilesTable.contactId,
      })
        .from(schema.customerProfilesTable)
        .where(and(eq(schema.customerProfilesTable.userId, u.id), ne(schema.customerProfilesTable.storeId, storeId)))
        .limit(1);
      if (balSibling) {
        await syncLinkedCustomerBalances(tx, u.id, balSibling.storeId);
        if (balSibling.contactId) {
          await linkContactsGlobally(tx, balSibling.contactId, contactId);
          await recomputeContactBalance(tx, contactId);
          // Sync FROM the sibling (the authoritative source), not FROM the newly
          // created contact. The new contact's supplier was just inserted at 0,
          // so using it as the source would push 0 onto Store A's real supplier
          // balance for customer_supplier contacts.
          await syncLinkedContactBalances(tx, balSibling.contactId);
        }
      } else if (currentBalance != null) {
        // No sibling to adopt from — honor the requested opening balance through
        // the centralized mutator (also recomputes/fans out the canonical contact
        // balance for a customer_supplier contact).
        await mutateCustomerBalance(tx, u.id, storeId, { absolute: Number(currentBalance) });
      }
      return u;
    });
    res.status(201).json({
      id: user.id, name: user.name, email: user.email,
      phone: user.phone, address: user.address, city: user.city,
      wilaya: wilaya || null, classification: null, priceTier: null,
      total_orders: 0, total_spent: "0",
    });
  } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/erp/customers/:id", authenticate, requireStaff, requireStore, requirePermission("customers", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = pid(req, "id");
    const [user] = await db.select().from(schema.usersTable)
      .where(and(eq(schema.usersTable.id, userId), eq(schema.usersTable.role, "customer"))).limit(1);
    if (!user) { res.status(404).json({ error: "Customer not found" }); return; }
    const assoc = await db.execute(sql`
      (SELECT 1 FROM orders WHERE user_id = ${userId} AND store_id = ${storeId} LIMIT 1)
      UNION ALL
      (SELECT 1 FROM customer_profiles WHERE user_id = ${userId} AND store_id = ${storeId} LIMIT 1)
    `);
    if (assoc.rows.length === 0) { res.status(404).json({ error: "Customer not found" }); return; }
    const orders = await db.select().from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.userId, userId), eq(schema.ordersTable.storeId, storeId)))
      .orderBy(desc(schema.ordersTable.createdAt));
    const notes = await db.select().from(schema.customerNotesTable)
      .where(and(eq(schema.customerNotesTable.userId, userId), eq(schema.customerNotesTable.storeId, storeId)));
    const profileRows = await db.execute(sql`
      SELECT cp.*,
        COALESCE(CASE WHEN cp.contact_type = 'customer_supplier' AND cp.contact_id IS NOT NULL THEN (SELECT current_balance FROM contacts WHERE id = cp.contact_id LIMIT 1) ELSE NULL END, cp.current_balance, 0) as canonical_current_balance,
        CASE WHEN cc.id IS NOT NULL THEN json_build_object(
          'id', cc.id, 'labelFr', cc.label_fr, 'labelAr', cc.label_ar,
          'color', cc.color, 'sortOrder', cc.sort_order
        ) ELSE NULL END as classification,
        CASE WHEN pt.id IS NOT NULL THEN json_build_object(
          'id', pt.id, 'labelFr', pt.label_fr, 'labelAr', pt.label_ar,
          'code', pt.code, 'sortOrder', pt.sort_order
        ) ELSE NULL END as "priceTier"
      FROM customer_profiles cp
      LEFT JOIN customer_classifications cc ON cc.id = cp.classification_id
      LEFT JOIN price_tiers pt ON pt.id = cp.price_tier_id
      WHERE cp.user_id = ${userId} AND cp.store_id = ${storeId}
    `);
    const rawProfile = profileRows.rows[0] as Record<string, unknown> | undefined;
    let profile = null;
    if (rawProfile) {
      profile = {
        contactType: rawProfile.contact_type,
        contactId: rawProfile.contact_id ?? null,
        wilaya: rawProfile.wilaya,
        commune: rawProfile.commune,
        gps: rawProfile.gps,
        classificationId: rawProfile.classification_id,
        classification: rawProfile.classification,
        priceTierId: rawProfile.price_tier_id,
        priceTier: rawProfile.priceTier,
        accountNumber: rawProfile.account_number,
        creditLimit: rawProfile.credit_limit,
        minBalanceAlert: rawProfile.min_balance_alert,
        currentBalance: rawProfile.canonical_current_balance ?? rawProfile.current_balance,
        foreignCurrency: rawProfile.foreign_currency,
        rc: rawProfile.rc,
        nif: rawProfile.nif,
        ai: rawProfile.ai,
        nis: rawProfile.nis,
      };
    }
    res.json({
      id: user.id, name: user.name, email: user.email,
      phone: user.phone, address: user.address, city: user.city,
      created_at: user.createdAt,
      profile, orders, notes,
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/customers/:id", authenticate, requireStaff, requireStore, requirePermission("customers", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = pid(req, "id");
    const admin = isAdmin(req);
    const {
      name, email, phone, address, city,
      contactType, wilaya, commune, gps,
      classificationId, priceTierId,
      accountNumber, creditLimit, minBalanceAlert, foreignCurrency,
      rc, nif, ai, nis, password,
    } = req.body || {};
    // currentBalance is deliberately never read from this endpoint's body: a profile
    // edit (credit limit, address, etc.) must never be able to change the balance,
    // even if a caller still sends a stale snapshot of it. The only supported way to
    // intentionally change a customer's balance is the dedicated balance-adjustment
    // endpoint (POST /erp/customers/:id/adjust).
    const [user] = await db.select({ id: schema.usersTable.id })
      .from(schema.usersTable)
      .where(and(eq(schema.usersTable.id, userId), eq(schema.usersTable.role, "customer"))).limit(1);
    if (!user) { res.status(404).json({ error: "Customer not found" }); return; }
    const assoc = await db.execute(sql`
      (SELECT 1 FROM orders WHERE user_id = ${userId} AND store_id = ${storeId} LIMIT 1)
      UNION ALL
      (SELECT 1 FROM customer_profiles WHERE user_id = ${userId} AND store_id = ${storeId} LIMIT 1)
    `);
    if (assoc.rows.length === 0) { res.status(404).json({ error: "Customer not found" }); return; }
    const userUpdate: Record<string, unknown> = {};
    if (name !== undefined) userUpdate.name = name;
    if (phone !== undefined) userUpdate.phone = phone;
    if (address !== undefined) userUpdate.address = address;
    if (city !== undefined) userUpdate.city = city;
    // email update: check uniqueness before writing
    if (email !== undefined) {
      const newEmail = normalizeEmail(email);
      if (newEmail) {
        const [dup] = await db.select({ id: schema.usersTable.id })
          .from(schema.usersTable)
          .where(and(sql`lower(trim(${schema.usersTable.email})) = ${newEmail}`, ne(schema.usersTable.id, userId)))
          .limit(1);
        if (dup) { res.status(409).json({ error: "Email already in use" }); return; }
        userUpdate.email = newEmail;
      }
    }
    // password reset is admin-only
    if (admin && password !== undefined && String(password).length >= 6) {
      userUpdate.passwordHash = await bcrypt.hash(String(password), 10);
    }
    // Build partial update: only fields explicitly sent in the request body are updated.
    // Admin-only fields (classificationId, priceTierId, creditLimit, minBalanceAlert,
    // accountNumber, foreignCurrency, rc, nif, ai, nis, contactType) are silently
    // ignored for non-admin staff — they can only update basic contact info.
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (admin && contactType !== undefined) updateSet.contactType = contactType;
    if (wilaya !== undefined) updateSet.wilaya = wilaya ?? null;
    if (commune !== undefined) updateSet.commune = commune ?? null;
    if (gps !== undefined) updateSet.gps = gps ?? null;
    if (admin && classificationId !== undefined) updateSet.classificationId = classificationId ?? null;
    if (admin && priceTierId !== undefined) updateSet.priceTierId = priceTierId ?? null;
    if (admin && accountNumber !== undefined) updateSet.accountNumber = accountNumber ?? null;
    if (admin && creditLimit !== undefined) updateSet.creditLimit = creditLimit != null ? String(creditLimit) : null;
    if (admin && minBalanceAlert !== undefined) updateSet.minBalanceAlert = minBalanceAlert != null ? String(minBalanceAlert) : null;
    // currentBalance is intentionally NOT in updateSet (see note at the top of the
    // handler) — it is never mass-assignable on a profile edit.
    if (admin && foreignCurrency !== undefined) updateSet.foreignCurrency = foreignCurrency;
    if (admin && rc !== undefined) updateSet.rc = rc ?? null;
    if (admin && nif !== undefined) updateSet.nif = nif ?? null;
    if (admin && ai !== undefined) updateSet.ai = ai ?? null;
    if (admin && nis !== undefined) updateSet.nis = nis ?? null;
    // Full values for INSERT (new profile rows get defaults for omitted fields).
    // currentBalance always starts at "0" here — a newly-created cross-store profile's
    // balance is then unified with any sibling store below (never from request input).
    const insertValues = {
      userId,
      storeId,
      contactType: (admin ? (contactType as "customer" | "customer_supplier") : undefined) ?? "customer",
      wilaya: wilaya ?? null, commune: commune ?? null, gps: gps ?? null,
      classificationId: admin ? (classificationId ?? null) : null,
      priceTierId: admin ? (priceTierId ?? null) : null,
      accountNumber: admin ? (accountNumber ?? null) : null,
      creditLimit: admin && creditLimit != null ? String(creditLimit) : null,
      minBalanceAlert: admin && minBalanceAlert != null ? String(minBalanceAlert) : null,
      currentBalance: "0",
      foreignCurrency: admin ? (foreignCurrency ?? false) : false,
      rc: admin ? (rc ?? null) : null,
      nif: admin ? (nif ?? null) : null,
      ai: admin ? (ai ?? null) : null,
      nis: admin ? (nis ?? null) : null,
    };
    // Everything — user fields, profile upsert, and unified contact maintenance — runs in
    // ONE transaction so the visible customer edit can never commit while the unified
    // contact/role state fails (no drift).
    await db.transaction(async (tx) => {
      // Acquire the identity advisory lock FIRST — before any row writes — to match the
      // advisory-lock → row-write ordering of mutateCustomerBalance / mutateSupplierBalance.
      // This prevents a deadlock with concurrent balance mutators: without this, PUT could
      // hold a row write-lock and then block waiting for the advisory key, while a mutator
      // holds the advisory key and blocks waiting for the same row. Advisory locks are
      // reentrant per-transaction, so the second lockCustomerIdentity call after legacy
      // sibling linking is a no-op for already-held keys and adds the gcid key once set.
      await lockCustomerIdentity(tx, userId, storeId);
      if (Object.keys(userUpdate).length > 0) {
        await tx.update(schema.usersTable).set(userUpdate).where(eq(schema.usersTable.id, userId));
      }
      await tx.insert(schema.customerProfilesTable)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [schema.customerProfilesTable.userId, schema.customerProfilesTable.storeId],
          set: updateSet,
        });
      const [u] = await tx.select().from(schema.usersTable)
        .where(eq(schema.usersTable.id, userId)).limit(1);
      const [prof] = await tx.select().from(schema.customerProfilesTable)
        .where(and(
          eq(schema.customerProfilesTable.userId, userId),
          eq(schema.customerProfilesTable.storeId, storeId),
        )).limit(1);
      if (!u || !prof) return;
      const cStoreId = prof.storeId ?? storeId;
      let contactId = prof.contactId;
      const hasSupplierRole = contactId != null && (await tx.select({ id: schema.suppliersTable.id })
        .from(schema.suppliersTable).where(eq(schema.suppliersTable.contactId, contactId)).limit(1)).length > 0;
      // Both directions are allowed: customer→customer_supplier (promotion) and
      // customer_supplier→customer (downgrade). Role rows are NEVER deleted — on
      // downgrade the suppliers row keeps its financial history and only its
      // contactType label is reset to "supplier". prof.contactType already holds the
      // value written by the upsert above, so it is used directly as the effective type.
      const effType: "customer" | "customer_supplier" =
        prof.contactType === "customer_supplier" ? "customer_supplier" : "customer";
      const cShared: ContactSharedInput = {
        name: u.name, contactName: null, email: u.email,
        phone: u.phone ?? null, address: u.address ?? null, notes: u.notes ?? null,
        contactType: effType,
      };
      if (contactId == null) {
        contactId = await insertContact(tx, cStoreId, cShared);
        await tx.update(schema.customerProfilesTable).set({ contactId })
          .where(and(eq(schema.customerProfilesTable.userId, userId), eq(schema.customerProfilesTable.storeId, storeId)));
      } else {
        await updateContactFields(tx, contactId, cShared);
      }
      if (effType === "customer_supplier") {
        await ensureSupplierRole(tx, cStoreId, contactId, cShared);
      } else if (hasSupplierRole && contactId != null) {
        // Downgrade: reset the linked supplier label to "supplier" so the contact
        // is no longer displayed as customer_supplier on the supplier side.
        await tx.update(schema.suppliersTable)
          .set({ contactType: "supplier" })
          .where(eq(schema.suppliersTable.contactId, contactId));
      }
      // Cross-store balance/identity unification for the same person across linked
      // stores. linkLegacyCustomerSiblings runs first: it retrofits a contactId +
      // globalContactId link for any userId-linked sibling profiles that are still
      // legacy (contactId IS NULL), ensuring propagateContactTypeToSiblings can
      // reach every sibling via the unified globalContactId path regardless of
      // whether they were created before or after the unified-contact system.
      // syncLinkedCustomerBalances is kept as a belt-and-suspenders legacy copy for
      // any profiles that, for whatever reason, end up still lacking a contactId
      // (all no-ops when the linkLegacy call already handled them).
      // ── Phase 1: identity linking only (no balance writes yet) ──────────────
      // linkLegacyCustomerSiblings retrofits contactId + globalContactId for any
      // userId-linked sibling profiles that predate the unified-contact system.
      // linkContactsGlobally is then called for the balSibling found via userId,
      // ensuring the gcid is fully established before we acquire the advisory
      // lock below (lock key = gcid once it exists, legacy keys before that).
      if (contactId != null) {
        await linkLegacyCustomerSiblings(tx, contactId, userId, storeId);
      }
      const [balSibling] = await tx.select({
        storeId: schema.customerProfilesTable.storeId,
        contactId: schema.customerProfilesTable.contactId,
      })
        .from(schema.customerProfilesTable)
        .where(and(eq(schema.customerProfilesTable.userId, userId), ne(schema.customerProfilesTable.storeId, storeId)))
        .limit(1);
      // Link-only step — no balance writes yet.
      if (balSibling?.contactId && contactId != null) {
        await linkContactsGlobally(tx, balSibling.contactId, contactId);
      }

      // ── Phase 2: advisory lock, then ALL balance writes under lock ───────────
      // All balance-mutating calls (syncLinkedCustomerBalances, recomputeContactBalance,
      // syncLinkedContactBalances) run only after the identity advisory lock is held,
      // matching the serialization guarantee of mutateCustomerBalance / mutateSupplierBalance
      // and preventing lost-update races with concurrent balance mutations on this identity.
      if (contactId != null) {
        await lockCustomerIdentity(tx, userId, storeId);
      }
      // Belt-and-suspenders legacy customer balance copy (safe no-op for profiles
      // that linkLegacy already handled, still catches any that slipped through).
      if (balSibling) {
        await syncLinkedCustomerBalances(tx, userId, balSibling.storeId);
      }
      if (contactId != null) {
        await recomputeContactBalance(tx, contactId);
        await propagateContactTypeToSiblings(tx, contactId, effType);
        await syncLinkedContactBalances(tx, contactId);
      }
    });
    const profileRows = await db.execute(sql`
      SELECT cp.*,
        COALESCE(CASE WHEN cp.contact_type = 'customer_supplier' AND cp.contact_id IS NOT NULL THEN (SELECT current_balance FROM contacts WHERE id = cp.contact_id LIMIT 1) ELSE NULL END, cp.current_balance, 0) as canonical_current_balance,
        CASE WHEN cc.id IS NOT NULL THEN json_build_object(
          'id', cc.id, 'labelFr', cc.label_fr, 'labelAr', cc.label_ar,
          'color', cc.color, 'sortOrder', cc.sort_order
        ) ELSE NULL END as classification,
        CASE WHEN pt.id IS NOT NULL THEN json_build_object(
          'id', pt.id, 'labelFr', pt.label_fr, 'labelAr', pt.label_ar,
          'code', pt.code, 'sortOrder', pt.sort_order
        ) ELSE NULL END as "priceTier"
      FROM customer_profiles cp
      LEFT JOIN customer_classifications cc ON cc.id = cp.classification_id
      LEFT JOIN price_tiers pt ON pt.id = cp.price_tier_id
      WHERE cp.user_id = ${userId} AND cp.store_id = ${storeId}
    `);
    const rawProfile = profileRows.rows[0] as Record<string, unknown> | undefined;
    let updatedProfile = null;
    if (rawProfile) {
      updatedProfile = {
        contactType: rawProfile.contact_type,
        contactId: rawProfile.contact_id ?? null,
        wilaya: rawProfile.wilaya,
        commune: rawProfile.commune,
        gps: rawProfile.gps,
        classificationId: rawProfile.classification_id,
        classification: rawProfile.classification,
        priceTierId: rawProfile.price_tier_id,
        priceTier: rawProfile.priceTier,
        accountNumber: rawProfile.account_number,
        creditLimit: rawProfile.credit_limit,
        minBalanceAlert: rawProfile.min_balance_alert,
        currentBalance: rawProfile.canonical_current_balance ?? rawProfile.current_balance,
        foreignCurrency: rawProfile.foreign_currency,
        rc: rawProfile.rc, nif: rawProfile.nif, ai: rawProfile.ai, nis: rawProfile.nis,
      };
    }
    const [updatedUser] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.id, userId)).limit(1);
    const orders = await db.select().from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.userId, userId), storeId > 0 ? eq(schema.ordersTable.storeId, storeId) : sql`true`))
      .orderBy(desc(schema.ordersTable.createdAt));
    const notes = await db.select().from(schema.customerNotesTable)
      .where(and(eq(schema.customerNotesTable.userId, userId), storeId > 0 ? eq(schema.customerNotesTable.storeId, storeId) : sql`true`));
    res.json({
      id: updatedUser.id, name: updatedUser.name, email: updatedUser.email,
      phone: updatedUser.phone, address: updatedUser.address, city: updatedUser.city,
      created_at: updatedUser.createdAt,
      profile: updatedProfile, orders, notes,
    });
  } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// Customer Balance Adjustment — mirrors POST /erp/suppliers/:id/adjust (see there for
// the full rationale). Staff type a target balance and it becomes the new balance
// exactly, including for customer_supplier (dual-role) contacts whose displayed
// balance is the unified contact balance rather than the raw customer-role one.
router.post("/erp/customers/:id/adjust", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    const { targetBalance, date, note } = req.body;

    const parsedTarget = parseFloat(targetBalance);
    if (!Number.isFinite(parsedTarget)) { res.status(400).json({ error: "targetBalance must be a finite number" }); return; }
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "date is required (YYYY-MM-DD)" }); return; }

    const [profileCheck] = await db.select({ id: schema.customerProfilesTable.id }).from(schema.customerProfilesTable)
      .where(and(eq(schema.customerProfilesTable.userId, customerId), eq(schema.customerProfilesTable.storeId, storeId))).limit(1);
    if (!profileCheck) { res.status(404).json({ error: "Customer not found" }); return; }

    const op = await db.transaction(async (tx) => {
      // Take the SAME identity-scoped advisory lock mutateCustomerBalance itself
      // acquires (rather than an explicit row lock) for the whole
      // read-compute-write, so two concurrent adjustments can't both compute
      // their delta off the same stale "old balance" and drift the result away
      // from the last-submitted target. Using the shared advisory lock instead
      // of SELECT ... FOR UPDATE keeps lock acquisition order identical to every
      // other balance-mutating call site — an explicit row lock taken before
      // this call would invert that order and open a deadlock window against
      // concurrent mutateCustomerBalance callers on the same identity.
      await lockCustomerIdentity(tx, customerId, storeId);
      const [profile] = await tx.select().from(schema.customerProfilesTable)
        .where(and(eq(schema.customerProfilesTable.userId, customerId), eq(schema.customerProfilesTable.storeId, storeId)));

      // "Old balance" must be the value actually shown to the user, i.e. what
      // GET /erp/customers returns: the unified contact balance (customer role +
      // supplier role) for customer_supplier contacts, or the plain customer-role
      // balance otherwise. Computing the delta against the raw customer-role
      // balance instead (while the UI displays the unified one) makes the
      // resulting unified balance diverge from the target the user typed.
      let oldBalance = parseFloat(profile.currentBalance ?? "0");
      if (profile.contactType === "customer_supplier" && profile.contactId != null) {
        const [contact] = await tx.select({ currentBalance: schema.contactsTable.currentBalance })
          .from(schema.contactsTable).where(eq(schema.contactsTable.id, profile.contactId));
        if (contact) oldBalance = parseFloat(contact.currentBalance ?? "0");
      }

      const newBalanceFixed = parsedTarget.toFixed(2);
      const deltaNum = parsedTarget - oldBalance;
      const delta = deltaNum.toFixed(2);
      const autoNote = `Ancien: ${oldBalance.toFixed(2)} DA → Nouveau: ${newBalanceFixed} DA${note ? ` — ${note}` : ""}`;

      // Apply the delta (not an absolute set) to the customer role only, so the
      // resulting unified balance = oldBalance(displayed) + delta = target.
      await mutateCustomerBalance(tx, customerId, storeId, { delta: deltaNum });

      const [operation] = await tx.insert(schema.customerOperationsTable).values({
        customerId,
        storeId,
        type: "ajustement",
        amount: delta,
        date,
        note: autoNote,
        createdBy: req.user!.id,
        // The displayed "ancien/nouveau solde" for an adjustment must match the
        // unified balance shown to the user (see oldBalance computation above),
        // not the raw customer-role balance mutateCustomerBalance operates on.
        balanceBefore: oldBalance.toFixed(2),
        balanceAfter: newBalanceFixed,
      }).returning();

      return operation;
    });

    res.status(201).json(op);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Import a customer into one or more additional stores.
// Creates a new customer_profile row per target store (balances are independent — no sync).
// For customer_supplier contacts, also creates a supplier record in the target store.
router.post("/erp/customers/:id/import-to-stores", authenticate, requireStaff, requireStore, requirePermission("customers", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = pid(req, "id");
    const { targetStoreIds } = req.body as { targetStoreIds?: unknown };

    if (!Array.isArray(targetStoreIds) || targetStoreIds.length === 0) {
      res.status(400).json({ error: "targetStoreIds must be a non-empty array" });
      return;
    }
    const tidArr = [...new Set((targetStoreIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n !== storeId))];
    if (tidArr.length === 0) {
      res.status(400).json({ error: "No valid target stores (cannot import into the same store)" });
      return;
    }

    const [srcUser] = await db.select({ id: schema.usersTable.id })
      .from(schema.usersTable)
      .where(and(eq(schema.usersTable.id, userId), eq(schema.usersTable.role, "customer"))).limit(1);
    if (!srcUser) { res.status(404).json({ error: "Customer not found" }); return; }

    const [srcProfile] = await db.select()
      .from(schema.customerProfilesTable)
      .where(and(eq(schema.customerProfilesTable.userId, userId), eq(schema.customerProfilesTable.storeId, storeId))).limit(1);
    if (!srcProfile) {
      const [hasOrder] = await db.select({ id: schema.ordersTable.id })
        .from(schema.ordersTable)
        .where(and(eq(schema.ordersTable.userId, userId), eq(schema.ordersTable.storeId, storeId))).limit(1);
      if (!hasOrder) { res.status(404).json({ error: "Customer not associated with this store" }); return; }
    }

    const memberships = await db.select({ storeId: schema.userStoresTable.storeId })
      .from(schema.userStoresTable)
      .where(eq(schema.userStoresTable.userId, req.user!.id));
    const accessibleStoreIds = new Set(memberships.map((m) => m.storeId));

    type ImportResult = {
      targetStoreId: number;
      status: "created" | "linked_existing" | "already_linked" | "conflict" | "error";
      customerId?: number;
      message?: string;
    };
    const results: ImportResult[] = [];

    await db.transaction(async (tx) => {
      const cpType: "customer" | "customer_supplier" =
        srcProfile?.contactType === "customer_supplier" ? "customer_supplier" : "customer";

      // Source contact (for copying identity fields into target stores)
      let srcContact: typeof schema.contactsTable.$inferSelect | undefined;
      if (srcProfile?.contactId != null) {
        const [c] = await tx.select().from(schema.contactsTable)
          .where(eq(schema.contactsTable.id, srcProfile.contactId)).limit(1);
        srcContact = c;
      }

      // Source supplier row (only relevant for customer_supplier)
      let srcSupplier: typeof schema.suppliersTable.$inferSelect | undefined;
      if (cpType === "customer_supplier" && srcContact) {
        const [s] = await tx.select().from(schema.suppliersTable)
          .where(and(eq(schema.suppliersTable.contactId, srcContact.id), eq(schema.suppliersTable.storeId, storeId)))
          .limit(1);
        srcSupplier = s;
      }

      for (const targetStoreId of tidArr) {
        if (!accessibleStoreIds.has(targetStoreId)) {
          results.push({ targetStoreId, status: "error", message: "You do not have access to this store" });
          continue;
        }
        const [store] = await tx.select({ id: schema.storesTable.id })
          .from(schema.storesTable)
          .where(and(eq(schema.storesTable.id, targetStoreId), eq(schema.storesTable.isActive, true))).limit(1);
        if (!store) { results.push({ targetStoreId, status: "error", message: "Store not found or inactive" }); continue; }

        const [existing] = await tx.select({
          id: schema.customerProfilesTable.id,
          contactId: schema.customerProfilesTable.contactId,
          contactType: schema.customerProfilesTable.contactType,
        })
          .from(schema.customerProfilesTable)
          .where(and(eq(schema.customerProfilesTable.userId, userId), eq(schema.customerProfilesTable.storeId, targetStoreId))).limit(1);

        if (existing) {
          // Conflict: profile exists but with a different type
          if (existing.contactType !== cpType) {
            results.push({
              targetStoreId,
              status: "conflict",
              customerId: userId,
              message: `Type mismatch: existing=${existing.contactType}, requested=${cpType}`,
            });
            continue;
          }

          let linkedContactId = existing.contactId;

          // Wire contact link if missing → this counts as linked_existing, not already_linked
          if (existing.contactId == null && srcContact) {
            // Reuse an existing contact in the target store if one already shares the same
            // globalContactId (e.g. created by a prior supplier import). Creating a second
            // contact with the same globalContactId would violate contacts_one_global_per_store.
            let resolvedContactId: number | null = null;
            if (srcContact.globalContactId) {
              const [found] = await tx.select({ id: schema.contactsTable.id })
                .from(schema.contactsTable)
                .where(and(
                  eq(schema.contactsTable.storeId, targetStoreId),
                  eq(schema.contactsTable.globalContactId, srcContact.globalContactId),
                ))
                .limit(1);
              if (found) resolvedContactId = found.id;
            }
            if (resolvedContactId === null) {
              const [nc] = await tx.insert(schema.contactsTable).values({
                storeId: targetStoreId,
                name: srcContact.name, contactName: srcContact.contactName, email: srcContact.email,
                phone: srcContact.phone, address: srcContact.address, notes: srcContact.notes,
                contactType: srcContact.contactType,
              }).returning({ id: schema.contactsTable.id });
              resolvedContactId = nc.id;
              await linkContactsGlobally(tx, srcContact.id, resolvedContactId);
            }
            await tx.update(schema.customerProfilesTable)
              .set({ contactId: resolvedContactId })
              .where(eq(schema.customerProfilesTable.id, existing.id));
            linkedContactId = resolvedContactId;

            // Ensure supplier role for customer_supplier on existing profiles.
            // The target contact may already have a supplier (from a prior supplier import);
            // check before inserting to avoid suppliers_contact_id_uniq violation.
            if (cpType === "customer_supplier" && srcSupplier) {
              const [existingSupplier] = await tx.select({ id: schema.suppliersTable.id, contactType: schema.suppliersTable.contactType })
                .from(schema.suppliersTable)
                .where(and(eq(schema.suppliersTable.contactId, resolvedContactId), eq(schema.suppliersTable.storeId, targetStoreId)))
                .limit(1);
              if (!existingSupplier) {
                await tx.insert(schema.suppliersTable).values({
                  storeId: targetStoreId,
                  name: srcSupplier.name, contactName: srcSupplier.contactName,
                  email: srcSupplier.email, phone: srcSupplier.phone,
                  address: srcSupplier.address, notes: srcSupplier.notes,
                  contactType: "customer_supplier", contactId: resolvedContactId,
                });
              } else if (existingSupplier.contactType !== "customer_supplier") {
                await tx.update(schema.suppliersTable)
                  .set({ contactType: "customer_supplier" })
                  .where(eq(schema.suppliersTable.id, existingSupplier.id));
              }
            }

            await recomputeContactBalance(tx, resolvedContactId);
            // Do NOT call syncLinkedContactBalances here: the contact may have balance 0
            // and would clobber the source store's real balance before the authoritative
            // syncLinkedContactBalances(srcContact) runs after the loop.
            results.push({ targetStoreId, status: "linked_existing", customerId: userId });
            continue;
          }

          // Profile already fully linked — also ensure supplier role if type matches
          if (cpType === "customer_supplier" && srcSupplier && linkedContactId != null) {
            const [existingSupplier] = await tx.select({ id: schema.suppliersTable.id })
              .from(schema.suppliersTable)
              .where(and(eq(schema.suppliersTable.contactId, linkedContactId), eq(schema.suppliersTable.storeId, targetStoreId)))
              .limit(1);
            if (!existingSupplier) {
              await tx.insert(schema.suppliersTable).values({
                storeId: targetStoreId,
                name: srcSupplier.name, contactName: srcSupplier.contactName,
                email: srcSupplier.email, phone: srcSupplier.phone,
                address: srcSupplier.address, notes: srcSupplier.notes,
                contactType: "customer_supplier", contactId: linkedContactId,
              });
            }
          }
          if (srcContact && linkedContactId != null) {
            await linkContactsGlobally(tx, srcContact.id, linkedContactId);
            await recomputeContactBalance(tx, linkedContactId);
            // Do NOT call syncLinkedContactBalances here: if target balance ≠ source it
            // would clobber the source before the authoritative sync runs after the loop.
          }

          results.push({ targetStoreId, status: "already_linked", customerId: userId });
          continue;
        }

        // Create a new contact + customer_profile (and optionally supplier) in the target store.
        // The new profile starts at zero here; the unified balance is propagated from the
        // source store after the loop (see syncLinkedCustomerBalances below).
        let targetContactId: number | undefined;
        if (srcContact) {
          // Reuse an existing contact in the target store if one already shares the same
          // globalContactId (e.g. created by a prior supplier import). Creating a second
          // contact with the same globalContactId would violate contacts_one_global_per_store.
          let foundContact: number | null = null;
          if (srcContact.globalContactId) {
            const [existing] = await tx.select({ id: schema.contactsTable.id })
              .from(schema.contactsTable)
              .where(and(
                eq(schema.contactsTable.storeId, targetStoreId),
                eq(schema.contactsTable.globalContactId, srcContact.globalContactId),
              ))
              .limit(1);
            if (existing) foundContact = existing.id;
          }
          if (foundContact !== null) {
            targetContactId = foundContact;
          } else {
            const [nc] = await tx.insert(schema.contactsTable).values({
              storeId: targetStoreId,
              name: srcContact.name, contactName: srcContact.contactName, email: srcContact.email,
              phone: srcContact.phone, address: srcContact.address, notes: srcContact.notes,
              contactType: srcContact.contactType,
            }).returning({ id: schema.contactsTable.id });
            targetContactId = nc.id;
            await linkContactsGlobally(tx, srcContact.id, targetContactId);
          }
        }

        await tx.insert(schema.customerProfilesTable).values({
          userId,
          storeId: targetStoreId,
          contactType: cpType,
          ...(targetContactId !== undefined ? { contactId: targetContactId } : {}),
        }).onConflictDoNothing();

        if (cpType === "customer_supplier" && srcSupplier && targetContactId !== undefined) {
          // The target contact may already have a supplier row (created by a prior supplier
          // import). Check for it: if missing insert; if present with wrong type, upgrade.
          const [existingTargetSup] = await tx.select({ id: schema.suppliersTable.id, contactType: schema.suppliersTable.contactType })
            .from(schema.suppliersTable)
            .where(and(
              eq(schema.suppliersTable.contactId, targetContactId),
              eq(schema.suppliersTable.storeId, targetStoreId),
            ))
            .limit(1);
          if (!existingTargetSup) {
            await tx.insert(schema.suppliersTable).values({
              storeId: targetStoreId,
              name: srcSupplier.name,
              contactName: srcSupplier.contactName,
              email: srcSupplier.email,
              phone: srcSupplier.phone,
              address: srcSupplier.address,
              notes: srcSupplier.notes,
              contactType: "customer_supplier",
              contactId: targetContactId,
            });
          } else if (existingTargetSup.contactType !== "customer_supplier") {
            await tx.update(schema.suppliersTable)
              .set({ contactType: "customer_supplier" })
              .where(eq(schema.suppliersTable.id, existingTargetSup.id));
          }
        }

        if (targetContactId !== undefined) {
          await recomputeContactBalance(tx, targetContactId);
          // Do NOT call syncLinkedContactBalances here: the new contact has balance 0
          // and would clobber the source store's real balance. The authoritative sync
          // runs from srcContact after the loop below.
        }
        results.push({ targetStoreId, status: "created", customerId: userId });
      }
      // Propagate the unified balance from the source store to every linked store.
      // This is the authoritative sync — it reads Store A's profile balance and
      // pushes it to every sibling profile, then recomputes each sibling contact's
      // unified balance. It runs AFTER the loop so that none of the mid-loop
      // recomputeContactBalance calls (which ran with balance 0) can corrupt it.
      await syncLinkedCustomerBalances(tx, userId, storeId);
      // Also sync via the globalContactId path so that:
      //   (a) the supplier-side balance (not touched by syncLinkedCustomerBalances)
      //       is propagated for customer_supplier contacts, and
      //   (b) contacts.current_balance in every sibling is recomputed from the
      //       now-correct role balances.
      // Reading from srcContact (the authoritative source) ensures we never push
      // a zero or stale value outward.
      if (srcContact) await syncLinkedContactBalances(tx, srcContact.id);
    });

    res.json({ results });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/customers/:id/notes", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const [note] = await db.insert(schema.customerNotesTable)
      .values({ userId: pid(req, "id"), note: req.body.note, storeId: req.currentStoreId! })
      .returning();
    res.status(201).json(note);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Customer Operations ────────────────────────────────────────────
router.get("/erp/customers/:id/operations", authenticate, requireStaff, requireStore, requirePermission("customers", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    const { type, from, to } = req.query as Record<string, string | undefined>;
    const conditions = [
      eq(schema.customerOperationsTable.customerId, customerId),
      eq(schema.customerOperationsTable.storeId, storeId),
    ];
    if (type && type !== "all") conditions.push(eq(schema.customerOperationsTable.type, type));
    if (from) conditions.push(sql`${schema.customerOperationsTable.date} >= ${from}`);
    if (to) conditions.push(sql`${schema.customerOperationsTable.date} <= ${to}`);
    const ops = await db.select().from(schema.customerOperationsTable)
      .where(and(...conditions))
      .orderBy(asc(schema.customerOperationsTable.date), asc(schema.customerOperationsTable.createdAt));
    res.json(ops);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/customers/:id/operations", authenticate, requireStaff, requireStore, requirePermission("customers", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    const { type, amount, date, reference, note } = req.body || {};
    if (!type || !amount || !date) {
      res.status(400).json({ error: "type, amount and date are required" });
      return;
    }
    if (!["versement", "remboursement", "vente_a_terme"].includes(type)) {
      res.status(400).json({ error: "type must be versement, remboursement or vente_a_terme" });
      return;
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    // Credit limit check for vente_a_terme.
    // For customer_supplier contacts, contacts.current_balance is the unified net
    // balance across all stores and roles — use it so the decision is always
    // coherent regardless of which store or list the operation originates from.
    // Pure customers fall back to customer_profiles.current_balance.
    // Rule: allow when projected = currentBalance + amount ≤ creditLimit.
    // Negative currentBalance (store owes the customer) gives effective headroom
    // even when creditLimit = 0, so those sales are correctly allowed.
    if (type === "vente_a_terme") {
      const profileResult = await db.execute(sql`
        SELECT cp.credit_limit,
               CASE WHEN c.id IS NOT NULL THEN c.current_balance
                    ELSE cp.current_balance END AS current_balance
        FROM customer_profiles cp
        LEFT JOIN contacts c ON c.id = cp.contact_id AND c.contact_type = 'customer_supplier'
        WHERE cp.user_id = ${customerId} AND cp.store_id = ${storeId}
        LIMIT 1
      `);
      const profile = profileResult.rows[0] as { credit_limit: string | null; current_balance: string | null } | undefined;
      const creditLimit = Number(profile?.credit_limit ?? 0);
      const currentBalance = Number(profile?.current_balance ?? 0);
      if (currentBalance + numAmount > creditLimit) {
        res.status(400).json({ error: "Plafond de crédit dépassé." });
        return;
      }
    }
    // Insert operation + update balance + caisse + accounting in a single transaction
    // versement = customer pays us → balance decreases (negative delta)
    // remboursement / vente_a_terme = customer owes more → balance increases (positive delta)
    const delta = type === "versement" ? -numAmount : numAmount;
    const actorUserId = req.user!.id;
    const amountStr = numAmount.toFixed(2);

    let resolvedCaisseId: number | null = null;
    const op = await db.transaction(async (tx) => {
      // ── Phase 1: resolve caisse (global model: auto-debit/-credit the actor's personal caisse) ──
      if (type === "versement" || type === "remboursement") {
        const caisse = await ensureCaisse(null, actorUserId, tx);
        resolvedCaisseId = caisse.id;
      }

      // ── Phase 2: update customer_profiles balance first so the real ancien/nouveau
      // solde is available to attach to the operation row inserted right after. ──
      const { oldBalance: custOld, newBalance: custNew } = await mutateCustomerBalance(tx, customerId, storeId, { delta });

      // ── Phase 3: insert customer_operation (needed for FK link in caisse_movement) ──
      const [inserted] = await tx.insert(schema.customerOperationsTable).values({
        customerId,
        storeId,
        type,
        amount: amountStr,
        date,
        reference: reference || null,
        note: note || null,
        createdBy: actorUserId,
        caisseId: resolvedCaisseId,
        balanceBefore: custOld.toFixed(2),
        balanceAfter: custNew.toFixed(2),
      }).returning();

      // ── Phase 4: caisse movements + accounting (linked to customer operation) ──
      if (type === "versement" && resolvedCaisseId !== null) {
        const { oldBalance: caisseOld, newBalance: caisseNew } = await applyCaisseDelta(tx, resolvedCaisseId, numAmount);
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: resolvedCaisseId,
          type: "credit",
          amount: amountStr,
          reason: "customer_payment",
          customerOperationId: inserted.id,
          actorUserId,
          notes: `Versement client #${customerId}${reference ? ` - ${reference}` : ""}`,
          balanceBefore: caisseOld.toFixed(2),
          balanceAfter: caisseNew.toFixed(2),
        });
        await tx.insert(schema.transactionsTable).values({
          storeId,
          type: "income",
          category: "other",
          amount: amountStr,
          description: `Versement client #${customerId}${reference ? ` - ${reference}` : ""}`,
          date,
          reference: reference || null,
        });
      } else if (type === "remboursement" && resolvedCaisseId !== null) {
        const { oldBalance: caisseOld, newBalance: caisseNew } = await applyCaisseDelta(tx, resolvedCaisseId, -numAmount);
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: resolvedCaisseId,
          type: "debit",
          amount: amountStr,
          reason: "customer_payment",
          customerOperationId: inserted.id,
          actorUserId,
          notes: `Remboursement client #${customerId}${reference ? ` - ${reference}` : ""}`,
          balanceBefore: caisseOld.toFixed(2),
          balanceAfter: caisseNew.toFixed(2),
        });
        // No accounting transaction for remboursement — it is already accounted for
        // in the returns P&L; recording it as an expense here would double-count it.
      } else if (type === "vente_a_terme") {
        // Recognize income at time of sale (deferred receivable)
        await tx.insert(schema.transactionsTable).values({
          storeId,
          type: "income",
          category: "sales",
          amount: amountStr,
          description: `Vente à terme client #${customerId}${reference ? ` - ${reference}` : ""}`,
          date,
          reference: reference || null,
        });
      }

      return inserted;
    });
    if (resolvedCaisseId !== null) {
      await broadcastCaisseChanged(storeId, [resolvedCaisseId]);
    }
    res.status(201).json(op);
  } catch (err: any) {
    if (err?.statusCode === 400) { res.status(400).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/erp/customers/:id/operations/:opId", authenticate, requireStaff, requireStore, requirePermission("customers", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    const opId = pid(req, "opId");
    const { type, amount, date, reference, note } = req.body || {};
    if (!type || !amount || !date) {
      res.status(400).json({ error: "type, amount and date are required" });
      return;
    }
    if (!["versement", "remboursement", "vente_a_terme"].includes(type)) {
      res.status(400).json({ error: "type must be versement, remboursement or vente_a_terme" });
      return;
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.customerOperationsTable)
        .where(and(
          eq(schema.customerOperationsTable.id, opId),
          eq(schema.customerOperationsTable.customerId, customerId),
          eq(schema.customerOperationsTable.storeId, storeId),
        ));
      if (!existing) return null;

      // Posted operations (versement/remboursement with caisse side effects) are
      // immutable on amount and type — only note, reference and date can be updated.
      const isPosted = existing.caisseId !== null && (existing.type === "versement" || existing.type === "remboursement");
      if (isPosted) {
        if (existing.type !== type || Number(existing.amount) !== numAmount) {
          throw Object.assign(
            new Error("Le montant et le type d'un versement/remboursement enregistré ne peuvent pas être modifiés. Supprimez et re-créez l'opération."),
            { statusCode: 400 }
          );
        }
        // Allow only note/reference/date update
        const [op] = await tx.update(schema.customerOperationsTable)
          .set({ date, reference: reference || null, note: note || null })
          .where(eq(schema.customerOperationsTable.id, opId))
          .returning();
        return op;
      }

      // Compute balance delta: reverse old effect, apply new effect
      const oldDelta = existing.type === "versement" ? -Number(existing.amount) : Number(existing.amount);
      const newDelta = type === "versement" ? -numAmount : numAmount;
      // Credit limit check for vente_a_terme — same unified-balance logic as POST.
      if (type === "vente_a_terme") {
        const profileResult = await tx.execute(sql`
          SELECT cp.credit_limit,
                 CASE WHEN c.id IS NOT NULL THEN c.current_balance
                      ELSE cp.current_balance END AS current_balance
          FROM customer_profiles cp
          LEFT JOIN contacts c ON c.id = cp.contact_id AND c.contact_type = 'customer_supplier'
          WHERE cp.user_id = ${customerId} AND cp.store_id = ${storeId}
          LIMIT 1
        `);
        const profile = profileResult.rows[0] as { credit_limit: string | null; current_balance: string | null } | undefined;
        const creditLimit = Number(profile?.credit_limit ?? 0);
        const currentBalance = Number(profile?.current_balance ?? 0);
        const projected = currentBalance - oldDelta + numAmount;
        if (projected > creditLimit) {
          throw Object.assign(new Error("Plafond de crédit dépassé."), { statusCode: 400 });
        }
      }
      const balanceDiff = newDelta - oldDelta;
      const { oldBalance: custOld, newBalance: custNew } = await mutateCustomerBalance(tx, customerId, storeId, { delta: balanceDiff });
      const [op] = await tx.update(schema.customerOperationsTable)
        .set({
          type, amount: numAmount.toFixed(2), date, reference: reference || null, note: note || null,
          balanceBefore: custOld.toFixed(2), balanceAfter: custNew.toFixed(2),
        })
        .where(eq(schema.customerOperationsTable.id, opId))
        .returning();
      return op;
    });
    if (!updated) { res.status(404).json({ error: "Operation not found" }); return; }
    res.json(updated);
  } catch (err: any) {
    if (err?.statusCode === 400) { res.status(400).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/erp/customers/:id/operations/:opId", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    const opId = pid(req, "opId");
    const force = req.query.force === "true";
    const deleted = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.customerOperationsTable)
        .where(and(
          eq(schema.customerOperationsTable.id, opId),
          eq(schema.customerOperationsTable.customerId, customerId),
          eq(schema.customerOperationsTable.storeId, storeId),
        ));
      if (!existing) return null;

      // Protection 1: vente_a_terme linked to a confirmed order cannot be deleted
      // without explicit ?force=true query param.
      if (existing.type === "vente_a_terme" && existing.reference && !force) {
        // Reference pattern is FV-XXXXXX → order id = parseInt(ref.replace('FV-',''))
        const match = /^FV-(\d+)$/i.exec(existing.reference);
        if (match) {
          const linkedOrderId = parseInt(match[1]);
          const [linkedOrder] = await tx.select({ id: schema.ordersTable.id, status: schema.ordersTable.status })
            .from(schema.ordersTable)
            .where(and(eq(schema.ordersTable.id, linkedOrderId), eq(schema.ordersTable.storeId, storeId)))
            .limit(1);
          if (linkedOrder && !["cancelled", "returned"].includes(linkedOrder.status)) {
            throw Object.assign(
              new Error("Cette vente à terme est liée à une commande confirmée. Ajoutez ?force=true pour forcer la suppression."),
              { statusCode: 409 }
            );
          }
        }
      }

      // Protection 2: posted versement/remboursement (caisse side-effects already applied)
      // require explicit ?force=true because deletion will reverse accounting entries.
      // This prevents accidental removal of financial records.
      if (!force && existing.caisseId !== null && (existing.type === "versement" || existing.type === "remboursement")) {
        throw Object.assign(
          new Error(
            `Ce ${existing.type} a déjà été enregistré en caisse (entrée comptable créée). ` +
            `Ajoutez ?force=true pour annuler l'opération et inverser les écritures.`
          ),
          { statusCode: 409 }
        );
      }

      // Reverse the operation's effect on customer balance
      const delta = existing.type === "versement" ? Number(existing.amount) : -Number(existing.amount);
      await tx.delete(schema.customerOperationsTable).where(eq(schema.customerOperationsTable.id, opId));
      await mutateCustomerBalance(tx, customerId, storeId, { delta });
      // Reverse caisse and accounting side effects for posted versement/remboursement
      if (existing.caisseId !== null && (existing.type === "versement" || existing.type === "remboursement")) {
        const actorUserId = (req as AuthRequest).user!.id;
        const amountStr = Number(existing.amount).toFixed(2);
        const today = new Date().toISOString().split("T")[0];

        if (existing.type === "versement") {
          // Reverse: debit caisse + expense accounting
          const { oldBalance: caisseOld, newBalance: caisseNew } = await applyCaisseDelta(tx, existing.caisseId, -Number(existing.amount));
          await tx.insert(schema.caisseMovementsTable).values({
            caisseId: existing.caisseId,
            type: "debit",
            amount: amountStr,
            reason: "adjustment",
            actorUserId,
            notes: `Annulation versement client #${customerId}`,
            balanceBefore: caisseOld.toFixed(2),
            balanceAfter: caisseNew.toFixed(2),
          });
          await tx.insert(schema.transactionsTable).values({
            storeId,
            type: "expense",
            category: "other",
            amount: amountStr,
            description: `Annulation versement client #${customerId}`,
            date: today,
            reference: `CANCEL-VERS-${opId}`,
          });
        } else {
          // remboursement reversal: credit caisse + income accounting
          const { oldBalance: caisseOld, newBalance: caisseNew } = await applyCaisseDelta(tx, existing.caisseId, Number(existing.amount));
          await tx.insert(schema.caisseMovementsTable).values({
            caisseId: existing.caisseId,
            type: "credit",
            amount: amountStr,
            reason: "adjustment",
            actorUserId,
            notes: `Annulation remboursement client #${customerId}`,
            balanceBefore: caisseOld.toFixed(2),
            balanceAfter: caisseNew.toFixed(2),
          });
          await tx.insert(schema.transactionsTable).values({
            storeId,
            type: "income",
            category: "other",
            amount: amountStr,
            description: `Annulation remboursement client #${customerId}`,
            date: today,
            reference: `CANCEL-REMB-${opId}`,
          });
        }
      }

      return existing;
    });
    if (!deleted) { res.status(404).json({ error: "Operation not found" }); return; }
    if (deleted.caisseId !== null && (deleted.type === "versement" || deleted.type === "remboursement")) {
      await broadcastCaisseChanged(storeId, [deleted.caisseId]);
    }
    res.status(204).send();
  } catch (err: any) {
    if (err?.statusCode === 409) { res.status(409).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Customer Sale Items (for return dialog) ───────────────────────
// GET /erp/customers/:id/sale-items
// Returns all order items purchased by this customer in this store,
// to allow staff to quickly build a return from the customer's history.
router.get("/erp/customers/:id/sale-items", authenticate, requireStaff, requireStore, requirePermission("orders", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    // Group by product so each product appears once with total qty sold and
    // total qty returned. This ensures the returnableQty (sold − returned) is
    // correct even when the same product was purchased across multiple orders.
    // returnedQty aggregates ALL customer returns for that product in this store:
    // both order-linked (original_order_id IN customer's orders) and standalone
    // (client_user_id = customer, original_order_id IS NULL), so a return created
    // from this panel (standalone) is counted on the next fetch.
    const result = await db.execute(sql`
      SELECT
        oi.product_id                     AS "productId",
        p.name_en                         AS "productNameEn",
        p.name_ar                         AS "productNameAr",
        MAX(oi.unit_price)                AS "unitPrice",
        SUM(oi.quantity)::int             AS "quantity",
        MAX(o.id)                         AS "orderId",
        MAX(o.created_at)                 AS "orderDate",
        MAX(o.order_source)               AS "orderSource",
        COALESCE(ret.returned_qty, 0)::int AS "returnedQty"
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN (
        SELECT bri.product_id,
               SUM(bri.quantity)::int AS returned_qty
        FROM bon_retour_items bri
        JOIN bon_retours br ON br.id = bri.bon_retour_id
        WHERE br.store_id = ${storeId}
          AND (
            br.original_order_id IN (
              SELECT id FROM orders
              WHERE user_id = ${customerId} AND store_id = ${storeId}
            )
            OR (br.client_user_id = ${customerId} AND br.original_order_id IS NULL)
          )
        GROUP BY bri.product_id
      ) ret ON ret.product_id = oi.product_id
      WHERE o.store_id       = ${storeId}
        AND o.user_id        = ${customerId}
        AND o.order_source  IN ('bon', 'pos')
        AND o.status        != 'cancelled'
      GROUP BY oi.product_id, p.name_en, p.name_ar, ret.returned_qty
      ORDER BY MAX(o.created_at) DESC
    `);
    res.json(result.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Customer Classifications ──────────────────────────────────────
router.get("/erp/customer-classifications", authenticate, requireStaff, requirePermission("customers", "view"), async (req, res) => {
  try {
    const rows = await db.select().from(schema.customerClassificationsTable)
      .orderBy(schema.customerClassificationsTable.sortOrder, schema.customerClassificationsTable.id);
    res.json(rows.map((r) => ({
      id: r.id, labelFr: r.labelFr, labelAr: r.labelAr,
      color: r.color, sortOrder: r.sortOrder,
    })));
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/customer-classifications", authenticate, requireAdmin, async (req, res) => {
  try {
    const { labelFr, labelAr, color, sortOrder } = req.body || {};
    if (!labelFr || !labelAr) { res.status(400).json({ error: "labelFr and labelAr required" }); return; }
    const [row] = await db.insert(schema.customerClassificationsTable)
      .values({ labelFr, labelAr, color: color || null, sortOrder: sortOrder ?? 0 }).returning();
    res.status(201).json({ id: row.id, labelFr: row.labelFr, labelAr: row.labelAr, color: row.color, sortOrder: row.sortOrder });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/customer-classifications/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { labelFr, labelAr, color, sortOrder } = req.body || {};
    const [row] = await db.update(schema.customerClassificationsTable)
      .set({ labelFr, labelAr, color: color || null, ...(sortOrder !== undefined && { sortOrder }) })
      .where(eq(schema.customerClassificationsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: row.id, labelFr: row.labelFr, labelAr: row.labelAr, color: row.color, sortOrder: row.sortOrder });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/customer-classifications/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    await db.delete(schema.customerClassificationsTable)
      .where(eq(schema.customerClassificationsTable.id, Number(req.params.id)));
    res.json({ success: true });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Price Tiers ──────────────────────────────────────────────────
router.get("/erp/price-tiers", authenticate, requireStaff, requirePermission("customers", "view"), async (req, res) => {
  try {
    const rows = await db.select().from(schema.priceTiersTable)
      .orderBy(schema.priceTiersTable.sortOrder, schema.priceTiersTable.id);
    res.json(rows.map((r) => ({
      id: r.id, labelFr: r.labelFr, labelAr: r.labelAr,
      code: r.code, sortOrder: r.sortOrder,
    })));
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/price-tiers", authenticate, requireAdmin, async (req, res) => {
  try {
    const { labelFr, labelAr, code, sortOrder } = req.body || {};
    if (!labelFr || !labelAr || !code) { res.status(400).json({ error: "labelFr, labelAr and code required" }); return; }
    const [row] = await db.insert(schema.priceTiersTable)
      .values({ labelFr, labelAr, code, sortOrder: sortOrder ?? 0 }).returning();
    res.status(201).json({ id: row.id, labelFr: row.labelFr, labelAr: row.labelAr, code: row.code, sortOrder: row.sortOrder });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/price-tiers/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { labelFr, labelAr, code, sortOrder } = req.body || {};
    const [row] = await db.update(schema.priceTiersTable)
      .set({ labelFr, labelAr, code, ...(sortOrder !== undefined && { sortOrder }) })
      .where(eq(schema.priceTiersTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: row.id, labelFr: row.labelFr, labelAr: row.labelAr, code: row.code, sortOrder: row.sortOrder });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/price-tiers/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    await db.delete(schema.priceTiersTable).where(eq(schema.priceTiersTable.id, Number(req.params.id)));
    res.json({ success: true });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Staff (system users with admin/employee role) ────────────────
// Cross-store: list & manage users, plus their per-store grants.
router.get("/erp/staff", authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT u.id, u.name, u.email, u.role, u.phone, u.created_at,
        COALESCE(
          (SELECT json_agg(json_build_object('id', s.id, 'nameEn', s.name_en, 'nameAr', s.name_ar, 'slug', s.slug))
           FROM user_stores us JOIN stores s ON s.id = us.store_id
           WHERE us.user_id = u.id),
          '[]'::json
        ) AS stores
      FROM users u
      WHERE u.role IN ('admin', 'employee')
      ORDER BY u.created_at DESC
    `);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/staff", authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, email: rawStaffEmail, password, role, phone, storeIds } = req.body || {};
    if (!name || !rawStaffEmail || !password) {
      res.status(400).json({ error: "name, email and password are required" });
      return;
    }
    const email = normalizeEmail(rawStaffEmail);
    if (String(password).length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    const wantedRole = role === "admin" ? "admin" : "employee";
    const existing = await db.select({ id: schema.usersTable.id })
      .from(schema.usersTable).where(sql`lower(trim(${schema.usersTable.email})) = ${email}`).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const [user] = await db.insert(schema.usersTable).values({
      name, email, passwordHash,
      role: wantedRole,
      phone: phone || null,
    }).returning();

    // Attach to stores. Admins default to ALL stores; employees fall back
    // to the first active store when none are explicitly specified. Employees
    // may now be assigned to multiple stores (multi-store access).
    let targetStoreIds: number[] = Array.isArray(storeIds) ? storeIds.filter((n: unknown) => Number.isInteger(n)) : [];
    if (targetStoreIds.length === 0) {
      const all = await db.select({ id: schema.storesTable.id }).from(schema.storesTable)
        .where(eq(schema.storesTable.isActive, true)).orderBy(schema.storesTable.id);
      if (wantedRole === "admin") targetStoreIds = all.map(s => s.id);
      else if (all.length) targetStoreIds = [all[0].id];
    }
    if (targetStoreIds.length) {
      await db.insert(schema.userStoresTable)
        .values(targetStoreIds.map(storeId => ({ userId: user.id, storeId })))
        .onConflictDoNothing();
    }

    // Auto-create an employee record so this user appears in the HR/Employees page immediately.
    // Uses the first assigned store; position defaults to role name. Salary starts at 0.
    const empStoreId = targetStoreIds[0];
    if (empStoreId) {
      const today = new Date().toISOString().split("T")[0];
      await db.insert(schema.employeesTable).values({
        storeId: empStoreId,
        userId: user.id,
        name: user.name,
        email: user.email ?? null,
        phone: user.phone ?? null,
        position: wantedRole === "admin" ? "مسؤول" : "موظف",
        salary: "0",
        status: "active",
        hireDate: today,
      }).onConflictDoNothing();
    }

    res.status(201).json({
      id: user.id, name: user.name, email: user.email,
      role: user.role, phone: user.phone, created_at: user.createdAt,
      storeIds: targetStoreIds,
    });
  } catch (err) {
    if (isEmailUniqueViolation(err)) { res.status(409).json({ error: "A user with this email already exists" }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/erp/staff/:id/stores", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const targetId = pid(req, "id");
    const { storeIds } = req.body || {};
    if (!Array.isArray(storeIds) || storeIds.some((n: unknown) => !Number.isInteger(n))) {
      res.status(400).json({ error: "storeIds must be an array of integers" });
      return;
    }
    if (storeIds.length === 0) {
      res.status(400).json({ error: "A staff member must have access to at least one store" });
      return;
    }
    const [target] = await db.select({ role: schema.usersTable.role })
      .from(schema.usersTable).where(eq(schema.usersTable.id, targetId)).limit(1);
    if (!target) { res.status(404).json({ error: "Staff not found" }); return; }
    if (target.role === "customer") {
      res.status(400).json({ error: "Cannot assign stores to customer accounts" });
      return;
    }
    await db.delete(schema.userStoresTable).where(eq(schema.userStoresTable.userId, targetId));
    await db.insert(schema.userStoresTable)
      .values((storeIds as number[]).map(storeId => ({ userId: targetId, storeId })))
      .onConflictDoNothing();
    res.json({ success: true, userId: targetId, storeIds });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /erp/staff/:id/role — admin: promote employee → admin or demote admin → employee.
// Cannot change your own role. Cannot demote the last remaining admin.
router.put("/erp/staff/:id/role", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const targetId = pid(req, "id");
    const { role } = req.body || {};
    if (role !== "admin" && role !== "employee") {
      res.status(400).json({ error: "role must be 'admin' or 'employee'" });
      return;
    }
    if (req.user?.id === targetId) {
      res.status(400).json({ error: "Cannot change your own role" });
      return;
    }
    const [target] = await db.select({ role: schema.usersTable.role })
      .from(schema.usersTable).where(eq(schema.usersTable.id, targetId)).limit(1);
    if (!target) { res.status(404).json({ error: "Staff not found" }); return; }
    if (target.role === "customer") {
      res.status(400).json({ error: "Not a staff account" });
      return;
    }
    // Guard: do not demote the last admin
    if (role === "employee" && target.role === "admin") {
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
        .from(schema.usersTable).where(eq(schema.usersTable.role, "admin"));
      if (Number(count) <= 1) {
        res.status(400).json({ error: "Cannot demote the last administrator" });
        return;
      }
    }
    await db.update(schema.usersTable)
      .set({ role })
      .where(eq(schema.usersTable.id, targetId));
    res.json({ success: true, userId: targetId, role });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /erp/staff/:id/password — admin: reset a staff member's password.
// Stores a fresh bcrypt hash; never reads or returns the existing password.
router.put("/erp/staff/:id/password", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const targetId = pid(req, "id");
    const { password } = req.body || {};
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    const [target] = await db.select({ role: schema.usersTable.role })
      .from(schema.usersTable).where(eq(schema.usersTable.id, targetId)).limit(1);
    if (!target) { res.status(404).json({ error: "Staff not found" }); return; }
    if (target.role === "customer") {
      res.status(400).json({ error: "Not a staff account" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await db.update(schema.usersTable)
      .set({ passwordHash })
      .where(eq(schema.usersTable.id, targetId));
    res.json({ success: true, userId: targetId });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/staff/:id", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const targetId = pid(req, "id");
    if (req.user?.id === targetId) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    const [user] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.id, targetId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    if (user.role === "customer") { res.status(400).json({ error: "Not a staff account" }); return; }
    // Deleting the user row automatically sets employees.user_id = NULL (FK ON DELETE SET NULL),
    // preserving HR history (attendance, leaves, salary). No explicit employee delete needed.
    await db.delete(schema.usersTable).where(eq(schema.usersTable.id, targetId));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Smart Purchase ──────────────────────────────────────────────────────────
// GET /erp/purchases/needed — paginated low-stock products sorted by profit or qty sold
// Query params: sortBy ("profit"|"qty_sold"), stockFilter ("all"|"rupture"|"low"),
//               limit (default 10, max 500), offset (default 0),
//               supplierId, familyId, brandId, supplierCity, search, dateFrom, dateTo
// Response: { rows: NeededRow[], ruptureTotal: number, lowTotal: number }
router.get("/erp/purchases/needed", authenticate, requireStaff, requireStore, requirePermission("purchases", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { supplierId, familyId, brandId, supplierCity, search, sortBy, dateFrom, dateTo,
            stockFilter: sfParam, limit: limitStr, offset: offsetStr } = req.query as Record<string, string | undefined>;
    const orderByQty = sortBy === "qty_sold";
    const PAGE_SIZE  = 10;
    const limit  = Math.min(500, Math.max(1, parseInt(limitStr  ?? String(PAGE_SIZE), 10) || PAGE_SIZE));
    const offset = Math.max(0,               parseInt(offsetStr ?? "0",                10) || 0);
    const sf     = sfParam === "rupture" ? "rupture" : sfParam === "low" ? "low" : "all";
    const stockSql = sf === "rupture" ? sql` AND br.stock = 0`
                   : sf === "low"     ? sql` AND br.stock > 0`
                   : sql``;

    const supplierFilter = supplierId   ? sql` AND ls.supplier_id = ${parseInt(supplierId, 10)}`                                                                                                                                            : sql``;
    const familyFilter   = familyId     ? sql` AND p.family_id = ${parseInt(familyId, 10)}`                                                                                                                                                 : sql``;
    const brandFilter    = brandId      ? sql` AND p.brand_id = ${parseInt(brandId, 10)}`                                                                                                                                                   : sql``;
    const cityFilter     = supplierCity ? sql` AND lower(sup.address) LIKE ${`%${supplierCity.toLowerCase()}%`}`                                                                                                                             : sql``;
    const searchFilter   = search       ? sql` AND (lower(p.name_en) LIKE ${`%${search.toLowerCase()}%`} OR lower(p.name_ar) LIKE ${`%${search.toLowerCase()}%`} OR lower(COALESCE(p.reference,'')) LIKE ${`%${search.toLowerCase()}%`})` : sql``;
    const dateFilter     = (dateFrom && dateTo)
      ? sql` AND o.created_at BETWEEN ${dateFrom}::timestamp AND (${dateTo}::timestamp + INTERVAL '1 day')`
      : dateFrom ? sql` AND o.created_at >= ${dateFrom}::timestamp`
      : dateTo   ? sql` AND o.created_at < (${dateTo}::timestamp + INTERVAL '1 day')`
      : sql``;

    // ── Restructured query: base_rows CTE materialises the full filtered set (sans
    //    tab/stockFilter), counts CTE derives tab totals in one pass, outer SELECT
    //    applies the tab filter + pagination. All CTEs are scanned once each. ──
    const result = await db.execute(sql`
      WITH
      -- 1. Sales totals for every product in this store (one pass over order_items)
      sales_agg AS (
        SELECT
          oi.product_id,
          SUM(oi.quantity::numeric *
              (oi.unit_price::numeric
               - COALESCE(oi.cost_price, 0)::numeric))   AS benefice,
          SUM(oi.quantity::numeric)                       AS total_qty_sold
        FROM   order_items oi
        JOIN   orders      o  ON o.id = oi.order_id
        WHERE  o.store_id   = ${storeId}
          AND  o.status NOT IN ('cancelled', 'draft')
          ${dateFilter}
        GROUP  BY oi.product_id
      ),
      -- 2. Last received supplier per product (one pass over purchase_items)
      last_sup AS (
        SELECT DISTINCT ON (pi.product_id)
          pi.product_id,
          po.supplier_id
        FROM   purchase_items  pi
        JOIN   purchase_orders po ON po.id = pi.purchase_order_id
        WHERE  po.store_id = ${storeId}
          AND  po.status   = 'received'
        ORDER  BY pi.product_id,
                  COALESCE(po.received_at, po.created_at) DESC
      ),
      -- 3. Snoozed products for this store (tiny scan)
      snoozed AS (
        SELECT product_id
        FROM   purchase_snooze
        WHERE  store_id     = ${storeId}
          AND  snoozed_until > NOW()
      ),
      -- 4. Cross-store in-stock references/barcodes (one scan, used for anti-join)
      cross_avail AS (
        SELECT reference, barcode
        FROM   products
        WHERE  store_id  != ${storeId}
          AND  is_active  = true
          AND  stock      > 0
          AND  (
            (reference IS NOT NULL AND reference != '')
            OR (barcode IS NOT NULL AND barcode != '')
          )
      ),
      -- 5. Full filtered result set WITHOUT tab/stockFilter — used for counts + pagination
      base_rows AS (
        SELECT
          p.id,
          p.name_en        AS designation,
          p.name_ar        AS designation_ar,
          p.image_url,
          p.stock,
          p.min_stock,
          p.cost_price,
          p.price,
          p.reference,
          pf.name_fr       AS famille,
          pf.name_ar       AS famille_ar,
          pb.name_fr       AS marque,
          sup.id           AS supplier_id,
          sup.name         AS supplier_name,
          sup.address      AS supplier_city,
          sup.phone        AS supplier_phone,
          COALESCE(sa.benefice,       0) AS benefice,
          COALESCE(sa.total_qty_sold, 0) AS total_qty_sold
        FROM   products         p
        LEFT JOIN product_families  pf  ON pf.id  = p.family_id
        LEFT JOIN product_brands    pb  ON pb.id  = p.brand_id
        LEFT JOIN last_sup          ls  ON ls.product_id  = p.id
        LEFT JOIN suppliers         sup ON sup.id = ls.supplier_id
        LEFT JOIN sales_agg         sa  ON sa.product_id  = p.id
        LEFT JOIN snoozed           sn  ON sn.product_id  = p.id
        WHERE  p.store_id              = ${storeId}
          AND  p.is_active             = true
          AND  (
            p.stock = 0
            OR (p.min_stock IS NOT NULL AND p.stock <= p.min_stock)
          )
          AND  p.excluded_from_purchase = false
          AND  sn.product_id IS NULL
          AND NOT (
            (p.reference IS NOT NULL AND p.reference != ''
              AND EXISTS (SELECT 1 FROM cross_avail ca WHERE ca.reference = p.reference))
            OR
            (COALESCE(p.reference, '') = '' AND p.barcode IS NOT NULL AND p.barcode != ''
              AND EXISTS (SELECT 1 FROM cross_avail ca WHERE ca.barcode = p.barcode))
          )
          ${familyFilter}
          ${brandFilter}
          ${searchFilter}
          ${supplierFilter}
          ${cityFilter}
      ),
      -- 6. Tab totals derived in a single pass over base_rows
      counts AS (
        SELECT
          COUNT(*) FILTER (WHERE stock = 0)::int  AS rupture_total,
          COUNT(*) FILTER (WHERE stock > 0)::int  AS low_total
        FROM base_rows
      )
      -- Final: apply tab filter + sort + pagination; join counts as constant columns
      SELECT br.*, c.rupture_total, c.low_total
      FROM   base_rows br, counts c
      WHERE  TRUE ${stockSql}
      ORDER  BY ${orderByQty ? sql`br.total_qty_sold DESC NULLS LAST` : sql`br.benefice DESC NULLS LAST`}
      LIMIT  ${limit} OFFSET ${offset}
    `);

    type RawRow = Record<string, unknown> & { rupture_total: number; low_total: number };
    const raw         = result.rows as RawRow[];
    const ruptureTotal = raw[0]?.rupture_total ?? 0;
    const lowTotal     = raw[0]?.low_total     ?? 0;

    res.json({
      rows: raw.map(({ rupture_total, low_total, ...r }) => r),
      ruptureTotal,
      lowTotal,
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/purchases/filter-options — families, brands & supplier cities (purchases:view, no settings perm needed)
router.get("/erp/purchases/filter-options", authenticate, requireStaff, requireStore, requirePermission("purchases", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const [families, brands, citiesRaw] = await Promise.all([
      db.select({ id: schema.productFamiliesTable.id, nameFr: schema.productFamiliesTable.nameFr, nameAr: schema.productFamiliesTable.nameAr })
        .from(schema.productFamiliesTable)
        .where(eq(schema.productFamiliesTable.storeId, storeId))
        .orderBy(schema.productFamiliesTable.nameFr),
      db.select({ id: schema.productBrandsTable.id, nameFr: schema.productBrandsTable.nameFr, nameAr: schema.productBrandsTable.nameAr })
        .from(schema.productBrandsTable)
        .where(eq(schema.productBrandsTable.storeId, storeId))
        .orderBy(schema.productBrandsTable.nameFr),
      db.selectDistinct({ city: schema.suppliersTable.address })
        .from(schema.suppliersTable)
        .where(and(
          eq(schema.suppliersTable.storeId, storeId),
          sql`${schema.suppliersTable.address} IS NOT NULL AND TRIM(${schema.suppliersTable.address}) <> ''`,
        ))
        .orderBy(schema.suppliersTable.address),
    ]);
    const supplierCities = citiesRaw.map(r => r.city).filter((c): c is string => !!c);
    res.json({ families, brands, supplierCities });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/purchases/auto-min-stock/preview — compute suggested thresholds without applying them
router.get("/erp/purchases/auto-min-stock/preview", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;

    const rows = await db.execute(sql`
      WITH sales_3mo AS (
        SELECT
          oi.product_id,
          CEIL(SUM(oi.quantity::numeric) / 3.0)::int AS suggested
        FROM   order_items  oi
        JOIN   orders       o  ON o.id = oi.order_id
        WHERE  o.store_id  = ${storeId}
          AND  o.status   NOT IN ('cancelled', 'draft')
          AND  o.created_at >= NOW() - INTERVAL '3 months'
        GROUP  BY oi.product_id
        HAVING SUM(oi.quantity::numeric) > 0
      )
      SELECT
        p.id            AS product_id,
        p.name_en       AS name,
        p.name_ar       AS name_ar,
        p.min_stock     AS current_min_stock,
        s.suggested     AS suggested
      FROM   products   p
      JOIN   sales_3mo  s ON s.product_id = p.id
      WHERE  p.store_id  = ${storeId}
        AND  p.is_active = true
      ORDER BY p.name_en ASC
    `);

    res.json({ rows: rows.rows });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/purchases/auto-min-stock — bulk-set min_stock = CEIL(avg monthly qty sold over 3 months)
// Body (optional): { productIds?: number[], protectManual?: boolean }
//   productIds    — when provided, only update these specific product IDs.
//                   An empty array [] is treated as "apply to none" (no-op, returns 0 updated).
//   protectManual — when true, skip products that already have a non-null min_stock
router.post("/erp/purchases/auto-min-stock", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { productIds, protectManual } = req.body as { productIds?: number[]; protectManual?: boolean };

    const isSelective = Array.isArray(productIds);

    // Runtime validation — reject any non-integer values to prevent injection
    if (isSelective && !productIds!.every(id => Number.isFinite(id) && Number.isInteger(id))) {
      res.status(400).json({ error: "productIds must be an array of integers" });
      return;
    }

    // If caller sent an explicit empty array, there is nothing to update.
    if (isSelective && productIds!.length === 0) {
      res.json({ updated: 0, skipped: 0 });
      return;
    }

    // Use fully-bound ARRAY[...] syntax (same pattern as products.ts) — no raw interpolation
    const idFilter = isSelective
      ? sql` AND p.id = ANY(ARRAY[${sql.join(productIds!.map(id => sql`${id}`), sql`, `)}]::int[])`
      : sql``;
    const manualFilter = protectManual ? sql` AND p.min_stock IS NULL` : sql``;

    // Compute per-product ceiling of average monthly qty over the last 3 months,
    // then bulk-update min_stock only for products that have qualifying sales.
    const updated = await db.execute(sql`
      WITH sales_3mo AS (
        SELECT
          oi.product_id,
          CEIL(SUM(oi.quantity::numeric) / 3.0)::int AS monthly_avg
        FROM   order_items  oi
        JOIN   orders       o  ON o.id = oi.order_id
        WHERE  o.store_id  = ${storeId}
          AND  o.status   NOT IN ('cancelled', 'draft')
          AND  o.created_at >= NOW() - INTERVAL '3 months'
        GROUP  BY oi.product_id
        HAVING SUM(oi.quantity::numeric) > 0
      )
      UPDATE products p
         SET min_stock = s.monthly_avg
        FROM sales_3mo s
       WHERE p.id       = s.product_id
         AND p.store_id = ${storeId}
         AND p.is_active = true
         ${idFilter}
         ${manualFilter}
      RETURNING p.id
    `);
    const updatedCount = updated.rows.length;

    // Compute `skipped` relative to the scoped candidate set, not all active products.
    // Candidate = active products that qualified for update (had sales, passed id/manual filters).
    // We count those same candidates minus the ones actually written.
    const candidateResult = await db.execute(sql`
      WITH sales_3mo AS (
        SELECT oi.product_id
        FROM   order_items  oi
        JOIN   orders       o  ON o.id = oi.order_id
        WHERE  o.store_id  = ${storeId}
          AND  o.status   NOT IN ('cancelled', 'draft')
          AND  o.created_at >= NOW() - INTERVAL '3 months'
        GROUP  BY oi.product_id
        HAVING SUM(oi.quantity::numeric) > 0
      )
      SELECT COUNT(*)::int AS cnt
      FROM   products p
      JOIN   sales_3mo s ON s.product_id = p.id
      WHERE  p.store_id  = ${storeId}
        AND  p.is_active = true
        ${idFilter}
        ${manualFilter}
    `);
    const candidateCount = Number((candidateResult.rows[0] as { cnt: number } | undefined)?.cnt ?? 0);
    const skipped = Math.max(0, candidateCount - updatedCount);

    res.json({ updated: updatedCount, skipped });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/purchases/reset-min-stock — set min_stock = NULL for all active products in store
router.post("/erp/purchases/reset-min-stock", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;

    const result = await db.execute(sql`
      UPDATE products
         SET min_stock = NULL
       WHERE store_id = ${storeId}
         AND is_active = true
         AND min_stock IS NOT NULL
      RETURNING id
    `);

    res.json({ reset: result.rows.length });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/purchases/snooze/:productId — mark a product as "bought", hide for 24 h
router.post("/erp/purchases/snooze/:productId", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId   = req.currentStoreId!;
    const productId = pid(req, "productId");
    // Store-ownership check: product must belong to current store
    const [prod] = await db.select({ id: schema.productsTable.id })
      .from(schema.productsTable)
      .where(and(eq(schema.productsTable.id, productId), eq(schema.productsTable.storeId, storeId)))
      .limit(1);
    if (!prod) { res.status(404).json({ error: "Product not found in current store" }); return; }
    await db.execute(sql`
      INSERT INTO purchase_snooze (product_id, store_id, snoozed_until)
      VALUES (${productId}, ${storeId}, NOW() + INTERVAL '24 hours')
      ON CONFLICT (product_id, store_id)
      DO UPDATE SET snoozed_until = NOW() + INTERVAL '24 hours'
    `);
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/purchases/exclude/:productId — check if a product is permanently excluded
router.get("/erp/purchases/exclude/:productId", authenticate, requireStaff, requireStore, requirePermission("purchases", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId   = req.currentStoreId!;
    const productId = pid(req, "productId");
    const result = await db.execute(sql`
      SELECT excluded_from_purchase FROM products WHERE id = ${productId} AND store_id = ${storeId} LIMIT 1
    `);
    const row = result.rows[0] as { excluded_from_purchase: boolean } | undefined;
    res.json({ excluded: row?.excluded_from_purchase ?? false });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/purchases/exclude/:productId — permanently hide product from Besoin d'Achats
router.post("/erp/purchases/exclude/:productId", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId   = req.currentStoreId!;
    const productId = pid(req, "productId");
    await db.execute(sql`
      UPDATE products SET excluded_from_purchase = true WHERE id = ${productId} AND store_id = ${storeId}
    `);
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// DELETE /erp/purchases/exclude/:productId — re-include product in Besoin d'Achats
router.delete("/erp/purchases/exclude/:productId", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId   = req.currentStoreId!;
    const productId = pid(req, "productId");
    await db.execute(sql`
      UPDATE products SET excluded_from_purchase = false WHERE id = ${productId} AND store_id = ${storeId}
    `);
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/purchases/history/:productId — purchase history rows (received POs only)
router.get("/erp/purchases/history/:productId", authenticate, requireStaff, requireStore, requirePermission("purchases", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId   = req.currentStoreId!;
    const productId = pid(req, "productId");
    const result = await db.execute(sql`
      SELECT
        po.id                                        AS po_id,
        COALESCE(po.received_at, po.created_at)      AS received_date,
        s.name                                       AS supplier_name,
        s.address                                    AS supplier_address,
        s.phone                                      AS supplier_phone,
        CAST(pi.unit_cost AS numeric)                AS unit_cost,
        CAST(pi.quantity  AS numeric)                AS quantity,
        p.image_url,
        p.name_en                                    AS product_name,
        p.name_ar                                    AS product_name_ar
      FROM   purchase_items  pi
      JOIN   purchase_orders po ON po.id  = pi.purchase_order_id
      JOIN   suppliers       s  ON s.id   = po.supplier_id
      JOIN   products        p  ON p.id   = pi.product_id
      WHERE  pi.product_id = ${productId}
        AND  po.store_id   = ${storeId}
        AND  po.status     = 'received'
      ORDER  BY COALESCE(po.received_at, po.created_at) DESC
      LIMIT  50
    `);
    res.json(result.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Bons de Vente  (order_source = 'bon')
// ─────────────────────────────────────────────────────────────────────────────
// Helpers for sale-order payload validation
// ─────────────────────────────────────────────────────────────────────────────

type SaleOrderItem = { productId: number; quantity: number; unitPrice: number };

function validateSaleItems(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return "items must be a non-empty array";
  for (const it of items) {
    if (typeof it !== "object" || it === null) return "each item must be an object";
    const { productId, quantity, unitPrice } = it as Record<string, unknown>;
    if (!Number.isInteger(Number(productId)) || Number(productId) <= 0) return `invalid productId: ${String(productId)}`;
    if (typeof quantity !== "number" || !isFinite(quantity) || quantity <= 0) return `quantity must be a positive number`;
    if (typeof unitPrice !== "number" || !isFinite(unitPrice) || unitPrice < 0) return `unitPrice must be a non-negative number`;
  }
  return null;
}

// Verify all product IDs belong to the given store; return first invalid id or null.
async function checkProductsInStore(productIds: number[], storeId: number): Promise<number | null> {
  if (productIds.length === 0) return null;
  const rows = await db.execute(sql`SELECT id FROM products WHERE id = ANY(${sql.raw(`'{${productIds.join(",")}}'::int[]`)}) AND store_id = ${storeId}`);
  const found = new Set((rows.rows as Array<{ id: number }>).map(r => r.id));
  return productIds.find(id => !found.has(id)) ?? null;
}

// GET /erp/sale-orders
router.get("/erp/sale-orders", authenticate, requireStaff, requireStore, requirePermission("orders", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { page = "1", limit = "50", search, status, dateFrom, dateTo, orderSource, paymentMethod: pmFilter } = req.query as Record<string, string | undefined>;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const searchClause = search ? `AND (lower(o.customer_name) LIKE lower('%${search.replace(/'/g, "''")}%') OR CAST(o.id AS TEXT) LIKE '%${search.replace(/'/g, "''")}%')` : "";
    const statusClause = status ? `AND o.status = '${status.replace(/'/g, "''")}'` : "";
    const dateFromClause = dateFrom ? `AND o.created_at >= '${dateFrom.replace(/'/g, "''")}'::date` : "";
    const dateToClause = dateTo ? `AND o.created_at < ('${dateTo.replace(/'/g, "''")}'::date + INTERVAL '1 day')` : "";
    const orderSourceClause = orderSource && ["bon", "pos", "online"].includes(orderSource) ? `AND o.order_source = '${orderSource}'` : "";
    const pmClause = pmFilter && ["comptant", "a_terme"].includes(pmFilter) ? `AND o.payment_method = '${pmFilter}'` : "";

    const result = await db.execute(sql`
      SELECT
        o.id,
        o.status,
        o.order_source,
        o.customer_name,
        o.customer_phone,
        o.user_id,
        o.total_amount,
        o.discount_amount,
        o.created_at,
        o.updated_at,
        o.payment_method,
        COALESCE(SUM(
          CAST(oi.quantity AS numeric) * (CAST(oi.unit_price AS numeric) - COALESCE(CAST(oi.cost_price AS numeric), 0))
        ), 0)::numeric(14,2) AS benefice,
        COUNT(*) OVER() AS total_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.store_id = ${storeId}
        AND o.order_source IN ('bon', 'pos', 'online')
        ${sql.raw(searchClause)}
        ${sql.raw(statusClause)}
        ${sql.raw(dateFromClause)}
        ${sql.raw(dateToClause)}
        ${sql.raw(orderSourceClause)}
        ${sql.raw(pmClause)}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `);

    const rows = result.rows as Array<Record<string, unknown>>;
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    res.json({ data: rows.map(({ total_count: _tc, ...r }) => r), total, page: pageNum, limit: limitNum });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/sale-orders/:id
router.get("/erp/sale-orders/:id", authenticate, requireStaff, requireStore, requirePermission("orders", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const result = await db.execute(sql`
      SELECT
        o.id, o.status, o.customer_name, o.customer_phone, o.user_id,
        o.total_amount, o.discount_amount, o.created_at, o.updated_at, o.payment_method,
        COALESCE(json_agg(json_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'cost_price', oi.cost_price,
          'product_name_en', p.name_en,
          'product_name_ar', p.name_ar,
          'product_reference', p.reference
        ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.id = ${id} AND o.store_id = ${storeId} AND o.order_source IN ('bon', 'pos', 'online')
      GROUP BY o.id
    `);
    if (!result.rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result.rows[0]);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/sale-orders
router.post("/erp/sale-orders", authenticate, requireStaff, requireStore, requirePermission("orders", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { customerUserId, customerName, customerPhone, items, notes, paymentMethod } = req.body as {
      customerUserId?: number | null;
      customerName?: string;
      customerPhone?: string;
      items: SaleOrderItem[];
      notes?: string;
      paymentMethod?: string;
    };

    const validErr = validateSaleItems(items);
    if (validErr) { res.status(400).json({ error: validErr }); return; }

    const pm = paymentMethod === "a_terme" ? "a_terme" : "comptant";

    const productIds = (items as SaleOrderItem[]).map(i => Number(i.productId));
    const badId = await checkProductsInStore(productIds, storeId);
    if (badId !== null) { res.status(400).json({ error: `Product ${badId} does not belong to this store` }); return; }

    let cName = (customerName ?? "").trim() || "DIVERS COMPTOIR";
    let cPhone = (customerPhone ?? "").trim();

    if (customerUserId) {
      const profRes = await db.execute(sql`SELECT name, phone FROM users WHERE id = ${customerUserId} LIMIT 1`);
      const u = profRes.rows[0] as { name?: string; phone?: string } | undefined;
      if (u) { cName = u.name ?? cName; cPhone = u.phone ?? cPhone; }
    }

    const total = (items as SaleOrderItem[]).reduce((s, i) => s + i.quantity * i.unitPrice, 0);

    // Atomic: create order + items in one transaction
    const orderId = await db.transaction(async (tx) => {
      const orderRes = await tx.execute(sql`
        INSERT INTO orders (store_id, user_id, seller_user_id, customer_name, customer_phone, customer_address,
          status, total_amount, discount_amount, order_source, payment_method, coupon_code, created_at, updated_at)
        VALUES (
          ${storeId}, ${customerUserId ?? null}, ${req.user!.id},
          ${cName}, ${cPhone}, ${notes ?? ""},
          'pending', ${total.toFixed(2)}, '0', 'bon', ${pm}, NULL, NOW(), NOW()
        ) RETURNING id
      `);
      const newId = (orderRes.rows[0] as { id: number }).id;

      for (const item of items as SaleOrderItem[]) {
        const prodRes = await tx.execute(sql`SELECT cost_price FROM products WHERE id = ${item.productId} AND store_id = ${storeId} LIMIT 1`);
        const costPrice = (prodRes.rows[0] as { cost_price?: string | null } | undefined)?.cost_price ?? "0";
        await tx.execute(sql`
          INSERT INTO order_items (order_id, product_id, quantity, unit_price, cost_price)
          VALUES (${newId}, ${item.productId}, ${item.quantity}, ${item.unitPrice.toFixed(2)}, ${costPrice})
        `);
      }
      return newId;
    });

    res.status(201).json({ id: orderId });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /erp/sale-orders/:id
router.put("/erp/sale-orders/:id", authenticate, requireStaff, requireStore, requirePermission("orders", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const { customerUserId, customerName, customerPhone, items, notes, paymentMethod } = req.body as {
      customerUserId?: number | null;
      customerName?: string;
      customerPhone?: string;
      items: SaleOrderItem[];
      notes?: string;
      paymentMethod?: string;
    };

    const validErr = validateSaleItems(items);
    if (validErr) { res.status(400).json({ error: validErr }); return; }

    const pm = paymentMethod === "a_terme" ? "a_terme" : "comptant";

    const existRes = await db.execute(sql`SELECT id, status FROM orders WHERE id = ${id} AND store_id = ${storeId} AND order_source IN ('bon', 'pos') LIMIT 1`);
    const existing = existRes.rows[0] as { id: number; status: string } | undefined;
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status === "delivered" || existing.status === "cancelled") {
      res.status(400).json({ error: "Impossible de modifier un bon clôturé ou annulé" }); return;
    }

    const productIds = (items as SaleOrderItem[]).map(i => Number(i.productId));
    const badId = await checkProductsInStore(productIds, storeId);
    if (badId !== null) { res.status(400).json({ error: `Product ${badId} does not belong to this store` }); return; }

    let cName = (customerName ?? "").trim() || "DIVERS COMPTOIR";
    let cPhone = (customerPhone ?? "").trim();
    if (customerUserId) {
      const profRes = await db.execute(sql`SELECT name, phone FROM users WHERE id = ${customerUserId} LIMIT 1`);
      const u = profRes.rows[0] as { name?: string; phone?: string } | undefined;
      if (u) { cName = u.name ?? cName; cPhone = u.phone ?? cPhone; }
    }

    const total = (items as SaleOrderItem[]).reduce((s, i) => s + i.quantity * i.unitPrice, 0);

    // Atomic: update order + replace items in one transaction
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE orders SET
          user_id = ${customerUserId ?? null},
          customer_name = ${cName},
          customer_phone = ${cPhone},
          customer_address = ${notes ?? ""},
          total_amount = ${total.toFixed(2)},
          payment_method = ${pm},
          updated_at = NOW()
        WHERE id = ${id}
      `);
      await tx.execute(sql`DELETE FROM order_items WHERE order_id = ${id}`);
      for (const item of items as SaleOrderItem[]) {
        const prodRes = await tx.execute(sql`SELECT cost_price FROM products WHERE id = ${item.productId} AND store_id = ${storeId} LIMIT 1`);
        const costPrice = (prodRes.rows[0] as { cost_price?: string | null } | undefined)?.cost_price ?? "0";
        await tx.execute(sql`INSERT INTO order_items (order_id, product_id, quantity, unit_price, cost_price) VALUES (${id}, ${item.productId}, ${item.quantity}, ${item.unitPrice.toFixed(2)}, ${costPrice})`);
      }
    });

    res.json({ id, status: "updated" });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /erp/sale-orders/:id/cloture
router.put("/erp/sale-orders/:id/cloture", authenticate, requireStaff, requireStore, requirePermission("orders", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const actorUserId = req.user!.id;
    const id = pid(req, "id");

    const existRes = await db.execute(sql`
      SELECT id, status, payment_method, total_amount, user_id, customer_name, order_source
      FROM orders WHERE id = ${id} AND store_id = ${storeId} AND order_source IN ('bon', 'pos', 'online') LIMIT 1
    `);
    const existing = existRes.rows[0] as {
      id: number; status: string; payment_method: string | null;
      total_amount: string; user_id: number | null; customer_name: string;
      order_source: string;
    } | undefined;
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "draft" && existing.status !== "pending" && existing.status !== "processing") {
      res.status(400).json({ error: "Seuls les bons en cours (draft/pending/processing) peuvent être clôturés" }); return;
    }

    const totalAmount = parseFloat(existing.total_amount ?? "0");
    const paymentMethod = existing.payment_method ?? "comptant";
    const customerId = existing.user_id;
    const customerName = existing.customer_name;
    const today = new Date().toISOString().split("T")[0];
    const isPos = existing.order_source === "pos";
    const isOnline = existing.order_source === "online";
    const prefix = isOnline ? "WS" : isPos ? "VR" : "BV";
    const refCode = `${prefix}-${String(id).padStart(6, "0")}`;
    const sourceLabel = isOnline ? "Commande en ligne" : isPos ? "Vente rapide" : "Bon de vente";

    const itemsRes = await db.execute(sql`SELECT product_id, quantity FROM order_items WHERE order_id = ${id}`);
    const lineItems = itemsRes.rows as Array<{ product_id: number; quantity: number }>;

    let cloturedCaisseId: number | null = null;

    // Atomic: mark delivered + deduct stock + accounting + payment in one transaction
    await db.transaction(async (tx) => {
      // 1. Mark delivered — conditional on allowed statuses to prevent race with a concurrent cancel/cloture
      const gateRes = await tx.execute(sql`
        UPDATE orders SET status = 'delivered', updated_at = NOW()
        WHERE id = ${id} AND status IN ('draft', 'pending', 'processing')
        RETURNING id
      `);
      if (!gateRes.rows[0]) {
        throw Object.assign(new Error("Seuls les bons en cours (draft/pending/processing) peuvent être clôturés"), { statusCode: 409 });
      }

      // 2. Deduct stock
      for (const item of lineItems) {
        await tx.execute(sql`
          UPDATE products
          SET stock = GREATEST(0, COALESCE(stock, 0) - ${item.quantity})
          WHERE id = ${item.product_id} AND store_id = ${storeId}
        `);
      }

      // 3. Accounting entry (always recorded regardless of payment method)
      if (totalAmount > 0) {
        await tx.insert(schema.transactionsTable).values({
          storeId,
          type: "income",
          category: "sales",
          amount: totalAmount.toFixed(2),
          description: `${sourceLabel} ${refCode} - ${customerName}`,
          date: today,
          reference: refCode,
        });
      }

      // 4. Payment effect
      if (paymentMethod === "comptant" && totalAmount > 0) {
        // Credit the clôturing staff member's caisse
        const caisse = await ensureCaisse(storeId, actorUserId, tx);
        cloturedCaisseId = caisse.id;
        const { oldBalance, newBalance } = await applyCaisseDelta(tx, caisse.id, totalAmount);
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: caisse.id,
          type: "credit",
          amount: totalAmount.toFixed(2),
          reason: "sale",
          orderId: id,
          actorUserId,
          notes: `${sourceLabel} ${refCode} - ${customerName}`,
          balanceBefore: oldBalance.toFixed(2),
          balanceAfter: newBalance.toFixed(2),
        });
      } else if (paymentMethod === "a_terme" && customerId && totalAmount > 0) {
        // Record as customer receivable (positive delta = customer owes store)
        await mutateCustomerBalance(tx, customerId, storeId, { delta: totalAmount });
      }
    });

    // Broadcast caisse update if cash payment
    if (cloturedCaisseId !== null) {
      await broadcastCaisseChanged(storeId, [cloturedCaisseId]);
    }

    res.json({ id, status: "delivered", paymentMethod });
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 409) { res.status(409).json({ error: e.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /erp/sale-orders/:id/cancel
// Cancels an online order that hasn't been confirmed yet. No stock changes needed
// because stock is only deducted at cloture time.
router.put("/erp/sale-orders/:id/cancel", authenticate, requireStaff, requireStore, requirePermission("orders", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");

    // First verify the order exists and is an online order (so we return 404 vs 409 correctly)
    const existRes = await db.execute(sql`
      SELECT id, status FROM orders WHERE id = ${id} AND store_id = ${storeId} AND order_source = 'online' LIMIT 1
    `);
    const existing = existRes.rows[0] as { id: number; status: string } | undefined;
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Atomic conditional transition — status guard is part of the UPDATE to prevent races
    const gateRes = await db.execute(sql`
      UPDATE orders SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${id} AND store_id = ${storeId} AND order_source = 'online'
        AND status IN ('draft', 'pending', 'processing')
      RETURNING id
    `);
    if (!gateRes.rows[0]) {
      res.status(409).json({ error: "Seules les commandes en ligne en cours (draft/pending/processing) peuvent être annulées" }); return;
    }

    res.json({ id, status: "cancelled" });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// DELETE /erp/sale-orders/:id
router.delete("/erp/sale-orders/:id", authenticate, requireStaff, requireStore, requirePermission("orders", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");

    const existRes = await db.execute(sql`SELECT id, status FROM orders WHERE id = ${id} AND store_id = ${storeId} AND order_source = 'bon' LIMIT 1`);
    const existing = existRes.rows[0] as { id: number; status: string } | undefined;
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status === "delivered") {
      res.status(400).json({ error: "Impossible de supprimer un bon clôturé" }); return;
    }

    // Atomic delete
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM order_items WHERE order_id = ${id}`);
      await tx.execute(sql`DELETE FROM orders WHERE id = ${id}`);
    });

    res.json({ deleted: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Smart Alerts ────────────────────────────────────────────────────────────

// GET /erp/alerts/cross-store-missing
// Products available in sibling stores (stock > 0) but absent or stock=0 here.
// Matches by reference first, barcode as fallback (same logic as Besoin d'Achats).
router.get("/erp/alerts/cross-store-missing", authenticate, requireStaff, requireStore, requirePermission("alerts", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const result = await db.execute(sql`
      SELECT DISTINCT ON (
        COALESCE(NULLIF(src.reference, ''), src.barcode)
      )
        src.id                                    AS source_product_id,
        src.name_en,
        src.name_ar,
        src.image_url,
        src.reference,
        src.barcode,
        CAST(src.stock AS numeric)               AS source_stock,
        src.store_id                             AS source_store_id,
        st.name_en                               AS source_store_name_en,
        st.name_ar                               AS source_store_name_ar,
        COALESCE(CAST(dst.stock AS numeric), 0)  AS local_stock
      FROM   products src
      JOIN   stores   st  ON st.id  = src.store_id
      LEFT JOIN products dst ON (
        dst.store_id = ${storeId}
        AND (
          (src.reference IS NOT NULL AND src.reference <> '' AND dst.reference = src.reference)
          OR (
            (src.reference IS NULL OR src.reference = '')
            AND src.barcode IS NOT NULL AND src.barcode <> ''
            AND dst.barcode = src.barcode
          )
        )
      )
      WHERE src.store_id <> ${storeId}
        AND (src.is_active IS NULL OR src.is_active = true)
        AND src.stock > 0
        AND (dst.id IS NULL OR dst.stock = 0)
        AND (
          (src.reference IS NOT NULL AND src.reference <> '')
          OR (src.barcode IS NOT NULL AND src.barcode <> '')
        )
      ORDER BY
        COALESCE(NULLIF(src.reference, ''), src.barcode),
        src.stock DESC
    `);
    res.json(result.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/alerts/slow-movers?days=30
// Products with stock > 0 that have not appeared in a completed sale in the last N days
// (or have never been sold at all).
// Returns { items: [...], stats: { count, slowValue, totalValue, pctOfTotal } }
router.get("/erp/alerts/slow-movers", authenticate, requireStaff, requireStore, requirePermission("alerts", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const rawDays = parseInt((req.query["days"] as string | undefined) ?? "30", 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;

    const [itemsResult, totalResult] = await Promise.all([
      db.execute(sql`
        SELECT
          p.id,
          p.name_en,
          p.name_ar,
          p.image_url,
          p.reference,
          p.barcode,
          CAST(p.stock AS numeric)                                  AS stock,
          CAST(p.price AS numeric)                                  AS selling_price,
          CAST(p.cost_price AS numeric)                             AS cost_price,
          c.name_en                                                 AS category_name_en,
          c.name_ar                                                 AS category_name_ar,
          MAX(o.created_at)                                         AS last_sold_at,
          EXTRACT(DAY FROM NOW() - MAX(o.created_at))::int          AS days_since_last_sale
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = ${storeId}
        LEFT JOIN order_items oi ON oi.product_id = p.id
        LEFT JOIN orders o
               ON o.id       = oi.order_id
              AND o.store_id = ${storeId}
              AND o.status  NOT IN ('cancelled', 'draft')
        WHERE p.store_id = ${storeId}
          AND p.stock    > 0
          AND (p.is_active IS NULL OR p.is_active = true)
        GROUP BY p.id, p.name_en, p.name_ar, p.image_url,
                 p.reference, p.barcode, p.stock, p.price, p.cost_price,
                 c.name_en, c.name_ar
        HAVING MAX(o.created_at) IS NULL
            OR MAX(o.created_at) < NOW() - (${days} * INTERVAL '1 day')
        ORDER BY MAX(o.created_at) ASC NULLS FIRST,
                 CAST(p.stock AS numeric) DESC
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(CAST(stock AS numeric) * CAST(cost_price AS numeric)), 0)
               AS total_inventory_value
        FROM products
        WHERE store_id    = ${storeId}
          AND (is_active IS NULL OR is_active = true)
          AND stock > 0
          AND cost_price  > 0
      `),
    ]);

    type SlowRow = { stock: string; cost_price: string | null };
    const items = itemsResult.rows as SlowRow[];
    const totalValue = Number(
      (totalResult.rows[0] as { total_inventory_value: string }).total_inventory_value,
    );
    const slowValue = items.reduce(
      (sum, r) => sum + Number(r.stock) * Number(r.cost_price ?? 0),
      0,
    );
    const pctOfTotal = totalValue > 0
      ? Math.round((slowValue / totalValue) * 1000) / 10
      : 0;

    res.json({
      items,
      stats: {
        count:      items.length,
        slowValue:  Math.round(slowValue),
        totalValue: Math.round(totalValue),
        pctOfTotal,
      },
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Product expiry batches ────────────────────────────────────────────────

// GET /erp/products/:id/expiry-batches — list batches for one product (store-scoped)
router.get("/erp/products/:id/expiry-batches", authenticate, requireStaff, requireStore, requirePermission("products", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const productId = parseInt(req.params.id!, 10);
    if (isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });

    const rows = await db.execute(sql`
      SELECT id, product_id, store_id, quantity, expiry_date, lot_number, notes, created_at
      FROM product_expiry_batches
      WHERE product_id = ${productId} AND store_id = ${storeId}
      ORDER BY expiry_date ASC
    `);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/products/:id/expiry-batches — add a new batch
router.post("/erp/products/:id/expiry-batches", authenticate, requireStaff, requireStore, requirePermission("products", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const productId = parseInt(req.params.id!, 10);
    if (isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });

    const { quantity, expiryDate, lotNumber, notes } = req.body as {
      quantity?: unknown; expiryDate?: unknown; lotNumber?: unknown; notes?: unknown;
    };
    const qty = parseFloat(String(quantity ?? "0"));
    const dateStr = String(expiryDate ?? "").trim();
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: "expiryDate must be YYYY-MM-DD" });
    }
    if (isNaN(qty) || qty < 0) return res.status(400).json({ error: "Invalid quantity" });

    // Verify product belongs to this store
    const prod = await db.execute(sql`SELECT id FROM products WHERE id = ${productId} AND store_id = ${storeId} LIMIT 1`);
    if (!prod.rows.length) return res.status(404).json({ error: "Product not found" });

    const result = await db.execute(sql`
      INSERT INTO product_expiry_batches (product_id, store_id, quantity, expiry_date, lot_number, notes)
      VALUES (${productId}, ${storeId}, ${qty}, ${dateStr}, ${lotNumber ?? null}, ${notes ?? null})
      RETURNING *
    `);
    res.status(201).json(result.rows[0]);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// DELETE /erp/expiry-batches/:batchId — remove a batch
router.delete("/erp/expiry-batches/:batchId", authenticate, requireStaff, requireStore, requirePermission("products", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const batchId = parseInt(req.params.batchId!, 10);
    if (isNaN(batchId)) return res.status(400).json({ error: "Invalid batch id" });

    const result = await db.execute(sql`
      DELETE FROM product_expiry_batches
      WHERE id = ${batchId} AND store_id = ${storeId}
      RETURNING id
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Batch not found" });
    res.json({ ok: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ── Product extra barcodes ─────────────────────────────────────────────────
// GET /erp/products/:id/barcodes — list additional barcodes for a product
router.get("/erp/products/:id/barcodes", authenticate, requireStaff, requireStore, requirePermission("products", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const productId = parseInt(req.params.id!, 10);
    if (isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });

    // Verify product belongs to store
    const prod = await db.execute(sql`SELECT id FROM products WHERE id = ${productId} AND store_id = ${storeId} LIMIT 1`);
    if (!prod.rows.length) return res.status(404).json({ error: "Product not found" });

    const rows = await db.execute(sql`
      SELECT id, barcode, created_at
      FROM product_barcodes
      WHERE product_id = ${productId} AND store_id = ${storeId}
      ORDER BY created_at ASC
    `);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/products/:id/barcodes — add a new barcode to a product
router.post("/erp/products/:id/barcodes", authenticate, requireStaff, requireStore, requirePermission("products", "manage_barcodes"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const productId = parseInt(req.params.id!, 10);
    if (isNaN(productId)) return res.status(400).json({ error: "Invalid product id" });

    const { barcode } = req.body as { barcode?: string };
    if (!barcode || !String(barcode).trim()) return res.status(400).json({ error: "Barcode is required" });
    const bc = String(barcode).trim();

    // Verify product belongs to store
    const prod = await db.execute(sql`SELECT id FROM products WHERE id = ${productId} AND store_id = ${storeId} LIMIT 1`);
    if (!prod.rows.length) return res.status(404).json({ error: "Product not found" });

    const result = await db.execute(sql`
      INSERT INTO product_barcodes (product_id, store_id, barcode)
      VALUES (${productId}, ${storeId}, ${bc})
      RETURNING id, barcode, created_at
    `);
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") return res.status(409).json({ error: "Ce barcode existe déjà" });
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /erp/products/:id/barcodes/:barcodeId — remove an extra barcode
router.delete("/erp/products/:id/barcodes/:barcodeId", authenticate, requireStaff, requireStore, requirePermission("products", "manage_barcodes"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const productId = parseInt(req.params.id!, 10);
    const barcodeId = parseInt(req.params.barcodeId!, 10);
    if (isNaN(productId) || isNaN(barcodeId)) return res.status(400).json({ error: "Invalid id" });

    const result = await db.execute(sql`
      DELETE FROM product_barcodes
      WHERE id = ${barcodeId} AND product_id = ${productId} AND store_id = ${storeId}
      RETURNING id
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Barcode not found" });
    res.json({ ok: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/alerts/expiring-products?days=N — batches expiring within N days
router.get("/erp/alerts/expiring-products", authenticate, requireStaff, requireStore, requirePermission("alerts", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days ?? "30"), 10) || 30));

    const rows = await db.execute(sql`
      SELECT
        b.id              AS batch_id,
        b.product_id,
        b.quantity,
        b.expiry_date,
        b.lot_number,
        b.notes,
        p.name_en,
        p.name_ar,
        p.reference,
        p.barcode,
        p.image_url,
        (b.expiry_date::date - CURRENT_DATE) AS days_left
      FROM product_expiry_batches b
      JOIN products p ON p.id = b.product_id
      WHERE b.store_id = ${storeId}
        AND b.expiry_date::date <= CURRENT_DATE + (${days} || ' days')::interval
      ORDER BY b.expiry_date ASC
    `);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/alerts/count — lightweight badge count (sum of all alert types)
// Uses a fixed 30-day window for slow-movers in the badge (detail page can filter further).
router.get("/erp/alerts/count", authenticate, requireStaff, requireStore, requirePermission("alerts", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;

    const [crossResult, slowResult, expiryResult] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(DISTINCT COALESCE(NULLIF(src.reference, ''), src.barcode))
               AS cross_store_missing
        FROM   products src
        LEFT JOIN products dst ON (
          dst.store_id = ${storeId}
          AND (
            (src.reference IS NOT NULL AND src.reference <> '' AND dst.reference = src.reference)
            OR (
              (src.reference IS NULL OR src.reference = '')
              AND src.barcode IS NOT NULL AND src.barcode <> ''
              AND dst.barcode = src.barcode
            )
          )
        )
        WHERE src.store_id <> ${storeId}
          AND (src.is_active IS NULL OR src.is_active = true)
          AND src.stock > 0
          AND (dst.id IS NULL OR dst.stock = 0)
          AND (
            (src.reference IS NOT NULL AND src.reference <> '')
            OR (src.barcode IS NOT NULL AND src.barcode <> '')
          )
      `),
      db.execute(sql`
        SELECT COUNT(*) AS slow_movers
        FROM products p
        WHERE p.store_id = ${storeId}
          AND p.stock    > 0
          AND (p.is_active IS NULL OR p.is_active = true)
          AND NOT EXISTS (
            SELECT 1
            FROM   order_items oi
            JOIN   orders o ON o.id = oi.order_id
                          AND o.store_id = ${storeId}
                          AND o.status NOT IN ('cancelled', 'draft')
            WHERE  oi.product_id  = p.id
              AND  o.created_at  >= NOW() - INTERVAL '30 days'
          )
      `),
      db.execute(sql`
        SELECT COUNT(*) AS expiring
        FROM product_expiry_batches
        WHERE store_id = ${storeId}
          AND expiry_date::date <= CURRENT_DATE + INTERVAL '30 days'
      `),
    ]);

    const crossRow  = crossResult.rows[0]  as { cross_store_missing: string };
    const slowRow   = slowResult.rows[0]   as { slow_movers: string };
    const expiryRow = expiryResult.rows[0] as { expiring: string };
    res.json({
      crossStoreMissing: Number(crossRow.cross_store_missing),
      slowMovers:        Number(slowRow.slow_movers),
      expiringProducts:  Number(expiryRow.expiring),
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Purchase suggestions ────────────────────────────────────────────────────

// GET /erp/purchase-suggestions — list by store, ordered by demand_count DESC
router.get("/erp/purchase-suggestions", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const rows = await db
      .select({
        id: schema.purchaseSuggestionsTable.id,
        product_name: schema.purchaseSuggestionsTable.productName,
        image_url: schema.purchaseSuggestionsTable.imageUrl,
        notes: schema.purchaseSuggestionsTable.notes,
        market_price: schema.purchaseSuggestionsTable.marketPrice,
        demand_count: schema.purchaseSuggestionsTable.demandCount,
        staff_id: schema.purchaseSuggestionsTable.staffId,
        staff_name: schema.usersTable.name,
        created_at: schema.purchaseSuggestionsTable.createdAt,
      })
      .from(schema.purchaseSuggestionsTable)
      .leftJoin(schema.usersTable, eq(schema.purchaseSuggestionsTable.staffId, schema.usersTable.id))
      .where(eq(schema.purchaseSuggestionsTable.storeId, storeId))
      .orderBy(desc(schema.purchaseSuggestionsTable.demandCount));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/purchase-suggestions — create a suggestion
router.post("/erp/purchase-suggestions", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const staffId = req.user!.id;
    const { product_name, image_url, notes, market_price } = req.body as {
      product_name?: string;
      image_url?: string;
      notes?: string;
      market_price?: string;
    };
    if (!product_name || !String(product_name).trim()) {
      res.status(400).json({ error: "product_name is required" });
      return;
    }
    const [row] = await db
      .insert(schema.purchaseSuggestionsTable)
      .values({
        storeId,
        staffId,
        productName: String(product_name).trim(),
        imageUrl: image_url ?? null,
        notes: notes ?? null,
        marketPrice: market_price ?? null,
        demandCount: 0,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PATCH /erp/purchase-suggestions/:id — edit (creator or admin only)
router.patch("/erp/purchase-suggestions/:id", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const userId = req.user!.id;
    const admin = isAdmin(req);
    const { product_name, image_url, notes, market_price } = req.body as {
      product_name?: string;
      image_url?: string;
      notes?: string;
      market_price?: string;
    };
    // Check ownership
    const [existing] = await db
      .select({ staffId: schema.purchaseSuggestionsTable.staffId })
      .from(schema.purchaseSuggestionsTable)
      .where(and(
        eq(schema.purchaseSuggestionsTable.id, id),
        eq(schema.purchaseSuggestionsTable.storeId, storeId),
      ));
    if (!existing) { res.status(404).json({ error: "Suggestion not found" }); return; }
    if (!admin && existing.staffId !== userId) {
      res.status(403).json({ error: "Not authorized to edit this suggestion" });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (product_name !== undefined) updates.productName = String(product_name).trim() || undefined;
    if (image_url !== undefined) updates.imageUrl = image_url || null;
    if (notes !== undefined) updates.notes = notes.trim() || null;
    if (market_price !== undefined) updates.marketPrice = market_price.trim() || null;
    if (Object.keys(updates).length === 0) { res.json({ ok: true }); return; }
    const [updated] = await db
      .update(schema.purchaseSuggestionsTable)
      .set(updates)
      .where(eq(schema.purchaseSuggestionsTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/purchase-suggestions/:id/tap — increment demand_count by 1
router.post("/erp/purchase-suggestions/:id/tap", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const [row] = await db
      .update(schema.purchaseSuggestionsTable)
      .set({ demandCount: sql`${schema.purchaseSuggestionsTable.demandCount} + 1` })
      .where(and(
        eq(schema.purchaseSuggestionsTable.id, id),
        eq(schema.purchaseSuggestionsTable.storeId, storeId),
      ))
      .returning();
    if (!row) { res.status(404).json({ error: "Suggestion not found" }); return; }
    res.json({ demand_count: row.demandCount });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// DELETE /erp/purchase-suggestions/:id — admin or creator only
router.delete("/erp/purchase-suggestions/:id", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const userId = req.user!.id;
    const admin = isAdmin(req);
    // Fetch first to check ownership
    const [existing] = await db
      .select({ staffId: schema.purchaseSuggestionsTable.staffId })
      .from(schema.purchaseSuggestionsTable)
      .where(and(
        eq(schema.purchaseSuggestionsTable.id, id),
        eq(schema.purchaseSuggestionsTable.storeId, storeId),
      ));
    if (!existing) { res.status(404).json({ error: "Suggestion not found" }); return; }
    if (!admin && existing.staffId !== userId) {
      res.status(403).json({ error: "Not authorized to delete this suggestion" });
      return;
    }
    await db
      .delete(schema.purchaseSuggestionsTable)
      .where(eq(schema.purchaseSuggestionsTable.id, id));
    res.json({ ok: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;

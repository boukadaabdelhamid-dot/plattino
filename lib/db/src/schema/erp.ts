import { pgTable, serial, text, timestamp, integer, numeric, pgEnum, boolean, date, uniqueIndex, index, doublePrecision } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { productsTable } from "./products";
import { storesTable } from "./stores";

// ─── Employees ───────────────────────────────────────────────────────────────
export const employeeStatusEnum = pgEnum("employee_status", ["active", "inactive", "on_leave"]);

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id).unique(),
  name: text("name").notNull(),
  email: text("email").unique(),
  phone: text("phone"),
  position: text("position").notNull(),
  salary: numeric("salary", { precision: 10, scale: 2 }).notNull(),
  status: employeeStatusEnum("status").notNull().default("active"),
  hireDate: date("hire_date").notNull(),
  // Payroll identity — optional so existing rows are unaffected; enforced as
  // required by the app for newly created employees.
  matricule: text("matricule"),
  cnasNumber: text("cnas_number"),
  bankAccount: text("bank_account"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // Partial unique index — multiple NULLs allowed (legacy rows without a matricule yet).
  uniqMatricule: uniqueIndex("employees_matricule_unique").on(t.matricule).where(sql`${t.matricule} IS NOT NULL`),
}));

export const attendanceStatusEnum = pgEnum("attendance_status", ["present", "absent", "late", "half_day"]);

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  employeeId: integer("employee_id").references(() => employeesTable.id).notNull(),
  date: date("date").notNull(),
  status: attendanceStatusEnum("status").notNull().default("present"),
  checkIn: text("check_in"),
  checkOut: text("check_out"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leaveTypeEnum = pgEnum("leave_type", ["annual", "sick", "unpaid", "other"]);
export const leaveStatusEnum = pgEnum("leave_status", ["pending", "approved", "rejected"]);

export const leavesTable = pgTable("leaves", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  employeeId: integer("employee_id").references(() => employeesTable.id).notNull(),
  type: leaveTypeEnum("type").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
  status: leaveStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Contact type shared by the unified contacts identity and the role tables.
export const contactTypeEnum = pgEnum("contact_type", ["customer", "supplier", "customer_supplier"]);

// ─── Suppliers ────────────────────────────────────────────────────────────────
export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  // Role of the linked contact: 'supplier' (default) or 'customer_supplier'.
  contactType: contactTypeEnum("contact_type").notNull().default("supplier"),
  // Link to the unified contact identity (nullable — legacy rows stay NULL).
  contactId: integer("contact_id").references(() => contactsTable.id),
  currentBalance: numeric("current_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  // Shared identity across stores: suppliers linked via the same globalSupplierId
  // share a single global balance (synced on every balance-changing operation).
  globalSupplierId: text("global_supplier_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // A store may hold at most one record per global supplier account (no split groups).
  uniqGlobalPerStore: uniqueIndex("suppliers_one_global_per_store")
    .on(t.storeId, t.globalSupplierId)
    .where(sql`${t.globalSupplierId} IS NOT NULL`),
  // Fast lookup of all linked records when syncing balances / aggregating operations.
  globalIdIdx: index("suppliers_global_id_idx")
    .on(t.globalSupplierId)
    .where(sql`${t.globalSupplierId} IS NOT NULL`),
  // At most one supplier row per contact identity.
  uniqContact: uniqueIndex("suppliers_contact_id_uniq")
    .on(t.contactId)
    .where(sql`${t.contactId} IS NOT NULL`),
}));

// ─── Supplier Operations (purchases / payments / ajustements) ─────────────────
export const supplierOperationsTable = pgTable("supplier_operations", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id).notNull(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  date: date("date").notNull(),
  reference: text("reference"),
  note: text("note"),
  poId: integer("po_id").references(() => purchaseOrdersTable.id),
  caisseId: integer("caisse_id"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id),
  // Real balance snapshot captured at write time (via mutateSupplierBalance), for every
  // operation type including ajustement. NULL on rows created before this column existed
  // — never backfilled/guessed, the UI must show "—" for those instead of a computed value.
  balanceBefore: numeric("balance_before", { precision: 12, scale: 2 }),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const purchaseStatusEnum = pgEnum("purchase_status", ["pending", "received", "cancelled"]);

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id).notNull(),
  status: purchaseStatusEnum("status").notNull().default("pending"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  paymentMethod: text("payment_method").notNull().default("a_terme"),
  receiptImageUrl: text("receipt_image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  receivedAt: timestamp("received_at"),
});

export const purchaseItemsTable = pgTable("purchase_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id).notNull(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }).notNull(),
});

// ─── Purchase Annexe Charges ─────────────────────────────────────────────────
// Global charge records (frais de transport, douanes, etc.) applied across
// one or more purchase orders. The total is distributed proportionally
// across every product line in the selected bons based on line value weight.
export const purchaseAnnexeChargesTable = pgTable("purchase_annexe_charges", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  description: text("description").notNull(),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  date: date("date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Junction: which purchase orders a charge applies to
export const purchaseAnnexeChargeOrdersTable = pgTable("purchase_annexe_charge_orders", {
  chargeId: integer("charge_id").references(() => purchaseAnnexeChargesTable.id, { onDelete: "cascade" }).notNull(),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id).notNull(),
});

// Per-item allocation: how much of the charge is assigned to each purchase_items row
export const purchaseAnnexeChargeLinesTable = pgTable("purchase_annexe_charge_lines", {
  id: serial("id").primaryKey(),
  chargeId: integer("charge_id").references(() => purchaseAnnexeChargesTable.id, { onDelete: "cascade" }).notNull(),
  purchaseItemId: integer("purchase_item_id").references(() => purchaseItemsTable.id).notNull(),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id).notNull(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  allocatedAmount: numeric("allocated_amount", { precision: 12, scale: 2 }).notNull(),
});

export type PurchaseAnnexeCharge = typeof purchaseAnnexeChargesTable.$inferSelect;
export type PurchaseAnnexeChargeLine = typeof purchaseAnnexeChargeLinesTable.$inferSelect;

// ─── Supplier Returns (Avoirs fournisseur) ────────────────────────────────────
// Tracks units sent back to a supplier (defective batches, excess stock, etc.).
// Each header row (bon_retour_fournisseur) references the original purchase order
// when applicable. Items link individual product lines to their returned qty/cost.
export const bonRetourFournisseurTable = pgTable("bon_retour_fournisseur", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id),
  originalPurchaseOrderId: integer("original_purchase_order_id").references(() => purchaseOrdersTable.id),
  reason: text("reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
});

export const bonRetourFournisseurItemsTable = pgTable("bon_retour_fournisseur_items", {
  id: serial("id").primaryKey(),
  bonRetourFournisseurId: integer("bon_retour_fournisseur_id").references(() => bonRetourFournisseurTable.id).notNull(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  quantity: doublePrecision("quantity").notNull(),
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }).notNull(),
});

export type BonRetourFournisseur = typeof bonRetourFournisseurTable.$inferSelect;
export type BonRetourFournisseurItem = typeof bonRetourFournisseurItemsTable.$inferSelect;

// ─── Inventory Movements ──────────────────────────────────────────────────────
export const inventoryMovementTypeEnum = pgEnum("inventory_movement_type", ["in", "out", "adjustment"]);

export const inventoryMovementsTable = pgTable("inventory_movements", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  type: inventoryMovementTypeEnum("type").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  reason: text("reason"),
  reference: text("reference"),
  userId: integer("user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Inventory Physical Count (jrd) ───────────────────────────────────────────
// A count session snapshots the store's current stock at start time, lets
// staff enter counted quantities per product, and — once completed — applies
// the resulting differences as traceable inventory movements in one shot.
export const inventoryCountStatusEnum = pgEnum("inventory_count_status", ["open", "completed"]);

export const inventoryCountSessionsTable = pgTable("inventory_count_sessions", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  status: inventoryCountStatusEnum("status").notNull().default("open"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedByUserId: integer("completed_by_user_id").references(() => usersTable.id),
  completedAt: timestamp("completed_at"),
});

export const inventoryCountItemsTable = pgTable("inventory_count_items", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => inventoryCountSessionsTable.id).notNull(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  // Stock recorded in the system at the moment the session was started —
  // frozen so later concurrent adjustments don't shift the reference point.
  systemQuantity: doublePrecision("system_quantity").notNull(),
  // Null until staff actually enters a count for this product.
  countedQuantity: doublePrecision("counted_quantity"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqSessionProduct: uniqueIndex("inventory_count_items_session_product_unique").on(t.sessionId, t.productId),
}));

export type InventoryCountSession = typeof inventoryCountSessionsTable.$inferSelect;
export type InventoryCountItem = typeof inventoryCountItemsTable.$inferSelect;

// ─── Accounting ───────────────────────────────────────────────────────────────
export const transactionTypeEnum = pgEnum("transaction_type", ["income", "expense"]);
export const transactionCategoryEnum = pgEnum("transaction_category", [
  "sales", "purchase", "salary", "rent", "utilities", "marketing", "other"
]);

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  type: transactionTypeEnum("type").notNull(),
  category: transactionCategoryEnum("category").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description").notNull(),
  date: date("date").notNull(),
  reference: text("reference"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Customer Classifications (global, no storeId) ────────────────────────────
export const customerClassificationsTable = pgTable("customer_classifications", {
  id: serial("id").primaryKey(),
  labelFr: text("label_fr").notNull(),
  labelAr: text("label_ar").notNull(),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Price Tiers (global, no storeId) ─────────────────────────────────────────
export const priceTiersTable = pgTable("price_tiers", {
  id: serial("id").primaryKey(),
  labelFr: text("label_fr").notNull(),
  labelAr: text("label_ar").notNull(),
  code: text("code").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Contacts (unified identity — single source of truth for shared fields) ──
// One contact represents a person/company. The customer role (users + customer_profiles)
// and the supplier role (suppliers) link to it through a nullable contact_id. A contact
// whose contactType is 'customer_supplier' surfaces in BOTH the customers and suppliers
// lists (each list still reads its own native role row). Legacy customer/supplier rows
// keep contact_id NULL and keep working exactly as before — this table is purely additive.
export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  contactType: contactTypeEnum("contact_type").notNull().default("customer"),
  currentBalance: numeric("current_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  // Single unifying identity key across stores. Each store keeps its OWN contact
  // row (no cross-store row sharing), but all contact rows representing the same
  // physical person/company across stores carry the SAME globalContactId. Because
  // BOTH the customer role (customer_profiles.contactId) and the supplier role
  // (suppliers.contactId) point at this one contact row, linking via this single
  // key connects both roles together atomically — it replaces the two previously
  // independent per-role keys (customer_profiles.userId, suppliers.globalSupplierId)
  // as the canonical cross-store link for anything routed through a contact.
  globalContactId: text("global_contact_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  storeTypeIdx: index("contacts_store_type_idx").on(t.storeId, t.contactType),
  // A store may hold at most one contact per global identity (no split groups).
  uniqGlobalPerStore: uniqueIndex("contacts_one_global_per_store")
    .on(t.storeId, t.globalContactId)
    .where(sql`${t.globalContactId} IS NOT NULL`),
  // Fast lookup of every sibling contact when syncing balances across stores.
  globalIdIdx: index("contacts_global_id_idx")
    .on(t.globalContactId)
    .where(sql`${t.globalContactId} IS NOT NULL`),
}));

// ─── Customer Profiles (ERP-specific data, separate from users table) ─────────
export const customerProfilesTable = pgTable("customer_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  contactType: contactTypeEnum("contact_type").notNull().default("customer"),
  wilaya: text("wilaya"),
  commune: text("commune"),
  gps: text("gps"),
  classificationId: integer("classification_id").references(() => customerClassificationsTable.id),
  priceTierId: integer("price_tier_id").references(() => priceTiersTable.id),
  accountNumber: text("account_number"),
  creditLimit: numeric("credit_limit", { precision: 12, scale: 2 }),
  minBalanceAlert: numeric("min_balance_alert", { precision: 12, scale: 2 }),
  currentBalance: numeric("current_balance", { precision: 12, scale: 2 }).default("0"),
  foreignCurrency: boolean("foreign_currency").notNull().default(false),
  rc: text("rc"),
  nif: text("nif"),
  ai: text("ai"),
  nis: text("nis"),
  // Link to the unified contact identity (nullable — legacy rows stay NULL).
  contactId: integer("contact_id").references(() => contactsTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // Each user may have at most one profile per store.
  uniqUserStore: uniqueIndex("customer_profiles_user_store_uniq").on(t.userId, t.storeId),
  // At most one customer profile per contact identity.
  uniqContact: uniqueIndex("customer_profiles_contact_id_uniq")
    .on(t.contactId)
    .where(sql`${t.contactId} IS NOT NULL`),
}));

// ─── Customer Operations (Versements / Remboursements / …) ───────────────────
// type is plain text (not enum) to allow adding new operation kinds without migrations.
export const customerOperationsTable = pgTable("customer_operations", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => usersTable.id).notNull(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  type: text("type").notNull(), // 'versement' | 'remboursement' | … (extensible)
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  date: date("date").notNull(),
  reference: text("reference"),
  note: text("note"),
  createdBy: integer("created_by").references(() => usersTable.id),
  caisseId: integer("caisse_id").references(() => caissesTable.id),
  // Real balance snapshot captured at write time (via mutateCustomerBalance), for every
  // operation type including ajustement. NULL on rows created before this column existed
  // — never backfilled/guessed, the UI must show "—" for those instead of a computed value.
  balanceBefore: numeric("balance_before", { precision: 12, scale: 2 }),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CustomerOperation = typeof customerOperationsTable.$inferSelect;

// ─── CRM ──────────────────────────────────────────────────────────────────────
export const customerNotesTable = pgTable("customer_notes", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Inter-store Stock Transfers ──────────────────────────────────────────────
export const stockTransferStatusEnum = pgEnum("stock_transfer_status", [
  "requested", "approved", "rejected", "prepared", "in_transit", "received", "cancelled",
]);

export const stockTransfersTable = pgTable("stock_transfers", {
  id: serial("id").primaryKey(),
  sourceStoreId: integer("source_store_id").references(() => storesTable.id).notNull(),
  destinationStoreId: integer("destination_store_id").references(() => storesTable.id).notNull(),
  initiatorUserId: integer("initiator_user_id").references(() => usersTable.id).notNull(),
  initiatorSide: text("initiator_side").notNull(), // 'source' (direct send) or 'destination' (request)
  status: stockTransferStatusEnum("status").notNull().default("requested"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  preparedAt: timestamp("prepared_at"),
  shippedAt: timestamp("shipped_at"),
  receivedAt: timestamp("received_at"),
  cancelledAt: timestamp("cancelled_at"),
});

export const stockTransferItemsTable = pgTable("stock_transfer_items", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").references(() => stockTransfersTable.id, { onDelete: "cascade" }).notNull(),
  sourceProductId: integer("source_product_id").references(() => productsTable.id).notNull(),
  destinationProductId: integer("destination_product_id").references(() => productsTable.id),
  quantity: integer("quantity").notNull(),
  matchKey: text("match_key").notNull(), // reference or barcode used to match across stores
});

export const stockTransferEventsTable = pgTable("stock_transfer_events", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").references(() => stockTransfersTable.id, { onDelete: "cascade" }).notNull(),
  status: stockTransferStatusEnum("status").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id).notNull(),
  actorStoreId: integer("actor_store_id").references(() => storesTable.id).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Employee = typeof employeesTable.$inferSelect;
export type Supplier = typeof suppliersTable.$inferSelect;
export type SupplierOperation = typeof supplierOperationsTable.$inferSelect;
export type Transaction = typeof transactionsTable.$inferSelect;
export type InventoryMovement = typeof inventoryMovementsTable.$inferSelect;
export type StockTransfer = typeof stockTransfersTable.$inferSelect;
export type StockTransferItem = typeof stockTransferItemsTable.$inferSelect;
export type StockTransferEvent = typeof stockTransferEventsTable.$inferSelect;

// ─── Caisses (virtual cashboxes per staff + main) ─────────────────────────────
export const caisseKindEnum = pgEnum("caisse_kind", ["staff", "main"]);
export const caisseMovementTypeEnum = pgEnum("caisse_movement_type", ["credit", "debit"]);
export const caisseMovementReasonEnum = pgEnum("caisse_movement_reason", [
  "sale",
  "transfer_in",
  "transfer_out",
  "transfer_hold",
  "transfer_refund",
  "admin_deposit",
  "admin_withdraw",
  "adjustment",
  "customer_payment",
  "supplier_payment",
  "purchase_payment",
  "salary_payment",
]);
export const caisseTransferStatusEnum = pgEnum("caisse_transfer_status", [
  "pending", "accepted", "rejected", "cancelled",
]);

// Global caisse model: ONE org-wide main caisse and ONE personal caisse per
// user (shared across all stores). `store_id` is NULL for these global caisses;
// the column is retained only for legacy/audit context.
export const caissesTable = pgTable("caisses", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id),
  kind: caisseKindEnum("kind").notNull(),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // Exactly one global main caisse
  uniqMain: uniqueIndex("caisses_one_main_global")
    .on(t.kind)
    .where(sql`${t.kind} = 'main'`),
  // Exactly one staff caisse per owner (global, not per-store)
  uniqStaff: uniqueIndex("caisses_one_per_owner")
    .on(t.ownerUserId)
    .where(sql`${t.ownerUserId} IS NOT NULL`),
}));

export const caisseTransfersTable = pgTable("caisse_transfers", {
  id: serial("id").primaryKey(),
  // Optional context of the store where the transfer was initiated (audit only).
  storeId: integer("store_id").references(() => storesTable.id),
  senderCaisseId: integer("sender_caisse_id").references(() => caissesTable.id).notNull(),
  recipientCaisseId: integer("recipient_caisse_id").references(() => caissesTable.id).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: caisseTransferStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id).notNull(),
  decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  decidedAt: timestamp("decided_at"),
});

export const caisseMovementsTable = pgTable("caisse_movements", {
  id: serial("id").primaryKey(),
  caisseId: integer("caisse_id").references(() => caissesTable.id).notNull(),
  type: caisseMovementTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  reason: caisseMovementReasonEnum("reason").notNull(),
  counterpartyCaisseId: integer("counterparty_caisse_id").references(() => caissesTable.id),
  orderId: integer("order_id"),
  caisseTransferId: integer("caisse_transfer_id").references(() => caisseTransfersTable.id),
  supplierOperationId: integer("supplier_operation_id").references(() => supplierOperationsTable.id),
  customerOperationId: integer("customer_operation_id").references(() => customerOperationsTable.id),
  actorUserId: integer("actor_user_id").references(() => usersTable.id).notNull(),
  notes: text("notes"),
  // Real caisse balance snapshot captured immediately before/after this movement was
  // applied. NULL on rows created before this column existed — never backfilled/guessed.
  balanceBefore: numeric("balance_before", { precision: 12, scale: 2 }),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Caisse Sessions (Z-Report / shift sessions) ──────────────────────────────
export const caisseSessionStatusEnum = pgEnum("caisse_session_status", ["open", "closed"]);

export const caisseSessionsTable = pgTable("caisse_sessions", {
  id: serial("id").primaryKey(),
  caisseId: integer("caisse_id").references(() => caissesTable.id).notNull(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  status: caisseSessionStatusEnum("status").notNull().default("open"),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
  openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull(),
  theoreticalClosingBalance: numeric("theoretical_closing_balance", { precision: 12, scale: 2 }),
  actualClosingBalance: numeric("actual_closing_balance", { precision: 12, scale: 2 }),
  ecart: numeric("ecart", { precision: 12, scale: 2 }),
  openedByUserId: integer("opened_by_user_id").references(() => usersTable.id).notNull(),
  closedByUserId: integer("closed_by_user_id").references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Caisse = typeof caissesTable.$inferSelect;
export type CaisseMovement = typeof caisseMovementsTable.$inferSelect;
export type CaisseTransfer = typeof caisseTransfersTable.$inferSelect;
export type CaisseSession = typeof caisseSessionsTable.$inferSelect;

// ─── User Permissions ────────────────────────────────────────────────────────
export const userPermissionsTable = pgTable("user_permissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  section: text("section").notNull(),
  action: text("action").notNull(),
  granted: boolean("granted").notNull().default(false),
}, (t) => [
  uniqueIndex("user_permissions_user_section_action").on(t.userId, t.section, t.action),
]);

export type UserPermission = typeof userPermissionsTable.$inferSelect;

// ─── Payroll (bulk monthly generation, avances/retenues/prime) ───────────────
// A `payroll_run` groups one bulk generation for all active employees over a
// given (admin-editable) period. Once created, adjustments dated inside that
// period are locked (see the `locked` guard applied in the routes layer).
export const payrollRunsTable = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  generatedByUserId: integer("generated_by_user_id").references(() => usersTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqPeriod: uniqueIndex("payroll_runs_store_period_unique").on(t.storeId, t.periodStart, t.periodEnd),
}));

export const payslipsTable = pgTable("payslips", {
  id: serial("id").primaryKey(),
  payrollRunId: integer("payroll_run_id").references(() => payrollRunsTable.id).notNull(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  employeeId: integer("employee_id").references(() => employeesTable.id).notNull(),
  baseSalary: numeric("base_salary", { precision: 10, scale: 2 }).notNull(),
  bonusAmount: numeric("bonus_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  advancesAmount: numeric("advances_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  deductionsAmount: numeric("deductions_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  netAmount: numeric("net_amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqEmployeeRun: uniqueIndex("payslips_run_employee_unique").on(t.payrollRunId, t.employeeId),
}));

// avance = advance paid to the employee ahead of payday (deducted from net pay);
// retenue = deduction (e.g. penalty); prime = manually entered performance bonus.
export const payrollAdjustmentTypeEnum = pgEnum("payroll_adjustment_type", ["advance", "deduction", "bonus"]);

export const payrollAdjustmentsTable = pgTable("payroll_adjustments", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  employeeId: integer("employee_id").references(() => employeesTable.id).notNull(),
  type: payrollAdjustmentTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason"),
  date: date("date").notNull(),
  // Set once this adjustment is folded into a generated payslip — from that
  // point on it is immutable (the period it falls in is locked).
  payslipId: integer("payslip_id").references(() => payslipsTable.id),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // true when the cash was immediately disbursed from the main caisse at creation
  // (advance & bonus types). Generate must exclude cashed bonuses from net to
  // avoid double-counting; advances are always deducted from net regardless.
  isCashed: boolean("is_cashed").notNull().default(false),
});

export type PayrollRun = typeof payrollRunsTable.$inferSelect;
export type Payslip = typeof payslipsTable.$inferSelect;
export type PayrollAdjustment = typeof payrollAdjustmentsTable.$inferSelect;

// ─── Purchase suggestions (employee-driven product requests) ─────────────────
export const purchaseSuggestionsTable = pgTable("purchase_suggestions", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id, { onDelete: "cascade" }).notNull(),
  staffId: integer("staff_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  productName: text("product_name").notNull(),
  imageUrl: text("image_url"),
  notes: text("notes"),
  demandCount: integer("demand_count").notNull().default(0),
  marketPrice: text("market_price"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PurchaseSuggestion = typeof purchaseSuggestionsTable.$inferSelect;

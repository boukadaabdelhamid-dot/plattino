import { pgTable, serial, text, timestamp, integer, numeric, pgEnum, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { productsTable } from "./products";
import { storesTable } from "./stores";

export const orderStatusEnum = pgEnum("order_status", ["draft", "pending", "processing", "shipped", "delivered", "cancelled"]);

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id),
  sellerUserId: integer("seller_user_id").references(() => usersTable.id),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerAddress: text("customer_address").notNull(),
  status: orderStatusEnum("status").notNull().default("pending"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  couponCode: text("coupon_code"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => ordersTable.id).notNull(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  quantity: doublePrecision("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true, status: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
export type OrderItem = typeof orderItemsTable.$inferSelect;

export const bonRetoursTable = pgTable("bon_retours", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  originalOrderId: integer("original_order_id").references(() => ordersTable.id),
  clientName: text("client_name"),
  clientUserId: integer("client_user_id").references(() => usersTable.id),
  retourType: text("retour_type"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
});

export const bonRetourItemsTable = pgTable("bon_retour_items", {
  id: serial("id").primaryKey(),
  bonRetourId: integer("bon_retour_id").references(() => bonRetoursTable.id).notNull(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  quantity: doublePrecision("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
});

export type BonRetour = typeof bonRetoursTable.$inferSelect;
export type BonRetourItem = typeof bonRetourItemsTable.$inferSelect;

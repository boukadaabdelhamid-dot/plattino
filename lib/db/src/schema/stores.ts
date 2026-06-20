import { pgTable, serial, text, timestamp, integer, boolean, primaryKey, numeric, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const storesTable = pgTable("stores", {
  id: serial("id").primaryKey(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  slug: text("slug").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  address: text("address"),
  phone: text("phone"),
  logoUrl: text("logo_url"),
  tvaRate: numeric("tva_rate", { precision: 5, scale: 2 }).notNull().default("19"),
  showTvaByDefault: boolean("show_tva_by_default").notNull().default(false),
  nif: text("nif"),
  rc: text("rc"),
  ai: text("ai"),
  defaultComptoirCustomerId: integer("default_comptoir_customer_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userStoresTable = pgTable("user_stores", {
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  storeId: integer("store_id").references(() => storesTable.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.storeId] }),
}));

export const insertStoreSchema = createInsertSchema(storesTable).omit({ id: true, createdAt: true });
export type InsertStore = z.infer<typeof insertStoreSchema>;
export type Store = typeof storesTable.$inferSelect;
export type UserStore = typeof userStoresTable.$inferSelect;

export const storeWebSettingsTable = pgTable("store_web_settings", {
  storeId: integer("store_id").primaryKey().references(() => storesTable.id, { onDelete: "cascade" }),
  description: text("description"),
  email: text("email"),
  bannerUrl: text("banner_url"),
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  tiktokUrl: text("tiktok_url"),
  whatsappNumber: text("whatsapp_number"),
  showPrices: boolean("show_prices").notNull().default(true),
  showStock: boolean("show_stock").notNull().default(true),
  acceptOrders: boolean("accept_orders").notNull().default(true),
  minOrderAmount: numeric("min_order_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  featuredProductIds: jsonb("featured_product_ids").notNull().default(sql`'[]'::jsonb`),
  featuredCategoryIds: jsonb("featured_category_ids").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type StoreWebSettings = typeof storeWebSettingsTable.$inferSelect;

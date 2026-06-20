import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { storesTable } from "./stores";

export const productTypesTable = pgTable("product_types", {
  id: serial("id").primaryKey(),
  nameFr: text("name_fr").notNull(),
  nameAr: text("name_ar").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productFamiliesTable = pgTable("product_families", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  nameAr: text("name_ar").notNull(),
  nameFr: text("name_fr").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productBrandsTable = pgTable("product_brands", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  nameAr: text("name_ar").notNull(),
  nameFr: text("name_fr").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productColorsTable = pgTable("product_colors", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  nameAr: text("name_ar").notNull(),
  nameFr: text("name_fr").notNull(),
  hexCode: text("hex_code"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProductFamilySchema = createInsertSchema(productFamiliesTable).omit({ id: true, createdAt: true, storeId: true });
export const insertProductBrandSchema = createInsertSchema(productBrandsTable).omit({ id: true, createdAt: true, storeId: true });
export const insertProductColorSchema = createInsertSchema(productColorsTable).omit({ id: true, createdAt: true, storeId: true });
export const insertProductTypeSchema = createInsertSchema(productTypesTable).omit({ id: true, createdAt: true });

export type ProductFamily = typeof productFamiliesTable.$inferSelect;
export type ProductBrand = typeof productBrandsTable.$inferSelect;
export type ProductColor = typeof productColorsTable.$inferSelect;
export type ProductType = typeof productTypesTable.$inferSelect;
export type InsertProductFamily = z.infer<typeof insertProductFamilySchema>;
export type InsertProductBrand = z.infer<typeof insertProductBrandSchema>;
export type InsertProductColor = z.infer<typeof insertProductColorSchema>;
export type InsertProductType = z.infer<typeof insertProductTypeSchema>;

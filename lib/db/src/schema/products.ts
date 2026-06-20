import { pgTable, serial, text, timestamp, integer, numeric, boolean, check, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";
import { storesTable } from "./stores";
import { productFamiliesTable, productBrandsTable, productColorsTable } from "./product-attributes";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  familyId: integer("family_id").references(() => productFamiliesTable.id),
  brandId: integer("brand_id").references(() => productBrandsTable.id),
  colorId: integer("color_id").references(() => productColorsTable.id),
  descriptionAr: text("description_ar").notNull().default(""),
  descriptionEn: text("description_en").notNull().default(""),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  imageUrl: text("image_url"),
  stock: doublePrecision("stock").notNull().default(0),
  categoryId: integer("category_id").references(() => categoriesTable.id),
  rating: numeric("rating", { precision: 3, scale: 2 }).notNull().default("0"),
  reviewCount: integer("review_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reference: text("reference"),
  barcode: text("barcode"),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }),
  catalogueType: text("catalogue_type").default("ARTICLE"),
  brand: text("brand"),
  model: text("model"),
  color: text("color"),
  colisage: integer("colisage").default(1),
  weight: numeric("weight", { precision: 10, scale: 2 }),
  priceGros: numeric("price_gros", { precision: 10, scale: 2 }),
  priceSemiGros: numeric("price_semi_gros", { precision: 10, scale: 2 }),
  priceMin: numeric("price_min", { precision: 10, scale: 2 }),
  catalogue1: text("catalogue1"),
  catalogue2: text("catalogue2"),
  catalogue3: text("catalogue3"),
  catalogue4: text("catalogue4"),
  catalogue5: text("catalogue5"),
  catalogue6: text("catalogue6"),
  isActive: boolean("is_active").default(true),
  isExposed: boolean("is_exposed").default(false),
}, (t) => ({
  stockNonNegative: check("stock_non_negative", sql`${t.stock} >= 0`),
}));

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, rating: true, reviewCount: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;

// Extra barcodes per product (allows multiple scan codes for one product)
export const productBarcodesTable = pgTable("product_barcodes", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "cascade" }).notNull(),
  storeId: integer("store_id").references(() => storesTable.id).notNull(),
  barcode: text("barcode").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Multiple images per product. Exactly one row should have isPrimary=true
// (enforced at-most-one via the partial unique index below; app logic
// auto-promotes the first image to primary when none is set).
export const productImagesTable = pgTable("product_images", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "cascade" }).notNull(),
  url: text("url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  onePrimaryPerProduct: uniqueIndex("product_images_one_primary_idx")
    .on(t.productId)
    .where(sql`${t.isPrimary}`),
}));

export type ProductImage = typeof productImagesTable.$inferSelect;

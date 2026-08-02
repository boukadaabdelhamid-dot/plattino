import { createServer } from "http";
import app from "./app";
import { setupWebSocket } from "./lib/ws";
import { logger } from "./lib/logger";
import { db, schema, pool } from "./lib/db";
import { bootstrap } from "./seed";
import { runCaisseGlobalMigration } from "./lib/caisse-global-migration";
import { runContactGlobalLinkMigration } from "./lib/contact-global-link-migration";
import { runProductAttributeDedupMigration } from "./lib/product-attribute-dedup-migration";
import { runOrderSourceMigration } from "./lib/order-source-migration";
import { runPaymentMethodMigration } from "./lib/payment-method-migration";
import { runPurchaseOrdersSchemaMigration } from "./lib/purchase-orders-schema-migration";
import { getStorageMode, getLocalStorageBase, ensureLocalStorageReady } from "./lib/objectStorage";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const MIGRATION_SQL = `CREATE TYPE "public"."lang" AS ENUM('ar', 'en');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'admin', 'employee');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'half_day');--> statement-breakpoint
CREATE TYPE "public"."caisse_kind" AS ENUM('staff', 'main');--> statement-breakpoint
CREATE TYPE "public"."caisse_movement_reason" AS ENUM('sale', 'transfer_in', 'transfer_out', 'transfer_hold', 'transfer_refund', 'admin_deposit', 'admin_withdraw', 'adjustment', 'customer_payment', 'supplier_payment', 'purchase_payment');--> statement-breakpoint
CREATE TYPE "public"."caisse_movement_type" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."caisse_transfer_status" AS ENUM('pending', 'accepted', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'inactive', 'on_leave');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_type" AS ENUM('in', 'out', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'sick', 'unpaid', 'other');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('pending', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stock_transfer_status" AS ENUM('requested', 'approved', 'rejected', 'prepared', 'in_transit', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transaction_category" AS ENUM('sales', 'purchase', 'salary', 'rent', 'utilities', 'marketing', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TABLE "stores" (
        "id" serial PRIMARY KEY NOT NULL,
        "name_ar" text NOT NULL,
        "name_en" text NOT NULL,
        "slug" text NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "address" text,
        "phone" text,
        "logo_url" text,
        "tva_rate" numeric(5, 2) DEFAULT '19' NOT NULL,
        "show_tva_by_default" boolean DEFAULT false NOT NULL,
        "nif" text,
        "rc" text,
        "ai" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "stores_slug_unique" UNIQUE("slug")
);--> statement-breakpoint
CREATE TABLE "user_stores" (
        "user_id" integer NOT NULL,
        "store_id" integer NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "user_stores_user_id_store_id_pk" PRIMARY KEY("user_id","store_id")
);--> statement-breakpoint
CREATE TABLE "categories" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "name_ar" text NOT NULL,
        "name_en" text NOT NULL,
        "image_url" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "products" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "name_ar" text NOT NULL,
        "name_en" text NOT NULL,
        "description_ar" text DEFAULT '' NOT NULL,
        "description_en" text DEFAULT '' NOT NULL,
        "price" numeric(10, 2) NOT NULL,
        "image_url" text,
        "stock" integer DEFAULT 0 NOT NULL,
        "category_id" integer,
        "rating" numeric(3, 2) DEFAULT '0' NOT NULL,
        "review_count" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "reference" text,
        "barcode" text,
        "cost_price" numeric(10, 2),
        "catalogue_type" text DEFAULT 'ARTICLE',
        "brand" text,
        "model" text,
        "color" text,
        "colisage" integer DEFAULT 1,
        "weight" numeric(10, 2),
        "price_gros" numeric(10, 2),
        "price_semi_gros" numeric(10, 2),
        "price_min" numeric(10, 2),
        "catalogue1" text,
        "catalogue2" text,
        "catalogue3" text,
        "catalogue4" text,
        "catalogue5" text,
        "catalogue6" text,
        "is_active" boolean DEFAULT true,
        "is_exposed" boolean DEFAULT false
);--> statement-breakpoint
CREATE TABLE "users" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "email" text NOT NULL,
        "password_hash" text NOT NULL,
        "role" "user_role" DEFAULT 'customer' NOT NULL,
        "preferred_lang" "lang" DEFAULT 'ar' NOT NULL,
        "phone" text,
        "address" text,
        "city" text,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "users_email_unique" UNIQUE("email")
);--> statement-breakpoint
CREATE TABLE "order_items" (
        "id" serial PRIMARY KEY NOT NULL,
        "order_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "quantity" integer NOT NULL,
        "unit_price" numeric(10, 2) NOT NULL
);--> statement-breakpoint
CREATE TABLE "orders" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "user_id" integer,
        "seller_user_id" integer,
        "customer_name" text NOT NULL,
        "customer_phone" text NOT NULL,
        "customer_address" text NOT NULL,
        "status" "order_status" DEFAULT 'pending' NOT NULL,
        "total_amount" numeric(10, 2) NOT NULL,
        "discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
        "coupon_code" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "cart_items" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "quantity" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "coupons" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "code" text NOT NULL,
        "type" "coupon_type" NOT NULL,
        "value" numeric(10, 2) NOT NULL,
        "min_order" numeric(10, 2) DEFAULT '0' NOT NULL,
        "usage_limit" integer,
        "used_count" integer DEFAULT 0 NOT NULL,
        "expires_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "product_reviews" (
        "id" serial PRIMARY KEY NOT NULL,
        "product_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "rating" integer NOT NULL,
        "comment" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "attendance" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "employee_id" integer NOT NULL,
        "date" date NOT NULL,
        "status" "attendance_status" DEFAULT 'present' NOT NULL,
        "check_in" text,
        "check_out" text,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "caisse_movements" (
        "id" serial PRIMARY KEY NOT NULL,
        "caisse_id" integer NOT NULL,
        "type" "caisse_movement_type" NOT NULL,
        "amount" numeric(12, 2) NOT NULL,
        "reason" "caisse_movement_reason" NOT NULL,
        "counterparty_caisse_id" integer,
        "order_id" integer,
        "caisse_transfer_id" integer,
        "actor_user_id" integer NOT NULL,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "caisse_transfers" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer,
        "sender_caisse_id" integer NOT NULL,
        "recipient_caisse_id" integer NOT NULL,
        "amount" numeric(12, 2) NOT NULL,
        "status" "caisse_transfer_status" DEFAULT 'pending' NOT NULL,
        "notes" text,
        "requested_by_user_id" integer NOT NULL,
        "decided_by_user_id" integer,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "decided_at" timestamp
);--> statement-breakpoint
CREATE TABLE "caisses" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer,
        "owner_user_id" integer,
        "kind" "caisse_kind" NOT NULL,
        "balance" numeric(12, 2) DEFAULT '0' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "customer_notes" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "note" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "employees" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "name" text NOT NULL,
        "email" text,
        "phone" text,
        "position" text NOT NULL,
        "salary" numeric(10, 2) NOT NULL,
        "status" "employee_status" DEFAULT 'active' NOT NULL,
        "hire_date" date NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "employees_email_unique" UNIQUE("email")
);--> statement-breakpoint
CREATE TABLE "inventory_movements" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "type" "inventory_movement_type" NOT NULL,
        "quantity" integer NOT NULL,
        "reason" text,
        "reference" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "leaves" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "employee_id" integer NOT NULL,
        "type" "leave_type" NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "reason" text,
        "status" "leave_status" DEFAULT 'pending' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "purchase_items" (
        "id" serial PRIMARY KEY NOT NULL,
        "purchase_order_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "quantity" integer NOT NULL,
        "unit_cost" numeric(10, 2) NOT NULL
);--> statement-breakpoint
CREATE TABLE "purchase_orders" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "supplier_id" integer NOT NULL,
        "status" "purchase_status" DEFAULT 'pending' NOT NULL,
        "total_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "received_at" timestamp
);--> statement-breakpoint
CREATE TABLE "stock_transfer_events" (
        "id" serial PRIMARY KEY NOT NULL,
        "transfer_id" integer NOT NULL,
        "status" "stock_transfer_status" NOT NULL,
        "actor_user_id" integer NOT NULL,
        "actor_store_id" integer NOT NULL,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "stock_transfer_items" (
        "id" serial PRIMARY KEY NOT NULL,
        "transfer_id" integer NOT NULL,
        "source_product_id" integer NOT NULL,
        "destination_product_id" integer,
        "quantity" integer NOT NULL,
        "match_key" text NOT NULL
);--> statement-breakpoint
CREATE TABLE "stock_transfers" (
        "id" serial PRIMARY KEY NOT NULL,
        "source_store_id" integer NOT NULL,
        "destination_store_id" integer NOT NULL,
        "initiator_user_id" integer NOT NULL,
        "initiator_side" text NOT NULL,
        "status" "stock_transfer_status" DEFAULT 'requested' NOT NULL,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "approved_at" timestamp,
        "rejected_at" timestamp,
        "prepared_at" timestamp,
        "shipped_at" timestamp,
        "received_at" timestamp,
        "cancelled_at" timestamp
);--> statement-breakpoint
CREATE TABLE "suppliers" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "name" text NOT NULL,
        "contact_name" text,
        "email" text,
        "phone" text,
        "address" text,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "transactions" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "type" "transaction_type" NOT NULL,
        "category" "transaction_category" NOT NULL,
        "amount" numeric(10, 2) NOT NULL,
        "description" text NOT NULL,
        "date" date NOT NULL,
        "reference" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "uploaded_images" (
        "id" serial PRIMARY KEY NOT NULL,
        "object_path" text NOT NULL,
        "public_url" text NOT NULL,
        "content_type" text,
        "size" integer,
        "uploaded_by" integer,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "token" text NOT NULL,
        "expires_at" timestamp NOT NULL,
        "used" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD CONSTRAINT "caisse_movements_caisse_id_caisses_id_fk" FOREIGN KEY ("caisse_id") REFERENCES "public"."caisses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD CONSTRAINT "caisse_movements_counterparty_caisse_id_caisses_id_fk" FOREIGN KEY ("counterparty_caisse_id") REFERENCES "public"."caisses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD CONSTRAINT "caisse_movements_caisse_transfer_id_caisse_transfers_id_fk" FOREIGN KEY ("caisse_transfer_id") REFERENCES "public"."caisse_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD CONSTRAINT "caisse_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_transfers" ADD CONSTRAINT "caisse_transfers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_transfers" ADD CONSTRAINT "caisse_transfers_sender_caisse_id_caisses_id_fk" FOREIGN KEY ("sender_caisse_id") REFERENCES "public"."caisses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_transfers" ADD CONSTRAINT "caisse_transfers_recipient_caisse_id_caisses_id_fk" FOREIGN KEY ("recipient_caisse_id") REFERENCES "public"."caisses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_transfers" ADD CONSTRAINT "caisse_transfers_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisse_transfers" ADD CONSTRAINT "caisse_transfers_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisses" ADD CONSTRAINT "caisses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caisses" ADD CONSTRAINT "caisses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_events" ADD CONSTRAINT "stock_transfer_events_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_events" ADD CONSTRAINT "stock_transfer_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_events" ADD CONSTRAINT "stock_transfer_events_actor_store_id_stores_id_fk" FOREIGN KEY ("actor_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_source_product_id_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_destination_product_id_products_id_fk" FOREIGN KEY ("destination_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_source_store_id_stores_id_fk" FOREIGN KEY ("source_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_destination_store_id_stores_id_fk" FOREIGN KEY ("destination_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_initiator_user_id_users_id_fk" FOREIGN KEY ("initiator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_images" ADD CONSTRAINT "uploaded_images_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "caisses_one_main_global" ON "caisses" USING btree ("kind") WHERE "caisses"."kind" = 'main';--> statement-breakpoint
CREATE UNIQUE INDEX "caisses_one_per_owner" ON "caisses" USING btree ("owner_user_id") WHERE "caisses"."owner_user_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "product_families" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "name_ar" text NOT NULL,
        "name_fr" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "product_brands" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "name_ar" text NOT NULL,
        "name_fr" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "product_colors" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "name_ar" text NOT NULL,
        "name_fr" text NOT NULL,
        "hex_code" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "product_types" (
        "id" serial PRIMARY KEY NOT NULL,
        "name_fr" text NOT NULL,
        "name_ar" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "product_types" ADD COLUMN IF NOT EXISTS "image_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "user_id" integer REFERENCES "public"."users"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE TABLE "user_permissions" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "section" text NOT NULL,
        "action" text NOT NULL,
        "granted" boolean NOT NULL DEFAULT false,
        CONSTRAINT "user_permissions_user_section_action" UNIQUE("user_id","section","action")
);--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE no action;--> statement-breakpoint
ALTER TYPE "public"."caisse_movement_reason" ADD VALUE IF NOT EXISTS 'customer_payment';--> statement-breakpoint
ALTER TYPE "public"."caisse_movement_reason" ADD VALUE IF NOT EXISTS 'supplier_payment';--> statement-breakpoint
ALTER TYPE "public"."caisse_movement_reason" ADD VALUE IF NOT EXISTS 'purchase_payment';--> statement-breakpoint
ALTER TYPE "public"."caisse_movement_reason" ADD VALUE IF NOT EXISTS 'salary_payment';--> statement-breakpoint
ALTER TYPE "public"."caisse_movement_reason" ADD VALUE IF NOT EXISTS 'expense';--> statement-breakpoint
-- ─── Schema-alignment patch (idempotent): brings MIGRATION_SQL in sync with lib/db/src/schema/*.ts ───
CREATE TYPE "public"."caisse_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."contact_type" AS ENUM('customer', 'customer_supplier');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE IF NOT EXISTS 'draft' BEFORE 'pending';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bon_retour_items" (
        "id" serial PRIMARY KEY NOT NULL,
        "bon_retour_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "quantity" double precision NOT NULL,
        "unit_price" numeric(10, 2) NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bon_retours" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "original_order_id" integer,
        "client_name" text,
        "client_user_id" integer,
        "retour_type" text,
        "reason" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "created_by_user_id" integer
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caisse_sessions" (
        "id" serial PRIMARY KEY NOT NULL,
        "caisse_id" integer NOT NULL,
        "store_id" integer NOT NULL,
        "status" "caisse_session_status" DEFAULT 'open' NOT NULL,
        "opened_at" timestamp DEFAULT now() NOT NULL,
        "closed_at" timestamp,
        "opening_balance" numeric(12, 2) NOT NULL,
        "theoretical_closing_balance" numeric(12, 2),
        "actual_closing_balance" numeric(12, 2),
        "ecart" numeric(12, 2),
        "opened_by_user_id" integer NOT NULL,
        "closed_by_user_id" integer,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_classifications" (
        "id" serial PRIMARY KEY NOT NULL,
        "label_fr" text NOT NULL,
        "label_ar" text NOT NULL,
        "color" text,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_operations" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer NOT NULL,
        "store_id" integer NOT NULL,
        "type" text NOT NULL,
        "amount" numeric(12, 2) NOT NULL,
        "date" date NOT NULL,
        "reference" text,
        "note" text,
        "created_by" integer,
        "caisse_id" integer,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_profiles" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "store_id" integer,
        "contact_type" "contact_type" DEFAULT 'customer' NOT NULL,
        "wilaya" text,
        "commune" text,
        "gps" text,
        "classification_id" integer,
        "price_tier_id" integer,
        "account_number" text,
        "credit_limit" numeric(12, 2),
        "min_balance_alert" numeric(12, 2),
        "current_balance" numeric(12, 2) DEFAULT '0',
        "foreign_currency" boolean DEFAULT false NOT NULL,
        "rc" text,
        "nif" text,
        "ai" text,
        "nis" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "customer_profiles_user_id_unique" UNIQUE("user_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_tiers" (
        "id" serial PRIMARY KEY NOT NULL,
        "label_fr" text NOT NULL,
        "label_ar" text NOT NULL,
        "code" text NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "price_tiers_code_unique" UNIQUE("code")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_barcodes" (
        "id" serial PRIMARY KEY NOT NULL,
        "product_id" integer NOT NULL,
        "store_id" integer NOT NULL,
        "barcode" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "product_barcodes_barcode_unique" UNIQUE("barcode")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_operations" (
        "id" serial PRIMARY KEY NOT NULL,
        "supplier_id" integer NOT NULL,
        "store_id" integer NOT NULL,
        "type" text NOT NULL,
        "amount" numeric(12, 2) NOT NULL,
        "date" date NOT NULL,
        "reference" text,
        "note" text,
        "po_id" integer,
        "caisse_id" integer,
        "actor_user_id" integer,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_images" (
        "id" serial PRIMARY KEY NOT NULL,
        "product_id" integer NOT NULL,
        "url" text NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "is_primary" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_images_one_primary_idx" ON "product_images" ("product_id") WHERE "is_primary";--> statement-breakpoint
INSERT INTO "product_images" ("product_id", "url", "sort_order", "is_primary") SELECT "id", "image_url", 0, true FROM "products" WHERE "image_url" IS NOT NULL AND "image_url" <> '' AND NOT EXISTS (SELECT 1 FROM "product_images" pi WHERE pi."product_id" = "products"."id");--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "default_comptoir_customer_id" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "current_balance" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "payment_method" text DEFAULT 'a_terme' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_source" text DEFAULT 'pos';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_method" text DEFAULT 'comptant';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "family_id" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "brand_id" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "color_id" integer;--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD COLUMN IF NOT EXISTS "supplier_operation_id" integer;--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD COLUMN IF NOT EXISTS "customer_operation_id" integer;--> statement-breakpoint
DO $do$ BEGIN IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'stock') = 'integer' THEN ALTER TABLE "products" ALTER COLUMN "stock" TYPE double precision USING "stock"::double precision; END IF; END $do$;--> statement-breakpoint
DO $do$ BEGIN IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_movements' AND column_name = 'quantity') = 'integer' THEN ALTER TABLE "inventory_movements" ALTER COLUMN "quantity" TYPE double precision USING "quantity"::double precision; END IF; END $do$;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "user_id" integer REFERENCES "users"("id");--> statement-breakpoint
DO $do$ BEGIN IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'quantity') = 'integer' THEN ALTER TABLE "order_items" ALTER COLUMN "quantity" TYPE double precision USING "quantity"::double precision; END IF; END $do$;--> statement-breakpoint
ALTER TABLE "bon_retour_items" ADD CONSTRAINT "bon_retour_items_bon_retour_id_bon_retours_id_fk" FOREIGN KEY ("bon_retour_id") REFERENCES "public"."bon_retours"("id");--> statement-breakpoint
ALTER TABLE "bon_retour_items" ADD CONSTRAINT "bon_retour_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");--> statement-breakpoint
ALTER TABLE "bon_retours" ADD CONSTRAINT "bon_retours_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "bon_retours" ADD CONSTRAINT "bon_retours_original_order_id_orders_id_fk" FOREIGN KEY ("original_order_id") REFERENCES "public"."orders"("id");--> statement-breakpoint
ALTER TABLE "bon_retours" ADD CONSTRAINT "bon_retours_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "bon_retours" ADD CONSTRAINT "bon_retours_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "caisse_sessions" ADD CONSTRAINT "caisse_sessions_caisse_id_caisses_id_fk" FOREIGN KEY ("caisse_id") REFERENCES "public"."caisses"("id");--> statement-breakpoint
ALTER TABLE "caisse_sessions" ADD CONSTRAINT "caisse_sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "caisse_sessions" ADD CONSTRAINT "caisse_sessions_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "caisse_sessions" ADD CONSTRAINT "caisse_sessions_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "customer_operations" ADD CONSTRAINT "customer_operations_caisse_id_caisses_id_fk" FOREIGN KEY ("caisse_id") REFERENCES "public"."caisses"("id");--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_classification_id_customer_classifications_id" FOREIGN KEY ("classification_id") REFERENCES "public"."customer_classifications"("id");--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_price_tier_id_price_tiers_id_fk" FOREIGN KEY ("price_tier_id") REFERENCES "public"."price_tiers"("id");--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "supplier_operations" ADD CONSTRAINT "supplier_operations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");--> statement-breakpoint
ALTER TABLE "supplier_operations" ADD CONSTRAINT "supplier_operations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "supplier_operations" ADD CONSTRAINT "supplier_operations_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id");--> statement-breakpoint
ALTER TABLE "supplier_operations" ADD CONSTRAINT "supplier_operations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_default_comptoir_customer_id_users_id_fk" FOREIGN KEY ("default_comptoir_customer_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_family_id_product_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."product_families"("id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_product_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."product_brands"("id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_color_id_product_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."product_colors"("id");--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD CONSTRAINT "caisse_movements_supplier_operation_id_supplier_operations_id_f" FOREIGN KEY ("supplier_operation_id") REFERENCES "public"."supplier_operations"("id");--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD CONSTRAINT "caisse_movements_customer_operation_id_customer_operations_id_f" FOREIGN KEY ("customer_operation_id") REFERENCES "public"."customer_operations"("id");--> statement-breakpoint
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "product_brands" ADD CONSTRAINT "product_brands_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "product_colors" ADD CONSTRAINT "product_colors_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_unique" UNIQUE("user_id");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "stock_non_negative" CHECK ("stock" >= 0);--> statement-breakpoint
-- ─── Unified contacts identity (Phase 2, additive + idempotent) ───
ALTER TYPE "public"."contact_type" ADD VALUE IF NOT EXISTS 'supplier';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "name" text NOT NULL,
        "contact_name" text,
        "email" text,
        "phone" text,
        "address" text,
        "notes" text,
        "contact_type" "contact_type" DEFAULT 'customer' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "contact_id" integer;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "contact_id" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "contact_type" "contact_type" DEFAULT 'supplier' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "global_supplier_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_one_global_per_store" ON "suppliers" ("store_id", "global_supplier_id") WHERE "global_supplier_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_global_id_idx" ON "suppliers" ("global_supplier_id") WHERE "global_supplier_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_store_type_idx" ON "contacts" ("store_id","contact_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_profiles_contact_id_uniq" ON "customer_profiles" ("contact_id") WHERE "contact_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_contact_id_uniq" ON "suppliers" ("contact_id") WHERE "contact_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "current_balance" numeric(12, 2) NOT NULL DEFAULT '0';--> statement-breakpoint
ALTER TABLE "customer_profiles" ALTER COLUMN "store_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP CONSTRAINT IF EXISTS "customer_profiles_user_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "customer_profiles_user_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_profiles_user_store_uniq" ON "customer_profiles" ("user_id","store_id");--> statement-breakpoint
UPDATE contacts SET current_balance = (
  COALESCE((SELECT current_balance FROM customer_profiles WHERE contact_id = contacts.id LIMIT 1)::numeric, 0) +
  COALESCE((SELECT current_balance FROM suppliers WHERE contact_id = contacts.id LIMIT 1)::numeric, 0)
), updated_at = NOW() WHERE contact_type = 'customer_supplier';--> statement-breakpoint
-- ─── Unified cross-store identity key (structural balance-sync fix) ───
-- Single link replacing the two independent per-role keys (customer_profiles.userId,
-- suppliers.globalSupplierId) for anything routed through a contacts row — see
-- lib/balance-sync.ts and lib/contact-global-link-migration.ts.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "global_contact_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_one_global_per_store" ON "contacts" ("store_id", "global_contact_id") WHERE "global_contact_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_global_id_idx" ON "contacts" ("global_contact_id") WHERE "global_contact_id" IS NOT NULL;--> statement-breakpoint
-- ─── Ancien/nouveau solde snapshots (additive + idempotent) ───
-- Real balance captured at write time for every operation/movement going forward.
-- NULL on pre-existing rows — never backfilled/guessed, the UI shows "—" for those.
ALTER TABLE "customer_operations" ADD COLUMN IF NOT EXISTS "balance_before" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "customer_operations" ADD COLUMN IF NOT EXISTS "balance_after" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "supplier_operations" ADD COLUMN IF NOT EXISTS "balance_before" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "supplier_operations" ADD COLUMN IF NOT EXISTS "balance_after" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD COLUMN IF NOT EXISTS "balance_before" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "caisse_movements" ADD COLUMN IF NOT EXISTS "balance_after" numeric(12, 2);--> statement-breakpoint
-- ─── Supplier returns (avoirs fournisseur) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bon_retour_fournisseur" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL,
        "supplier_id" integer,
        "original_purchase_order_id" integer,
        "reason" text,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "created_by_user_id" integer
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bon_retour_fournisseur_items" (
        "id" serial PRIMARY KEY NOT NULL,
        "bon_retour_fournisseur_id" integer NOT NULL,
        "product_id" integer NOT NULL,
        "quantity" double precision NOT NULL,
        "unit_cost" numeric(10, 2) NOT NULL
);--> statement-breakpoint
ALTER TABLE "bon_retour_fournisseur" ADD CONSTRAINT "bon_retour_fournisseur_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");--> statement-breakpoint
ALTER TABLE "bon_retour_fournisseur" ADD CONSTRAINT "bon_retour_fournisseur_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");--> statement-breakpoint
ALTER TABLE "bon_retour_fournisseur" ADD CONSTRAINT "bon_retour_fournisseur_original_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("original_purchase_order_id") REFERENCES "public"."purchase_orders"("id");--> statement-breakpoint
ALTER TABLE "bon_retour_fournisseur" ADD CONSTRAINT "bon_retour_fournisseur_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "bon_retour_fournisseur_items" ADD CONSTRAINT "bon_retour_fournisseur_items_bon_retour_fournisseur_id_fk" FOREIGN KEY ("bon_retour_fournisseur_id") REFERENCES "public"."bon_retour_fournisseur"("id");--> statement-breakpoint
ALTER TABLE "bon_retour_fournisseur_items" ADD CONSTRAINT "bon_retour_fournisseur_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");--> statement-breakpoint
-- ─── Smart Purchase: min_stock + purchase_snooze (idempotent) ───────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "min_stock" double precision;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_snooze" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" integer NOT NULL,
  "store_id" integer NOT NULL,
  "snoozed_until" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_snooze_product_store_uniq" ON "purchase_snooze" ("product_id", "store_id");--> statement-breakpoint
ALTER TABLE "purchase_snooze" ADD CONSTRAINT "purchase_snooze_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "purchase_snooze" ADD CONSTRAINT "purchase_snooze_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "excluded_from_purchase" boolean NOT NULL DEFAULT false;--> statement-breakpoint
-- ─── Product expiry batches (tracking register, no FIFO link) ───────────────
CREATE TABLE IF NOT EXISTS "product_expiry_batches" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" integer NOT NULL,
  "store_id" integer NOT NULL,
  "quantity" double precision NOT NULL DEFAULT 0,
  "expiry_date" text NOT NULL,
  "lot_number" text,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "product_expiry_batches" ADD CONSTRAINT "product_expiry_batches_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_expiry_batches" ADD CONSTRAINT "product_expiry_batches_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_expiry_batches_product_store_idx" ON "product_expiry_batches" ("product_id", "store_id");--> statement-breakpoint
-- ─── Inventory physical count (jrd) ──────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "public"."inventory_count_status" AS ENUM('open', 'completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_count_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "store_id" integer NOT NULL,
  "status" "inventory_count_status" DEFAULT 'open' NOT NULL,
  "notes" text,
  "created_by_user_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_by_user_id" integer,
  "completed_at" timestamp
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_count_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" integer NOT NULL,
  "product_id" integer NOT NULL,
  "system_quantity" double precision NOT NULL,
  "counted_quantity" double precision,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_items_session_product_unique" ON "inventory_count_items" ("session_id", "product_id");--> statement-breakpoint
-- ─── Purchase suggestions (employee-driven product requests) ─────────────────
CREATE TABLE IF NOT EXISTS "purchase_suggestions" (
  "id" serial PRIMARY KEY NOT NULL,
  "store_id" integer NOT NULL,
  "staff_id" integer NOT NULL,
  "product_name" text NOT NULL,
  "image_url" text,
  "notes" text,
  "demand_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "purchase_suggestions" ADD CONSTRAINT "purchase_suggestions_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "purchase_suggestions" ADD CONSTRAINT "purchase_suggestions_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."payroll_adjustment_type" AS ENUM('advance', 'deduction', 'bonus'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_runs" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL REFERENCES "public"."stores"("id"),
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "generated_by_user_id" integer NOT NULL REFERENCES "public"."users"("id"),
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_runs_store_period_unique" ON "payroll_runs" ("store_id", "period_start", "period_end");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payslips" (
        "id" serial PRIMARY KEY NOT NULL,
        "payroll_run_id" integer NOT NULL REFERENCES "public"."payroll_runs"("id"),
        "store_id" integer NOT NULL REFERENCES "public"."stores"("id"),
        "employee_id" integer NOT NULL REFERENCES "public"."employees"("id"),
        "base_salary" numeric(10, 2) NOT NULL,
        "bonus_amount" numeric(10, 2) NOT NULL DEFAULT '0',
        "advances_amount" numeric(10, 2) NOT NULL DEFAULT '0',
        "deductions_amount" numeric(10, 2) NOT NULL DEFAULT '0',
        "net_amount" numeric(10, 2) NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payslips_run_employee_unique" ON "payslips" ("payroll_run_id", "employee_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_adjustments" (
        "id" serial PRIMARY KEY NOT NULL,
        "store_id" integer NOT NULL REFERENCES "public"."stores"("id"),
        "employee_id" integer NOT NULL REFERENCES "public"."employees"("id"),
        "type" "payroll_adjustment_type" NOT NULL,
        "amount" numeric(10, 2) NOT NULL,
        "reason" text,
        "date" date NOT NULL,
        "payslip_id" integer REFERENCES "public"."payslips"("id"),
        "created_by_user_id" integer REFERENCES "public"."users"("id"),
        "created_at" timestamp DEFAULT now() NOT NULL,
        "is_cashed" boolean NOT NULL DEFAULT false
);--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD COLUMN IF NOT EXISTS "is_cashed" boolean NOT NULL DEFAULT false;--> statement-breakpoint
`;


async function runMigrations() {
  const statements = MIGRATION_SQL
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  let applied = 0;
  let skipped = 0;
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      applied++;
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate column") ||
        msg.includes("already been created")
      ) {
        skipped++;
      } else {
        logger.warn({ err: msg, stmt: stmt.slice(0, 120) }, "Migration statement warning (non-fatal)");
      }
    }
  }
  logger.info({ applied, skipped }, "DB migrations done.");
}

// Canonical-email uniqueness: login matches emails case-insensitively, so two
// accounts must never differ only by case/whitespace. Unlike runMigrations
// (which swallows errors), this step is STARTUP-FATAL: running with
// case-insensitive login but without the unique invariant would make
// authentication nondeterministic, so the server refuses to boot until the
// data is fixed and the index verifiably exists.
async function ensureCanonicalEmailIndex() {
  try {
    const collisions = await pool.query(
      `SELECT lower(trim(email)) AS canonical, array_agg(id ORDER BY id) AS user_ids, array_agg(email ORDER BY id) AS emails
       FROM users GROUP BY 1 HAVING count(*) > 1`,
    );
    if (collisions.rows.length > 0) {
      logger.error(
        { collisions: collisions.rows },
        "FATAL: duplicate user accounts differing only by email case/whitespace. " +
        "Login is case-insensitive and cannot be deterministic for these accounts. " +
        "Merge or re-email the duplicates listed above (UPDATE users SET email=... WHERE id=...), then restart.",
      );
      process.exit(1);
    }
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_canonical_uq ON users (lower(trim(email)))`);
    const check = await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_canonical_uq'`);
    if (check.rows.length === 0) {
      logger.error("FATAL: users_email_canonical_uq index missing after creation attempt — canonical email uniqueness is NOT enforced.");
      process.exit(1);
    }
    logger.info("Canonical email unique index verified.");
  } catch (err) {
    logger.error({ err }, "FATAL: failed to enforce canonical email uniqueness — refusing to run without the invariant.");
    process.exit(1);
  }
}

async function runBootstrap() {
  try {
    await bootstrap();
    logger.info("Bootstrap complete (admin, store, caisse, lookup tables).");
  } catch (err) {
    logger.warn({ err }, "Bootstrap skipped (non-fatal)");
  }
}

const server = createServer(app);
setupWebSocket(server);

async function initStorage() {
  try {
    const mode = getStorageMode();
    await ensureLocalStorageReady();
    if (mode === "local") {
      logger.info({ mode, base: getLocalStorageBase() }, "Object storage initialised (local disk)");
    } else {
      logger.info({ mode }, "Object storage initialised");
    }
  } catch (err) {
    logger.error({ err }, "Object storage initialisation failed");
  }
}

async function runAttributeUniqueIndexMigration() {
  // Each attribute table is handled independently so one failure doesn't block the others.
  // Before creating the unique index we deduplicate existing rows (keep lowest id per
  // store+lower(name_fr), re-point products references, then delete extras) so the index
  // creation never fails due to pre-existing duplicates.

  const tables = [
    {
      name:       "product_families",
      fkCol:      "family_id",
      idxName:    "product_families_store_lower_name_fr_key",
    },
    {
      name:       "product_brands",
      fkCol:      "brand_id",
      idxName:    "product_brands_store_lower_name_fr_key",
    },
    {
      name:       "product_colors",
      fkCol:      "color_id",
      idxName:    "product_colors_store_lower_name_fr_key",
    },
  ] as const;

  for (const tbl of tables) {
    try {
      // 1. Re-point products that reference a duplicate row to the canonical (lowest) id.
      await pool.query(`
        UPDATE products p
        SET    ${tbl.fkCol} = canon.keep_id
        FROM   (
                 SELECT id,
                        MIN(id) OVER (PARTITION BY store_id, lower(name_fr)) AS keep_id
                 FROM   ${tbl.name}
               ) canon
        WHERE  p.${tbl.fkCol} = canon.id
          AND  canon.id <> canon.keep_id
      `);
      // 2. Delete the duplicate (non-canonical) rows now that nothing references them.
      await pool.query(`
        DELETE FROM ${tbl.name}
        WHERE id IN (
          SELECT id
          FROM   (
                   SELECT id,
                          MIN(id) OVER (PARTITION BY store_id, lower(name_fr)) AS keep_id
                   FROM   ${tbl.name}
                 ) sub
          WHERE  id <> keep_id
        )
      `);
      // 3. Create the unique expression index — safe now that duplicates are gone.
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ${tbl.idxName}
          ON ${tbl.name} (store_id, lower(name_fr))
      `);
      logger.info({ table: tbl.name }, "Attribute unique index ready.");
    } catch (err) {
      logger.warn({ err, table: tbl.name }, "Attribute unique index migration skipped (non-fatal)");
    }
  }

  // product_types is a global table (no store_id) — products reference it by name string,
  // not by FK id, so no FK rewrites are needed. Just dedup and add the unique index.
  try {
    await pool.query(`
      DELETE FROM product_types
      WHERE id IN (
        SELECT id
        FROM   (
                 SELECT id,
                        MIN(id) OVER (PARTITION BY lower(name_fr)) AS keep_id
                 FROM   product_types
               ) sub
        WHERE  id <> keep_id
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_product_types_lower_name_fr
        ON product_types (lower(name_fr))
    `);
    logger.info({ table: "product_types" }, "Attribute unique index ready.");
  } catch (err) {
    logger.warn({ err, table: "product_types" }, "Attribute unique index migration skipped (non-fatal)");
  }
}

async function runStaffEmployeeBackfill() {
  // For every admin/employee user that has no linked employee record, create one.
  // Idempotent: ON CONFLICT DO NOTHING makes repeated runs safe.
  try {
    const today = new Date().toISOString().split("T")[0];
    const result = await pool.query(
      `INSERT INTO employees (store_id, user_id, name, email, phone, position, salary, status, hire_date)
       SELECT
         (SELECT us.store_id FROM user_stores us WHERE us.user_id = u.id ORDER BY us.store_id LIMIT 1),
         u.id,
         u.name,
         u.email,
         u.phone,
         CASE WHEN u.role = 'admin' THEN 'مسؤول' ELSE 'موظف' END,
         0,
         'active',
         $1::date
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.role IN ('admin', 'employee')
         AND e.id IS NULL
         AND EXISTS (SELECT 1 FROM user_stores us WHERE us.user_id = u.id)
       ON CONFLICT DO NOTHING`,
      [today],
    );
    if (result.rowCount && result.rowCount > 0) {
      logger.info({ count: result.rowCount }, "staff-employee-backfill: linked staff users to employee records");
    }
  } catch (err) {
    logger.warn({ err }, "staff-employee-backfill: skipped (non-fatal)");
  }
}

async function runPurchaseSuggestionsSchemaMigration() {
  try {
    await pool.query(`
      ALTER TABLE purchase_suggestions
        ADD COLUMN IF NOT EXISTS market_price text
    `);
    logger.info("purchase_suggestions schema migration applied (market_price).");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "purchase_suggestions schema migration skipped (non-fatal)");
  }
}

async function runPurchaseNeededIndexMigration() {
  // These indexes are critical for the /erp/purchases/needed query performance.
  // Without them every join does a full-table seq-scan, causing O(n×m) latency.
  const idxDefs: [string, string][] = [
    // order_items — product_id (lateral/CTE join) and order_id (join to orders)
    ["idx_order_items_product_id",       "CREATE INDEX IF NOT EXISTS idx_order_items_product_id       ON order_items  (product_id)"],
    ["idx_order_items_order_id",         "CREATE INDEX IF NOT EXISTS idx_order_items_order_id         ON order_items  (order_id)"],
    // orders — store_id + status covering for main filter + date
    ["idx_orders_store_status",          "CREATE INDEX IF NOT EXISTS idx_orders_store_status          ON orders       (store_id, status)"],
    ["idx_orders_store_status_created",  "CREATE INDEX IF NOT EXISTS idx_orders_store_status_created  ON orders       (store_id, status, created_at)"],
    // purchase_items — product_id and purchase_order_id
    ["idx_purchase_items_product_id",    "CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id    ON purchase_items  (product_id)"],
    ["idx_purchase_items_po_id",         "CREATE INDEX IF NOT EXISTS idx_purchase_items_po_id         ON purchase_items  (purchase_order_id)"],
    // purchase_orders — store_id + status (last-supplier lookup)
    ["idx_purchase_orders_store_status", "CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_status ON purchase_orders (store_id, status)"],
    // products — composite for main WHERE clause
    ["idx_products_store_active_stock",  "CREATE INDEX IF NOT EXISTS idx_products_store_active_stock  ON products (store_id, is_active, stock)"],
    // products — cross-store reference / barcode lookup
    ["idx_products_reference",           "CREATE INDEX IF NOT EXISTS idx_products_reference           ON products (reference) WHERE reference IS NOT NULL AND reference != ''"],
    ["idx_products_barcode",             "CREATE INDEX IF NOT EXISTS idx_products_barcode             ON products (barcode)   WHERE barcode IS NOT NULL AND barcode != ''"],
  ];
  let built = 0;
  for (const [name, stmt] of idxDefs) {
    try {
      await pool.query(stmt);
      built++;
    } catch (err: any) {
      logger.warn({ err: err?.message, index: name }, "purchase-needed index skipped (non-fatal)");
    }
  }
  logger.info({ built }, "purchase-needed performance indexes ready.");
}

async function runWebSettingsMigration() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS store_web_settings (
        store_id integer PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
        description text,
        email text,
        banner_url text,
        facebook_url text,
        instagram_url text,
        tiktok_url text,
        whatsapp_number text,
        show_prices boolean NOT NULL DEFAULT true,
        show_stock boolean NOT NULL DEFAULT true,
        accept_orders boolean NOT NULL DEFAULT true,
        min_order_amount numeric(10,2) NOT NULL DEFAULT 0,
        featured_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        featured_category_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_at timestamp DEFAULT now() NOT NULL
      );
    `);
    logger.info("store_web_settings table ready.");
  } catch (err) {
    logger.warn({ err }, "store_web_settings migration skipped (non-fatal)");
  }
}

server.listen(port, async () => {
  logger.info({ port }, "Server listening");
  await initStorage();
  await runMigrations();
  await ensureCanonicalEmailIndex();
  await runCaisseGlobalMigration(pool);
  await runContactGlobalLinkMigration(pool);
  await runProductAttributeDedupMigration(pool);
  await runOrderSourceMigration(pool);
  // Backfill ONLY rows that never got an order_source (legacy, pre-column).
  // NOTE: never touch rows that already have a source — the old
  // "pos + no seller => online" flip misclassified real POS sales (made with
  // an expired staff token) as online orders on every boot, and would undo
  // manual data corrections.
  try {
    await pool.query(`UPDATE orders SET order_source = 'online' WHERE order_source IS NULL AND seller_user_id IS NULL`);
    await pool.query(`UPDATE orders SET order_source = 'pos' WHERE order_source IS NULL AND seller_user_id IS NOT NULL`);
    logger.info("Online order_source backfill applied.");
  } catch (err) { logger.warn({ err }, "Online order_source backfill skipped."); }
  await runPaymentMethodMigration(pool);
  await runPurchaseOrdersSchemaMigration(pool);
  await runAttributeUniqueIndexMigration();
  await runWebSettingsMigration();
  await runPurchaseSuggestionsSchemaMigration();
  await runPurchaseNeededIndexMigration();
  await runBootstrap();
  // Backfill runs after bootstrap so the initial admin account (created there) is also linked.
  await runStaffEmployeeBackfill();
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});

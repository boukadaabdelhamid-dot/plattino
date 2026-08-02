import { pgTable, serial, text, timestamp, pgEnum, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["customer", "admin", "employee"]);
export const langEnum = pgEnum("lang", ["ar", "en"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("customer"),
  preferredLang: langEnum("preferred_lang").notNull().default("ar"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // Canonical-email uniqueness: login matches case-insensitively, so two
  // accounts must never differ only by case/whitespace.
  uniqueIndex("users_email_canonical_uq").on(sql`lower(trim(${t.email}))`),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, passwordHash: true, role: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

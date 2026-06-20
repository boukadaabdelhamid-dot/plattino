import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const uploadedImagesTable = pgTable("uploaded_images", {
  id: serial("id").primaryKey(),
  objectPath: text("object_path").notNull(),
  publicUrl: text("public_url").notNull(),
  contentType: text("content_type"),
  size: integer("size"),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UploadedImage = typeof uploadedImagesTable.$inferSelect;

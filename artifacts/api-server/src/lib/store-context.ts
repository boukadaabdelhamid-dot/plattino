import type { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db, schema } from "./db";
import type { AuthRequest } from "./auth";

/**
 * Resolve the public-storefront store from `?store=<slug>` query param or
 * `X-Store-Slug` header. Falls back to the first active store. Sets
 * `req.currentStoreId` and `req.currentStoreSlug`.
 */
export interface PublicStoreRequest extends AuthRequest {
  currentStoreSlug?: string;
}

export async function resolvePublicStore(req: PublicStoreRequest, res: Response, next: NextFunction) {
  try {
    const slug =
      (req.query["store"] as string | undefined) ||
      (req.headers["x-store-slug"] as string | undefined) ||
      undefined;

    let store: typeof schema.storesTable.$inferSelect | undefined;
    if (slug) {
      const [match] = await db.select().from(schema.storesTable)
        .where(and(eq(schema.storesTable.slug, slug), eq(schema.storesTable.isActive, true)))
        .limit(1);
      if (match) store = match;
    }
    if (!store) {
      const [first] = await db.select().from(schema.storesTable)
        .where(eq(schema.storesTable.isActive, true))
        .orderBy(schema.storesTable.id)
        .limit(1);
      store = first;
    }
    if (!store) {
      res.status(503).json({ error: "No active store configured" });
      return;
    }
    req.currentStoreId = store.id;
    req.currentStoreSlug = store.slug;
    next();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Verify the authenticated user has access to a target store id.
 * Returns true on success. On failure, writes 403 and returns false.
 */
export async function userHasStoreAccess(userId: number, storeId: number): Promise<boolean> {
  const [link] = await db.select().from(schema.userStoresTable)
    .where(and(
      eq(schema.userStoresTable.userId, userId),
      eq(schema.userStoresTable.storeId, storeId),
    ))
    .limit(1);
  return !!link;
}

export async function listUserStores(userId: number) {
  const rows = await db.select({
    id: schema.storesTable.id,
    nameAr: schema.storesTable.nameAr,
    nameEn: schema.storesTable.nameEn,
    slug: schema.storesTable.slug,
    isActive: schema.storesTable.isActive,
  })
    .from(schema.userStoresTable)
    .innerJoin(schema.storesTable, eq(schema.userStoresTable.storeId, schema.storesTable.id))
    .where(eq(schema.userStoresTable.userId, userId))
    .orderBy(schema.storesTable.id);
  return rows;
}

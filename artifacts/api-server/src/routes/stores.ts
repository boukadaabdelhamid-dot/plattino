import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../lib/db";
import { authenticate, requireAdmin, requireStaff, requireStore, type AuthRequest } from "../lib/auth";

const router = Router();

const pid = (req: { params: Record<string, string | string[]> }, key: string): number =>
  parseInt(req.params[key] as string);

// Public-ish: list active stores (used by storefront to populate a switcher)
router.get("/stores/public", async (_req, res) => {
  try {
    const stores = await db.select({
      id: schema.storesTable.id,
      nameAr: schema.storesTable.nameAr,
      nameEn: schema.storesTable.nameEn,
      slug: schema.storesTable.slug,
    }).from(schema.storesTable)
      .where(eq(schema.storesTable.isActive, true))
      .orderBy(schema.storesTable.id);
    res.json(stores);
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Staff: list MY accessible stores (admin or employee).
router.get("/erp/stores/mine", authenticate, async (req: AuthRequest, res) => {
  try {
    const role = req.user?.role;
    if (role !== "admin" && role !== "employee") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select({
      id: schema.storesTable.id,
      nameAr: schema.storesTable.nameAr,
      nameEn: schema.storesTable.nameEn,
      slug: schema.storesTable.slug,
      isActive: schema.storesTable.isActive,
      address: schema.storesTable.address,
      phone: schema.storesTable.phone,
      logoUrl: schema.storesTable.logoUrl,
      tvaRate: schema.storesTable.tvaRate,
      showTvaByDefault: schema.storesTable.showTvaByDefault,
      nif: schema.storesTable.nif,
      rc: schema.storesTable.rc,
      ai: schema.storesTable.ai,
      defaultComptoirCustomerId: schema.storesTable.defaultComptoirCustomerId,
    })
      .from(schema.userStoresTable)
      .innerJoin(schema.storesTable, eq(schema.userStoresTable.storeId, schema.storesTable.id))
      .where(eq(schema.userStoresTable.userId, req.user!.id))
      .orderBy(schema.storesTable.id);
    res.json(rows.filter((r) => r.isActive));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Staff: list ALL active tenant stores (safe projection). Used by features
// like inter-store transfers where any staff member must be able to pick a
// counterparty store, regardless of their personal memberships.
router.get("/erp/stores/all", authenticate, async (req: AuthRequest, res) => {
  try {
    const role = req.user?.role;
    if (role !== "admin" && role !== "employee") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select({
      id: schema.storesTable.id,
      nameAr: schema.storesTable.nameAr,
      nameEn: schema.storesTable.nameEn,
      slug: schema.storesTable.slug,
      isActive: schema.storesTable.isActive,
    }).from(schema.storesTable)
      .where(eq(schema.storesTable.isActive, true))
      .orderBy(schema.storesTable.id);
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Admin: list all stores with item-count to drive UI delete-disable.
router.get("/erp/stores", authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(schema.storesTable).orderBy(schema.storesTable.id);
    const counts = await db.execute<{ store_id: number; total: string | number }>(sql`
      SELECT store_id, SUM(c)::int AS total FROM (
        SELECT store_id, COUNT(*)::int AS c FROM products      GROUP BY store_id UNION ALL
        SELECT store_id, COUNT(*)::int AS c FROM categories    GROUP BY store_id UNION ALL
        SELECT store_id, COUNT(*)::int AS c FROM orders        GROUP BY store_id UNION ALL
        SELECT store_id, COUNT(*)::int AS c FROM coupons       GROUP BY store_id UNION ALL
        SELECT store_id, COUNT(*)::int AS c FROM suppliers     GROUP BY store_id UNION ALL
        SELECT store_id, COUNT(*)::int AS c FROM employees     GROUP BY store_id UNION ALL
        SELECT store_id, COUNT(*)::int AS c FROM transactions  GROUP BY store_id
      ) t GROUP BY store_id
    `);
    const map = new Map<number, number>();
    for (const r of counts.rows as { store_id: number; total: string | number }[]) {
      map.set(Number(r.store_id), Number(r.total));
    }
    res.json(rows.map((r) => ({ ...r, itemCount: map.get(r.id) ?? 0 })));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/stores", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { nameAr, nameEn, slug, isActive, address, phone, logoUrl, tvaRate, showTvaByDefault, nif, rc, ai } = req.body || {};
    if (!nameAr || !nameEn || !slug) {
      res.status(400).json({ error: "nameAr, nameEn, slug required" });
      return;
    }
    const cleanSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    const dup = await db.select({ id: schema.storesTable.id })
      .from(schema.storesTable).where(eq(schema.storesTable.slug, cleanSlug)).limit(1);
    if (dup.length) {
      res.status(409).json({ error: "A store with this slug already exists" });
      return;
    }
    const [store] = await db.insert(schema.storesTable).values({
      nameAr, nameEn, slug: cleanSlug,
      isActive: isActive !== false,
      address: address ?? null,
      phone: phone ?? null,
      logoUrl: logoUrl ?? null,
      tvaRate: tvaRate !== undefined ? String(tvaRate) : "19",
      showTvaByDefault: !!showTvaByDefault,
      nif: nif ?? null,
      rc: rc ?? null,
      ai: ai ?? null,
    }).returning();
    // Auto-grant the creator (admin) access
    await db.insert(schema.userStoresTable).values({ userId: req.user!.id, storeId: store.id }).onConflictDoNothing();
    res.status(201).json(store);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/erp/stores/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = pid(req, "id");
    const b = req.body || {};
    const update: Record<string, unknown> = {};
    if (b.nameAr !== undefined) update["nameAr"] = b.nameAr;
    if (b.nameEn !== undefined) update["nameEn"] = b.nameEn;
    if (b.isActive !== undefined) update["isActive"] = !!b.isActive;
    if (b.address !== undefined) update["address"] = b.address || null;
    if (b.phone !== undefined) update["phone"] = b.phone || null;
    if (b.logoUrl !== undefined) update["logoUrl"] = b.logoUrl || null;
    if (b.tvaRate !== undefined) update["tvaRate"] = String(b.tvaRate);
    if (b.showTvaByDefault !== undefined) update["showTvaByDefault"] = !!b.showTvaByDefault;
    if (b.nif !== undefined) update["nif"] = b.nif || null;
    if (b.rc !== undefined) update["rc"] = b.rc || null;
    if (b.ai !== undefined) update["ai"] = b.ai || null;
    if (b.defaultComptoirCustomerId !== undefined) {
      update["defaultComptoirCustomerId"] =
        b.defaultComptoirCustomerId === null || b.defaultComptoirCustomerId === ""
          ? null
          : Number(b.defaultComptoirCustomerId);
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const [store] = await db.update(schema.storesTable).set(update)
      .where(eq(schema.storesTable.id, id)).returning();
    if (!store) { res.status(404).json({ error: "Not found" }); return; }
    res.json(store);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/stores/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = pid(req, "id");
    // Refuse if the store has any tenant rows.
    const counts = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM products WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM categories WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM orders WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM cart_items WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM coupons WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM suppliers WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM purchase_orders WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM inventory_movements WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM transactions WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM employees WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM attendance WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM leaves WHERE store_id = ${id}) +
        (SELECT COUNT(*) FROM customer_notes WHERE store_id = ${id}) AS total
    `);
    const total = Number((counts.rows[0] as { total: string | number }).total);
    if (total > 0) {
      res.status(409).json({ error: "Cannot delete store: it still contains data. Reassign or delete that data first." });
      return;
    }
    await db.delete(schema.userStoresTable).where(eq(schema.userStoresTable.storeId, id));
    await db.delete(schema.storesTable).where(eq(schema.storesTable.id, id));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// User-store grants
router.get("/erp/stores/:id/users", authenticate, requireAdmin, async (req, res) => {
  try {
    const storeId = pid(req, "id");
    const rows = await db.select({
      userId: schema.userStoresTable.userId,
      name: schema.usersTable.name,
      email: schema.usersTable.email,
      role: schema.usersTable.role,
    })
      .from(schema.userStoresTable)
      .innerJoin(schema.usersTable, eq(schema.userStoresTable.userId, schema.usersTable.id))
      .where(eq(schema.userStoresTable.storeId, storeId));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Product catalogue for a specific store (read-only, admin only).
// Used by the "Demander depuis un autre magasin" flow so the initiating store
// can search the SOURCE store's products by name / reference / barcode instead
// of having to type raw product IDs.
router.get("/erp/stores/:id/products", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const storeId = pid(req, "id");
    if (!Number.isFinite(storeId)) {
      res.status(400).json({ error: "Invalid storeId" }); return;
    }
    const products = await db.select({
      id: schema.productsTable.id,
      nameEn: schema.productsTable.nameEn,
      nameAr: schema.productsTable.nameAr,
      reference: schema.productsTable.reference,
      barcode: schema.productsTable.barcode,
      stock: schema.productsTable.stock,
    })
      .from(schema.productsTable)
      .where(eq(schema.productsTable.storeId, storeId))
      .orderBy(schema.productsTable.nameEn);
    res.json({ products });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ── Web Store Settings ─────────────────────────────────────────────────────────

const webSettingsSchema = z.object({
  description: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  bannerUrl: z.string().nullable().optional(),
  facebookUrl: z.string().nullable().optional(),
  instagramUrl: z.string().nullable().optional(),
  tiktokUrl: z.string().nullable().optional(),
  whatsappNumber: z.string().nullable().optional(),
  showPrices: z.boolean().optional(),
  showStock: z.boolean().optional(),
  acceptOrders: z.boolean().optional(),
  minOrderAmount: z.number().min(0).optional(),
  featuredProductIds: z.array(z.number()).optional(),
  featuredCategoryIds: z.array(z.number()).optional(),
});

const WS_DEFAULTS = {
  description: null,
  email: null,
  bannerUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
  whatsappNumber: null,
  showPrices: true,
  showStock: true,
  acceptOrders: true,
  minOrderAmount: "0",
  featuredProductIds: [] as number[],
  featuredCategoryIds: [] as number[],
  updatedAt: new Date(),
};

// GET /erp/stores/web-settings — authenticated staff
router.get("/erp/stores/web-settings", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const [row] = await db.select().from(schema.storeWebSettingsTable)
      .where(eq(schema.storeWebSettingsTable.storeId, storeId));
    res.json(row ?? { ...WS_DEFAULTS, storeId });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /erp/stores/web-settings — admin only (upsert)
router.put("/erp/stores/web-settings", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const parsed = webSettingsSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
    const d = parsed.data;
    const insertVals: typeof schema.storeWebSettingsTable.$inferInsert = {
      storeId,
      description: d.description ?? null,
      email: d.email ?? null,
      bannerUrl: d.bannerUrl ?? null,
      facebookUrl: d.facebookUrl ?? null,
      instagramUrl: d.instagramUrl ?? null,
      tiktokUrl: d.tiktokUrl ?? null,
      whatsappNumber: d.whatsappNumber ?? null,
      showPrices: d.showPrices ?? true,
      showStock: d.showStock ?? true,
      acceptOrders: d.acceptOrders ?? true,
      minOrderAmount: String(d.minOrderAmount ?? 0),
      featuredProductIds: d.featuredProductIds ?? [],
      featuredCategoryIds: d.featuredCategoryIds ?? [],
      updatedAt: new Date(),
    };
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (d.description !== undefined) updateSet["description"] = d.description ?? null;
    if (d.email !== undefined) updateSet["email"] = d.email ?? null;
    if (d.bannerUrl !== undefined) updateSet["bannerUrl"] = d.bannerUrl ?? null;
    if (d.facebookUrl !== undefined) updateSet["facebookUrl"] = d.facebookUrl ?? null;
    if (d.instagramUrl !== undefined) updateSet["instagramUrl"] = d.instagramUrl ?? null;
    if (d.tiktokUrl !== undefined) updateSet["tiktokUrl"] = d.tiktokUrl ?? null;
    if (d.whatsappNumber !== undefined) updateSet["whatsappNumber"] = d.whatsappNumber ?? null;
    if (d.showPrices !== undefined) updateSet["showPrices"] = d.showPrices;
    if (d.showStock !== undefined) updateSet["showStock"] = d.showStock;
    if (d.acceptOrders !== undefined) updateSet["acceptOrders"] = d.acceptOrders;
    if (d.minOrderAmount !== undefined) updateSet["minOrderAmount"] = String(d.minOrderAmount);
    if (d.featuredProductIds !== undefined) updateSet["featuredProductIds"] = d.featuredProductIds;
    if (d.featuredCategoryIds !== undefined) updateSet["featuredCategoryIds"] = d.featuredCategoryIds;
    const [row] = await db.insert(schema.storeWebSettingsTable)
      .values(insertVals)
      .onConflictDoUpdate({ target: schema.storeWebSettingsTable.storeId, set: updateSet })
      .returning();
    res.json(row);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /stores/:slug/config — PUBLIC, no auth required
router.get("/stores/:slug/config", async (req, res) => {
  try {
    const slug = req.params["slug"] as string;
    const [store] = await db.select({
      id: schema.storesTable.id,
      nameAr: schema.storesTable.nameAr,
      nameEn: schema.storesTable.nameEn,
      logoUrl: schema.storesTable.logoUrl,
    })
      .from(schema.storesTable)
      .where(eq(schema.storesTable.slug, slug))
      .limit(1);
    if (!store) { res.status(404).json({ error: "Store not found" }); return; }
    const [settings] = await db.select().from(schema.storeWebSettingsTable)
      .where(eq(schema.storeWebSettingsTable.storeId, store.id));
    const s = settings ?? WS_DEFAULTS;
    res.json({
      nameAr: store.nameAr,
      nameEn: store.nameEn,
      logoUrl: store.logoUrl ?? null,
      showPrices: s.showPrices,
      showStock: s.showStock,
      acceptOrders: s.acceptOrders,
      minOrderAmount: Number(s.minOrderAmount ?? 0),
      bannerUrl: s.bannerUrl,
      description: s.description,
      facebookUrl: s.facebookUrl,
      instagramUrl: s.instagramUrl,
      tiktokUrl: s.tiktokUrl,
      whatsappNumber: s.whatsappNumber,
      featuredProductIds: (s.featuredProductIds as number[]) ?? [],
      featuredCategoryIds: (s.featuredCategoryIds as number[]) ?? [],
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;

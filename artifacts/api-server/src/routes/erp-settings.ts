import { Router } from "express";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../lib/db";
import { authenticate, requireAdmin, requireStaff, requireStore, requirePermission, type AuthRequest } from "../lib/auth";

const attributeSchema = z.object({
  nameAr: z.string().min(1, "nameAr is required"),
  nameFr: z.string().min(1, "nameFr is required"),
});

const typeAttributeSchema = attributeSchema.extend({
  imageUrl: z.string().nullable().optional(),
});

const colorAttributeSchema = attributeSchema.extend({
  hexCode: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "hexCode must be a valid hex color e.g. #FF0000").optional().nullable(),
});

const router = Router();

const pid = (req: { params: Record<string, string | string[]> }, key: string): number => {
  const n = parseInt(req.params[key] as string);
  if (isNaN(n)) throw Object.assign(new Error("Invalid numeric id"), { statusCode: 400 });
  return n;
};

// ── Product Families ─────────────────────────────────────────────────────────

router.get("/erp/settings/products/families", authenticate, requireStaff, requireStore, requirePermission("settings", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const items = await db.select().from(schema.productFamiliesTable)
      .where(eq(schema.productFamiliesTable.storeId, storeId))
      .orderBy(schema.productFamiliesTable.id);
    res.json({ items });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/settings/products/families", authenticate, requireStaff, requireStore, requirePermission("settings", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const parsed = attributeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
    const { nameAr, nameFr } = parsed.data;
    const [item] = await db.insert(schema.productFamiliesTable)
      .values({ storeId, nameAr: nameAr.trim(), nameFr: nameFr.trim() })
      .returning();
    res.status(201).json(item);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/settings/products/families/:id", authenticate, requireStaff, requireStore, requirePermission("settings", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const parsed = attributeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
    const { nameAr, nameFr } = parsed.data;
    const [item] = await db.update(schema.productFamiliesTable)
      .set({ nameAr: nameAr.trim(), nameFr: nameFr.trim() })
      .where(and(eq(schema.productFamiliesTable.id, id), eq(schema.productFamiliesTable.storeId, storeId)))
      .returning();
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json(item);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/settings/products/families/:id", authenticate, requireStaff, requireStore, requirePermission("settings", "delete"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    await db.delete(schema.productFamiliesTable)
      .where(and(eq(schema.productFamiliesTable.id, pid(req, "id")), eq(schema.productFamiliesTable.storeId, storeId)));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ── Product Brands ───────────────────────────────────────────────────────────

router.get("/erp/settings/products/brands", authenticate, requireStaff, requireStore, requirePermission("settings", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const items = await db.select().from(schema.productBrandsTable)
      .where(eq(schema.productBrandsTable.storeId, storeId))
      .orderBy(schema.productBrandsTable.id);
    res.json({ items });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/settings/products/brands", authenticate, requireStaff, requireStore, requirePermission("settings", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const parsed = attributeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
    const { nameAr, nameFr } = parsed.data;
    const [item] = await db.insert(schema.productBrandsTable)
      .values({ storeId, nameAr: nameAr.trim(), nameFr: nameFr.trim() })
      .returning();
    res.status(201).json(item);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/settings/products/brands/:id", authenticate, requireStaff, requireStore, requirePermission("settings", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const parsed = attributeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
    const { nameAr, nameFr } = parsed.data;
    const [item] = await db.update(schema.productBrandsTable)
      .set({ nameAr: nameAr.trim(), nameFr: nameFr.trim() })
      .where(and(eq(schema.productBrandsTable.id, id), eq(schema.productBrandsTable.storeId, storeId)))
      .returning();
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json(item);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/settings/products/brands/:id", authenticate, requireStaff, requireStore, requirePermission("settings", "delete"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    await db.delete(schema.productBrandsTable)
      .where(and(eq(schema.productBrandsTable.id, pid(req, "id")), eq(schema.productBrandsTable.storeId, storeId)));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ── Product Types (system-wide, no storeId) ──────────────────────────────────

router.get("/erp/settings/products/types", authenticate, requireStaff, requirePermission("settings", "view"), async (req: AuthRequest, res) => {
  try {
    const items = await db.select().from(schema.productTypesTable)
      .orderBy(schema.productTypesTable.id);
    res.json({ items });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/settings/products/types", authenticate, requireStaff, requirePermission("settings", "create"), async (req: AuthRequest, res) => {
  try {
    const parsed = typeAttributeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
    const { nameAr, nameFr, imageUrl } = parsed.data;
    const trimmedFr = nameFr.trim();
    const trimmedAr = nameAr.trim();
    // Return the existing row if one with the same name (case-insensitive) already exists,
    // preventing accidental duplicates from double-submits or concurrent requests.
    const [existing] = await db.select().from(schema.productTypesTable)
      .where(sql`lower(${schema.productTypesTable.nameFr}) = lower(${trimmedFr})`)
      .limit(1);
    if (existing) { res.status(201).json(existing); return; }
    const [item] = await db.insert(schema.productTypesTable)
      .values({ nameAr: trimmedAr, nameFr: trimmedFr, imageUrl: imageUrl ?? null })
      .returning();
    res.status(201).json(item);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/settings/products/types/:id", authenticate, requireStaff, requirePermission("settings", "edit"), async (req: AuthRequest, res) => {
  try {
    const id = pid(req, "id");
    const parsed = typeAttributeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
    const { nameAr, nameFr, imageUrl } = parsed.data;
    const trimmedFr = nameFr.trim();
    const conflict = await db.select({ id: schema.productTypesTable.id })
      .from(schema.productTypesTable)
      .where(and(sql`lower(${schema.productTypesTable.nameFr}) = lower(${trimmedFr})`, ne(schema.productTypesTable.id, id)))
      .limit(1);
    if (conflict.length > 0) {
      res.status(409).json({ error: "Un type avec ce nom existe déjà" });
      return;
    }
    const [item] = await db.update(schema.productTypesTable)
      .set({ nameAr: nameAr.trim(), nameFr: trimmedFr, imageUrl: imageUrl ?? null })
      .where(eq(schema.productTypesTable.id, id))
      .returning();
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json(item);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/settings/products/types/:id", authenticate, requireStaff, requirePermission("settings", "delete"), async (req: AuthRequest, res) => {
  try {
    const id = pid(req, "id");
    const inUse = await db.select({ id: schema.productsTable.id })
      .from(schema.productsTable)
      .where(eq(schema.productsTable.catalogueType, (await db.select().from(schema.productTypesTable).where(eq(schema.productTypesTable.id, id)).limit(1))[0]?.nameFr ?? ""))
      .limit(1);
    if (inUse.length > 0) {
      res.status(409).json({ error: "Ce type est utilisé par des produits et ne peut pas être supprimé" });
      return;
    }
    await db.delete(schema.productTypesTable).where(eq(schema.productTypesTable.id, id));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ── Product Colors ───────────────────────────────────────────────────────────

router.get("/erp/settings/products/colors", authenticate, requireStaff, requireStore, requirePermission("settings", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const items = await db.select().from(schema.productColorsTable)
      .where(eq(schema.productColorsTable.storeId, storeId))
      .orderBy(schema.productColorsTable.id);
    res.json({ items });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/settings/products/colors", authenticate, requireStaff, requireStore, requirePermission("settings", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const parsed = colorAttributeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
    const { nameAr, nameFr, hexCode } = parsed.data;
    const [item] = await db.insert(schema.productColorsTable)
      .values({ storeId, nameAr: nameAr.trim(), nameFr: nameFr.trim(), hexCode: hexCode?.trim() ?? null })
      .returning();
    res.status(201).json(item);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/settings/products/colors/:id", authenticate, requireStaff, requireStore, requirePermission("settings", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const parsed = colorAttributeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
    const { nameAr, nameFr, hexCode } = parsed.data;
    const [item] = await db.update(schema.productColorsTable)
      .set({ nameAr: nameAr.trim(), nameFr: nameFr.trim(), hexCode: hexCode?.trim() ?? null })
      .where(and(eq(schema.productColorsTable.id, id), eq(schema.productColorsTable.storeId, storeId)))
      .returning();
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json(item);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/settings/products/colors/:id", authenticate, requireStaff, requireStore, requirePermission("settings", "delete"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    await db.delete(schema.productColorsTable)
      .where(and(eq(schema.productColorsTable.id, pid(req, "id")), eq(schema.productColorsTable.storeId, storeId)));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ── Copy attributes cross-store ───────────────────────────────────────────────
// POST /erp/settings/products/copy-attributes-to-stores
// Copies families, brands or colors from the current store to one or more
// target stores. Uses SELECT-first-then-INSERT to avoid duplicates even when
// no DB-level UNIQUE constraint exists on (storeId, nameFr).
router.post("/erp/settings/products/copy-attributes-to-stores", authenticate, requireStaff, requireStore, requirePermission("settings", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { type, ids, targetStoreIds } = req.body as {
      type: "family" | "brand" | "color";
      ids?: number[];
      targetStoreIds: number[];
    };

    if (!["family", "brand", "color"].includes(type)) {
      res.status(400).json({ error: "type must be family, brand, or color" }); return;
    }
    if (!Array.isArray(targetStoreIds) || targetStoreIds.length === 0) {
      res.status(400).json({ error: "targetStoreIds is required and must be non-empty" }); return;
    }

    // Validate all target stores exist — prevents silently writing to phantom IDs
    const knownStoreRows = await db.select({ id: schema.storesTable.id })
      .from(schema.storesTable)
      .where(inArray(schema.storesTable.id, targetStoreIds));
    const knownStoreIdSet = new Set(knownStoreRows.map((r) => r.id));
    const unknownIds = targetStoreIds.filter((id) => !knownStoreIdSet.has(id));
    if (unknownIds.length > 0) {
      res.status(400).json({ error: `Magasin(s) cible(s) inconnu(s) : ${unknownIds.join(", ")}` }); return;
    }

    // Fetch source attribute rows (all or a specific subset)
    type AttrRow = { id: number; nameFr: string; nameAr: string; hexCode?: string | null };
    let sourceItems: AttrRow[] = [];

    if (type === "family") {
      const where = ids?.length
        ? and(eq(schema.productFamiliesTable.storeId, storeId), inArray(schema.productFamiliesTable.id, ids))
        : eq(schema.productFamiliesTable.storeId, storeId);
      sourceItems = await db.select({ id: schema.productFamiliesTable.id, nameFr: schema.productFamiliesTable.nameFr, nameAr: schema.productFamiliesTable.nameAr })
        .from(schema.productFamiliesTable).where(where);
    } else if (type === "brand") {
      const where = ids?.length
        ? and(eq(schema.productBrandsTable.storeId, storeId), inArray(schema.productBrandsTable.id, ids))
        : eq(schema.productBrandsTable.storeId, storeId);
      sourceItems = await db.select({ id: schema.productBrandsTable.id, nameFr: schema.productBrandsTable.nameFr, nameAr: schema.productBrandsTable.nameAr })
        .from(schema.productBrandsTable).where(where);
    } else {
      const where = ids?.length
        ? and(eq(schema.productColorsTable.storeId, storeId), inArray(schema.productColorsTable.id, ids))
        : eq(schema.productColorsTable.storeId, storeId);
      sourceItems = await db.select({ id: schema.productColorsTable.id, nameFr: schema.productColorsTable.nameFr, nameAr: schema.productColorsTable.nameAr, hexCode: schema.productColorsTable.hexCode })
        .from(schema.productColorsTable).where(where);
    }

    const results: { targetStoreId: number; copied: number; skipped: number; errors: number; firstError: string | null }[] = [];

    for (const targetStoreId of targetStoreIds) {
      if (targetStoreId === storeId) continue;
      let copied = 0, skipped = 0, errors = 0, firstError: string | null = null;

      for (const item of sourceItems) {
        try {
          if (type === "family") {
            const [existing] = await db.select({ id: schema.productFamiliesTable.id })
              .from(schema.productFamiliesTable)
              .where(and(eq(schema.productFamiliesTable.storeId, targetStoreId), sql`lower(${schema.productFamiliesTable.nameFr}) = lower(${item.nameFr})`))
              .limit(1);
            if (existing) { skipped++; continue; }
            await db.insert(schema.productFamiliesTable).values({ storeId: targetStoreId, nameFr: item.nameFr, nameAr: item.nameAr });
            copied++;
          } else if (type === "brand") {
            const [existing] = await db.select({ id: schema.productBrandsTable.id })
              .from(schema.productBrandsTable)
              .where(and(eq(schema.productBrandsTable.storeId, targetStoreId), sql`lower(${schema.productBrandsTable.nameFr}) = lower(${item.nameFr})`))
              .limit(1);
            if (existing) { skipped++; continue; }
            await db.insert(schema.productBrandsTable).values({ storeId: targetStoreId, nameFr: item.nameFr, nameAr: item.nameAr });
            copied++;
          } else {
            const [existing] = await db.select({ id: schema.productColorsTable.id })
              .from(schema.productColorsTable)
              .where(and(eq(schema.productColorsTable.storeId, targetStoreId), sql`lower(${schema.productColorsTable.nameFr}) = lower(${item.nameFr})`))
              .limit(1);
            if (existing) { skipped++; continue; }
            await db.insert(schema.productColorsTable).values({ storeId: targetStoreId, nameFr: item.nameFr, nameAr: item.nameAr, hexCode: item.hexCode ?? null });
            copied++;
          }
        } catch (e) {
          errors++;
          req.log.warn({ err: e, targetStoreId, item: item.nameFr }, "copy-attributes item error");
          if (!firstError) firstError = e instanceof Error ? e.message : "Erreur inconnue";
        }
      }

      results.push({ targetStoreId, copied, skipped, errors, firstError });
    }

    res.json({ results });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;

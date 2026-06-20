import { Router } from "express";
import { eq, and } from "drizzle-orm";
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
    const [item] = await db.insert(schema.productTypesTable)
      .values({ nameAr: nameAr.trim(), nameFr: nameFr.trim(), imageUrl: imageUrl ?? null })
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
    const [item] = await db.update(schema.productTypesTable)
      .set({ nameAr: nameAr.trim(), nameFr: nameFr.trim(), imageUrl: imageUrl ?? null })
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

export default router;

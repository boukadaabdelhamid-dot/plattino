import { Router } from "express";
import { eq, ilike, and, sql, or, inArray, gt } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { authenticate, requireAdmin, requireStaff, requireStore, optionalAuth, requirePermission, type AuthRequest } from "../lib/auth";
import { resolvePublicStore } from "../lib/store-context";

const router = Router();

// ── Public: product types (used by web store Shop by Category) ────────────────
router.get("/product-types", async (req: AuthRequest, res) => {
  try {
    const items = await db.select().from(schema.productTypesTable)
      .orderBy(schema.productTypesTable.id);
    res.json(items);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

const pid = (req: { params: Record<string, string | string[]> }, key: string): number => {
  const n = parseInt(req.params[key] as string);
  if (isNaN(n)) throw Object.assign(new Error("Invalid numeric id"), { statusCode: 400 });
  return n;
};

type ImageInput = { url: string; sortOrder?: number; isPrimary?: boolean };

// Replace a product's entire image gallery in one transaction.
// Normalizes ordering + ensures exactly one primary (auto-promotes the first
// when none is flagged). Also keeps products.image_url synced to the primary
// url for backward compatibility. Returns the persisted rows (sorted).
async function syncProductImages(productId: number, images: ImageInput[]) {
  const clean = images
    .filter((im) => im && typeof im.url === "string" && im.url.trim() !== "")
    .map((im, i) => ({
      url: im.url.trim(),
      sortOrder: typeof im.sortOrder === "number" ? im.sortOrder : i,
      isPrimary: !!im.isPrimary,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((im, i) => ({ ...im, sortOrder: i }));

  // Ensure exactly one primary
  if (clean.length > 0) {
    let primaryIdx = clean.findIndex((im) => im.isPrimary);
    if (primaryIdx === -1) primaryIdx = 0;
    clean.forEach((im, i) => { im.isPrimary = i === primaryIdx; });
  }

  return await db.transaction(async (tx) => {
    await tx.delete(schema.productImagesTable).where(eq(schema.productImagesTable.productId, productId));
    let rows: (typeof schema.productImagesTable.$inferSelect)[] = [];
    if (clean.length > 0) {
      rows = await tx.insert(schema.productImagesTable)
        .values(clean.map((im) => ({ productId, url: im.url, sortOrder: im.sortOrder, isPrimary: im.isPrimary })))
        .returning();
    }
    const primaryUrl = clean.find((im) => im.isPrimary)?.url ?? null;
    await tx.update(schema.productsTable)
      .set({ imageUrl: primaryUrl })
      .where(eq(schema.productsTable.id, productId));
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  });
}

// Load images for a set of products. Falls back to a synthesized primary
// entry from products.image_url when no rows exist (backward compat).
async function loadImagesFor(products: { id: number; imageUrl: string | null }[]) {
  const ids = products.map((p) => p.id);
  const byProduct = new Map<number, (typeof schema.productImagesTable.$inferSelect)[]>();
  if (ids.length > 0) {
    const rows = await db.select().from(schema.productImagesTable)
      .where(inArray(schema.productImagesTable.productId, ids))
      .orderBy(schema.productImagesTable.sortOrder);
    for (const r of rows) {
      const list = byProduct.get(r.productId) ?? [];
      list.push(r);
      byProduct.set(r.productId, list);
    }
  }
  return products.map((p) => {
    let images = byProduct.get(p.id) ?? [];
    if (images.length === 0 && p.imageUrl) {
      images = [{ id: -1, productId: p.id, url: p.imageUrl, sortOrder: 0, isPrimary: true, createdAt: new Date() }];
    }
    const primaryImage = images.find((im) => im.isPrimary)?.url ?? images[0]?.url ?? p.imageUrl ?? null;
    return { ...p, images, primaryImage };
  });
}

// GET /products — public storefront list (filtered by store)
// For ERP, the same client sends Authorization+selected store; we still filter by req.currentStoreId
router.get("/products", optionalAuth, async (req: AuthRequest, res, next) => {
  // Employees must have products.view permission — direct API calls still return 403.
  // Admins and unauthenticated users (web store customers) are unaffected.
  if (req.user?.role === "employee") {
    const [perm] = await db.select({ granted: schema.userPermissionsTable.granted })
      .from(schema.userPermissionsTable)
      .where(and(
        eq(schema.userPermissionsTable.userId, req.user.id),
        eq(schema.userPermissionsTable.section, "products"),
        eq(schema.userPermissionsTable.action, "view"),
      )).limit(1);
    if (!perm?.granted) { res.status(403).json({ error: "Forbidden: insufficient permissions" }); return; }
  }
  // optionalAuth populates req.currentStoreId from a valid JWT if present.
  // Anonymous, customer (no store), or invalid bearer → fall back to public.
  if (req.currentStoreId) return handleListProducts(req, res);
  return resolvePublicStore(req, res, () => handleListProducts(req, res));
});

async function handleListProducts(req: AuthRequest, res: import("express").Response) {
  try {
    const storeId = req.currentStoreId!;
    const {
      search, categoryId, page = "1", limit = "20",
      inStockOnly,
      filterName, filterCode, filterBrand, filterFamily, filterStock,
      filterId, filterRef, filterCatalogueType, filterDescription,
      filterModel, filterColor, filterColisage, filterWeight,
      filterCatalogue1, filterCatalogue2, filterCatalogue3,
      filterCatalogue4, filterCatalogue5, filterCatalogue6,
      filterCreatedAt, filterExposed, filterActive,
      filterPrice, filterPriceGros, filterPriceSemiGros, filterPriceMin, filterCostPrice,
    } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [eq(schema.productsTable.storeId, storeId)];

    if (search) {
      conditions.push(
        sql`(${ilike(schema.productsTable.nameAr, `%${search}%`)} OR ${ilike(schema.productsTable.nameEn, `%${search}%`)})`,
      );
    }
    if (categoryId) {
      conditions.push(eq(schema.productsTable.categoryId, parseInt(categoryId)));
    }
    if (filterName) {
      conditions.push(
        sql`(${ilike(schema.productsTable.nameEn, `%${filterName}%`)} OR ${ilike(schema.productsTable.nameAr, `%${filterName}%`)})`,
      );
    }
    if (filterCode) {
      // Also search in extra barcodes table so scanner lookups find all products
      const extraMatches = await db
        .select({ productId: schema.productBarcodesTable.productId })
        .from(schema.productBarcodesTable)
        .where(and(
          eq(schema.productBarcodesTable.storeId, storeId),
          ilike(schema.productBarcodesTable.barcode, `%${filterCode}%`),
        ));
      const extraIds = extraMatches.map((r) => r.productId);
      if (extraIds.length > 0) {
        conditions.push(or(
          ilike(schema.productsTable.barcode, `%${filterCode}%`),
          sql`${schema.productsTable.id} = ANY(ARRAY[${sql.join(extraIds.map((id) => sql`${id}`), sql`, `)}]::int[])`,
        )!);
      } else {
        conditions.push(ilike(schema.productsTable.barcode, `%${filterCode}%`));
      }
    }
    if (filterBrand) {
      conditions.push(ilike(schema.productsTable.brand, `%${filterBrand}%`));
    }
    if (filterFamily) {
      const matchingFamilies = await db
        .select({ id: schema.productFamiliesTable.id })
        .from(schema.productFamiliesTable)
        .where(
          or(
            ilike(schema.productFamiliesTable.nameFr, `%${filterFamily}%`),
            ilike(schema.productFamiliesTable.nameAr, `%${filterFamily}%`),
          ),
        );
      const famIds = matchingFamilies.map((f) => f.id);
      if (famIds.length === 0) {
        res.set("Cache-Control", "no-store");
        res.json({ products: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
        return;
      }
      conditions.push(sql`${schema.productsTable.familyId} = ANY(ARRAY[${sql.join(famIds.map(id => sql`${id}`), sql`, `)}]::int[])`);
    }
    if (filterStock) {
      conditions.push(sql`${schema.productsTable.stock}::text ILIKE ${`%${filterStock}%`}`);
    }
    if (inStockOnly === "true") {
      conditions.push(gt(schema.productsTable.stock, 0));
    }
    if (filterId) {
      conditions.push(sql`${schema.productsTable.id}::text ILIKE ${`%${filterId}%`}`);
    }
    if (filterRef) {
      conditions.push(ilike(schema.productsTable.reference, `%${filterRef}%`));
    }
    if (filterCatalogueType) {
      conditions.push(ilike(schema.productsTable.catalogueType, `%${filterCatalogueType}%`));
    }
    if (filterDescription) {
      conditions.push(
        sql`(${ilike(schema.productsTable.descriptionEn, `%${filterDescription}%`)} OR ${ilike(schema.productsTable.descriptionAr, `%${filterDescription}%`)})`,
      );
    }
    if (filterModel) {
      conditions.push(ilike(schema.productsTable.model, `%${filterModel}%`));
    }
    if (filterColor) {
      conditions.push(ilike(schema.productsTable.color, `%${filterColor}%`));
    }
    if (filterColisage) {
      conditions.push(sql`${schema.productsTable.colisage}::text ILIKE ${`%${filterColisage}%`}`);
    }
    if (filterWeight) {
      conditions.push(ilike(schema.productsTable.weight, `%${filterWeight}%`));
    }
    if (filterCatalogue1) {
      conditions.push(ilike(schema.productsTable.catalogue1, `%${filterCatalogue1}%`));
    }
    if (filterCatalogue2) {
      conditions.push(ilike(schema.productsTable.catalogue2, `%${filterCatalogue2}%`));
    }
    if (filterCatalogue3) {
      conditions.push(ilike(schema.productsTable.catalogue3, `%${filterCatalogue3}%`));
    }
    if (filterCatalogue4) {
      conditions.push(ilike(schema.productsTable.catalogue4, `%${filterCatalogue4}%`));
    }
    if (filterCatalogue5) {
      conditions.push(ilike(schema.productsTable.catalogue5, `%${filterCatalogue5}%`));
    }
    if (filterCatalogue6) {
      conditions.push(ilike(schema.productsTable.catalogue6, `%${filterCatalogue6}%`));
    }
    if (filterCreatedAt) {
      conditions.push(sql`${schema.productsTable.createdAt}::text ILIKE ${`%${filterCreatedAt}%`}`);
    }
    if (filterExposed) {
      const v = filterExposed.toLowerCase();
      if (["oui", "true", "1", "yes"].includes(v)) {
        conditions.push(eq(schema.productsTable.isExposed, true));
      } else if (["non", "false", "0", "no"].includes(v)) {
        conditions.push(eq(schema.productsTable.isExposed, false));
      }
    }
    if (filterActive) {
      const v = filterActive.toLowerCase();
      if (["actif", "true", "1", "yes"].includes(v)) {
        conditions.push(eq(schema.productsTable.isActive, true));
      } else if (["inactif", "false", "0", "no"].includes(v)) {
        conditions.push(eq(schema.productsTable.isActive, false));
      }
    }
    if (filterPrice) {
      conditions.push(sql`${schema.productsTable.price}::text ILIKE ${`%${filterPrice}%`}`);
    }
    if (filterPriceGros) {
      conditions.push(sql`${schema.productsTable.priceGros}::text ILIKE ${`%${filterPriceGros}%`}`);
    }
    if (filterPriceSemiGros) {
      conditions.push(sql`${schema.productsTable.priceSemiGros}::text ILIKE ${`%${filterPriceSemiGros}%`}`);
    }
    if (filterPriceMin) {
      conditions.push(sql`${schema.productsTable.priceMin}::text ILIKE ${`%${filterPriceMin}%`}`);
    }
    if (filterCostPrice) {
      conditions.push(sql`${schema.productsTable.costPrice}::text ILIKE ${`%${filterCostPrice}%`}`);
    }

    const products = await db.select().from(schema.productsTable)
      .where(and(...conditions))
      .limit(parseInt(limit))
      .offset(offset)
      .orderBy(schema.productsTable.createdAt);

    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.productsTable)
      .where(and(...conditions));

    const withImages = await loadImagesFor(products);

    res.set("Cache-Control", "no-store");
    res.json({ products: withImages, total: Number(count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
}

// GET /products/:id — public, store-scoped
router.get("/products/:id", optionalAuth, async (req: AuthRequest, res) => {
  if (req.user?.role === "employee") {
    const [perm] = await db.select({ granted: schema.userPermissionsTable.granted })
      .from(schema.userPermissionsTable)
      .where(and(
        eq(schema.userPermissionsTable.userId, req.user.id),
        eq(schema.userPermissionsTable.section, "products"),
        eq(schema.userPermissionsTable.action, "view"),
      )).limit(1);
    if (!perm?.granted) { res.status(403).json({ error: "Forbidden: insufficient permissions" }); return; }
  }
  if (req.currentStoreId) return handleGetProduct(req, res);
  return resolvePublicStore(req, res, () => handleGetProduct(req, res));
});

async function handleGetProduct(req: AuthRequest, res: import("express").Response) {
  try {
    const storeId = req.currentStoreId!;
    const id = parseInt(req.params["id"] as string);
    const [product] = await db.select().from(schema.productsTable)
      .where(and(eq(schema.productsTable.id, id), eq(schema.productsTable.storeId, storeId))).limit(1);
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }

    const reviews = await db.select({
      id: schema.productReviewsTable.id,
      rating: schema.productReviewsTable.rating,
      comment: schema.productReviewsTable.comment,
      createdAt: schema.productReviewsTable.createdAt,
      userName: schema.usersTable.name,
    })
      .from(schema.productReviewsTable)
      .leftJoin(schema.usersTable, eq(schema.productReviewsTable.userId, schema.usersTable.id))
      .where(eq(schema.productReviewsTable.productId, product.id))
      .orderBy(schema.productReviewsTable.createdAt);

    const [withImages] = await loadImagesFor([product]);

    res.json({ ...withImages, reviews });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
}

// POST /erp/products/generate-barcode (admin) — generates a unique EAN-13
// for the current store. Prefix 200-299 is reserved for in-store/private use
// per GS1, so we use a tenant-scoped 200-prefix code.
router.post("/erp/products/generate-barcode", authenticate, requireStaff, requireStore, requirePermission("products", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    function ean13Checksum(d12: string): string {
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        const n = parseInt(d12[i] as string, 10);
        sum += i % 2 === 0 ? n : n * 3;
      }
      return String((10 - (sum % 10)) % 10);
    }
    function genCandidate(): string {
      // 200 + 4-digit store id (zero-padded) + 5 random digits + checksum = 13
      const storePart = String(storeId % 10000).padStart(4, "0");
      const rand = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
      const d12 = "200" + storePart + rand;
      return d12 + ean13Checksum(d12);
    }
    let code = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = genCandidate();
      const [hit] = await db.select({ id: schema.productsTable.id })
        .from(schema.productsTable)
        .where(and(
          eq(schema.productsTable.storeId, storeId),
          eq(schema.productsTable.barcode, candidate),
        ))
        .limit(1);
      if (!hit) { code = candidate; break; }
    }
    if (!code) { res.status(500).json({ error: "Could not generate unique barcode" }); return; }
    res.json({ barcode: code });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /products (admin)
router.post("/products", authenticate, requireStaff, requireStore, requirePermission("products", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const {
      nameAr, nameEn, descriptionAr, descriptionEn, price, imageUrl, stock, categoryId,
      reference, barcode, costPrice, catalogueType,
      brand, model, color, colisage, weight,
      priceGros, priceSemiGros, priceMin,
      catalogue1, catalogue2, catalogue3, catalogue4, catalogue5, catalogue6,
      isActive, isExposed,
      familyId, brandId, colorId,
      images,
    } = req.body;
    if (categoryId != null) {
      const [cat] = await db.select({ id: schema.categoriesTable.id })
        .from(schema.categoriesTable)
        .where(and(eq(schema.categoriesTable.id, Number(categoryId)), eq(schema.categoriesTable.storeId, storeId)))
        .limit(1);
      if (!cat) { res.status(400).json({ error: "categoryId does not belong to current store" }); return; }
    }
    const resolvedFamilyId = familyId != null ? Number(familyId) : null;
    const resolvedBrandId = brandId != null ? Number(brandId) : null;
    const resolvedColorId = colorId != null ? Number(colorId) : null;
    if (resolvedFamilyId != null) {
      const [row] = await db.select({ id: schema.productFamiliesTable.id }).from(schema.productFamiliesTable)
        .where(and(eq(schema.productFamiliesTable.id, resolvedFamilyId), eq(schema.productFamiliesTable.storeId, storeId))).limit(1);
      if (!row) { res.status(400).json({ error: "familyId does not belong to current store" }); return; }
    }
    if (resolvedBrandId != null) {
      const [row] = await db.select({ id: schema.productBrandsTable.id }).from(schema.productBrandsTable)
        .where(and(eq(schema.productBrandsTable.id, resolvedBrandId), eq(schema.productBrandsTable.storeId, storeId))).limit(1);
      if (!row) { res.status(400).json({ error: "brandId does not belong to current store" }); return; }
    }
    if (resolvedColorId != null) {
      const [row] = await db.select({ id: schema.productColorsTable.id }).from(schema.productColorsTable)
        .where(and(eq(schema.productColorsTable.id, resolvedColorId), eq(schema.productColorsTable.storeId, storeId))).limit(1);
      if (!row) { res.status(400).json({ error: "colorId does not belong to current store" }); return; }
    }
    const [product] = await db.insert(schema.productsTable).values({
      storeId,
      nameAr, nameEn,
      descriptionAr: descriptionAr || "",
      descriptionEn: descriptionEn || "",
      price, imageUrl, stock: stock || 0, categoryId,
      reference: reference || null,
      barcode: barcode || null,
      costPrice: costPrice || null,
      catalogueType: catalogueType || "ARTICLE",
      brand: brand || null,
      model: model || null,
      color: color || null,
      colisage: colisage || 1,
      weight: weight || null,
      priceGros: priceGros || null,
      priceSemiGros: priceSemiGros || null,
      priceMin: priceMin || null,
      catalogue1: catalogue1 || null,
      catalogue2: catalogue2 || null,
      catalogue3: catalogue3 || null,
      catalogue4: catalogue4 || null,
      catalogue5: catalogue5 || null,
      catalogue6: catalogue6 || null,
      isActive: isActive !== undefined ? isActive : true,
      isExposed: isExposed !== undefined ? isExposed : true,
      familyId: resolvedFamilyId,
      brandId: resolvedBrandId,
      colorId: resolvedColorId,
    }).returning();
    if (Array.isArray(images) && images.length > 0) {
      await syncProductImages(product.id, images);
      const [fresh] = await db.select().from(schema.productsTable).where(eq(schema.productsTable.id, product.id)).limit(1);
      const [withImages] = await loadImagesFor([fresh ?? product]);
      res.status(201).json(withImages);
      return;
    }
    const [withImages] = await loadImagesFor([product]);
    res.status(201).json(withImages);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /products/:id (admin) — store-scoped
router.put("/products/:id", authenticate, requireStaff, requireStore, requirePermission("products", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    // Drop any storeId from body — never let client move products across stores
    const body = { ...req.body };
    delete body.storeId;
    // Pull images out — they live in a separate table, not on products
    const images = body.images;
    delete body.images;
    if (body.categoryId != null) {
      const [cat] = await db.select({ id: schema.categoriesTable.id })
        .from(schema.categoriesTable)
        .where(and(eq(schema.categoriesTable.id, Number(body.categoryId)), eq(schema.categoriesTable.storeId, storeId)))
        .limit(1);
      if (!cat) { res.status(400).json({ error: "categoryId does not belong to current store" }); return; }
    }
    if (body.familyId != null) {
      const fid = Number(body.familyId);
      const [row] = await db.select({ id: schema.productFamiliesTable.id }).from(schema.productFamiliesTable)
        .where(and(eq(schema.productFamiliesTable.id, fid), eq(schema.productFamiliesTable.storeId, storeId))).limit(1);
      if (!row) { res.status(400).json({ error: "familyId does not belong to current store" }); return; }
      body.familyId = fid;
    } else if ("familyId" in body) {
      body.familyId = null;
    }
    if (body.brandId != null) {
      const bid = Number(body.brandId);
      const [row] = await db.select({ id: schema.productBrandsTable.id }).from(schema.productBrandsTable)
        .where(and(eq(schema.productBrandsTable.id, bid), eq(schema.productBrandsTable.storeId, storeId))).limit(1);
      if (!row) { res.status(400).json({ error: "brandId does not belong to current store" }); return; }
      body.brandId = bid;
    } else if ("brandId" in body) {
      body.brandId = null;
    }
    if (body.colorId != null) {
      const cid = Number(body.colorId);
      const [row] = await db.select({ id: schema.productColorsTable.id }).from(schema.productColorsTable)
        .where(and(eq(schema.productColorsTable.id, cid), eq(schema.productColorsTable.storeId, storeId))).limit(1);
      if (!row) { res.status(400).json({ error: "colorId does not belong to current store" }); return; }
      body.colorId = cid;
    } else if ("colorId" in body) {
      body.colorId = null;
    }
    const [product] = await db.update(schema.productsTable)
      .set(body)
      .where(and(eq(schema.productsTable.id, id), eq(schema.productsTable.storeId, storeId)))
      .returning();
    if (!product) { res.status(404).json({ error: "Not found" }); return; }
    if (Array.isArray(images)) {
      await syncProductImages(product.id, images);
      const [fresh] = await db.select().from(schema.productsTable).where(eq(schema.productsTable.id, product.id)).limit(1);
      const [withImages] = await loadImagesFor([fresh ?? product]);
      res.json(withImages);
      return;
    }
    const [withImages] = await loadImagesFor([product]);
    res.json(withImages);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// DELETE /products/:id (admin) — store-scoped
router.delete("/products/:id", authenticate, requireStaff, requireStore, requirePermission("products", "delete"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    await db.delete(schema.productsTable)
      .where(and(eq(schema.productsTable.id, pid(req, "id")), eq(schema.productsTable.storeId, storeId)));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /categories — public
router.get("/categories", optionalAuth, async (req: AuthRequest, res) => {
  const handler = async () => {
    try {
      const storeId = req.currentStoreId!;
      const categories = await db.select().from(schema.categoriesTable)
        .where(eq(schema.categoriesTable.storeId, storeId))
        .orderBy(schema.categoriesTable.id);
      res.json(categories);
    } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
  };
  if (req.currentStoreId) return handler();
  return resolvePublicStore(req, res, handler);
});

// POST /categories (admin)
router.post("/categories", authenticate, requireStaff, requireStore, requirePermission("products", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const body = { ...req.body, storeId };
    const [cat] = await db.insert(schema.categoriesTable).values(body).returning();
    res.status(201).json(cat);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/categories/:id", authenticate, requireStaff, requireStore, requirePermission("products", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const body = { ...req.body }; delete body.storeId;
    const [cat] = await db.update(schema.categoriesTable).set(body)
      .where(and(eq(schema.categoriesTable.id, pid(req, "id")), eq(schema.categoriesTable.storeId, storeId)))
      .returning();
    if (!cat) { res.status(404).json({ error: "Not found" }); return; }
    res.json(cat);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/categories/:id", authenticate, requireStaff, requireStore, requirePermission("products", "delete"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    await db.delete(schema.categoriesTable)
      .where(and(eq(schema.categoriesTable.id, id), eq(schema.categoriesTable.storeId, storeId)));
    res.json({ success: true });
  } catch (err: unknown) {
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 400) { res.status(400).json({ error: e.message ?? "Bad request" }); return; }
    if (e.code === "23503") {
      res.status(409).json({ error: "Cannot delete category: products are assigned to it. Reassign or delete those products first." });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /products/:id/reviews (no store filter; review references product id which is implicitly scoped)
router.post("/products/:id/reviews", authenticate, async (req: AuthRequest, res) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      res.status(400).json({ error: "Rating must be 1-5" });
      return;
    }
    const productId = pid(req, "id");
    const [review] = await db.insert(schema.productReviewsTable).values({
      productId, userId: req.user!.id, rating, comment,
    }).returning();

    const reviews = await db.select({ rating: schema.productReviewsTable.rating })
      .from(schema.productReviewsTable).where(eq(schema.productReviewsTable.productId, productId));
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    await db.update(schema.productsTable)
      .set({ rating: avg.toFixed(2), reviewCount: reviews.length })
      .where(eq(schema.productsTable.id, productId));

    res.status(201).json(review);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /products/:id/images (admin) — replace a product's image gallery, store-scoped
router.put("/products/:id/images", authenticate, requireStaff, requireStore, requirePermission("products", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const id = pid(req, "id");
    const [product] = await db.select({ id: schema.productsTable.id })
      .from(schema.productsTable)
      .where(and(eq(schema.productsTable.id, id), eq(schema.productsTable.storeId, storeId)))
      .limit(1);
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    const { images } = req.body as { images?: ImageInput[] };
    if (!Array.isArray(images)) { res.status(400).json({ error: "images must be an array" }); return; }
    const rows = await syncProductImages(id, images);
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ── Extra barcodes for a product ──────────────────────────────────────
// Note: these routes omit requireStore — the storeId is derived from the
// product record itself, so admin can manage barcodes without a store JWT claim.

// GET /erp/products/extra-barcodes — all extra barcodes (used by POS for fast in-memory lookup)
router.get("/erp/products/extra-barcodes", authenticate, requireStaff, requirePermission("products", "view"), async (req: AuthRequest, res) => {
  try {
    const rows = await db.select({
      barcode: schema.productBarcodesTable.barcode,
      productId: schema.productBarcodesTable.productId,
    }).from(schema.productBarcodesTable);
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/products/:id/barcodes — list additional barcodes
router.get("/erp/products/:id/barcodes", authenticate, requireStaff, requirePermission("products", "view"), async (req: AuthRequest, res) => {
  try {
    const productId = pid(req, "id");
    const [product] = await db.select({ storeId: schema.productsTable.storeId })
      .from(schema.productsTable)
      .where(eq(schema.productsTable.id, productId))
      .limit(1);
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    const rows = await db.select()
      .from(schema.productBarcodesTable)
      .where(and(
        eq(schema.productBarcodesTable.productId, productId),
        eq(schema.productBarcodesTable.storeId, product.storeId),
      ));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/products/:id/barcodes — add a barcode
router.post("/erp/products/:id/barcodes", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const productId = pid(req, "id");
    const [product] = await db.select({ storeId: schema.productsTable.storeId })
      .from(schema.productsTable)
      .where(eq(schema.productsTable.id, productId))
      .limit(1);
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    const storeId = product.storeId;

    const { barcode } = req.body as { barcode?: string };
    if (!barcode?.trim()) { res.status(400).json({ error: "barcode is required" }); return; }
    const bc = barcode.trim();

    // Check against main barcode field
    const [inMain] = await db.select({ id: schema.productsTable.id })
      .from(schema.productsTable)
      .where(and(eq(schema.productsTable.storeId, storeId), eq(schema.productsTable.barcode, bc)))
      .limit(1);
    if (inMain) { res.status(409).json({ error: "Ce code-barres est déjà utilisé par un autre produit" }); return; }

    // Check against extra barcodes table (globally unique)
    const [inExtra] = await db.select({ id: schema.productBarcodesTable.id })
      .from(schema.productBarcodesTable)
      .where(eq(schema.productBarcodesTable.barcode, bc))
      .limit(1);
    if (inExtra) { res.status(409).json({ error: "Ce code-barres est déjà utilisé" }); return; }

    const [inserted] = await db.insert(schema.productBarcodesTable)
      .values({ productId, storeId, barcode: bc })
      .returning();
    res.status(201).json(inserted);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/products/copy-to-stores (admin) — copy products to one or more other stores
// The source products must belong to the current store (req.currentStoreId).
// For each (productId, targetStoreId) pair:
//   - If barcode exists and a product with that barcode already exists → status "already_exists"
//   - category/family/brand/color are matched by nameAr in target store (null if no match)
//   - stock is set to 0 in the new store
router.post("/erp/products/copy-to-stores", authenticate, requireStaff, requireStore, requirePermission("products", "create"), async (req: AuthRequest, res) => {
  try {
    const sourceStoreId = req.currentStoreId!;
    const { productIds, targetStoreIds } = req.body as { productIds?: unknown; targetStoreIds?: unknown };

    if (!Array.isArray(productIds) || !Array.isArray(targetStoreIds) || productIds.length === 0 || targetStoreIds.length === 0) {
      res.status(400).json({ error: "productIds and targetStoreIds must be non-empty arrays" });
      return;
    }

    const pidArr = (productIds as unknown[]).map(Number).filter((n) => !isNaN(n));
    const tidArr = (targetStoreIds as unknown[]).map(Number).filter((n) => !isNaN(n) && n !== sourceStoreId);

    if (tidArr.length === 0) {
      res.status(400).json({ error: "No valid target stores (cannot copy to the same store)" });
      return;
    }

    type CopyResult = {
      productId: number;
      targetStoreId: number;
      status: "created" | "already_exists" | "error";
      newProductId?: number;
      message?: string;
    };
    const results: CopyResult[] = [];

    for (const productId of pidArr) {
      // Verify product belongs to current store
      const [src] = await db.select()
        .from(schema.productsTable)
        .where(and(eq(schema.productsTable.id, productId), eq(schema.productsTable.storeId, sourceStoreId)))
        .limit(1);

      if (!src) {
        for (const targetStoreId of tidArr) {
          results.push({ productId, targetStoreId, status: "error", message: "Product not found in current store" });
        }
        continue;
      }

      // Pre-fetch source attribute names for cross-store matching
      let srcCategoryNameAr: string | null = null;
      if (src.categoryId) {
        const [c] = await db.select({ nameAr: schema.categoriesTable.nameAr })
          .from(schema.categoriesTable).where(eq(schema.categoriesTable.id, src.categoryId)).limit(1);
        srcCategoryNameAr = c?.nameAr ?? null;
      }
      let srcFamilyNameAr: string | null = null;
      if (src.familyId) {
        const [f] = await db.select({ nameAr: schema.productFamiliesTable.nameAr })
          .from(schema.productFamiliesTable).where(eq(schema.productFamiliesTable.id, src.familyId)).limit(1);
        srcFamilyNameAr = f?.nameAr ?? null;
      }
      let srcBrandNameAr: string | null = null;
      if (src.brandId) {
        const [b] = await db.select({ nameAr: schema.productBrandsTable.nameAr })
          .from(schema.productBrandsTable).where(eq(schema.productBrandsTable.id, src.brandId)).limit(1);
        srcBrandNameAr = b?.nameAr ?? null;
      }
      let srcColorNameAr: string | null = null;
      if (src.colorId) {
        const [c] = await db.select({ nameAr: schema.productColorsTable.nameAr })
          .from(schema.productColorsTable).where(eq(schema.productColorsTable.id, src.colorId)).limit(1);
        srcColorNameAr = c?.nameAr ?? null;
      }

      for (const targetStoreId of tidArr) {
        try {
          // Duplicate detection via primary barcode
          if (src.barcode) {
            const [existing] = await db.select({ id: schema.productsTable.id })
              .from(schema.productsTable)
              .where(and(
                eq(schema.productsTable.storeId, targetStoreId),
                eq(schema.productsTable.barcode, src.barcode),
              ))
              .limit(1);
            if (existing) {
              results.push({ productId, targetStoreId, status: "already_exists", message: "Barcode already exists in target store" });
              continue;
            }
          }

          // Match attributes in target store by nameAr (null if not found)
          let targetCategoryId: number | null = null;
          if (srcCategoryNameAr) {
            const [c] = await db.select({ id: schema.categoriesTable.id })
              .from(schema.categoriesTable)
              .where(and(eq(schema.categoriesTable.storeId, targetStoreId), eq(schema.categoriesTable.nameAr, srcCategoryNameAr)))
              .limit(1);
            targetCategoryId = c?.id ?? null;
          }
          let targetFamilyId: number | null = null;
          if (srcFamilyNameAr) {
            const [f] = await db.select({ id: schema.productFamiliesTable.id })
              .from(schema.productFamiliesTable)
              .where(and(eq(schema.productFamiliesTable.storeId, targetStoreId), eq(schema.productFamiliesTable.nameAr, srcFamilyNameAr)))
              .limit(1);
            targetFamilyId = f?.id ?? null;
          }
          let targetBrandId: number | null = null;
          if (srcBrandNameAr) {
            const [b] = await db.select({ id: schema.productBrandsTable.id })
              .from(schema.productBrandsTable)
              .where(and(eq(schema.productBrandsTable.storeId, targetStoreId), eq(schema.productBrandsTable.nameAr, srcBrandNameAr)))
              .limit(1);
            targetBrandId = b?.id ?? null;
          }
          let targetColorId: number | null = null;
          if (srcColorNameAr) {
            const [c] = await db.select({ id: schema.productColorsTable.id })
              .from(schema.productColorsTable)
              .where(and(eq(schema.productColorsTable.storeId, targetStoreId), eq(schema.productColorsTable.nameAr, srcColorNameAr)))
              .limit(1);
            targetColorId = c?.id ?? null;
          }

          const [newProduct] = await db.insert(schema.productsTable).values({
            storeId: targetStoreId,
            nameAr: src.nameAr,
            nameEn: src.nameEn,
            descriptionAr: src.descriptionAr,
            descriptionEn: src.descriptionEn,
            price: src.price,
            imageUrl: src.imageUrl,
            stock: 0,
            categoryId: targetCategoryId,
            reference: src.reference,
            barcode: src.barcode,
            costPrice: src.costPrice,
            catalogueType: src.catalogueType,
            brand: src.brand,
            model: src.model,
            color: src.color,
            colisage: src.colisage,
            weight: src.weight,
            priceGros: src.priceGros,
            priceSemiGros: src.priceSemiGros,
            priceMin: src.priceMin,
            catalogue1: src.catalogue1,
            catalogue2: src.catalogue2,
            catalogue3: src.catalogue3,
            catalogue4: src.catalogue4,
            catalogue5: src.catalogue5,
            catalogue6: src.catalogue6,
            isActive: src.isActive,
            isExposed: src.isExposed,
            familyId: targetFamilyId,
            brandId: targetBrandId,
            colorId: targetColorId,
          }).returning();

          results.push({ productId, targetStoreId, status: "created", newProductId: newProduct.id });
        } catch (err) {
          req.log.error(err);
          results.push({ productId, targetStoreId, status: "error", message: "Failed to create product" });
        }
      }
    }

    res.json({ results });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/products/:productId/cross-store-stock (admin) — read-only view of this
// product's stock in EVERY active store. Cross-store identity uses the exact same
// mechanism as "copy to other stores" and inter-store transfers: matching by
// reference first, then barcode. A store with no matching product shows stock 0.
router.get("/erp/products/:productId/cross-store-stock", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const currentStoreId = req.currentStoreId!;
    const productId = pid(req, "productId");

    const [src] = await db.select({
      id: schema.productsTable.id,
      storeId: schema.productsTable.storeId,
      stock: schema.productsTable.stock,
      reference: schema.productsTable.reference,
      barcode: schema.productsTable.barcode,
    }).from(schema.productsTable).where(eq(schema.productsTable.id, productId)).limit(1);

    if (!src) { res.status(404).json({ error: "Product not found" }); return; }

    // Cross-store identity uses the SAME single key as inter-store transfers and
    // "copy to other stores": the product's reference if present, otherwise its
    // barcode. A store's matching product is one whose reference OR barcode equals
    // that key. With neither, the product cannot be linked across stores.
    const matchKey = (src.reference || src.barcode || "").trim() || null;

    // All active stores, stable order for display.
    const stores = await db.select({
      id: schema.storesTable.id,
      nameAr: schema.storesTable.nameAr,
      nameEn: schema.storesTable.nameEn,
    }).from(schema.storesTable)
      .where(eq(schema.storesTable.isActive, true))
      .orderBy(schema.storesTable.id);

    let matches: { id: number; storeId: number; stock: number }[];
    if (matchKey) {
      matches = await db.select({
        id: schema.productsTable.id,
        storeId: schema.productsTable.storeId,
        stock: schema.productsTable.stock,
      }).from(schema.productsTable)
        .where(or(
          eq(schema.productsTable.reference, matchKey),
          eq(schema.productsTable.barcode, matchKey),
        ))
        .orderBy(schema.productsTable.id);
    } else {
      matches = [{ id: src.id, storeId: src.storeId, stock: src.stock }];
    }

    // One product row per store; the source row always represents its own store.
    const byStore = new Map<number, { productId: number; stock: number }>();
    for (const m of matches) {
      if (!byStore.has(m.storeId)) byStore.set(m.storeId, { productId: m.id, stock: m.stock });
    }
    byStore.set(src.storeId, { productId: src.id, stock: src.stock });

    // Last stock movement timestamp per matched product row.
    const ids = [...new Set([...byStore.values()].map((v) => v.productId))];
    const lastMap = new Map<number, string>();
    if (ids.length > 0) {
      const lastRows = await db.select({
        productId: schema.inventoryMovementsTable.productId,
        lastUpdate: sql<string>`max(${schema.inventoryMovementsTable.createdAt})`,
      }).from(schema.inventoryMovementsTable)
        .where(inArray(schema.inventoryMovementsTable.productId, ids))
        .groupBy(schema.inventoryMovementsTable.productId);
      for (const r of lastRows) if (r.lastUpdate) lastMap.set(r.productId, r.lastUpdate);
    }

    const result = stores.map((s) => {
      const hit = byStore.get(s.id);
      return {
        storeId: s.id,
        storeNameAr: s.nameAr,
        storeNameEn: s.nameEn,
        isCurrent: s.id === currentStoreId,
        exists: !!hit,
        stock: hit ? hit.stock : 0,
        lastUpdate: hit ? (lastMap.get(hit.productId) ?? null) : null,
      };
    });

    res.json({ matchKey, stores: result });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// DELETE /erp/products/:id/barcodes/:barcodeId — remove a barcode
router.delete("/erp/products/:id/barcodes/:barcodeId", authenticate, requireStaff, requirePermission("products", "delete"), async (req: AuthRequest, res) => {
  try {
    const productId = pid(req, "id");
    const barcodeId = pid(req, "barcodeId");
    const [product] = await db.select({ storeId: schema.productsTable.storeId })
      .from(schema.productsTable)
      .where(eq(schema.productsTable.id, productId))
      .limit(1);
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    await db.delete(schema.productBarcodesTable)
      .where(and(
        eq(schema.productBarcodesTable.id, barcodeId),
        eq(schema.productBarcodesTable.productId, productId),
        eq(schema.productBarcodesTable.storeId, product.storeId),
      ));
    res.status(204).end();
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { authenticate, type AuthRequest } from "../lib/auth";
import { resolvePublicStore } from "../lib/store-context";

const router = Router();

// All cart endpoints require both: authenticated user + a store (resolved from
// JWT.currentStoreId or from ?store=<slug> / X-Store-Slug header).
function withStore(req: AuthRequest, res: import("express").Response, next: import("express").NextFunction) {
  if (typeof req.currentStoreId === "number") return next();
  return resolvePublicStore(req, res, next);
}

// GET /cart
router.get("/cart", authenticate, withStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const items = await db.select({
      id: schema.cartItemsTable.id,
      quantity: schema.cartItemsTable.quantity,
      product: {
        id: schema.productsTable.id,
        nameAr: schema.productsTable.nameAr,
        nameEn: schema.productsTable.nameEn,
        price: schema.productsTable.price,
        imageUrl: schema.productsTable.imageUrl,
        stock: schema.productsTable.stock,
      },
    })
      .from(schema.cartItemsTable)
      .leftJoin(schema.productsTable, eq(schema.cartItemsTable.productId, schema.productsTable.id))
      .where(and(
        eq(schema.cartItemsTable.userId, req.user!.id),
        eq(schema.cartItemsTable.storeId, storeId),
      ));
    res.json(items);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /cart
router.post("/cart", authenticate, withStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { productId, quantity = 1 } = req.body;
    if (!Number.isInteger(quantity) || quantity < 1) {
      res.status(400).json({ error: "quantity must be a positive integer" });
      return;
    }
    // Verify the product belongs to this store
    const [product] = await db.select({ id: schema.productsTable.id }).from(schema.productsTable)
      .where(and(eq(schema.productsTable.id, productId), eq(schema.productsTable.storeId, storeId))).limit(1);
    if (!product) { res.status(404).json({ error: "Product not found in this store" }); return; }

    const existing = await db.select().from(schema.cartItemsTable)
      .where(and(
        eq(schema.cartItemsTable.userId, req.user!.id),
        eq(schema.cartItemsTable.productId, productId),
        eq(schema.cartItemsTable.storeId, storeId),
      ))
      .limit(1);

    if (existing.length > 0) {
      const [item] = await db.update(schema.cartItemsTable)
        .set({ quantity: existing[0].quantity + quantity })
        .where(eq(schema.cartItemsTable.id, existing[0].id))
        .returning();
      res.json(item);
    } else {
      const [item] = await db.insert(schema.cartItemsTable)
        .values({ userId: req.user!.id, productId, quantity, storeId })
        .returning();
      res.status(201).json(item);
    }
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/cart/:productId", authenticate, withStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { quantity } = req.body;
    const productId = parseInt(req.params["productId"] as string);
    const where = and(
      eq(schema.cartItemsTable.userId, req.user!.id),
      eq(schema.cartItemsTable.productId, productId),
      eq(schema.cartItemsTable.storeId, storeId),
    );
    if (quantity <= 0) {
      await db.delete(schema.cartItemsTable).where(where);
      res.json({ success: true });
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      res.status(400).json({ error: "quantity must be a positive integer" });
      return;
    }
    const [item] = await db.update(schema.cartItemsTable).set({ quantity }).where(where).returning();
    res.json(item);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/cart/:productId", authenticate, withStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    await db.delete(schema.cartItemsTable)
      .where(and(
        eq(schema.cartItemsTable.userId, req.user!.id),
        eq(schema.cartItemsTable.productId, parseInt(req.params["productId"] as string)),
        eq(schema.cartItemsTable.storeId, storeId),
      ));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /coupons/validate — store-scoped
router.post("/coupons/validate", resolvePublicStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { code, orderTotal } = req.body;
    const [coupon] = await db.select().from(schema.couponsTable)
      .where(and(
        eq(schema.couponsTable.code, (code as string).toUpperCase()),
        eq(schema.couponsTable.storeId, storeId),
      )).limit(1);

    if (!coupon) { res.status(404).json({ error: "Coupon not found" }); return; }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      res.status(400).json({ error: "Coupon expired" }); return;
    }
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      res.status(400).json({ error: "Coupon usage limit reached" }); return;
    }
    if (orderTotal < parseFloat(coupon.minOrder)) {
      res.status(400).json({ error: `Minimum order: ${coupon.minOrder}` }); return;
    }

    const discount = coupon.type === "percent"
      ? (orderTotal * parseFloat(coupon.value)) / 100
      : parseFloat(coupon.value);

    res.json({ valid: true, code: coupon.code, type: coupon.type, value: coupon.value, discount: discount.toFixed(2) });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;

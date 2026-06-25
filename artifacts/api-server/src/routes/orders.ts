import { Router } from "express";
import { eq, desc, sql, lt, and, inArray, isNull, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { authenticate, requireAdmin, requireStaff, requireStore, optionalAuth, requirePermission, type AuthRequest } from "../lib/auth";
import { resolvePublicStore } from "../lib/store-context";
import { broadcastToAdmins, broadcastToStoreUsers, broadcastToStaffByStores, broadcastCaisseChanged } from "../lib/ws";
import { ensureCaisse } from "./caisses";


const router = Router();

const pid = (req: { params: Record<string, string | string[]> }, key: string): number => {
  const n = parseInt(req.params[key] as string);
  if (isNaN(n)) throw Object.assign(new Error("Invalid numeric id"), { statusCode: 400 });
  return n;
};

// POST /orders — atomic checkout. Resolves the store from the public storefront
// (?store=<slug> / X-Store-Slug header), or — if the customer happens to be
// logged in via JWT with a currentStoreId — uses that.
router.post("/orders", optionalAuth, async (req: AuthRequest, res, next) => {
  if (typeof req.currentStoreId === "number") return handleCreateOrder(req, res);
  return resolvePublicStore(req, res, () => handleCreateOrder(req, res));
});

async function handleCreateOrder(req: AuthRequest, res: import("express").Response) {
  try {
    const storeId = req.currentStoreId!;
    const { customerName, customerPhone, customerAddress, items, couponCode, linkedCustomerId, paymentMode, versement: versementRaw } = req.body;

    // Down-payment (versement) collected at the time of an à-terme POS sale.
    // It reduces the receivable registered against the customer's credit
    // (receivable = total - versement) and is credited to the seller's caisse
    // as cash actually collected now. Defaults to 0 and is clamped to the
    // order total inside the transaction once the authoritative total is known.
    const versement = Math.max(0, Number(versementRaw ?? 0) || 0);

    // Determine whether this is a staff-initiated POS (Vente Comptoir) sale.
    // Any authenticated admin/employee creating an order is selling at the
    // counter; storefront orders are placed by customers (or anonymous guests).
    const isPosSale = !!(req.user && (req.user.role === "admin" || req.user.role === "employee"));

    // Every POS sale MUST be linked to a real customer. Use the explicitly
    // selected client when provided, otherwise fall back to the store's
    // configured default comptoir customer. If neither exists, block the sale
    // (no anonymous POS sales — keeps caisse/CRM reporting consistent).
    let posCustomerId: number | null = null;
    if (isPosSale) {
      if (linkedCustomerId !== undefined && linkedCustomerId !== null && linkedCustomerId !== "") {
        posCustomerId = Number(linkedCustomerId);
      } else {
        const [storeRow] = await db
          .select({ defaultComptoirCustomerId: schema.storesTable.defaultComptoirCustomerId })
          .from(schema.storesTable)
          .where(eq(schema.storesTable.id, storeId))
          .limit(1);
        posCustomerId = storeRow?.defaultComptoirCustomerId ?? null;
      }
      if (!posCustomerId) {
        res.status(400).json({
          error: "Aucun client sélectionné pour la vente comptoir. Choisissez un client ou configurez un client comptoir par défaut dans les paramètres du magasin.",
        });
        return;
      }
    }

    // Server-side credit-limit enforcement for POS à-terme sales.
    // Must be checked BEFORE any stock deduction or order creation.
    // Hard-reject terme orders with no linked customer — credit-limit cannot be
    // checked without a customer profile and the debt cannot be tracked.
    if (paymentMode === "terme" && !linkedCustomerId) {
      res.status(400).json({ error: "Une vente à terme requiert un client sélectionné (linkedCustomerId manquant)." });
      return;
    }

    // Cheap pre-transaction early-out so we don't lock product rows for an
    // order that will obviously blow the credit limit. The authoritative check
    // (with the exact total and a FOR UPDATE row lock) runs inside the
    // transaction below. The down-payment (versement) is taken into account
    // here too: only the remaining receivable (= total - versement) counts
    // against the customer's credit.
    if (paymentMode === "terme" && linkedCustomerId) {
      const profResult = await db.execute(sql`
        SELECT credit_limit, current_balance FROM customer_profiles
        WHERE user_id = ${Number(linkedCustomerId)} AND store_id = ${storeId}
        LIMIT 1
      `);
      const prof = profResult.rows[0] as { credit_limit: string | null; current_balance: string | null } | undefined;
      const creditLimit = Number(prof?.credit_limit ?? 0);
      const currentBalance = Number(prof?.current_balance ?? 0);
      // Compute approximate total from items to validate before entering transaction
      const productIds = (items as { productId: number; quantity: number }[]).map(i => i.productId);
      if (productIds.length > 0) {
        const prods = await db.select({ id: schema.productsTable.id, price: schema.productsTable.price })
          .from(schema.productsTable).where(and(
            inArray(schema.productsTable.id, productIds),
            eq(schema.productsTable.storeId, storeId),
          ));
        const priceMap = new Map(prods.map(p => [p.id, parseFloat(p.price)]));
        const approxTotal = (items as { productId: number; quantity: number }[])
          .reduce((s, i) => s + (priceMap.get(i.productId) ?? 0) * i.quantity, 0);
        const approxReceivable = Math.max(0, approxTotal - versement);
        // A down-payment that covers the whole sale generates no debt, so credit
        // authorization is only required when there is a remaining receivable.
        if (approxReceivable > 0 && creditLimit === 0) {
          res.status(400).json({ error: "Ce client n'est pas autorisé à acheter à terme (plafond = 0 DA)." });
          return;
        }
        if (currentBalance + approxReceivable > creditLimit + 0.001) {
          res.status(400).json({ error: `Plafond de crédit dépassé. Nouveau solde: ${(currentBalance + approxReceivable).toFixed(2)} DA, Plafond: ${creditLimit.toFixed(2)} DA.` });
          return;
        }
      }
    }

    if (!customerName || !customerPhone || !customerAddress) {
      res.status(400).json({ error: "customerName, customerPhone, customerAddress required" });
      return;
    }

    let orderItems: { productId: number; quantity: number }[] = items || [];
    for (const item of orderItems) {
      if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) {
        res.status(400).json({ error: `Invalid quantity for product ${item.productId}: must be a positive number` });
        return;
      }
    }

    const consolidated = new Map<number, number>();
    for (const item of orderItems) {
      consolidated.set(item.productId, (consolidated.get(item.productId) ?? 0) + item.quantity);
    }
    orderItems = Array.from(consolidated.entries()).map(([productId, quantity]) => ({ productId, quantity }));

    if (req.user && orderItems.length === 0) {
      const cartItems = await db.select().from(schema.cartItemsTable)
        .where(and(
          eq(schema.cartItemsTable.userId, req.user.id),
          eq(schema.cartItemsTable.storeId, storeId),
        ));
      orderItems = cartItems.map(c => ({ productId: c.productId, quantity: c.quantity }));
    }

    if (orderItems.length === 0) {
      res.status(400).json({ error: "No items in order" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      let subtotal = 0;
      const enrichedItems: { productId: number; quantity: number; unitPrice: number; product: typeof schema.productsTable.$inferSelect }[] = [];

      for (const item of orderItems) {
        const [product] = await tx.select().from(schema.productsTable)
          .where(and(
            eq(schema.productsTable.id, item.productId),
            eq(schema.productsTable.storeId, storeId),
          ))
          .for("update")
          .limit(1);

        if (!product) throw Object.assign(new Error(`Product ${item.productId} not found in this store`), { status: 400 });
        if (product.stock < item.quantity) {
          throw Object.assign(
            new Error(`Insufficient stock for ${product.nameEn}: ${product.stock} available`),
            { status: 400 }
          );
        }
        subtotal += parseFloat(product.price) * item.quantity;
        enrichedItems.push({ ...item, unitPrice: parseFloat(product.price), product });
      }

      let discountAmount = 0;
      let appliedCoupon: typeof schema.couponsTable.$inferSelect | null = null;
      if (couponCode) {
        const [coupon] = await tx.select().from(schema.couponsTable)
          .where(and(
            eq(schema.couponsTable.code, (couponCode as string).toUpperCase()),
            eq(schema.couponsTable.storeId, storeId),
          ))
          .for("update")
          .limit(1);

        if (!coupon) throw Object.assign(new Error("Coupon not found"), { status: 400 });
        if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
          throw Object.assign(new Error("Coupon has expired"), { status: 400 });
        }
        if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
          throw Object.assign(new Error("Coupon usage limit reached"), { status: 400 });
        }
        if (coupon.minOrder && subtotal < parseFloat(coupon.minOrder)) {
          throw Object.assign(
            new Error(`Minimum order of ${coupon.minOrder} required for this coupon`),
            { status: 400 }
          );
        }

        if (coupon.type === "percent") discountAmount = (subtotal * parseFloat(coupon.value)) / 100;
        else discountAmount = Math.min(parseFloat(coupon.value), subtotal);
        appliedCoupon = coupon;
      }

      const totalAmount = Math.max(0, subtotal - discountAmount);

      // ── À-terme credit settlement (authoritative) ──
      // The down-payment (versement) is cash collected now; it is clamped to
      // the order total and the remainder becomes the customer receivable
      // (debt). New balance = current balance + receivable, and that must stay
      // within the credit limit. We lock the customer profile row (FOR UPDATE)
      // so concurrent à-terme sales cannot both slip under the same limit.
      const isTerme = paymentMode === "terme";
      const appliedVersement = isTerme ? Math.min(versement, totalAmount) : 0;
      const receivable = isTerme ? Math.max(0, totalAmount - appliedVersement) : 0;
      if (isTerme && posCustomerId && receivable > 0) {
        const profRes = await tx.execute(sql`
          SELECT credit_limit, current_balance FROM customer_profiles
          WHERE user_id = ${posCustomerId} AND store_id = ${storeId}
          FOR UPDATE
        `);
        const prof = profRes.rows[0] as { credit_limit: string | null; current_balance: string | null } | undefined;
        const creditLimit = Number(prof?.credit_limit ?? 0);
        const currentBalance = Number(prof?.current_balance ?? 0);
        if (creditLimit === 0) {
          throw Object.assign(new Error("Ce client n'est pas autorisé à acheter à terme (plafond = 0 DA)."), { status: 400 });
        }
        const newBalance = currentBalance + receivable;
        if (newBalance > creditLimit + 0.001) {
          throw Object.assign(
            new Error(`Plafond de crédit dépassé. Nouveau solde: ${newBalance.toFixed(2)} DA, Plafond: ${creditLimit.toFixed(2)} DA.`),
            { status: 400 },
          );
        }
      }

      // Track seller for POS sales: any authenticated staff member (admin
       // or employee) creating an order is recorded as the seller, so we
       // can credit their virtual caisse and audit who collected the cash.
      const sellerUserId = (req.user && (req.user.role === "admin" || req.user.role === "employee"))
        ? req.user.id : null;
      const [order] = await tx.insert(schema.ordersTable).values({
        storeId,
        userId: isPosSale ? posCustomerId : (req.user?.id ?? null),
        sellerUserId,
        customerName, customerPhone, customerAddress,
        totalAmount: totalAmount.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        couponCode: appliedCoupon?.code ?? null,
      }).returning();

      for (const item of enrichedItems) {
        await tx.insert(schema.orderItemsTable).values({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toFixed(2),
          costPrice: item.product.costPrice ?? null,
        });

        const newStock = item.product.stock - item.quantity;
        await tx.update(schema.productsTable)
          .set({ stock: newStock })
          .where(eq(schema.productsTable.id, item.productId));

        await tx.insert(schema.inventoryMovementsTable).values({
          storeId,
          productId: item.productId,
          type: "out",
          quantity: item.quantity,
          reason: "Sale",
          reference: `ORDER-${order.id}`,
        });

        if (newStock < 5) {
          enrichedItems.find(e => e.productId === item.productId)!.product = { ...item.product, stock: newStock };
        }
      }

      if (appliedCoupon) {
        await tx.update(schema.couponsTable)
          .set({ usedCount: appliedCoupon.usedCount + 1 })
          .where(eq(schema.couponsTable.id, appliedCoupon.id));
      }

      if (req.user) {
        await tx.delete(schema.cartItemsTable)
          .where(and(
            eq(schema.cartItemsTable.userId, req.user.id),
            eq(schema.cartItemsTable.storeId, storeId),
          ));
      }

      await tx.insert(schema.transactionsTable).values({
        storeId,
        type: "income",
        category: "sales",
        amount: totalAmount.toFixed(2),
        description: `Order #${order.id} - ${customerName}`,
        date: new Date().toISOString().split("T")[0],
        reference: `ORDER-${order.id}`,
      });

      // Credit the seller's virtual caisse with the cash actually collected
      // now (staff/admin POS sales only; storefront orders have no seller).
      //  - comptant: the full total is collected.
      //  - à-terme: only the down-payment (versement) is collected now; the
      //    remaining receivable is registered as a customer debt below.
      let sellerCaisseId: number | null = null;
      const cashCollected = isTerme ? appliedVersement : totalAmount;
      if (sellerUserId !== null && cashCollected > 0) {
        const sellerCaisse = await ensureCaisse(storeId, sellerUserId, tx);
        sellerCaisseId = sellerCaisse.id;
        const amountStr = cashCollected.toFixed(2);
        await tx.update(schema.caissesTable)
          .set({ balance: sql`${schema.caissesTable.balance} + ${amountStr}` })
          .where(eq(schema.caissesTable.id, sellerCaisse.id));
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: sellerCaisse.id,
          type: "credit",
          amount: amountStr,
          reason: "sale",
          orderId: order.id,
          actorUserId: sellerUserId,
          notes: isTerme
            ? `POS sale (versement) to ${customerName}`
            : `POS sale to ${customerName}`,
        });
      }

      // Terme POS: register the remaining receivable (total - versement) so the
      // customer_profiles balance stays up to date without a manual CRM entry.
      // Income is already booked above for the full sale, so this only records
      // the debt — no extra income transaction (avoids double-counting).
      if (isTerme && posCustomerId && receivable > 0) {
        const amountStr = receivable.toFixed(2);
        const today = new Date().toISOString().slice(0, 10);
        const versementNote = appliedVersement > 0 ? ` (versement ${appliedVersement.toFixed(2)} DA)` : "";
        await tx.insert(schema.customerOperationsTable).values({
          customerId: posCustomerId,
          storeId,
          type: "vente_a_terme",
          amount: amountStr,
          date: today,
          reference: `ORDER-${order.id}`,
          note: `Vente à terme POS — commande #${order.id}${versementNote}`,
          createdBy: sellerUserId ?? req.user!.id,
          caisseId: null,
        });
        await tx.execute(sql`
          INSERT INTO customer_profiles (user_id, store_id, current_balance, updated_at)
          VALUES (${posCustomerId}, ${storeId}, ${amountStr}, NOW())
          ON CONFLICT (user_id) DO UPDATE
            SET current_balance = COALESCE(customer_profiles.current_balance, 0) + ${amountStr}::numeric,
                updated_at = NOW()
        `);
      }

      return { order, enrichedItems, totalAmount, sellerUserId, sellerCaisseId };
    });

    // Broadcast to all staff (admins + employees) of this store so the
    // online-orders inbox can pop a toast for non-admin staff too.
    broadcastToStaffByStores([storeId], {
      type: "new_order",
      storeId,
      sellerUserId: result.sellerUserId,
      order: { id: result.order.id, customerName, customerPhone, customerAddress, totalAmount: result.totalAmount, createdAt: result.order.createdAt },
    });

    // Emit caisse_changed so the seller (and admins viewing the store) get
    // a live balance update after a POS sale credits their virtual caisse.
    if (result.sellerCaisseId !== null) {
      await broadcastCaisseChanged(storeId, [result.sellerCaisseId]);
    }

    for (const item of result.enrichedItems) {
      if (item.product.stock < 5) {
        broadcastToAdmins({ type: "low_stock", storeId, product: { id: item.productId, nameEn: item.product.nameEn, nameAr: item.product.nameAr, stock: item.product.stock } });
      }
    }

    res.status(201).json({
      ...result.order,
      items: result.enrichedItems.map(i => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      res.status(400).json({ error: e.message });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// GET /orders (logged-in customer's own orders — across all stores they've ordered from)
router.get("/orders", authenticate, async (req: AuthRequest, res) => {
  try {
    const orders = await db.select().from(schema.ordersTable)
      .where(eq(schema.ordersTable.userId, req.user!.id))
      .orderBy(desc(schema.ordersTable.createdAt));
    res.json(orders);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/orders/:id", authenticate, async (req: AuthRequest, res) => {
  try {
    const [order] = await db.select().from(schema.ordersTable)
      .where(eq(schema.ordersTable.id, pid(req, "id"))).limit(1);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    // Customers can see their own order regardless of store. Staff must be on
    // the same store as the order AND still hold an active user_stores link
    // (re-checked per request, so revocations take effect immediately).
    const isOwner = order.userId === req.user!.id;
    const isStaff = req.user!.role === "admin" || req.user!.role === "employee";
    if (!isOwner) {
      if (!isStaff) { res.status(403).json({ error: "Forbidden" }); return; }
      if (typeof req.currentStoreId !== "number" || order.storeId !== req.currentStoreId) {
        res.status(404).json({ error: "Order not found" }); return;
      }
      const [link] = await db.select({ id: schema.userStoresTable.userId })
        .from(schema.userStoresTable)
        .innerJoin(schema.storesTable, eq(schema.userStoresTable.storeId, schema.storesTable.id))
        .where(and(
          eq(schema.userStoresTable.userId, req.user!.id),
          eq(schema.userStoresTable.storeId, req.currentStoreId),
          eq(schema.storesTable.isActive, true),
        ))
        .limit(1);
      if (!link) {
        res.status(403).json({ error: "Store access revoked", code: "STORE_ACCESS_REVOKED" });
        return;
      }
    }

    const orderItems = await db.select({
      quantity: schema.orderItemsTable.quantity,
      unitPrice: schema.orderItemsTable.unitPrice,
      product: {
        id: schema.productsTable.id,
        nameAr: schema.productsTable.nameAr,
        nameEn: schema.productsTable.nameEn,
        imageUrl: schema.productsTable.imageUrl,
        reference: schema.productsTable.reference,
        barcode: schema.productsTable.barcode,
      },
    })
      .from(schema.orderItemsTable)
      .leftJoin(schema.productsTable, eq(schema.orderItemsTable.productId, schema.productsTable.id))
      .where(eq(schema.orderItemsTable.orderId, order.id));

    res.json({ ...order, items: orderItems });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/orders — store-scoped
router.get("/admin/orders", authenticate, requireStaff, requireStore, requirePermission("orders", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    // Optional `channel` filter — distinguishes online (web/mobile storefront)
    // orders from POS sales recorded by staff. We infer the channel from
    // `seller_user_id`: NULL = online (no cashier), NOT NULL = POS.
    const rawChannel = req.query.channel;
    const channel = typeof rawChannel === "string" ? rawChannel : "all";
    if (!["all", "online", "pos"].includes(channel)) {
      res.status(400).json({ error: "Invalid channel. Must be one of: all, online, pos" });
      return;
    }
    const channelFilter =
      channel === "online" ? isNull(schema.ordersTable.sellerUserId)
      : channel === "pos" ? isNotNull(schema.ordersTable.sellerUserId)
      : undefined;
    const noDraft = ne(schema.ordersTable.status, "draft");
    const whereClause = channelFilter
      ? and(eq(schema.ordersTable.storeId, storeId), channelFilter, noDraft)
      : and(eq(schema.ordersTable.storeId, storeId), noDraft);
    const orders = await db.select().from(schema.ordersTable)
      .where(whereClause)
      .orderBy(desc(schema.ordersTable.createdAt));
    const sellerIds = Array.from(new Set(orders.map(o => o.sellerUserId).filter((x): x is number => !!x)));
    const sellers = sellerIds.length
      ? await db.select({ id: schema.usersTable.id, name: schema.usersTable.name, email: schema.usersTable.email })
          .from(schema.usersTable).where(inArray(schema.usersTable.id, sellerIds))
      : [];
    const sellerMap = new Map(sellers.map(s => [s.id, s]));
    res.json(orders.map(o => ({ ...o, sellerUser: o.sellerUserId ? sellerMap.get(o.sellerUserId) ?? null : null })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/orders/:id/status", authenticate, requireStaff, requireStore, requirePermission("orders", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { status } = req.body;
    const VALID_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];
    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }
    const orderId = pid(req, "id");
    const [existing] = await db.select()
      .from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.id, orderId), eq(schema.ordersTable.storeId, storeId)));
    if (!existing) { res.status(404).json({ error: "Order not found" }); return; }
    if (existing.status === "delivered") {
      res.status(403).json({ error: "Cannot change status of a delivered (clôturé) order" });
      return;
    }
    if (existing.status === "cancelled") {
      res.status(400).json({ error: "Order is already cancelled" });
      return;
    }

    let delivererCaisseId: number | null = null;
    let cancelSellerCaisseId: number | null = null;

    const order = await db.transaction(async (tx) => {
      // Lock the order row to serialize concurrent status transitions and prevent
      // double-applied side effects (e.g. two simultaneous cancels double-reversing
      // stock, caisse and the customer receivable). Re-validate under the lock — the
      // outside checks above are only a fast path and are not concurrency-safe.
      const lockRes = await tx.execute(sql`
        SELECT status FROM orders
        WHERE id = ${orderId} AND store_id = ${storeId}
        FOR UPDATE
      `);
      const lockedStatus = (lockRes.rows[0] as { status: string } | undefined)?.status;
      if (lockedStatus === undefined) throw Object.assign(new Error("Order not found"), { status: 404 });
      if (lockedStatus === "delivered") throw Object.assign(new Error("Cannot change status of a delivered (clôturé) order"), { status: 403 });
      if (status === "cancelled" && lockedStatus === "cancelled") throw Object.assign(new Error("Order is already cancelled"), { status: 400 });

      const [updated] = await tx.update(schema.ordersTable)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(schema.ordersTable.id, orderId), eq(schema.ordersTable.storeId, storeId)))
        .returning();
      if (!updated) throw Object.assign(new Error("Order not found"), { status: 404 });

      // ── Delivered: credit the caisse of the user who marks the order delivered.
      // Only for web orders (sellerUserId === null): POS orders are credited at creation.
      if (status === "delivered" && updated.sellerUserId === null) {
        const orderAmount = parseFloat(updated.totalAmount);
        if (orderAmount > 0) {
          const actorUserId = req.user!.id;
          const delivererCaisse = await ensureCaisse(storeId, actorUserId, tx);
          delivererCaisseId = delivererCaisse.id;
          const amountStr = updated.totalAmount;
          await tx.update(schema.caissesTable)
            .set({ balance: sql`${schema.caissesTable.balance} + ${amountStr}` })
            .where(eq(schema.caissesTable.id, delivererCaisse.id));
          await tx.insert(schema.caisseMovementsTable).values({
            caisseId: delivererCaisse.id,
            type: "credit",
            amount: amountStr,
            reason: "sale",
            orderId,
            actorUserId,
            notes: `Livraison commande #${orderId} - ${updated.customerName}`,
          });
        }
      }

      // ── Cancelled: restore stock and reverse accounting/caisse
      if (status === "cancelled" && lockedStatus !== "draft") {
        const items = await tx.select().from(schema.orderItemsTable)
          .where(eq(schema.orderItemsTable.orderId, orderId));

        for (const item of items) {
          await tx.update(schema.productsTable)
            .set({ stock: sql`${schema.productsTable.stock} + ${item.quantity}` })
            .where(eq(schema.productsTable.id, item.productId));
          await tx.insert(schema.inventoryMovementsTable).values({
            storeId,
            productId: item.productId,
            type: "adjustment",
            quantity: item.quantity,
            reason: "Annulation commande",
            reference: `CANCEL-ORDER-${orderId}`,
          });
        }

        // Reverse the accounting income entry for this order (income is booked in
        // full at sale time, even for à-terme sales, so reverse the full amount).
        const orderAmount = parseFloat(updated.totalAmount);
        if (orderAmount > 0) {
          await tx.insert(schema.transactionsTable).values({
            storeId,
            type: "expense",
            category: "other",
            amount: updated.totalAmount,
            description: `Annulation commande #${orderId} - ${updated.customerName}`,
            date: new Date().toISOString().split("T")[0],
            reference: `CANCEL-ORDER-${orderId}`,
          });

          // Debit the seller's caisse by the cash that was ACTUALLY collected for
          // this order, not the full total. paymentMode/versement are not persisted
          // on the order, so derive the collected cash from the sale caisse movement(s):
          // comptant credited the full total, à-terme credited only the versement
          // (and à-terme with no down-payment credited nothing).
          if (updated.sellerUserId !== null) {
            const cashRes = await tx.execute(sql`
              SELECT COALESCE(SUM(amount), 0) AS s
              FROM caisse_movements
              WHERE order_id = ${orderId} AND type = 'credit' AND reason = 'sale'
            `);
            const cashCollected = Number((cashRes.rows[0] as { s: string | number } | undefined)?.s ?? 0);
            if (cashCollected > 0) {
              const sellerCaisse = await ensureCaisse(storeId, updated.sellerUserId, tx);
              cancelSellerCaisseId = sellerCaisse.id;
              const cashStr = cashCollected.toFixed(2);
              await tx.update(schema.caissesTable)
                .set({ balance: sql`${schema.caissesTable.balance} - ${cashStr}` })
                .where(eq(schema.caissesTable.id, sellerCaisse.id));
              await tx.insert(schema.caisseMovementsTable).values({
                caisseId: sellerCaisse.id,
                type: "debit",
                amount: cashStr,
                reason: "adjustment",
                orderId,
                actorUserId: req.user!.id,
                notes: `Annulation commande #${orderId}`,
              });
            }
          }

          // Reverse the à-terme receivable: the customer debt registered at sale time
          // (customer_operations.reference = ORDER-{id}, type vente_a_terme) must be
          // cancelled and the customer balance reduced accordingly. Recorded as an
          // avoir/retour credit so the ledger stays consistent with the balance.
          if (updated.userId !== null) {
            const recvRes = await tx.execute(sql`
              SELECT COALESCE(SUM(amount), 0) AS s
              FROM customer_operations
              WHERE reference = ${`ORDER-${orderId}`} AND type = 'vente_a_terme'
            `);
            const receivable = Number((recvRes.rows[0] as { s: string | number } | undefined)?.s ?? 0);
            if (receivable > 0) {
              const recvStr = receivable.toFixed(2);
              await tx.insert(schema.customerOperationsTable).values({
                customerId: updated.userId,
                storeId,
                type: "avoir_retour",
                amount: recvStr,
                date: new Date().toISOString().split("T")[0],
                reference: `CANCEL-ORDER-${orderId}`,
                note: `Annulation commande #${orderId}`,
                createdBy: req.user!.id,
                caisseId: null,
              });
              await tx.execute(sql`
                UPDATE customer_profiles
                SET current_balance = COALESCE(current_balance, 0) - ${recvStr}::numeric,
                    updated_at = NOW()
                WHERE user_id = ${updated.userId}
              `);
            }
          }
        }
      }

      return updated;
    });

    // Notify owners + store admins of any caisse balance change (delivery credit or cancel debit).
    const changedCaisseIds: number[] = [];
    if (delivererCaisseId !== null) changedCaisseIds.push(delivererCaisseId);
    if (cancelSellerCaisseId !== null) changedCaisseIds.push(cancelSellerCaisseId);
    if (changedCaisseIds.length > 0) {
      await broadcastCaisseChanged(storeId, changedCaisseIds);
    }

    res.json(order);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/low-stock", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const raw = parseInt((req.query["threshold"] as string) || "5");
    const threshold = isNaN(raw) ? 5 : Math.max(0, raw);
    const lowStock = await db.select().from(schema.productsTable)
      .where(and(lt(schema.productsTable.stock, threshold), eq(schema.productsTable.storeId, storeId)))
      .orderBy(schema.productsTable.stock);
    res.json(lowStock);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/analytics", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const [{ totalOrders }] = await db.select({ totalOrders: sql<number>`count(*)` })
      .from(schema.ordersTable).where(and(eq(schema.ordersTable.storeId, storeId), ne(schema.ordersTable.status, "draft")));
    // Only count confirmed (non-cancelled, non-draft, non-returned) orders for revenue
    const confirmedStatuses = sql`status NOT IN ('draft', 'cancelled')`;

    const [{ totalRevenue }] = await db.select({ totalRevenue: sql<number>`coalesce(sum(total_amount), 0)` })
      .from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.storeId, storeId), sql`${confirmedStatuses}`));
    // Operating expenses only. Exclude category='purchase' (inventory acquisition,
    // not an operating charge — COGS is recognised at sale via order_items.cost_price;
    // covers legacy PO-receipt expense rows regardless of reference format). Exclude
    // RETOUR-% transactions: a refund's profit impact is already captured via
    // totalRetours (returned margin, deducted from grossProfit), so counting the cash
    // refund here too would double-deduct.
    const [{ totalExpenses }] = await db.select({ totalExpenses: sql<number>`coalesce(sum(amount), 0)` })
      .from(schema.transactionsTable)
      .where(and(
        eq(schema.transactionsTable.type, "expense"),
        eq(schema.transactionsTable.storeId, storeId),
        sql`category <> 'purchase'`,
        sql`(reference IS NULL OR reference NOT LIKE 'RETOUR-%')`,
        sql`(reference IS NULL OR reference NOT LIKE 'PO-%')`,
      ));
    const [{ pendingOrders }] = await db.select({ pendingOrders: sql<number>`count(*)` })
      .from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.status, "pending"), eq(schema.ordersTable.storeId, storeId)));

    // COGS = sum of (quantity × cost_price) for all confirmed order items
    const cogsResult = await db.execute(sql`
      SELECT COALESCE(SUM(oi.quantity * oi.cost_price), 0) AS total_cogs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.store_id = ${storeId} AND o.status NOT IN ('draft', 'cancelled')
        AND oi.cost_price IS NOT NULL
    `);
    const totalCogs = Number((cogsResult.rows[0] as Record<string, unknown>)?.["total_cogs"] ?? 0);

    const dailySales = await db.execute(sql`
      SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total_amount) as revenue
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND store_id = ${storeId}
        AND status NOT IN ('draft', 'cancelled')
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `);

    // Channel split (online vs POS) for the same 30-day window as dailySales.
    // Channel is inferred from seller_user_id: NULL = online (storefront),
    // NOT NULL = POS (in-store cashier).
    const channelTotals = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN seller_user_id IS NULL THEN total_amount ELSE 0 END), 0) AS online_revenue,
        COUNT(*) FILTER (WHERE seller_user_id IS NULL) AS online_orders,
        COALESCE(SUM(CASE WHEN seller_user_id IS NOT NULL THEN total_amount ELSE 0 END), 0) AS pos_revenue,
        COUNT(*) FILTER (WHERE seller_user_id IS NOT NULL) AS pos_orders
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND store_id = ${storeId}
        AND status NOT IN ('draft', 'cancelled')
    `);
    const ct = (channelTotals.rows[0] ?? {}) as Record<string, unknown>;

    const dailyChannelSales = await db.execute(sql`
      SELECT
        DATE(created_at) AS date,
        COALESCE(SUM(CASE WHEN seller_user_id IS NULL THEN total_amount ELSE 0 END), 0) AS online_revenue,
        COALESCE(SUM(CASE WHEN seller_user_id IS NOT NULL THEN total_amount ELSE 0 END), 0) AS pos_revenue
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND store_id = ${storeId}
        AND status NOT IN ('draft', 'cancelled')
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `);

    const topProducts = await db.execute(sql`
      SELECT p.id, p.name_ar, p.name_en, SUM(oi.quantity) as sold, SUM(oi.quantity * oi.unit_price) as revenue
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.store_id = ${storeId} AND o.status NOT IN ('draft', 'cancelled')
      GROUP BY p.id, p.name_ar, p.name_en
      ORDER BY sold DESC
      LIMIT 5
    `);

    const lowStock = await db.select().from(schema.productsTable)
      .where(and(lt(schema.productsTable.stock, 5), eq(schema.productsTable.storeId, storeId)))
      .orderBy(schema.productsTable.stock);

    // Returned PROFIT (not the refunded amount) via bon retours for this store.
    // A bon retour restocks the goods, so the item cost is recovered as inventory
    // and only the lost margin hits profit: Σ qty × (unit_price − cost). Cost comes
    // from the original order_items (the exact COGS booked), falling back to the
    // product cost for orderless comptoir returns. The full cash refund is recorded
    // separately in the caisse/treasury ledger.
    const retourResult = await db.execute(sql`
      SELECT COALESCE(SUM(bri.quantity * (bri.unit_price - COALESCE(oc.cost_price, p.cost_price, 0))), 0) AS total_retours
      FROM bon_retour_items bri
      JOIN bon_retours br ON br.id = bri.bon_retour_id
      LEFT JOIN (
        SELECT order_id, product_id, MAX(cost_price) AS cost_price
        FROM order_items GROUP BY order_id, product_id
      ) oc ON oc.order_id = br.original_order_id AND oc.product_id = bri.product_id
      LEFT JOIN products p ON p.id = bri.product_id
      WHERE br.store_id = ${storeId}
    `);
    const totalRetours = Number((retourResult.rows[0] as Record<string, unknown>)?.["total_retours"] ?? 0);

    // Sales gross profit = confirmed revenue − COGS − returned profit (discounts already embedded in order total_amount)
    const grossProfit = Number(totalRevenue) - totalCogs - totalRetours;
    const grossMargin = Number(totalRevenue) > 0 ? (grossProfit / Number(totalRevenue)) * 100 : 0;
    // Net profit = gross profit − operating expenses (accounting transactions)
    const netProfit = grossProfit - Number(totalExpenses);

    // Inventory value = SUM(stock × cost_price) for all products in this store
    const inventoryResult = await db.execute(sql`
      SELECT COALESCE(SUM(stock * cost_price), 0) AS inventory_value
      FROM products
      WHERE store_id = ${storeId} AND cost_price IS NOT NULL AND stock > 0
    `);
    const inventoryValue = Number((inventoryResult.rows[0] as Record<string, unknown>)?.["inventory_value"] ?? 0);

    // Customer debt = SUM of positive current_balance from customer_profiles for this store
    const customerDebtResult = await db.execute(sql`
      SELECT COALESCE(SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END), 0) AS customer_debt
      FROM customer_profiles
      WHERE store_id = ${storeId}
    `);
    const customerDebt = Number((customerDebtResult.rows[0] as Record<string, unknown>)?.["customer_debt"] ?? 0);

    // Supplier payables = SUM of positive current_balance from suppliers for this store
    const supplierPayablesResult = await db.execute(sql`
      SELECT COALESCE(SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END), 0) AS supplier_payables
      FROM suppliers
      WHERE store_id = ${storeId}
    `);
    const supplierPayables = Number((supplierPayablesResult.rows[0] as Record<string, unknown>)?.["supplier_payables"] ?? 0);

    res.json({
      totalOrders: Number(totalOrders),
      totalRevenue: Number(totalRevenue),
      totalExpenses: Number(totalExpenses),
      totalCogs,
      totalRetours,
      grossProfit,
      grossMargin: Math.round(grossMargin * 100) / 100,
      netProfit,
      inventoryValue,
      customerDebt,
      supplierPayables,
      pendingOrders: Number(pendingOrders),
      dailySales: dailySales.rows,
      topProducts: topProducts.rows,
      lowStock,
      channelBreakdown: {
        online: { revenue: Number(ct["online_revenue"] ?? 0), orders: Number(ct["online_orders"] ?? 0) },
        pos:    { revenue: Number(ct["pos_revenue"]    ?? 0), orders: Number(ct["pos_orders"]    ?? 0) },
      },
      dailyChannelSales: dailyChannelSales.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          date: String(row["date"]),
          onlineRevenue: Number(row["online_revenue"] ?? 0),
          posRevenue:    Number(row["pos_revenue"]    ?? 0),
        };
      }),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POS Bons en attente (Draft orders) ──────────────────────────────────────
// Drafts use the same ordersTable (status='draft') + orderItemsTable.
// They intentionally skip stock deduction, inventory movements,
// accounting transactions, caisse credit and WebSocket broadcasts.

// POST /erp/pos/drafts — save current POS cart as a draft
router.post("/erp/pos/drafts", authenticate, requireStaff, requireStore, requirePermission("caisse", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const sellerUserId = req.user!.id;
    const { customerName, customerPhone, lines } = req.body as {
      customerName?: string;
      customerPhone?: string;
      lines: { productId: number; qty: number; pu: number }[];
    };
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "lines is required and must not be empty" });
      return;
    }
    const totalAmount = lines.reduce((s, l) => s + (l.qty ?? 0) * (l.pu ?? 0), 0);
    const [draft] = await db.insert(schema.ordersTable).values({
      storeId,
      sellerUserId,
      userId: null,
      customerName: customerName || "BON EN ATTENTE",
      customerPhone: customerPhone || "0000000000",
      customerAddress: "En attente",
      totalAmount: totalAmount.toFixed(2),
      discountAmount: "0.00",
      status: "draft",
    }).returning();
    for (const line of lines) {
      await db.insert(schema.orderItemsTable).values({
        orderId: draft.id,
        productId: line.productId,
        quantity: line.qty,
        unitPrice: (line.pu ?? 0).toFixed(2),
      });
    }
    res.status(201).json(draft);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /erp/pos/drafts — list all drafts for this store (with their items)
router.get("/erp/pos/drafts", authenticate, requireStaff, requireStore, requirePermission("caisse", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const drafts = await db.select().from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.storeId, storeId), eq(schema.ordersTable.status, "draft")))
      .orderBy(desc(schema.ordersTable.createdAt));
    const result = await Promise.all(drafts.map(async (draft) => {
      const items = await db.select({
        productId: schema.orderItemsTable.productId,
        quantity: schema.orderItemsTable.quantity,
        unitPrice: schema.orderItemsTable.unitPrice,
        nameEn: schema.productsTable.nameEn,
        nameAr: schema.productsTable.nameAr,
      })
        .from(schema.orderItemsTable)
        .leftJoin(schema.productsTable, eq(schema.orderItemsTable.productId, schema.productsTable.id))
        .where(eq(schema.orderItemsTable.orderId, draft.id));
      return { ...draft, items };
    }));
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /erp/pos/drafts/:id — discard a draft and its items
router.delete("/erp/pos/drafts/:id", authenticate, requireStaff, requireStore, requirePermission("caisse", "delete"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const draftId = pid(req, "id");
    const [draft] = await db.select({ id: schema.ordersTable.id, status: schema.ordersTable.status })
      .from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.id, draftId), eq(schema.ordersTable.storeId, storeId)))
      .limit(1);
    if (!draft) { res.status(404).json({ error: "Draft not found" }); return; }
    if (draft.status !== "draft") { res.status(400).json({ error: "Order is not a draft" }); return; }
    await db.delete(schema.orderItemsTable).where(eq(schema.orderItemsTable.orderId, draftId));
    await db.delete(schema.ordersTable).where(eq(schema.ordersTable.id, draftId));
    res.status(204).end();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /erp/pos/drafts/:id/confirm — convert draft → real order
// Runs the full atomic pipeline: stock check, deduction, inventory movements,
// accounting transaction, caisse credit, and WebSocket broadcasts.
// The draft order row is updated in-place (status: draft → pending),
// so the order ID is preserved.
router.post("/erp/pos/drafts/:id/confirm", authenticate, requireStaff, requireStore, requirePermission("caisse", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const draftId = pid(req, "id");
    const sellerUserId = (req.user!.role === "admin" || req.user!.role === "employee")
      ? req.user!.id : null;

    const [draft] = await db.select().from(schema.ordersTable)
      .where(and(
        eq(schema.ordersTable.id, draftId),
        eq(schema.ordersTable.storeId, storeId),
        eq(schema.ordersTable.status, "draft"),
      )).limit(1);
    if (!draft) { res.status(404).json({ error: "Draft not found" }); return; }

    const draftItems = await db.select({
      productId: schema.orderItemsTable.productId,
      quantity: schema.orderItemsTable.quantity,
      unitPrice: schema.orderItemsTable.unitPrice,
    }).from(schema.orderItemsTable).where(eq(schema.orderItemsTable.orderId, draftId));
    if (!draftItems.length) { res.status(400).json({ error: "Draft has no items" }); return; }

    const customerName = (req.body as { customerName?: string }).customerName || draft.customerName;
    const customerPhone = (req.body as { customerPhone?: string }).customerPhone || draft.customerPhone;
    const customerAddress = (req.body as { customerAddress?: string }).customerAddress || "Vente comptoir";

    const result = await db.transaction(async (tx) => {
      let totalAmount = 0;
      const enrichedItems: {
        productId: number; quantity: number; unitPrice: number;
        product: typeof schema.productsTable.$inferSelect;
      }[] = [];

      for (const item of draftItems) {
        const [product] = await tx.select().from(schema.productsTable)
          .where(and(eq(schema.productsTable.id, item.productId), eq(schema.productsTable.storeId, storeId)))
          .for("update").limit(1);
        if (!product) throw Object.assign(new Error(`Produit ${item.productId} introuvable`), { status: 400 });
        if (product.stock < item.quantity) {
          throw Object.assign(
            new Error(`Stock insuffisant pour ${product.nameEn}: ${product.stock} disponible`),
            { status: 400 },
          );
        }
        const unitPrice = parseFloat(item.unitPrice);
        totalAmount += unitPrice * item.quantity;
        enrichedItems.push({ productId: item.productId, quantity: item.quantity, unitPrice, product });
      }

      // Promote draft → pending (same order ID, recalculated total)
      const [order] = await tx.update(schema.ordersTable).set({
        status: "pending",
        customerName,
        customerPhone,
        customerAddress,
        sellerUserId,
        totalAmount: totalAmount.toFixed(2),
        updatedAt: new Date(),
      }).where(eq(schema.ordersTable.id, draftId)).returning();

      // Stock deduction + inventory movements
      for (const item of enrichedItems) {
        const newStock = item.product.stock - item.quantity;
        await tx.update(schema.productsTable)
          .set({ stock: newStock })
          .where(eq(schema.productsTable.id, item.productId));
        await tx.update(schema.orderItemsTable)
          .set({ costPrice: item.product.costPrice ?? null })
          .where(and(
            eq(schema.orderItemsTable.orderId, order.id),
            eq(schema.orderItemsTable.productId, item.productId),
          ));
        await tx.insert(schema.inventoryMovementsTable).values({
          storeId,
          productId: item.productId,
          type: "out",
          quantity: item.quantity,
          reason: "Sale",
          reference: `ORDER-${order.id}`,
        });
        if (newStock < 5) item.product = { ...item.product, stock: newStock };
      }

      // Accounting
      await tx.insert(schema.transactionsTable).values({
        storeId,
        type: "income",
        category: "sales",
        amount: totalAmount.toFixed(2),
        description: `Order #${order.id} - ${customerName}`,
        date: new Date().toISOString().split("T")[0],
        reference: `ORDER-${order.id}`,
      });

      // Caisse credit
      let sellerCaisseId: number | null = null;
      if (sellerUserId !== null && totalAmount > 0) {
        const sellerCaisse = await ensureCaisse(storeId, sellerUserId, tx);
        sellerCaisseId = sellerCaisse.id;
        await tx.update(schema.caissesTable)
          .set({ balance: sql`${schema.caissesTable.balance} + ${totalAmount.toFixed(2)}` })
          .where(eq(schema.caissesTable.id, sellerCaisse.id));
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: sellerCaisse.id,
          type: "credit",
          amount: totalAmount.toFixed(2),
          reason: "sale",
          orderId: order.id,
          actorUserId: sellerUserId,
          notes: `POS sale to ${customerName}`,
        });
      }

      return { order, enrichedItems, totalAmount, sellerCaisseId };
    });

    // Broadcasts — identical to handleCreateOrder
    broadcastToStaffByStores([storeId], {
      type: "new_order",
      storeId,
      sellerUserId,
      order: {
        id: result.order.id, customerName, customerPhone, customerAddress,
        totalAmount: result.totalAmount, createdAt: result.order.createdAt,
      },
    });
    if (result.sellerCaisseId !== null) {
      await broadcastCaisseChanged(storeId, [result.sellerCaisseId]);
    }
    for (const item of result.enrichedItems) {
      if (item.product.stock < 5) {
        broadcastToAdmins({
          type: "low_stock", storeId,
          product: { id: item.productId, nameEn: item.product.nameEn, nameAr: item.product.nameAr, stock: item.product.stock },
        });
      }
    }

    res.json({
      ...result.order,
      items: result.enrichedItems.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) { res.status(400).json({ error: e.message }); return; }
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Bon Retour ──────────────────────────────────────────────────────────────

router.post("/admin/orders/:id/retours", authenticate, requireStaff, requireStore, requirePermission("orders", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const orderId = pid(req, "id");
    const createdByUserId = req.user!.id;
    const { reason, retourType, items } = req.body as {
      reason?: string;
      retourType?: string;
      items: { productId: number; quantity: number }[];
    };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items is required and must not be empty" });
      return;
    }

    // Consolidate duplicate productIds in the same request
    const consolidatedItems = Object.values(
      items.reduce((acc: Record<number, { productId: number; quantity: number }>, item) => {
        const id = Number(item.productId);
        if (!acc[id]) acc[id] = { productId: id, quantity: 0 };
        acc[id].quantity += Number(item.quantity);
        return acc;
      }, {})
    );

    const [order] = await db.select().from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.id, orderId), eq(schema.ordersTable.storeId, storeId)));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (order.status === "draft" || order.status === "cancelled") {
      res.status(400).json({ error: "Cannot create Bon Retour for draft or cancelled orders" });
      return;
    }
    // A "sans remboursement" retour credits the customer's account (avoir).
    // Without a linked customer there is nobody to credit, so reject instead
    // of silently creating a retour with no financial side-effect.
    if (retourType === "sans_remboursement" && !order.userId) {
      res.status(400).json({ error: "Un retour sans remboursement nécessite une commande liée à un client (avoir client)." });
      return;
    }

    const originalItems = await db.select().from(schema.orderItemsTable)
      .where(eq(schema.orderItemsTable.orderId, orderId));

    const existingRetours = await db.select({ id: schema.bonRetoursTable.id })
      .from(schema.bonRetoursTable)
      .where(eq(schema.bonRetoursTable.originalOrderId, orderId));
    const existingRetourIds = existingRetours.map(r => r.id);

    const alreadyReturned: Record<number, number> = {};
    if (existingRetourIds.length > 0) {
      const returnedItems = await db.select({
        productId: schema.bonRetourItemsTable.productId,
        quantity: schema.bonRetourItemsTable.quantity,
      }).from(schema.bonRetourItemsTable)
        .where(inArray(schema.bonRetourItemsTable.bonRetourId, existingRetourIds));
      for (const ri of returnedItems) {
        alreadyReturned[ri.productId] = (alreadyReturned[ri.productId] ?? 0) + ri.quantity;
      }
    }

    const originalQtyMap: Record<number, { qty: number; unitPrice: string }> = {};
    for (const oi of originalItems) {
      originalQtyMap[oi.productId] = { qty: oi.quantity, unitPrice: oi.unitPrice };
    }

    for (const item of consolidatedItems) {
      if (item.quantity <= 0) {
        res.status(400).json({ error: `Quantity must be positive for product ${item.productId}` });
        return;
      }
      const original = originalQtyMap[item.productId];
      if (!original) {
        res.status(400).json({ error: `Product ${item.productId} is not in the original order` });
        return;
      }
      const maxReturnable = original.qty - (alreadyReturned[item.productId] ?? 0);
      if (item.quantity > maxReturnable) {
        res.status(400).json({ error: `Cannot return ${item.quantity} of product ${item.productId}. Max returnable: ${maxReturnable}` });
        return;
      }
    }

    let retourCaisseId: number | null = null;
    const result = await db.transaction(async (tx) => {
      const [bonRetour] = await tx.insert(schema.bonRetoursTable).values({
        storeId,
        originalOrderId: orderId,
        reason: reason ?? null,
        retourType: retourType ?? null,
        createdByUserId,
      }).returning();

      const retourItems = [];
      let retourTotal = 0;
      for (const item of consolidatedItems) {
        const unitPrice = originalQtyMap[item.productId].unitPrice;
        const [retourItem] = await tx.insert(schema.bonRetourItemsTable).values({
          bonRetourId: bonRetour.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice,
        }).returning();
        retourItems.push(retourItem);
        retourTotal += item.quantity * parseFloat(unitPrice);

        await tx.update(schema.productsTable)
          .set({ stock: sql`${schema.productsTable.stock} + ${item.quantity}` })
          .where(eq(schema.productsTable.id, item.productId));

        await tx.insert(schema.inventoryMovementsTable).values({
          storeId,
          productId: item.productId,
          type: "in",
          quantity: item.quantity,
          reason: "Retour",
          reference: `RETOUR-${bonRetour.id}`,
        });
      }

      // Financial side-effect depends on the retour type:
      //  - "sans_remboursement": no cash leaves the till. Instead the linked
      //    customer is credited with an "avoir_retour" that reduces what they
      //    owe (current_balance). No caisse debit, no expense transaction.
      //  - otherwise (refund): cash leaves the till → expense + caisse debit.
      if (retourTotal > 0) {
        if (retourType === "sans_remboursement") {
          if (order.userId) {
            await tx.insert(schema.customerOperationsTable).values({
              customerId: order.userId,
              storeId,
              type: "avoir_retour",
              amount: retourTotal.toFixed(2),
              date: new Date().toISOString().split("T")[0],
              reference: `RETOUR-${bonRetour.id}`,
              note: `Avoir retour — Bon Retour #${bonRetour.id} - commande #${orderId}`,
              createdBy: createdByUserId,
              caisseId: null,
            });
            await tx.execute(sql`
              INSERT INTO customer_profiles (user_id, store_id, current_balance, updated_at)
              VALUES (${order.userId}, ${storeId}, ${(-retourTotal).toFixed(2)}, NOW())
              ON CONFLICT (user_id) DO UPDATE
                SET current_balance = COALESCE(customer_profiles.current_balance, 0) - ${retourTotal.toFixed(2)}::numeric,
                    updated_at = NOW()
            `);
          }
        } else {
          await tx.insert(schema.transactionsTable).values({
            storeId,
            type: "expense",
            category: "other",
            amount: retourTotal.toFixed(2),
            description: `Bon Retour #${bonRetour.id} - commande #${orderId}`,
            date: new Date().toISOString().split("T")[0],
            reference: `RETOUR-${bonRetour.id}`,
          });

          // Debit the acting user's caisse — the refund cash leaves the actor's
          // till regardless of how the original order was sold (POS, COD, or web).
          const actorCaisse = await ensureCaisse(storeId, createdByUserId, tx);
          retourCaisseId = actorCaisse.id;
          await tx.update(schema.caissesTable)
            .set({ balance: sql`${schema.caissesTable.balance} - ${retourTotal.toFixed(2)}` })
            .where(eq(schema.caissesTable.id, actorCaisse.id));
          await tx.insert(schema.caisseMovementsTable).values({
            caisseId: actorCaisse.id,
            type: "debit",
            amount: retourTotal.toFixed(2),
            reason: "adjustment",
            actorUserId: createdByUserId,
            notes: `Bon Retour #${bonRetour.id} - commande #${orderId}`,
          });
        }
      }

      return { bonRetour, items: retourItems, retourTotal };
    });

    if (retourCaisseId !== null) {
      await broadcastCaisseChanged(storeId, [retourCaisseId]);
    }
    res.status(201).json({
      ...result.bonRetour,
      totalAmount: result.retourTotal,
      items: result.items,
      originalOrder: order,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/retours", authenticate, requireStaff, requireStore, requirePermission("orders", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const createdByUserId = req.user!.id;
    const { clientName, clientUserId, reason, retourType, items } = req.body as {
      clientName?: string;
      clientUserId?: number;
      reason?: string;
      retourType?: string;
      items: { productId: number; quantity: number }[];
    };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items is required and must not be empty" });
      return;
    }

    let resolvedClientName = clientName ?? null;
    if (clientUserId && !resolvedClientName) {
      const [cu] = await db.select({ name: schema.usersTable.name })
        .from(schema.usersTable).where(eq(schema.usersTable.id, clientUserId)).limit(1);
      if (cu) resolvedClientName = cu.name;
    }
    if (!resolvedClientName && !clientUserId) {
      resolvedClientName = "DIVERS COMPTOIR";
    }

    // A "sans remboursement" retour credits the customer's account (avoir).
    // Without a linked customer there is nobody to credit, so reject instead
    // of silently creating a retour with no financial side-effect.
    if (retourType === "sans_remboursement" && !clientUserId) {
      res.status(400).json({ error: "Un retour sans remboursement nécessite un client sélectionné (avoir client)." });
      return;
    }

    let retourCaisseId: number | null = null;
    const result = await db.transaction(async (tx) => {
      const [bonRetour] = await tx.insert(schema.bonRetoursTable).values({
        storeId,
        originalOrderId: null,
        clientName: resolvedClientName,
        clientUserId: clientUserId ?? null,
        reason: reason ?? null,
        retourType: retourType ?? null,
        createdByUserId,
      }).returning();

      const retourItems = [];
      let retourTotal = 0;
      for (const item of items) {
        if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) {
          throw Object.assign(new Error(`Quantity must be a positive number for product ${item.productId}`), { status: 400 });
        }
        const [product] = await tx.select().from(schema.productsTable)
          .where(and(eq(schema.productsTable.id, item.productId), eq(schema.productsTable.storeId, storeId)))
          .limit(1);
        if (!product) throw Object.assign(new Error(`Product ${item.productId} not found in this store`), { status: 400 });

        const [retourItem] = await tx.insert(schema.bonRetourItemsTable).values({
          bonRetourId: bonRetour.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: product.price,
        }).returning();
        retourItems.push(retourItem);
        retourTotal += item.quantity * parseFloat(product.price);

        await tx.update(schema.productsTable)
          .set({ stock: sql`${schema.productsTable.stock} + ${item.quantity}` })
          .where(eq(schema.productsTable.id, item.productId));

        await tx.insert(schema.inventoryMovementsTable).values({
          storeId,
          productId: item.productId,
          type: "in",
          quantity: item.quantity,
          reason: "Retour",
          reference: `RETOUR-${bonRetour.id}`,
        });
      }

      // Financial side-effect depends on the retour type:
      //  - "sans_remboursement": no cash leaves the till. Instead the linked
      //    customer is credited with an "avoir_retour" that reduces what they
      //    owe (current_balance). No caisse debit, no expense transaction.
      //  - otherwise (refund): cash leaves the till → expense + caisse debit.
      if (retourTotal > 0) {
        if (retourType === "sans_remboursement") {
          if (clientUserId) {
            await tx.insert(schema.customerOperationsTable).values({
              customerId: clientUserId,
              storeId,
              type: "avoir_retour",
              amount: retourTotal.toFixed(2),
              date: new Date().toISOString().split("T")[0],
              reference: `RETOUR-${bonRetour.id}`,
              note: `Avoir retour — Bon Retour comptoir #${bonRetour.id}`,
              createdBy: createdByUserId,
              caisseId: null,
            });
            await tx.execute(sql`
              INSERT INTO customer_profiles (user_id, store_id, current_balance, updated_at)
              VALUES (${clientUserId}, ${storeId}, ${(-retourTotal).toFixed(2)}, NOW())
              ON CONFLICT (user_id) DO UPDATE
                SET current_balance = COALESCE(customer_profiles.current_balance, 0) - ${retourTotal.toFixed(2)}::numeric,
                    updated_at = NOW()
            `);
          }
        } else {
          await tx.insert(schema.transactionsTable).values({
            storeId,
            type: "expense",
            category: "other",
            amount: retourTotal.toFixed(2),
            description: `Bon Retour comptoir #${bonRetour.id} - ${resolvedClientName ?? "client"}`,
            date: new Date().toISOString().split("T")[0],
            reference: `RETOUR-${bonRetour.id}`,
          });

          // Debit the acting user's caisse
          const actorCaisse = await ensureCaisse(storeId, createdByUserId, tx);
          retourCaisseId = actorCaisse.id;
          await tx.update(schema.caissesTable)
            .set({ balance: sql`${schema.caissesTable.balance} - ${retourTotal.toFixed(2)}` })
            .where(eq(schema.caissesTable.id, actorCaisse.id));
          await tx.insert(schema.caisseMovementsTable).values({
            caisseId: actorCaisse.id,
            type: "debit",
            amount: retourTotal.toFixed(2),
            reason: "adjustment",
            actorUserId: createdByUserId,
            notes: `Bon Retour comptoir #${bonRetour.id}`,
          });
        }
      }

      return { bonRetour, items: retourItems, retourTotal };
    });

    if (retourCaisseId !== null) {
      await broadcastCaisseChanged(storeId, [retourCaisseId]);
    }
    res.status(201).json({ ...result.bonRetour, totalAmount: result.retourTotal, items: result.items });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) { res.status(400).json({ error: e.message }); return; }
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/retours", authenticate, requireStaff, requireStore, requirePermission("orders", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const retours = await db.select().from(schema.bonRetoursTable)
      .where(eq(schema.bonRetoursTable.storeId, storeId))
      .orderBy(desc(schema.bonRetoursTable.createdAt));

    const enriched = await Promise.all(retours.map(async (r) => {
      const items = await db.select().from(schema.bonRetourItemsTable)
        .where(eq(schema.bonRetourItemsTable.bonRetourId, r.id));
      const totalAmount = items.reduce((s, i) => s + i.quantity * parseFloat(i.unitPrice), 0);
      const [originalOrder] = await db.select({
        id: schema.ordersTable.id,
        customerName: schema.ordersTable.customerName,
        customerPhone: schema.ordersTable.customerPhone,
        customerAddress: schema.ordersTable.customerAddress,
        status: schema.ordersTable.status,
        totalAmount: schema.ordersTable.totalAmount,
        discountAmount: schema.ordersTable.discountAmount,
        couponCode: schema.ordersTable.couponCode,
        createdAt: schema.ordersTable.createdAt,
        updatedAt: schema.ordersTable.updatedAt,
      }).from(schema.ordersTable).where(r.originalOrderId != null ? eq(schema.ordersTable.id, r.originalOrderId) : sql`false`);
      return { ...r, totalAmount, items, originalOrder: originalOrder ?? null };
    }));

    res.json(enriched);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/retours/:id", authenticate, requireStaff, requireStore, requirePermission("orders", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const retourId = pid(req, "id");

    const [retour] = await db.select().from(schema.bonRetoursTable)
      .where(and(eq(schema.bonRetoursTable.id, retourId), eq(schema.bonRetoursTable.storeId, storeId)));
    if (!retour) { res.status(404).json({ error: "Bon Retour not found" }); return; }

    const items = await db.select({
      id: schema.bonRetourItemsTable.id,
      productId: schema.bonRetourItemsTable.productId,
      quantity: schema.bonRetourItemsTable.quantity,
      unitPrice: schema.bonRetourItemsTable.unitPrice,
      product: {
        id: schema.productsTable.id,
        nameAr: schema.productsTable.nameAr,
        nameEn: schema.productsTable.nameEn,
        reference: schema.productsTable.reference,
        barcode: schema.productsTable.barcode,
      },
    }).from(schema.bonRetourItemsTable)
      .leftJoin(schema.productsTable, eq(schema.bonRetourItemsTable.productId, schema.productsTable.id))
      .where(eq(schema.bonRetourItemsTable.bonRetourId, retourId));

    const [originalOrder] = await db.select().from(schema.ordersTable)
      .where(retour.originalOrderId != null ? eq(schema.ordersTable.id, retour.originalOrderId) : sql`false`);

    const totalAmount = items.reduce((s, i) => s + i.quantity * parseFloat(i.unitPrice), 0);

    res.json({ ...retour, totalAmount, items, originalOrder: originalOrder ?? null });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Reports ─────────────────────────────────────────────────────────────────

// GET /admin/reports/products — per-product profit report
router.get("/admin/reports/products", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { from, to } = req.query as { from?: string; to?: string };

    // Aggregate sales data in a subquery with proper store+status+date filters,
    // then LEFT JOIN to products so products without sales still appear.
    const dateFilter = from && to
      ? sql`AND o.created_at BETWEEN ${from}::timestamp AND (${to}::timestamp + INTERVAL '1 day')`
      : sql``;

    const rows = await db.execute(sql`
      SELECT
        p.id,
        p.name_en,
        p.name_ar,
        p.reference,
        p.cost_price,
        p.stock,
        COALESCE(agg.total_sold, 0)    AS total_sold,
        COALESCE(agg.total_revenue, 0) AS total_revenue,
        COALESCE(agg.total_cogs, 0)    AS total_cogs,
        COALESCE(agg.total_revenue - agg.total_cogs, 0) AS gross_profit
      FROM products p
      LEFT JOIN (
        SELECT
          oi.product_id,
          SUM(oi.quantity)                                                              AS total_sold,
          SUM(oi.quantity * oi.unit_price)                                              AS total_revenue,
          SUM(CASE WHEN oi.cost_price IS NOT NULL THEN oi.quantity * oi.cost_price ELSE 0 END) AS total_cogs
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
          AND o.store_id = ${storeId}
          AND o.status NOT IN ('draft', 'cancelled')
          ${dateFilter}
        GROUP BY oi.product_id
      ) agg ON agg.product_id = p.id
      WHERE p.store_id = ${storeId}
      ORDER BY COALESCE(agg.total_revenue - agg.total_cogs, 0) DESC
    `);

    const result = rows.rows.map((r) => {
      const row = r as Record<string, unknown>;
      const revenue = Number(row["total_revenue"] ?? 0);
      const cogs = Number(row["total_cogs"] ?? 0);
      const profit = Number(row["gross_profit"] ?? 0);
      return {
        id: Number(row["id"]),
        nameEn: String(row["name_en"] ?? ""),
        nameAr: String(row["name_ar"] ?? ""),
        reference: row["reference"] ? String(row["reference"]) : null,
        costPrice: row["cost_price"] != null ? Number(row["cost_price"]) : null,
        stock: Number(row["stock"] ?? 0),
        totalSold: Number(row["total_sold"] ?? 0),
        totalRevenue: revenue,
        totalCogs: cogs,
        grossProfit: profit,
        grossMargin: revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/reports/customers — per-customer revenue + balance report
router.get("/admin/reports/customers", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { from, to } = req.query as { from?: string; to?: string };

    const dateFilter = from && to
      ? sql`AND created_at BETWEEN ${from}::timestamp AND (${to}::timestamp + INTERVAL '1 day')`
      : sql``;

    // Aggregate order revenue and COGS in separate subqueries to avoid
    // row multiplication (SUM(total_amount) × items count).
    const rows = await db.execute(sql`
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        cp.current_balance,
        cp.wilaya,
        COALESCE(ord.total_orders, 0)  AS total_orders,
        COALESCE(ord.total_revenue, 0) AS total_revenue,
        COALESCE(cogs.total_cogs, 0)   AS total_cogs,
        COALESCE(ord.total_revenue - cogs.total_cogs, 0) AS gross_profit
      FROM users u
      JOIN customer_profiles cp ON cp.user_id = u.id AND cp.store_id = ${storeId}
      LEFT JOIN (
        SELECT user_id,
               COUNT(*)            AS total_orders,
               SUM(total_amount)   AS total_revenue
        FROM orders
        WHERE store_id = ${storeId}
          AND status NOT IN ('draft', 'cancelled')
          AND user_id IS NOT NULL
          ${dateFilter}
        GROUP BY user_id
      ) ord ON ord.user_id = u.id
      LEFT JOIN (
        SELECT o.user_id,
               SUM(oi.quantity * oi.cost_price) AS total_cogs
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
          AND o.store_id = ${storeId}
          AND o.status NOT IN ('draft', 'cancelled')
          AND o.user_id IS NOT NULL
          ${dateFilter}
        WHERE oi.cost_price IS NOT NULL
        GROUP BY o.user_id
      ) cogs ON cogs.user_id = u.id
      ORDER BY COALESCE(ord.total_revenue, 0) DESC
    `);

    const result = rows.rows.map((r) => {
      const row = r as Record<string, unknown>;
      const revenue = Number(row["total_revenue"] ?? 0);
      const cogs = Number(row["total_cogs"] ?? 0);
      const profit = Number(row["gross_profit"] ?? 0);
      return {
        id: Number(row["id"]),
        name: String(row["name"] ?? ""),
        email: row["email"] ? String(row["email"]) : null,
        phone: row["phone"] ? String(row["phone"]) : null,
        wilaya: row["wilaya"] ? String(row["wilaya"]) : null,
        currentBalance: Number(row["current_balance"] ?? 0),
        totalOrders: Number(row["total_orders"] ?? 0),
        totalRevenue: revenue,
        totalCogs: cogs,
        grossProfit: profit,
        grossMargin: revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/reports/suppliers — per-supplier purchases + payables report
router.get("/admin/reports/suppliers", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { from, to } = req.query as { from?: string; to?: string };

    // Separate date filters — PO subquery uses no alias; item subquery uses po alias
    const poDateFilter = from && to
      ? sql`AND created_at BETWEEN ${from}::timestamp AND (${to}::timestamp + INTERVAL '1 day')`
      : sql``;
    const piDateFilter = from && to
      ? sql`AND po.created_at BETWEEN ${from}::timestamp AND (${to}::timestamp + INTERVAL '1 day')`
      : sql``;

    // Separate subqueries for PO-level totals vs item-level metrics to prevent row multiplication
    const rows = await db.execute(sql`
      SELECT
        s.id,
        s.name,
        s.contact_name,
        s.email,
        s.phone,
        s.current_balance,
        COALESCE(po_agg.total_pos, 0)         AS total_pos,
        COALESCE(po_agg.total_purchased, 0)   AS total_purchased,
        COALESCE(po_agg.total_received, 0)    AS total_received,
        COALESCE(pi_agg.distinct_products, 0) AS distinct_products,
        COALESCE(pi_agg.avg_unit_cost, 0)     AS avg_unit_cost
      FROM suppliers s
      LEFT JOIN (
        SELECT
          supplier_id,
          COUNT(*)                                                          AS total_pos,
          SUM(total_amount)                                                 AS total_purchased,
          SUM(CASE WHEN status = 'received' THEN total_amount ELSE 0 END)  AS total_received
        FROM purchase_orders
        WHERE store_id = ${storeId}
          ${poDateFilter}
        GROUP BY supplier_id
      ) po_agg ON po_agg.supplier_id = s.id
      LEFT JOIN (
        SELECT
          po.supplier_id,
          COUNT(DISTINCT pi.product_id)                                         AS distinct_products,
          CASE WHEN SUM(pi.quantity) > 0
               THEN ROUND(SUM(pi.quantity * pi.unit_cost)::numeric / SUM(pi.quantity), 2)
               ELSE 0 END                                                        AS avg_unit_cost
        FROM purchase_items pi
        JOIN purchase_orders po ON po.id = pi.purchase_order_id
          AND po.store_id = ${storeId}
          ${piDateFilter}
        GROUP BY po.supplier_id
      ) pi_agg ON pi_agg.supplier_id = s.id
      WHERE s.store_id = ${storeId}
      ORDER BY COALESCE(po_agg.total_purchased, 0) DESC
    `);

    const result = rows.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: Number(row["id"]),
        name: String(row["name"] ?? ""),
        contactName: row["contact_name"] ? String(row["contact_name"]) : null,
        email: row["email"] ? String(row["email"]) : null,
        phone: row["phone"] ? String(row["phone"]) : null,
        currentBalance: Number(row["current_balance"] ?? 0),
        totalPos: Number(row["total_pos"] ?? 0),
        totalPurchased: Number(row["total_purchased"] ?? 0),
        totalReceived: Number(row["total_received"] ?? 0),
        distinctProducts: Number(row["distinct_products"] ?? 0),
        avgUnitCost: Number(row["avg_unit_cost"] ?? 0),
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/reports/monthly — month-by-month revenue vs expenses vs profit
router.get("/admin/reports/monthly", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { from, to } = req.query as { from?: string; to?: string };

    // Note: 'returned' is not a valid order_status enum value in this schema,
    // so excluding only 'draft' and 'cancelled' correctly captures all confirmed orders.
    const orderDateFilter = from && to
      ? sql`AND created_at BETWEEN ${from}::timestamp AND (${to}::timestamp + INTERVAL '1 day')`
      : sql``;

    const txDateFilter = from && to
      ? sql`AND created_at BETWEEN ${from}::timestamp AND (${to}::timestamp + INTERVAL '1 day')`
      : sql``;

    const retourDateFilter = from && to
      ? sql`AND br.created_at BETWEEN ${from}::timestamp AND (${to}::timestamp + INTERVAL '1 day')`
      : sql``;

    // Revenue grouped by month — orders only (no item JOIN to avoid row multiplication)
    const revenueRows = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        SUM(total_amount) AS total_revenue
      FROM orders
      WHERE store_id = ${storeId}
        AND status NOT IN ('draft', 'cancelled')
        ${orderDateFilter}
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `);

    // COGS grouped by month — separate query via order_items to avoid multiplying order totals
    const cogsRows = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', o.created_at), 'YYYY-MM') AS month,
        SUM(CASE WHEN oi.cost_price IS NOT NULL THEN oi.quantity * oi.cost_price ELSE 0 END) AS total_cogs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
        AND o.store_id = ${storeId}
        AND o.status NOT IN ('draft', 'cancelled')
        ${orderDateFilter}
      GROUP BY DATE_TRUNC('month', o.created_at)
      ORDER BY DATE_TRUNC('month', o.created_at)
    `);

    const cogsMap = new Map<string, number>();
    for (const r of cogsRows.rows) {
      const row = r as Record<string, unknown>;
      cogsMap.set(String(row["month"]), Number(row["total_cogs"] ?? 0));
    }

    // Operating expenses (type = 'expense') grouped by month. Exclude
    // category='purchase' (inventory acquisition, not an operating expense — profit
    // recognised at sale via COGS; covers legacy PO-receipt rows regardless of
    // reference). Exclude RETOUR-% transactions (profit impact captured via retours
    // query — double-deduct if counted here) and PO-% transactions as a secondary guard.
    const expenseRows = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        SUM(amount) AS total_expenses
      FROM transactions
      WHERE store_id = ${storeId}
        AND type = 'expense'
        AND category <> 'purchase'
        AND (reference IS NULL OR reference NOT LIKE 'RETOUR-%')
        AND (reference IS NULL OR reference NOT LIKE 'PO-%')
        ${txDateFilter}
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `);

    // Returns grouped by month — returned PROFIT, Σ qty × (unit_price − cost).
    // A bon retour restocks the goods (cost recovered as inventory), so only the
    // lost margin is deducted from grossProfit (mirrors Analytics / Dashboard).
    // Cost is sourced from the original order_items, falling back to the product
    // cost for orderless comptoir returns.
    const retourRows = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', br.created_at), 'YYYY-MM') AS month,
        SUM(bri.quantity * (bri.unit_price - COALESCE(oc.cost_price, p.cost_price, 0))) AS total_retours
      FROM bon_retour_items bri
      JOIN bon_retours br ON br.id = bri.bon_retour_id
        AND br.store_id = ${storeId}
        ${retourDateFilter}
      LEFT JOIN (
        SELECT order_id, product_id, MAX(cost_price) AS cost_price
        FROM order_items GROUP BY order_id, product_id
      ) oc ON oc.order_id = br.original_order_id AND oc.product_id = bri.product_id
      LEFT JOIN products p ON p.id = bri.product_id
      GROUP BY DATE_TRUNC('month', br.created_at)
      ORDER BY DATE_TRUNC('month', br.created_at)
    `);

    const retourMap = new Map<string, number>();
    for (const r of retourRows.rows) {
      const row = r as Record<string, unknown>;
      retourMap.set(String(row["month"]), Number(row["total_retours"] ?? 0));
    }

    // Merge by month key
    const expenseMap = new Map<string, number>();
    for (const r of expenseRows.rows) {
      const row = r as Record<string, unknown>;
      expenseMap.set(String(row["month"]), Number(row["total_expenses"] ?? 0));
    }

    // Build revenue map
    const revenueMap = new Map<string, number>();
    for (const r of revenueRows.rows) {
      const row = r as Record<string, unknown>;
      revenueMap.set(String(row["month"]), Number(row["total_revenue"] ?? 0));
    }

    // Union all month keys so expense-only, cogs-only or retour-only months are not dropped
    const allMonths = Array.from(
      new Set([...revenueMap.keys(), ...cogsMap.keys(), ...expenseMap.keys(), ...retourMap.keys()])
    ).sort();

    const result = allMonths.map((month) => {
      const revenue = revenueMap.get(month) ?? 0;
      const cogs = cogsMap.get(month) ?? 0;
      const retours = retourMap.get(month) ?? 0;
      const expenses = expenseMap.get(month) ?? 0;
      // Gross profit = revenue − COGS − returns (same formula as Analytics).
      const grossProfit = revenue - cogs - retours;
      const netProfit = grossProfit - expenses;
      return {
        month,
        totalRevenue: revenue,
        totalCogs: cogs,
        totalRetours: retours,
        totalExpenses: expenses,
        grossProfit,
        netProfit,
        grossMargin: revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { Router } from "express";
import { eq, desc, asc, sql, and, gt, ne, or, inArray, isNull, notLike } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, schema } from "../lib/db";
import { authenticate, requireAdmin, requireStaff, requireStore, isAdmin, requirePermission, type AuthRequest } from "../lib/auth";
import { broadcastToAdmins, broadcastCaisseChanged } from "../lib/ws";
import { ensureCaisse } from "./caisses";

const router = Router();

const pid = (req: { params: Record<string, string | string[]> }, key: string): number =>
  parseInt(req.params[key] as string);

// ─── Dashboard — Général ───────────────────────────────────────────
// Single endpoint for all KPIs shown in the "Général" dashboard tab.
// Add new fields here as the tab grows (receivables, caisse balance, etc.)
// ─── Dashboard helper: resolve effective storeId (null = all stores) ─
function dashboardStoreId(req: AuthRequest): number | null {
  const rawSid = req.query["storeId"] as string | undefined;
  if (req.user?.role === "admin") {
    if (rawSid && rawSid !== "all") {
      const n = parseInt(rawSid, 10);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }
  return req.currentStoreId ?? null;
}

router.get("/erp/dashboard/general", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const storeCondition = sid !== null
      ? and(eq(schema.productsTable.storeId, sid), gt(schema.productsTable.stock, 0))
      : gt(schema.productsTable.stock, 0);
    const [{ stockValue }] = await db
      .select({
        stockValue: sql<number>`COALESCE(SUM(${schema.productsTable.stock} * CAST(${schema.productsTable.costPrice} AS numeric)), 0)`,
      })
      .from(schema.productsTable)
      .where(storeCondition);
    res.json({ stockValue: Number(stockValue) });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Employees ─────────────────────────────────────────────────────
// ─── Dashboard — Stock Detail (drill-down) ────────────────────────
router.get("/erp/dashboard/stock-detail", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const storeCondition = sid !== null
      ? and(eq(schema.productsTable.storeId, sid), gt(schema.productsTable.stock, 0))
      : gt(schema.productsTable.stock, 0);
    const rows = await db
      .select({
        id: schema.productsTable.id,
        nameEn: schema.productsTable.nameEn,
        nameAr: schema.productsTable.nameAr,
        reference: schema.productsTable.reference,
        stock: schema.productsTable.stock,
        costPrice: schema.productsTable.costPrice,
        valeur: sql<string>`COALESCE(ROUND(CAST(${schema.productsTable.stock} AS numeric) * CAST(${schema.productsTable.costPrice} AS numeric), 2), 0)`,
      })
      .from(schema.productsTable)
      .where(storeCondition)
      .orderBy(desc(sql`COALESCE(${schema.productsTable.stock} * CAST(${schema.productsTable.costPrice} AS numeric), 0)`));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Dashboard — Créances clients (drill-down) ────────────────────
router.get("/erp/dashboard/client-receivables", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const storeFilter = sid !== null ? sql` AND cp.store_id = ${sid}` : sql``;
    const result = await db.execute(sql`
      SELECT u.id, u.name,
             ROUND(CAST(cp.current_balance AS numeric), 2) AS balance
      FROM customer_profiles cp
      JOIN users u ON cp.user_id = u.id
      WHERE CAST(cp.current_balance AS numeric) > 0
      ${storeFilter}
      ORDER BY CAST(cp.current_balance AS numeric) DESC
    `);
    res.json(result.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Dashboard — Dettes fournisseurs (drill-down) ─────────────────
router.get("/erp/dashboard/supplier-debts", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const storeFilter = sid !== null ? sql` AND store_id = ${sid}` : sql``;
    const result = await db.execute(sql`
      SELECT id, name,
             ROUND(CAST(current_balance AS numeric), 2) AS balance
      FROM suppliers
      WHERE CAST(current_balance AS numeric) < 0
      ${storeFilter}
      ORDER BY CAST(current_balance AS numeric) ASC
    `);
    res.json(result.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/dashboard/caisses", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    // Global caisse model: the dashboard widget shows the org-wide set
    // (the single main caisse + every user's personal caisse).
    const result = await db.execute(sql`
      SELECT c.id, c.kind, ROUND(CAST(c.balance AS numeric), 2) AS balance,
             u.name AS owner_name
      FROM caisses c
      LEFT JOIN users u ON c.owner_user_id = u.id
      ORDER BY c.kind ASC, u.name ASC
    `);
    const caisses = result.rows as { id: number; kind: string; balance: string; owner_name: string | null }[];
    const total = caisses.reduce((s, c) => s + Number(c.balance ?? 0), 0);
    res.json({ total: total.toFixed(2), caisses });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/dashboard/ventes", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const { groupBy = "jour", dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    const fromDate = dateFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const toDate = dateTo ?? new Date().toISOString().slice(0, 10);
    const periodFmt = groupBy === "annee" ? "YYYY" : groupBy === "mois" ? "YYYY-MM" : "YYYY-MM-DD";
    const ordersStoreFilter = sid !== null ? sql` AND o.store_id = ${sid}` : sql``;
    const retoursStoreFilter = sid !== null ? sql` AND br.store_id = ${sid}` : sql``;
    const chargesStoreFilter = sid !== null ? sql` AND t.store_id = ${sid}` : sql``;
    // Date window mirrors Rapport mensuel exactly: BETWEEN from::timestamp AND (to::timestamp + 1 day).
    const ordersDateFilter = sql` AND o.created_at BETWEEN ${fromDate}::timestamp AND (${toDate}::timestamp + INTERVAL '1 day')`;
    const retoursDateFilter = sql` AND br.created_at BETWEEN ${fromDate}::timestamp AND (${toDate}::timestamp + INTERVAL '1 day')`;
    const chargesDateFilter = sql` AND t.created_at BETWEEN ${fromDate}::timestamp AND (${toDate}::timestamp + INTERVAL '1 day')`;

    // Dashboard profit mirrors the official P&L (Analytics / Rapport mensuel):
    //   marge          = revenue(Σ orders.total_amount) − COGS(Σ order_items.cost_price×qty)
    //   benefice (net) = marge − returned profit − operating expenses
    // CRITICAL: order-level revenue/discount are aggregated from `orders` ALONE
    // (order_rev CTE). COGS is item-level and lives in its OWN CTE (order_cogs).
    // If revenue summed over an orders⋈order_items join, a multi-line order would
    // multiply total_amount by its item count (this is what the customer/product
    // reports in orders.ts also guard against). Returns and expenses likewise sit
    // in independent CTEs so the joins never inflate them.
    // RETURNS DEDUCT LOST PROFIT, not the refunded amount: a bon retour restocks
    // the goods (stock += qty), so the item cost is recovered as inventory and only
    // the margin is lost. retours = Σ qty × (unit_price − cost), cost sourced from
    // the original order_items (the exact COGS booked) and falling back to the
    // product cost for orderless comptoir returns. Subtracting the full refund here
    // would also wipe the recovered cost and overstate losses — a fully-returned +
    // restocked sale must net to 0, not −COGS. The full cash refund is recorded
    // separately in the caisse/treasury ledger. Cash-refund RETOUR-% expense
    // transactions stay excluded from charges because each refund's profit impact
    // is already captured by this returns CTE — counting both double-deducts. All
    // CTEs bucket by the order/record created_at; the UNION of period keys keeps
    // periods that have only returns/expenses (no sales) visible with a negative net.
    const rows = await db.execute(sql`
      WITH order_rev AS (
        SELECT TO_CHAR(o.created_at, ${periodFmt}) AS period,
               SUM(CAST(o.total_amount AS numeric)) AS montant,
               SUM(CAST(o.discount_amount AS numeric)) AS reduction
        FROM orders o
        WHERE o.status NOT IN ('cancelled', 'draft')
          ${ordersDateFilter}
          ${ordersStoreFilter}
        GROUP BY 1
      ),
      order_cogs AS (
        SELECT TO_CHAR(o.created_at, ${periodFmt}) AS period,
               SUM(COALESCE(CAST(oi.cost_price AS numeric), 0) * CAST(oi.quantity AS numeric)) AS cogs
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'draft')
          ${ordersDateFilter}
          ${ordersStoreFilter}
        GROUP BY 1
      ),
      retours AS (
        SELECT TO_CHAR(br.created_at, ${periodFmt}) AS period,
               SUM(CAST(bri.quantity AS numeric) * (CAST(bri.unit_price AS numeric) - COALESCE(oc.cost_price, CAST(p.cost_price AS numeric), 0))) AS retours
        FROM bon_retour_items bri
        JOIN bon_retours br ON br.id = bri.bon_retour_id
        LEFT JOIN (
          SELECT order_id, product_id, MAX(CAST(cost_price AS numeric)) AS cost_price
          FROM order_items GROUP BY order_id, product_id
        ) oc ON oc.order_id = br.original_order_id AND oc.product_id = bri.product_id
        LEFT JOIN products p ON p.id = bri.product_id
        WHERE TRUE
          ${retoursDateFilter}
          ${retoursStoreFilter}
        GROUP BY 1
      ),
      charges AS (
        SELECT TO_CHAR(t.created_at, ${periodFmt}) AS period,
               SUM(CAST(t.amount AS numeric)) AS charges
        FROM transactions t
        WHERE t.type = 'expense'
          AND (t.reference IS NULL OR t.reference NOT LIKE 'RETOUR-%')
          ${chargesDateFilter}
          ${chargesStoreFilter}
        GROUP BY 1
      ),
      periods AS (
        SELECT period FROM order_rev
        UNION SELECT period FROM order_cogs
        UNION SELECT period FROM retours
        UNION SELECT period FROM charges
      )
      SELECT
        p.period AS date,
        ROUND(COALESCE(orev.montant, 0), 2) AS montant,
        ROUND(COALESCE(orev.reduction, 0), 2) AS reduction,
        ROUND(COALESCE(orev.montant, 0) - COALESCE(ocogs.cogs, 0), 2) AS marge,
        ROUND(COALESCE(r.retours, 0), 2) AS retours,
        ROUND(COALESCE(c.charges, 0), 2) AS charges,
        ROUND(COALESCE(orev.montant, 0) - COALESCE(ocogs.cogs, 0) - COALESCE(r.retours, 0) - COALESCE(c.charges, 0), 2) AS benefice
      FROM periods p
      LEFT JOIN order_rev orev ON orev.period = p.period
      LEFT JOIN order_cogs ocogs ON ocogs.period = p.period
      LEFT JOIN retours r ON r.period = p.period
      LEFT JOIN charges c ON c.period = p.period
      ORDER BY p.period DESC
    `);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/dashboard/ventes-produits", authenticate, requireStaff, requireStore, requirePermission("dashboard", "view"), async (req: AuthRequest, res) => {
  try {
    const sid = dashboardStoreId(req);
    const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    const fromDate = dateFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const toDate = dateTo ?? new Date().toISOString().slice(0, 10);
    const fromTs = `${fromDate}T00:00:00`;
    const toTs = `${toDate}T23:59:59`;
    const storeFilter = sid !== null ? sql` AND o.store_id = ${sid}` : sql``;
    const rows = await db.execute(sql`
      SELECT
        p.id,
        COALESCE(p.name_en, p.name_ar) AS designation,
        COALESCE(pb.name_fr, p.brand, '') AS marque,
        COALESCE(pf.name_fr, '') AS famille,
        p.reference,
        p.barcode,
        p.stock,
        CAST(p.price AS text) AS price,
        CAST(p.cost_price AS text) AS cost_price_product,
        SUM(CAST(oi.quantity AS numeric)) AS qte_vendue,
        ROUND(SUM(CAST(oi.unit_price AS numeric) * CAST(oi.quantity AS numeric)) / NULLIF(SUM(CAST(oi.quantity AS numeric)), 0), 2) AS pu,
        ROUND(SUM(CAST(oi.unit_price AS numeric) * CAST(oi.quantity AS numeric)), 2) AS montant,
        ROUND(
          SUM(CAST(oi.unit_price AS numeric) * CAST(oi.quantity AS numeric))
          - SUM(COALESCE(CAST(oi.cost_price AS numeric), 0) * CAST(oi.quantity AS numeric)),
        2) AS benefice
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_families pf ON pf.id = p.family_id
      LEFT JOIN product_brands pb ON pb.id = p.brand_id
      WHERE o.status NOT IN ('cancelled', 'draft')
        AND o.created_at >= ${fromTs}
        AND o.created_at <= ${toTs}
        ${storeFilter}
      GROUP BY p.id, p.name_en, p.name_ar, pb.name_fr, p.brand, pf.name_fr,
               p.reference, p.barcode, p.stock, p.price, p.cost_price
      ORDER BY SUM(CAST(oi.unit_price AS numeric) * oi.quantity) DESC
    `);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Permissions ────────────────────────────────────────────────────────────

// GET /erp/permissions/me — current user's own permissions (for employees)
router.get("/erp/permissions/me", authenticate, requireStore, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const rows = await db.select().from(schema.userPermissionsTable)
      .where(eq(schema.userPermissionsTable.userId, userId));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/permissions/users — admin: list all non-customer users for permissions management
router.get("/erp/permissions/users", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const users = await db
      .select({
        userId: schema.usersTable.id,
        name: schema.usersTable.name,
        email: schema.usersTable.email,
        role: schema.usersTable.role,
        position: schema.employeesTable.position,
        status: schema.employeesTable.status,
      })
      .from(schema.usersTable)
      .leftJoin(schema.employeesTable, eq(schema.employeesTable.userId, schema.usersTable.id))
      .where(ne(schema.usersTable.role, "customer"))
      .orderBy(schema.usersTable.id);
    console.log(`[permissions/users] Retrieved ${users.length} non-customer users`);
    res.json(users);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// GET /erp/permissions/:userId — admin: read any employee's permissions
router.get("/erp/permissions/:userId", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const userId = pid(req, "userId");
    if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }
    const rows = await db.select().from(schema.userPermissionsTable)
      .where(eq(schema.userPermissionsTable.userId, userId));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /erp/permissions/:userId — admin: bulk-upsert permissions for an employee
router.put("/erp/permissions/:userId", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const userId = pid(req, "userId");
    if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }
    const perms = req.body as { section: string; action: string; granted: boolean }[];
    if (!Array.isArray(perms) || perms.length === 0) { res.status(400).json({ error: "perms array required" }); return; }
    const VALID_SECTIONS = new Set(["dashboard", "orders", "products", "inventory", "customers", "purchases", "settings", "caisse", "suppliers", "employees", "realtime", "attendance", "leaves", "accounting"]);
    const VALID_ACTIONS = new Set(["view", "create", "edit", "delete"]);
    for (const p of perms) {
      if (!VALID_SECTIONS.has(p.section) || !VALID_ACTIONS.has(p.action)) {
        res.status(400).json({ error: `Invalid section/action: ${p.section}/${p.action}` });
        return;
      }
    }
    for (const p of perms) {
      await db.execute(sql`
        INSERT INTO user_permissions (user_id, section, action, granted)
        VALUES (${userId}, ${p.section}, ${p.action}, ${p.granted})
        ON CONFLICT (user_id, section, action)
        DO UPDATE SET granted = ${p.granted}
      `);
    }
    const rows = await db.select().from(schema.userPermissionsTable)
      .where(eq(schema.userPermissionsTable.userId, userId));
    res.json(rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Employees — unified source ─────────────────────────────────────────────
// Every employee has a user account (users.id = employees.user_id).
// The list is built from the employees table joined to users + caisses so that
// all screens (Employees page, Dashboard EmployésTab, Leaves/Attendance
// dropdowns) share the exact same source and the same row count.
router.get("/erp/employees", authenticate, requireStaff, requireStore, requirePermission("employees", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const result = await db.execute(sql`
      SELECT
        e.id,
        e.store_id        AS "storeId",
        e.user_id         AS "userId",
        e.name,
        e.email,
        e.phone,
        e.position,
        e.salary,
        e.status,
        e.hire_date       AS "hireDate",
        e.created_at      AS "createdAt",
        u.role,
        u.is_active       AS "isActive",
        COALESCE(ROUND(c.balance, 2)::text, '0.00') AS solde
      FROM employees e
      LEFT JOIN users u
        ON u.id = e.user_id
      LEFT JOIN caisses c
        ON c.owner_user_id = e.user_id
        AND c.kind         = 'staff'
      WHERE e.store_id = ${storeId}
      ORDER BY e.name
    `);
    res.json(result.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST — create employee + user account + caisse
router.post("/erp/employees", authenticate, requireStaff, requireStore, requirePermission("employees", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { name, email, phone, position, salary, hireDate, password } = req.body;
    if (!name || !position || !salary || !hireDate) {
      res.status(400).json({ error: "name, position, salary, hireDate are required" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // 1. Create user account
      let userId: number | null = null;
      if (email) {
        const existing = await tx.select({ id: schema.usersTable.id })
          .from(schema.usersTable).where(eq(schema.usersTable.email, email)).limit(1);
        if (existing.length > 0) {
          // Reuse existing user — just update role if needed
          userId = existing[0].id;
          await tx.update(schema.usersTable)
            .set({ role: "employee", isActive: true, name, phone: phone || null })
            .where(eq(schema.usersTable.id, userId));
        } else {
          const pwHash = await bcrypt.hash(password || "midanic2026", 10);
          const [u] = await tx.insert(schema.usersTable).values({
            name, email, passwordHash: pwHash,
            role: "employee", preferredLang: "ar",
            phone: phone || null, isActive: true,
          }).returning({ id: schema.usersTable.id });
          userId = u.id;
        }
        // Link user to store
        await tx.execute(sql`
          INSERT INTO user_stores (user_id, store_id)
          VALUES (${userId}, ${storeId})
          ON CONFLICT DO NOTHING
        `);
      }

      // 2. Create employee record
      const [emp] = await tx.insert(schema.employeesTable).values({
        storeId, userId: userId ?? undefined,
        name, email: email || null, phone: phone || null,
        position, salary, hireDate,
      }).returning();

      // 3. Ensure caisse exists for this user
      if (userId) await ensureCaisse(storeId, userId, tx);

      return emp;
    });

    // Return enriched row
    const [enriched] = await db.execute(sql`
      SELECT e.*, u.role, u.is_active AS "isActive",
             COALESCE(ROUND(c.balance,2)::text,'0.00') AS solde
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN caisses c ON c.owner_user_id=e.user_id AND c.kind='staff'
      WHERE e.id = ${result.id}
    `).then(r => r.rows);
    res.status(201).json(enriched);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT — update employee + sync user account
router.put("/erp/employees/:id", authenticate, requireStaff, requireStore, requirePermission("employees", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const empId = pid(req, "id");
    const { name, email, phone, position, salary, hireDate, status } = req.body;

    const [existing] = await db.select().from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.id, empId), eq(schema.employeesTable.storeId, storeId)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db.transaction(async (tx) => {
      // Update employee record
      const empUpdate: Partial<typeof schema.employeesTable.$inferInsert> = {};
      if (name     !== undefined) empUpdate.name     = name;
      if (email    !== undefined) empUpdate.email    = email;
      if (phone    !== undefined) empUpdate.phone    = phone;
      if (position !== undefined) empUpdate.position = position;
      if (salary   !== undefined) empUpdate.salary   = salary;
      if (hireDate !== undefined) empUpdate.hireDate = hireDate;
      if (status   !== undefined) empUpdate.status   = status;
      await tx.update(schema.employeesTable).set(empUpdate)
        .where(eq(schema.employeesTable.id, empId));

      // Sync user account if linked
      if (existing.userId) {
        const userUpdate: Record<string, unknown> = {};
        if (name  !== undefined) userUpdate.name  = name;
        if (email !== undefined) userUpdate.email = email;
        if (phone !== undefined) userUpdate.phone = phone;
        // If employee becomes inactive → block login
        if (status === "inactive" || status === "terminated") {
          userUpdate.isActive = false;
        } else if (status === "active" || status === "on_leave") {
          userUpdate.isActive = true;
        }
        if (Object.keys(userUpdate).length > 0) {
          await tx.update(schema.usersTable)
            .set(userUpdate as { name?: string; email?: string; phone?: string; isActive?: boolean })
            .where(eq(schema.usersTable.id, existing.userId));
        }
      }
    });

    const [enriched] = await db.execute(sql`
      SELECT e.*, u.role, u.is_active AS "isActive",
             COALESCE(ROUND(c.balance,2)::text,'0.00') AS solde
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN caisses c ON c.owner_user_id=e.user_id AND c.kind='staff'
      WHERE e.id = ${empId}
    `).then(r => r.rows);
    res.json(enriched);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// DELETE — set inactive + block login
router.delete("/erp/employees/:id", authenticate, requireStaff, requireStore, requirePermission("employees", "delete"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const empId = pid(req, "id");
    const [emp] = await db.select().from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.id, empId), eq(schema.employeesTable.storeId, storeId)))
      .limit(1);
    if (!emp) { res.status(404).json({ error: "Not found" }); return; }
    await db.transaction(async (tx) => {
      await tx.update(schema.employeesTable).set({ status: "inactive" })
        .where(eq(schema.employeesTable.id, empId));
      if (emp.userId) {
        await tx.update(schema.usersTable).set({ isActive: false })
          .where(eq(schema.usersTable.id, emp.userId));
      }
    });
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Attendance
router.get("/erp/attendance", authenticate, requireStaff, requireStore, requirePermission("attendance", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { employeeId } = req.query as Record<string, string>;
    const conditions = [eq(schema.attendanceTable.storeId, storeId)];
    if (employeeId) conditions.push(eq(schema.attendanceTable.employeeId, parseInt(employeeId)));
    const records = await db.select().from(schema.attendanceTable)
      .where(and(...conditions))
      .orderBy(desc(schema.attendanceTable.date));
    res.json(records);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/attendance", authenticate, requireStaff, requireStore, requirePermission("attendance", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const employeeId = Number(req.body?.employeeId);
    if (!Number.isInteger(employeeId)) {
      res.status(400).json({ error: "employeeId required" });
      return;
    }
    const [emp] = await db.select({ id: schema.employeesTable.id })
      .from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.id, employeeId), eq(schema.employeesTable.storeId, storeId)))
      .limit(1);
    if (!emp) { res.status(403).json({ error: "Employee does not belong to current store" }); return; }
    const body = { ...req.body, storeId };
    const [record] = await db.insert(schema.attendanceTable).values(body).returning();
    res.status(201).json(record);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Leaves
router.get("/erp/leaves", authenticate, requireStaff, requireStore, requirePermission("leaves", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const leaves = await db.select().from(schema.leavesTable)
      .where(eq(schema.leavesTable.storeId, storeId))
      .orderBy(desc(schema.leavesTable.createdAt));
    res.json(leaves);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/leaves", authenticate, requireStaff, requireStore, requirePermission("leaves", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const employeeId = Number(req.body?.employeeId);
    if (!Number.isInteger(employeeId)) {
      res.status(400).json({ error: "employeeId required" });
      return;
    }
    const [emp] = await db.select({ id: schema.employeesTable.id })
      .from(schema.employeesTable)
      .where(and(eq(schema.employeesTable.id, employeeId), eq(schema.employeesTable.storeId, storeId)))
      .limit(1);
    if (!emp) { res.status(403).json({ error: "Employee does not belong to current store" }); return; }
    const body = { ...req.body, storeId };
    const [leave] = await db.insert(schema.leavesTable).values(body).returning();
    res.status(201).json(leave);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/leaves/:id/status", authenticate, requireStaff, requireStore, requirePermission("leaves", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const [leave] = await db.update(schema.leavesTable).set({ status: req.body.status })
      .where(and(eq(schema.leavesTable.id, pid(req, "id")), eq(schema.leavesTable.storeId, storeId)))
      .returning();
    if (!leave) { res.status(404).json({ error: "Not found" }); return; }
    const [employee] = await db.select({ name: schema.employeesTable.name })
      .from(schema.employeesTable).where(eq(schema.employeesTable.id, leave.employeeId)).limit(1);
    broadcastToAdmins({
      type: "leave_status_changed",
      storeId,
      status: leave.status,
      employeeName: employee?.name ?? `Employee #${leave.employeeId}`,
      leaveType: leave.type,
      startDate: leave.startDate,
      endDate: leave.endDate,
    });
    res.json(leave);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Suppliers ─────────────────────────────────────────────────────
router.get("/erp/suppliers", authenticate, requireStaff, requireStore, requirePermission("suppliers", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const suppliers = await db.select().from(schema.suppliersTable)
      .where(eq(schema.suppliersTable.storeId, storeId))
      .orderBy(schema.suppliersTable.name);
    res.json(suppliers);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/suppliers", authenticate, requireStaff, requireStore, requirePermission("suppliers", "create"), async (req: AuthRequest, res) => {
  try {
    const body = { ...req.body, storeId: req.currentStoreId! };
    const [supplier] = await db.insert(schema.suppliersTable).values(body).returning();
    res.status(201).json(supplier);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/suppliers/:id", authenticate, requireStaff, requireStore, requirePermission("suppliers", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const body = { ...req.body }; delete body.storeId;
    const [supplier] = await db.update(schema.suppliersTable).set(body)
      .where(and(eq(schema.suppliersTable.id, pid(req, "id")), eq(schema.suppliersTable.storeId, storeId)))
      .returning();
    if (!supplier) { res.status(404).json({ error: "Not found" }); return; }
    res.json(supplier);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Supplier Operations (GET statement + POST payment)
router.get("/erp/suppliers/:id/operations", authenticate, requireStaff, requireStore, requirePermission("suppliers", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const supplierId = pid(req, "id");
    const [supplier] = await db.select().from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

    const ops = await db.select().from(schema.supplierOperationsTable)
      .where(and(eq(schema.supplierOperationsTable.supplierId, supplierId), eq(schema.supplierOperationsTable.storeId, storeId)))
      .orderBy(asc(schema.supplierOperationsTable.date), asc(schema.supplierOperationsTable.createdAt));

    let running = 0;
    const opsWithBalance = ops.map((op) => {
      const amt = parseFloat(op.amount ?? "0");
      if (op.type === "purchase") running += amt;
      else running -= amt;
      return { ...op, runningBalance: running.toFixed(2) };
    });

    res.json({ supplier, operations: opsWithBalance });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/suppliers/:id/operations", authenticate, requireStaff, requireStore, requirePermission("suppliers", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const actorUserId = req.user!.id;
    const supplierId = pid(req, "id");
    const { amount, date, reference, note, poId } = req.body;

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) { res.status(400).json({ error: "amount must be a positive number" }); return; }
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "date is required (YYYY-MM-DD)" }); return; }

    const [supplier] = await db.select().from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

    // Validate poId if provided — must belong to this supplier + store
    let resolvedPoId: number | null = null;
    if (poId) {
      const parsedPoId = Number(poId);
      if (!Number.isInteger(parsedPoId)) { res.status(400).json({ error: "poId must be an integer" }); return; }
      const [po] = await db.select({ id: schema.purchaseOrdersTable.id })
        .from(schema.purchaseOrdersTable)
        .where(and(
          eq(schema.purchaseOrdersTable.id, parsedPoId),
          eq(schema.purchaseOrdersTable.supplierId, supplierId),
          eq(schema.purchaseOrdersTable.storeId, storeId),
        )).limit(1);
      if (!po) { res.status(400).json({ error: "Purchase order not found or does not belong to this supplier" }); return; }
      resolvedPoId = parsedPoId;
    }

    const amtFixed = parsedAmount.toFixed(2);

    const { op, caisseId } = await db.transaction(async (tx) => {
      // Global model: the payment auto-debits the acting user's personal caisse.
      const payingCaisse = await ensureCaisse(null, actorUserId, tx);

      // Payment increases balance (reduces debt): Solde = Versements - Achats
      await tx.update(schema.suppliersTable)
        .set({ currentBalance: sql`current_balance + ${amtFixed}` })
        .where(eq(schema.suppliersTable.id, supplierId));

      // Record supplier operation — optionally linked to a specific PO
      const [operation] = await tx.insert(schema.supplierOperationsTable).values({
        supplierId,
        storeId,
        type: "payment",
        amount: amtFixed,
        date,
        reference: reference ?? undefined,
        note: note ?? undefined,
        caisseId: payingCaisse.id,
        ...(resolvedPoId !== null ? { poId: resolvedPoId } : {}),
      }).returning();

      // Debit the actor's caisse
      await tx.update(schema.caissesTable)
        .set({ balance: sql`balance - ${amtFixed}` })
        .where(eq(schema.caissesTable.id, payingCaisse.id));

      await tx.insert(schema.caisseMovementsTable).values({
        caisseId: payingCaisse.id,
        type: "debit",
        amount: amtFixed,
        reason: "supplier_payment",
        supplierOperationId: operation.id,
        actorUserId,
        notes: `Règlement fournisseur: ${supplier.name}${note ? ` — ${note}` : ""}`,
      });

      return { op: operation, caisseId: payingCaisse.id };
    });

    await broadcastCaisseChanged(storeId, [caisseId]);
    res.status(201).json(op);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Supplier Balance Adjustment
router.post("/erp/suppliers/:id/adjust", authenticate, requireStaff, requireStore, requirePermission("suppliers", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const supplierId = pid(req, "id");
    const { targetBalance, date, note } = req.body;

    const parsedTarget = parseFloat(targetBalance);
    if (!Number.isFinite(parsedTarget)) { res.status(400).json({ error: "targetBalance must be a finite number" }); return; }
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "date is required (YYYY-MM-DD)" }); return; }

    const [supplier] = await db.select().from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

    const oldBalance = parseFloat(supplier.currentBalance ?? "0");
    const newBalanceFixed = parsedTarget.toFixed(2);
    const delta = (parsedTarget - oldBalance).toFixed(2);
    const autoNote = `Ancien: ${oldBalance.toFixed(2)} DA → Nouveau: ${newBalanceFixed} DA${note ? ` — ${note}` : ""}`;

    const op = await db.transaction(async (tx) => {
      await tx.update(schema.suppliersTable)
        .set({ currentBalance: newBalanceFixed })
        .where(eq(schema.suppliersTable.id, supplierId));

      const [operation] = await tx.insert(schema.supplierOperationsTable).values({
        supplierId,
        storeId,
        type: "ajustement",
        amount: delta,
        date,
        note: autoNote,
        actorUserId: req.user!.id,
      }).returning();

      return operation;
    });

    res.status(201).json(op);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// Purchase Orders
router.get("/erp/purchase-orders", authenticate, requireStaff, requireStore, requirePermission("purchases", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const pos = await db.select().from(schema.purchaseOrdersTable)
      .where(eq(schema.purchaseOrdersTable.storeId, storeId))
      .orderBy(desc(schema.purchaseOrdersTable.createdAt));
    res.json(pos);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/purchase-orders", authenticate, requireStaff, requireStore, requirePermission("purchases", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { supplierId, items, notes, paymentMethod: pmRaw } = req.body;
    const paymentMethod = pmRaw === "comptant" ? "comptant" : "a_terme";
    // Verify supplier belongs to this store
    const [sup] = await db.select({ id: schema.suppliersTable.id }).from(schema.suppliersTable)
      .where(and(eq(schema.suppliersTable.id, supplierId), eq(schema.suppliersTable.storeId, storeId))).limit(1);
    if (!sup) { res.status(400).json({ error: "Supplier not found in this store" }); return; }
    // Verify every productId belongs to this store before inserting items
    for (const item of (items || [])) {
      const [prod] = await db.select({ id: schema.productsTable.id }).from(schema.productsTable)
        .where(and(eq(schema.productsTable.id, item.productId), eq(schema.productsTable.storeId, storeId))).limit(1);
      if (!prod) { res.status(400).json({ error: `Product ${item.productId} not found in this store` }); return; }
    }
    let total = 0;
    for (const item of (items || [])) { total += item.quantity * item.unitCost; }
    const [po] = await db.insert(schema.purchaseOrdersTable).values({
      storeId, supplierId, notes, paymentMethod, totalAmount: total.toFixed(2),
    }).returning();
    for (const item of (items || [])) {
      await db.insert(schema.purchaseItemsTable).values({ purchaseOrderId: po.id, ...item });
    }
    res.status(201).json(po);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/purchase-orders/:id/items", authenticate, requireStaff, requireStore, requirePermission("purchases", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const poId = pid(req, "id");
    // Make sure the PO belongs to this store
    const [po] = await db.select({ id: schema.purchaseOrdersTable.id }).from(schema.purchaseOrdersTable)
      .where(and(eq(schema.purchaseOrdersTable.id, poId), eq(schema.purchaseOrdersTable.storeId, storeId))).limit(1);
    if (!po) { res.status(404).json({ error: "Not found" }); return; }
    const items = await db.select({
      id: schema.purchaseItemsTable.id,
      purchaseOrderId: schema.purchaseItemsTable.purchaseOrderId,
      productId: schema.purchaseItemsTable.productId,
      quantity: schema.purchaseItemsTable.quantity,
      unitCost: schema.purchaseItemsTable.unitCost,
      productNameEn: schema.productsTable.nameEn,
      productNameAr: schema.productsTable.nameAr,
    })
      .from(schema.purchaseItemsTable)
      // Only join product names when the product belongs to current store
      .leftJoin(schema.productsTable,
        and(
          eq(schema.productsTable.id, schema.purchaseItemsTable.productId),
          eq(schema.productsTable.storeId, storeId),
        ))
      .where(eq(schema.purchaseItemsTable.purchaseOrderId, poId));
    res.json(items);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/purchase-orders/:id/receive", authenticate, requireStaff, requireStore, requirePermission("purchases", "edit"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const actorUserId = req.user!.id;
    const poId = pid(req, "id");
    let comptantCaisseId: number | null = null;

    const result = await db.transaction(async (tx) => {
      // Guard: only transition pending → received (idempotency guard)
      const [po] = await tx.update(schema.purchaseOrdersTable)
        .set({ status: "received", receivedAt: new Date() })
        .where(and(
          eq(schema.purchaseOrdersTable.id, poId),
          eq(schema.purchaseOrdersTable.storeId, storeId),
          eq(schema.purchaseOrdersTable.status, "pending"),
        ))
        .returning();

      if (!po) return null;

      const items = await tx.select().from(schema.purchaseItemsTable)
        .where(eq(schema.purchaseItemsTable.purchaseOrderId, poId));

      for (const item of items) {
        const [product] = await tx.select().from(schema.productsTable)
          .where(and(eq(schema.productsTable.id, item.productId), eq(schema.productsTable.storeId, storeId))).limit(1);
        if (product) {
          // Update stock
          await tx.update(schema.productsTable).set({ stock: product.stock + item.quantity }).where(eq(schema.productsTable.id, item.productId));
          await tx.insert(schema.inventoryMovementsTable).values({
            storeId,
            productId: item.productId, type: "in", quantity: item.quantity,
            reason: "Purchase Order", reference: `PO-${poId}`,
          });

          // Recalculate CUMP (Coût Unitaire Moyen Pondéré) across ALL received POs for this product.
          // The current PO is already marked 'received' above, so it is included in this query.
          const [cumpRow] = await tx
            .select({
              cump: sql<string>`ROUND(
                SUM(${schema.purchaseItemsTable.quantity} * CAST(${schema.purchaseItemsTable.unitCost} AS numeric))
                / NULLIF(SUM(${schema.purchaseItemsTable.quantity}), 0),
              2)`,
            })
            .from(schema.purchaseItemsTable)
            .innerJoin(
              schema.purchaseOrdersTable,
              eq(schema.purchaseItemsTable.purchaseOrderId, schema.purchaseOrdersTable.id),
            )
            .where(and(
              eq(schema.purchaseItemsTable.productId, item.productId),
              eq(schema.purchaseOrdersTable.storeId, storeId),
              eq(schema.purchaseOrdersTable.status, "received"),
            ));
          if (cumpRow?.cump != null) {
            await tx.update(schema.productsTable)
              .set({ costPrice: String(cumpRow.cump) })
              .where(eq(schema.productsTable.id, item.productId));
          }
        }
      }

      const totalAmount = parseFloat(po.totalAmount ?? "0");
      const today = new Date().toISOString().slice(0, 10);

      // À terme only: purchase creates a supplier debt (Comptant = paid immediately, no debt)
      if (po.paymentMethod !== "comptant") {
        await tx.update(schema.suppliersTable)
          .set({ currentBalance: sql`current_balance - ${totalAmount.toFixed(2)}` })
          .where(eq(schema.suppliersTable.id, po.supplierId));

        await tx.insert(schema.supplierOperationsTable).values({
          supplierId: po.supplierId,
          storeId,
          type: "purchase",
          amount: totalAmount.toFixed(2),
          date: today,
          reference: `PO-${poId}`,
          note: po.notes ?? undefined,
          poId,
        });
      }

      // Achat comptant: auto-debit the acting user's personal caisse immediately
      if (po.paymentMethod === "comptant" && totalAmount > 0) {
        const payingCaisse = await ensureCaisse(null, actorUserId, tx);

        const [supplierOp] = await tx.insert(schema.supplierOperationsTable).values({
          supplierId: po.supplierId,
          storeId,
          type: "purchase_comptant",
          amount: totalAmount.toFixed(2),
          date: today,
          reference: `PO-${poId}`,
          poId,
        }).returning();

        await tx.update(schema.caissesTable)
          .set({ balance: sql`balance - ${totalAmount.toFixed(2)}` })
          .where(eq(schema.caissesTable.id, payingCaisse.id));

        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: payingCaisse.id,
          type: "debit",
          amount: totalAmount.toFixed(2),
          reason: "purchase_payment",
          supplierOperationId: supplierOp.id,
          actorUserId,
          notes: `Achat comptant BCA N°${poId}`,
        });

        comptantCaisseId = payingCaisse.id;
      }

      // Record accounting expense regardless of payment method
      await tx.insert(schema.transactionsTable).values({
        storeId,
        type: "expense",
        category: "purchase",
        amount: totalAmount.toFixed(2),
        description: `Réception BCA N°${poId}${po.paymentMethod === "comptant" ? " (Comptant)" : ""}`,
        date: today,
        reference: `PO-${poId}`,
      });

      return po;
    });

    if (!result) {
      // Distinguish "not found in store" from "already received/cancelled"
      const [existing] = await db.select({ status: schema.purchaseOrdersTable.status })
        .from(schema.purchaseOrdersTable)
        .where(and(eq(schema.purchaseOrdersTable.id, poId), eq(schema.purchaseOrdersTable.storeId, storeId)))
        .limit(1);
      if (!existing) { res.status(404).json({ error: "Purchase order not found" }); return; }
      res.status(409).json({ error: `Purchase order is already ${existing.status}` }); return;
    }

    const [supplier] = await db.select({ name: schema.suppliersTable.name })
      .from(schema.suppliersTable).where(eq(schema.suppliersTable.id, result.supplierId)).limit(1);
    broadcastToAdmins({
      type: "purchase_received",
      storeId,
      purchaseOrderId: poId,
      supplierName: supplier?.name ?? `Supplier #${result.supplierId}`,
      totalAmount: result.totalAmount,
    });
    if (comptantCaisseId !== null) {
      await broadcastCaisseChanged(storeId, [comptantCaisseId]);
    }
    res.json(result);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Product History ───────────────────────────────────────────────
router.get("/erp/products/:productId/history", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const productId = pid(req, "productId");

    // ── Accessible stores + peer products (shared by all history sections) ──
    // 1. Stores this admin can access (membership-based; respects permissions).
    const storeRows = await db.select({ storeId: schema.userStoresTable.storeId })
      .from(schema.userStoresTable)
      .where(eq(schema.userStoresTable.userId, req.user!.id));
    const accessibleStoreIds = Array.from(new Set<number>([...storeRows.map(r => r.storeId), storeId]));

    // 2. Resolve peer product IDs (same physical product across stores).
    //    Layer A — explicit transfer links; Layer B — barcode/reference fallback.
    const linkRows = await db.select({
      sourceProductId: schema.stockTransferItemsTable.sourceProductId,
      destinationProductId: schema.stockTransferItemsTable.destinationProductId,
    })
      .from(schema.stockTransferItemsTable)
      .where(or(
        eq(schema.stockTransferItemsTable.sourceProductId, productId),
        eq(schema.stockTransferItemsTable.destinationProductId, productId),
      ));
    const productIdSet = new Set<number>([productId]);
    for (const l of linkRows) {
      productIdSet.add(l.sourceProductId);
      if (l.destinationProductId != null) productIdSet.add(l.destinationProductId);
    }
    const [thisProduct] = await db.select({
      reference: schema.productsTable.reference,
      barcode: schema.productsTable.barcode,
    }).from(schema.productsTable).where(eq(schema.productsTable.id, productId)).limit(1);
    const matchClauses = [];
    if (thisProduct?.reference) matchClauses.push(eq(schema.productsTable.reference, thisProduct.reference));
    if (thisProduct?.barcode) matchClauses.push(eq(schema.productsTable.barcode, thisProduct.barcode));
    if (matchClauses.length > 0) {
      const matched = await db.select({ id: schema.productsTable.id })
        .from(schema.productsTable)
        .where(and(or(...matchClauses), inArray(schema.productsTable.storeId, accessibleStoreIds)));
      for (const m of matched) productIdSet.add(m.id);
    }
    const allProductIds = Array.from(productIdSet);

    // ── Purchase history (all accessible stores + peer products) ──
    const purchases = await db.select({
      purchaseOrderId: schema.purchaseItemsTable.purchaseOrderId,
      quantity: schema.purchaseItemsTable.quantity,
      unitCost: schema.purchaseItemsTable.unitCost,
      status: schema.purchaseOrdersTable.status,
      createdAt: schema.purchaseOrdersTable.createdAt,
      receivedAt: schema.purchaseOrdersTable.receivedAt,
      supplierName: schema.suppliersTable.name,
      storeId: schema.purchaseOrdersTable.storeId,
      storeNameAr: schema.storesTable.nameAr,
      storeNameEn: schema.storesTable.nameEn,
    })
      .from(schema.purchaseItemsTable)
      .innerJoin(schema.purchaseOrdersTable, and(
        eq(schema.purchaseItemsTable.purchaseOrderId, schema.purchaseOrdersTable.id),
        inArray(schema.purchaseOrdersTable.storeId, accessibleStoreIds),
      ))
      .leftJoin(schema.suppliersTable, eq(schema.purchaseOrdersTable.supplierId, schema.suppliersTable.id))
      .leftJoin(schema.storesTable, eq(schema.purchaseOrdersTable.storeId, schema.storesTable.id))
      .where(inArray(schema.purchaseItemsTable.productId, allProductIds))
      .orderBy(desc(schema.purchaseOrdersTable.createdAt));

    // ── Sales history (all accessible stores + peer products) ──
    const sales = await db.select({
      orderId: schema.orderItemsTable.orderId,
      quantity: schema.orderItemsTable.quantity,
      unitPrice: schema.orderItemsTable.unitPrice,
      customerName: schema.ordersTable.customerName,
      customerPhone: schema.ordersTable.customerPhone,
      status: schema.ordersTable.status,
      createdAt: schema.ordersTable.createdAt,
      storeId: schema.ordersTable.storeId,
      storeNameAr: schema.storesTable.nameAr,
      storeNameEn: schema.storesTable.nameEn,
    })
      .from(schema.orderItemsTable)
      .innerJoin(schema.ordersTable, and(
        eq(schema.orderItemsTable.orderId, schema.ordersTable.id),
        inArray(schema.ordersTable.storeId, accessibleStoreIds),
      ))
      .leftJoin(schema.storesTable, eq(schema.ordersTable.storeId, schema.storesTable.id))
      .where(inArray(schema.orderItemsTable.productId, allProductIds))
      .orderBy(desc(schema.ordersTable.createdAt));

    // 3. Inventory movements (exclude transfer rows — those come from transfer
    //    events below, to avoid double-counting the receive-time stock move).
    const movements = await db.select({
      id: schema.inventoryMovementsTable.id,
      storeId: schema.inventoryMovementsTable.storeId,
      type: schema.inventoryMovementsTable.type,
      quantity: schema.inventoryMovementsTable.quantity,
      reason: schema.inventoryMovementsTable.reason,
      reference: schema.inventoryMovementsTable.reference,
      createdAt: schema.inventoryMovementsTable.createdAt,
    })
      .from(schema.inventoryMovementsTable)
      .where(and(
        inArray(schema.inventoryMovementsTable.productId, allProductIds),
        inArray(schema.inventoryMovementsTable.storeId, accessibleStoreIds),
        or(
          isNull(schema.inventoryMovementsTable.reference),
          notLike(schema.inventoryMovementsTable.reference, "TR-%"),
        ),
      ))
      .orderBy(desc(schema.inventoryMovementsTable.createdAt));

    // 4. Transfer events (full lifecycle of every transfer involving this product).
    const transferRows = await db.select({
      eventId: schema.stockTransferEventsTable.id,
      transferId: schema.stockTransfersTable.id,
      status: schema.stockTransferEventsTable.status,
      createdAt: schema.stockTransferEventsTable.createdAt,
      sourceStoreId: schema.stockTransfersTable.sourceStoreId,
      destinationStoreId: schema.stockTransfersTable.destinationStoreId,
      quantity: schema.stockTransferItemsTable.quantity,
    })
      .from(schema.stockTransferEventsTable)
      .innerJoin(schema.stockTransfersTable, eq(schema.stockTransferEventsTable.transferId, schema.stockTransfersTable.id))
      .innerJoin(schema.stockTransferItemsTable, and(
        eq(schema.stockTransferItemsTable.transferId, schema.stockTransfersTable.id),
        or(
          inArray(schema.stockTransferItemsTable.sourceProductId, allProductIds),
          inArray(schema.stockTransferItemsTable.destinationProductId, allProductIds),
        ),
      ))
      .where(or(
        inArray(schema.stockTransfersTable.sourceStoreId, accessibleStoreIds),
        inArray(schema.stockTransfersTable.destinationStoreId, accessibleStoreIds),
      ))
      .orderBy(desc(schema.stockTransferEventsTable.createdAt));

    // 5. Batch-resolve store names for movements + transfers.
    const storeIdSet = new Set<number>();
    for (const m of movements) storeIdSet.add(m.storeId);
    for (const t of transferRows) { storeIdSet.add(t.sourceStoreId); storeIdSet.add(t.destinationStoreId); }
    const storeList = storeIdSet.size > 0
      ? await db.select({ id: schema.storesTable.id, nameAr: schema.storesTable.nameAr, nameEn: schema.storesTable.nameEn })
          .from(schema.storesTable).where(inArray(schema.storesTable.id, Array.from(storeIdSet)))
      : [];
    const storeMap = new Map(storeList.map(s => [s.id, s]));

    // 6. Merge into a single chronological timeline (newest first).
    const timeline = [
      ...movements.map(m => ({
        kind: "movement" as const,
        id: `movement-${m.id}`,
        date: m.createdAt,
        movementType: m.type,
        quantity: m.quantity,
        reason: m.reason,
        reference: m.reference,
        storeId: m.storeId,
        storeNameAr: storeMap.get(m.storeId)?.nameAr ?? null,
        storeNameEn: storeMap.get(m.storeId)?.nameEn ?? null,
      })),
      ...transferRows.map(t => ({
        kind: "transfer" as const,
        id: `transfer-${t.eventId}`,
        date: t.createdAt,
        status: t.status,
        transferId: t.transferId,
        quantity: t.quantity,
        sourceStoreId: t.sourceStoreId,
        sourceStoreNameAr: storeMap.get(t.sourceStoreId)?.nameAr ?? null,
        sourceStoreNameEn: storeMap.get(t.sourceStoreId)?.nameEn ?? null,
        destStoreId: t.destinationStoreId,
        destStoreNameAr: storeMap.get(t.destinationStoreId)?.nameAr ?? null,
        destStoreNameEn: storeMap.get(t.destinationStoreId)?.nameEn ?? null,
      })),
    ].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });

    res.json({ purchases, sales, timeline, currentStoreId: storeId });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Inventory ─────────────────────────────────────────────────────
router.get("/erp/inventory/stock", authenticate, requireStaff, requireStore, requirePermission("inventory", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const products = await db.select({
      id: schema.productsTable.id,
      nameEn: schema.productsTable.nameEn,
      nameAr: schema.productsTable.nameAr,
      stock: schema.productsTable.stock,
    }).from(schema.productsTable)
      .where(eq(schema.productsTable.storeId, storeId))
      .orderBy(schema.productsTable.stock);

    const result = products.map((p) => ({
      ...p,
      status: p.stock <= 3 ? "critical" : p.stock <= 10 ? "low" : "ok",
    }));

    res.json(result);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/inventory", authenticate, requireStaff, requireStore, requirePermission("inventory", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const movements = await db.select({
      id: schema.inventoryMovementsTable.id,
      type: schema.inventoryMovementsTable.type,
      quantity: schema.inventoryMovementsTable.quantity,
      reason: schema.inventoryMovementsTable.reason,
      reference: schema.inventoryMovementsTable.reference,
      createdAt: schema.inventoryMovementsTable.createdAt,
      productId: schema.inventoryMovementsTable.productId,
      product: { id: schema.productsTable.id, nameAr: schema.productsTable.nameAr, nameEn: schema.productsTable.nameEn },
    })
      .from(schema.inventoryMovementsTable)
      .leftJoin(schema.productsTable, eq(schema.inventoryMovementsTable.productId, schema.productsTable.id))
      .where(eq(schema.inventoryMovementsTable.storeId, storeId))
      .orderBy(desc(schema.inventoryMovementsTable.createdAt))
      .limit(100);
    res.json(movements);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/inventory/adjust", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { productId, quantity, reason } = req.body;
    const [product] = await db.select().from(schema.productsTable)
      .where(and(eq(schema.productsTable.id, productId), eq(schema.productsTable.storeId, storeId))).limit(1);
    if (!product) { res.status(404).json({ error: "Product not found in this store" }); return; }
    const newStock = product.stock + quantity;
    if (newStock < 0) {
      res.status(400).json({ error: `Adjustment would result in negative stock (${newStock}). Current stock: ${product.stock}.` });
      return;
    }
    await db.update(schema.productsTable).set({ stock: newStock })
      .where(eq(schema.productsTable.id, productId));
    const [mv] = await db.insert(schema.inventoryMovementsTable).values({
      storeId, productId, type: "adjustment", quantity, reason,
    }).returning();
    res.json(mv);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Accounting ────────────────────────────────────────────────────
router.get("/erp/transactions", authenticate, requireStaff, requireStore, requirePermission("accounting", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const transactions = await db.select().from(schema.transactionsTable)
      .where(eq(schema.transactionsTable.storeId, storeId))
      .orderBy(desc(schema.transactionsTable.date)).limit(200);
    res.json(transactions);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/transactions", authenticate, requireStaff, requireStore, requirePermission("accounting", "create"), async (req: AuthRequest, res) => {
  try {
    const body = { ...req.body, storeId: req.currentStoreId! };
    const [tx] = await db.insert(schema.transactionsTable).values(body).returning();
    res.status(201).json(tx);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/accounting-summary", authenticate, requireStaff, requireStore, requirePermission("accounting", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const [{ income }] = await db.select({ income: sql<number>`coalesce(sum(amount),0)` })
      .from(schema.transactionsTable)
      .where(and(eq(schema.transactionsTable.type, "income"), eq(schema.transactionsTable.storeId, storeId)));
    const [{ expenses }] = await db.select({ expenses: sql<number>`coalesce(sum(amount),0)` })
      .from(schema.transactionsTable)
      .where(and(eq(schema.transactionsTable.type, "expense"), eq(schema.transactionsTable.storeId, storeId)));
    const monthly = await db.execute(sql`
      SELECT TO_CHAR(date::date, 'YYYY-MM') as month,
        SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses
      FROM transactions
      WHERE date::date >= NOW() - INTERVAL '12 months' AND store_id = ${storeId}
      GROUP BY month ORDER BY month
    `);
    res.json({ totalIncome: Number(income), totalExpenses: Number(expenses), netBalance: Number(income) - Number(expenses), monthly: monthly.rows });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── CRM ───────────────────────────────────────────────────────────
// Customers are scoped to the store via their ORDER history (or direct creation).
router.get("/erp/customers", authenticate, requireStaff, requireStore, requirePermission("customers", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { search, wilaya, classificationId, priceTierId } = req.query as Record<string, string | undefined>;
    const customers = await db.execute(sql`
      SELECT u.id, u.name, u.email, u.phone, u.address, u.city, u.created_at,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(o.total_amount), 0) as total_spent,
        cp.wilaya, cp.contact_type, cp.rc, cp.nif, cp.ai, cp.nis,
        cp.account_number, cp.credit_limit, cp.current_balance,
        cp.min_balance_alert, cp.foreign_currency,
        CASE WHEN cc.id IS NOT NULL THEN json_build_object(
          'id', cc.id, 'labelFr', cc.label_fr, 'labelAr', cc.label_ar,
          'color', cc.color, 'sortOrder', cc.sort_order
        ) ELSE NULL END as classification,
        CASE WHEN pt.id IS NOT NULL THEN json_build_object(
          'id', pt.id, 'labelFr', pt.label_fr, 'labelAr', pt.label_ar,
          'code', pt.code, 'sortOrder', pt.sort_order
        ) ELSE NULL END as "priceTier"
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id AND o.store_id = ${storeId}
      LEFT JOIN customer_profiles cp ON cp.user_id = u.id
      LEFT JOIN customer_classifications cc ON cc.id = cp.classification_id
      LEFT JOIN price_tiers pt ON pt.id = cp.price_tier_id
      WHERE u.role = 'customer'
        AND (
          ${search ? sql`(lower(u.name) LIKE ${'%' + search.toLowerCase() + '%'} OR lower(u.email) LIKE ${'%' + search.toLowerCase() + '%'} OR lower(coalesce(u.phone,'')) LIKE ${'%' + search.toLowerCase() + '%'})` : sql`true`}
        )
        AND (
          ${wilaya ? sql`cp.wilaya = ${wilaya}` : sql`true`}
        )
        AND (
          ${classificationId ? sql`cp.classification_id = ${parseInt(classificationId)}` : sql`true`}
        )
        AND (
          ${priceTierId ? sql`cp.price_tier_id = ${parseInt(priceTierId)}` : sql`true`}
        )
      GROUP BY u.id, u.name, u.email, u.phone, u.address, u.city, u.created_at,
        cp.wilaya, cp.contact_type, cp.rc, cp.nif, cp.ai, cp.nis,
        cp.account_number, cp.credit_limit, cp.current_balance,
        cp.min_balance_alert, cp.foreign_currency, cp.store_id,
        cc.id, cc.label_fr, cc.label_ar, cc.color, cc.sort_order,
        pt.id, pt.label_fr, pt.label_ar, pt.code, pt.sort_order
      HAVING COUNT(o.id) > 0 OR cp.store_id = ${storeId}
      ORDER BY total_spent DESC
    `);
    if (isAdmin(req)) {
      res.json(customers.rows);
    } else {
      res.json(customers.rows.map((r: Record<string, unknown>) => {
        const { total_spent: _ts, ...rest } = r;
        return rest;
      }));
    }
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/customers", authenticate, requireStaff, requireStore, requirePermission("customers", "create"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const {
      name, email, password, preferredLang, phone, address, city, notes,
      contactType, wilaya, commune, gps, classificationId, priceTierId, accountNumber,
      creditLimit, minBalanceAlert, currentBalance, foreignCurrency,
      rc, nif, ai, nis,
    } = req.body || {};
    if (!name || !email) {
      res.status(400).json({ error: "name and email are required" });
      return;
    }
    const existing = await db.select({ id: schema.usersTable.id })
      .from(schema.usersTable).where(eq(schema.usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "A customer with this email already exists" });
      return;
    }
    const pwd = (password && String(password).length >= 6) ? String(password) : Math.random().toString(36).slice(2, 12);
    const passwordHash = await bcrypt.hash(pwd, 10);
    const [user] = await db.insert(schema.usersTable).values({
      name, email, passwordHash,
      role: "customer",
      preferredLang: preferredLang === "en" ? "en" : "ar",
      phone: phone || null,
      address: address || null,
      city: city || null,
      notes: notes || null,
    }).returning();
    const hasProfileData = !!(contactType || wilaya || commune || gps || classificationId || priceTierId ||
      accountNumber || creditLimit != null || minBalanceAlert != null || currentBalance || foreignCurrency ||
      rc || nif || ai || nis);
    if (hasProfileData) {
      await db.insert(schema.customerProfilesTable).values({
        userId: user.id,
        storeId,
        contactType: (contactType as "customer" | "customer_supplier") || "customer",
        wilaya: wilaya || null,
        commune: commune || null,
        gps: gps || null,
        classificationId: classificationId ? Number(classificationId) : null,
        priceTierId: priceTierId ? Number(priceTierId) : null,
        accountNumber: accountNumber || null,
        creditLimit: creditLimit != null ? String(creditLimit) : null,
        minBalanceAlert: minBalanceAlert != null ? String(minBalanceAlert) : null,
        currentBalance: currentBalance != null ? String(currentBalance) : "0",
        foreignCurrency: foreignCurrency ?? false,
        rc: rc || null, nif: nif || null, ai: ai || null, nis: nis || null,
      }).onConflictDoNothing();
    }
    res.status(201).json({
      id: user.id, name: user.name, email: user.email,
      phone: user.phone, address: user.address, city: user.city,
      wilaya: wilaya || null, classification: null, priceTier: null,
      total_orders: 0, total_spent: "0",
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/erp/customers/:id", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = pid(req, "id");
    const [user] = await db.select().from(schema.usersTable)
      .where(and(eq(schema.usersTable.id, userId), eq(schema.usersTable.role, "customer"))).limit(1);
    if (!user) { res.status(404).json({ error: "Customer not found" }); return; }
    const assoc = await db.execute(sql`
      (SELECT 1 FROM orders WHERE user_id = ${userId} AND store_id = ${storeId} LIMIT 1)
      UNION ALL
      (SELECT 1 FROM customer_profiles WHERE user_id = ${userId} AND store_id = ${storeId} LIMIT 1)
    `);
    if (assoc.rows.length === 0) { res.status(404).json({ error: "Customer not found" }); return; }
    const orders = await db.select().from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.userId, userId), eq(schema.ordersTable.storeId, storeId)))
      .orderBy(desc(schema.ordersTable.createdAt));
    const notes = await db.select().from(schema.customerNotesTable)
      .where(and(eq(schema.customerNotesTable.userId, userId), eq(schema.customerNotesTable.storeId, storeId)));
    const profileRows = await db.execute(sql`
      SELECT cp.*,
        CASE WHEN cc.id IS NOT NULL THEN json_build_object(
          'id', cc.id, 'labelFr', cc.label_fr, 'labelAr', cc.label_ar,
          'color', cc.color, 'sortOrder', cc.sort_order
        ) ELSE NULL END as classification,
        CASE WHEN pt.id IS NOT NULL THEN json_build_object(
          'id', pt.id, 'labelFr', pt.label_fr, 'labelAr', pt.label_ar,
          'code', pt.code, 'sortOrder', pt.sort_order
        ) ELSE NULL END as "priceTier"
      FROM customer_profiles cp
      LEFT JOIN customer_classifications cc ON cc.id = cp.classification_id
      LEFT JOIN price_tiers pt ON pt.id = cp.price_tier_id
      WHERE cp.user_id = ${userId}
    `);
    const rawProfile = profileRows.rows[0] as Record<string, unknown> | undefined;
    let profile = null;
    if (rawProfile) {
      profile = {
        contactType: rawProfile.contact_type,
        wilaya: rawProfile.wilaya,
        commune: rawProfile.commune,
        gps: rawProfile.gps,
        classificationId: rawProfile.classification_id,
        classification: rawProfile.classification,
        priceTierId: rawProfile.price_tier_id,
        priceTier: rawProfile.priceTier,
        accountNumber: rawProfile.account_number,
        creditLimit: rawProfile.credit_limit,
        minBalanceAlert: rawProfile.min_balance_alert,
        currentBalance: rawProfile.current_balance,
        foreignCurrency: rawProfile.foreign_currency,
        rc: rawProfile.rc,
        nif: rawProfile.nif,
        ai: rawProfile.ai,
        nis: rawProfile.nis,
      };
    }
    res.json({
      id: user.id, name: user.name, email: user.email,
      phone: user.phone, address: user.address, city: user.city,
      created_at: user.createdAt,
      profile, orders, notes,
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/customers/:id", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = pid(req, "id");
    const {
      name, phone, address, city,
      contactType, wilaya, commune, gps,
      classificationId, priceTierId,
      accountNumber, creditLimit, minBalanceAlert, currentBalance, foreignCurrency,
      rc, nif, ai, nis, password,
    } = req.body || {};
    const [user] = await db.select({ id: schema.usersTable.id })
      .from(schema.usersTable)
      .where(and(eq(schema.usersTable.id, userId), eq(schema.usersTable.role, "customer"))).limit(1);
    if (!user) { res.status(404).json({ error: "Customer not found" }); return; }
    const assoc = await db.execute(sql`
      (SELECT 1 FROM orders WHERE user_id = ${userId} AND store_id = ${storeId} LIMIT 1)
      UNION ALL
      (SELECT 1 FROM customer_profiles WHERE user_id = ${userId} AND store_id = ${storeId} LIMIT 1)
    `);
    if (assoc.rows.length === 0) { res.status(404).json({ error: "Customer not found" }); return; }
    const userUpdate: Record<string, unknown> = {};
    if (name !== undefined) userUpdate.name = name;
    if (phone !== undefined) userUpdate.phone = phone;
    if (address !== undefined) userUpdate.address = address;
    if (city !== undefined) userUpdate.city = city;
    if (password !== undefined && String(password).length >= 6) {
      userUpdate.passwordHash = await bcrypt.hash(String(password), 10);
    }
    if (Object.keys(userUpdate).length > 0) {
      await db.update(schema.usersTable).set(userUpdate).where(eq(schema.usersTable.id, userId));
    }
    // Build partial update: only fields explicitly sent in the request body are updated
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (contactType !== undefined) updateSet.contactType = contactType;
    if (wilaya !== undefined) updateSet.wilaya = wilaya ?? null;
    if (commune !== undefined) updateSet.commune = commune ?? null;
    if (gps !== undefined) updateSet.gps = gps ?? null;
    if (classificationId !== undefined) updateSet.classificationId = classificationId ?? null;
    if (priceTierId !== undefined) updateSet.priceTierId = priceTierId ?? null;
    if (accountNumber !== undefined) updateSet.accountNumber = accountNumber ?? null;
    if (creditLimit !== undefined) updateSet.creditLimit = creditLimit != null ? String(creditLimit) : null;
    if (minBalanceAlert !== undefined) updateSet.minBalanceAlert = minBalanceAlert != null ? String(minBalanceAlert) : null;
    if (currentBalance !== undefined) updateSet.currentBalance = currentBalance != null ? String(currentBalance) : null;
    if (foreignCurrency !== undefined) updateSet.foreignCurrency = foreignCurrency;
    if (rc !== undefined) updateSet.rc = rc ?? null;
    if (nif !== undefined) updateSet.nif = nif ?? null;
    if (ai !== undefined) updateSet.ai = ai ?? null;
    if (nis !== undefined) updateSet.nis = nis ?? null;
    // Full values for INSERT (new profile rows get defaults for omitted fields)
    const insertValues = {
      userId,
      storeId,
      contactType: (contactType as "customer" | "customer_supplier") ?? "customer",
      wilaya: wilaya ?? null, commune: commune ?? null, gps: gps ?? null,
      classificationId: classificationId ?? null, priceTierId: priceTierId ?? null,
      accountNumber: accountNumber ?? null,
      creditLimit: creditLimit != null ? String(creditLimit) : null,
      minBalanceAlert: minBalanceAlert != null ? String(minBalanceAlert) : null,
      currentBalance: currentBalance != null ? String(currentBalance) : "0",
      foreignCurrency: foreignCurrency ?? false,
      rc: rc ?? null, nif: nif ?? null, ai: ai ?? null, nis: nis ?? null,
    };
    await db.insert(schema.customerProfilesTable)
      .values(insertValues)
      .onConflictDoUpdate({ target: schema.customerProfilesTable.userId, set: updateSet });
    const profileRows = await db.execute(sql`
      SELECT cp.*,
        CASE WHEN cc.id IS NOT NULL THEN json_build_object(
          'id', cc.id, 'labelFr', cc.label_fr, 'labelAr', cc.label_ar,
          'color', cc.color, 'sortOrder', cc.sort_order
        ) ELSE NULL END as classification,
        CASE WHEN pt.id IS NOT NULL THEN json_build_object(
          'id', pt.id, 'labelFr', pt.label_fr, 'labelAr', pt.label_ar,
          'code', pt.code, 'sortOrder', pt.sort_order
        ) ELSE NULL END as "priceTier"
      FROM customer_profiles cp
      LEFT JOIN customer_classifications cc ON cc.id = cp.classification_id
      LEFT JOIN price_tiers pt ON pt.id = cp.price_tier_id
      WHERE cp.user_id = ${userId}
    `);
    const rawProfile = profileRows.rows[0] as Record<string, unknown> | undefined;
    let updatedProfile = null;
    if (rawProfile) {
      updatedProfile = {
        contactType: rawProfile.contact_type,
        wilaya: rawProfile.wilaya,
        commune: rawProfile.commune,
        gps: rawProfile.gps,
        classificationId: rawProfile.classification_id,
        classification: rawProfile.classification,
        priceTierId: rawProfile.price_tier_id,
        priceTier: rawProfile.priceTier,
        accountNumber: rawProfile.account_number,
        creditLimit: rawProfile.credit_limit,
        minBalanceAlert: rawProfile.min_balance_alert,
        currentBalance: rawProfile.current_balance,
        foreignCurrency: rawProfile.foreign_currency,
        rc: rawProfile.rc, nif: rawProfile.nif, ai: rawProfile.ai, nis: rawProfile.nis,
      };
    }
    const [updatedUser] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.id, userId)).limit(1);
    const orders = await db.select().from(schema.ordersTable)
      .where(and(eq(schema.ordersTable.userId, userId), storeId > 0 ? eq(schema.ordersTable.storeId, storeId) : sql`true`))
      .orderBy(desc(schema.ordersTable.createdAt));
    const notes = await db.select().from(schema.customerNotesTable)
      .where(and(eq(schema.customerNotesTable.userId, userId), storeId > 0 ? eq(schema.customerNotesTable.storeId, storeId) : sql`true`));
    res.json({
      id: updatedUser.id, name: updatedUser.name, email: updatedUser.email,
      phone: updatedUser.phone, address: updatedUser.address, city: updatedUser.city,
      created_at: updatedUser.createdAt,
      profile: updatedProfile, orders, notes,
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/customers/:id/notes", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const [note] = await db.insert(schema.customerNotesTable)
      .values({ userId: pid(req, "id"), note: req.body.note, storeId: req.currentStoreId! })
      .returning();
    res.status(201).json(note);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Customer Operations ────────────────────────────────────────────
router.get("/erp/customers/:id/operations", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    const { type, from, to } = req.query as Record<string, string | undefined>;
    const conditions = [
      eq(schema.customerOperationsTable.customerId, customerId),
      eq(schema.customerOperationsTable.storeId, storeId),
    ];
    if (type && type !== "all") conditions.push(eq(schema.customerOperationsTable.type, type));
    if (from) conditions.push(sql`${schema.customerOperationsTable.date} >= ${from}`);
    if (to) conditions.push(sql`${schema.customerOperationsTable.date} <= ${to}`);
    const ops = await db.select().from(schema.customerOperationsTable)
      .where(and(...conditions))
      .orderBy(asc(schema.customerOperationsTable.date), asc(schema.customerOperationsTable.createdAt));
    res.json(ops);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/customers/:id/operations", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    const { type, amount, date, reference, note } = req.body || {};
    if (!type || !amount || !date) {
      res.status(400).json({ error: "type, amount and date are required" });
      return;
    }
    if (!["versement", "remboursement", "vente_a_terme"].includes(type)) {
      res.status(400).json({ error: "type must be versement, remboursement or vente_a_terme" });
      return;
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    // Credit limit check for vente_a_terme
    if (type === "vente_a_terme") {
      const profileResult = await db.execute(sql`
        SELECT credit_limit, current_balance FROM customer_profiles
        WHERE user_id = ${customerId} AND store_id = ${storeId}
        LIMIT 1
      `);
      const profile = profileResult.rows[0] as { credit_limit: string | null; current_balance: string | null } | undefined;
      const creditLimit = Number(profile?.credit_limit ?? 0);
      const currentBalance = Number(profile?.current_balance ?? 0);
      if (creditLimit === 0) {
        res.status(400).json({ error: "Le client n'est pas autorisé à acheter à terme. Plafond de crédit = 0 DA" });
        return;
      }
      if (currentBalance + numAmount > creditLimit) {
        res.status(400).json({ error: "Plafond de crédit dépassé." });
        return;
      }
    }
    // Insert operation + update balance + caisse + accounting in a single transaction
    // versement = customer pays us → balance decreases (negative delta)
    // remboursement / vente_a_terme = customer owes more → balance increases (positive delta)
    const delta = type === "versement" ? -numAmount : numAmount;
    const actorUserId = req.user!.id;
    const amountStr = numAmount.toFixed(2);

    let resolvedCaisseId: number | null = null;
    const op = await db.transaction(async (tx) => {
      // ── Phase 1: resolve caisse (global model: auto-debit/-credit the actor's personal caisse) ──
      if (type === "versement" || type === "remboursement") {
        const caisse = await ensureCaisse(null, actorUserId, tx);
        resolvedCaisseId = caisse.id;
      }

      // ── Phase 2: insert customer_operation first (needed for FK link in caisse_movement) ──
      const [inserted] = await tx.insert(schema.customerOperationsTable).values({
        customerId,
        storeId,
        type,
        amount: amountStr,
        date,
        reference: reference || null,
        note: note || null,
        createdBy: actorUserId,
        caisseId: resolvedCaisseId,
      }).returning();

      // ── Phase 3: caisse movements + accounting (linked to customer operation) ──
      if (type === "versement" && resolvedCaisseId !== null) {
        await tx.update(schema.caissesTable)
          .set({ balance: sql`${schema.caissesTable.balance} + ${amountStr}` })
          .where(eq(schema.caissesTable.id, resolvedCaisseId));
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: resolvedCaisseId,
          type: "credit",
          amount: amountStr,
          reason: "customer_payment",
          customerOperationId: inserted.id,
          actorUserId,
          notes: `Versement client #${customerId}${reference ? ` - ${reference}` : ""}`,
        });
        await tx.insert(schema.transactionsTable).values({
          storeId,
          type: "income",
          category: "other",
          amount: amountStr,
          description: `Versement client #${customerId}${reference ? ` - ${reference}` : ""}`,
          date,
          reference: reference || null,
        });
      } else if (type === "remboursement" && resolvedCaisseId !== null) {
        await tx.update(schema.caissesTable)
          .set({ balance: sql`${schema.caissesTable.balance} - ${amountStr}` })
          .where(eq(schema.caissesTable.id, resolvedCaisseId));
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: resolvedCaisseId,
          type: "debit",
          amount: amountStr,
          reason: "customer_payment",
          customerOperationId: inserted.id,
          actorUserId,
          notes: `Remboursement client #${customerId}${reference ? ` - ${reference}` : ""}`,
        });
        await tx.insert(schema.transactionsTable).values({
          storeId,
          type: "expense",
          category: "other",
          amount: amountStr,
          description: `Remboursement client #${customerId}${reference ? ` - ${reference}` : ""}`,
          date,
          reference: reference || null,
        });
      } else if (type === "vente_a_terme") {
        // Recognize income at time of sale (deferred receivable)
        await tx.insert(schema.transactionsTable).values({
          storeId,
          type: "income",
          category: "sales",
          amount: amountStr,
          description: `Vente à terme client #${customerId}${reference ? ` - ${reference}` : ""}`,
          date,
          reference: reference || null,
        });
      }

      // ── Phase 4: update customer_profiles balance ──
      await tx.execute(sql`
        INSERT INTO customer_profiles (user_id, store_id, current_balance, updated_at)
        VALUES (${customerId}, ${storeId}, ${delta.toFixed(2)}, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET current_balance = COALESCE(customer_profiles.current_balance, 0) + ${delta.toFixed(2)},
              updated_at = NOW()
      `);
      return inserted;
    });
    if (resolvedCaisseId !== null) {
      await broadcastCaisseChanged(storeId, [resolvedCaisseId]);
    }
    res.status(201).json(op);
  } catch (err: any) {
    if (err?.statusCode === 400) { res.status(400).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/erp/customers/:id/operations/:opId", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    const opId = pid(req, "opId");
    const { type, amount, date, reference, note } = req.body || {};
    if (!type || !amount || !date) {
      res.status(400).json({ error: "type, amount and date are required" });
      return;
    }
    if (!["versement", "remboursement", "vente_a_terme"].includes(type)) {
      res.status(400).json({ error: "type must be versement, remboursement or vente_a_terme" });
      return;
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.customerOperationsTable)
        .where(and(
          eq(schema.customerOperationsTable.id, opId),
          eq(schema.customerOperationsTable.customerId, customerId),
          eq(schema.customerOperationsTable.storeId, storeId),
        ));
      if (!existing) return null;

      // Posted operations (versement/remboursement with caisse side effects) are
      // immutable on amount and type — only note, reference and date can be updated.
      const isPosted = existing.caisseId !== null && (existing.type === "versement" || existing.type === "remboursement");
      if (isPosted) {
        if (existing.type !== type || Number(existing.amount) !== numAmount) {
          throw Object.assign(
            new Error("Le montant et le type d'un versement/remboursement enregistré ne peuvent pas être modifiés. Supprimez et re-créez l'opération."),
            { statusCode: 400 }
          );
        }
        // Allow only note/reference/date update
        const [op] = await tx.update(schema.customerOperationsTable)
          .set({ date, reference: reference || null, note: note || null })
          .where(eq(schema.customerOperationsTable.id, opId))
          .returning();
        return op;
      }

      // Compute balance delta: reverse old effect, apply new effect
      const oldDelta = existing.type === "versement" ? -Number(existing.amount) : Number(existing.amount);
      const newDelta = type === "versement" ? -numAmount : numAmount;
      // Credit limit check for vente_a_terme
      if (type === "vente_a_terme") {
        const profileResult = await tx.execute(sql`
          SELECT credit_limit, current_balance FROM customer_profiles
          WHERE user_id = ${customerId} AND store_id = ${storeId}
          LIMIT 1
        `);
        const profile = profileResult.rows[0] as { credit_limit: string | null; current_balance: string | null } | undefined;
        const creditLimit = Number(profile?.credit_limit ?? 0);
        const currentBalance = Number(profile?.current_balance ?? 0);
        if (creditLimit === 0) {
          throw Object.assign(new Error("Le client n'est pas autorisé à acheter à terme. Plafond de crédit = 0 DA"), { statusCode: 400 });
        }
        const projected = currentBalance - oldDelta + numAmount;
        if (projected > creditLimit) {
          throw Object.assign(new Error("Plafond de crédit dépassé."), { statusCode: 400 });
        }
      }
      const balanceDiff = newDelta - oldDelta;
      const [op] = await tx.update(schema.customerOperationsTable)
        .set({ type, amount: numAmount.toFixed(2), date, reference: reference || null, note: note || null })
        .where(eq(schema.customerOperationsTable.id, opId))
        .returning();
      await tx.execute(sql`
        INSERT INTO customer_profiles (user_id, store_id, current_balance, updated_at)
        VALUES (${customerId}, ${storeId}, ${balanceDiff.toFixed(2)}, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET current_balance = COALESCE(customer_profiles.current_balance, 0) + ${balanceDiff.toFixed(2)},
              updated_at = NOW()
      `);
      return op;
    });
    if (!updated) { res.status(404).json({ error: "Operation not found" }); return; }
    res.json(updated);
  } catch (err: any) {
    if (err?.statusCode === 400) { res.status(400).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/erp/customers/:id/operations/:opId", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const customerId = pid(req, "id");
    const opId = pid(req, "opId");
    const force = req.query.force === "true";
    const deleted = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.customerOperationsTable)
        .where(and(
          eq(schema.customerOperationsTable.id, opId),
          eq(schema.customerOperationsTable.customerId, customerId),
          eq(schema.customerOperationsTable.storeId, storeId),
        ));
      if (!existing) return null;

      // Protection 1: vente_a_terme linked to a confirmed order cannot be deleted
      // without explicit ?force=true query param.
      if (existing.type === "vente_a_terme" && existing.reference && !force) {
        // Reference pattern is FV-XXXXXX → order id = parseInt(ref.replace('FV-',''))
        const match = /^FV-(\d+)$/i.exec(existing.reference);
        if (match) {
          const linkedOrderId = parseInt(match[1]);
          const [linkedOrder] = await tx.select({ id: schema.ordersTable.id, status: schema.ordersTable.status })
            .from(schema.ordersTable)
            .where(and(eq(schema.ordersTable.id, linkedOrderId), eq(schema.ordersTable.storeId, storeId)))
            .limit(1);
          if (linkedOrder && !["cancelled", "returned"].includes(linkedOrder.status)) {
            throw Object.assign(
              new Error("Cette vente à terme est liée à une commande confirmée. Ajoutez ?force=true pour forcer la suppression."),
              { statusCode: 409 }
            );
          }
        }
      }

      // Protection 2: posted versement/remboursement (caisse side-effects already applied)
      // require explicit ?force=true because deletion will reverse accounting entries.
      // This prevents accidental removal of financial records.
      if (!force && existing.caisseId !== null && (existing.type === "versement" || existing.type === "remboursement")) {
        throw Object.assign(
          new Error(
            `Ce ${existing.type} a déjà été enregistré en caisse (entrée comptable créée). ` +
            `Ajoutez ?force=true pour annuler l'opération et inverser les écritures.`
          ),
          { statusCode: 409 }
        );
      }

      // Reverse the operation's effect on customer balance
      const delta = existing.type === "versement" ? Number(existing.amount) : -Number(existing.amount);
      await tx.delete(schema.customerOperationsTable).where(eq(schema.customerOperationsTable.id, opId));
      await tx.execute(sql`
        INSERT INTO customer_profiles (user_id, store_id, current_balance, updated_at)
        VALUES (${customerId}, ${storeId}, ${delta.toFixed(2)}, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET current_balance = COALESCE(customer_profiles.current_balance, 0) + ${delta.toFixed(2)},
              updated_at = NOW()
      `);

      // Reverse caisse and accounting side effects for posted versement/remboursement
      if (existing.caisseId !== null && (existing.type === "versement" || existing.type === "remboursement")) {
        const actorUserId = (req as AuthRequest).user!.id;
        const amountStr = Number(existing.amount).toFixed(2);
        const today = new Date().toISOString().split("T")[0];

        if (existing.type === "versement") {
          // Reverse: debit caisse + expense accounting
          await tx.update(schema.caissesTable)
            .set({ balance: sql`${schema.caissesTable.balance} - ${amountStr}` })
            .where(eq(schema.caissesTable.id, existing.caisseId));
          await tx.insert(schema.caisseMovementsTable).values({
            caisseId: existing.caisseId,
            type: "debit",
            amount: amountStr,
            reason: "adjustment",
            actorUserId,
            notes: `Annulation versement client #${customerId}`,
          });
          await tx.insert(schema.transactionsTable).values({
            storeId,
            type: "expense",
            category: "other",
            amount: amountStr,
            description: `Annulation versement client #${customerId}`,
            date: today,
            reference: `CANCEL-VERS-${opId}`,
          });
        } else {
          // remboursement reversal: credit caisse + income accounting
          await tx.update(schema.caissesTable)
            .set({ balance: sql`${schema.caissesTable.balance} + ${amountStr}` })
            .where(eq(schema.caissesTable.id, existing.caisseId));
          await tx.insert(schema.caisseMovementsTable).values({
            caisseId: existing.caisseId,
            type: "credit",
            amount: amountStr,
            reason: "adjustment",
            actorUserId,
            notes: `Annulation remboursement client #${customerId}`,
          });
          await tx.insert(schema.transactionsTable).values({
            storeId,
            type: "income",
            category: "other",
            amount: amountStr,
            description: `Annulation remboursement client #${customerId}`,
            date: today,
            reference: `CANCEL-REMB-${opId}`,
          });
        }
      }

      return existing;
    });
    if (!deleted) { res.status(404).json({ error: "Operation not found" }); return; }
    if (deleted.caisseId !== null && (deleted.type === "versement" || deleted.type === "remboursement")) {
      await broadcastCaisseChanged(storeId, [deleted.caisseId]);
    }
    res.status(204).send();
  } catch (err: any) {
    if (err?.statusCode === 409) { res.status(409).json({ error: err.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Customer Classifications ──────────────────────────────────────
router.get("/erp/customer-classifications", authenticate, requireStaff, requirePermission("customers", "view"), async (req, res) => {
  try {
    const rows = await db.select().from(schema.customerClassificationsTable)
      .orderBy(schema.customerClassificationsTable.sortOrder, schema.customerClassificationsTable.id);
    res.json(rows.map((r) => ({
      id: r.id, labelFr: r.labelFr, labelAr: r.labelAr,
      color: r.color, sortOrder: r.sortOrder,
    })));
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/customer-classifications", authenticate, requireAdmin, async (req, res) => {
  try {
    const { labelFr, labelAr, color, sortOrder } = req.body || {};
    if (!labelFr || !labelAr) { res.status(400).json({ error: "labelFr and labelAr required" }); return; }
    const [row] = await db.insert(schema.customerClassificationsTable)
      .values({ labelFr, labelAr, color: color || null, sortOrder: sortOrder ?? 0 }).returning();
    res.status(201).json({ id: row.id, labelFr: row.labelFr, labelAr: row.labelAr, color: row.color, sortOrder: row.sortOrder });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/customer-classifications/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { labelFr, labelAr, color, sortOrder } = req.body || {};
    const [row] = await db.update(schema.customerClassificationsTable)
      .set({ labelFr, labelAr, color: color || null, ...(sortOrder !== undefined && { sortOrder }) })
      .where(eq(schema.customerClassificationsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: row.id, labelFr: row.labelFr, labelAr: row.labelAr, color: row.color, sortOrder: row.sortOrder });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/customer-classifications/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    await db.delete(schema.customerClassificationsTable)
      .where(eq(schema.customerClassificationsTable.id, Number(req.params.id)));
    res.json({ success: true });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Price Tiers ──────────────────────────────────────────────────
router.get("/erp/price-tiers", authenticate, requireStaff, requirePermission("customers", "view"), async (req, res) => {
  try {
    const rows = await db.select().from(schema.priceTiersTable)
      .orderBy(schema.priceTiersTable.sortOrder, schema.priceTiersTable.id);
    res.json(rows.map((r) => ({
      id: r.id, labelFr: r.labelFr, labelAr: r.labelAr,
      code: r.code, sortOrder: r.sortOrder,
    })));
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/price-tiers", authenticate, requireAdmin, async (req, res) => {
  try {
    const { labelFr, labelAr, code, sortOrder } = req.body || {};
    if (!labelFr || !labelAr || !code) { res.status(400).json({ error: "labelFr, labelAr and code required" }); return; }
    const [row] = await db.insert(schema.priceTiersTable)
      .values({ labelFr, labelAr, code, sortOrder: sortOrder ?? 0 }).returning();
    res.status(201).json({ id: row.id, labelFr: row.labelFr, labelAr: row.labelAr, code: row.code, sortOrder: row.sortOrder });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/price-tiers/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { labelFr, labelAr, code, sortOrder } = req.body || {};
    const [row] = await db.update(schema.priceTiersTable)
      .set({ labelFr, labelAr, code, ...(sortOrder !== undefined && { sortOrder }) })
      .where(eq(schema.priceTiersTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: row.id, labelFr: row.labelFr, labelAr: row.labelAr, code: row.code, sortOrder: row.sortOrder });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/price-tiers/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    await db.delete(schema.priceTiersTable).where(eq(schema.priceTiersTable.id, Number(req.params.id)));
    res.json({ success: true });
  } catch (err) { req.log?.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Staff (system users with admin/employee role) ────────────────
// Cross-store: list & manage users, plus their per-store grants.
router.get("/erp/staff", authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT u.id, u.name, u.email, u.role, u.phone, u.created_at,
        COALESCE(
          (SELECT json_agg(json_build_object('id', s.id, 'nameEn', s.name_en, 'nameAr', s.name_ar, 'slug', s.slug))
           FROM user_stores us JOIN stores s ON s.id = us.store_id
           WHERE us.user_id = u.id),
          '[]'::json
        ) AS stores
      FROM users u
      WHERE u.role IN ('admin', 'employee')
      ORDER BY u.created_at DESC
    `);
    res.json(rows.rows);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/erp/staff", authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, phone, storeIds } = req.body || {};
    if (!name || !email || !password) {
      res.status(400).json({ error: "name, email and password are required" });
      return;
    }
    if (String(password).length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    const wantedRole = role === "admin" ? "admin" : "employee";
    const existing = await db.select({ id: schema.usersTable.id })
      .from(schema.usersTable).where(eq(schema.usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const [user] = await db.insert(schema.usersTable).values({
      name, email, passwordHash,
      role: wantedRole,
      phone: phone || null,
    }).returning();

    // Attach to stores. Admins default to ALL stores; employees fall back
    // to the first active store when none are explicitly specified. Employees
    // may now be assigned to multiple stores (multi-store access).
    let targetStoreIds: number[] = Array.isArray(storeIds) ? storeIds.filter((n: unknown) => Number.isInteger(n)) : [];
    if (targetStoreIds.length === 0) {
      const all = await db.select({ id: schema.storesTable.id }).from(schema.storesTable)
        .where(eq(schema.storesTable.isActive, true)).orderBy(schema.storesTable.id);
      if (wantedRole === "admin") targetStoreIds = all.map(s => s.id);
      else if (all.length) targetStoreIds = [all[0].id];
    }
    if (targetStoreIds.length) {
      await db.insert(schema.userStoresTable)
        .values(targetStoreIds.map(storeId => ({ userId: user.id, storeId })))
        .onConflictDoNothing();
    }

    res.status(201).json({
      id: user.id, name: user.name, email: user.email,
      role: user.role, phone: user.phone, created_at: user.createdAt,
      storeIds: targetStoreIds,
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.put("/erp/staff/:id/stores", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const targetId = pid(req, "id");
    const { storeIds } = req.body || {};
    if (!Array.isArray(storeIds) || storeIds.some((n: unknown) => !Number.isInteger(n))) {
      res.status(400).json({ error: "storeIds must be an array of integers" });
      return;
    }
    if (storeIds.length === 0) {
      res.status(400).json({ error: "A staff member must have access to at least one store" });
      return;
    }
    const [target] = await db.select({ role: schema.usersTable.role })
      .from(schema.usersTable).where(eq(schema.usersTable.id, targetId)).limit(1);
    if (!target) { res.status(404).json({ error: "Staff not found" }); return; }
    if (target.role === "customer") {
      res.status(400).json({ error: "Cannot assign stores to customer accounts" });
      return;
    }
    await db.delete(schema.userStoresTable).where(eq(schema.userStoresTable.userId, targetId));
    await db.insert(schema.userStoresTable)
      .values((storeIds as number[]).map(storeId => ({ userId: targetId, storeId })))
      .onConflictDoNothing();
    res.json({ success: true, userId: targetId, storeIds });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// PUT /erp/staff/:id/password — admin: reset a staff member's password.
// Stores a fresh bcrypt hash; never reads or returns the existing password.
router.put("/erp/staff/:id/password", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const targetId = pid(req, "id");
    const { password } = req.body || {};
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    const [target] = await db.select({ role: schema.usersTable.role })
      .from(schema.usersTable).where(eq(schema.usersTable.id, targetId)).limit(1);
    if (!target) { res.status(404).json({ error: "Staff not found" }); return; }
    if (target.role === "customer") {
      res.status(400).json({ error: "Not a staff account" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await db.update(schema.usersTable)
      .set({ passwordHash })
      .where(eq(schema.usersTable.id, targetId));
    res.json({ success: true, userId: targetId });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/erp/staff/:id", authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const targetId = pid(req, "id");
    if (req.user?.id === targetId) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    const [user] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.id, targetId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    if (user.role === "customer") { res.status(400).json({ error: "Not a staff account" }); return; }
    await db.delete(schema.usersTable).where(eq(schema.usersTable.id, targetId));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;

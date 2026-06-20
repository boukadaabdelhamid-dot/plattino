import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { db, schema } from "../lib/db";
import { signToken, authenticate, type AuthRequest } from "../lib/auth";
import { listUserStores } from "../lib/store-context";
import { sendPasswordResetEmail } from "../lib/email";

const router = Router();

router.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password, preferredLang } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: "name, email, password required" });
      return;
    }
    const existing = await db.select().from(schema.usersTable).where(eq(schema.usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(schema.usersTable).values({
      name, email, passwordHash,
      preferredLang: preferredLang || "ar",
    }).returning();
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, stores: [] });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "email and password required" });
      return;
    }
    const [user] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.email, email)).limit(1);
    if (!user) { res.status(401).json({ error: "Invalid credentials" }); return; }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { res.status(401).json({ error: "Invalid credentials" }); return; }
    if (!user.isActive) { res.status(403).json({ error: "Account disabled" }); return; }

    const allStores = (user.role === "admin" || user.role === "employee")
      ? await listUserStores(user.id)
      : [];
    // Only allow active stores into the picker / auto-select.
    const stores = allStores.filter((s) => s.isActive);

    // Auto-select if exactly one active store; otherwise leave unset.
    const currentStoreId = stores.length === 1 ? stores[0].id : null;
    const token = signToken({ id: user.id, email: user.email, role: user.role, currentStoreId });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, preferredLang: user.preferredLang },
      stores,
      currentStoreId,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/me", authenticate, async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.id, req.user!.id)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const stores = ((user.role === "admin" || user.role === "employee")
      ? await listUserStores(user.id)
      : []).filter((s) => s.isActive);
    const tokenStoreId = req.user!.currentStoreId ?? null;
    const validCurrent = tokenStoreId != null && stores.some((s) => s.id === tokenStoreId)
      ? tokenStoreId : null;
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      preferredLang: user.preferredLang,
      phone: user.phone ?? null,
      address: user.address ?? null,
      city: user.city ?? null,
      stores,
      currentStoreId: validCurrent,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/auth/me", authenticate, async (req: AuthRequest, res) => {
  try {
    const { name, phone, address, city } = req.body || {};
    const update: Record<string, unknown> = {};
    if (name !== undefined) update["name"] = String(name).trim() || null;
    if (phone !== undefined) update["phone"] = String(phone).trim() || null;
    if (address !== undefined) update["address"] = String(address).trim() || null;
    if (city !== undefined) update["city"] = String(city).trim() || null;
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const [user] = await db.update(schema.usersTable)
      .set(update)
      .where(eq(schema.usersTable.id, req.user!.id))
      .returning();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone ?? null,
      address: user.address ?? null,
      city: user.city ?? null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/auth/me/password", authenticate, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword and newPassword required" });
      return;
    }
    if (String(newPassword).length < 6) {
      res.status(400).json({ error: "New password must be at least 6 characters" });
      return;
    }
    const [user] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.id, req.user!.id)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const valid = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }
    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await db.update(schema.usersTable).set({ passwordHash }).where(eq(schema.usersTable.id, req.user!.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  console.log("[forgot-password] 1. route entered — body:", JSON.stringify(req.body));
  try {
    const { email } = req.body || {};
    if (!email) {
      console.log("[forgot-password] 2. missing email — returning 400");
      res.status(400).json({ error: "email required" });
      return;
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    console.log(`[forgot-password] 2. looking up email="${normalizedEmail}"`);

    const [user] = await db.select({ id: schema.usersTable.id, email: schema.usersTable.email })
      .from(schema.usersTable)
      .where(eq(schema.usersTable.email, normalizedEmail))
      .limit(1);

    console.log(`[forgot-password] 3. user lookup result: ${user ? `found id=${user.id} email=${user.email}` : "NOT FOUND — skipping email"}`);

    if (user) {
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      console.log(`[forgot-password] 4. token generated rawToken[0..8]=${rawToken.substring(0, 8)}... expiresAt=${expiresAt.toISOString()}`);

      await db.insert(schema.passwordResetTokensTable).values({
        userId: user.id,
        token: tokenHash,
        expiresAt,
      });
      console.log(`[forgot-password] 5. token saved to DB for userId=${user.id}`);

      // Must point to the web-store frontend, NOT the API server.
      // Priority: WEB_STORE_URL > FRONTEND_URL > APP_URL  (RAILWAY_PUBLIC_DOMAIN is intentionally NOT used — it is the API server's own domain, not the web store's)
      const _wsUrl    = process.env["WEB_STORE_URL"]         ?? "";
      const _feUrl    = process.env["FRONTEND_URL"]           ?? "";
      const _appUrl   = process.env["APP_URL"]                ?? "";
      const _railwayDomain = process.env["RAILWAY_PUBLIC_DOMAIN"] ?? "";

      const winner = _wsUrl ? "WEB_STORE_URL" : _feUrl ? "FRONTEND_URL" : _appUrl ? "APP_URL" : "NONE";
      const webStoreUrl = (_wsUrl || _feUrl || _appUrl).replace(/\/$/, "");

      console.log(
        `[forgot-password] ENV_DUMP ` +
        `WEB_STORE_URL="${_wsUrl}" ` +
        `FRONTEND_URL="${_feUrl}" ` +
        `APP_URL="${_appUrl}" ` +
        `RAILWAY_PUBLIC_DOMAIN="${_railwayDomain}" ` +
        `WINNER=${winner} ` +
        `resolved_base="${webStoreUrl}"`
      );

      if (!webStoreUrl) {
        console.error("[forgot-password] WARNING: no base URL configured — reset link will be broken. Set WEB_STORE_URL to the web-store public domain in Railway (e.g. https://midanic.up.railway.app).");
      }

      const resetUrl = `${webStoreUrl}/auth/reset-password/${rawToken}`;
      console.log(`[forgot-password] RESET_URL="${resetUrl}"`);

      if (process.env["NODE_ENV"] !== "production") {
        req.log.info({ resetUrl }, "[DEV] Password reset link");
      }

      console.log(`[forgot-password] 7. calling sendPasswordResetEmail to=${user.email}`);
      try {
        await sendPasswordResetEmail({ to: user.email, resetUrl });
        console.log(`[forgot-password] 8. sendPasswordResetEmail completed OK`);
        req.log.info({ userId: user.id }, "Password reset email delivered");
      } catch (emailErr: unknown) {
        const e = emailErr as Error;
        console.error(`[forgot-password] 8. sendPasswordResetEmail FAILED: ${e.message}`);
        req.log.error({ userId: user.id, err: emailErr }, "Failed to send password reset email");
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[forgot-password] OUTER catch:", (err as Error).message);
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      res.status(400).json({ valid: false, error: "Token is required" });
      return;
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [record] = await db.select()
      .from(schema.passwordResetTokensTable)
      .where(eq(schema.passwordResetTokensTable.token, tokenHash))
      .limit(1);

    if (!record || record.used || new Date() > record.expiresAt) {
      res.status(400).json({ valid: false, error: "Invalid or expired reset link" });
      return;
    }
    res.json({ valid: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ valid: false, error: "Internal server error" });
  }
});

router.post("/auth/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body || {};
    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }
    if (!password || String(password).length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const passwordHash = await bcrypt.hash(String(password), 10);

    await db.transaction(async (tx) => {
      const [record] = await tx.select()
        .from(schema.passwordResetTokensTable)
        .where(and(
          eq(schema.passwordResetTokensTable.token, tokenHash),
          eq(schema.passwordResetTokensTable.used, false),
        ))
        .limit(1)
        .for("update");

      if (!record) {
        throw Object.assign(new Error("Invalid or expired reset link"), { statusCode: 400 });
      }
      if (new Date() > record.expiresAt) {
        throw Object.assign(new Error("This reset link has expired"), { statusCode: 400 });
      }

      await tx.update(schema.passwordResetTokensTable)
        .set({ used: true })
        .where(eq(schema.passwordResetTokensTable.id, record.id));

      await tx.update(schema.usersTable)
        .set({ passwordHash })
        .where(eq(schema.usersTable.id, record.userId));
    });

    res.json({ success: true });
  } catch (err: any) {
    if (err?.statusCode === 400) {
      res.status(400).json({ error: err.message });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/select-store", authenticate, async (req: AuthRequest, res) => {
  try {
    // Any staff member (admin or employee) may switch between stores they
    // have been granted access to. Customers are excluded — verified below
    // via the user_stores membership check.
    if (req.user!.role === "customer") {
      res.status(403).json({ error: "Customers cannot select an ERP store" });
      return;
    }
    const { storeId } = req.body || {};
    if (!Number.isInteger(storeId)) {
      res.status(400).json({ error: "storeId required" });
      return;
    }
    const [link] = await db.select().from(schema.userStoresTable)
      .where(and(
        eq(schema.userStoresTable.userId, req.user!.id),
        eq(schema.userStoresTable.storeId, storeId),
      ))
      .limit(1);
    if (!link) {
      res.status(403).json({ error: "You do not have access to this store" });
      return;
    }
    const [store] = await db.select().from(schema.storesTable)
      .where(and(eq(schema.storesTable.id, storeId), eq(schema.storesTable.isActive, true)))
      .limit(1);
    if (!store) {
      res.status(404).json({ error: "Store not found or inactive" });
      return;
    }
    const token = signToken({
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
      currentStoreId: store.id,
    });
    res.json({ token, currentStoreId: store.id, store });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

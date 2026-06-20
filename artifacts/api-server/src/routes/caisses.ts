import { Router } from "express";
import { eq, and, or, desc, inArray, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { authenticate, requireStaff, requireStore, requireAdmin, isAdmin, requirePermission, type AuthRequest } from "../lib/auth";
import { broadcastToStoreUsers, broadcastToUsers, broadcastCaisseChanged } from "../lib/ws";

const router = Router();

const pid = (req: { params: Record<string, string | string[]> }, key: string): number =>
  parseInt(req.params[key] as string);

type CaisseTransferStatus = typeof schema.caisseTransferStatusEnum.enumValues[number];

// ─── helpers ───────────────────────────────────────────────────────
function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function userHasStoreAccess(req: AuthRequest, storeId: number): Promise<boolean> {
  if (!req.user) return false;
  const [link] = await db.select({ storeId: schema.userStoresTable.storeId })
    .from(schema.userStoresTable)
    .where(and(
      eq(schema.userStoresTable.userId, req.user.id),
      eq(schema.userStoresTable.storeId, storeId),
    ))
    .limit(1);
  return !!link;
}

async function adminHasStoreAccess(req: AuthRequest, storeId: number): Promise<boolean> {
  if (!isAdmin(req)) return false;
  return userHasStoreAccess(req, storeId);
}

/**
 * Returns (creating if needed) the GLOBAL caisse for the given owner.
 * Caisses are store-agnostic: there is exactly one main caisse org-wide and
 * exactly one personal caisse per user. If ownerUserId is null, returns/creates
 * the single global main caisse. The legacy `storeId` parameter is ignored
 * (kept only so existing call sites compile); created rows have store_id NULL.
 * Idempotent under concurrent calls thanks to partial unique indexes.
 */
type DbLike = Pick<typeof db, "select" | "insert" | "update" | "delete">;

export async function ensureCaisse(
  _storeId: number | null,
  ownerUserId: number | null,
  txArg?: DbLike,
): Promise<typeof schema.caissesTable.$inferSelect> {
  const tx: DbLike = txArg ?? db;
  const kind: "main" | "staff" = ownerUserId === null ? "main" : "staff";
  const where = ownerUserId === null
    ? eq(schema.caissesTable.kind, "main")
    : eq(schema.caissesTable.ownerUserId, ownerUserId);
  const [existing] = await tx.select().from(schema.caissesTable).where(where).limit(1);
  if (existing) return existing;
  try {
    const [created] = await tx.insert(schema.caissesTable).values({
      storeId: null, ownerUserId: ownerUserId ?? null, kind,
    }).returning();
    return created;
  } catch {
    // Race: another concurrent insert won — re-fetch
    const [c2] = await tx.select().from(schema.caissesTable).where(where).limit(1);
    if (!c2) throw new Error("Failed to ensure caisse");
    return c2;
  }
}

// Transfer state changed: notify admins of the store + sender + recipient.
// `extra` carries the sender/recipient/actor user ids so the client can
// show a precise toast to the right person (recipientUserId is null when
// the destination is the store's main caisse).
function broadcastCaisseTransferChanged(
  storeId: number | null,
  transferId: number,
  status: CaisseTransferStatus,
  participantUserIds: number[] = [],
  extra: { senderUserId?: number | null; recipientUserId?: number | null; actorUserId?: number | null } = {},
) {
  const payload = {
    type: "caisse_transfer_changed",
    storeId,
    transferId,
    status,
    senderUserId: extra.senderUserId ?? null,
    recipientUserId: extra.recipientUserId ?? null,
    actorUserId: extra.actorUserId ?? null,
  };
  if (storeId !== null) broadcastToStoreUsers(storeId, payload, participantUserIds);
  // Also direct-deliver to participants in case they aren't currently
  // mapped to that store (defensive — should normally be no-op).
  if (participantUserIds.length) broadcastToUsers(participantUserIds, payload);
}

async function loadCaisseOr404(id: number) {
  const [c] = await db.select().from(schema.caissesTable).where(eq(schema.caissesTable.id, id)).limit(1);
  return c ?? null;
}

async function caisseOwnerId(caisseId: number): Promise<number | null> {
  const [c] = await db.select({ ownerUserId: schema.caissesTable.ownerUserId })
    .from(schema.caissesTable).where(eq(schema.caissesTable.id, caisseId)).limit(1);
  return c?.ownerUserId ?? null;
}

// Detects transfers created under the legacy "hold-on-create" model, where
// the sender was already debited at creation (a transfer_hold movement
// exists). New no-hold transfers move money only on accept.
async function transferWasHeld(transferId: number): Promise<boolean> {
  const [row] = await db.select({ id: schema.caisseMovementsTable.id })
    .from(schema.caisseMovementsTable)
    .where(and(
      eq(schema.caisseMovementsTable.caisseTransferId, transferId),
      eq(schema.caisseMovementsTable.reason, "transfer_hold"),
    ))
    .limit(1);
  return !!row;
}

// Authorization for GLOBAL caisses: caisses are no longer tied to a store, so
// access is governed purely by ownership. Admins (who are staff with a current
// store, enforced by middleware) can view/act on any caisse; a staff member can
// only view/act on their own personal caisse.
async function canSeeCaisse(req: AuthRequest, c: { ownerUserId: number | null }): Promise<boolean> {
  if (!req.user) return false;
  if (isAdmin(req)) return true;
  return c.ownerUserId !== null && c.ownerUserId === req.user.id;
}

// Caisse transfers still record the store context where they were initiated.
// This guard prevents using one store's JWT to act on a transfer raised in a
// different store context. Transfers without a store context (storeId null)
// are not store-restricted.
function isInCurrentStore(req: AuthRequest, storeId: number | null): boolean {
  return storeId === null || req.currentStoreId === storeId;
}

// ─── LIST in current store ─────────────────────────────────────────
// Staff: returns just their own caisse + the main caisse (read-only summary).
// Admin: returns all caisses in current store (main + every staff caisse).
router.get("/erp/caisses", authenticate, requireStaff, requireStore, requirePermission("caisse", "view"), async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = req.user!.id;
    // Always ensure my own + main exist for the current store
    await ensureCaisse(storeId, null);
    await ensureCaisse(storeId, userId);

    let rows: Array<typeof schema.caissesTable.$inferSelect>;
    if (isAdmin(req)) {
      // Global model: admins see every caisse (the single main + all staff).
      rows = await db.select().from(schema.caissesTable)
        .orderBy(desc(schema.caissesTable.kind), schema.caissesTable.id);
    } else {
      // Non-admin staff: only their own caisse (no main, no colleagues').
      rows = await db.select().from(schema.caissesTable)
        .where(and(
          eq(schema.caissesTable.kind, "staff"),
          eq(schema.caissesTable.ownerUserId, userId),
        ));
    }

    const userIds = Array.from(new Set(rows.map(r => r.ownerUserId).filter((x): x is number => !!x)));
    const users = userIds.length
      ? await db.select({ id: schema.usersTable.id, name: schema.usersTable.name, email: schema.usersTable.email, role: schema.usersTable.role })
          .from(schema.usersTable).where(inArray(schema.usersTable.id, userIds))
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));

    res.json(rows.map(r => ({
      ...r,
      owner: r.ownerUserId ? userMap.get(r.ownerUserId) ?? null : null,
    })));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Per-staff caisse activity report ──────────────────────────────
// Admin-only. Aggregates caisse_movements within [from, to) per staff
// caisse in the current store. Dates are interpreted in the server TZ;
// When `from`/`to` are date-only (YYYY-MM-DD), `from` is the inclusive
// start-of-day and `to` is the inclusive end-of-day (i.e. expanded to
// the next midnight as the exclusive upper bound). Example:
// from=2026-05-01&to=2026-05-01 covers all of May 1st;
// from=2026-05-01&to=2026-05-03 covers May 1st through May 3rd.
router.get("/erp/caisses/reports", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const { from: fromRaw, to: toRaw } = req.query as Record<string, string | undefined>;

    const parseDay = (v: string | undefined): Date | null => {
      if (!v) return null;
      // Accept YYYY-MM-DD or full ISO. Treat date-only as local midnight.
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };

    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

    const fromDate = parseDay(fromRaw) ?? startOfToday;
    let toDate = parseDay(toRaw) ?? startOfTomorrow;
    // If `to` is a date-only value, treat it as inclusive end-of-day by
    // bumping it to the next day's midnight (exclusive upper bound).
    if (toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
      toDate = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
    }
    if (toDate <= fromDate) {
      res.status(400).json({ error: "`to` must be after `from`" });
      return;
    }

    const m = schema.caisseMovementsTable;
    const c = schema.caissesTable;

    type ReportRow = {
      caisseId: number;
      ownerUserId: number | null;
      kind: string;
      totalSales: string;
      transfersIn: string;
      transfersOut: string;
      transfersHeld: string;
      transfersRefunded: string;
      adminDeposits: string;
      adminWithdrawals: string;
      adjustmentsCredit: string;
      adjustmentsDebit: string;
      netMovement: string;
      movementCount: number;
      currentBalance: string;
    };

    const rows = await db
      .select({
        caisseId: c.id,
        ownerUserId: c.ownerUserId,
        kind: c.kind,
        currentBalance: c.balance,
        totalSales: sql<string>`coalesce(sum(case when ${m.reason} = 'sale' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
        transfersIn: sql<string>`coalesce(sum(case when ${m.reason} = 'transfer_in' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
        transfersOut: sql<string>`coalesce(sum(case when ${m.reason} = 'transfer_out' and ${m.type} = 'debit' then ${m.amount} else 0 end), 0)`,
        transfersHeld: sql<string>`coalesce(sum(case when ${m.reason} = 'transfer_hold' and ${m.type} = 'debit' then ${m.amount} else 0 end), 0)`,
        transfersRefunded: sql<string>`coalesce(sum(case when ${m.reason} = 'transfer_refund' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
        adminDeposits: sql<string>`coalesce(sum(case when ${m.reason} = 'admin_deposit' and ${m.type} = 'debit' then ${m.amount} else 0 end), 0)`,
        adminWithdrawals: sql<string>`coalesce(sum(case when ${m.reason} = 'admin_withdraw' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
        adjustmentsCredit: sql<string>`coalesce(sum(case when ${m.reason} = 'adjustment' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
        adjustmentsDebit: sql<string>`coalesce(sum(case when ${m.reason} = 'adjustment' and ${m.type} = 'debit' then ${m.amount} else 0 end), 0)`,
        netMovement: sql<string>`coalesce(sum(case when ${m.type} = 'credit' then ${m.amount} else -${m.amount} end), 0)`,
        movementCount: sql<number>`coalesce(count(${m.id}), 0)::int`,
      })
      .from(c)
      .leftJoin(
        m,
        and(
          eq(m.caisseId, c.id),
          gte(m.createdAt, fromDate),
          lt(m.createdAt, toDate),
        ),
      )
      .where(eq(c.kind, "staff"))
      .groupBy(c.id, c.ownerUserId, c.kind, c.balance)
      .orderBy(c.id) as ReportRow[];

    const ownerIds = Array.from(new Set(rows.map(r => r.ownerUserId).filter((x): x is number => !!x)));
    const owners = ownerIds.length
      ? await db.select({ id: schema.usersTable.id, name: schema.usersTable.name, email: schema.usersTable.email, role: schema.usersTable.role })
          .from(schema.usersTable).where(inArray(schema.usersTable.id, ownerIds))
      : [];
    const ownerMap = new Map(owners.map(u => [u.id, u]));

    const enriched = rows.map(r => ({
      ...r,
      owner: r.ownerUserId ? ownerMap.get(r.ownerUserId) ?? null : null,
    }));

    // Totals across all rows for quick reconciliation summary.
    const sumStr = (key: keyof ReportRow): string => {
      const s = rows.reduce((acc, r) => acc + parseFloat(String(r[key]) || "0"), 0);
      return s.toFixed(2);
    };
    const totals = {
      totalSales: sumStr("totalSales"),
      transfersIn: sumStr("transfersIn"),
      transfersOut: sumStr("transfersOut"),
      transfersHeld: sumStr("transfersHeld"),
      transfersRefunded: sumStr("transfersRefunded"),
      adminDeposits: sumStr("adminDeposits"),
      adminWithdrawals: sumStr("adminWithdrawals"),
      adjustmentsCredit: sumStr("adjustmentsCredit"),
      adjustmentsDebit: sumStr("adjustmentsDebit"),
      netMovement: sumStr("netMovement"),
      movementCount: rows.reduce((acc, r) => acc + Number(r.movementCount || 0), 0),
    };

    res.json({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      rows: enriched,
      totals,
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── GET caisse detail with movements ──────────────────────────────
router.get("/erp/caisses/:id", authenticate, requireStaff, requireStore, requirePermission("caisse", "view"), async (req: AuthRequest, res) => {
  try {
    const c = await loadCaisseOr404(pid(req, "id"));
    if (!c) { res.status(404).json({ error: "Caisse not found" }); return; }
    if (!isInCurrentStore(req, c.storeId) || !(await canSeeCaisse(req, c))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const movements = await db.select().from(schema.caisseMovementsTable)
      .where(eq(schema.caisseMovementsTable.caisseId, c.id))
      .orderBy(desc(schema.caisseMovementsTable.createdAt))
      .limit(200);

    const actorIds = Array.from(new Set(movements.map(m => m.actorUserId).filter((x): x is number => !!x)));
    const counterIds = Array.from(new Set(movements.map(m => m.counterpartyCaisseId).filter((x): x is number => !!x)));
    const [actors, counters] = await Promise.all([
      actorIds.length
        ? db.select({ id: schema.usersTable.id, name: schema.usersTable.name, email: schema.usersTable.email })
            .from(schema.usersTable).where(inArray(schema.usersTable.id, actorIds))
        : Promise.resolve([]),
      counterIds.length
        ? db.select().from(schema.caissesTable).where(inArray(schema.caissesTable.id, counterIds))
        : Promise.resolve([]),
    ]);
    const actorOwnerIds = Array.from(new Set(counters.map(x => x.ownerUserId).filter((x): x is number => !!x)));
    const counterOwners = actorOwnerIds.length
      ? await db.select({ id: schema.usersTable.id, name: schema.usersTable.name })
          .from(schema.usersTable).where(inArray(schema.usersTable.id, actorOwnerIds))
      : [];
    const counterOwnerMap = new Map(counterOwners.map(u => [u.id, u]));
    const actorMap = new Map(actors.map(u => [u.id, u]));
    const counterMap = new Map(counters.map(x => [x.id, {
      id: x.id, kind: x.kind, ownerUserId: x.ownerUserId,
      owner: x.ownerUserId ? counterOwnerMap.get(x.ownerUserId) ?? null : null,
    }]));

    let owner: { id: number; name: string | null; email: string } | null = null;
    if (c.ownerUserId) {
      const [u] = await db.select({ id: schema.usersTable.id, name: schema.usersTable.name, email: schema.usersTable.email })
        .from(schema.usersTable).where(eq(schema.usersTable.id, c.ownerUserId)).limit(1);
      owner = u ?? null;
    }

    res.json({
      ...c,
      owner,
      movements: movements.map(m => ({
        ...m,
        actorUser: actorMap.get(m.actorUserId) ?? null,
        counterparty: m.counterpartyCaisseId ? counterMap.get(m.counterpartyCaisseId) ?? null : null,
      })),
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── List caisse transfers (inbox / outbox / all) ──────────────────
router.get("/erp/caisse-transfers", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = req.user!.id;
    const { box, status } = req.query as Record<string, string | undefined>;
    const myCaisse = await ensureCaisse(storeId, userId);

    const conditions = [eq(schema.caisseTransfersTable.storeId, storeId)];
    if (!isAdmin(req)) {
      conditions.push(or(
        eq(schema.caisseTransfersTable.senderCaisseId, myCaisse.id),
        eq(schema.caisseTransfersTable.recipientCaisseId, myCaisse.id),
      )!);
    }
    if (box === "inbox") conditions.push(eq(schema.caisseTransfersTable.recipientCaisseId, myCaisse.id));
    else if (box === "outbox") conditions.push(eq(schema.caisseTransfersTable.senderCaisseId, myCaisse.id));
    if (status) conditions.push(eq(schema.caisseTransfersTable.status, status as CaisseTransferStatus));

    const rows = await db.select().from(schema.caisseTransfersTable)
      .where(and(...conditions))
      .orderBy(desc(schema.caisseTransfersTable.createdAt))
      .limit(200);

    const caisseIds = Array.from(new Set(rows.flatMap(r => [r.senderCaisseId, r.recipientCaisseId])));
    const caisses = caisseIds.length
      ? await db.select().from(schema.caissesTable).where(inArray(schema.caissesTable.id, caisseIds))
      : [];
    const ownerIds = Array.from(new Set(caisses.map(c => c.ownerUserId).filter((x): x is number => !!x)));
    const userIdsAll = Array.from(new Set([
      ...rows.map(r => r.requestedByUserId),
      ...rows.map(r => r.decidedByUserId).filter((x): x is number => !!x),
      ...ownerIds,
    ]));
    const users = userIdsAll.length
      ? await db.select({ id: schema.usersTable.id, name: schema.usersTable.name, email: schema.usersTable.email })
          .from(schema.usersTable).where(inArray(schema.usersTable.id, userIdsAll))
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));
    const caisseMap = new Map(caisses.map(c => [c.id, {
      id: c.id, kind: c.kind, ownerUserId: c.ownerUserId,
      owner: c.ownerUserId ? userMap.get(c.ownerUserId) ?? null : null,
    }]));

    res.json(rows.map(r => ({
      ...r,
      senderCaisse: caisseMap.get(r.senderCaisseId) ?? null,
      recipientCaisse: caisseMap.get(r.recipientCaisseId) ?? null,
      requestedByUser: userMap.get(r.requestedByUserId) ?? null,
      decidedByUser: r.decidedByUserId ? userMap.get(r.decidedByUserId) ?? null : null,
    })));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Initiate a caisse transfer (no-hold model) ────────────────────
// Body: { recipientUserId?, recipientCaisseId?, amount, notes? }
// Provide EXACTLY ONE destination: another user's staff caisse
// (recipientUserId) OR the store's main caisse (recipientCaisseId, which
// must reference a `main` caisse in the current store). The sender is
// always the current user. NO balance change happens on create — the
// transfer is recorded as `pending` and money moves only on accept.
router.post("/erp/caisse-transfers", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = req.user!.id;
    const { recipientUserId, recipientCaisseId, senderCaisseId: senderCaisseIdRaw, amount: amountRaw, notes } = req.body || {};
    const amount = parseAmount(amountRaw);
    if (amount === null || amount <= 0) {
      res.status(400).json({ error: "Amount must be > 0" }); return;
    }
    const hasUser = recipientUserId !== undefined && recipientUserId !== null && recipientUserId !== "";
    const hasCaisse = recipientCaisseId !== undefined && recipientCaisseId !== null && recipientCaisseId !== "";
    if (hasUser === hasCaisse) {
      res.status(400).json({ error: "Provide exactly one of recipientUserId or recipientCaisseId" }); return;
    }

    // Optional: admin can send from the main caisse by specifying senderCaisseId.
    let senderCaisse: typeof schema.caissesTable.$inferSelect;
    const hasSenderOverride = senderCaisseIdRaw !== undefined && senderCaisseIdRaw !== null && senderCaisseIdRaw !== "";
    if (hasSenderOverride) {
      if (!isAdmin(req)) {
        res.status(403).json({ error: "Only admins can send from the main caisse" }); return;
      }
      const sid = Number(senderCaisseIdRaw);
      if (!Number.isInteger(sid)) {
        res.status(400).json({ error: "Invalid senderCaisseId" }); return;
      }
      const c = await loadCaisseOr404(sid);
      if (!c || c.kind !== "main") {
        res.status(400).json({ error: "senderCaisseId must reference the main caisse" }); return;
      }
      senderCaisse = c;
    } else {
      senderCaisse = await ensureCaisse(storeId, userId);
    }
    let recipientCaisse: typeof schema.caissesTable.$inferSelect;

    if (hasCaisse) {
      // Destination = main caisse (referenced by id).
      const rid = Number(recipientCaisseId);
      if (!Number.isInteger(rid)) { res.status(400).json({ error: "Invalid recipientCaisseId" }); return; }
      const c = await loadCaisseOr404(rid);
      if (!c) { res.status(404).json({ error: "Recipient caisse not found" }); return; }
      if (c.kind !== "main") { res.status(400).json({ error: "recipientCaisseId must reference the main caisse" }); return; }
      recipientCaisse = c;
    } else {
      // Destination = another user's staff caisse.
      // When sending from the main caisse the admin may designate their own
      // personal caisse as recipient (main → personal is a valid flow).
      const recipient = Number(recipientUserId);
      if (!Number.isInteger(recipient) || (!hasSenderOverride && recipient === userId)) {
        res.status(400).json({ error: "Invalid recipient" }); return;
      }
      const [recipLink] = await db.select({ uid: schema.userStoresTable.userId })
        .from(schema.userStoresTable)
        .where(and(eq(schema.userStoresTable.userId, recipient), eq(schema.userStoresTable.storeId, storeId)))
        .limit(1);
      if (!recipLink) { res.status(400).json({ error: "Recipient does not belong to this store" }); return; }
      recipientCaisse = await ensureCaisse(storeId, recipient);
    }

    if (recipientCaisse.id === senderCaisse.id) {
      res.status(400).json({ error: "Cannot transfer to your own caisse" }); return;
    }
    const amountStr = amount.toFixed(2);

    // No-hold: record a pending transfer only. No balance change, no hold
    // movement. Money is debited/credited atomically on accept.
    const [created] = await db.insert(schema.caisseTransfersTable).values({
      storeId,
      senderCaisseId: senderCaisse.id,
      recipientCaisseId: recipientCaisse.id,
      amount: amountStr,
      status: "pending",
      notes: typeof notes === "string" ? notes : null,
      requestedByUserId: userId,
    }).returning();

    const participants = [userId, recipientCaisse.ownerUserId].filter((x): x is number => typeof x === "number");
    broadcastCaisseTransferChanged(storeId, created.id, "pending", participants, {
      senderUserId: userId,
      recipientUserId: recipientCaisse.ownerUserId,
      actorUserId: userId,
    });
    res.status(201).json(created);
  } catch (err) {
    const e = err as { http?: number; message?: string };
    if (e.http === 409) { res.status(409).json({ error: e.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Accept (recipient, or any admin for the main caisse) ──────────
// No-hold model: this is the ONLY place money moves for a transfer. The
// sender is debited and the recipient credited atomically, with the
// balance check performed against locked rows at accept time.
router.post("/erp/caisse-transfers/:id/accept", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const id = pid(req, "id");
    const userId = req.user!.id;
    const [t] = await db.select().from(schema.caisseTransfersTable)
      .where(eq(schema.caisseTransfersTable.id, id)).limit(1);
    if (!t) { res.status(404).json({ error: "Transfer not found" }); return; }
    if (t.storeId !== null && (!isInCurrentStore(req, t.storeId) || !(await userHasStoreAccess(req, t.storeId)))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const [recipientCaisse] = await db.select().from(schema.caissesTable)
      .where(eq(schema.caissesTable.id, t.recipientCaisseId)).limit(1);
    if (!recipientCaisse) { res.status(404).json({ error: "Recipient caisse not found" }); return; }
    // Authorization: the recipient owner, or — for the main caisse — any
    // admin of the store.
    const canDecide = recipientCaisse.kind === "main"
      ? isAdmin(req)
      : recipientCaisse.ownerUserId === userId;
    if (!canDecide) {
      res.status(403).json({ error: "Only the recipient can accept" }); return;
    }
    if (t.status !== "pending") {
      res.status(409).json({ error: `Cannot accept from status ${t.status}` }); return;
    }

    // Legacy transfers (hold model) already debited the sender at creation.
    const wasHeld = await transferWasHeld(t.id);

    await db.transaction(async (tx) => {
      // Lock both caisses in ascending id order to avoid deadlocks when
      // opposite-direction transfers are accepted concurrently.
      const lockIds = Array.from(new Set([t.senderCaisseId, t.recipientCaisseId])).sort((a, b) => a - b);
      const lockedById = new Map<number, typeof schema.caissesTable.$inferSelect>();
      for (const cid of lockIds) {
        const [row] = await tx.select().from(schema.caissesTable)
          .where(eq(schema.caissesTable.id, cid)).for("update").limit(1);
        if (row) lockedById.set(cid, row);
      }

      const [u] = await tx.update(schema.caisseTransfersTable)
        .set({ status: "accepted", decidedByUserId: userId, decidedAt: new Date() })
        .where(and(eq(schema.caisseTransfersTable.id, t.id), eq(schema.caisseTransfersTable.status, "pending")))
        .returning();
      if (!u) throw Object.assign(new Error("Status changed by another request"), { http: 409 });

      if (!wasHeld) {
        // No-hold: debit the sender now, validating funds against the locked
        // balance (first accepted wins; later overdrawing accepts fail).
        const sender = lockedById.get(t.senderCaisseId);
        if (!sender || parseFloat(sender.balance) < parseFloat(t.amount)) {
          throw Object.assign(new Error("Sender has insufficient funds to complete this transfer"), { http: 409 });
        }
        await tx.update(schema.caissesTable)
          .set({ balance: sql`${schema.caissesTable.balance} - ${t.amount}` })
          .where(eq(schema.caissesTable.id, t.senderCaisseId));
      }
      // Credit the recipient in both models.
      await tx.update(schema.caissesTable)
        .set({ balance: sql`${schema.caissesTable.balance} + ${t.amount}` })
        .where(eq(schema.caissesTable.id, t.recipientCaisseId));

      // Ledger: a transfer_out on the sender and a transfer_in on the
      // recipient. For legacy held transfers the sender debit happened at
      // creation, so the transfer_out is logged as 0.00 to avoid double-debit.
      await tx.insert(schema.caisseMovementsTable).values([
        {
          caisseId: t.senderCaisseId, type: "debit",
          amount: wasHeld ? "0.00" : t.amount,
          reason: "transfer_out", counterpartyCaisseId: t.recipientCaisseId,
          caisseTransferId: t.id, actorUserId: userId,
          notes: wasHeld ? `Accepted (held ${t.amount} released)` : null,
        },
        {
          caisseId: t.recipientCaisseId, type: "credit", amount: t.amount,
          reason: "transfer_in", counterpartyCaisseId: t.senderCaisseId,
          caisseTransferId: t.id, actorUserId: userId, notes: null,
        },
      ]);
    });
    const senderOwnerId = await caisseOwnerId(t.senderCaisseId);
    const participants = [recipientCaisse.ownerUserId, senderOwnerId]
      .filter((x): x is number => typeof x === "number");
    await broadcastCaisseChanged(t.storeId, [t.senderCaisseId, t.recipientCaisseId]);
    broadcastCaisseTransferChanged(t.storeId, t.id, "accepted", participants, {
      senderUserId: senderOwnerId,
      recipientUserId: recipientCaisse.ownerUserId,
      actorUserId: userId,
    });
    res.json({ success: true });
  } catch (err) {
    const e = err as { http?: number; message?: string };
    if (e.http === 409) { res.status(409).json({ error: e.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Reject (recipient, or any admin for the main caisse) ──────────
// No-hold model: nothing was reserved, so rejecting changes no balance.
// Legacy held transfers are refunded to the sender for backward compat.
router.post("/erp/caisse-transfers/:id/reject", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const id = pid(req, "id");
    const userId = req.user!.id;
    const [t] = await db.select().from(schema.caisseTransfersTable)
      .where(eq(schema.caisseTransfersTable.id, id)).limit(1);
    if (!t) { res.status(404).json({ error: "Transfer not found" }); return; }
    if (t.storeId !== null && (!isInCurrentStore(req, t.storeId) || !(await userHasStoreAccess(req, t.storeId)))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const [recipientCaisse] = await db.select().from(schema.caissesTable)
      .where(eq(schema.caissesTable.id, t.recipientCaisseId)).limit(1);
    if (!recipientCaisse) { res.status(404).json({ error: "Recipient caisse not found" }); return; }
    const canDecide = recipientCaisse.kind === "main"
      ? isAdmin(req)
      : recipientCaisse.ownerUserId === userId;
    if (!canDecide) {
      res.status(403).json({ error: "Only the recipient can reject" }); return;
    }
    if (t.status !== "pending") {
      res.status(409).json({ error: `Cannot reject from status ${t.status}` }); return;
    }
    const wasHeld = await transferWasHeld(t.id);
    await db.transaction(async (tx) => {
      const [u] = await tx.update(schema.caisseTransfersTable)
        .set({ status: "rejected", decidedByUserId: userId, decidedAt: new Date() })
        .where(and(eq(schema.caisseTransfersTable.id, t.id), eq(schema.caisseTransfersTable.status, "pending")))
        .returning();
      if (!u) throw Object.assign(new Error("Status changed by another request"), { http: 409 });
      if (wasHeld) {
        // Legacy: return the previously held amount to the sender.
        await tx.update(schema.caissesTable)
          .set({ balance: sql`${schema.caissesTable.balance} + ${t.amount}` })
          .where(eq(schema.caissesTable.id, t.senderCaisseId));
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: t.senderCaisseId, type: "credit", amount: t.amount,
          reason: "transfer_refund", counterpartyCaisseId: t.recipientCaisseId,
          caisseTransferId: t.id, actorUserId: userId,
          notes: "Rejected by recipient (held amount refunded)",
        });
      }
    });
    const senderOwnerId = await caisseOwnerId(t.senderCaisseId);
    const participants = [recipientCaisse.ownerUserId, senderOwnerId]
      .filter((x): x is number => typeof x === "number");
    if (wasHeld) await broadcastCaisseChanged(t.storeId, [t.senderCaisseId]);
    broadcastCaisseTransferChanged(t.storeId, t.id, "rejected", participants, {
      senderUserId: senderOwnerId,
      recipientUserId: recipientCaisse.ownerUserId,
      actorUserId: userId,
    });
    res.json({ success: true });
  } catch (err) {
    const e = err as { http?: number; message?: string };
    if (e.http === 409) { res.status(409).json({ error: e.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Cancel (sender, only while still pending) ─────────────────────
// No-hold model: nothing was reserved, so cancelling changes no balance.
// Legacy held transfers are refunded to the sender for backward compat.
router.post("/erp/caisse-transfers/:id/cancel", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const id = pid(req, "id");
    const userId = req.user!.id;
    const [t] = await db.select().from(schema.caisseTransfersTable)
      .where(eq(schema.caisseTransfersTable.id, id)).limit(1);
    if (!t) { res.status(404).json({ error: "Transfer not found" }); return; }
    if (t.storeId !== null && (!isInCurrentStore(req, t.storeId) || !(await userHasStoreAccess(req, t.storeId)))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const [senderCaisse] = await db.select().from(schema.caissesTable)
      .where(eq(schema.caissesTable.id, t.senderCaisseId)).limit(1);
    if (!senderCaisse || senderCaisse.ownerUserId !== userId) {
      res.status(403).json({ error: "Only the sender can cancel" }); return;
    }
    if (t.status !== "pending") {
      res.status(409).json({ error: `Cannot cancel from status ${t.status}` }); return;
    }
    const wasHeld = await transferWasHeld(t.id);
    await db.transaction(async (tx) => {
      const [u] = await tx.update(schema.caisseTransfersTable)
        .set({ status: "cancelled", decidedByUserId: userId, decidedAt: new Date() })
        .where(and(eq(schema.caisseTransfersTable.id, t.id), eq(schema.caisseTransfersTable.status, "pending")))
        .returning();
      if (!u) throw Object.assign(new Error("Status changed by another request"), { http: 409 });
      if (wasHeld) {
        await tx.update(schema.caissesTable)
          .set({ balance: sql`${schema.caissesTable.balance} + ${t.amount}` })
          .where(eq(schema.caissesTable.id, t.senderCaisseId));
        await tx.insert(schema.caisseMovementsTable).values({
          caisseId: t.senderCaisseId, type: "credit", amount: t.amount,
          reason: "transfer_refund", counterpartyCaisseId: t.recipientCaisseId,
          caisseTransferId: t.id, actorUserId: userId,
          notes: "Cancelled by sender (held amount refunded)",
        });
      }
    });
    const recipientOwnerId = await caisseOwnerId(t.recipientCaisseId);
    const participants = [senderCaisse.ownerUserId, recipientOwnerId]
      .filter((x): x is number => typeof x === "number");
    if (wasHeld) await broadcastCaisseChanged(t.storeId, [t.senderCaisseId]);
    broadcastCaisseTransferChanged(t.storeId, t.id, "cancelled", participants, {
      senderUserId: senderCaisse.ownerUserId,
      recipientUserId: recipientOwnerId,
      actorUserId: userId,
    });
    res.json({ success: true });
  } catch (err) {
    const e = err as { http?: number; message?: string };
    if (e.http === 409) { res.status(409).json({ error: e.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin: deposit (caisse → main) ────────────────────────────────
// Body: { caisseId, amount, notes? } — moves money from a staff caisse
// into the store's main caisse. Admin only; caisse must be in a store
// the admin has membership in.
router.post("/erp/caisses/admin/deposit", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const caisseIdRaw = Number(req.body?.caisseId);
    const amount = parseAmount(req.body?.amount);
    if (!Number.isInteger(caisseIdRaw)) { res.status(400).json({ error: "Invalid caisseId" }); return; }
    if (amount === null || amount <= 0) { res.status(400).json({ error: "Amount must be > 0" }); return; }

    const c = await loadCaisseOr404(caisseIdRaw);
    if (!c) { res.status(404).json({ error: "Caisse not found" }); return; }
    if (c.kind !== "staff") { res.status(400).json({ error: "Source must be a staff caisse" }); return; }
    // Global caisses are org-wide: any admin (enforced by requireAdmin) may operate.
    const main = await ensureCaisse(c.storeId, null);
    const amountStr = amount.toFixed(2);
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;

    await db.transaction(async (tx) => {
      const upd = await tx.update(schema.caissesTable)
        .set({ balance: sql`${schema.caissesTable.balance} - ${amountStr}` })
        .where(and(
          eq(schema.caissesTable.id, c.id),
          sql`${schema.caissesTable.balance} >= ${amountStr}`,
        ))
        .returning();
      if (upd.length === 0) throw Object.assign(new Error("Insufficient funds in source caisse"), { http: 409 });
      await tx.update(schema.caissesTable)
        .set({ balance: sql`${schema.caissesTable.balance} + ${amountStr}` })
        .where(eq(schema.caissesTable.id, main.id));
      await tx.insert(schema.caisseMovementsTable).values([
        {
          caisseId: c.id, type: "debit", amount: amountStr,
          reason: "admin_deposit", counterpartyCaisseId: main.id,
          actorUserId: userId, notes,
        },
        {
          caisseId: main.id, type: "credit", amount: amountStr,
          reason: "admin_deposit", counterpartyCaisseId: c.id,
          actorUserId: userId, notes,
        },
      ]);
    });
    await broadcastCaisseChanged(req.currentStoreId!, [c.id, main.id]);
    res.json({ success: true });
  } catch (err) {
    const e = err as { http?: number; message?: string };
    if (e.http === 409) { res.status(409).json({ error: e.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin: withdraw (main → caisse) ───────────────────────────────
router.post("/erp/caisses/admin/withdraw", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const caisseIdRaw = Number(req.body?.caisseId);
    const amount = parseAmount(req.body?.amount);
    if (!Number.isInteger(caisseIdRaw)) { res.status(400).json({ error: "Invalid caisseId" }); return; }
    if (amount === null || amount <= 0) { res.status(400).json({ error: "Amount must be > 0" }); return; }

    const c = await loadCaisseOr404(caisseIdRaw);
    if (!c) { res.status(404).json({ error: "Caisse not found" }); return; }
    if (c.kind !== "staff") { res.status(400).json({ error: "Destination must be a staff caisse" }); return; }
    // Global caisses are org-wide: any admin (enforced by requireAdmin) may operate.
    const main = await ensureCaisse(c.storeId, null);
    const amountStr = amount.toFixed(2);
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;

    await db.transaction(async (tx) => {
      const upd = await tx.update(schema.caissesTable)
        .set({ balance: sql`${schema.caissesTable.balance} - ${amountStr}` })
        .where(and(
          eq(schema.caissesTable.id, main.id),
          sql`${schema.caissesTable.balance} >= ${amountStr}`,
        ))
        .returning();
      if (upd.length === 0) throw Object.assign(new Error("Insufficient funds in main caisse"), { http: 409 });
      await tx.update(schema.caissesTable)
        .set({ balance: sql`${schema.caissesTable.balance} + ${amountStr}` })
        .where(eq(schema.caissesTable.id, c.id));
      await tx.insert(schema.caisseMovementsTable).values([
        {
          caisseId: main.id, type: "debit", amount: amountStr,
          reason: "admin_withdraw", counterpartyCaisseId: c.id,
          actorUserId: userId, notes,
        },
        {
          caisseId: c.id, type: "credit", amount: amountStr,
          reason: "admin_withdraw", counterpartyCaisseId: main.id,
          actorUserId: userId, notes,
        },
      ]);
    });
    await broadcastCaisseChanged(req.currentStoreId!, [c.id, main.id]);
    res.json({ success: true });
  } catch (err) {
    const e = err as { http?: number; message?: string };
    if (e.http === 409) { res.status(409).json({ error: e.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin: adjustment (signed delta with mandatory reason) ────────
router.post("/erp/caisses/admin/adjust", authenticate, requireAdmin, requireStore, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const caisseIdRaw = Number(req.body?.caisseId);
    const delta = parseAmount(req.body?.delta);
    const reason = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
    if (!Number.isInteger(caisseIdRaw)) { res.status(400).json({ error: "Invalid caisseId" }); return; }
    if (delta === null || delta === 0) { res.status(400).json({ error: "Delta must be non-zero" }); return; }
    if (!reason) { res.status(400).json({ error: "Notes/reason required for adjustment" }); return; }

    const c = await loadCaisseOr404(caisseIdRaw);
    if (!c) { res.status(404).json({ error: "Caisse not found" }); return; }
    // Global caisses are org-wide: any admin (enforced by requireAdmin) may operate.
    const absStr = Math.abs(delta).toFixed(2);
    const isCredit = delta > 0;

    await db.transaction(async (tx) => {
      if (isCredit) {
        await tx.update(schema.caissesTable)
          .set({ balance: sql`${schema.caissesTable.balance} + ${absStr}` })
          .where(eq(schema.caissesTable.id, c.id));
      } else {
        const upd = await tx.update(schema.caissesTable)
          .set({ balance: sql`${schema.caissesTable.balance} - ${absStr}` })
          .where(and(
            eq(schema.caissesTable.id, c.id),
            sql`${schema.caissesTable.balance} >= ${absStr}`,
          ))
          .returning();
        if (upd.length === 0) throw Object.assign(new Error("Insufficient funds for negative adjustment"), { http: 409 });
      }
      await tx.insert(schema.caisseMovementsTable).values({
        caisseId: c.id,
        type: isCredit ? "credit" : "debit",
        amount: absStr,
        reason: "adjustment",
        actorUserId: userId,
        notes: reason,
      });
    });
    await broadcastCaisseChanged(req.currentStoreId!, [c.id]);
    res.json({ success: true });
  } catch (err) {
    const e = err as { http?: number; message?: string };
    if (e.http === 409) { res.status(409).json({ error: e.message }); return; }
    req.log.error(err); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Caisse Sessions (Z-Report) ────────────────────────────────────

/** Build movement summary aggregate for a caisse since a given start time. */
async function computeSessionMovementSummary(caisseId: number, since: Date, until?: Date) {
  const m = schema.caisseMovementsTable;
  const conditions = until
    ? and(eq(m.caisseId, caisseId), gte(m.createdAt, since), lt(m.createdAt, until))
    : and(eq(m.caisseId, caisseId), gte(m.createdAt, since));
  const [row] = await db.select({
    totalSales: sql<string>`coalesce(sum(case when ${m.reason} = 'sale' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
    transfersIn: sql<string>`coalesce(sum(case when ${m.reason} = 'transfer_in' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
    transfersOut: sql<string>`coalesce(sum(case when ${m.reason} = 'transfer_out' and ${m.type} = 'debit' then ${m.amount} else 0 end), 0)`,
    transfersHeld: sql<string>`coalesce(sum(case when ${m.reason} = 'transfer_hold' and ${m.type} = 'debit' then ${m.amount} else 0 end), 0)`,
    transfersRefunded: sql<string>`coalesce(sum(case when ${m.reason} = 'transfer_refund' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
    adminDeposits: sql<string>`coalesce(sum(case when ${m.reason} = 'admin_deposit' and ${m.type} = 'debit' then ${m.amount} else 0 end), 0)`,
    adminWithdrawals: sql<string>`coalesce(sum(case when ${m.reason} = 'admin_withdraw' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
    adjustmentsCredit: sql<string>`coalesce(sum(case when ${m.reason} = 'adjustment' and ${m.type} = 'credit' then ${m.amount} else 0 end), 0)`,
    adjustmentsDebit: sql<string>`coalesce(sum(case when ${m.reason} = 'adjustment' and ${m.type} = 'debit' then ${m.amount} else 0 end), 0)`,
    netMovement: sql<string>`coalesce(sum(case when ${m.type} = 'credit' then ${m.amount} else -${m.amount} end), 0)`,
    movementCount: sql<number>`coalesce(count(${m.id}), 0)::int`,
  })
    .from(m)
    .where(conditions!);
  return row ?? {
    totalSales: "0", transfersIn: "0", transfersOut: "0", transfersHeld: "0",
    transfersRefunded: "0", adminDeposits: "0", adminWithdrawals: "0",
    adjustmentsCredit: "0", adjustmentsDebit: "0", netMovement: "0", movementCount: 0,
  };
}

async function enrichSessions(sessions: (typeof schema.caisseSessionsTable.$inferSelect)[]) {
  const userIds = Array.from(new Set([
    ...sessions.map(s => s.openedByUserId),
    ...sessions.map(s => s.closedByUserId).filter((x): x is number => x !== null),
  ]));
  const users = userIds.length
    ? await db.select({ id: schema.usersTable.id, name: schema.usersTable.name, email: schema.usersTable.email, role: schema.usersTable.role })
        .from(schema.usersTable).where(inArray(schema.usersTable.id, userIds))
    : [];
  const userMap = new Map(users.map(u => [u.id, u]));

  return Promise.all(sessions.map(async (s) => {
    const movementSummary = await computeSessionMovementSummary(
      s.caisseId,
      s.openedAt,
      s.closedAt ?? undefined,
    );
    return {
      ...s,
      openedByUser: userMap.get(s.openedByUserId) ?? null,
      closedByUser: s.closedByUserId ? (userMap.get(s.closedByUserId) ?? null) : null,
      movementSummary,
    };
  }));
}

// GET /erp/caisses/:id/sessions
router.get("/erp/caisses/:id/sessions", authenticate, requireStaff, requireStore, requirePermission("caisse", "view"), async (req: AuthRequest, res) => {
  try {
    const caisseId = pid(req, "id");
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "30")) || 30));
    const caisse = await loadCaisseOr404(caisseId);
    if (!caisse) { res.status(404).json({ error: "Caisse not found" }); return; }
    if (!(await canSeeCaisse(req, caisse))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const sessions = await db.select()
      .from(schema.caisseSessionsTable)
      .where(eq(schema.caisseSessionsTable.caisseId, caisseId))
      .orderBy(desc(schema.caisseSessionsTable.openedAt))
      .limit(limit);
    res.json(await enrichSessions(sessions));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/caisses/:id/open-session
router.post("/erp/caisses/:id/open-session", authenticate, requireStaff, requireStore, requirePermission("caisse", "create"), async (req: AuthRequest, res) => {
  try {
    const caisseId = pid(req, "id");
    const userId = req.user!.id;
    const openingBalance = parseAmount(req.body?.openingBalance);
    if (openingBalance === null || openingBalance < 0) {
      res.status(400).json({ error: "openingBalance must be >= 0" }); return;
    }
    const caisse = await loadCaisseOr404(caisseId);
    if (!caisse) { res.status(404).json({ error: "Caisse not found" }); return; }
    if (!(await canSeeCaisse(req, caisse))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    // Guard: no active session
    const [existing] = await db.select({ id: schema.caisseSessionsTable.id })
      .from(schema.caisseSessionsTable)
      .where(and(
        eq(schema.caisseSessionsTable.caisseId, caisseId),
        eq(schema.caisseSessionsTable.status, "open"),
      ))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "This caisse already has an open session", sessionId: existing.id });
      return;
    }
    const notes = typeof req.body?.notes === "string" && req.body.notes.trim() ? req.body.notes.trim() : null;
    const [session] = await db.insert(schema.caisseSessionsTable).values({
      caisseId,
      storeId: caisse.storeId ?? req.currentStoreId!,
      openingBalance: openingBalance.toFixed(2),
      openedByUserId: userId,
      notes,
    }).returning();
    res.status(201).json(session);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// POST /erp/caisses/:id/close-session
router.post("/erp/caisses/:id/close-session", authenticate, requireStaff, requireStore, requirePermission("caisse", "edit"), async (req: AuthRequest, res) => {
  try {
    const caisseId = pid(req, "id");
    const userId = req.user!.id;
    const actualClosingBalance = parseAmount(req.body?.actualClosingBalance);
    if (actualClosingBalance === null || actualClosingBalance < 0) {
      res.status(400).json({ error: "actualClosingBalance must be >= 0" }); return;
    }
    const caisse = await loadCaisseOr404(caisseId);
    if (!caisse) { res.status(404).json({ error: "Caisse not found" }); return; }
    if (!(await canSeeCaisse(req, caisse))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    // Find open session
    const [session] = await db.select()
      .from(schema.caisseSessionsTable)
      .where(and(
        eq(schema.caisseSessionsTable.caisseId, caisseId),
        eq(schema.caisseSessionsTable.status, "open"),
      ))
      .limit(1);
    if (!session) {
      res.status(404).json({ error: "No open session found for this caisse" }); return;
    }
    const closedAt = new Date();
    // Compute theoretical closing balance from movements since session open
    const summary = await computeSessionMovementSummary(caisseId, session.openedAt, closedAt);
    const theoretical = parseFloat(session.openingBalance) + parseFloat(summary.netMovement);
    const ecart = actualClosingBalance - theoretical;
    const notes = typeof req.body?.notes === "string" && req.body.notes.trim() ? req.body.notes.trim() : null;
    const [closed] = await db.update(schema.caisseSessionsTable)
      .set({
        status: "closed",
        closedAt,
        theoreticalClosingBalance: theoretical.toFixed(2),
        actualClosingBalance: actualClosingBalance.toFixed(2),
        ecart: ecart.toFixed(2),
        closedByUserId: userId,
        notes: notes ?? session.notes,
      })
      .where(and(
        eq(schema.caisseSessionsTable.id, session.id),
        eq(schema.caisseSessionsTable.status, "open"),
      ))
      .returning();
    if (!closed) {
      res.status(409).json({ error: "Session was closed by another request" }); return;
    }
    const [enriched] = await enrichSessions([closed]);
    res.json(enriched);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Staff-accessible recipient list (current store) ───────────────
// Lists candidate recipients (other staff/admins) for a transfer in the
// current store. Accessible to all staff so non-admin employees can pick
// a colleague — does NOT expose the full /erp/staff admin endpoint.
router.get("/erp/caisse-transfer-recipients", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = req.user!.id;
    const rows = await db.select({
      id: schema.usersTable.id,
      name: schema.usersTable.name,
      email: schema.usersTable.email,
      role: schema.usersTable.role,
    })
      .from(schema.usersTable)
      .innerJoin(schema.userStoresTable, eq(schema.userStoresTable.userId, schema.usersTable.id))
      .where(and(
        eq(schema.userStoresTable.storeId, storeId),
        inArray(schema.usersTable.role, ["admin", "employee"]),
      ))
      .orderBy(schema.usersTable.name);
    const includeMe = req.query.includeMe === "true" && isAdmin(req);
    res.json(includeMe ? rows : rows.filter(r => r.id !== userId));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

// ─── Personal account summary (Mon Compte) ─────────────────────────
// Available to ANY staff in the current store (no orders permission
// required). Returns the user's identity, store, own caisse balance, and
// the main caisse id (so they can target it for a transfer) — WITHOUT
// exposing the main caisse balance to non-admin employees.
router.get("/erp/account/me", authenticate, requireStaff, requireStore, async (req: AuthRequest, res) => {
  try {
    const storeId = req.currentStoreId!;
    const userId = req.user!.id;
    const [u] = await db.select({
      id: schema.usersTable.id,
      name: schema.usersTable.name,
      email: schema.usersTable.email,
      role: schema.usersTable.role,
    }).from(schema.usersTable).where(eq(schema.usersTable.id, userId)).limit(1);
    const [store] = await db.select({
      id: schema.storesTable.id,
      nameEn: schema.storesTable.nameEn,
      nameAr: schema.storesTable.nameAr,
    }).from(schema.storesTable).where(eq(schema.storesTable.id, storeId)).limit(1);
    const myCaisse = await ensureCaisse(storeId, userId);
    const mainCaisse = await ensureCaisse(storeId, null);
    const owner = u ? { id: u.id, name: u.name, email: u.email } : null;
    res.json({
      user: u ?? { id: userId, name: null, email: req.user!.email, role: req.user!.role },
      store: store ?? { id: storeId, nameEn: "", nameAr: "" },
      caisse: { ...myCaisse, owner },
      mainCaisseId: mainCaisse.id,
    });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

export default router;

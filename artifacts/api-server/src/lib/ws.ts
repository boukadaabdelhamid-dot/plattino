import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { verifyToken } from "./auth";
import { db, schema } from "./db";
import { eq, inArray } from "drizzle-orm";

interface WsClient {
  ws: WebSocket;
  userId: number;
  role: string;
  storeIds: Set<number>;
}

let clients: WsClient[] = [];

const isAdmin = (c: WsClient) => c.role === "admin";

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(1008, "Missing token");
      return;
    }

    let user: { id: number; email: string; role: string };
    try {
      user = verifyToken(token);
    } catch {
      ws.close(1008, "Invalid token");
      return;
    }

    if (user.role !== "admin" && user.role !== "employee") {
      ws.close(1008, "Staff only");
      return;
    }

    let storeIds = new Set<number>();
    try {
      const rows = await db.select({ storeId: schema.userStoresTable.storeId })
        .from(schema.userStoresTable)
        .where(eq(schema.userStoresTable.userId, user.id));
      storeIds = new Set(rows.map((r) => r.storeId));
    } catch {
      // ignore
    }

    clients.push({ ws, userId: user.id, role: user.role, storeIds });

    ws.on("close", () => {
      clients = clients.filter((c) => c.ws !== ws);
    });

    ws.send(JSON.stringify({ type: "connected", message: "Connected to Midanic WS" }));
  });

  return wss;
}

function activeClients(): WsClient[] {
  clients = clients.filter((c) => c.ws.readyState === WebSocket.OPEN);
  return clients;
}

/**
 * Broadcast to admin clients only, scoped by store.
 */
export function broadcastToAdmins(data: Record<string, unknown>) {
  const payload = JSON.stringify(data);
  const rawIds = data["storeIds"];
  const rawId = data["storeId"];
  const targetStoreIds: number[] | null = Array.isArray(rawIds)
    ? (rawIds as number[])
    : (typeof rawId === "number" ? [rawId] : null);
  for (const c of activeClients()) {
    if (!isAdmin(c)) continue;
    if (targetStoreIds && !targetStoreIds.some((id) => c.storeIds.has(id))) continue;
    c.ws.send(payload);
  }
}

/**
 * Broadcast to ALL connected clients (admins + staff) that have access
 * to the given store. Used for caisse events so staff recipients get
 * realtime inbox/balance updates.
 */
export function broadcastToStoreUsers(
  storeId: number,
  data: Record<string, unknown>,
  extraUserIds: number[] = [],
) {
  const payload = JSON.stringify(data);
  const extra = new Set(extraUserIds);
  for (const c of activeClients()) {
    const inStore = c.storeIds.has(storeId);
    if (!inStore && !extra.has(c.userId)) continue;
    c.ws.send(payload);
  }
}

/**
 * Broadcast to staff (admins + employees) that have access to ANY of the
 * given stores. Each matching client receives the payload exactly once,
 * even if they belong to multiple of the listed stores.
 */
export function broadcastToStaffByStores(storeIds: number[], data: Record<string, unknown>) {
  if (storeIds.length === 0) return;
  const payload = JSON.stringify(data);
  const targets = new Set(storeIds);
  for (const c of activeClients()) {
    let match = false;
    for (const id of c.storeIds) {
      if (targets.has(id)) { match = true; break; }
    }
    if (!match) continue;
    c.ws.send(payload);
  }
}

/**
 * Direct delivery to specific user ids regardless of store membership.
 */
export function broadcastToUsers(userIds: number[], data: Record<string, unknown>) {
  if (userIds.length === 0) return;
  const payload = JSON.stringify(data);
  const set = new Set(userIds);
  for (const c of activeClients()) {
    if (!set.has(c.userId)) continue;
    c.ws.send(payload);
  }
}

/**
 * Notify clients that one or more caisse balances changed. Caisses are global
 * (store-agnostic); `storeId` is only the operation's context so store-scoped
 * dashboards still refresh. Recipients are:
 *   (a) all staff/admins of the operation's store context, plus
 *   (b) the owners of the affected caisses — so a staff member sees their own
 *       global balance update live even when acting from another store, plus
 *   (c) any extra user ids supplied by the caller.
 */
export async function broadcastCaisseChanged(
  storeId: number | null,
  caisseIds: number[],
  extraUserIds: number[] = [],
) {
  const owners = caisseIds.length
    ? await db
        .select({ ownerUserId: schema.caissesTable.ownerUserId })
        .from(schema.caissesTable)
        .where(inArray(schema.caissesTable.id, caisseIds))
    : [];
  const ownerIds = owners
    .map((o) => o.ownerUserId)
    .filter((x): x is number => typeof x === "number");
  const recipients = Array.from(new Set([...ownerIds, ...extraUserIds]));
  const payload = { type: "caisse_changed", storeId, caisseIds };
  if (storeId !== null) {
    broadcastToStoreUsers(storeId, payload, recipients);
  } else if (recipients.length) {
    broadcastToUsers(recipients, payload);
  }
}

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useMe } from "@/hooks/use-me";
import { useStoreContext } from "@/hooks/use-store";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/hooks/use-lang";
import { playNewOrderChime } from "@/lib/chime";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

function buildWsUrl(token: string): string {
  let base = API_BASE;
  if (!base) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    base = `${proto}//${window.location.host}`;
  } else {
    base = base.replace(/^http/, "ws");
  }
  return `${base.replace(/\/$/, "")}/ws?token=${encodeURIComponent(token)}`;
}

type TransferEvent = {
  type: "stock_transfer_changed";
  transferId: number;
  status: string;
  sourceStoreId: number;
  destinationStoreId: number;
};

type CaisseTransferEvent = {
  type: "caisse_transfer_changed";
  transferId: number;
  status: string;
  senderUserId: number | null;
  recipientUserId: number | null;
  actorUserId: number | null;
};

type TFn = (fr: string, ar: string) => string;

// Returns a toast for the current user, or null. We never toast the person
// who performed the action (actorUserId === me). A pending transfer notifies
// the recipient (a named user, or any admin for the main caisse). An
// accepted/rejected/cancelled outcome notifies the original sender.
function caisseTransferToast(
  msg: CaisseTransferEvent,
  myId: number | string | null,
  isAdmin: boolean,
  t: TFn,
): { title: string; description?: string; variant?: "default" | "destructive" } | null {
  const me = myId == null ? null : Number(myId);
  if (me !== null && msg.actorUserId === me) return null;
  const id = `#${msg.transferId}`;
  const iAmRecipient =
    (me !== null && msg.recipientUserId === me)
    || (msg.recipientUserId === null && isAdmin);
  const iAmSender = me !== null && msg.senderUserId === me;
  switch (msg.status) {
    case "pending":
      if (iAmRecipient) {
        return { title: t(`Nouveau virement reçu ${id}`, `حوالة جديدة واردة ${id}`) };
      }
      return null;
    case "accepted":
      if (iAmSender) {
        return { title: t(`Virement ${id} accepté`, `تم قبول الحوالة ${id}`) };
      }
      return null;
    case "rejected":
      if (iAmSender) {
        return {
          title: t(`Virement ${id} refusé`, `تم رفض الحوالة ${id}`),
          variant: "destructive",
        };
      }
      return null;
    case "cancelled":
      if (iAmRecipient) {
        return {
          title: t(`Virement ${id} annulé`, `تم إلغاء الحوالة ${id}`),
          variant: "destructive",
        };
      }
      return null;
    default:
      return null;
  }
}

function transferToast(
  msg: TransferEvent,
  currentStoreId: number | null,
  t: TFn,
): { title: string; description?: string; variant?: "default" | "destructive" } | null {
  const onSource = currentStoreId === msg.sourceStoreId;
  const onDestination = currentStoreId === msg.destinationStoreId;
  const id = `#${msg.transferId}`;
  switch (msg.status) {
    case "requested":
      if (onDestination) {
        return { title: t(`Nouvelle demande de transfert ${id}`, `طلب تحويل جديد ${id}`) };
      }
      return null;
    case "approved":
      if (onSource) {
        return { title: t(`Transfert ${id} approuvé`, `تمت الموافقة على التحويل ${id}`) };
      }
      return null;
    case "rejected":
      if (onSource) {
        return {
          title: t(`Transfert ${id} refusé`, `تم رفض التحويل ${id}`),
          variant: "destructive",
        };
      }
      return null;
    case "prepared":
      if (onDestination) {
        return { title: t(`Transfert ${id} préparé`, `تم تحضير التحويل ${id}`) };
      }
      return null;
    case "in_transit":
      if (onDestination) {
        return { title: t(`Transfert ${id} expédié — en cours`, `تم شحن التحويل ${id} — وارد`) };
      }
      return null;
    case "received":
      if (onSource) {
        return { title: t(`Transfert ${id} reçu par destination`, `تم استلام التحويل ${id} من الوجهة`) };
      }
      if (onDestination) {
        return { title: t(`Transfert ${id} reçu`, `تم استلام التحويل ${id}`) };
      }
      return null;
    case "cancelled":
      return {
        title: t(`Transfert ${id} annulé`, `تم إلغاء التحويل ${id}`),
        variant: "destructive",
      };
    default:
      return null;
  }
}

export function useRealtimeWS(): void {
  const { token } = useAuth();
  const { user, isAdmin } = useMe();
  const { currentStoreId } = useStoreContext();
  const { toast } = useToast();
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);
  // Latest currentStoreId/toast available to ws handler without
  // forcing a reconnect each time the selected store changes.
  const storeIdRef = useRef<number | null>(currentStoreId);
  const toastRef = useRef(toast);
  const userIdRef = useRef<number | string | null>((user as { id?: number | string } | null)?.id ?? null);
  const isAdminRef = useRef<boolean>(isAdmin);
  useEffect(() => { storeIdRef.current = currentStoreId; }, [currentStoreId]);
  useEffect(() => { toastRef.current = toast; }, [toast]);
  useEffect(() => { userIdRef.current = (user as { id?: number | string } | null)?.id ?? null; }, [user]);
  useEffect(() => { isAdminRef.current = isAdmin; }, [isAdmin]);

  useEffect(() => {
    if (!token || !user) return;
    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;
      const ws = new WebSocket(buildWsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => { retryRef.current = 0; };

      ws.onmessage = (ev) => {
        let msg: { type?: string } & Record<string, unknown>;
        try { msg = JSON.parse(ev.data); } catch { return; }

        // Generated query keys are URL-prefixed with "/api/...". We invalidate
        // by prefix-matching so both list (with params) and detail
        // (with :id) caches refresh.
        const invalidatePrefix = (prefix: string) =>
          qc.invalidateQueries({
            predicate: (q) =>
              Array.isArray(q.queryKey)
              && typeof q.queryKey[0] === "string"
              && (q.queryKey[0] as string).startsWith(prefix),
          });

        switch (msg.type) {
          case "stock_transfer_changed": {
            invalidatePrefix("/api/erp/transfers");
            // A transfer moves stock between two stores — refresh product views.
            invalidatePrefix("/api/erp/products");
            const t = transferToast(msg as unknown as TransferEvent, storeIdRef.current, (fr, ar) => lang === "ar" ? ar : fr);
            if (t) toastRef.current(t);
            break;
          }
          case "new_order": {
            // Generated query keys for the admin orders list/detail are
            // rooted at "/api/admin/orders"; the legacy "/api/erp/orders"
            // prefix is kept for any other in-app caches keyed that way.
            invalidatePrefix("/api/admin/orders");
            invalidatePrefix("/api/erp/orders");
            // A sale decrements stock — keep product/inventory views fresh.
            invalidatePrefix("/api/erp/products");
            // Online (storefront) orders have no seller. Pop a toast for
            // staff of the current store so the inbox is acted on quickly.
            const sellerId = (msg as { sellerUserId?: number | null }).sellerUserId ?? null;
            const evtStoreId = (msg as { storeId?: number }).storeId;
            if (sellerId === null && evtStoreId === storeIdRef.current) {
              toastRef.current({ title: "طلب جديد من المتجر", description: "Nouvelle commande en ligne reçue" });
              playNewOrderChime(userIdRef.current);
            }
            break;
          }
          case "order_status_changed":
            invalidatePrefix("/api/admin/orders");
            invalidatePrefix("/api/erp/orders");
            break;
          case "low_stock":
          case "inventory_changed":
            invalidatePrefix("/api/erp/products");
            invalidatePrefix("/api/erp/inventory");
            break;
          case "purchase_received":
            // Receiving a PO increments stock — refresh product/inventory/PO views.
            invalidatePrefix("/api/erp/products");
            invalidatePrefix("/api/erp/inventory");
            invalidatePrefix("/api/erp/purchase-orders");
            break;
          case "caisse_changed":
            invalidatePrefix("/api/erp/caisses");
            invalidatePrefix("/api/erp/account");
            invalidatePrefix("/api/erp/dashboard");
            break;
          case "caisse_transfer_changed": {
            invalidatePrefix("/api/erp/caisse-transfers");
            invalidatePrefix("/api/erp/caisses");
            invalidatePrefix("/api/erp/account");
            const ct = caisseTransferToast(
              msg as unknown as CaisseTransferEvent,
              userIdRef.current,
              isAdminRef.current,
              (fr, ar) => lang === "ar" ? ar : fr,
            );
            if (ct) toastRef.current(ct);
            break;
          }
          default:
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closedRef.current) return;
        const delay = Math.min(30_000, 1000 * 2 ** retryRef.current);
        retryRef.current += 1;
        setTimeout(connect, delay);
      };

      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    connect();

    return () => {
      closedRef.current = true;
      try { wsRef.current?.close(); } catch { /* noop */ }
      wsRef.current = null;
    };
  }, [token, user, qc]);
}

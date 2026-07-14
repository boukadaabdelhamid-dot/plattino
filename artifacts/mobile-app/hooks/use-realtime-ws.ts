import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useMe } from "@/hooks/use-me";
import { useStoreContext } from "@/contexts/store-context";
import { useToast } from "@/contexts/toast-context";
import { useLang } from "@/contexts/lang-context";
import { buildWsUrl } from "@/lib/api";

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
    (me !== null && msg.recipientUserId === me) || (msg.recipientUserId === null && isAdmin);
  const iAmSender = me !== null && msg.senderUserId === me;
  switch (msg.status) {
    case "pending":
      if (iAmRecipient) return { title: t(`Nouveau virement reçu ${id}`, `حوالة جديدة واردة ${id}`) };
      return null;
    case "accepted":
      if (iAmSender) return { title: t(`Virement ${id} accepté`, `تم قبول الحوالة ${id}`) };
      return null;
    case "rejected":
      if (iAmSender) {
        return { title: t(`Virement ${id} refusé`, `تم رفض الحوالة ${id}`), variant: "destructive" };
      }
      return null;
    case "cancelled":
      if (iAmRecipient) {
        return { title: t(`Virement ${id} annulé`, `تم إلغاء الحوالة ${id}`), variant: "destructive" };
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
      if (onDestination) return { title: t(`Nouvelle demande de transfert ${id}`, `طلب تحويل جديد ${id}`) };
      return null;
    case "approved":
      if (onSource) return { title: t(`Transfert ${id} approuvé`, `تمت الموافقة على التحويل ${id}`) };
      return null;
    case "rejected":
      if (onSource) {
        return { title: t(`Transfert ${id} refusé`, `تم رفض التحويل ${id}`), variant: "destructive" };
      }
      return null;
    case "prepared":
      if (onDestination) return { title: t(`Transfert ${id} préparé`, `تم تحضير التحويل ${id}`) };
      return null;
    case "in_transit":
      if (onDestination) {
        return { title: t(`Transfert ${id} expédié — en cours`, `تم شحن التحويل ${id} — وارد`) };
      }
      return null;
    case "received":
      if (onSource) return { title: t(`Transfert ${id} reçu par destination`, `تم استلام التحويل ${id} من الوجهة`) };
      if (onDestination) return { title: t(`Transfert ${id} reçu`, `تم استلام التحويل ${id}`) };
      return null;
    case "cancelled":
      return { title: t(`Transfert ${id} annulé`, `تم إلغاء التحويل ${id}`), variant: "destructive" };
    default:
      return null;
  }
}

/** Single WS connection scoped to the whole app — keeps caches fresh in real time. */
export function useRealtimeWS(): void {
  const { token } = useAuth();
  const { user, isAdmin } = useMe();
  const { currentStoreId } = useStoreContext();
  const { toast } = useToast();
  const { lang } = useLang();
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);
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

        const invalidatePrefix = (prefix: string) =>
          qc.invalidateQueries({
            predicate: (q) =>
              Array.isArray(q.queryKey) &&
              typeof q.queryKey[0] === "string" &&
              (q.queryKey[0] as string).startsWith(prefix),
          });

        switch (msg.type) {
          case "stock_transfer_changed": {
            invalidatePrefix("/api/erp/transfers");
            invalidatePrefix("/api/erp/products");
            const tst = transferToast(msg as unknown as TransferEvent, storeIdRef.current, (fr, ar) => (lang === "ar" ? ar : fr));
            if (tst) toastRef.current(tst);
            break;
          }
          case "new_order": {
            invalidatePrefix("/api/admin/orders");
            invalidatePrefix("/api/erp/orders");
            invalidatePrefix("/api/erp/products");
            const sellerId = (msg as { sellerUserId?: number | null }).sellerUserId ?? null;
            const evtStoreId = (msg as { storeId?: number }).storeId;
            if (sellerId === null && evtStoreId === storeIdRef.current) {
              toastRef.current({ title: "طلب جديد من المتجر", description: "Nouvelle commande en ligne reçue" });
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
            invalidatePrefix("/api/erp/products");
            invalidatePrefix("/api/erp/inventory");
            qc.invalidateQueries({ queryKey: ["/api/erp/purchase-orders"] });
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
              (fr, ar) => (lang === "ar" ? ar : fr),
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

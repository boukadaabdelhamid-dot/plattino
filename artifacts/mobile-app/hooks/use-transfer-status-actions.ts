/**
 * Shared stock-transfer lifecycle rules, mirroring the backend state machine
 * in `transfers.ts`:
 *   requested  -> approved | rejected   (destination store acts)
 *              -> cancelled              (source store acts)
 *   approved   -> prepared | cancelled   (source store acts)
 *   prepared   -> in_transit (ship)      (source store acts)
 *              -> cancelled              (source store acts, admin only)
 *   in_transit -> received               (destination store acts)
 *   received / rejected / cancelled are terminal.
 */
export type TransferStatusValue =
  | "requested"
  | "approved"
  | "rejected"
  | "prepared"
  | "in_transit"
  | "received"
  | "cancelled";

export type TransferAction = "approve" | "reject" | "prepare" | "ship" | "receive" | "cancel";

export type TransferStatusAction = {
  action: TransferAction;
  label: string;
  labelAr: string;
  destructive?: boolean;
};

export function getTransferActions(
  status: string,
  ctx: { isSource: boolean; isDestination: boolean; isAdmin: boolean },
): TransferStatusAction[] {
  const actions: TransferStatusAction[] = [];
  switch (status as TransferStatusValue) {
    case "requested":
      if (ctx.isDestination) {
        actions.push({ action: "approve", label: "Approuver", labelAr: "الموافقة" });
        actions.push({ action: "reject", label: "Rejeter", labelAr: "رفض", destructive: true });
      }
      if (ctx.isSource) {
        actions.push({ action: "cancel", label: "Annuler", labelAr: "إلغاء", destructive: true });
      }
      break;
    case "approved":
      if (ctx.isSource) {
        actions.push({ action: "prepare", label: "Marquer comme préparé", labelAr: "وضع علامة تم التحضير" });
        actions.push({ action: "cancel", label: "Annuler", labelAr: "إلغاء", destructive: true });
      }
      break;
    case "prepared":
      if (ctx.isSource) {
        actions.push({ action: "ship", label: "Expédier", labelAr: "شحن" });
        if (ctx.isAdmin) {
          actions.push({ action: "cancel", label: "Annuler", labelAr: "إلغاء", destructive: true });
        }
      }
      break;
    case "in_transit":
      if (ctx.isDestination) {
        actions.push({ action: "receive", label: "Confirmer la réception", labelAr: "تأكيد الاستلام" });
      }
      break;
    default:
      break;
  }
  return actions;
}

export const TRANSFER_STATUS_LABELS: Record<string, { fr: string; ar: string }> = {
  requested: { fr: "Demandé", ar: "مطلوب" },
  approved: { fr: "Approuvé", ar: "معتمد" },
  rejected: { fr: "Rejeté", ar: "مرفوض" },
  prepared: { fr: "Préparé", ar: "محضّر" },
  in_transit: { fr: "En transit", ar: "قيد النقل" },
  received: { fr: "Reçu", ar: "مستلم" },
  cancelled: { fr: "Annulé", ar: "ملغى" },
};

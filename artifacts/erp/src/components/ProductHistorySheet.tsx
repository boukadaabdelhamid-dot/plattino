import React, { useMemo } from "react";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShoppingCart, ShoppingBag, TrendingDown, TrendingUp,
  AlertCircle, Package2, ArrowLeftRight, RotateCcw,
} from "lucide-react";
import { useLang } from "@/hooks/use-lang";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useGetProductHistory,
  type ProductHistoryPurchase,
  type ProductHistorySale,
  type ProductHistoryMovementEntry,
  type ProductHistoryTransferEntry,
  type ProductHistoryReturn,
  type ProductHistorySupplierReturn,
} from "@workspace/api-client-react";
import type { Product } from "@workspace/api-client-react";

// ── helpers ───────────────────────────────────────────────────────────────────

const fmtAmt = (n: number) =>
  n.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-DZ", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
};

const MOVE_LABELS: Record<string, { fr: string; ar: string; color: string }> = {
  in:           { fr: "Entrée",            ar: "دخول",           color: "bg-green-100 text-green-700" },
  out:          { fr: "Sortie",            ar: "خروج",           color: "bg-red-100 text-red-700" },
  adjustment:   { fr: "Ajustement",        ar: "تعديل",          color: "bg-blue-100 text-blue-700" },
  sale:         { fr: "Vente",             ar: "بيع",            color: "bg-orange-100 text-orange-700" },
  purchase:     { fr: "Achat",             ar: "شراء",           color: "bg-emerald-100 text-emerald-700" },
  transfer_in:  { fr: "Transfert entrant", ar: "تحويل وارد",     color: "bg-sky-100 text-sky-700" },
  transfer_out: { fr: "Transfert sortant", ar: "تحويل صادر",     color: "bg-violet-100 text-violet-700" },
  return:       { fr: "Retour",            ar: "إرجاع",          color: "bg-amber-100 text-amber-700" },
};

const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-yellow-100 text-yellow-700",
  received:  "bg-green-100  text-green-700",
  cancelled: "bg-red-100    text-red-700",
  completed: "bg-green-100  text-green-700",
  delivered: "bg-green-100  text-green-700",
  requested: "bg-blue-100   text-blue-700",
  shipped:   "bg-sky-100    text-sky-700",
};

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full ${color}`}>
      {text}
    </span>
  );
}

// ── row components ─────────────────────────────────────────────────────────────

function PurchaseRow({ p, lang, canViewPurchasePrice }: { p: ProductHistoryPurchase; lang: string; canViewPurchasePrice: boolean }) {
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const storeName = lang === "ar" ? (p.storeNameAr ?? p.storeNameEn) : (p.storeNameEn ?? p.storeNameAr);
  const statusLabel = p.status === "received" ? t("Reçu", "مستلم") : t("En attente", "معلق");
  const statusColor = STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600";
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
        <ShoppingCart className="h-3.5 w-3.5 text-emerald-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-sm">{t("Bon", "بون")} #{p.purchaseOrderId}</span>
          <Chip text={statusLabel} color={statusColor} />
          {storeName && <span className="text-xs text-muted-foreground">· {storeName}</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {p.supplierName ? <span className="mr-2">{p.supplierName}</span> : null}
          {fmtDate(p.receivedAt ?? p.createdAt)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-emerald-600">+{p.quantity}</p>
        {canViewPurchasePrice && <p className="text-xs text-muted-foreground">{fmtAmt(Number(p.unitCost))} DA</p>}
      </div>
    </div>
  );
}

function SaleRow({ s, lang }: { s: ProductHistorySale; lang: string }) {
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const storeName = lang === "ar" ? (s.storeNameAr ?? s.storeNameEn) : (s.storeNameEn ?? s.storeNameAr);
  const statusColor = STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-600";
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center">
        <ShoppingBag className="h-3.5 w-3.5 text-orange-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-sm">{t("Commande", "طلب")} #{s.orderId}</span>
          <Chip text={s.status} color={statusColor} />
          {storeName && <span className="text-xs text-muted-foreground">· {storeName}</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {(s.customerName ?? s.customerPhone)
            ? <span className="mr-2">{s.customerName ?? s.customerPhone}</span>
            : null}
          {fmtDate(s.createdAt)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-orange-600">-{s.quantity}</p>
        <p className="text-xs text-muted-foreground">{fmtAmt(Number(s.unitPrice))} DA</p>
      </div>
    </div>
  );
}

function MovementRow({ m, lang }: { m: ProductHistoryMovementEntry; lang: string }) {
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const def = MOVE_LABELS[m.movementType] ?? { fr: m.movementType, ar: m.movementType, color: "bg-gray-100 text-gray-600" };
  const label = lang === "ar" ? def.ar : def.fr;
  const storeName = lang === "ar" ? (m.storeNameAr ?? m.storeNameEn) : (m.storeNameEn ?? m.storeNameAr);
  const isIn = m.quantity > 0;
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className={`mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${isIn ? "bg-green-100" : "bg-red-100"}`}>
        {isIn
          ? <TrendingUp className="h-3.5 w-3.5 text-green-600" />
          : <TrendingDown className="h-3.5 w-3.5 text-red-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip text={label} color={def.color} />
          {m.reference && <span className="text-xs font-mono text-muted-foreground">{m.reference}</span>}
          {storeName && <span className="text-xs text-muted-foreground">· {storeName}</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {m.reason ? <span className="mr-2">{m.reason}</span> : null}
          {fmtDate(m.date)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-sm font-semibold ${isIn ? "text-green-600" : "text-red-600"}`}>
          {isIn ? "+" : ""}{m.quantity}
        </p>
      </div>
    </div>
  );
}

function SupplierReturnRow({ r, lang, canViewPurchasePrice }: { r: ProductHistorySupplierReturn; lang: string; canViewPurchasePrice: boolean }) {
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-rose-100 flex items-center justify-center">
        <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-sm">
            {t("Avoir four.", "أفوار مورد")} #{r.bonRetourFournisseurId}
          </span>
          {r.originalPurchaseOrderId && (
            <Chip text={`BF #${r.originalPurchaseOrderId}`} color="bg-rose-100 text-rose-700" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {r.supplierName ? <span className="mr-2">{r.supplierName}</span> : null}
          {r.reason ? <span className="mr-2 italic">{r.reason}</span> : null}
          {fmtDate(r.date)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-rose-600">-{r.quantity}</p>
        {canViewPurchasePrice && <p className="text-xs text-muted-foreground">{fmtAmt(Number(r.unitCost))} DA</p>}
      </div>
    </div>
  );
}

function ReturnRow({ r, lang, onOrderClick }: { r: ProductHistoryReturn; lang: string; onOrderClick?: (orderId: number) => void }) {
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const typeLabel = r.retourType === "sans_remboursement"
    ? t("Avoir", "أفوار")
    : t("Remboursement", "استرداد");
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center">
        <RotateCcw className="h-3.5 w-3.5 text-amber-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-sm">{t("Retour", "إرجاع")} #{r.bonRetourId}</span>
          <Chip text={typeLabel} color="bg-amber-100 text-amber-700" />
          {r.originalOrderId != null && (
            <button
              type="button"
              onClick={() => onOrderClick?.(r.originalOrderId!)}
              className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors cursor-pointer"
            >
              {t("Commande", "طلب")} #{r.originalOrderId}
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {r.customerName ? <span className="mr-2">{r.customerName}</span> : null}
          {r.reason ? <span className="mr-2 italic">{r.reason}</span> : null}
          {fmtDate(r.date)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-amber-600">+{r.quantity}</p>
        <p className="text-xs text-muted-foreground">{fmtAmt(Number(r.unitPrice))} DA</p>
      </div>
    </div>
  );
}

function TransferRow({ tr, lang }: { tr: ProductHistoryTransferEntry; lang: string }) {
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const statusColor = STATUS_COLORS[tr.status] ?? "bg-gray-100 text-gray-600";
  const srcName = lang === "ar"
    ? (tr.sourceStoreNameAr ?? tr.sourceStoreNameEn)
    : (tr.sourceStoreNameEn ?? tr.sourceStoreNameAr);
  const dstName = lang === "ar"
    ? (tr.destStoreNameAr ?? tr.destStoreNameEn)
    : (tr.destStoreNameEn ?? tr.destStoreNameAr);
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-sky-100 flex items-center justify-center">
        <ArrowLeftRight className="h-3.5 w-3.5 text-sky-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-sm">{t("Transfert", "تحويل")} #{tr.transferId}</span>
          <Chip text={tr.status} color={statusColor} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {srcName} → {dstName} · {fmtDate(tr.date)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-sky-600">{tr.quantity}</p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3 border-b">
          <Skeleton className="h-7 w-7 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <Package2 className="h-10 w-10 mb-3 opacity-25" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

// ── main export ───────────────────────────────────────────────────────────────

interface Props {
  product: Product | null;
  onClose: () => void;
}

export default function ProductHistorySheet({ product, onClose }: Props) {
  const { lang } = useLang();
  const { can } = usePermissions();
  const canViewPurchasePrice = can("products", "view_purchase_price");
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const [, navigate] = useLocation();

  const handleOrderClick = (orderId: number) => {
    onClose();
    navigate(`/orders?orderId=${orderId}`);
  };

  const { data, isLoading, isError } = useGetProductHistory(product?.id ?? 0, {
    query: { enabled: !!product?.id },
  });

  // Unified, sorted (newest first) list of all event types
  type UnifiedRow =
    | ({ _type: "purchase";        _date: string | null } & ProductHistoryPurchase)
    | ({ _type: "sale";            _date: string | null } & ProductHistorySale)
    | ({ _type: "movement";        _date: string | null } & ProductHistoryMovementEntry)
    | ({ _type: "transfer";        _date: string | null } & ProductHistoryTransferEntry)
    | ({ _type: "return";          _date: string | null } & ProductHistoryReturn)
    | ({ _type: "supplierReturn";  _date: string | null } & ProductHistorySupplierReturn);

  const all: UnifiedRow[] = useMemo(() => {
    if (!data) return [];
    const rows: UnifiedRow[] = [
      ...data.purchases.map((p) => ({
        ...p, _type: "purchase" as const, _date: p.receivedAt ?? p.createdAt ?? null,
      })),
      ...data.sales.map((s) => ({
        ...s, _type: "sale" as const, _date: s.createdAt ?? null,
      })),
      ...data.timeline.map((e) => ({
        ...e, _type: e.kind as "movement" | "transfer", _date: e.date ?? null,
      })) as UnifiedRow[],
      ...(data.returns ?? []).map((r) => ({
        ...r, _type: "return" as const, _date: r.date ?? null,
      })),
      ...(data.supplierReturns ?? []).map((r) => ({
        ...r, _type: "supplierReturn" as const, _date: r.date ?? null,
      })),
    ];
    return rows.sort((a, b) => {
      const ta = a._date ? new Date(a._date).getTime() : 0;
      const tb = b._date ? new Date(b._date).getTime() : 0;
      return tb - ta;
    });
  }, [data]);

  const productName = product
    ? (lang === "ar"
        ? (product.nameAr || product.nameEn)
        : (product.nameEn || product.nameAr))
    : "";

  const totalPurchased        = data ? data.purchases.reduce((s, p) => s + p.quantity, 0) : null;
  const totalSold             = data ? data.sales.reduce((s, sl) => s + sl.quantity, 0) : null;
  const totalReturned         = data ? (data.returns ?? []).reduce((s, r) => s + r.quantity, 0) : null;
  const totalSupplierReturned = data ? (data.supplierReturns ?? []).reduce((s, r) => s + r.quantity, 0) : null;

  return (
    <Sheet open={!!product} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[620px] p-0 flex flex-col gap-0 overflow-hidden">

        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <SheetTitle className="text-base font-semibold truncate">
            {t("Historique produit", "سجل حركات الصنف")} — {productName}
          </SheetTitle>
          {data && (
            <div className="flex flex-wrap gap-4 text-xs pt-1">
              <span className="text-emerald-600 font-medium">
                {t("Acheté :", "تم شراؤه:")} <strong>{totalPurchased}</strong>
              </span>
              <span className="text-orange-600 font-medium">
                {t("Vendu :", "تم بيعه:")} <strong>{totalSold}</strong>
              </span>
              {(totalReturned ?? 0) > 0 && (
                <span className="text-amber-600 font-medium">
                  {t("Retourné :", "مُرجَع:")} <strong>{totalReturned}</strong>
                </span>
              )}
              {(totalSupplierReturned ?? 0) > 0 && (
                <span className="text-rose-600 font-medium">
                  {t("Avoir four. :", "أفوار مورد:")} <strong>{totalSupplierReturned}</strong>
                </span>
              )}
              <span className="text-sky-600 font-medium">
                {t("Net :", "الصافي:")} <strong>{(totalPurchased ?? 0) - (totalSold ?? 0)}</strong>
              </span>
            </div>
          )}
        </SheetHeader>

        {/* Tabs */}
        <Tabs defaultValue="all" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-5 mt-3 mb-0 h-8 self-start shrink-0">
            <TabsTrigger value="all" className="text-xs h-7 px-3">
              {t("Tout", "الكل")}{data ? ` (${all.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="purchases" className="text-xs h-7 px-3">
              {t("Achats", "مشتريات")}{data ? ` (${data.purchases.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="sales" className="text-xs h-7 px-3">
              {t("Ventes", "مبيعات")}{data ? ` (${data.sales.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="movements" className="text-xs h-7 px-3">
              {t("Mouvements", "حركات")}{data ? ` (${data.timeline.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="returns" className="text-xs h-7 px-3">
              {t("Retours", "مرتجعات")}{data ? ` (${(data.returns ?? []).length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="avoirs" className="text-xs h-7 px-3">
              {t("Avoirs four.", "أفوار المورد")}{data ? ` (${(data.supplierReturns ?? []).length})` : ""}
            </TabsTrigger>
          </TabsList>

          {/* Error */}
          {isError && (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
              <AlertCircle className="h-8 w-8 opacity-30" />
              <p className="text-sm">{t("Accès refusé ou erreur serveur", "خطأ في الوصول أو الخادم")}</p>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="px-5 pt-3 flex-1 overflow-y-auto">
              <LoadingSkeleton />
            </div>
          )}

          {/* Content */}
          {!isLoading && !isError && data && (
            <>
              <TabsContent value="all" className="flex-1 overflow-y-auto px-5 mt-3 data-[state=inactive]:hidden">
                {all.length === 0
                  ? <EmptyState label={t("Aucune activité enregistrée", "لا توجد أنشطة مسجّلة")} />
                  : all.map((row) => {
                      if (row._type === "purchase")
                        return <PurchaseRow key={`p-${(row as ProductHistoryPurchase).purchaseOrderId}`} p={row as ProductHistoryPurchase} lang={lang} canViewPurchasePrice={canViewPurchasePrice} />;
                      if (row._type === "sale")
                        return <SaleRow key={`s-${(row as ProductHistorySale).orderId}`} s={row as ProductHistorySale} lang={lang} />;
                      if (row._type === "movement")
                        return <MovementRow key={(row as ProductHistoryMovementEntry).id} m={row as ProductHistoryMovementEntry} lang={lang} />;
                      if (row._type === "return")
                        return <ReturnRow key={`ret-${(row as ProductHistoryReturn).id}`} r={row as ProductHistoryReturn} lang={lang} onOrderClick={handleOrderClick} />;
                      if (row._type === "supplierReturn")
                        return <SupplierReturnRow key={`sret-${(row as ProductHistorySupplierReturn).id}`} r={row as ProductHistorySupplierReturn} lang={lang} canViewPurchasePrice={canViewPurchasePrice} />;
                      return <TransferRow key={(row as ProductHistoryTransferEntry).id} tr={row as ProductHistoryTransferEntry} lang={lang} />;
                    })
                }
              </TabsContent>

              <TabsContent value="purchases" className="flex-1 overflow-y-auto px-5 mt-3 data-[state=inactive]:hidden">
                {data.purchases.length === 0
                  ? <EmptyState label={t("Aucun achat", "لا توجد مشتريات")} />
                  : data.purchases.map((p) => <PurchaseRow key={p.purchaseOrderId} p={p} lang={lang} canViewPurchasePrice={canViewPurchasePrice} />)
                }
              </TabsContent>

              <TabsContent value="sales" className="flex-1 overflow-y-auto px-5 mt-3 data-[state=inactive]:hidden">
                {data.sales.length === 0
                  ? <EmptyState label={t("Aucune vente", "لا توجد مبيعات")} />
                  : data.sales.map((s) => <SaleRow key={s.orderId} s={s} lang={lang} />)
                }
              </TabsContent>

              <TabsContent value="movements" className="flex-1 overflow-y-auto px-5 mt-3 data-[state=inactive]:hidden">
                {data.timeline.length === 0
                  ? <EmptyState label={t("Aucun mouvement", "لا توجد حركات")} />
                  : data.timeline.map((e) =>
                      e.kind === "movement"
                        ? <MovementRow key={e.id} m={e as ProductHistoryMovementEntry} lang={lang} />
                        : <TransferRow key={e.id} tr={e as ProductHistoryTransferEntry} lang={lang} />
                    )
                }
              </TabsContent>

              <TabsContent value="returns" className="flex-1 overflow-y-auto px-5 mt-3 data-[state=inactive]:hidden">
                {(data.returns ?? []).length === 0
                  ? <EmptyState label={t("Aucun retour", "لا توجد مرتجعات")} />
                  : (data.returns ?? []).map((r) => <ReturnRow key={r.id} r={r} lang={lang} onOrderClick={handleOrderClick} />)
                }
              </TabsContent>

              <TabsContent value="avoirs" className="flex-1 overflow-y-auto px-5 mt-3 data-[state=inactive]:hidden">
                {(data.supplierReturns ?? []).length === 0
                  ? <EmptyState label={t("Aucun avoir fournisseur", "لا توجد أفوار موردين")} />
                  : (data.supplierReturns ?? []).map((r) => <SupplierReturnRow key={r.id} r={r} lang={lang} canViewPurchasePrice={canViewPurchasePrice} />)
                }
              </TabsContent>
            </>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

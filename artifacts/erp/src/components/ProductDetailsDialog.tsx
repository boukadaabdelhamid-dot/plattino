import React from "react";
import { useQuery } from "@tanstack/react-query";
import { type Product } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Package, ShoppingCart, TrendingUp, BarChart2, Store,
  History, ArrowLeftRight, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal,
} from "lucide-react";
import { useLang } from "@/hooks/use-lang";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

type PurchaseRecord = {
  purchaseOrderId: number;
  quantity: number;
  unitCost: string;
  status: string;
  createdAt: string | null;
  receivedAt: string | null;
  supplierName: string | null;
  storeId: number;
  storeNameAr: string | null;
  storeNameEn: string | null;
};

type SaleRecord = {
  orderId: number;
  quantity: number;
  unitPrice: string;
  customerName: string;
  customerPhone: string;
  status: string;
  createdAt: string | null;
  storeId: number;
  storeNameAr: string | null;
  storeNameEn: string | null;
};

type MovementEvent = {
  kind: "movement";
  id: string;
  date: string | null;
  movementType: "in" | "out" | "adjustment";
  quantity: number;
  reason: string | null;
  reference: string | null;
  storeId: number;
  storeNameAr: string | null;
  storeNameEn: string | null;
};

type TransferEvent = {
  kind: "transfer";
  id: string;
  date: string | null;
  status: string;
  transferId: number;
  quantity: number;
  sourceStoreId: number;
  sourceStoreNameAr: string | null;
  sourceStoreNameEn: string | null;
  destStoreId: number;
  destStoreNameAr: string | null;
  destStoreNameEn: string | null;
};

type TimelineEvent = MovementEvent | TransferEvent;

type ProductHistory = {
  purchases: PurchaseRecord[];
  sales: SaleRecord[];
  timeline: TimelineEvent[];
  currentStoreId: number;
};

type CrossStoreEntry = {
  storeId: number;
  storeNameAr: string;
  storeNameEn: string;
  isCurrent: boolean;
  exists: boolean;
  stock: number;
  lastUpdate: string | null;
};

type CrossStoreStock = { matchKey: string | null; stores: CrossStoreEntry[] };

type Translator = (fr: string, ar: string) => string;

function makeFmt(lang: string) {
  const locale = lang === "ar" ? "ar-DZ" : "fr-DZ";
  return (dateStr: string | null | undefined): string => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString(locale, {
      year: "numeric", month: "2-digit", day: "2-digit",
    });
  };
}

function makeFmtDateTime(lang: string) {
  const locale = lang === "ar" ? "ar-DZ" : "fr-DZ";
  return (dateStr: string | null | undefined): string => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString(locale, {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  };
}

function num(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_MAP: Record<string, { fr: string; ar: string; className: string }> = {
  pending:    { fr: "En attente",  ar: "قيد الانتظار", className: "bg-yellow-100 text-yellow-800" },
  received:   { fr: "Reçu",       ar: "مستلم",         className: "bg-green-100 text-green-800" },
  cancelled:  { fr: "Annulé",     ar: "ملغي",          className: "bg-red-100 text-red-800" },
  processing: { fr: "En cours",   ar: "جارٍ",          className: "bg-blue-100 text-blue-800" },
  shipped:    { fr: "Expédié",    ar: "مشحون",         className: "bg-indigo-100 text-indigo-800" },
  delivered:  { fr: "Livré",      ar: "مُسلَّم",        className: "bg-green-100 text-green-800" },
};

function StatusBadge({ status, t }: { status: string; t: Translator }) {
  const cfg = STATUS_MAP[status] ?? { fr: status, ar: status, className: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      {t(cfg.fr, cfg.ar)}
    </span>
  );
}

const TRANSFER_STATUS: Record<string, { ar: string; fr: string; className: string }> = {
  requested:  { ar: "طلب",       fr: "Demandé",    className: "bg-blue-100 text-blue-700" },
  approved:   { ar: "مقبول",     fr: "Approuvé",   className: "bg-emerald-100 text-emerald-700" },
  rejected:   { ar: "مرفوض",     fr: "Rejeté",     className: "bg-red-100 text-red-700" },
  prepared:   { ar: "محضّر",     fr: "Préparé",    className: "bg-amber-100 text-amber-700" },
  in_transit: { ar: "في الطريق", fr: "En transit", className: "bg-purple-100 text-purple-700" },
  received:   { ar: "مستلم",     fr: "Reçu",       className: "bg-teal-100 text-teal-700" },
  cancelled:  { ar: "ملغى",      fr: "Annulé",     className: "bg-gray-100 text-gray-600" },
};

function TransferStatusBadge({ status, t }: { status: string; t: Translator }) {
  const cfg = TRANSFER_STATUS[status] ?? { ar: status, fr: status, className: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.className}`}>
      {t(cfg.fr, cfg.ar)}
    </span>
  );
}

function movementMeta(ev: MovementEvent, t: Translator) {
  const ref = ev.reference ?? "";
  let label: string;
  if (ref.startsWith("ORDER-"))        label = t("Vente", "بيع");
  else if (ref.startsWith("PO-"))      label = t("Achat", "شراء");
  else if (ref.startsWith("RETOUR-"))  label = t("Retour", "مرتجع");
  else if (ref.startsWith("CANCEL-ORDER-")) label = t("Annulation commande", "إلغاء طلب");
  else if (ev.movementType === "in")   label = t("Entrée stock", "إدخال مخزون");
  else if (ev.movementType === "out")  label = t("Sortie stock", "إخراج مخزون");
  else                                  label = t("Ajustement stock", "تعديل مخزون");

  if (ev.movementType === "in")
    return { label, Icon: ArrowDownToLine, tone: "text-emerald-600", bar: "bg-emerald-400", sign: "+", qtyColor: "text-emerald-600" };
  if (ev.movementType === "out")
    return { label, Icon: ArrowUpFromLine, tone: "text-red-600", bar: "bg-red-400", sign: "−", qtyColor: "text-red-600" };
  return { label, Icon: SlidersHorizontal, tone: "text-amber-600", bar: "bg-amber-400", sign: "", qtyColor: "text-amber-600" };
}

function TimelineRow({ ev, t, fmtDateTime }: { ev: TimelineEvent; t: Translator; fmtDateTime: (d: string | null | undefined) => string }) {
  if (ev.kind === "transfer") {
    return (
      <div className="flex items-stretch rounded-lg border bg-primary/5 overflow-hidden">
        <div className="w-1 bg-primary shrink-0" />
        <div className="flex items-center gap-3 p-3 flex-1 min-w-0">
          <ArrowLeftRight className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{t("Transfert inter-magasins", "تحويل بين المتاجر")}</span>
              <span className="font-mono text-xs text-muted-foreground">TR-{ev.transferId}</span>
              <TransferStatusBadge status={ev.status} t={t} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("De", "من")}{" "}
              <span className="text-foreground font-medium">{ev.sourceStoreNameEn || ev.sourceStoreNameAr || `#${ev.sourceStoreId}`}</span>
              {" "}{t("à", "إلى")}{" "}
              <span className="text-foreground font-medium">{ev.destStoreNameEn || ev.destStoreNameAr || `#${ev.destStoreId}`}</span>
            </p>
          </div>
          <div className="text-end shrink-0">
            <p className="font-bold text-sm text-primary">{ev.quantity}</p>
            <p className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(ev.date)}</p>
          </div>
        </div>
      </div>
    );
  }
  const meta = movementMeta(ev, t);
  const Icon = meta.Icon;
  return (
    <div className="flex items-stretch rounded-lg border bg-muted/10 overflow-hidden">
      <div className={`w-1 shrink-0 ${meta.bar}`} />
      <div className="flex items-center gap-3 p-3 flex-1 min-w-0">
        <Icon className={`h-4 w-4 shrink-0 ${meta.tone}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{meta.label}</span>
            <Badge variant="secondary" className="text-[10px]">
              {ev.storeNameEn || ev.storeNameAr || `#${ev.storeId}`}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {ev.reason ?? "—"}{ev.reference ? ` · ${ev.reference}` : ""}
          </p>
        </div>
        <div className="text-end shrink-0">
          <p className={`font-bold text-sm ${meta.qtyColor}`}>{meta.sign}{ev.quantity}</p>
          <p className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(ev.date)}</p>
        </div>
      </div>
    </div>
  );
}

interface Props {
  product: Product | null;
  onClose: () => void;
}

export default function ProductDetailsDialog({ product, onClose }: Props) {
  const open = !!product;
  const { lang } = useLang();
  const t: Translator = (fr, ar) => lang === "ar" ? ar : fr;
  const fmt = makeFmt(lang);
  const fmtDateTime = makeFmtDateTime(lang);
  const dir = lang === "ar" ? "rtl" : "ltr";

  const { data: history, isLoading } = useQuery<ProductHistory>({
    queryKey: ["product-history", product?.id],
    enabled: !!product,
    queryFn: async () => {
      const token = localStorage.getItem("midanic_token");
      const res = await fetch(`${API_BASE}/api/erp/products/${product!.id}/history`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to load history");
      return res.json() as Promise<ProductHistory>;
    },
    staleTime: 60_000,
  });

  const { data: crossStore, isLoading: crossStoreLoading } = useQuery<CrossStoreStock>({
    queryKey: ["/api/erp/products/cross-store-stock", product?.id],
    enabled: !!product,
    queryFn: async () => {
      const token = localStorage.getItem("midanic_token");
      const res = await fetch(`${API_BASE}/api/erp/products/${product!.id}/cross-store-stock`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to load cross-store stock");
      return res.json() as Promise<CrossStoreStock>;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const crossStoreRows = crossStore?.stores ?? [];

  const purchases = history?.purchases ?? [];
  const sales = history?.sales ?? [];
  const timeline = history?.timeline ?? [];

  const currentStoreId = history?.currentStoreId ?? null;
  const summaryPurchases = currentStoreId == null ? purchases : purchases.filter((r) => r.storeId === currentStoreId);
  const summarySales      = currentStoreId == null ? sales : sales.filter((r) => r.storeId === currentStoreId);

  const totalPurchasedQty = summaryPurchases.reduce((s, r) => s + r.quantity, 0);
  const totalSoldQty      = summarySales.reduce((s, r) => s + r.quantity, 0);
  const lastPurchase      = summaryPurchases[0] ?? null;
  const lastSale          = summarySales[0] ?? null;

  const storeName = (nameEn: string | null, nameAr: string | null, fallback: string) =>
    lang === "ar" ? (nameAr || nameEn || fallback) : (nameEn || nameAr || fallback);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        dir={dir}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            {t("Détails du produit", "تفاصيل المنتج")} — {lang === "ar" ? (product?.nameAr || product?.nameEn) : (product?.nameEn || product?.nameAr)}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info" className="mt-2">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="info">
              <Package className="h-3.5 w-3.5 me-1.5" />
              {t("Informations", "معلومات المنتج")}
            </TabsTrigger>
            <TabsTrigger value="purchases">
              <ShoppingCart className="h-3.5 w-3.5 me-1.5" />
              {t("Achats", "سجل المشتريات")}
            </TabsTrigger>
            <TabsTrigger value="sales">
              <TrendingUp className="h-3.5 w-3.5 me-1.5" />
              {t("Ventes", "سجل المبيعات")}
            </TabsTrigger>
            <TabsTrigger value="summary">
              <BarChart2 className="h-3.5 w-3.5 me-1.5" />
              {t("Résumé", "ملخص سريع")}
            </TabsTrigger>
            <TabsTrigger value="timeline">
              <History className="h-3.5 w-3.5 me-1.5" />
              {t("Mouvements", "سجل الحركات")}
            </TabsTrigger>
          </TabsList>

          {/* ── 1. Informations ──────────────────────────────────────── */}
          <TabsContent value="info" className="mt-4">
            {!product ? null : (
              <>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <InfoRow label={t("Nom (arabe)", "الاسم (عربي)")}        value={product.nameAr ?? "—"} />
                  <InfoRow label={t("Nom (français)", "الاسم (فرنسي)")}    value={product.nameEn ?? "—"} />
                  <InfoRow label={t("Référence", "المرجع")}                value={product.reference ?? "—"} />
                  <InfoRow label={t("Code-barres", "الباركود")}            value={product.barcode ?? "—"} />
                  <InfoRow label={t("Catalogue", "التصنيف")}               value={product.catalogueType ?? "—"} />
                  <InfoRow label={t("Marque", "العلامة التجارية")}         value={product.brand ?? "—"} />
                  <InfoRow label={t("Stock actuel", "المخزون الحالي")}     value={String(product.stock ?? 0)} highlight />
                  <InfoRow label={t("Prix de vente", "سعر البيع")}         value={`${num(product.price)} ${t("DA", "دج")}`} highlight />
                  <InfoRow label={t("Prix de revient", "سعر التكلفة")}     value={product.costPrice ? `${num(product.costPrice)} ${t("DA", "دج")}` : "—"} />
                  <InfoRow label={t("Prix en gros", "سعر الجملة")}         value={product.priceGros ? `${num(product.priceGros)} ${t("DA", "دج")}` : "—"} />
                </div>

                {/* ── Stock autres magasins ─────────────────────────── */}
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">{t("Stock dans les autres magasins", "المخزون في المتاجر الأخرى")}</h3>
                    <span className="text-xs text-muted-foreground">({t("lecture seule", "للقراءة فقط")})</span>
                  </div>
                  {crossStoreLoading ? (
                    <LoadingSkeleton rows={3} cols={3} />
                  ) : crossStoreRows.length === 0 ? (
                    <EmptyState message={t("Aucun magasin actif", "لا توجد متاجر نشطة")} />
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40">
                            <TableHead className="text-xs font-semibold uppercase">{t("Magasin", "المتجر")}</TableHead>
                            <TableHead className="text-xs font-semibold uppercase">{t("Stock", "المخزون الحالي")}</TableHead>
                            <TableHead className="text-xs font-semibold uppercase">{t("Dernière mise à jour", "آخر تحديث للمخزون")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {crossStoreRows.map((s) => (
                            <TableRow key={s.storeId} className={s.isCurrent ? "bg-primary/10" : ""}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <span>{storeName(s.storeNameEn, s.storeNameAr, `#${s.storeId}`)}</span>
                                  {s.isCurrent && (
                                    <Badge variant="secondary" className="text-[10px]">{t("Magasin actuel", "المتجر الحالي")}</Badge>
                                  )}
                                </div>
                                {s.storeNameAr && s.storeNameEn && (
                                  <span className="text-xs text-muted-foreground">
                                    {lang === "ar" ? s.storeNameEn : s.storeNameAr}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className={`font-semibold ${s.exists ? "" : "text-muted-foreground"}`}>
                                {s.stock}
                              </TableCell>
                              <TableCell>{fmtDateTime(s.lastUpdate)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {crossStore && !crossStore.matchKey && (
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                          {t(
                            "Ce produit n'a pas de référence ni de code-barres, il ne peut donc pas être lié à ses homologues dans les autres magasins. Ajoutez une référence ou un code-barres (copié automatiquement lors de « Envoyer vers un autre magasin ») pour afficher le stock dans les autres magasins.",
                            "هذا المنتج بدون مرجع أو باركود، لذلك لا يمكن ربطه بنُسخه في المتاجر الأخرى. أضِف مرجعًا أو باركود (يُنسخ تلقائيًا عند «إرسال إلى متجر آخر») لعرض مخزونه في باقي المتاجر.",
                          )}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          {/* ── 2. Achats ────────────────────────────────────────────── */}
          <TabsContent value="purchases" className="mt-4">
            {isLoading ? (
              <LoadingSkeleton rows={5} cols={5} />
            ) : purchases.length === 0 ? (
              <EmptyState message={t("Aucun achat enregistré pour ce produit", "لا يوجد سجل مشتريات لهذا المنتج")} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs font-semibold uppercase">{t("N° BCA", "ر. الطلبية")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Magasin", "المتجر")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Date achat", "تاريخ الشراء")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Fournisseur", "المورد")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Qté", "الكمية")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Prix achat", "سعر الشراء")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Statut", "الحالة")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((r) => (
                    <TableRow key={`${r.purchaseOrderId}`}>
                      <TableCell className="font-mono text-xs">PO-{r.purchaseOrderId}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">
                          {storeName(r.storeNameEn, r.storeNameAr, `#${r.storeId}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmt(r.createdAt)}</TableCell>
                      <TableCell>{r.supplierName ?? "—"}</TableCell>
                      <TableCell className="font-semibold">{r.quantity}</TableCell>
                      <TableCell>{num(r.unitCost)} {t("DA", "دج")}</TableCell>
                      <TableCell><StatusBadge status={r.status} t={t} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ── 3. Ventes ────────────────────────────────────────────── */}
          <TabsContent value="sales" className="mt-4">
            {isLoading ? (
              <LoadingSkeleton rows={5} cols={5} />
            ) : sales.length === 0 ? (
              <EmptyState message={t("Aucune vente enregistrée pour ce produit", "لا يوجد سجل مبيعات لهذا المنتج")} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs font-semibold uppercase">{t("N° FV", "ر. الطلب")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Magasin", "المتجر")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Date vente", "تاريخ البيع")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Client", "الزبون")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Téléphone", "الهاتف")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Qté", "الكمية")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Prix vente", "سعر البيع")}</TableHead>
                    <TableHead className="text-xs font-semibold uppercase">{t("Statut", "الحالة")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((r) => (
                    <TableRow key={`${r.orderId}`}>
                      <TableCell className="font-mono text-xs">FV-{String(r.orderId).padStart(5, "0")}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">
                          {storeName(r.storeNameEn, r.storeNameAr, `#${r.storeId}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmt(r.createdAt)}</TableCell>
                      <TableCell>{r.customerName}</TableCell>
                      <TableCell className="text-muted-foreground">{r.customerPhone || "—"}</TableCell>
                      <TableCell className="font-semibold">{r.quantity}</TableCell>
                      <TableCell>{num(r.unitPrice)} {t("DA", "دج")}</TableCell>
                      <TableCell><StatusBadge status={r.status} t={t} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ── 4. Résumé ────────────────────────────────────────────── */}
          <TabsContent value="summary" className="mt-4">
            {isLoading ? (
              <LoadingSkeleton rows={4} cols={2} />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <SummaryCard
                  title={t("Dernier achat", "آخر عملية شراء")}
                  value={lastPurchase ? fmt(lastPurchase.createdAt) : t("Aucun", "لا يوجد")}
                  sub={lastPurchase ? `${lastPurchase.supplierName ?? "—"} — ${lastPurchase.quantity} ${t("unité(s)", "وحدة")}` : undefined}
                  icon={<ShoppingCart className="h-5 w-5 text-blue-500" />}
                />
                <SummaryCard
                  title={t("Dernière vente", "آخر عملية بيع")}
                  value={lastSale ? fmt(lastSale.createdAt) : t("Aucune", "لا يوجد")}
                  sub={lastSale ? `${lastSale.customerName} — ${lastSale.quantity} ${t("unité(s)", "وحدة")}` : undefined}
                  icon={<TrendingUp className="h-5 w-5 text-green-500" />}
                />
                <SummaryCard
                  title={t("Total quantités achetées", "إجمالي الكميات المشتراة")}
                  value={String(totalPurchasedQty)}
                  sub={t(`depuis ${summaryPurchases.length} commande(s)`, `من ${summaryPurchases.length} طلبية شراء`)}
                  icon={<Package className="h-5 w-5 text-orange-500" />}
                />
                <SummaryCard
                  title={t("Total quantités vendues", "إجمالي الكميات المباعة")}
                  value={String(totalSoldQty)}
                  sub={t(`depuis ${summarySales.length} vente(s)`, `من ${summarySales.length} طلب بيع`)}
                  icon={<BarChart2 className="h-5 w-5 text-purple-500" />}
                />
              </div>
            )}
          </TabsContent>

          {/* ── 5. Mouvements ────────────────────────────────────────── */}
          <TabsContent value="timeline" className="mt-4">
            {isLoading ? (
              <LoadingSkeleton rows={6} cols={1} />
            ) : timeline.length === 0 ? (
              <EmptyState message={t("Aucun mouvement pour ce produit", "لا توجد حركات لهذا المنتج")} />
            ) : (
              <div className="space-y-2">
                {timeline.map((ev) => (
                  <TimelineRow key={ev.id} ev={ev} t={t} fmtDateTime={fmtDateTime} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-lg border bg-muted/20">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-medium text-sm ${highlight ? "text-primary" : ""}`}>{value}</span>
    </div>
  );
}

function SummaryCard({ title, value, sub, icon }: { title: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/20">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">{title}</p>
        <p className="text-lg font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function LoadingSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="space-y-2">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex gap-2">
          {[...Array(cols)].map((__, j) => (
            <Skeleton key={j} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Package className="h-8 w-8 mb-2 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

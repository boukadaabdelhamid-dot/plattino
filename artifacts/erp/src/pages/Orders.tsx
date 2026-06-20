import React, { useState, useMemo } from "react";
import {
  useGetAdminOrders, useUpdateOrderStatus, useGetOrder, getGetAdminOrdersQueryKey,
  getGetOrderQueryKey, useGetAdminRetours, useCreateBonRetour, getGetAdminRetoursQueryKey,
  useGetAdminRetour, getGetAdminRetourQueryKey, useCreateStandaloneRetour, useGetProducts,
  useGetErpCustomers,
  type Order, type UpdateOrderStatusRequestStatus, type BonRetourDetailItemsItem, type Product,
  type CustomerSummary,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShoppingCart, History, Printer, Lock, RotateCcw, Plus, Trash2, ChevronsUpDown, Check, User } from "lucide-react";
import { format } from "date-fns";
import Pos from "./Pos";
import InvoiceDialog from "@/components/InvoiceDialog";
import type { InvoiceData } from "@/components/InvoiceTemplate";
import { useCurrentStore } from "@/hooks/use-current-store";
import { ProductPickerDialog } from "@/components/pos/ProductPickerDialog";

const STATUS_OPTIONS: UpdateOrderStatusRequestStatus[] = ["pending", "processing", "shipped", "delivered", "cancelled"];

const statusColor = (s: string) => {
  switch (s) {
    case "delivered": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "shipped": return "bg-blue-100 text-blue-700 border-blue-200";
    case "processing": return "bg-amber-100 text-amber-700 border-amber-200";
    case "cancelled": return "bg-red-100 text-red-700 border-red-200";
    default: return "bg-gray-100 text-gray-700 border-gray-200";
  }
};

export default function Orders() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const [tab, setTab] = useState<"vente" | "historique" | "retours">("vente");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-6 w-6 text-[#1B3057]" />
          {t("Ventes", "المبيعات")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("Point de vente et historique des commandes", "نقطة البيع وسجل الطلبات")}
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "vente" | "historique" | "retours")} className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="vente" data-testid="tab-vente">
            <ShoppingCart className="h-4 w-4 mr-2" />
            {t("Nouvelle vente", "بيع جديد")}
          </TabsTrigger>
          <TabsTrigger value="historique" data-testid="tab-historique">
            <History className="h-4 w-4 mr-2" />
            {t("Historique", "السجل")}
          </TabsTrigger>
          <TabsTrigger value="retours" data-testid="tab-retours">
            <RotateCcw className="h-4 w-4 mr-2" />
            {t("Retours", "الإرجاعات")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vente" className="mt-4">
          <Pos />
        </TabsContent>

        <TabsContent value="historique" className="mt-4">
          <OrdersHistory />
        </TabsContent>

        <TabsContent value="retours" className="mt-4">
          <RetoursHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrdersHistory() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const { data: orders, isLoading } = useGetAdminOrders();
  const updateStatus = useUpdateOrderStatus();
  const [updating, setUpdating] = useState<number | null>(null);
  const [invoiceOrderId, setInvoiceOrderId] = useState<number | null>(null);
  const [showTva, setShowTva] = useState(false);
  const [bonRetourOrderId, setBonRetourOrderId] = useState<number | null>(null);
  const store = useCurrentStore();
  const { data: invoiceOrder } = useGetOrder(invoiceOrderId ?? 0, {
    query: { enabled: !!invoiceOrderId, queryKey: getGetOrderQueryKey(invoiceOrderId ?? 0) },
  });

  const openInvoice = (orderId: number) => {
    setShowTva(!!store?.showTvaByDefault);
    setInvoiceOrderId(orderId);
  };

  const invoiceData: InvoiceData | null = React.useMemo(() => {
    if (!invoiceOrder || !invoiceOrderId) return null;
    const items = invoiceOrder.items ?? [];
    return {
      kind: "sale",
      number: `FV-${String(invoiceOrder.id).padStart(6, "0")}`,
      date: invoiceOrder.createdAt ? new Date(invoiceOrder.createdAt) : new Date(),
      store,
      party: {
        name: invoiceOrder.customerName,
        address: invoiceOrder.customerAddress,
        phone: invoiceOrder.customerPhone,
      },
      lines: items.map((it) => ({
        designation: (it.product?.nameEn || it.product?.nameAr || "—").toUpperCase(),
        reference: it.product?.reference ?? it.product?.barcode ?? null,
        qty: it.quantity ?? 0,
        unitPrice: parseFloat(it.unitPrice ?? "0"),
      })),
      showTva,
      tvaRate: parseFloat(store?.tvaRate ?? "19"),
    };
  }, [invoiceOrder, invoiceOrderId, store, showTva]);

  const handleStatusChange = (id: number, status: UpdateOrderStatusRequestStatus) => {
    setUpdating(id);
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSettled: () => {
          setUpdating(null);
          qc.invalidateQueries({ queryKey: getGetAdminOrdersQueryKey() });
        },
      }
    );
  };

  const statusLabels: Record<string, string> = {
    pending: t("En attente", "قيد الانتظار"),
    processing: t("En cours", "جاري المعالجة"),
    shipped: t("Expédié", "تم الشحن"),
    delivered: t("Livré", "تم التسليم"),
    cancelled: t("Annulé", "ملغي"),
  };

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("Toutes les commandes", "جميع الطلبات")} ({orders?.length ?? 0})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("N°", "رقم")}</TableHead>
                  <TableHead>{t("Client", "العميل")}</TableHead>
                  <TableHead>{t("Montant", "المبلغ")}</TableHead>
                  <TableHead>{t("Statut", "الحالة")}</TableHead>
                  <TableHead>{t("Date", "التاريخ")}</TableHead>
                  <TableHead className="text-right">{t("Actions", "إجراءات")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(orders ?? []).map((order) => {
                  const isDelivered = order.status === "delivered";
                  const canReturn = order.status === "delivered" || order.status === "shipped";
                  return (
                    <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                      <TableCell className="font-medium text-[#1B3057]">#{order.id}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{order.customerName}</div>
                        {order.customerPhone && (
                          <div className="text-xs text-muted-foreground">{order.customerPhone}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {parseFloat(order.totalAmount ?? "0").toFixed(2)} {currency}
                      </TableCell>
                      <TableCell>
                        {isDelivered ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${statusColor(order.status ?? "")}`}>
                              <Lock className="h-3 w-3" />
                              {statusLabels[order.status ?? ""] ?? order.status}
                            </span>
                          </div>
                        ) : (
                          <Select
                            value={order.status ?? ""}
                            onValueChange={(val) => handleStatusChange(order.id, val as UpdateOrderStatusRequestStatus)}
                            disabled={updating === order.id}
                          >
                            <SelectTrigger className={`h-7 text-xs w-36 border font-medium ${statusColor(order.status ?? "")}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s} value={s} className="text-xs">
                                  {statusLabels[s] ?? s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {order.createdAt ? format(new Date(order.createdAt), "dd/MM/yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="outline" className="h-8 text-xs"
                            onClick={() => openInvoice(order.id)}
                            data-testid={`button-invoice-${order.id}`}>
                            <Printer className="h-3.5 w-3.5 mr-1" /> {t("Facture", "فاتورة")}
                          </Button>
                          {canReturn && (
                            <Button size="sm" variant="outline"
                              className="h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                              onClick={() => setBonRetourOrderId(order.id)}
                              data-testid={`button-retour-${order.id}`}>
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> {t("Retour", "إرجاع")}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!orders || orders.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {t("Aucune commande", "لا توجد طلبات")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <InvoiceDialog
        open={!!invoiceOrderId}
        onOpenChange={(o) => { if (!o) setInvoiceOrderId(null); }}
        data={invoiceData}
        onShowTvaChange={setShowTva}
      />
      {bonRetourOrderId && (
        <BonRetourDialog
          orderId={bonRetourOrderId}
          open={!!bonRetourOrderId}
          onOpenChange={(o) => { if (!o) setBonRetourOrderId(null); }}
        />
      )}
    </Card>
  );
}

function BonRetourDialog({ orderId, open, onOpenChange }: {
  orderId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const { data: order, isLoading } = useGetOrder(orderId, {
    query: { enabled: open && !!orderId, queryKey: getGetOrderQueryKey(orderId) },
  });
  const { data: allRetours } = useGetAdminRetours();
  const createRetour = useCreateBonRetour();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Compute already-returned quantities per productId for this specific order
  const alreadyReturnedMap = React.useMemo(() => {
    const map: Record<number, number> = {};
    if (!allRetours) return map;
    for (const retour of allRetours) {
      if (retour.originalOrderId !== orderId) continue;
      for (const ri of retour.items ?? []) {
        if (ri.productId != null) {
          map[ri.productId] = (map[ri.productId] ?? 0) + (ri.quantity ?? 0);
        }
      }
    }
    return map;
  }, [allRetours, orderId]);

  React.useEffect(() => {
    if (order?.items) {
      const init: Record<number, number> = {};
      for (const item of order.items) {
        if (item.product?.id) init[item.product.id] = 0;
      }
      setQuantities(init);
    }
  }, [order]);

  const [clotureOpen, setClotureOpen] = useState(false);

  const buildItems = () =>
    Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => ({ productId: parseInt(productId), quantity }));

  const handleCloture = () => {
    setError(null);
    if (buildItems().length === 0) {
      setError(t("Sélectionnez au moins un article à retourner.", "يجب اختيار منتج واحد على الأقل للإرجاع."));
      return;
    }
    setClotureOpen(true);
  };

  const handleClotureConfirm = (retourType: string) => {
    const items = buildItems();
    createRetour.mutate(
      { id: orderId, data: { reason: reason || undefined, retourType, items } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetAdminRetoursQueryKey() });
          setReason("");
          setQuantities({});
          setClotureOpen(false);
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(msg ?? t("Une erreur est survenue.", "حدث خطأ، حاول مجدداً."));
          setClotureOpen(false);
        },
      }
    );
  };

  return (
    <>
    <ClotureRetourModal
      open={clotureOpen}
      onOpenChange={setClotureOpen}
      onConfirm={handleClotureConfirm}
      isPending={createRetour.isPending}
    />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-amber-600" />
            {t("Bon Retour", "وصل إرجاع")} — {t("Commande", "طلب")} #{orderId}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !order?.items?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t("Aucun article dans cette commande.", "لا توجد منتجات في هذا الطلب.")}
          </p>
        ) : (
          <div className="space-y-4 py-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Article", "المنتج")}</TableHead>
                  <TableHead className="text-center">{t("Vendu", "مُباع")}</TableHead>
                  <TableHead className="text-center">{t("Déjà retourné", "مُعاد")}</TableHead>
                  <TableHead className="text-center">{t("À retourner", "للإرجاع")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => {
                  const productId = item.product?.id;
                  if (!productId) return null;
                  const soldQty = item.quantity ?? 0;
                  const alreadyReturned = alreadyReturnedMap[productId] ?? 0;
                  const maxQty = Math.max(0, soldQty - alreadyReturned);
                  return (
                    <TableRow key={productId}>
                      <TableCell className="text-sm font-medium">
                        {item.product?.nameEn || item.product?.nameAr || `#${productId}`}
                        <div className="text-xs text-muted-foreground">{parseFloat(item.unitPrice ?? "0").toFixed(2)} {currency}</div>
                      </TableCell>
                      <TableCell className="text-center text-sm">{soldQty}</TableCell>
                      <TableCell className="text-center text-sm">
                        {alreadyReturned > 0 ? (
                          <span className="text-amber-600 font-medium">{alreadyReturned}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {maxQty === 0 ? (
                          <span className="text-xs text-muted-foreground italic">{t("Complet", "مكتمل")}</span>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            max={maxQty}
                            value={quantities[productId] ?? 0}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(maxQty, parseInt(e.target.value) || 0));
                              setQuantities((prev) => ({ ...prev, [productId]: v }));
                            }}
                            className="h-8 w-20 text-center text-sm mx-auto"
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="space-y-1">
              <Label className="text-sm">{t("Motif du retour (optionnel)", "سبب الإرجاع (اختياري)")}</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("Ex: article défectueux, erreur de commande...", "مثال: منتج معيب، خطأ في الطلب...")}
                className="h-20 text-sm resize-none"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Annuler", "إلغاء")}
          </Button>
          <Button
            onClick={handleCloture}
            disabled={createRetour.isPending || isLoading}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {t("Clôturer", "إغلاق")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function RetoursHistory() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const store = useCurrentStore();
  const { data: retours, isLoading } = useGetAdminRetours();
  const [printRetourId, setPrintRetourId] = useState<number | null>(null);
  const [showTva, setShowTva] = useState(false);
  const [showNouveauRetour, setShowNouveauRetour] = useState(false);

  const [filterRetour, setFilterRetour] = useState("");
  const [filterCommande, setFilterCommande] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterType, setFilterType] = useState<"all" | "remboursement" | "sans_remboursement">("all");
  const [filterDate, setFilterDate] = useState("");

  const filteredRetours = useMemo(() => {
    return (retours ?? []).filter((r) => {
      const num = `BR-${String(r.id).padStart(6, "0")}`;
      const orig = r.originalOrder as { customerName?: string } | null;
      const client = orig?.customerName ?? (r as { clientName?: string | null }).clientName ?? "DIVERS COMPTOIR";
      const rt = (r as { retourType?: string | null }).retourType ?? "";
      const date = r.createdAt ? format(new Date(r.createdAt), "yyyy-MM-dd") : "";
      if (filterRetour && !num.toLowerCase().includes(filterRetour.toLowerCase())) return false;
      if (filterCommande && !String(r.originalOrderId ?? "").includes(filterCommande)) return false;
      if (filterClient && !client.toLowerCase().includes(filterClient.toLowerCase())) return false;
      if (filterType !== "all" && rt !== filterType) return false;
      if (filterDate && date !== filterDate) return false;
      return true;
    });
  }, [retours, filterRetour, filterCommande, filterClient, filterType, filterDate]);

  // Fetch full detail (with product names) only when print is triggered
  const { data: retourDetail } = useGetAdminRetour(printRetourId ?? 0, {
    query: {
      enabled: !!printRetourId,
      queryKey: getGetAdminRetourQueryKey(printRetourId ?? 0),
    },
  });

  const invoiceData: InvoiceData | null = React.useMemo(() => {
    if (!retourDetail || !printRetourId) return null;
    const items = (retourDetail.items ?? []) as BonRetourDetailItemsItem[];
    const originalOrder = retourDetail.originalOrder as Order | null;
    return {
      kind: "retour",
      number: `BR-${String(retourDetail.id).padStart(6, "0")}`,
      date: retourDetail.createdAt ? new Date(retourDetail.createdAt) : new Date(),
      store,
      party: {
        name: originalOrder?.customerName ?? (retourDetail as { clientName?: string | null }).clientName ?? "DIVERS COMPTOIR",
        address: originalOrder?.customerAddress ?? undefined,
        phone: originalOrder?.customerPhone ?? undefined,
      },
      lines: items.map((it) => ({
        designation: (it.product?.nameEn || it.product?.nameAr || "—").toUpperCase(),
        reference: it.product?.reference ?? it.product?.barcode ?? null,
        qty: it.quantity ?? 0,
        unitPrice: parseFloat(it.unitPrice ?? "0"),
      })),
      notes: retourDetail.reason ?? undefined,
      showTva,
      tvaRate: parseFloat(store?.tvaRate ?? "19"),
    };
  }, [retourDetail, printRetourId, store, showTva]);

  const openPrint = (retourId: number) => {
    setShowTva(!!store?.showTvaByDefault);
    setPrintRetourId(retourId);
  };

  const handleCreated = (id: number) => {
    setShowNouveauRetour(false);
    openPrint(id);
  };

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-amber-600" />
            {t("Bons de Retour", "وصولات الإرجاع")} ({retours?.length ?? 0})
          </CardTitle>
          <Button size="sm" className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => setShowNouveauRetour(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> {t("Nouveau Retour", "إرجاع جديد")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Retour #", "رقم الإرجاع")}</TableHead>
                  <TableHead>{t("Commande #", "رقم الطلب")}</TableHead>
                  <TableHead>{t("Client", "العميل")}</TableHead>
                  <TableHead>{t("Montant", "المبلغ")}</TableHead>
                  <TableHead>{t("Type", "النوع")}</TableHead>
                  <TableHead>{t("Motif", "السبب")}</TableHead>
                  <TableHead>{t("Date", "التاريخ")}</TableHead>
                  <TableHead className="text-right">{t("Imprimer", "طباعة")}</TableHead>
                </TableRow>
                {/* ── Filter row ── */}
                <TableRow className="border-b bg-card h-8">
                  <TableHead className="px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={filterRetour} onChange={(e) => setFilterRetour(e.target.value)} /></div></TableHead>
                  <TableHead className="px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={filterCommande} onChange={(e) => setFilterCommande(e.target.value)} /></div></TableHead>
                  <TableHead className="px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={filterClient} onChange={(e) => setFilterClient(e.target.value)} /></div></TableHead>
                  <TableHead className="px-2 py-1" />
                  <TableHead className="px-2 py-1"><select value={filterType} onChange={(e) => setFilterType(e.target.value as typeof filterType)} className="min-w-0 w-full bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px focus:outline-none focus:border-primary/60 transition-colors"><option value="all">Filtre …</option><option value="remboursement">{t("Remboursement", "استرداد")}</option><option value="sans_remboursement">{t("Sans remb.", "بدون استرداد")}</option></select></TableHead>
                  <TableHead className="px-2 py-1" />
                  <TableHead className="px-2 py-1"><input type="date" className="min-w-0 w-full bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} /></TableHead>
                  <TableHead className="px-2 py-1" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRetours.map((retour) => {
                  const orig = retour.originalOrder as { customerName?: string } | null;
                  const clientDisplay = orig?.customerName ?? (retour as { clientName?: string | null }).clientName ?? "DIVERS COMPTOIR";
                  return (
                    <TableRow key={retour.id} data-testid={`row-retour-${retour.id}`}>
                      <TableCell className="font-medium text-amber-700">
                        BR-{String(retour.id).padStart(6, "0")}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {retour.originalOrderId ? `#${retour.originalOrderId}` : <span className="italic text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">{clientDisplay}</TableCell>
                      <TableCell className="font-semibold text-amber-700">
                        {typeof retour.totalAmount === "number" ? retour.totalAmount.toFixed(2) : retour.totalAmount} {currency}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const rt = (retour as { retourType?: string | null }).retourType;
                          if (rt === "remboursement") return (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                              {t("Remboursement", "استرداد")}
                            </span>
                          );
                          if (rt === "sans_remboursement") return (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-gray-100 text-gray-600 border-gray-200">
                              {t("Sans remb.", "بدون استرداد")}
                            </span>
                          );
                          return <span className="italic text-xs text-muted-foreground">—</span>;
                        })()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">
                        {retour.reason ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {retour.createdAt ? format(new Date(retour.createdAt), "dd/MM/yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="h-8 text-xs"
                          onClick={() => openPrint(retour.id)}
                          data-testid={`button-print-retour-${retour.id}`}>
                          <Printer className="h-3.5 w-3.5 mr-1" /> {t("Bon", "وصل")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredRetours.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {(filterRetour || filterCommande || filterClient || filterType !== "all" || filterDate)
                        ? t("Aucun retour trouvé", "لا توجد نتائج")
                        : t("Aucun retour enregistré", "لا توجد إرجاعات مسجلة")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <InvoiceDialog
        open={!!printRetourId}
        onOpenChange={(o) => { if (!o) setPrintRetourId(null); }}
        data={invoiceData}
        onShowTvaChange={setShowTva}
      />
      <NouveauRetourDialog
        open={showNouveauRetour}
        onOpenChange={setShowNouveauRetour}
        onCreated={handleCreated}
      />
    </Card>
  );
}

type RetourLine = {
  productId: number;
  designation: string;
  qty: number;
  pu: number;
};

function NouveauRetourDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  const { data: productsResp } = useGetProducts({ limit: 500 });
  const products: Product[] = useMemo(() => (productsResp?.products ?? []) as Product[], [productsResp]);

  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  const { data: extraBarcodesData = [] } = useQuery<{ barcode: string; productId: number }[]>({
    queryKey: ["extra-barcodes-all"],
    queryFn: async () => {
      const token = localStorage.getItem("midanic_token");
      const r = await fetch(`${apiBase}/api/erp/products/extra-barcodes`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!r.ok) return [];
      return r.json() as Promise<{ barcode: string; productId: number }[]>;
    },
    staleTime: 60_000,
  });
  const extraBarcodesMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const { barcode, productId } of extraBarcodesData) m.set(barcode.toLowerCase(), productId);
    return m;
  }, [extraBarcodesData]);

  const [lines, setLines] = useState<RetourLine[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [clientComboOpen, setClientComboOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [reason, setReason] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientPickerRef = React.useRef<HTMLDivElement>(null);

  const { data: customerResults = [] } = useGetErpCustomers(
    clientSearch.trim().length > 0 ? { search: clientSearch.trim() } : {}
  );

  const createRetour = useCreateStandaloneRetour();
  const [clotureOpen, setClotureOpen] = useState(false);

  React.useEffect(() => {
    if (open) {
      setLines([]);
      setSelectedCustomer(null);
      setClientSearch("");
      setClientComboOpen(false);
      setReason("");
      setError(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!clientComboOpen) return;
    const handler = (e: MouseEvent) => {
      if (clientPickerRef.current && !clientPickerRef.current.contains(e.target as Node)) {
        setClientComboOpen(false);
        setClientSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [clientComboOpen]);

  const addProduct = (p: Product) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [
        ...prev,
        {
          productId: p.id,
          designation: (lang === "ar" ? (p.nameAr || p.nameEn) : (p.nameEn || p.nameAr) || `#${p.id}`).toUpperCase(),
          qty: 1,
          pu: parseFloat(p.price ?? "0"),
        },
      ];
    });
    setPickerOpen(false);
  };

  const removeLine = (productId: number) => setLines((prev) => prev.filter((l) => l.productId !== productId));
  const setQty = (productId: number, qty: number) => {
    if (qty < 1) return;
    setLines((prev) => prev.map((l) => l.productId === productId ? { ...l, qty } : l));
  };

  const total = lines.reduce((s, l) => s + l.pu * l.qty, 0);

  const handleCloture = () => {
    setError(null);
    if (lines.length === 0) {
      setError(t("Ajoutez au moins un article.", "أضف منتجاً واحداً على الأقل."));
      return;
    }
    setClotureOpen(true);
  };

  const handleClotureConfirm = (retourType: string) => {
    createRetour.mutate(
      {
        data: {
          clientUserId: (selectedCustomer && selectedCustomer.id !== 0) ? selectedCustomer.id : undefined,
          reason: reason.trim() || undefined,
          retourType,
          items: lines.map((l) => ({ productId: l.productId, quantity: l.qty })),
        },
      },
      {
        onSuccess: (data) => {
          qc.invalidateQueries({ queryKey: getGetAdminRetoursQueryKey() });
          setClotureOpen(false);
          const id = (data as { id?: number }).id;
          if (id) onCreated(id);
          else onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(msg ?? t("Une erreur est survenue.", "حدث خطأ، حاول مجدداً."));
          setClotureOpen(false);
        },
      }
    );
  };

  return (
    <>
      <ClotureRetourModal
        open={clotureOpen}
        onOpenChange={setClotureOpen}
        onConfirm={handleClotureConfirm}
        isPending={createRetour.isPending}
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-600" />
              {t("Nouveau Bon de Retour", "وصل إرجاع جديد")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("Client (optionnel)", "العميل (اختياري)")}</Label>
                <div className="relative" ref={clientPickerRef}>
                  <button
                    type="button"
                    onClick={() => setClientComboOpen((v) => !v)}
                    className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 h-9 text-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <span className={selectedCustomer ? "text-foreground font-medium" : "text-muted-foreground"}>
                      {(() => { console.log("[CLIENT PICKER] render trigger, selectedCustomer=", selectedCustomer); return selectedCustomer ? selectedCustomer.name : t("Sélectionner un client...", "اختر عميلاً..."); })()}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                  {clientComboOpen && (
                    <div className="absolute z-50 top-full mt-1 left-0 right-0 min-w-[280px] bg-popover border rounded-md shadow-lg overflow-hidden">
                      <div className="flex items-center border-b px-3">
                        <input
                          autoFocus
                          className="flex h-9 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                          placeholder={t("Rechercher...", "بحث...")}
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {!clientSearch.trim() && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent border-b cursor-pointer"
                            onClick={() => { setSelectedCustomer({ id: 0, name: "DIVERS COMPTOIR", email: "" }); setClientComboOpen(false); setClientSearch(""); }}
                          >
                            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="flex flex-col min-w-0 text-left">
                              <span className="font-semibold truncate">DIVERS COMPTOIR</span>
                              <span className="text-xs text-muted-foreground">{t("Client par défaut", "عميل افتراضي")}</span>
                            </div>
                            {(!selectedCustomer || selectedCustomer.id === 0) && <Check className="ml-auto h-4 w-4 text-primary shrink-0" />}
                          </button>
                        )}
                        {customerResults.length === 0 && clientSearch.trim() && (
                          <div className="py-4 text-center text-sm text-muted-foreground">
                            {t("Aucun client trouvé", "لم يتم العثور على عميل")}
                          </div>
                        )}
                        {customerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent border-b cursor-pointer"
                            onClick={() => { console.log("[CLIENT PICKER] before setSelectedCustomer, c=", c); setSelectedCustomer(c); console.log("[CLIENT PICKER] after setSelectedCustomer called, c.name=", c.name); setClientComboOpen(false); setClientSearch(""); }}
                          >
                            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="flex flex-col min-w-0 text-left">
                              <span className="font-medium truncate">{c.name}</span>
                              {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                            </div>
                            {selectedCustomer?.id === c.id && <Check className="ml-auto h-4 w-4 text-primary shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("Motif du retour (optionnel)", "سبب الإرجاع (اختياري)")}</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("Ex: article défectueux...", "مثال: منتج معيب...")}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("Articles", "المنتجات")} ({lines.length})</span>
              <Button size="sm" variant="outline" className="h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => setPickerOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> {t("Ajouter article", "إضافة منتج")}
              </Button>
            </div>

            {lines.length > 0 ? (
              <div className="border rounded overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Désignation", "المنتج")}</TableHead>
                      <TableHead className="text-center w-24">{t("Qté", "الكمية")}</TableHead>
                      <TableHead className="text-right">{t("P.U.", "السعر")}</TableHead>
                      <TableHead className="text-right">{t("Total", "المجموع")}</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.productId}>
                        <TableCell className="text-sm font-medium">{line.designation}</TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min={1}
                            value={line.qty}
                            onChange={(e) => setQty(line.productId, parseInt(e.target.value) || 1)}
                            className="h-7 w-16 text-center text-sm mx-auto"
                          />
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {line.pu.toFixed(2)} {currency}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">
                          {(line.pu * line.qty).toFixed(2)} {currency}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                            onClick={() => removeLine(line.productId)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-amber-50">
                      <TableCell colSpan={3} className="text-right font-semibold text-sm">
                        {t("Total Retour", "إجمالي الإرجاع")}
                      </TableCell>
                      <TableCell className="text-right font-bold text-amber-700">
                        {total.toFixed(2)} {currency}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="border rounded py-8 text-center text-sm text-muted-foreground">
                {t("Aucun article ajouté", "لم يتم إضافة أي منتج")}
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createRetour.isPending}>
              {t("Annuler", "إلغاء")}
            </Button>
            <Button
              onClick={handleCloture}
              disabled={createRetour.isPending || lines.length === 0}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t("Clôturer", "إغلاق")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        products={products}
        onPick={addProduct}
        extraBarcodesMap={extraBarcodesMap}
      />
    </>
  );
}

function ClotureRetourModal({ open, onOpenChange, onConfirm, isPending }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (retourType: string) => void;
  isPending: boolean;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const [selected, setSelected] = useState<"remboursement" | "sans_remboursement" | null>(null);

  React.useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-amber-600" />
            {t("Clôturer le Bon de Retour", "إغلاق وصل الإرجاع")}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("Choisissez le mode de traitement de ce retour :", "اختر طريقة معالجة هذا الإرجاع:")}
        </p>

        <div className="grid grid-cols-2 gap-3 py-2">
          <button
            type="button"
            onClick={() => setSelected("remboursement")}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all text-center ${
              selected === "remboursement"
                ? "border-emerald-500 bg-emerald-50"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <span className="text-2xl">💰</span>
            <span className="text-sm font-semibold text-emerald-700">
              {t("Remboursement", "استرداد المبلغ")}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelected("sans_remboursement")}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all text-center ${
              selected === "sans_remboursement"
                ? "border-gray-500 bg-gray-100"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <span className="text-2xl">🔄</span>
            <span className="text-sm font-semibold text-gray-700">
              {t("Sans remboursement", "بدون استرداد")}
            </span>
          </button>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t("Annuler", "إلغاء")}
          </Button>
          <Button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || isPending}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isPending ? t("Enregistrement...", "جاري الحفظ...") : t("Confirmer", "تأكيد")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

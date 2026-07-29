import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useGetErpCustomers, useGetProducts, type CustomerSummary, type Product } from "@workspace/api-client-react";
import { useLang } from "@/hooks/use-lang";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentStore } from "@/hooks/use-current-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Receipt, Plus, MoreHorizontal, Pencil, Eye, Lock, Trash2, Printer,
  ChevronsUpDown, Check, User, TrendingUp, Search, CheckCircle, XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { ProductPickerDialog } from "@/components/pos/ProductPickerDialog";
import InvoiceDialog from "@/components/InvoiceDialog";
import type { InvoiceData } from "@/components/InvoiceTemplate";

// ─── Types ──────────────────────────────────────────────────────────────────

type SaleOrderStatus = "draft" | "pending" | "processing" | "shipped" | "delivered" | "cancelled";

export type SaleOrder = {
  id: number;
  status: SaleOrderStatus;
  order_source: "bon" | "pos" | "online";
  customer_name: string;
  customer_phone: string;
  user_id: number | null;
  total_amount: string;
  discount_amount: string;
  benefice: string;
  payment_method: string;
  created_at: string;
  updated_at: string;
};

export type SaleOrderItem = {
  id: number;
  product_id: number;
  quantity: number;
  unit_price: string;
  cost_price: string | null;
  product_name_en: string | null;
  product_name_ar: string | null;
  product_reference: string | null;
};

export type SaleOrderDetail = SaleOrder & { items: SaleOrderItem[] };

type EditLine = {
  productId: number;
  designation: string;
  qty: number;
  pu: number;
  puInput?: string; // intermediate string while user is typing (supports comma separator)
};

// ─── API helpers ─────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const getToken = () => localStorage.getItem("midanic_token") ?? "";
const apiHeaders = () => ({
  Authorization: `Bearer ${getToken()}`,
  "Content-Type": "application/json",
});

async function apiGet<T>(url: string): Promise<T> {
  const r = await fetch(`${API_BASE}/api${url}`, { headers: apiHeaders() });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}/api${url}`, { method: "POST", headers: apiHeaders(), body: JSON.stringify(body) });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}/api${url}`, { method: "PUT", headers: apiHeaders(), body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

async function apiDelete<T>(url: string): Promise<T> {
  const r = await fetch(`${API_BASE}/api${url}`, { method: "DELETE", headers: apiHeaders() });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

const SALE_ORDERS_KEY = (
  search?: string, status?: string,
  dateFrom?: string, dateTo?: string,
  orderSource?: string, pmFilter?: string,
  page?: number, pageSize?: number,
) => ["erp-sale-orders", search ?? "", status ?? "", dateFrom ?? "", dateTo ?? "", orderSource ?? "", pmFilter ?? "", page ?? 1, pageSize ?? 25] as const;

// ─── Status helpers ──────────────────────────────────────────────────────────

const statusColor = (s: string) => {
  switch (s) {
    case "draft":      return "bg-blue-50 text-blue-600 border-blue-200";
    case "delivered":  return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "cancelled":  return "bg-red-100 text-red-700 border-red-200";
    case "processing": return "bg-amber-100 text-amber-700 border-amber-200";
    default:           return "bg-gray-100 text-gray-700 border-gray-200";
  }
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SaleOrders() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const { can } = usePermissions();
  const canViewProfit = can("orders", "view_profit");
  const store = useCurrentStore();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [orderSource, setOrderSource] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<SaleOrderDetail | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewingOrder, setViewingOrder] = useState<SaleOrderDetail | null>(null);
  const [clotureOrder, setClotureOrder] = useState<SaleOrder | null>(null);
  const [cancelOrder, setCancelOrder] = useState<SaleOrder | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<SaleOrderDetail | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [showTva, setShowTva] = useState(false);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever any filter changes
  React.useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, dateFrom, dateTo, orderSource, paymentMethodFilter, pageSize]);

  const { data: listData, isLoading } = useQuery({
    queryKey: SALE_ORDERS_KEY(debouncedSearch || undefined, statusFilter || undefined, dateFrom || undefined, dateTo || undefined, orderSource || undefined, paymentMethodFilter || undefined, page, pageSize),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter) params.set("status", statusFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (orderSource) params.set("orderSource", orderSource);
      if (paymentMethodFilter) params.set("paymentMethod", paymentMethodFilter);
      return apiGet<{ data: SaleOrder[]; total: number; page: number; limit: number }>(`/erp/sale-orders?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const orders = listData?.data ?? [];
  const totalCount = listData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const createMutation = useMutation({
    mutationFn: (payload: { customerUserId?: number | null; customerName?: string; customerPhone?: string; items: { productId: number; quantity: number; unitPrice: number }[]; notes?: string }) =>
      apiPost<{ id: number }>("/erp/sale-orders", payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["erp-sale-orders"] }); setEditorOpen(false); },
    onError: (err: Error) => alert(`Erreur: ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: unknown }) =>
      apiPut(`/erp/sale-orders/${id}`, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["erp-sale-orders"] }); setEditorOpen(false); },
    onError: (err: Error) => alert(`Erreur: ${err.message}`),
  });

  const clotureMutation = useMutation({
    mutationFn: (id: number) => apiPut(`/erp/sale-orders/${id}/cloture`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["erp-sale-orders"] }); setClotureOrder(null); },
    onError: (err: Error) => alert(`Erreur: ${err.message}`),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiPut(`/erp/sale-orders/${id}/cancel`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["erp-sale-orders"] }); setCancelOrder(null); },
    onError: (err: Error) => alert(`Erreur: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/erp/sale-orders/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["erp-sale-orders"] }); },
    onError: (err: Error) => alert(`Erreur: ${err.message}`),
  });

  const openCreate = () => { setEditingOrder(null); setEditorOpen(true); };

  const openEdit = async (order: SaleOrder) => {
    const detail = await apiGet<SaleOrderDetail>(`/erp/sale-orders/${order.id}`);
    setEditingOrder(detail);
    setEditorOpen(true);
  };

  const openView = async (order: SaleOrder) => {
    const detail = await apiGet<SaleOrderDetail>(`/erp/sale-orders/${order.id}`);
    setViewingOrder(detail);
    setViewOpen(true);
  };

  const openPrint = async (order: SaleOrder) => {
    const detail = await apiGet<SaleOrderDetail>(`/erp/sale-orders/${order.id}`);
    setInvoiceOrder(detail);
    setShowTva(!!store?.showTvaByDefault);
    setInvoiceOpen(true);
  };

  const invoiceData: InvoiceData | null = React.useMemo(() => {
    if (!invoiceOrder) return null;
    return {
      kind: "sale",
      number: `BV-${String(invoiceOrder.id).padStart(6, "0")}`,
      date: invoiceOrder.created_at ? new Date(invoiceOrder.created_at) : new Date(),
      store,
      party: {
        name: invoiceOrder.customer_name,
        address: "",
        phone: invoiceOrder.customer_phone,
      },
      lines: (invoiceOrder.items ?? []).map((it) => ({
        designation: (it.product_name_en || it.product_name_ar || "—").toUpperCase(),
        reference: it.product_reference ?? null,
        qty: it.quantity,
        unitPrice: parseFloat(it.unit_price),
      })),
      showTva,
      tvaRate: parseFloat(store?.tvaRate ?? "19"),
    };
  }, [invoiceOrder, store, showTva]);

  const statusLabels: Record<string, string> = {
    draft:      t("Brouillon", "مسودة"),
    pending:    t("En cours", "قيد التنفيذ"),
    processing: t("En traitement", "جاري المعالجة"),
    shipped:    t("Expédié", "تم الشحن"),
    delivered:  t("Clôturé", "مُغلق"),
    cancelled:  t("Annulé", "ملغي"),
  };

  const totalBenefice = orders.reduce((s, o) => s + parseFloat(o.benefice ?? "0"), 0);
  const totalCA = orders.reduce((s, o) => s + parseFloat(o.total_amount ?? "0"), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Receipt className="h-6 w-6 text-[#1B3057]" />
            {t("Bons de Vente", "بونات البيع")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("Gestion des bons de vente formels", "إدارة بونات البيع الرسمية")}
          </p>
        </div>
        <Button className="bg-[#1B3057] hover:bg-[#1B3057]/90 text-white" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t("Nouveau bon", "بون جديد")}
        </Button>
      </div>

      {/* KPIs */}
      <div className={`grid ${canViewProfit ? "grid-cols-3" : "grid-cols-2"} gap-4`}>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("Total bons", "إجمالي البونات")}</p>
          <p className="text-2xl font-bold mt-1">{totalCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("Chiffre d'affaires", "رقم الأعمال")}</p>
          <p className="text-2xl font-bold mt-1">{totalCA.toFixed(2)} <span className="text-sm font-normal">{currency}</span></p>
        </div>
        {canViewProfit && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-emerald-600" />
            {t("Bénéfice total", "الربح الإجمالي")}
          </p>
          <p className={`text-2xl font-bold mt-1 ${totalBenefice >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {totalBenefice.toFixed(2)} <span className="text-sm font-normal">{currency}</span>
          </p>
        </div>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("Rechercher (client, N°)...", "بحث (عميل، رقم)...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs pl-7 w-56"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 text-xs border rounded-md px-2 bg-background"
          >
            <option value="">{t("Tous les états", "جميع الحالات")}</option>
            <option value="draft">{t("Brouillons", "مسودات")}</option>
            <option value="pending">{t("En cours", "قيد التنفيذ")}</option>
            <option value="delivered">{t("Clôturés", "مُغلقة")}</option>
            <option value="cancelled">{t("Annulés", "ملغية")}</option>
          </select>
          <select
            value={orderSource}
            onChange={(e) => setOrderSource(e.target.value)}
            className="h-8 text-xs border rounded-md px-2 bg-background"
          >
            <option value="">{t("Tous les types", "جميع الأنواع")}</option>
            <option value="bon">{t("Bon de vente", "بون بيع")}</option>
            <option value="pos">{t("Vente rapide", "بيع سريع")}</option>
            <option value="online">{t("En ligne", "إنترنت")}</option>
          </select>
          <select
            value={paymentMethodFilter}
            onChange={(e) => setPaymentMethodFilter(e.target.value)}
            className="h-8 text-xs border rounded-md px-2 bg-background"
          >
            <option value="">{t("Tout paiement", "جميع طرق الدفع")}</option>
            <option value="comptant">{t("Comptant", "نقداً")}</option>
            <option value="a_terme">{t("À terme", "آجل")}</option>
          </select>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-xs text-muted-foreground">{t("Du", "من")}</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 text-xs border rounded-md px-2 bg-background"
          />
          <label className="text-xs text-muted-foreground">{t("Au", "إلى")}</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 text-xs border rounded-md px-2 bg-background"
          />
          {(dateFrom || dateTo || orderSource || paymentMethodFilter || statusFilter) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); setOrderSource(""); setPaymentMethodFilter(""); setStatusFilter(""); }}
              className="h-8 text-xs px-2 text-muted-foreground hover:text-foreground border rounded-md bg-background"
            >
              {t("Réinitialiser", "إعادة ضبط")}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs">{t("N°", "رقم")}</TableHead>
              <TableHead className="text-xs">{t("Type", "النوع")}</TableHead>
              <TableHead className="text-xs">{t("Client", "العميل")}</TableHead>
              <TableHead className="text-xs">{t("Date", "التاريخ")}</TableHead>
              <TableHead className="text-xs text-right">{t("Montant", "المبلغ")}</TableHead>
              {canViewProfit && <TableHead className="text-xs text-right">{t("Bénéfice", "الربح")}</TableHead>}
              <TableHead className="text-xs">{t("État", "الحالة")}</TableHead>
              <TableHead className="text-xs w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(8)].map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            )}
            {!isLoading && orders.map((order) => {
              const isPos    = order.order_source === "pos";
              const isOnline = order.order_source === "online";
              const isDraft = order.status === "draft";
              const isDelivered = order.status === "delivered";
              const isCancelled = order.status === "cancelled";
              const isPending = order.status === "pending" || order.status === "processing";
              // online orders are read-only for editing; they can be confirmed or cancelled
              const canEdit    = !isOnline && (isDraft || !isPos) && !isDelivered && !isCancelled;
              const canCloture = (isDraft || isPending) && !isCancelled;
              const canCancel  = isOnline && (isPending || isDraft) && !isCancelled;
              const benefice = parseFloat(order.benefice ?? "0");
              const prefix = isOnline ? "WS" : isPos ? "VR" : "BV";

              const typeBadge = isOnline
                ? { cls: "bg-violet-50 text-violet-700 border-violet-200", label: t("En ligne", "إنترنت") }
                : isPos
                  ? { cls: "bg-blue-50 text-blue-700 border-blue-200", label: t("Vente rapide", "بيع سريع") }
                  : { cls: "bg-slate-50 text-slate-600 border-slate-200", label: t("Bon de vente", "بون بيع") };

              return (
                <TableRow key={order.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium text-[#1B3057] text-sm">
                    {prefix}-{String(order.id).padStart(5, "0")}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${typeBadge.cls}`}>
                      {typeBadge.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{order.customer_name}</div>
                    {order.customer_phone && (
                      <div className="text-xs text-muted-foreground">{order.customer_phone}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {order.created_at ? format(new Date(order.created_at), "dd/MM/yyyy HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-sm">
                    {parseFloat(order.total_amount).toFixed(2)} {currency}
                  </TableCell>
                  {canViewProfit && (
                  <TableCell className="text-right text-sm">
                    <span className={benefice >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                      {benefice >= 0 ? "+" : ""}{benefice.toFixed(2)} {currency}
                    </span>
                  </TableCell>
                  )}
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${statusColor(order.status)}`}>
                      {isDelivered && <Lock className="h-2.5 w-2.5" />}
                      {statusLabels[order.status] ?? order.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openView(order)}>
                          <Eye className="h-3.5 w-3.5 mr-2" /> {t("Voir", "عرض")}
                        </DropdownMenuItem>
                        {canEdit && (
                          <DropdownMenuItem onClick={() => openEdit(order)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> {t("Modifier", "تعديل")}
                          </DropdownMenuItem>
                        )}
                        {canCloture && (
                          <DropdownMenuItem
                            onClick={() => setClotureOrder(order)}
                            className="text-emerald-700 focus:text-emerald-700"
                          >
                            {isOnline
                              ? <><CheckCircle className="h-3.5 w-3.5 mr-2" /> {t("Confirmer", "تأكيد")}</>
                              : <><Lock className="h-3.5 w-3.5 mr-2" /> {t("Clôturer", "إغلاق")}</>
                            }
                          </DropdownMenuItem>
                        )}
                        {canCancel && (
                          <DropdownMenuItem
                            onClick={() => setCancelOrder(order)}
                            className="text-red-600 focus:text-red-600"
                          >
                            <XCircle className="h-3.5 w-3.5 mr-2" /> {t("Annuler", "إلغاء الطلب")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => openPrint(order)}>
                          <Printer className="h-3.5 w-3.5 mr-2" /> {t("Imprimer", "طباعة")}
                        </DropdownMenuItem>
                        {canEdit && (
                          <DropdownMenuItem
                            onClick={() => {
                              if (confirm(t(`Supprimer BV-${String(order.id).padStart(5, "0")} ?`, `حذف البون؟`))) {
                                deleteMutation.mutate(order.id);
                              }
                            }}
                            className="text-red-600 focus:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> {t("Supprimer", "حذف")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            {!isLoading && orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  <Receipt className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>{t("Aucune vente enregistrée", "لا توجد مبيعات مسجلة")}</p>
                  <p className="text-xs mt-1">{t('Cliquez sur "+ Nouveau bon" pour commencer', 'انقر على "+ بون جديد" للبدء')}</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <span className="text-sm text-muted-foreground">
          {totalCount === 0
            ? t("Aucun bon trouvé", "لا توجد بونات")
            : t(
                `Affichage ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} sur ${totalCount} bon(s)`,
                `عرض ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} من ${totalCount}`,
              )}
        </span>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t("Lignes :", "الصفوف:")}</span>
            <select
              value={String(pageSize)}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-8 text-xs border rounded-md px-2 bg-background"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={String(n)}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="sm" className="h-8 px-2 text-xs"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              {t("← Préc.", "→ السابق")}
            </Button>
            {(() => {
              const pages: (number | "...")[] = [];
              if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) pages.push(i);
              } else {
                pages.push(1);
                if (page > 3) pages.push("...");
                for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
                if (page < totalPages - 2) pages.push("...");
                pages.push(totalPages);
              }
              return pages.map((pg, i) =>
                pg === "..." ? (
                  <span key={`e${i}`} className="px-1 text-muted-foreground text-xs select-none">…</span>
                ) : (
                  <Button
                    key={pg}
                    variant={pg === page ? "default" : "outline"}
                    size="sm"
                    className={`h-8 w-8 p-0 text-xs ${pg === page ? "bg-[#1B3057] hover:bg-[#1B3057]/90" : ""}`}
                    onClick={() => setPage(pg as number)}
                  >
                    {pg}
                  </Button>
                )
              );
            })()}
            <Button
              variant="outline" size="sm" className="h-8 px-2 text-xs"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              {t("Suiv. →", "التالي ←")}
            </Button>
          </div>
        </div>
      </div>

      {/* Editor dialog */}
      <SaleOrderEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editingOrder}
        isSaving={createMutation.isPending || updateMutation.isPending}
        onSave={(payload) => {
          if (editingOrder) {
            updateMutation.mutate({ id: editingOrder.id, payload });
          } else {
            createMutation.mutate(payload as Parameters<typeof createMutation.mutate>[0]);
          }
        }}
      />

      {/* View dialog */}
      <SaleOrderViewDialog
        open={viewOpen}
        onOpenChange={setViewOpen}
        order={viewingOrder}
      />

      {/* Clôture / Confirmer dialog */}
      <ClotureDialog
        open={!!clotureOrder}
        onOpenChange={(o) => { if (!o) setClotureOrder(null); }}
        order={clotureOrder}
        onConfirm={() => clotureOrder && clotureMutation.mutate(clotureOrder.id)}
        isPending={clotureMutation.isPending}
      />

      {/* Cancel online order dialog */}
      <CancelOrderDialog
        open={!!cancelOrder}
        onOpenChange={(o) => { if (!o) setCancelOrder(null); }}
        order={cancelOrder}
        onConfirm={() => cancelOrder && cancelMutation.mutate(cancelOrder.id)}
        isPending={cancelMutation.isPending}
      />

      {/* Invoice */}
      <InvoiceDialog
        open={invoiceOpen}
        onOpenChange={(o) => { setInvoiceOpen(o); if (!o) setInvoiceOrder(null); }}
        data={invoiceData}
        onShowTvaChange={setShowTva}
      />
    </div>
  );
}

// ─── SaleOrderEditor ──────────────────────────────────────────────────────────

function SaleOrderEditor({ open, onOpenChange, editing, onSave, isSaving }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: SaleOrderDetail | null;
  onSave: (payload: { customerUserId?: number | null; customerName?: string; items: { productId: number; quantity: number; unitPrice: number }[]; paymentMethod: string }) => void;
  isSaving: boolean;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  const { data: productsResp } = useGetProducts({ limit: 9999 });
  const products: Product[] = useMemo(() => (productsResp?.products ?? []) as Product[], [productsResp]);

  const [lines, setLines] = useState<EditLine[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [clientComboOpen, setClientComboOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"comptant" | "a_terme">("comptant");
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [pendingEditIdx, setPendingEditIdx] = useState<number | null>(null);
  const [lineSearch, setLineSearch] = useState("");
  const clientPickerRef = React.useRef<HTMLDivElement>(null);

  const { data: _custRes } = useGetErpCustomers(
    clientSearch.trim().length > 0 ? { search: clientSearch.trim(), limit: 20 } : { limit: 20 }
  );
  const customerResults = _custRes?.data ?? [];

  // Reset on open
  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setLines(
        (editing.items ?? []).map((it) => ({
          productId: it.product_id,
          designation: (it.product_name_en || it.product_name_ar || `#${it.product_id}`).toUpperCase(),
          qty: it.quantity,
          pu: parseFloat(it.unit_price),
        }))
      );
      if (editing.user_id) {
        setSelectedCustomer({ id: editing.user_id, name: editing.customer_name, email: "", phone: editing.customer_phone });
      } else if (editing.customer_name && editing.customer_name !== "DIVERS COMPTOIR") {
        setSelectedCustomer({ id: 0, name: editing.customer_name, email: "", phone: editing.customer_phone });
      } else {
        setSelectedCustomer(null);
      }
      setPaymentMethod((editing?.payment_method as "comptant" | "a_terme") ?? "comptant");
    } else {
      setLines([]);
      setSelectedCustomer(null);
      setClientSearch("");
      setCodeInput("");
      setPaymentMethod("comptant");
    }
    setClientComboOpen(false);
    setLineSearch("");
  }, [open, editing]);

  // Close customer picker on outside click
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

  const addProductWithValues = (p: Product, { qty, pu }: { qty: number; pu: number }) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + qty, pu };
        return next;
      }
      return [...prev, {
        productId: p.id,
        designation: (lang === "ar" ? (p.nameAr || p.nameEn) : (p.nameEn || p.nameAr) || `#${p.id}`).toUpperCase(),
        qty,
        pu,
      }];
    });
    setCodeInput("");
  };

  const selectProduct = (p: Product) => {
    setPickerOpen(false);
    setPendingProduct(p);
  };

  const tryAddByCode = (raw: string) => {
    const tok = raw.trim().toLowerCase();
    if (!tok) { setPickerOpen(true); return; }
    const byId = products.find((p) => String(p.id) === tok);
    if (byId) { selectProduct(byId); return; }
    const byBarcode = products.find((p) => (p.barcode ?? "").toLowerCase() === tok || (p.reference ?? "").toLowerCase() === tok);
    if (byBarcode) { selectProduct(byBarcode); return; }
    setPickerOpen(true);
  };

  const updateLine = (idx: number, patch: Partial<EditLine>) =>
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const subtotal = lines.reduce((s, l) => s + l.pu * l.qty, 0);

  const handleSave = () => {
    if (lines.length === 0) { alert(t("Ajoutez au moins un article", "أضف مقالاً واحداً على الأقل")); return; }
    onSave({
      customerUserId: selectedCustomer && selectedCustomer.id !== 0 ? selectedCustomer.id : null,
      customerName: selectedCustomer?.name,
      items: lines.map((l) => ({ productId: l.productId, quantity: l.qty, unitPrice: l.pu })),
      paymentMethod,
    });
  };

  const isEditing = !!editing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0">
        {/* Header */}
        <div className="bg-[#1B3057] text-white px-5 py-3">
          <DialogHeader>
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              {isEditing
                ? `${t("Modifier bon", "تعديل بون")} BV-${String(editing.id).padStart(5, "0")}`
                : t("Nouveau Bon de Vente", "بون بيع جديد")}
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="p-5 space-y-5">
          {/* Payment method */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("Mode de paiement", "طريقة الدفع")}</Label>
            <div className="flex gap-3">
              {(["comptant", "a_terme"] as const).map((m) => (
                <label
                  key={m}
                  className={`flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ${
                    paymentMethod === m
                      ? m === "comptant"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-medium"
                        : "border-amber-500 bg-amber-50 text-amber-700 font-medium"
                      : "border-input bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={m}
                    checked={paymentMethod === m}
                    onChange={() => setPaymentMethod(m)}
                    className="sr-only"
                  />
                  {m === "comptant"
                    ? t("💵 Comptant", "💵 نقداً")
                    : t("📋 À terme (crédit client)", "📋 بالآجل (رصيد عميل)")}
                </label>
              ))}
            </div>
            {paymentMethod === "a_terme" && !selectedCustomer && (
              <p className="text-xs text-amber-600 mt-1">
                {t("⚠️ Sélectionnez un client pour enregistrer en compte", "⚠️ اختر عميلاً لتسجيل الآجل في رصيده")}
              </p>
            )}
          </div>

          {/* Customer */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("Client", "العميل")}</Label>
              <div className="relative" ref={clientPickerRef}>
                <button
                  type="button"
                  onClick={() => setClientComboOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 h-9 text-sm hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <span className={selectedCustomer ? "text-foreground font-medium" : "text-muted-foreground"}>
                    {selectedCustomer ? selectedCustomer.name : t("Sélectionner un client...", "اختر عميلاً...")}
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
                            <span className="font-semibold">DIVERS COMPTOIR</span>
                            <span className="text-xs text-muted-foreground">{t("Client par défaut", "عميل افتراضي")}</span>
                          </div>
                          {(!selectedCustomer || selectedCustomer.id === 0) && <Check className="ml-auto h-4 w-4 text-primary shrink-0" />}
                        </button>
                      )}
                      {customerResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent border-b cursor-pointer"
                          onClick={() => { setSelectedCustomer(c); setClientComboOpen(false); setClientSearch(""); }}
                        >
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div className="flex flex-col min-w-0 text-left">
                            <span className="font-medium truncate">{c.name}</span>
                            {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                          </div>
                          {selectedCustomer?.id === c.id && <Check className="ml-auto h-4 w-4 text-primary shrink-0" />}
                        </button>
                      ))}
                      {customerResults.length === 0 && clientSearch.trim() && (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                          {t("Aucun client trouvé", "لم يتم العثور على عميل")}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("Code / Référence article", "كود / مرجع المنتج")}</Label>
              <div className="flex gap-2">
                <Input
                  placeholder={t("Scanner ou saisir code...", "مسح أو إدخال كود...")}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { tryAddByCode(codeInput); } }}
                  className="h-9 text-sm"
                />
                <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => setPickerOpen(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Lines table */}
          {lines.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={lineSearch}
                onChange={(e) => setLineSearch(e.target.value)}
                placeholder={t("Rechercher dans les lignes…", "بحث في السطور…")}
                className="w-full pl-8 pr-3 py-1.5 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-[#1B3057]/40"
              />
            </div>
          )}
          {lines.length > 0 ? (
            <div className="border rounded overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="text-xs">{t("Désignation", "المنتج")}</TableHead>
                    <TableHead className="text-xs text-center w-24">{t("Qté", "الكمية")}</TableHead>
                    <TableHead className="text-xs text-right w-32">{t("Prix unitaire", "السعر")}</TableHead>
                    <TableHead className="text-xs text-right w-32">{t("Total", "المجموع")}</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.filter((line) => !lineSearch.trim() || line.designation.toLowerCase().includes(lineSearch.trim().toLowerCase())).map((line, _filteredIdx) => {
                    const idx = lines.indexOf(line);
                    return (
                    <TableRow
                      key={line.productId}
                      className="cursor-pointer hover:bg-[#1B3057]/5"
                      onClick={() => {
                        const prod = products.find((p) => p.id === line.productId) ?? null;
                        setPendingEditIdx(idx);
                        setPendingProduct(prod ?? { id: line.productId, nameEn: line.designation, nameAr: line.designation, price: String(line.pu) } as Product);
                      }}
                    >
                      <TableCell className="text-sm font-medium">{line.designation}</TableCell>
                      <TableCell className="text-center text-sm">{line.qty}</TableCell>
                      <TableCell className="text-right text-sm">{line.pu.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {(line.pu * line.qty).toFixed(2)} {currency}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                          onClick={(e) => { e.stopPropagation(); removeLine(idx); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ); })}
                  <TableRow className="bg-[#1B3057]/5">
                    <TableCell colSpan={3} className="text-right font-bold text-sm">
                      {t("Total", "المجموع الكلي")}
                    </TableCell>
                    <TableCell className="text-right font-bold text-[#1B3057]">
                      {subtotal.toFixed(2)} {currency}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="border-2 border-dashed rounded-lg py-12 text-center text-muted-foreground">
              <Receipt className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{t("Aucun article ajouté", "لم يتم إضافة أي منتج")}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setPickerOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> {t("Ajouter un article", "إضافة منتج")}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="px-5 pb-5 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("Annuler", "إلغاء")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || lines.length === 0}
            className="bg-[#1B3057] hover:bg-[#1B3057]/90 text-white"
          >
            {isSaving ? t("Enregistrement...", "جاري الحفظ...") : t("Enregistrer le bon", "حفظ البون")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        products={products}
        onPick={selectProduct}
        extraBarcodesMap={new Map()}
      />

      <AddLineBvDialog
        product={pendingProduct}
        initialQty={pendingEditIdx !== null ? lines[pendingEditIdx]?.qty : undefined}
        initialPu={pendingEditIdx !== null ? lines[pendingEditIdx]?.pu : undefined}
        isEdit={pendingEditIdx !== null}
        onConfirm={({ qty, pu }) => {
          if (pendingEditIdx !== null) {
            updateLine(pendingEditIdx, { qty, pu });
          } else if (pendingProduct) {
            addProductWithValues(pendingProduct, { qty, pu });
          }
          setPendingProduct(null);
          setPendingEditIdx(null);
        }}
        onCancel={() => { setPendingProduct(null); setPendingEditIdx(null); }}
      />
    </Dialog>
  );
}

// ─── Add Line BV Dialog ───────────────────────────────────────────────────────
function AddLineBvDialog({
  product, onConfirm, onCancel, initialQty, initialPu, isEdit,
}: {
  product: Product | null;
  onConfirm: (vals: { qty: number; pu: number }) => void;
  onCancel: () => void;
  initialQty?: number;
  initialPu?: number;
  isEdit?: boolean;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  const [qty, setQty] = useState("1");
  const [pu, setPu] = useState("0");
  const qtyRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!product) return;
    setQty(initialQty !== undefined ? String(initialQty) : "1");
    setPu(initialPu !== undefined ? String(initialPu) : (product.price ?? "0"));
    setTimeout(() => { qtyRef.current?.focus(); qtyRef.current?.select(); }, 50);
  }, [product, initialQty, initialPu]);

  function handleConfirm() {
    const qtyN = Math.max(1, parseFloat(qty) || 1);
    const puN = Math.max(0, parseFloat(pu) || 0);
    onConfirm({ qty: qtyN, pu: puN });
  }

  return (
    <Dialog open={!!product} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-base">
            {isEdit ? t("Modifier l'article", "تعديل المنتج") : t("Ajouter l'article", "إضافة المنتج")}
          </DialogTitle>
        </DialogHeader>

        {product && (
          <div className="rounded-md bg-slate-50 border px-3 py-2 text-sm mb-1">
            <p className="font-semibold uppercase leading-tight">{product.nameEn || product.nameAr}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {product.reference ?? product.barcode ?? `#${product.id}`}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs mb-1 block">{t("Qté", "الكمية")}</Label>
            <Input
              ref={qtyRef}
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="h-9"
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t("PU (Vente)", "سعر البيع")}</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={pu}
              onChange={(e) => setPu(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="h-9"
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
            />
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            {t("Annuler", "إلغاء")}
          </Button>
          <Button onClick={handleConfirm} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="h-4 w-4 mr-1.5" />
            {isEdit ? t("Modifier", "تعديل") : t("Ajouter", "إضافة")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── View dialog ──────────────────────────────────────────────────────────────

export function SaleOrderViewDialog({ open, onOpenChange, order }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  order: SaleOrderDetail | null;
}) {
  const { lang } = useLang();
  const { can } = usePermissions();
  const canViewProfit = can("orders", "view_profit");
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  if (!order) return null;

  const total = parseFloat(order.total_amount);
  const benefice = parseFloat(order.benefice ?? "0");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-[#1B3057]" />
            {t("Bon de vente", "بون بيع")} BV-{String(order.id).padStart(5, "0")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t("Client : ", "العميل: ")}</span>
              <span className="font-medium">{order.customer_name}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("Date : ", "التاريخ: ")}</span>
              <span>{order.created_at ? format(new Date(order.created_at), "dd/MM/yyyy HH:mm") : "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("État : ", "الحالة: ")}</span>
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${statusColor(order.status)}`}>
                {order.status === "delivered" ? t("Clôturé", "مُغلق") : order.status}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("Téléphone : ", "الهاتف: ")}</span>
              <span>{order.customer_phone || "—"}</span>
            </div>
          </div>

          <div className="border rounded overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="text-xs">{t("Article", "المنتج")}</TableHead>
                  <TableHead className="text-xs text-center">{t("Qté", "الكمية")}</TableHead>
                  <TableHead className="text-xs text-right">{t("P.U.", "السعر")}</TableHead>
                  <TableHead className="text-xs text-right">{t("Total", "المجموع")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(order.items ?? []).map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="text-sm font-medium">
                      {(it.product_name_en || it.product_name_ar || `#${it.product_id}`).toUpperCase()}
                    </TableCell>
                    <TableCell className="text-center text-sm">{it.quantity}</TableCell>
                    <TableCell className="text-right text-sm">{parseFloat(it.unit_price).toFixed(2)} {currency}</TableCell>
                    <TableCell className="text-right text-sm font-semibold">
                      {(it.quantity * parseFloat(it.unit_price)).toFixed(2)} {currency}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/20">
                  <TableCell colSpan={3} className="text-right font-bold text-sm">{t("Total", "المجموع")}</TableCell>
                  <TableCell className="text-right font-bold">{total.toFixed(2)} {currency}</TableCell>
                </TableRow>
                {canViewProfit && (
                <TableRow>
                  <TableCell colSpan={3} className="text-right text-sm text-muted-foreground">
                    <span className="flex items-center justify-end gap-1">
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                      {t("Bénéfice estimé", "الربح التقديري")}
                    </span>
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${benefice >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {benefice >= 0 ? "+" : ""}{benefice.toFixed(2)} {currency}
                  </TableCell>
                </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Fermer", "إغلاق")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Clôture confirm dialog ───────────────────────────────────────────────────

function ClotureDialog({ open, onOpenChange, order, onConfirm, isPending }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  order: SaleOrder | null;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  const isOnline = order?.order_source === "online";
  const isComptant = !order || order.payment_method !== "a_terme";
  const amount = order ? parseFloat(order.total_amount).toFixed(2) : "0.00";

  const paymentSummary = isComptant
    ? t(`💵 ${amount} ${currency} seront crédités à votre caisse.`, `💵 سيتم إضافة ${amount} ${currency} إلى صندوقك.`)
    : t(`📋 ${amount} ${currency} seront enregistrés en compte client (crédit).`, `📋 سيتم تسجيل ${amount} ${currency} في رصيد العميل (آجل).`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isOnline
              ? <CheckCircle className="h-5 w-5 text-emerald-600" />
              : <Lock className="h-5 w-5 text-emerald-600" />
            }
            {isOnline
              ? t("Confirmer la commande en ligne", "تأكيد الطلب الإلكتروني")
              : t("Clôturer le bon", "إغلاق البون")
            }
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            {isOnline
              ? t(
                  "Cette action va confirmer la commande, déduire les quantités du stock et enregistrer le paiement.",
                  "سيتم تأكيد الطلب وخصم الكميات من المخزون وتسجيل الدفعة."
                )
              : t(
                  "Cette action va marquer le bon comme livré et déduire les quantités du stock.",
                  "سيتم تعليم البون كمُسلَّم وخصم الكميات من المخزون."
                )
            }
          </p>
          <div className={`rounded-md border px-3 py-2 text-sm font-medium ${
            isComptant ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"
          }`}>
            {paymentSummary}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Cette opération est irréversible.", "هذه العملية لا يمكن التراجع عنها.")}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t("Annuler", "إلغاء")}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isPending
              ? t("En cours...", "جاري التنفيذ...")
              : isOnline
                ? t("Confirmer", "تأكيد الطلب")
                : t("Confirmer la clôture", "تأكيد الإغلاق")
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CancelOrderDialog ────────────────────────────────────────────────────────

function CancelOrderDialog({ open, onOpenChange, order, onConfirm, isPending }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  order: SaleOrder | null;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const ref = order ? `WS-${String(order.id).padStart(5, "0")}` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <XCircle className="h-5 w-5" />
            {t("Annuler la commande", "إلغاء الطلب")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            {t(
              `Voulez-vous vraiment annuler la commande ${ref} ?`,
              `هل تريد فعلاً إلغاء الطلب ${ref}؟`
            )}
          </p>
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {t(
              "La commande sera marquée comme annulée. Le stock ne sera pas modifié (aucun article n'avait été déduit).",
              "سيتم تعليم الطلب كملغي. لن يتغير المخزون (لم يُخصم أي صنف بعد)."
            )}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t("Retour", "رجوع")}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            variant="destructive"
          >
            {isPending ? t("Annulation...", "جاري الإلغاء...") : t("Confirmer l'annulation", "تأكيد الإلغاء")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

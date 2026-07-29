import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { useCurrentStore } from "@/hooks/use-current-store";
import { useGetSuppliers } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose,
} from "@/components/ui/drawer";
import {
  ShoppingBasket, SlidersHorizontal, X, History, CheckCircle2,
  Package, Search, RefreshCw, MapPin, Phone, TrendingUp, ShoppingCart,
  LayoutGrid, List, Ban, Printer,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
type SortBy = "profit" | "qty_sold";
type StockFilter = "all" | "rupture" | "low";

type NeededRow = {
  id: number;
  designation: string;
  designation_ar: string;
  image_url: string | null;
  stock: number;
  min_stock: number | null;
  cost_price: string | null;
  price: string | null;
  reference: string | null;
  famille: string | null;
  famille_ar: string | null;
  marque: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_city: string | null;
  supplier_phone: string | null;
  benefice: number;
  total_qty_sold: number;
};

type HistoryRow = {
  po_id: number;
  received_date: string;
  supplier_name: string;
  supplier_address: string | null;
  supplier_phone: string | null;
  unit_cost: number;
  quantity: number;
  image_url: string | null;
  product_name: string;
  product_name_ar: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("midanic_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchNeeded(params: Record<string, string>): Promise<NeededRow[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/api/erp/purchases/needed${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("fetch needed failed");
  return res.json() as Promise<NeededRow[]>;
}

async function fetchHistory(productId: number): Promise<HistoryRow[]> {
  const res = await fetch(`${API_BASE}/api/erp/purchases/history/${productId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("fetch history failed");
  return res.json() as Promise<HistoryRow[]>;
}

async function postSnooze(productId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/erp/purchases/snooze/${productId}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("snooze failed");
}

async function postExclude(productId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/erp/purchases/exclude/${productId}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("exclude failed");
}

type FilterOptions = {
  families: Array<{ id: number; nameFr: string; nameAr: string }>;
  brands: Array<{ id: number; nameFr: string; nameAr: string }>;
  supplierCities: string[];
};

async function fetchFilterOptions(): Promise<FilterOptions> {
  const res = await fetch(`${API_BASE}/api/erp/purchases/filter-options`, { headers: authHeaders() });
  if (!res.ok) throw new Error("filter-options failed");
  return res.json() as Promise<FilterOptions>;
}

async function postQuickOrder(body: {
  supplierId: number; items: Array<{ productId: number; quantity: number; unitCost: number }>; paymentMethod: "comptant" | "a_terme";
}): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/erp/purchase-orders`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, notes: "" }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error ?? "Erreur");
  }
  return res.json() as Promise<{ id: number }>;
}

type DraftPO = {
  id: number;
  supplierId: number | null;
  paymentMethod: "comptant" | "a_terme";
  notes: string | null;
  status: string;
  totalAmount: string;
  createdAt: string;
};

type POItem = {
  productId: number;
  quantity: number;
  unitCost: string | number;
};

async function fetchDraftPOs(): Promise<DraftPO[]> {
  const res = await fetch(`${API_BASE}/api/erp/purchase-orders?status=pending&limit=500`, { headers: authHeaders() });
  if (!res.ok) throw new Error("fetch draft POs failed");
  const json = await res.json() as { data: DraftPO[] };
  return json.data ?? [];
}

async function fetchPOItems(poId: number): Promise<POItem[]> {
  const res = await fetch(`${API_BASE}/api/erp/purchase-orders/${poId}/items`, { headers: authHeaders() });
  if (!res.ok) throw new Error("fetch PO items failed");
  return res.json() as Promise<POItem[]>;
}

async function putAddToPO(
  poId: number,
  po: { supplierId: number; paymentMethod: "comptant" | "a_terme"; notes: string | null },
  newItem: { productId: number; quantity: number; unitCost: number },
  existingItems: POItem[],
): Promise<{ id: number; itemCount: number; merged: boolean }> {
  // Merge quantities if the product already exists in the bon
  let merged = false;
  const allItems = existingItems.map(i => {
    if (i.productId === newItem.productId) {
      merged = true;
      return {
        productId: i.productId,
        quantity: Number(i.quantity) + newItem.quantity,
        unitCost: newItem.unitCost, // use the newly entered price
      };
    }
    return { productId: i.productId, quantity: Number(i.quantity), unitCost: Number(i.unitCost) };
  });
  if (!merged) {
    allItems.push(newItem);
  }
  const res = await fetch(`${API_BASE}/api/erp/purchase-orders/${poId}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      supplierId: po.supplierId,
      items: allItems,
      paymentMethod: po.paymentMethod,
      notes: po.notes ?? "",
    }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error ?? "Erreur");
  }
  return { id: poId, itemCount: allItems.length, merged };
}

function resolveImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return url;
}

function fmtNum(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (isNaN(v)) return "—";
  return v.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string): string {
  try { return new Date(d).toLocaleDateString("fr-DZ"); } catch { return d; }
}

/** Format a Date as YYYY-MM-DD using local calendar (not UTC), for date input values. */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Stock bar: shows current vs min_stock visually
function StockBar({ stock, minStock }: { stock: number; minStock: number | null }) {
  if (minStock == null || minStock <= 0) {
    return (
      <div className="flex items-center gap-1.5">
        <span className={`text-sm font-bold tabular-nums ${stock === 0 ? "text-red-600" : "text-amber-600"}`}>
          {Number(stock).toLocaleString("fr-DZ")}
        </span>
        {stock === 0 && (
          <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">RUPTURE</span>
        )}
      </div>
    );
  }
  const pct = Math.min(100, Math.round((stock / minStock) * 100));
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-bold tabular-nums ${stock === 0 ? "text-red-600" : "text-amber-600"}`}>
          {Number(stock).toLocaleString("fr-DZ")}
        </span>
        <span className="text-xs text-muted-foreground">/ {Number(minStock).toLocaleString("fr-DZ")}</span>
      </div>
      <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${pct === 0 ? "bg-red-500" : pct < 50 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── History drawer content ───────────────────────────────────────────────────
function HistoryDrawerContent({
  productId, productName, t,
}: { productId: number | null; productName: string; t: (fr: string, ar: string) => string }) {
  const { data, isLoading } = useQuery<HistoryRow[]>({
    queryKey: ["purchase-history", productId],
    queryFn: () => fetchHistory(productId!),
    enabled: productId != null,
  });
  const img = data?.[0]?.image_url;
  return (
    <div className="flex flex-col h-full">
      <DrawerHeader className="border-b pb-3 shrink-0">
        <DrawerTitle className="text-base font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-slate-500" />
          {t("Historique d'achat", "تاريخ الشراء")}
        </DrawerTitle>
        <p className="text-sm text-muted-foreground mt-0.5 truncate">{productName}</p>
      </DrawerHeader>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {/* Product image */}
        {img ? (
          <div className="flex justify-center py-4">
            <img src={resolveImg(img)} alt={productName}
              className="w-28 h-28 object-cover rounded-xl border shadow-sm" />
          </div>
        ) : (
          <div className="flex justify-center py-4">
            <div className="w-28 h-28 rounded-xl border bg-slate-100 flex items-center justify-center">
              <Package className="h-10 w-10 text-slate-400" />
            </div>
          </div>
        )}

        {isLoading && (
          <div className="space-y-3 mt-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        )}

        {!isLoading && (!data || data.length === 0) && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {t("Aucun historique d'achat", "لا يوجد تاريخ شراء")}
          </div>
        )}

        {data && data.length > 0 && (
          <div className="space-y-3 mt-2">
            {data.map((row, i) => (
              <div key={`${row.po_id}-${i}`}
                className="rounded-xl border bg-white p-3 shadow-sm space-y-1.5">
                {/* Date + PO ref */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">
                    {fmtDate(row.received_date)}
                  </span>
                  <span className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 font-mono">
                    #{String(row.po_id).padStart(6, "0")}
                  </span>
                </div>
                {/* Supplier */}
                <div className="font-medium text-sm truncate">{row.supplier_name}</div>
                {row.supplier_address && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{row.supplier_address}</span>
                  </div>
                )}
                {row.supplier_phone && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3 shrink-0" />
                    <span>{row.supplier_phone}</span>
                  </div>
                )}
                {/* Price + qty */}
                <div className="flex items-center justify-between pt-1 border-t">
                  <div className="text-xs text-muted-foreground">
                    {t("Qté", "الكمية")}: <span className="font-semibold text-slate-700">{Number(row.quantity).toLocaleString("fr-DZ")}</span>
                  </div>
                  <div className="text-sm font-bold text-emerald-700 tabular-nums">
                    {fmtNum(row.unit_cost)} <span className="text-xs font-normal text-muted-foreground">DA</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Print component ───────────────────────────────────────────────────────────
function PurchaseNeedsPrint({
  rows, storeName, activeFilterLabels, lang,
}: {
  rows: NeededRow[];
  storeName: string;
  activeFilterLabels: string[];
  lang: string;
}) {
  const today = new Date().toLocaleDateString("fr-DZ");
  return (
    <div id="purchase-needs-print" style={{ visibility: "hidden", position: "absolute", height: 0, overflow: "hidden", pointerEvents: "none" }}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #purchase-needs-print, #purchase-needs-print * { visibility: visible !important; }
          #purchase-needs-print { position: fixed; inset: 0; height: auto !important; overflow: visible !important; font-family: Arial, sans-serif; font-size: 12px; color: #000; background: #fff; padding: 24px; }
          #purchase-needs-print table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          #purchase-needs-print th { background: #1e293b; color: #fff; padding: 6px 8px; text-align: left; font-size: 11px; }
          #purchase-needs-print td { border-bottom: 1px solid #e2e8f0; padding: 5px 8px; vertical-align: middle; }
          #purchase-needs-print tr:nth-child(even) td { background: #f8fafc; }
          @page { margin: 1cm; size: A4 landscape; }
        }
      `}</style>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Besoin d'Achats — {storeName}</h2>
          {activeFilterLabels.length > 0 && (
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#64748b" }}>
              Filtres : {activeFilterLabels.join(" · ")}
            </p>
          )}
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: "#64748b" }}>
          <div>{today}</div>
          <div>{rows.length} produit(s)</div>
        </div>
      </div>
      {/* Table */}
      <table>
        <thead>
          <tr>
            <th>Produit</th>
            <th>Référence</th>
            <th style={{ textAlign: "center" }}>Stock actuel</th>
            <th style={{ textAlign: "center" }}>Min stock</th>
            <th style={{ textAlign: "center" }}>Qté à commander</th>
            <th style={{ textAlign: "right" }}>Prix achat (DA)</th>
            <th>Fournisseur</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = lang === "ar" && row.designation_ar ? row.designation_ar : row.designation;
            const stock = Number(row.stock);
            const minStock = row.min_stock != null ? Number(row.min_stock) : null;
            const needed = minStock != null ? Math.max(1, minStock - stock) : 1;
            const isRupture = stock === 0;
            return (
              <tr key={row.id}>
                <td style={{ fontWeight: 600, maxWidth: 200 }}>{name}</td>
                <td style={{ color: "#64748b", fontFamily: "monospace" }}>{row.reference ?? "—"}</td>
                <td style={{ textAlign: "center" }}>
                  <span className={isRupture ? "rupture" : "low"}>{stock}</span>
                  {isRupture && <span style={{ fontSize: 9, marginLeft: 4, color: "#dc2626" }}>RUPTURE</span>}
                </td>
                <td style={{ textAlign: "center", color: "#64748b" }}>{minStock ?? "—"}</td>
                <td style={{ textAlign: "center", fontWeight: 700 }}>{needed}</td>
                <td style={{ textAlign: "right" }}>
                  {row.cost_price ? Number(row.cost_price).toFixed(2) : "—"}
                </td>
                <td style={{ color: "#1d4ed8" }}>{row.supplier_name ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Filter chip helper ────────────────────────────────────────────────────────
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 border border-blue-200 rounded-full px-2.5 py-1 font-medium">
      {label}
      <button type="button" onClick={onRemove} className="ml-0.5 hover:text-blue-600" aria-label="Supprimer filtre">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ── Quick order drawer ───────────────────────────────────────────────────────
function QuickOrderDrawer({
  product, suppliers, onClose, onOrdered, t, lang, dateFrom, dateTo,
}: {
  product: NeededRow | null;
  suppliers: Array<{ id: number; name: string }>;
  onClose: () => void;
  onOrdered: (productId: number) => void;
  t: (fr: string, ar: string) => string;
  lang: string;
  dateFrom: string;
  dateTo: string;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  // New-bon state
  const [supplierId, setSupplierId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"comptant" | "a_terme">("comptant");
  // Existing-bon state
  const [selectedPoId, setSelectedPoId] = useState("");
  // Shared
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  // Quantity suggestion
  const [nWeeks, setNWeeks] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: number; itemCount: number; merged?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track whether user has manually edited the price so we don't override their input
  const priceEditedRef = React.useRef(false);

  // Fetch purchase history to get last real unit_cost
  const { data: historyData } = useQuery<HistoryRow[]>({
    queryKey: ["purchase-history", product?.id],
    queryFn: () => fetchHistory(product!.id),
    enabled: product != null,
    staleTime: 60_000,
  });
  const lastUnitCost = historyData?.[0]?.unit_cost ?? null;

  // Fetch pending (draft) bons
  const { data: draftPOs = [] } = useQuery<DraftPO[]>({
    queryKey: ["draft-purchase-orders"],
    queryFn: fetchDraftPOs,
    enabled: product != null,
    staleTime: 30_000,
  });

  // Sort: preferred supplier (from product) first
  const sortedDraftPOs = useMemo(() => {
    const preferred = product?.supplier_id ?? null;
    return [...draftPOs].sort((a, b) => {
      const aMatch = a.supplierId === preferred ? 0 : 1;
      const bMatch = b.supplierId === preferred ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [draftPOs, product?.supplier_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasDraftPOs = sortedDraftPOs.length > 0;

  // Reset when product changes
  useEffect(() => {
    if (!product) return;
    priceEditedRef.current = false;
    setSupplierId(product.supplier_id ? String(product.supplier_id) : "");
    const needed = product.min_stock != null ? Math.max(1, product.min_stock - product.stock) : 1;
    setQuantity(String(needed));
    // Start with CUMP cost_price; history effect will override with last real price once loaded
    setUnitCost(product.cost_price ? String(Number(product.cost_price).toFixed(2)) : "");
    setSuccess(null);
    setError(null);
    setMode("new");
    setSelectedPoId("");
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply last real unit_cost from history once it loads (if user hasn't manually edited)
  useEffect(() => {
    if (lastUnitCost == null || priceEditedRef.current || success != null) return;
    setUnitCost(Number(lastUnitCost).toFixed(2));
  }, [lastUnitCost, success]);

  // ── Quantity suggestion helpers ──────────────────────────────────────────
  const minStockQty = product != null && product.min_stock != null
    ? Math.max(1, product.min_stock - product.stock)
    : 1;

  const salesQty = useMemo(() => {
    if (!product || Number(product.total_qty_sold) <= 0) return null;
    // Derive period length: use filter dates if set, else assume 30 days
    let days = 30;
    if (dateFrom && dateTo) {
      const diff = (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86_400_000;
      if (diff > 0) days = diff;
    }
    const dailyRate = Number(product.total_qty_sold) / days;
    return Math.max(1, Math.ceil(dailyRate * 7 * nWeeks));
  }, [product, dateFrom, dateTo, nWeeks]);

  const handleSubmit = async () => {
    if (!product) return;
    const qty = parseInt(quantity, 10);
    const cost = parseFloat(unitCost);
    if (!qty || qty <= 0) { setError(t("Quantité invalide", "كمية غير صحيحة")); return; }
    if (isNaN(cost) || cost <= 0) { setError(t("Prix d'achat invalide", "سعر الشراء غير صحيح")); return; }

    setSubmitting(true);
    setError(null);
    try {
      if (mode === "new") {
        if (!supplierId) { setError(t("Sélectionnez un fournisseur", "اختر موردًا")); setSubmitting(false); return; }
        const po = await postQuickOrder({
          supplierId: parseInt(supplierId, 10),
          items: [{ productId: product.id, quantity: qty, unitCost: cost }],
          paymentMethod,
        });
        setSuccess({ id: po.id, itemCount: 1 });
        onOrdered(product.id);
      } else {
        if (!selectedPoId) { setError(t("Sélectionnez un bon existant", "اختر بوناً موجوداً")); setSubmitting(false); return; }
        const poId = parseInt(selectedPoId, 10);
        const selectedPO = draftPOs.find(p => p.id === poId);
        if (!selectedPO) { setError(t("Bon introuvable", "البون غير موجود")); setSubmitting(false); return; }
        const existingItems = await fetchPOItems(poId);
        const result = await putAddToPO(
          poId,
          { supplierId: selectedPO.supplierId ?? 0, paymentMethod: selectedPO.paymentMethod, notes: selectedPO.notes },
          { productId: product.id, quantity: qty, unitCost: cost },
          existingItems,
        );
        setSuccess(result);
        onOrdered(product.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Erreur inattendue", "خطأ غير متوقع"));
    } finally {
      setSubmitting(false);
    }
  };

  const productName = product
    ? (lang === "ar" && product.designation_ar ? product.designation_ar : product.designation)
    : "";

  return (
    <Drawer open={product != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent className="max-h-[90vh] flex flex-col">
        <DrawerHeader className="border-b pb-3 shrink-0">
          <DrawerTitle className="flex items-center gap-2 text-base font-semibold">
            <ShoppingCart className="h-4 w-4 text-blue-600" />
            {t("Bon de commande", "بون شراء")}
          </DrawerTitle>
          <p className="text-sm text-muted-foreground truncate mt-0.5">{productName}</p>
          <DrawerClose className="absolute right-4 top-4" onClick={onClose}>
            <X className="h-5 w-5 text-muted-foreground" />
          </DrawerClose>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {success != null ? (
            /* ── Success state ── */
            <div className="flex flex-col items-center py-8 gap-3 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <p className="font-semibold text-gray-800">
                {mode === "new"
                  ? t("Bon créé avec succès !", "تم إنشاء البون بنجاح!")
                  : success?.merged
                    ? t("Quantité mise à jour !", "تم تحديث الكمية!")
                    : t("Produit ajouté avec succès !", "تمت إضافة المنتج بنجاح!")}
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                #{String(success.id).padStart(6, "0")}
                {" · "}
                {success.itemCount} {t("article(s)", "صنف(أصناف)")}
              </p>
              <Button variant="outline" size="sm" className="mt-2 rounded-xl" onClick={onClose}>
                {t("Fermer", "إغلاق")}
              </Button>
            </div>
          ) : (
            <>
              {/* ── Mode toggle ── */}
              <div className="flex rounded-xl border overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setMode("new"); setSelectedPoId(""); setError(null); }}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    mode === "new" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {t("Nouveau bon", "بون جديد")}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("existing"); setError(null); }}
                  disabled={!hasDraftPOs}
                  className={`flex-1 py-3 text-sm font-medium transition-colors border-l disabled:opacity-40 ${
                    mode === "existing" ? "bg-slate-700 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {t("Bon existant", "بون موجود")}
                  {hasDraftPOs && (
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                      mode === "existing" ? "bg-white/20" : "bg-slate-100 text-slate-600"
                    }`}>
                      {sortedDraftPOs.length}
                    </span>
                  )}
                </button>
              </div>

              {/* ── Supplier (new) / PO select (existing) ── */}
              {mode === "new" ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("Fournisseur", "المورد")} *</label>
                  <select
                    className="w-full h-12 rounded-xl border bg-white px-3 text-sm appearance-none"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">{t("Sélectionner…", "اختر موردًا…")}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={String(s.id)}>{s.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("Bon de commande", "بون الشراء")} *</label>
                  <select
                    className="w-full h-12 rounded-xl border bg-white px-3 text-sm appearance-none"
                    value={selectedPoId}
                    onChange={(e) => setSelectedPoId(e.target.value)}
                  >
                    <option value="">{t("Sélectionner un bon…", "اختر بوناً…")}</option>
                    {sortedDraftPOs.map((po) => {
                      const supplierName = suppliers.find(s => s.id === po.supplierId)?.name
                        ?? (po.supplierId ? `#${po.supplierId}` : t("Sans fournisseur", "بدون مورد"));
                      const isPreferred = po.supplierId === product?.supplier_id;
                      return (
                        <option key={po.id} value={String(po.id)}>
                          {isPreferred ? "★ " : ""}#{String(po.id).padStart(6, "0")} — {supplierName}
                        </option>
                      );
                    })}
                  </select>
                  {/* Selected PO summary */}
                  {selectedPoId && (() => {
                    const po = draftPOs.find(p => p.id === parseInt(selectedPoId, 10));
                    if (!po) return null;
                    const supplierName = suppliers.find(s => s.id === po.supplierId)?.name ?? "—";
                    return (
                      <p className="text-xs text-muted-foreground px-1">
                        {supplierName}
                        {" · "}
                        {po.paymentMethod === "comptant" ? t("Comptant", "نقداً") : t("À terme", "آجل")}
                        {" · "}
                        {Number(po.totalAmount).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} DA
                      </p>
                    );
                  })()}
                </div>
              )}

              {/* ── Quantity ── */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("Quantité", "الكمية")} *</label>
                {/* Quick-fill buttons */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setQuantity(String(minStockQty))}
                    className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg border transition-colors ${
                      quantity === String(minStockQty)
                        ? "bg-slate-700 text-white border-slate-700"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {t("Min stock", "الحد الأدنى")} ({minStockQty})
                  </button>
                  {salesQty != null ? (
                    <div className="flex flex-1 gap-1 items-center">
                      <button
                        type="button"
                        onClick={() => setQuantity(String(salesQty))}
                        className={`flex-1 py-2 px-2 text-xs font-semibold rounded-lg border transition-colors ${
                          quantity === String(salesQty)
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50"
                        }`}
                      >
                        {t("Ventes", "المبيعات")} ({salesQty})
                      </button>
                      {/* nWeeks stepper */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button type="button" onClick={() => setNWeeks(w => Math.max(1, w - 1))}
                          className="w-6 h-6 flex items-center justify-center rounded border text-slate-500 hover:bg-slate-50 text-sm leading-none">−</button>
                        <span className="text-xs font-semibold text-slate-600 w-6 text-center">{nWeeks}s</span>
                        <button type="button" onClick={() => setNWeeks(w => Math.min(26, w + 1))}
                          className="w-6 h-6 flex items-center justify-center rounded border text-slate-500 hover:bg-slate-50 text-sm leading-none">+</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 py-2 px-3 text-xs text-muted-foreground rounded-lg border border-dashed text-center">
                      {t("Pas de données ventes", "لا توجد بيانات مبيعات")}
                    </div>
                  )}
                </div>
                <Input type="number" min="1" step="1" className="h-12 rounded-xl"
                  value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>

              {/* ── Unit cost ── */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {t("Prix d'achat unitaire (DA)", "سعر الشراء الوحدوي (دج)")} *
                </label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" className="h-12 rounded-xl"
                  value={unitCost}
                  onChange={(e) => { priceEditedRef.current = true; setUnitCost(e.target.value); }}
                />
                {lastUnitCost != null && (
                  <p className="text-xs text-muted-foreground px-1">
                    {t("Dernier prix:", "آخر سعر شراء:")} <span className="font-semibold text-slate-700 tabular-nums">{fmtNum(lastUnitCost)} DA</span>
                  </p>
                )}
              </div>

              {/* ── Payment method (new only — existing PO keeps its own) ── */}
              {mode === "new" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("Mode de paiement", "طريقة الدفع")}</label>
                  <div className="flex rounded-xl border overflow-hidden">
                    <button type="button" onClick={() => setPaymentMethod("comptant")}
                      className={`flex-1 py-3 text-sm font-medium transition-colors ${
                        paymentMethod === "comptant" ? "bg-emerald-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}>
                      {t("Comptant", "نقداً")}
                    </button>
                    <button type="button" onClick={() => setPaymentMethod("a_terme")}
                      className={`flex-1 py-3 text-sm font-medium transition-colors border-l ${
                        paymentMethod === "a_terme" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}>
                      {t("À terme", "آجل")}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
              )}

              <Button
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="w-full h-12 rounded-xl text-base bg-blue-600 hover:bg-blue-700 text-white"
              >
                {submitting
                  ? (mode === "new" ? t("Création…", "جارٍ الإنشاء…") : t("Ajout…", "جارٍ الإضافة…"))
                  : (mode === "new" ? t("Créer le bon", "إنشاء البون") : t("Ajouter au bon", "إضافة للبون"))}
              </Button>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ── Needed list row (compact view) ───────────────────────────────────────────
function NeededListRow({
  row, lang, sortBy, isSnoozePending, isExcludePending, confirmExclude, t,
  onHistory, onOrder, onSnooze, onExcludeRequest, onExcludeConfirm, onExcludeCancel,
}: {
  row: NeededRow; lang: string; sortBy: SortBy; isSnoozePending: boolean;
  isExcludePending: boolean; confirmExclude: number | null;
  t: (fr: string, ar: string) => string;
  onHistory: () => void; onOrder: () => void; onSnooze: () => void;
  onExcludeRequest: () => void; onExcludeConfirm: () => void; onExcludeCancel: () => void;
}) {
  const name = lang === "ar" && row.designation_ar ? row.designation_ar : row.designation;
  const famille = lang === "ar" && row.famille_ar ? row.famille_ar : row.famille;
  const stock = Number(row.stock);
  const minStock = row.min_stock != null ? Number(row.min_stock) : null;
  const stockColor = stock === 0 ? "text-red-600" : "text-amber-600";

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      {/* Top row: icon + name + stock + metric */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
          <Package className="h-3 w-3 text-slate-400" />
        </div>
        {/* Name + badges */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 line-clamp-2 leading-tight">{name}</p>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {row.reference && (
              <span className="text-[10px] font-mono text-muted-foreground">{row.reference}</span>
            )}
            {famille && (
              <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1 py-0">{famille}</span>
            )}
            {row.marque && (
              <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1 py-0">{row.marque}</span>
            )}
          </div>
        </div>
        {/* Stock */}
        <div className="shrink-0 text-right min-w-[44px]">
          <span className={`text-xs font-bold tabular-nums ${stockColor}`}>{stock.toLocaleString("fr-DZ")}</span>
          {minStock != null && <span className="text-[10px] text-muted-foreground">/{minStock.toLocaleString("fr-DZ")}</span>}
          {stock === 0 && <div className="text-[9px] font-semibold text-red-600 leading-tight">RUPTURE</div>}
        </div>
        {/* Benefice / qty */}
        <div className="shrink-0 text-right min-w-[56px]">
          {sortBy === "qty_sold" ? (
            <>
              <p className={`text-xs font-bold tabular-nums ${Number(row.total_qty_sold) > 0 ? "text-blue-700" : "text-slate-400"}`}>
                {Number(row.total_qty_sold).toLocaleString("fr-DZ")}
              </p>
              <p className="text-[10px] text-muted-foreground leading-tight">{t("un.", "و.")}</p>
            </>
          ) : (
            <>
              <p className={`text-xs font-bold tabular-nums ${Number(row.benefice) > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                {fmtNum(row.benefice)}
              </p>
              <p className="text-[10px] text-muted-foreground leading-tight">DA</p>
            </>
          )}
        </div>
      </div>
      {/* Bottom row: supplier + action buttons */}
      <div className="flex items-center border-t">
        <div className="flex-1 min-w-0 px-3 py-1.5">
          {row.supplier_name ? (
            <p className="text-[11px] text-blue-700 truncate font-medium">{row.supplier_name}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">—</p>
          )}
        </div>
        <div className="flex shrink-0 border-l divide-x">
          <button type="button" onClick={onHistory}
            className="px-3 py-2 text-slate-500 hover:bg-slate-50 active:bg-slate-100 transition-colors"
            aria-label={t("Historique", "التاريخ")}>
            <History className="h-4 w-4" />
          </button>
          <button type="button" onClick={onOrder}
            className="px-3 py-2 text-blue-600 hover:bg-blue-50 active:bg-blue-100 transition-colors"
            aria-label={t("Commander", "اطلب")}>
            <ShoppingCart className="h-4 w-4" />
          </button>
          {/* Exclude button — two-tap confirm */}
          {confirmExclude === row.id ? (
            <>
              <button type="button" onClick={onExcludeConfirm} disabled={isExcludePending}
                className="px-2.5 py-2 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-60"
                aria-label={t("Confirmer exclusion", "تأكيد الإخفاء")}>
                {isExcludePending ? "…" : t("Oui", "نعم")}
              </button>
              <button type="button" onClick={onExcludeCancel}
                className="px-2 py-2 text-[11px] text-slate-500 hover:bg-slate-50 transition-colors">
                {t("Non", "لا")}
              </button>
            </>
          ) : (
            <button type="button" onClick={onExcludeRequest}
              className="px-3 py-2 text-red-400 hover:bg-red-50 hover:text-red-600 active:bg-red-100 transition-colors"
              aria-label={t("Exclure définitivement", "إخفاء نهائي")}>
              <Ban className="h-4 w-4" />
            </button>
          )}
          <button type="button" disabled={isSnoozePending} onClick={onSnooze}
            className="px-3 py-2 text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors disabled:opacity-60"
            aria-label={t("Tâche achetée", "تمّ")}>
            <CheckCircle2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function SmartPurchase() {
  const { lang } = useLang();
  const t = useCallback((fr: string, ar: string) => lang === "ar" ? ar : fr, [lang]);
  const store = useCurrentStore();
  const qc = useQueryClient();

  // Sort + filter state
  const [sortBy, setSortBy] = useState<SortBy>("profit");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [search, setSearch] = useState("");
  const [filterSupplierId, setFilterSupplierId] = useState<string>("");
  const [filterFamilyId, setFilterFamilyId] = useState<string>("");
  const [filterBrandId, setFilterBrandId] = useState<string>("");
  const [filterCity, setFilterCity] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // View mode (cards / list) — persisted in localStorage
  const [viewMode, setViewMode] = useState<"cards" | "list">(() => {
    try { return (localStorage.getItem("smart-purchase-view") as "cards" | "list") ?? "cards"; } catch { return "cards"; }
  });
  const setViewModePersist = useCallback((mode: "cards" | "list") => {
    setViewMode(mode);
    try { localStorage.setItem("smart-purchase-view", mode); } catch { /* noop */ }
  }, []);

  // Drawer state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<{ id: number; name: string } | null>(null);

  // Snooze pending set (for immediate UI feedback)
  const [pendingSnooze, setPendingSnooze] = useState<Set<number>>(new Set());
  // Quick order
  const [quickOrderProduct, setQuickOrderProduct] = useState<NeededRow | null>(null);

  // Attribute lists for filter selects — uses purchases:view, not settings:view
  const { data: filterOpts } = useQuery<FilterOptions>({
    queryKey: ["purchase-filter-options"],
    queryFn: fetchFilterOptions,
    staleTime: 60_000,
  });
  const { data: suppliersData } = useGetSuppliers({ limit: 9999 });

  const families = useMemo(() => filterOpts?.families ?? [], [filterOpts]);
  const brands   = useMemo(() => filterOpts?.brands   ?? [], [filterOpts]);
  const suppliers = useMemo(() => (suppliersData?.data ?? []) as Array<{ id: number; name: string }>, [suppliersData]);

  // Build query params
  const queryParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (search) p.search = search;
    if (filterSupplierId) p.supplierId = filterSupplierId;
    if (filterFamilyId) p.familyId = filterFamilyId;
    if (filterBrandId) p.brandId = filterBrandId;
    if (filterCity) p.supplierCity = filterCity;
    if (filterDateFrom) p.dateFrom = filterDateFrom;
    if (filterDateTo) p.dateTo = filterDateTo;
    if (sortBy !== "profit") p.sortBy = sortBy;
    return p;
  }, [search, filterSupplierId, filterFamilyId, filterBrandId, filterCity, filterDateFrom, filterDateTo, sortBy]);

  const { data: rows, isLoading, refetch } = useQuery<NeededRow[]>({
    queryKey: ["smart-purchase-needed", store?.id, queryParams],
    queryFn: () => fetchNeeded(queryParams),
    enabled: !!store?.id,
    staleTime: 30_000,
  });

  const snoozeMut = useMutation({
    mutationFn: (productId: number) => postSnooze(productId),
    onMutate: (productId) => {
      setPendingSnooze((s) => new Set(s).add(productId));
    },
    onSettled: (_, __, productId) => {
      setPendingSnooze((s) => { const n = new Set(s); n.delete(productId); return n; });
      void qc.invalidateQueries({ queryKey: ["smart-purchase-needed"] });
    },
  });

  // Permanent exclusion
  const [pendingExclude, setPendingExclude] = useState<Set<number>>(new Set());
  const [confirmExclude, setConfirmExclude] = useState<number | null>(null);
  const excludeMut = useMutation({
    mutationFn: (productId: number) => postExclude(productId),
    onMutate: (productId) => {
      setPendingExclude((s) => new Set(s).add(productId));
    },
    onSettled: (_, __, productId) => {
      setPendingExclude((s) => { const n = new Set(s); n.delete(productId); return n; });
      setConfirmExclude(null);
      void qc.invalidateQueries({ queryKey: ["smart-purchase-needed"] });
    },
  });

  // Active filter chips
  const activeFilters: { label: string; onRemove: () => void }[] = [];
  if (filterSupplierId) {
    const sup = suppliers.find((s) => String(s.id) === filterSupplierId);
    activeFilters.push({ label: sup?.name ?? `#${filterSupplierId}`, onRemove: () => setFilterSupplierId("") });
  }
  if (filterFamilyId) {
    const fam = families.find((f) => String(f.id) === filterFamilyId);
    activeFilters.push({ label: fam ? (lang === "ar" ? fam.nameAr : fam.nameFr) : `#${filterFamilyId}`, onRemove: () => setFilterFamilyId("") });
  }
  if (filterBrandId) {
    const br = brands.find((b) => String(b.id) === filterBrandId);
    activeFilters.push({ label: br ? (lang === "ar" ? br.nameAr : br.nameFr) : `#${filterBrandId}`, onRemove: () => setFilterBrandId("") });
  }
  if (filterCity) {
    activeFilters.push({ label: filterCity, onRemove: () => setFilterCity("") });
  }
  if (filterDateFrom || filterDateTo) {
    const fmt = (d: string) => { const [, m, day] = d.split("-"); return `${day}/${m}`; };
    const label = filterDateFrom && filterDateTo
      ? `${fmt(filterDateFrom)} – ${fmt(filterDateTo)}`
      : filterDateFrom ? `≥ ${fmt(filterDateFrom)}` : `≤ ${fmt(filterDateTo)}`;
    activeFilters.push({ label, onRemove: () => { setFilterDateFrom(""); setFilterDateTo(""); } });
  }

  const allRows = rows ?? [];
  const ruptureCount = allRows.filter((r) => Number(r.stock) === 0).length;
  const lowCount = allRows.filter((r) => Number(r.stock) > 0).length;
  const displayRows = stockFilter === "rupture"
    ? allRows.filter((r) => Number(r.stock) === 0)
    : stockFilter === "low"
      ? allRows.filter((r) => Number(r.stock) > 0)
      : allRows;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 bg-white border-b shadow-sm">
        <div className="px-4 pt-4 pb-3 max-w-2xl mx-auto space-y-3">
          {/* Title */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <ShoppingBasket className="h-5 w-5 text-rose-500" />
                {t("Besoin d'Achats", "ما ينقص")}
              </h1>
              {!isLoading && (
                <p className="text-xs text-muted-foreground">
                  {displayRows.length} {t("produit(s) à acheter", "منتج(ات) للشراء")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {displayRows.length > 0 && (
                <Button
                  size="icon" variant="ghost"
                  className="h-10 w-10 rounded-full"
                  onClick={() => window.print()}
                  aria-label={t("Imprimer", "طباعة")}
                >
                  <Printer className="h-4 w-4" />
                </Button>
              )}
              <Button
                size="icon" variant="ghost"
                className="h-10 w-10 rounded-full"
                onClick={() => void refetch()}
                aria-label={t("Rafraîchir", "تحديث")}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              {/* View mode toggle */}
              <div className="flex rounded-lg border overflow-hidden h-10">
                <button type="button"
                  onClick={() => setViewModePersist("cards")}
                  className={`px-2.5 flex items-center transition-colors ${viewMode === "cards" ? "bg-slate-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
                  aria-label={t("Vue cartes", "عرض بطاقات")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button type="button"
                  onClick={() => setViewModePersist("list")}
                  className={`px-2.5 flex items-center transition-colors border-l ${viewMode === "list" ? "bg-slate-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
                  aria-label={t("Vue liste", "عرض قائمة")}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
              {/* Filters button — card mode only */}
              {viewMode === "cards" && (
                <Button
                  variant={activeFilters.length > 0 ? "default" : "outline"}
                  size="sm"
                  className={`h-10 gap-1.5 rounded-full px-4 ${activeFilters.length > 0 ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`}
                  onClick={() => setFiltersOpen(true)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {t("Filtres", "الفلاتر")}
                  {activeFilters.length > 0 && (
                    <span className="bg-white text-blue-700 rounded-full px-1.5 py-0 text-[10px] font-bold">
                      {activeFilters.length}
                    </span>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Sort toggle */}
          <div className="flex items-center gap-0 rounded-xl border bg-gray-100 p-1 self-start">
            <button
              type="button"
              onClick={() => setSortBy("profit")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                sortBy === "profit"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              {t("Profit", "الأعلى ربحاً")}
            </button>
            <button
              type="button"
              onClick={() => setSortBy("qty_sold")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                sortBy === "qty_sold"
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              {t("Qté vendue", "الأعلى كمية")}
            </button>
          </div>

          {/* Stock filter: Tout / En rupture / Stock faible */}
          {!isLoading && allRows.length > 0 && (
            <div className="flex rounded-xl border bg-gray-100 p-1 gap-1">
              {([
                { key: "all",     labelFr: "Tout",        labelAr: "الكل",          count: allRows.length },
                { key: "rupture", labelFr: "En rupture",  labelAr: "نفد المخزون",   count: ruptureCount },
                { key: "low",     labelFr: "Stock faible", labelAr: "مخزون منخفض",  count: lowCount },
              ] as { key: StockFilter; labelFr: string; labelAr: string; count: number }[]).map(({ key, labelFr, labelAr, count }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStockFilter(key)}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-all ${
                    stockFilter === key
                      ? key === "rupture"
                        ? "bg-red-600 text-white shadow-sm"
                        : key === "low"
                          ? "bg-amber-500 text-white shadow-sm"
                          : "bg-white text-slate-800 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t(labelFr, labelAr)}
                  <span className={`text-[10px] px-1.5 py-0 rounded-full font-bold ${
                    stockFilter === key ? "bg-white/20 text-inherit" : "bg-white text-slate-600"
                  }`}>
                    {count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 h-11 rounded-full bg-gray-50 border-gray-200"
              placeholder={t("Rechercher un produit…", "ابحث عن منتج…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch("")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Inline filter bar — list mode only */}
          {viewMode === "list" && (
            <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
              <select
                className="shrink-0 h-9 rounded-lg border bg-white px-2 text-xs appearance-none min-w-[120px]"
                value={filterSupplierId}
                onChange={(e) => setFilterSupplierId(e.target.value)}
              >
                <option value="">{t("Fournisseur", "المورد")}</option>
                {suppliers.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
              </select>
              <select
                className="shrink-0 h-9 rounded-lg border bg-white px-2 text-xs appearance-none min-w-[100px]"
                value={filterFamilyId}
                onChange={(e) => setFilterFamilyId(e.target.value)}
              >
                <option value="">{t("Famille", "العائلة")}</option>
                {families.map((f) => <option key={f.id} value={String(f.id)}>{lang === "ar" ? f.nameAr : f.nameFr}</option>)}
              </select>
              <select
                className="shrink-0 h-9 rounded-lg border bg-white px-2 text-xs appearance-none min-w-[100px]"
                value={filterBrandId}
                onChange={(e) => setFilterBrandId(e.target.value)}
              >
                <option value="">{t("Marque", "الماركة")}</option>
                {brands.map((b) => <option key={b.id} value={String(b.id)}>{lang === "ar" ? b.nameAr : b.nameFr}</option>)}
              </select>
              <input
                type="date"
                className="shrink-0 h-9 rounded-lg border bg-white px-2 text-xs min-w-[130px]"
                value={filterDateFrom}
                max={filterDateTo || undefined}
                onChange={(e) => setFilterDateFrom(e.target.value)}
              />
              <input
                type="date"
                className="shrink-0 h-9 rounded-lg border bg-white px-2 text-xs min-w-[130px]"
                value={filterDateTo}
                min={filterDateFrom || undefined}
                onChange={(e) => setFilterDateTo(e.target.value)}
              />
              {(filterSupplierId || filterFamilyId || filterBrandId || filterDateFrom || filterDateTo) && (
                <button
                  type="button"
                  className="shrink-0 h-9 px-2.5 text-xs text-muted-foreground border rounded-lg hover:bg-gray-50 flex items-center gap-1 whitespace-nowrap"
                  onClick={() => { setFilterSupplierId(""); setFilterFamilyId(""); setFilterBrandId(""); setFilterCity(""); setFilterDateFrom(""); setFilterDateTo(""); }}
                >
                  <X className="h-3 w-3" />
                  {t("Effacer", "مسح")}
                </button>
              )}
            </div>
          )}

          {/* Active filter chips — card mode only */}
          {viewMode === "cards" && activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeFilters.map((f) => (
                <FilterChip key={f.label} label={f.label} onRemove={f.onRemove} />
              ))}
              <button
                className="text-xs text-muted-foreground underline ml-1"
                onClick={() => { setFilterSupplierId(""); setFilterFamilyId(""); setFilterBrandId(""); setFilterCity(""); setFilterDateFrom(""); setFilterDateTo(""); }}
              >
                {t("Tout effacer", "مسح الكل")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Main list ── */}
      <div className="flex-1 px-4 py-4 max-w-2xl mx-auto w-full space-y-3">
        {isLoading && (
          [...Array(5)].map((_, i) => (
            <div key={i} className="rounded-2xl bg-white border p-4 shadow-sm space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ))
        )}

        {!isLoading && displayRows.length === 0 && (
          <div className="text-center py-20 space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <p className="font-semibold text-gray-700">{t("Tout est en stock !", "المخزون مكتمل!")}</p>
            <p className="text-sm text-muted-foreground">
              {t("Aucun produit nécessite d'achat en ce moment.", "لا يوجد منتج يحتاج إلى شراء الآن.")}
            </p>
          </div>
        )}

        {/* ── Cards view ── */}
        {viewMode === "cards" && displayRows.map((row) => {
          const isSnoozePending = pendingSnooze.has(row.id);
          const imgUrl = resolveImg(row.image_url);

          return (
            <div key={row.id}
              className="rounded-2xl bg-white border shadow-sm overflow-hidden">
              {/* Card body */}
              <div className="p-4 space-y-3">
                {/* Top row: image + name + badge */}
                <div className="flex items-start gap-3">
                  {/* Thumbnail */}
                  {imgUrl ? (
                    <img src={imgUrl} alt={row.designation}
                      className="w-14 h-14 rounded-xl object-cover border shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-slate-100 border flex items-center justify-center shrink-0">
                      <Package className="h-6 w-6 text-slate-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 leading-tight truncate">
                      {lang === "ar" && row.designation_ar ? row.designation_ar : row.designation}
                    </p>
                    {row.reference && (
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{row.reference}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {row.famille && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {lang === "ar" && row.famille_ar ? row.famille_ar : row.famille}
                        </Badge>
                      )}
                      {row.marque && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{row.marque}</Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stats row: stock + sort metric */}
                <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                      {t("Stock", "المخزون")}
                    </p>
                    <StockBar stock={Number(row.stock)} minStock={row.min_stock != null ? Number(row.min_stock) : null} />
                  </div>
                  <div>
                    {sortBy === "qty_sold" ? (
                      <>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                          {t("Qté vendue", "الكمية المباعة")}
                        </p>
                        <p className={`text-sm font-bold tabular-nums ${Number(row.total_qty_sold) > 0 ? "text-blue-700" : "text-slate-400"}`}>
                          {Number(row.total_qty_sold).toLocaleString("fr-DZ")}
                          <span className="text-[10px] font-normal text-muted-foreground ml-1">{t("unités", "وحدة")}</span>
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                          {t("Bénéfice hist.", "الربح التاريخي")}
                        </p>
                        <p className={`text-sm font-bold tabular-nums ${Number(row.benefice) > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                          {fmtNum(row.benefice)} <span className="text-[10px] font-normal">DA</span>
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* Supplier */}
                {row.supplier_name && (
                  <div className="flex items-start gap-2 text-sm bg-blue-50/60 rounded-xl px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-blue-900 truncate">{row.supplier_name}</p>
                      {row.supplier_city && (
                        <p className="text-[11px] text-blue-700 flex items-center gap-0.5 mt-0.5">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{row.supplier_city}</span>
                        </p>
                      )}
                      {row.supplier_phone && (
                        <p className="text-[11px] text-blue-700 flex items-center gap-0.5">
                          <Phone className="h-3 w-3 shrink-0" />
                          {row.supplier_phone}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Action buttons (thumb zone) ── */}
              <div className="flex border-t">
                {/* History button */}
                <button
                  type="button"
                  className="flex-none flex items-center justify-center gap-1.5 px-4 py-4 text-sm text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors border-r"
                  style={{ minHeight: 52 }}
                  onClick={() => setHistoryProduct({ id: row.id, name: lang === "ar" && row.designation_ar ? row.designation_ar : row.designation })}
                  aria-label={t("Historique des prix", "تاريخ الأسعار")}
                >
                  <History className="h-4 w-4" />
                  <span className="text-xs font-medium hidden sm:inline">{t("Prix hist.", "الأسعار")}</span>
                </button>

                {/* Commander button */}
                <button
                  type="button"
                  className="flex-none flex items-center justify-center gap-1.5 px-4 py-4 text-sm text-blue-600 hover:bg-blue-50 active:bg-blue-100 transition-colors border-r"
                  style={{ minHeight: 52 }}
                  onClick={() => setQuickOrderProduct(row)}
                  aria-label={t("Commander", "إنشاء طلب شراء")}
                >
                  <ShoppingCart className="h-4 w-4" />
                  <span className="text-xs font-medium hidden sm:inline">{t("Commander", "اطلب")}</span>
                </button>

                {/* Exclude button — two-tap confirm */}
                {confirmExclude === row.id ? (
                  <>
                    <button
                      type="button"
                      disabled={pendingExclude.has(row.id)}
                      onClick={() => excludeMut.mutate(row.id)}
                      className="flex-none flex items-center justify-center px-3 py-4 text-xs font-bold text-white bg-red-600 hover:bg-red-700 transition-colors border-r disabled:opacity-60"
                      style={{ minHeight: 52 }}
                    >
                      {pendingExclude.has(row.id) ? "…" : t("Oui", "نعم")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmExclude(null)}
                      className="flex-none flex items-center justify-center px-3 py-4 text-xs text-slate-500 hover:bg-slate-50 transition-colors border-r"
                      style={{ minHeight: 52 }}
                    >
                      {t("Non", "لا")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmExclude(row.id)}
                    className="flex-none flex items-center justify-center gap-1 px-3 py-4 text-sm text-red-400 hover:bg-red-50 hover:text-red-600 active:bg-red-100 transition-colors border-r"
                    style={{ minHeight: 52 }}
                    aria-label={t("Exclure définitivement", "إخفاء نهائي")}
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                )}

                {/* Bought button — full remaining width, thumb-friendly */}
                <button
                  type="button"
                  disabled={isSnoozePending}
                  onClick={() => snoozeMut.mutate(row.id)}
                  className="flex-1 flex items-center justify-center gap-2 py-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                  style={{ minHeight: 52 }}
                >
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  {isSnoozePending ? t("En cours…", "جارٍ…") : t("✓ Tâche achetée", "✓ تمّ الشراء")}
                </button>
              </div>
            </div>
          );
        })}

        {/* ── List view ── */}
        {viewMode === "list" && displayRows.map((row) => (
          <NeededListRow
            key={row.id}
            row={row}
            lang={lang}
            sortBy={sortBy}
            isSnoozePending={pendingSnooze.has(row.id)}
            isExcludePending={pendingExclude.has(row.id)}
            confirmExclude={confirmExclude}
            t={t}
            onHistory={() => setHistoryProduct({ id: row.id, name: lang === "ar" && row.designation_ar ? row.designation_ar : row.designation })}
            onOrder={() => setQuickOrderProduct(row)}
            onSnooze={() => snoozeMut.mutate(row.id)}
            onExcludeRequest={() => setConfirmExclude(row.id)}
            onExcludeConfirm={() => excludeMut.mutate(row.id)}
            onExcludeCancel={() => setConfirmExclude(null)}
          />
        ))}
      </div>

      {/* ── Filters bottom drawer ── */}
      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="border-b pb-3">
            <DrawerTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              {t("Filtres", "الفلاتر")}
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4">
              <X className="h-5 w-5 text-muted-foreground" />
            </DrawerClose>
          </DrawerHeader>

          <div className="overflow-y-auto px-4 py-4 space-y-5 pb-safe">
            {/* Supplier */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Fournisseur", "المورد")}</label>
              <select
                className="w-full h-12 rounded-xl border bg-white px-3 text-sm appearance-none"
                value={filterSupplierId}
                onChange={(e) => setFilterSupplierId(e.target.value)}
              >
                <option value="">{t("Tous les fournisseurs", "كل الموردين")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Family */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Famille", "العائلة")}</label>
              <select
                className="w-full h-12 rounded-xl border bg-white px-3 text-sm appearance-none"
                value={filterFamilyId}
                onChange={(e) => setFilterFamilyId(e.target.value)}
              >
                <option value="">{t("Toutes les familles", "كل العائلات")}</option>
                {families.map((f) => (
                  <option key={f.id} value={String(f.id)}>
                    {lang === "ar" ? f.nameAr : f.nameFr}
                  </option>
                ))}
              </select>
            </div>

            {/* Brand */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Marque", "الماركة")}</label>
              <select
                className="w-full h-12 rounded-xl border bg-white px-3 text-sm appearance-none"
                value={filterBrandId}
                onChange={(e) => setFilterBrandId(e.target.value)}
              >
                <option value="">{t("Toutes les marques", "كل الماركات")}</option>
                {brands.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {lang === "ar" ? b.nameAr : b.nameFr}
                  </option>
                ))}
              </select>
            </div>

            {/* Supplier city */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Ville du fournisseur", "مدينة المورد")}</label>
              <Input
                className="h-12 rounded-xl"
                placeholder={t("Ex : Alger, Oran…", "مثال: الجزائر، وهران…")}
                value={filterCity}
                onChange={(e) => setFilterCity(e.target.value)}
              />
            </div>

            {/* Date range */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{t("Période de ventes", "فترة المبيعات")}</label>
                {(filterDateFrom || filterDateTo) && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); }}
                  >
                    {t("Effacer", "مسح")}
                  </button>
                )}
              </div>
              {/* Shortcut buttons */}
              <div className="flex gap-1.5 flex-wrap">
                {(
                  [
                    {
                      label: t("Ce mois", "هذا الشهر"),
                      key: "ce-mois",
                      range: (): [string, string] => {
                        const now = new Date();
                        const from = new Date(now.getFullYear(), now.getMonth(), 1);
                        const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                        return [localDateStr(from), localDateStr(to)];
                      },
                    },
                    {
                      label: t("30j", "30 يوم"),
                      key: "30j",
                      range: (): [string, string] => {
                        const to = new Date();
                        const from = new Date();
                        from.setDate(from.getDate() - 29);
                        return [localDateStr(from), localDateStr(to)];
                      },
                    },
                    {
                      label: t("3 mois", "3 أشهر"),
                      key: "3mois",
                      range: (): [string, string] => {
                        const to = new Date();
                        const from = new Date();
                        from.setMonth(from.getMonth() - 3);
                        return [localDateStr(from), localDateStr(to)];
                      },
                    },
                    {
                      label: t("Cette année", "هذه السنة"),
                      key: "annee",
                      range: (): [string, string] => {
                        const now = new Date();
                        return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
                      },
                    },
                  ] as Array<{ label: string; key: string; range: () => [string, string] }>
                ).map(({ label, key, range }) => {
                  const [previewFrom, previewTo] = range();
                  const isActive = filterDateFrom === previewFrom && filterDateTo === previewTo;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        const [f, t2] = range();
                        setFilterDateFrom(f);
                        setFilterDateTo(t2);
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        isActive
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-700"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t("Du", "من")}</span>
                  <input
                    type="date"
                    className="w-full h-12 rounded-xl border bg-white px-3 text-sm"
                    value={filterDateFrom}
                    max={filterDateTo || undefined}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t("Au", "إلى")}</span>
                  <input
                    type="date"
                    className="w-full h-12 rounded-xl border bg-white px-3 text-sm"
                    value={filterDateTo}
                    min={filterDateFrom || undefined}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <Button
              className="w-full h-12 rounded-xl text-base"
              onClick={() => setFiltersOpen(false)}
            >
              {t("Appliquer", "تطبيق")}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── History bottom drawer ── */}
      <Drawer open={historyProduct != null} onOpenChange={(open) => { if (!open) setHistoryProduct(null); }}>
        <DrawerContent className="max-h-[85vh] flex flex-col">
          <DrawerClose
            className="absolute right-4 top-4 z-10"
            onClick={() => setHistoryProduct(null)}
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </DrawerClose>
          <HistoryDrawerContent
            productId={historyProduct?.id ?? null}
            productName={historyProduct?.name ?? ""}
            t={t}
          />
        </DrawerContent>
      </Drawer>

      {/* ── Quick order drawer ── */}
      <QuickOrderDrawer
        product={quickOrderProduct}
        suppliers={suppliers}
        onClose={() => setQuickOrderProduct(null)}
        onOrdered={(id) => snoozeMut.mutate(id)}
        t={t}
        lang={lang}
        dateFrom={filterDateFrom}
        dateTo={filterDateTo}
      />

      {/* ── Hidden print document (visibility revealed via @media print CSS) ── */}
      <PurchaseNeedsPrint
        rows={displayRows}
        storeName={store?.nameEn ?? store?.nameAr ?? ""}
        activeFilterLabels={activeFilters.map((f) => f.label)}
        lang={lang}
      />
    </div>
  );
}

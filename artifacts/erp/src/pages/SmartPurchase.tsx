import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { useCurrentStore } from "@/hooks/use-current-store";
import { useMe } from "@/hooks/use-me";
import { useGetSuppliers } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose,
} from "@/components/ui/drawer";
import { resolveImg } from "@/lib/utils";
import {
  ShoppingBasket, SlidersHorizontal, X, History, CheckCircle2,
  Package, Search, RefreshCw, MapPin, Phone, TrendingUp, ShoppingCart,
  LayoutGrid, List, Ban, Printer, MessageSquarePlus, ThumbsUp, Trash2,
  Lightbulb, Pencil, Zap,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
type SortBy = "profit" | "qty_sold";
type StockFilter = "all" | "rupture" | "low" | "suggestions";

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

type NeededPage = { rows: NeededRow[]; ruptureTotal: number; lowTotal: number };

async function fetchNeeded(params: Record<string, string>): Promise<NeededPage> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/api/erp/purchases/needed${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("fetch needed failed");
  return res.json() as Promise<NeededPage>;
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

type AutoMinStockPreviewRow = {
  product_id: number;
  name: string;
  name_ar: string;
  current_min_stock: number | null;
  suggested: number;
};

async function fetchAutoMinStockPreview(): Promise<{ rows: AutoMinStockPreviewRow[] }> {
  const res = await fetch(`${API_BASE}/api/erp/purchases/auto-min-stock/preview`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("preview failed");
  return res.json() as Promise<{ rows: AutoMinStockPreviewRow[] }>;
}

async function fetchAutoMinStock(body: { productIds?: number[]; protectManual?: boolean } = {}): Promise<{ updated: number; skipped: number }> {
  const res = await fetch(`${API_BASE}/api/erp/purchases/auto-min-stock`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("auto-min-stock failed");
  return res.json() as Promise<{ updated: number; skipped: number }>;
}

async function fetchResetMinStock(): Promise<{ reset: number }> {
  const res = await fetch(`${API_BASE}/api/erp/purchases/reset-min-stock`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("reset-min-stock failed");
  return res.json() as Promise<{ reset: number }>;
}

async function patchProductMinStock(productId: number, minStock: number | null): Promise<void> {
  const res = await fetch(`${API_BASE}/api/products/${productId}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ minStock }),
  });
  if (!res.ok) throw new Error("patch min_stock failed");
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

// ── Suggestion types & helpers ────────────────────────────────────────────────
type PurchaseSuggestion = {
  id: number;
  product_name: string;
  image_url: string | null;
  notes: string | null;
  market_price: string | null;
  demand_count: number;
  staff_id: number;
  staff_name: string | null;
  created_at: string;
};

async function fetchSuggestions(): Promise<PurchaseSuggestion[]> {
  const res = await fetch(`${API_BASE}/api/erp/purchase-suggestions`, { headers: authHeaders() });
  if (!res.ok) throw new Error("fetch suggestions failed");
  return res.json() as Promise<PurchaseSuggestion[]>;
}

async function createSuggestion(body: { product_name: string; notes?: string; image_url?: string; market_price?: string }): Promise<PurchaseSuggestion> {
  const res = await fetch(`${API_BASE}/api/erp/purchase-suggestions`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? "Erreur"); }
  return res.json() as Promise<PurchaseSuggestion>;
}

async function updateSuggestion(id: number, body: { product_name?: string; notes?: string; image_url?: string; market_price?: string }): Promise<PurchaseSuggestion> {
  const res = await fetch(`${API_BASE}/api/erp/purchase-suggestions/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? "Erreur"); }
  return res.json() as Promise<PurchaseSuggestion>;
}

async function tapSuggestion(id: number): Promise<{ demand_count: number }> {
  const res = await fetch(`${API_BASE}/api/erp/purchase-suggestions/${id}/tap`, {
    method: "POST", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("tap failed");
  return res.json() as Promise<{ demand_count: number }>;
}

async function deleteSuggestion(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/erp/purchase-suggestions/${id}`, {
    method: "DELETE", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("delete failed");
}

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/api/uploads`, { method: "POST", headers: authHeaders(), body: fd });
  if (!res.ok) throw new Error("upload failed");
  const data = await res.json() as { url: string };
  return data.url;
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

// ── Inline min_stock editor ───────────────────────────────────────────────────
function InlineMinStockEdit({
  productId, minStock, t,
}: {
  productId: number;
  minStock: number | null;
  t: (fr: string, ar: string) => string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(minStock != null ? String(minStock) : "");
    setEditing(true);
  };

  const save = async () => {
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) { setEditing(false); return; }
    setSaving(true);
    try {
      await patchProductMinStock(productId, parsed);
      void qc.invalidateQueries({ queryKey: ["smart-purchase-needed"] });
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void save();
    if (e.key === "Escape") setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="number"
        min="0"
        step="1"
        autoFocus
        className="w-14 h-5 text-[10px] border border-blue-400 rounded px-1 tabular-nums focus:outline-none"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={handleKeyDown}
        disabled={saving}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className="flex items-center gap-0.5 group text-[10px] text-muted-foreground hover:text-slate-700 transition-colors"
      title={t("Modifier le seuil min", "تعديل الحد الأدنى")}
    >
      <span className="tabular-nums">{minStock != null ? minStock.toLocaleString("fr-DZ") : t("— Définir", "— تحديد")}</span>
      <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
    </button>
  );
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
  productId, productName, imageUrl, t,
}: { productId: number | null; productName: string; imageUrl: string | null; t: (fr: string, ar: string) => string }) {
  const { data, isLoading } = useQuery<HistoryRow[]>({
    queryKey: ["purchase-history", productId],
    queryFn: () => fetchHistory(productId!),
    enabled: productId != null,
  });
  const img = imageUrl ?? data?.[0]?.image_url;
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
  dateFrom, dateTo,
}: {
  row: NeededRow; lang: string; sortBy: SortBy; isSnoozePending: boolean;
  isExcludePending: boolean; confirmExclude: number | null;
  t: (fr: string, ar: string) => string;
  onHistory: () => void; onOrder: () => void; onSnooze: () => void;
  onExcludeRequest: () => void; onExcludeConfirm: () => void; onExcludeCancel: () => void;
  dateFrom: string; dateTo: string;
}) {
  const name = lang === "ar" && row.designation_ar ? row.designation_ar : row.designation;
  const famille = lang === "ar" && row.famille_ar ? row.famille_ar : row.famille;
  const stock = Number(row.stock);
  const minStock = row.min_stock != null ? Number(row.min_stock) : null;
  const stockColor = stock === 0 ? "text-red-600" : "text-amber-600";

  // Suggested order quantity
  const minStockQty = minStock != null ? Math.max(1, minStock - stock) : null;
  const salesQty = (() => {
    if (Number(row.total_qty_sold) <= 0) return null;
    const days = dateFrom && dateTo
      ? Math.max(1, (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86_400_000 + 1)
      : 30;
    return Math.max(1, Math.ceil((Number(row.total_qty_sold) / days) * 7 * 4));
  })();
  const suggestedQty = salesQty ?? minStockQty;
  const costPrice = row.cost_price ? Number(row.cost_price) : null;

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
        <div className="shrink-0 text-right min-w-[52px]">
          <span className={`text-xs font-bold tabular-nums ${stockColor}`}>{stock.toLocaleString("fr-DZ")}</span>
          {stock === 0 && <div className="text-[9px] font-semibold text-red-600 leading-tight">RUPTURE</div>}
          <div className="flex items-center justify-end gap-0.5">
            <span className="text-[9px] text-muted-foreground">/</span>
            <InlineMinStockEdit productId={row.id} minStock={minStock} t={t} />
          </div>
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
      {/* Bottom row: supplier + qty + price + action buttons */}
      <div className="flex items-center border-t">
        <div className="flex-1 min-w-0 px-3 py-1.5 space-y-0.5">
          {row.supplier_name ? (
            <p className="text-[11px] text-blue-700 truncate font-medium">{row.supplier_name}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">—</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {suggestedQty != null && (
              <span className="text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5 tabular-nums">
                {t("Qté", "الكمية")} : {suggestedQty.toLocaleString("fr-DZ")}
              </span>
            )}
            {costPrice != null && (
              <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 rounded-full px-2 py-0.5 tabular-nums">
                {costPrice.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA
              </span>
            )}
          </div>
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

// ── SuggestDrawer (create & edit) ─────────────────────────────────────────────
function SuggestDrawer({
  open,
  onOpenChange,
  onCreated,
  editTarget,
  t,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  editTarget?: PurchaseSuggestion | null;
  t: (fr: string, ar: string) => string;
}) {
  const isEdit = !!editTarget;
  const [productName, setProductName] = useState("");
  const [notes, setNotes] = useState("");
  const [marketPrice, setMarketPrice] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate fields when opened in edit mode
  useEffect(() => {
    if (open && editTarget) {
      setProductName(editTarget.product_name);
      setNotes(editTarget.notes ?? "");
      setMarketPrice(editTarget.market_price ?? "");
      setImagePreview(editTarget.image_url ? resolveImg(editTarget.image_url) : null);
      setImageFile(null);
      setError(null);
    } else if (open && !editTarget) {
      setProductName(""); setNotes(""); setMarketPrice(""); setImageFile(null); setImagePreview(null); setError(null);
    }
  }, [open, editTarget]);

  const reset = () => {
    setProductName(""); setNotes(""); setMarketPrice(""); setImageFile(null); setImagePreview(null); setError(null);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) { setError(t("Nom du produit requis", "اسم المنتج مطلوب")); return; }
    setSubmitting(true);
    setError(null);
    try {
      let imageUrl: string | undefined;
      if (imageFile) {
        imageUrl = await uploadImage(imageFile);
      }
      if (isEdit && editTarget) {
        await updateSuggestion(editTarget.id, {
          product_name: productName.trim(),
          notes: notes.trim() || undefined,
          market_price: marketPrice.trim() || undefined,
          image_url: imageUrl ?? editTarget.image_url ?? undefined,
        });
      } else {
        await createSuggestion({
          product_name: productName.trim(),
          notes: notes.trim() || undefined,
          market_price: marketPrice.trim() || undefined,
          image_url: imageUrl,
        });
      }
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Erreur", "خطأ"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <div className="flex items-center justify-between">
            <DrawerTitle className="flex items-center gap-2">
              {isEdit
                ? <><Pencil className="h-5 w-5 text-blue-500" />{t("Modifier la suggestion", "تعديل الاقتراح")}</>
                : <><Lightbulb className="h-5 w-5 text-amber-500" />{t("Suggérer un produit", "اقتراح منتج")}</>
              }
            </DrawerTitle>
            <DrawerClose asChild>
              <button type="button" className="p-1 rounded-full hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </DrawerClose>
          </div>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-6 space-y-4">
          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            {/* Product name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("Nom du produit", "اسم المنتج")} *</label>
              <Input
                className="h-11 rounded-xl"
                placeholder={t("Ex: Huile moteur 5W40…", "مثال: زيت موتور 5W40…")}
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
            </div>

            {/* Market price */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("Prix marché (optionnel)", "سعر السوق (اختياري)")}</label>
              <div className="relative">
                <Input
                  className="h-11 rounded-xl pr-12"
                  placeholder={t("Ex: 1500 DA", "مثال: 1500 دج")}
                  value={marketPrice}
                  onChange={(e) => setMarketPrice(e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">DA</span>
              </div>
            </div>

            {/* Image */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("Photo (optionnel)", "صورة (اختياري)")}</label>
              {imagePreview ? (
                <div className="relative w-24 h-24">
                  <img src={imagePreview} alt="" className="w-24 h-24 rounded-xl object-cover border" />
                  <button
                    type="button"
                    onClick={() => { setImageFile(null); setImagePreview(null); }}
                    className="absolute -top-1.5 -right-1.5 bg-white rounded-full border shadow p-0.5"
                  >
                    <X className="h-3 w-3 text-slate-600" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors">
                  <Package className="h-5 w-5 text-gray-400" />
                  <span className="text-sm text-muted-foreground">{t("Choisir une image", "اختر صورة")}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
                </label>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("Remarques (optionnel)", "ملاحظات (اختياري)")}</label>
              <textarea
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={t("Fournisseur habituel, taille, couleur…", "المورد المعتاد، الحجم، اللون…")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting || !productName.trim()}
              className={`w-full h-12 rounded-xl text-white font-semibold transition-colors disabled:opacity-60 ${isEdit ? "bg-blue-600 hover:bg-blue-700" : "bg-amber-500 hover:bg-amber-600"}`}
            >
              {submitting
                ? t("Envoi…", "جارٍ…")
                : isEdit
                  ? t("Enregistrer les modifications", "حفظ التعديلات")
                  : t("Soumettre la suggestion", "إرسال الاقتراح")
              }
            </button>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function SmartPurchase() {
  const { lang } = useLang();
  const t = useCallback((fr: string, ar: string) => lang === "ar" ? ar : fr, [lang]);
  const store = useCurrentStore();
  const qc = useQueryClient();
  const { user: me, isAdmin: isMeAdmin } = useMe();

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
  const [historyProduct, setHistoryProduct] = useState<{ id: number; name: string; imageUrl: string | null } | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [editSuggestion, setEditSuggestion] = useState<PurchaseSuggestion | null>(null);

  // Suggestions query + mutations
  const { data: suggestions, refetch: refetchSuggestions } = useQuery<PurchaseSuggestion[]>({
    queryKey: ["purchase-suggestions", store?.id],
    queryFn: fetchSuggestions,
    enabled: !!store?.id,
    staleTime: 15_000,
  });
  const suggestionCount = suggestions?.length ?? 0;

  const tapMut = useMutation({
    mutationFn: (id: number) => tapSuggestion(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["purchase-suggestions"] }),
  });
  const deleteSuggestMut = useMutation({
    mutationFn: (id: number) => deleteSuggestion(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["purchase-suggestions"] }),
  });

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

  // Build query params — stockFilter included so tab changes reset pagination
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
    if (stockFilter === "rupture" || stockFilter === "low") p.stockFilter = stockFilter;
    return p;
  }, [search, filterSupplierId, filterFamilyId, filterBrandId, filterCity, filterDateFrom, filterDateTo, sortBy, stockFilter]);

  const {
    data: neededPages,
    isLoading,
    isPending,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["smart-purchase-needed", store?.id, queryParams],
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchNeeded({ ...queryParams, limit: "10", offset: String(pageParam) }),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((s, p) => s + p.rows.length, 0);
      const sf = queryParams.stockFilter;
      const total = sf === "rupture" ? lastPage.ruptureTotal
                  : sf === "low"    ? lastPage.lowTotal
                  : lastPage.ruptureTotal + lastPage.lowTotal;
      return loaded < total ? loaded : undefined;
    },
    initialPageParam: 0,
    enabled: !!store?.id && stockFilter !== "suggestions",
    staleTime: 30_000,
  });

  // Auto min_stock calculation
  const [autoCalcOpen, setAutoCalcOpen] = useState(false);
  const [autoCalcPhase, setAutoCalcPhase] = useState<"idle" | "preview" | "done">("idle");
  const [autoCalcPreview, setAutoCalcPreview] = useState<AutoMinStockPreviewRow[]>([]);
  const [autoCalcSelected, setAutoCalcSelected] = useState<Set<number>>(new Set());
  const [autoCalcProtectManual, setAutoCalcProtectManual] = useState(false);
  const [autoCalcResult, setAutoCalcResult] = useState<{ updated: number; skipped: number } | null>(null);
  const [resetConfirmStep, setResetConfirmStep] = useState(0);
  const [resetResult, setResetResult] = useState<number | null>(null);

  const autoCalcPreviewMut = useMutation({
    mutationFn: fetchAutoMinStockPreview,
    onSuccess: (data) => {
      const rows = data.rows;
      setAutoCalcPreview(rows);
      // Default: all selected; if protectManual is on, pre-deselect rows with a manual value
      const sel = new Set(rows.map((r) => r.product_id));
      setAutoCalcSelected(sel);
      setAutoCalcPhase("preview");
    },
  });

  const autoCalcMut = useMutation({
    mutationFn: (body: { productIds: number[]; protectManual: boolean }) => fetchAutoMinStock(body),
    onSuccess: (data) => {
      setAutoCalcResult(data);
      setAutoCalcPhase("done");
      void qc.invalidateQueries({ queryKey: ["smart-purchase-needed"] });
    },
  });

  const resetMinStockMut = useMutation({
    mutationFn: fetchResetMinStock,
    onSuccess: (data) => {
      setResetResult(data.reset);
      setAutoCalcPhase("done");
      void qc.invalidateQueries({ queryKey: ["smart-purchase-needed"] });
    },
  });

  function openAutoCalcDrawer() {
    setAutoCalcPhase("idle");
    setAutoCalcPreview([]);
    setAutoCalcSelected(new Set());
    setAutoCalcProtectManual(false);
    setAutoCalcResult(null);
    setResetConfirmStep(0);
    setResetResult(null);
    autoCalcPreviewMut.reset();
    autoCalcMut.reset();
    resetMinStockMut.reset();
    setAutoCalcOpen(true);
  }

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

  // Flatten infinite pages; tab filtering is now server-side
  const allRows = useMemo(
    () => neededPages?.pages.flatMap((p) => p.rows) ?? [],
    [neededPages],
  );
  const firstMeta    = neededPages?.pages[0];
  const ruptureCount = firstMeta?.ruptureTotal ?? 0;
  const lowCount     = firstMeta?.lowTotal     ?? 0;
  const displayRows  = allRows;

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
                  {queryParams.stockFilter === "rupture" ? ruptureCount
                    : queryParams.stockFilter === "low"  ? lowCount
                    : ruptureCount + lowCount} {t("produit(s) à acheter", "منتج(ات) للشراء")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {/* Suggest button */}
              <Button
                size="icon" variant="ghost"
                className="h-10 w-10 rounded-full relative"
                onClick={() => setSuggestOpen(true)}
                aria-label={t("Suggérer un produit", "اقتراح منتج")}
              >
                <MessageSquarePlus className="h-4 w-4" />
                {suggestionCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-amber-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                    {suggestionCount > 9 ? "9+" : suggestionCount}
                  </span>
                )}
              </Button>

              {/* Auto-calculate min_stock thresholds */}
              <Button
                size="icon" variant="ghost"
                className="h-10 w-10 rounded-full text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                onClick={openAutoCalcDrawer}
                aria-label={t("Calculer seuils auto", "حساب الحدود تلقائياً")}
              >
                <Zap className="h-4 w-4" />
              </Button>

              {(ruptureCount + lowCount) > 0 && stockFilter !== "suggestions" && (
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

          {/* Stock filter: Tout / En rupture / Stock faible / Suggestions */}
          {!isLoading && (ruptureCount + lowCount > 0 || suggestionCount > 0) && (
            <div className="flex rounded-xl border bg-gray-100 p-1 gap-1">
              {([
                { key: "all",         labelFr: "Tout",         labelAr: "الكل",          count: ruptureCount + lowCount, activeColor: "bg-white text-slate-800" },
                { key: "rupture",     labelFr: "En rupture",   labelAr: "نفد المخزون",   count: ruptureCount,            activeColor: "bg-red-600 text-white" },
                { key: "low",         labelFr: "Stock faible", labelAr: "مخزون منخفض",  count: lowCount,                activeColor: "bg-orange-500 text-white" },
                { key: "suggestions", labelFr: "Idées",        labelAr: "اقتراحات",      count: suggestionCount,         activeColor: "bg-amber-500 text-white" },
              ] as { key: StockFilter; labelFr: string; labelAr: string; count: number; activeColor: string }[]).map(({ key, labelFr, labelAr, count, activeColor }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStockFilter(key)}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-all ${
                    stockFilter === key ? `${activeColor} shadow-sm` : "text-gray-500 hover:text-gray-700"
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

        {/* ── Suggestions panel ── */}
        {stockFilter === "suggestions" && (
          <>
            {(suggestions ?? []).length === 0 ? (
              <div className="text-center py-20 space-y-3">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
                  <Lightbulb className="h-8 w-8 text-amber-500" />
                </div>
                <p className="font-semibold text-gray-700">{t("Aucune suggestion pour l'instant", "لا توجد اقتراحات بعد")}</p>
                <p className="text-sm text-muted-foreground">{t("Appuyez sur + pour suggérer un produit demandé par un client.", "اضغط + لاقتراح منتج طلبه عميل.")}</p>
                <button
                  type="button"
                  onClick={() => setSuggestOpen(true)}
                  className="mx-auto flex items-center gap-2 px-5 py-2.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  {t("Suggérer un produit", "اقتراح منتج")}
                </button>
              </div>
            ) : (
              (suggestions ?? []).map((s) => {
                const imgUrl = resolveImg(s.image_url);
                const canEdit = isMeAdmin || s.staff_id === me?.id;
                const canDelete = isMeAdmin || s.staff_id === me?.id;
                return (
                  <div key={s.id} className="rounded-2xl bg-white border shadow-sm overflow-hidden">
                    <div className="p-4 space-y-3">
                      {/* Top row */}
                      <div className="flex items-start gap-3">
                        {imgUrl ? (
                          <img src={imgUrl} alt={s.product_name}
                            className="w-14 h-14 rounded-xl object-cover border shrink-0" />
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                            <Lightbulb className="h-6 w-6 text-amber-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 leading-tight line-clamp-2">{s.product_name}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {s.staff_name ?? t("Employé", "موظف")} · {new Date(s.created_at).toLocaleDateString(lang === "ar" ? "ar-DZ" : "fr-DZ")}
                          </p>
                          {/* Market price badge */}
                          {s.market_price && (
                            <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700">
                              🏷 {s.market_price}
                            </span>
                          )}
                          {s.notes && (
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{s.notes}</p>
                          )}
                        </div>
                        {/* Demand counter */}
                        <div className="shrink-0 flex flex-col items-center gap-1">
                          <span className="text-2xl font-extrabold tabular-nums text-amber-600 leading-none">{s.demand_count}</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("demandes", "طلب")}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action row */}
                    <div className="flex border-t">
                      {/* +1 tap */}
                      <button
                        type="button"
                        disabled={tapMut.isPending}
                        onClick={() => tapMut.mutate(s.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 active:bg-amber-100 transition-colors border-r disabled:opacity-60"
                      >
                        <ThumbsUp className="h-4 w-4" />
                        {t("+1 client demande", "+1 عميل طلب")}
                      </button>

                      {/* Commander */}
                      <button
                        type="button"
                        onClick={() => setQuickOrderProduct({
                          id: 0,
                          designation: s.product_name,
                          designation_ar: s.product_name,
                          image_url: s.image_url,
                          stock: 0,
                          min_stock: Math.max(1, s.demand_count),
                          cost_price: null,
                          price: null,
                          reference: null,
                          famille: null,
                          famille_ar: null,
                          marque: null,
                          supplier_id: null,
                          supplier_name: null,
                          supplier_city: null,
                          supplier_phone: null,
                          benefice: 0,
                          total_qty_sold: 0,
                        })}
                        className="flex-1 flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 active:bg-blue-100 transition-colors border-r"
                      >
                        <ShoppingCart className="h-4 w-4" />
                        {t("Commander", "اطلب")}
                      </button>

                      {/* Edit — admin or creator only */}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setEditSuggestion(s)}
                          className="px-3.5 flex items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-blue-600 active:bg-slate-100 transition-colors border-r"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}

                      {/* Delete — admin or creator only */}
                      {canDelete && (
                        <button
                          type="button"
                          disabled={deleteSuggestMut.isPending}
                          onClick={() => deleteSuggestMut.mutate(s.id)}
                          className="px-3.5 flex items-center justify-center text-red-400 hover:bg-red-50 hover:text-red-600 active:bg-red-100 transition-colors disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* Product list — hidden when in suggestions tab */}
        {stockFilter !== "suggestions" && isPending && (
          [...Array(5)].map((_, i) => (
            <div key={i} className="rounded-2xl bg-white border p-4 shadow-sm space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ))
        )}

        {stockFilter !== "suggestions" && !isPending && displayRows.length === 0 && (
          <div className="text-center py-20 space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            {stockFilter === "rupture" ? (
              <>
                <p className="font-semibold text-gray-700">{t("Aucun produit en rupture de stock", "لا يوجد منتج نافد المخزون")}</p>
                <p className="text-sm text-muted-foreground">{t("Tous les produits ont du stock en ce moment.", "كل المنتجات متوفرة حالياً.")}</p>
              </>
            ) : stockFilter === "low" ? (
              <>
                <p className="font-semibold text-gray-700">{t("Aucun produit à stock faible", "لا يوجد منتج بمخزون منخفض")}</p>
                <p className="text-sm text-muted-foreground">{t("Aucun produit n'est sous son seuil minimum en ce moment.", "لا يوجد منتج تحت الحد الأدنى حالياً.")}</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-gray-700">{t("Tout est en stock !", "المخزون مكتمل!")}</p>
                <p className="text-sm text-muted-foreground">{t("Aucun produit nécessite d'achat en ce moment.", "لا يوجد منتج يحتاج إلى شراء الآن.")}</p>
              </>
            )}
          </div>
        )}

        {/* ── Cards view ── */}
        {stockFilter !== "suggestions" && viewMode === "cards" && displayRows.map((row) => {
          const isSnoozePending = pendingSnooze.has(row.id);
          const imgUrl = resolveImg(row.image_url);

          // ── Suggested quantity ──────────────────────────────────────────────
          const cardStock = Number(row.stock);
          const cardMinStock = row.min_stock != null ? Number(row.min_stock) : null;
          const cardMinStockQty = cardMinStock != null ? Math.max(1, cardMinStock - cardStock) : null;
          const cardSalesQty = (() => {
            if (Number(row.total_qty_sold) <= 0) return null;
            const days = filterDateFrom && filterDateTo
              ? Math.max(1, (new Date(filterDateTo).getTime() - new Date(filterDateFrom).getTime()) / 86_400_000 + 1)
              : 30;
            return Math.max(1, Math.ceil((Number(row.total_qty_sold) / days) * 7 * 4));
          })();
          const suggestedQty = cardSalesQty ?? cardMinStockQty;

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
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[9px] text-muted-foreground/70">{t("Min:", "الحد:")}</span>
                      <InlineMinStockEdit productId={row.id} minStock={row.min_stock != null ? Number(row.min_stock) : null} t={t} />
                    </div>
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

                {/* Suggested quantity */}
                {suggestedQty != null && (
                  <div className="flex items-center justify-between text-xs px-1">
                    <span className="text-muted-foreground">
                      {t("Qté à commander", "الكمية المقترحة")}
                      {cardSalesQty != null && (
                        <span className="ml-1 text-[10px] text-muted-foreground/70">({t("moy. 4 sem.", "متوسط 4 أسابيع")})</span>
                      )}
                    </span>
                    <span className="font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-0.5 tabular-nums">
                      {suggestedQty.toLocaleString("fr-DZ")}
                    </span>
                  </div>
                )}

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
                  onClick={() => setHistoryProduct({ id: row.id, name: lang === "ar" && row.designation_ar ? row.designation_ar : row.designation, imageUrl: row.image_url ?? null })}
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
        {stockFilter !== "suggestions" && viewMode === "list" && displayRows.map((row) => (
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
            dateFrom={filterDateFrom}
            dateTo={filterDateTo}
          />
        ))}

        {/* ── Fetching-next-page skeletons ── */}
        {stockFilter !== "suggestions" && isFetchingNextPage && (
          [...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl bg-white border p-4 shadow-sm space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ))
        )}

        {/* ── Load-more button ── */}
        {stockFilter !== "suggestions" && hasNextPage && !isFetchingNextPage && (
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            className="w-full py-4 text-sm font-semibold text-blue-600 border border-blue-200 rounded-2xl bg-white hover:bg-blue-50 active:bg-blue-100 transition-colors flex items-center justify-center gap-2"
          >
            {t("Charger 10 de plus", "تحميل 10 أخرى")}
          </button>
        )}
      </div>

      {/* ── Suggest / Edit drawer ── */}
      <SuggestDrawer
        open={suggestOpen || !!editSuggestion}
        onOpenChange={(v) => { if (!v) { setSuggestOpen(false); setEditSuggestion(null); } }}
        onCreated={() => void refetchSuggestions()}
        editTarget={editSuggestion}
        t={t}
      />

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
            imageUrl={historyProduct?.imageUrl ?? null}
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

      {/* ── Auto min_stock calculation drawer ── */}
      <Drawer open={autoCalcOpen} onOpenChange={(v) => { setAutoCalcOpen(v); }}>
        <DrawerContent className="max-h-[90vh] flex flex-col">
          <DrawerHeader className="border-b pb-3 shrink-0">
            <DrawerTitle className="flex items-center gap-2 text-base font-semibold">
              <Zap className="h-4 w-4 text-amber-500" />
              {t("Calcul automatique des seuils", "الحساب التلقائي للحدود الدنيا")}
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4">
              <X className="h-5 w-5 text-muted-foreground" />
            </DrawerClose>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
            {/* ── Phase: done ── */}
            {autoCalcPhase === "done" && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                </div>
                {resetResult != null ? (
                  <>
                    <p className="font-semibold text-gray-800">
                      {t("Seuils effacés !", "تم مسح الحدود!")}
                    </p>
                    <p className="text-2xl font-extrabold text-slate-700">{resetResult}</p>
                    <p className="text-xs text-muted-foreground">{t("seuil(s) remis à zéro", "حد(ود) تم إعادة ضبطها")}</p>
                  </>
                ) : autoCalcResult != null ? (
                  <>
                    <p className="font-semibold text-gray-800">
                      {t("Seuils mis à jour !", "تم تحديث الحدود!")}
                    </p>
                    <div className="flex gap-4 text-sm">
                      <div className="text-center">
                        <p className="text-2xl font-extrabold text-emerald-700">{autoCalcResult.updated}</p>
                        <p className="text-xs text-muted-foreground">{t("mis à jour", "تم تحديثها")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-extrabold text-slate-400">{autoCalcResult.skipped}</p>
                        <p className="text-xs text-muted-foreground">{t("ignorés", "تُجوهلت")}</p>
                      </div>
                    </div>
                  </>
                ) : null}
                <Button variant="outline" size="sm" className="mt-1 rounded-xl"
                  onClick={() => setAutoCalcOpen(false)}>
                  {t("Fermer", "إغلاق")}
                </Button>
              </div>
            )}

            {/* ── Phase: idle ── */}
            {autoCalcPhase === "idle" && (
              <>
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-1.5 text-sm">
                  <p className="font-semibold text-amber-800">
                    {t("Formule utilisée", "الصيغة المستخدمة")}
                  </p>
                  <p className="text-amber-700 text-xs leading-relaxed">
                    {t(
                      "Seuil min = ⌈ ventes des 3 derniers mois / 3 ⌉  (arrondi au supérieur)",
                      "الحد الأدنى = ⌈ مبيعات آخر 3 أشهر ÷ 3 ⌉  (تقريب للأعلى)"
                    )}
                  </p>
                  <p className="text-amber-600 text-xs">
                    {t(
                      "Les produits sans ventes sur cette période sont ignorés.",
                      "المنتجات التي لم تُباع خلال هذه الفترة يتم تجاهلها."
                    )}
                  </p>
                </div>

                {autoCalcPreviewMut.isError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">
                    {t("Erreur inattendue. Réessayez.", "خطأ غير متوقع. حاول مجدداً.")}
                  </p>
                )}
                {resetMinStockMut.isError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">
                    {t("Erreur lors de la réinitialisation.", "خطأ أثناء إعادة الضبط.")}
                  </p>
                )}

                <Button
                  className="w-full h-12 rounded-xl text-base bg-amber-500 hover:bg-amber-600 text-white gap-2"
                  disabled={autoCalcPreviewMut.isPending}
                  onClick={() => autoCalcPreviewMut.mutate()}
                >
                  <Search className="h-4 w-4" />
                  {autoCalcPreviewMut.isPending
                    ? t("Calcul en cours…", "جارٍ الحساب…")
                    : t("Prévisualiser les seuils", "معاينة الحدود")}
                </Button>

                {/* Effacer les seuils — two-tap confirm */}
                {resetConfirmStep === 0 ? (
                  <Button
                    variant="outline"
                    className="w-full h-10 rounded-xl text-sm text-red-600 border-red-200 hover:bg-red-50 gap-2"
                    disabled={resetMinStockMut.isPending}
                    onClick={() => setResetConfirmStep(1)}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("Effacer les seuils", "مسح الحدود الدنيا")}
                  </Button>
                ) : (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2">
                    <p className="text-sm text-red-700 font-medium text-center">
                      {t("Remettre TOUS les seuils à zéro ?", "هل تريد إعادة ضبط جميع الحدود؟")}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 rounded-xl"
                        onClick={() => setResetConfirmStep(0)}
                        disabled={resetMinStockMut.isPending}
                      >
                        {t("Annuler", "إلغاء")}
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white gap-1"
                        disabled={resetMinStockMut.isPending}
                        onClick={() => { setResetConfirmStep(0); resetMinStockMut.mutate(); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {resetMinStockMut.isPending
                          ? t("Effacement…", "جارٍ المسح…")
                          : t("Confirmer", "تأكيد")}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Phase: preview ── */}
            {autoCalcPhase === "preview" && (
              <>
                {/* Protect manual toggle */}
                <div className="flex items-center justify-between rounded-xl border bg-slate-50 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700">
                      {t("Protéger les valeurs manuelles", "حماية القيم اليدوية")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("Ignorer les produits déjà configurés", "تجاهل المنتجات المضبوطة مسبقاً")}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoCalcProtectManual}
                    onClick={() => {
                      const next = !autoCalcProtectManual;
                      setAutoCalcProtectManual(next);
                      if (next) {
                        // Deselect rows that have a manual value already
                        setAutoCalcSelected((prev) => {
                          const newSet = new Set(prev);
                          autoCalcPreview.forEach((r) => {
                            if (r.current_min_stock != null) newSet.delete(r.product_id);
                          });
                          return newSet;
                        });
                      } else {
                        // Re-select all
                        setAutoCalcSelected(new Set(autoCalcPreview.map((r) => r.product_id)));
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-3 ${
                      autoCalcProtectManual ? "bg-amber-500" : "bg-gray-300"
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      autoCalcProtectManual ? "translate-x-6" : "translate-x-1"
                    }`} />
                  </button>
                </div>

                {/* Select all / deselect all */}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {autoCalcSelected.size} / {autoCalcPreview.length} {t("sélectionnés", "محدد")}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className="text-xs text-blue-600 hover:underline"
                      onClick={() => setAutoCalcSelected(new Set(autoCalcPreview.map((r) => r.product_id)))}>
                      {t("Tout", "الكل")}
                    </button>
                    <span className="text-xs text-muted-foreground">·</span>
                    <button type="button" className="text-xs text-blue-600 hover:underline"
                      onClick={() => setAutoCalcSelected(new Set())}>
                      {t("Aucun", "لا شيء")}
                    </button>
                  </div>
                </div>

                {/* Preview rows */}
                {autoCalcPreview.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    {t("Aucun produit avec des ventes sur 3 mois.", "لا توجد منتجات بمبيعات خلال 3 أشهر.")}
                  </div>
                ) : (
                  <div className="space-y-1 rounded-xl border overflow-hidden">
                    {autoCalcPreview.map((row) => {
                      const isSelected = autoCalcSelected.has(row.product_id);
                      const hasManual = row.current_min_stock != null;
                      const name = lang === "ar" && row.name_ar ? row.name_ar : row.name;
                      return (
                        <label
                          key={row.product_id}
                          className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                            isSelected ? "bg-white" : "bg-slate-50 opacity-60"
                          } border-b last:border-b-0`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-amber-500 shrink-0"
                            checked={isSelected}
                            onChange={(e) => {
                              setAutoCalcSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(row.product_id);
                                else next.delete(row.product_id);
                                return next;
                              });
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{name}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-xs tabular-nums">
                            <span className={`${hasManual ? "text-slate-500" : "text-slate-400"} min-w-[2rem] text-right`}>
                              {row.current_min_stock != null ? row.current_min_stock : "—"}
                            </span>
                            <span className="text-slate-300">→</span>
                            <span className="font-bold text-amber-700 min-w-[2rem] text-left">{row.suggested}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {autoCalcMut.isError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">
                    {t("Erreur inattendue. Réessayez.", "خطأ غير متوقع. حاول مجدداً.")}
                  </p>
                )}

                <div className="flex gap-2 pt-1 shrink-0">
                  <Button
                    variant="outline"
                    className="flex-1 h-12 rounded-xl"
                    onClick={() => setAutoCalcPhase("idle")}
                    disabled={autoCalcMut.isPending}
                  >
                    {t("Retour", "رجوع")}
                  </Button>
                  <Button
                    className="flex-1 h-12 rounded-xl text-base bg-amber-500 hover:bg-amber-600 text-white gap-2"
                    disabled={autoCalcMut.isPending || autoCalcSelected.size === 0}
                    onClick={() =>
                      autoCalcMut.mutate({
                        productIds: Array.from(autoCalcSelected),
                        protectManual: autoCalcProtectManual,
                      })
                    }
                  >
                    <Zap className="h-4 w-4" />
                    {autoCalcMut.isPending
                      ? t("Application…", "جارٍ التطبيق…")
                      : t(`Appliquer (${autoCalcSelected.size})`, `تطبيق (${autoCalcSelected.size})`)}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

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

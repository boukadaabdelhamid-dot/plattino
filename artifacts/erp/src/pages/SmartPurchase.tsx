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
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
type SortBy = "profit" | "qty_sold";

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
): Promise<{ id: number; itemCount: number }> {
  const allItems = [
    ...existingItems.map(i => ({ productId: i.productId, quantity: Number(i.quantity), unitCost: Number(i.unitCost) })),
    newItem,
  ];
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
  return { id: poId, itemCount: allItems.length };
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
  product, suppliers, onClose, onOrdered, t, lang,
}: {
  product: NeededRow | null;
  suppliers: Array<{ id: number; name: string }>;
  onClose: () => void;
  onOrdered: (productId: number) => void;
  t: (fr: string, ar: string) => string;
  lang: string;
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
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: number; itemCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setSupplierId(product.supplier_id ? String(product.supplier_id) : "");
    const needed = product.min_stock != null ? Math.max(1, product.min_stock - product.stock) : 1;
    setQuantity(String(needed));
    setUnitCost(product.cost_price ? String(Number(product.cost_price).toFixed(2)) : "");
    setSuccess(null);
    setError(null);
    setMode("new");
    setSelectedPoId("");
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
                <Input type="number" min="1" step="1" className="h-12 rounded-xl"
                  value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>

              {/* ── Unit cost ── */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {t("Prix d'achat unitaire (DA)", "سعر الشراء الوحدوي (دج)")} *
                </label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" className="h-12 rounded-xl"
                  value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
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

// ── Main page ────────────────────────────────────────────────────────────────
export default function SmartPurchase() {
  const { lang } = useLang();
  const t = useCallback((fr: string, ar: string) => lang === "ar" ? ar : fr, [lang]);
  const store = useCurrentStore();
  const qc = useQueryClient();

  // Sort + filter state
  const [sortBy, setSortBy] = useState<SortBy>("profit");
  const [search, setSearch] = useState("");
  const [filterSupplierId, setFilterSupplierId] = useState<string>("");
  const [filterFamilyId, setFilterFamilyId] = useState<string>("");
  const [filterBrandId, setFilterBrandId] = useState<string>("");
  const [filterCity, setFilterCity] = useState("");

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
    if (sortBy !== "profit") p.sortBy = sortBy;
    return p;
  }, [search, filterSupplierId, filterFamilyId, filterBrandId, filterCity, sortBy]);

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

  const displayRows = rows ?? [];

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
              <Button
                size="icon" variant="ghost"
                className="h-10 w-10 rounded-full"
                onClick={() => void refetch()}
                aria-label={t("Rafraîchir", "تحديث")}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
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

          {/* Active filter chips */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeFilters.map((f) => (
                <FilterChip key={f.label} label={f.label} onRemove={f.onRemove} />
              ))}
              <button
                className="text-xs text-muted-foreground underline ml-1"
                onClick={() => { setFilterSupplierId(""); setFilterFamilyId(""); setFilterBrandId(""); setFilterCity(""); }}
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

        {displayRows.map((row) => {
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
      />
    </div>
  );
}

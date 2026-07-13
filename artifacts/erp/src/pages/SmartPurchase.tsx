import React, { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { useCurrentStore } from "@/hooks/use-current-store";
import { useGetErpSettingsProductsFamilies, useGetErpSettingsProductsBrands, useGetSuppliers } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose,
} from "@/components/ui/drawer";
import {
  ShoppingBasket, SlidersHorizontal, X, History, CheckCircle2,
  Package, Search, RefreshCw, MapPin, Phone,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
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

// ── Main page ────────────────────────────────────────────────────────────────
export default function SmartPurchase() {
  const { lang } = useLang();
  const t = useCallback((fr: string, ar: string) => lang === "ar" ? ar : fr, [lang]);
  const store = useCurrentStore();
  const qc = useQueryClient();

  // Filter state
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

  // Attribute lists for filter selects
  const { data: familiesData } = useGetErpSettingsProductsFamilies();
  const { data: brandsData } = useGetErpSettingsProductsBrands();
  const { data: suppliersData } = useGetSuppliers({ limit: 9999 });

  const families = useMemo(() => (familiesData?.items ?? []) as Array<{ id: number; nameFr: string; nameAr: string }>, [familiesData]);
  const brands = useMemo(() => (brandsData?.items ?? []) as Array<{ id: number; nameFr: string; nameAr: string }>, [brandsData]);
  const suppliers = useMemo(() => (suppliersData?.data ?? []) as Array<{ id: number; name: string }>, [suppliersData]);

  // Build query params
  const queryParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (search) p.search = search;
    if (filterSupplierId) p.supplierId = filterSupplierId;
    if (filterFamilyId) p.familyId = filterFamilyId;
    if (filterBrandId) p.brandId = filterBrandId;
    if (filterCity) p.supplierCity = filterCity;
    return p;
  }, [search, filterSupplierId, filterFamilyId, filterBrandId, filterCity]);

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

                {/* Stats row: stock + bénéfice */}
                <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                      {t("Stock", "المخزون")}
                    </p>
                    <StockBar stock={Number(row.stock)} minStock={row.min_stock != null ? Number(row.min_stock) : null} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                      {t("Bénéfice hist.", "الربح التاريخي")}
                    </p>
                    <p className={`text-sm font-bold tabular-nums ${Number(row.benefice) > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                      {fmtNum(row.benefice)} <span className="text-[10px] font-normal">DA</span>
                    </p>
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
    </div>
  );
}

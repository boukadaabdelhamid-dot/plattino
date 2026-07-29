import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { useMe } from "@/hooks/use-me";
import { useStoreContext } from "@/hooks/use-store";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useGetErpStoresAll } from "@workspace/api-client-react";
import { CreateTransferDialog, type LineDraft, type ProductLite } from "@/pages/Transfers";
import { resolveImg } from "@/lib/utils";
import {
  AlertTriangle, Package, ArrowLeftRight, RefreshCw,
  Store as StoreIcon, Clock, TrendingDown, Check,
  Pencil, X, Save, Send, ArrowUpDown, CalendarClock,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("midanic_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Types ────────────────────────────────────────────────────────────────────

type CrossStoreMissingRow = {
  source_product_id: number;
  name_en: string;
  name_ar: string;
  image_url: string | null;
  reference: string | null;
  barcode: string | null;
  source_stock: number;
  source_store_id: number;
  source_store_name_en: string;
  source_store_name_ar: string;
  local_stock: number;
};

type SlowMoverRow = {
  id: number;
  name_en: string;
  name_ar: string;
  image_url: string | null;
  reference: string | null;
  barcode: string | null;
  stock: number;
  selling_price: number | null;
  cost_price: number | null;
  category_name_en: string | null;
  category_name_ar: string | null;
  last_sold_at: string | null;
  days_since_last_sale: number | null;
};

type SlowStats = { count: number; slowValue: number; totalValue: number; pctOfTotal: number };
type SlowMoversResponse = { items: SlowMoverRow[]; stats: SlowStats };

type ExpiryRow = {
  batch_id: number;
  product_id: number;
  quantity: number;
  expiry_date: string;
  lot_number: string | null;
  notes: string | null;
  name_en: string;
  name_ar: string;
  reference: string | null;
  barcode: string | null;
  image_url: string | null;
  days_left: number;
};

type DialogConfig = {
  direction: "in" | "out";
  storeId: string;
  lines: LineDraft[];
  pickedProducts: Record<number, ProductLite>;
};

const DAY_OPTIONS = [30, 60, 90, 180] as const;
type Days = (typeof DAY_OPTIONS)[number];
type SortBy = "days" | "value" | "stock";

// ── Severity helpers ─────────────────────────────────────────────────────────

type Severity = "low" | "medium" | "high" | "critical" | "never";

function getSeverity(days: number | null, neverSold: boolean): Severity {
  if (neverSold) return "never";
  if (days === null) return "low";
  if (days >= 180) return "critical";
  if (days >= 90) return "high";
  if (days >= 60) return "medium";
  return "low";
}

const SEVERITY_CARD: Record<Severity, string> = {
  never:    "border-l-4 border-l-red-500 bg-red-50/40",
  critical: "border-l-4 border-l-red-400 bg-red-50/20",
  high:     "border-l-4 border-l-orange-400 bg-orange-50/20",
  medium:   "border-l-4 border-l-amber-400 bg-amber-50/15",
  low:      "border-l-4 border-l-yellow-300 bg-yellow-50/10",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  never:    "bg-red-100 text-red-800 border-red-300",
  critical: "bg-red-50 text-red-700 border-red-200",
  high:     "bg-orange-50 text-orange-700 border-orange-200",
  medium:   "bg-amber-50 text-amber-700 border-amber-200",
  low:      "bg-yellow-50 text-yellow-700 border-yellow-200",
};

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchCrossStoreMissing(): Promise<CrossStoreMissingRow[]> {
  const res = await fetch(`${API_BASE}/api/erp/alerts/cross-store-missing`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("fetch failed");
  return res.json() as Promise<CrossStoreMissingRow[]>;
}

async function fetchSlowMovers(days: Days): Promise<SlowMoversResponse> {
  const res = await fetch(
    `${API_BASE}/api/erp/alerts/slow-movers?days=${days}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error("fetch failed");
  return res.json() as Promise<SlowMoversResponse>;
}

async function fetchExpiringProducts(days: number): Promise<ExpiryRow[]> {
  const res = await fetch(
    `${API_BASE}/api/erp/alerts/expiring-products?days=${days}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error("fetch failed");
  return res.json() as Promise<ExpiryRow[]>;
}

function expiryCardStyle(daysLeft: number): { card: string; badge: string; label: string } {
  if (daysLeft < 0) return {
    card: "border-l-4 border-l-red-500 bg-red-50/50",
    badge: "bg-red-100 text-red-800 border-red-300",
    label: "Expiré",
  };
  if (daysLeft <= 7) return {
    card: "border-l-4 border-l-orange-400 bg-orange-50/40",
    badge: "bg-orange-100 text-orange-800 border-orange-200",
    label: `${daysLeft}j`,
  };
  return {
    card: "border-l-4 border-l-yellow-400 bg-yellow-50/30",
    badge: "bg-yellow-100 text-yellow-800 border-yellow-200",
    label: `${daysLeft}j`,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-DZ", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function formatPrice(n: number): string {
  return `${Math.round(n).toLocaleString("fr-DZ")} دج`;
}

// ── Skeleton cards ────────────────────────────────────────────────────────────
function CardSkeletons() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-[120px] rounded-xl" />
      ))}
    </div>
  );
}

// ── ProductLite builders ──────────────────────────────────────────────────────
function rowToProductLite(row: CrossStoreMissingRow): ProductLite {
  return {
    id: row.source_product_id,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    reference: row.reference,
    barcode: row.barcode,
    stock: Number(row.source_stock),
  };
}

function slowRowToProductLite(row: SlowMoverRow): ProductLite {
  return {
    id: row.id,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    reference: row.reference,
    barcode: row.barcode,
    stock: Number(row.stock),
  };
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function Alertes() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const { isAdmin } = useMe();
  const { currentStoreId } = useStoreContext();
  const qc = useQueryClient();

  // Filter + sort
  const [slowDays, setSlowDays] = useState<Days>(30);
  const [sortBy, setSortBy] = useState<SortBy>("days");

  // Cross-store multi-select
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Inline price editing
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [editingPriceVal, setEditingPriceVal] = useState("");
  const [savingPriceId, setSavingPriceId] = useState<number | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  // ── Snooze map ────────────────────────────────────────────────────────────
  const SNOOZE_LS_KEY = "midanic_slow_mover_snooze";
  const [snoozeMap, setSnoozeMap] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(SNOOZE_LS_KEY) ?? "{}") as Record<string, number>; }
    catch { return {}; }
  });
  const snoozeKey = (productId: number) => `${currentStoreId ?? 0}_${productId}`;
  const snoozeProduct = (productId: number) => {
    const updated = { ...snoozeMap, [snoozeKey(productId)]: Date.now() };
    setSnoozeMap(updated);
    try { localStorage.setItem(SNOOZE_LS_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  };

  // Transfer dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [dialogConfig, setDialogConfig] = useState<DialogConfig | null>(null);

  // Expiry settings from localStorage
  const expirySettings = (() => {
    try {
      const raw = localStorage.getItem("midanic_expiry_settings");
      if (raw) return JSON.parse(raw) as { enabled: boolean; days: number };
    } catch { /* ignore */ }
    return { enabled: true, days: 30 };
  })();
  const [expiryDays, setExpiryDays] = useState<number>(expirySettings.days ?? 30);

  // ── Queries ──
  const crossQuery = useQuery<CrossStoreMissingRow[]>({
    queryKey: ["alerts-cross-store-missing"],
    queryFn: fetchCrossStoreMissing,
    staleTime: 60_000,
  });

  const slowQuery = useQuery<SlowMoversResponse>({
    queryKey: ["alerts-slow-movers", slowDays],
    queryFn: () => fetchSlowMovers(slowDays),
    staleTime: 60_000,
  });

  const expiryQuery = useQuery<ExpiryRow[]>({
    queryKey: ["alerts-expiring-products", expiryDays],
    queryFn: () => fetchExpiringProducts(expiryDays),
    staleTime: 60_000,
    enabled: expirySettings.enabled,
  });

  const { data: allStores } = useGetErpStoresAll();
  const otherStores = useMemo(
    () =>
      ((allStores ?? []) as Array<{ id: number; nameEn: string; nameAr: string; isActive?: boolean }>)
        .filter((s) => s.id !== currentStoreId && s.isActive !== false),
    [allStores, currentStoreId],
  );

  const isRefetching = crossQuery.isRefetching || slowQuery.isRefetching || expiryQuery.isRefetching;
  const refetchAll = () => {
    void crossQuery.refetch();
    void slowQuery.refetch();
    void expiryQuery.refetch();
    void qc.invalidateQueries({ queryKey: ["alerts-count"] });
  };

  // Client-side sort + snooze filter
  const sortedSlowItems = useMemo(() => {
    const nowMs = Date.now();
    const storePrefix = `${currentStoreId ?? 0}_`;
    const items = (slowQuery.data?.items ?? []).filter((row) => {
      const editedAt = snoozeMap[storePrefix + row.id];
      if (!editedAt) return true;
      return (nowMs - editedAt) / 86_400_000 >= 30;
    });
    if (sortBy === "value") {
      return [...items].sort(
        (a, b) =>
          Number(b.stock) * Number(b.cost_price ?? 0) -
          Number(a.stock) * Number(a.cost_price ?? 0),
      );
    }
    if (sortBy === "stock") {
      return [...items].sort((a, b) => Number(b.stock) - Number(a.stock));
    }
    return items;
  }, [slowQuery.data, sortBy, snoozeMap, currentStoreId]);

  const slowStats = slowQuery.data?.stats;

  // Multi-store conflict guard
  const multiStoreConflict = useMemo(() => {
    if (selected.size === 0) return false;
    const rows = (crossQuery.data ?? []).filter((r) => selected.has(r.source_product_id));
    return new Set(rows.map((r) => r.source_store_id)).size > 1;
  }, [selected, crossQuery.data]);

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── Dialog helpers ──
  const openDialog = (cfg: DialogConfig) => {
    setDialogConfig(cfg);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };

  const openForProduct = (row: CrossStoreMissingRow) =>
    openDialog({
      direction: "in",
      storeId: String(row.source_store_id),
      lines: [{ sourceProductId: String(row.source_product_id), quantity: "1" }],
      pickedProducts: { [row.source_product_id]: rowToProductLite(row) },
    });

  const openForSelected = () => {
    if (multiStoreConflict) return;
    const rows = (crossQuery.data ?? []).filter((r) => selected.has(r.source_product_id));
    if (!rows.length) return;
    const storeId = String(rows[0]!.source_store_id);
    const pickedProducts: Record<number, ProductLite> = {};
    const lines: LineDraft[] = [];
    for (const row of rows) {
      pickedProducts[row.source_product_id] = rowToProductLite(row);
      lines.push({ sourceProductId: String(row.source_product_id), quantity: "1" });
    }
    openDialog({ direction: "in", storeId, lines, pickedProducts });
  };

  const openForSlowMoverTransfer = (row: SlowMoverRow) =>
    openDialog({
      direction: "out",
      storeId: "",
      lines: [{ sourceProductId: String(row.id), quantity: "1" }],
      pickedProducts: { [row.id]: slowRowToProductLite(row) },
    });

  // ── Inline price save ──
  const startEditPrice = (row: SlowMoverRow) => {
    setEditingPriceId(row.id);
    setEditingPriceVal(row.selling_price != null ? String(row.selling_price) : "");
    setPriceError(null);
  };
  const cancelEditPrice = () => {
    setEditingPriceId(null);
    setEditingPriceVal("");
    setPriceError(null);
  };

  const savePrice = async (row: SlowMoverRow) => {
    const newPrice = parseFloat(editingPriceVal.replace(",", "."));
    if (isNaN(newPrice) || newPrice <= 0) {
      setPriceError(t("Prix invalide", "سعر غير صالح"));
      return;
    }
    setSavingPriceId(row.id);
    setPriceError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/products/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ price: newPrice }),
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        setPriceError(err.error ?? t("Erreur lors de la sauvegarde", "خطأ أثناء الحفظ"));
        return;
      }
      qc.setQueryData<SlowMoversResponse>(["alerts-slow-movers", slowDays], (old) => {
        if (!old) return old;
        const newItems = old.items.map((item) =>
          item.id === row.id ? { ...item, selling_price: newPrice } : item,
        );
        const slowValue = newItems.reduce(
          (sum, r) => sum + Number(r.stock) * Number(r.cost_price ?? 0), 0,
        );
        const pctOfTotal = old.stats.totalValue > 0
          ? Math.round((slowValue / old.stats.totalValue) * 1000) / 10 : 0;
        return {
          items: newItems,
          stats: { ...old.stats, slowValue: Math.round(slowValue), pctOfTotal },
        };
      });
      setEditingPriceId(null);
      setEditingPriceVal("");
      snoozeProduct(row.id);
    } finally {
      setSavingPriceId(null);
    }
  };

  // ── Badge counts for tab triggers ────────────────────────────────────────
  const slowCount = slowStats?.count ?? 0;
  const crossCount = crossQuery.data?.length ?? 0;
  const expiryCount = expiryQuery.data?.length ?? 0;

  return (
    <div className="p-4 max-w-4xl mx-auto pb-28">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t("Alertes Intelligentes", "التنبيهات الذكية")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("Bضاعة راكدة · Transferts · Péremptions", "بضاعة راكدة · نقل · صلاحية")}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="slow" className="w-full">

        {/* Tab bar */}
        <TabsList className="w-full grid grid-cols-3 mb-5 h-auto p-1">

          {/* Tab 1: بضاعة راكدة */}
          <TabsTrigger value="slow" className="flex items-center gap-1.5 py-2 text-xs font-semibold">
            <TrendingDown className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("Bضاعة راكدة", "بضاعة راكدة")}</span>
            {slowCount > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-none shrink-0">
                {slowCount}
              </span>
            )}
          </TabsTrigger>

          {/* Tab 2: متاح في متاجر أخرى */}
          <TabsTrigger value="cross" className="flex items-center gap-1.5 py-2 text-xs font-semibold">
            <StoreIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("Inter-magasins", "متاجر أخرى")}</span>
            {crossCount > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-500 text-white text-[10px] font-bold leading-none shrink-0">
                {crossCount}
              </span>
            )}
          </TabsTrigger>

          {/* Tab 3: انتهاء الصلاحية */}
          <TabsTrigger value="expiry" className="flex items-center gap-1.5 py-2 text-xs font-semibold">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("Péremption", "الصلاحية")}</span>
            {expiryCount > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none shrink-0">
                {expiryCount}
              </span>
            )}
          </TabsTrigger>

        </TabsList>

        {/* ── Tab 1 content: بضاعة راكدة ─────────────────────────────── */}
        <TabsContent value="slow" className="space-y-3 mt-0">

          {/* Header + day filter */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-orange-500" />
              <h2 className="font-semibold text-sm">
                {t("Bضاعة راكدة — Produits invendus", "بضاعة راكدة — منتجات لم تُباع")}
              </h2>
              {slowStats && slowStats.count > 0 && (
                <Badge variant="secondary" className="ml-1 bg-orange-100 text-orange-700 border-orange-200">
                  {slowStats.count}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSlowDays(d)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    slowDays === d
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-white text-muted-foreground border-border hover:border-orange-300 hover:text-orange-600"
                  }`}
                >
                  {d}j
                </button>
              ))}
            </div>
          </div>

          {/* 3 stat cards */}
          {slowStats && slowStats.count > 0 && !slowQuery.isLoading && (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-orange-700">{slowStats.count}</div>
                <div className="text-[10px] text-orange-600 font-medium mt-0.5">
                  {t("Produits ralenties", "منتج راكد")}
                </div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                <div className="text-sm font-bold text-red-700 leading-tight">
                  {formatPrice(slowStats.slowValue)}
                </div>
                <div className="text-[10px] text-red-600 font-medium mt-0.5">
                  {t("Valeur immobilisée", "قيمة متوقفة")}
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-amber-700">{slowStats.pctOfTotal}%</div>
                <div className="text-[10px] text-amber-600 font-medium mt-0.5">
                  {t("Du stock total", "من المخزون الكلي")}
                </div>
              </div>
            </div>
          )}

          {/* Sort bar */}
          {sortedSlowItems.length > 0 && (
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[11px] text-muted-foreground">{t("Trier :", "ترتيب:")}</span>
              {([
                ["days",  t("Ancienneté", "الأقدم")],
                ["value", t("Valeur",     "القيمة")],
                ["stock", t("Stock",      "المخزون")],
              ] as [SortBy, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortBy(key)}
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded border transition-colors ${
                    sortBy === key
                      ? "bg-slate-800 text-white border-slate-800"
                      : "bg-white text-muted-foreground border-border hover:border-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {t(
              `Produits en stock qui n'ont pas été vendus depuis plus de ${slowDays} jours.`,
              `منتجات في المخزون لم تُباع منذ أكثر من ${slowDays} يوماً.`,
            )}
          </p>

          {slowQuery.isLoading && <CardSkeletons />}

          {!slowQuery.isLoading && sortedSlowItems.length === 0 && (
            <div className="rounded-xl border bg-muted/30 p-8 text-center">
              <TrendingDown className="h-9 w-9 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">
                {t(
                  `Aucun produit invendu depuis ${slowDays} jours ✓`,
                  `لا توجد بضاعة راكدة خلال ${slowDays} يوماً ✓`,
                )}
              </p>
            </div>
          )}

          {sortedSlowItems.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {sortedSlowItems.map((row) => {
                const name = lang === "ar" && row.name_ar ? row.name_ar : row.name_en;
                const neverSold = row.last_sold_at === null;
                const baseSeverity = getSeverity(row.days_since_last_sale, neverSold);
                const cardValue = Number(row.stock) * Number(row.cost_price ?? 0);
                const isEditingPrice = editingPriceId === row.id;
                const isSaving = savingPriceId === row.id;
                const daysLabel = neverSold
                  ? t("Jamais vendu ⚠️", "لم يُباع قط ⚠️")
                  : `${row.days_since_last_sale ?? "?"} ${t("jours", "يوم")}`;
                const catName = lang === "ar"
                  ? (row.category_name_ar ?? row.category_name_en)
                  : row.category_name_en;

                const editedAt = snoozeMap[snoozeKey(row.id)];
                const daysSinceEdit = editedAt ? (Date.now() - editedAt) / 86_400_000 : null;
                const snoozedSeverity: Severity | null =
                  daysSinceEdit === null ? null
                  : daysSinceEdit >= 180 ? "critical"
                  : daysSinceEdit >= 90  ? "high"
                  : "low";
                const severity: Severity = snoozedSeverity ?? baseSeverity;

                return (
                  <div
                    key={row.id}
                    className={`bg-white border rounded-xl p-3 shadow-sm flex gap-3 transition-colors ${SEVERITY_CARD[severity]}`}
                  >
                    <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden border">
                      {row.image_url
                        ? <img src={resolveImg(row.image_url)} alt={name} className="w-full h-full object-cover" />
                        : <Package className="h-6 w-6 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{name}</p>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        {(row.reference || row.barcode) && (
                          <p className="text-[11px] font-mono text-muted-foreground">
                            {row.reference ?? row.barcode}
                          </p>
                        )}
                        {catName && (
                          <span className="text-[10px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 border border-slate-200 truncate max-w-[110px]">
                            {catName}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                          {t("Stock", "مخزون")}: {Number(row.stock).toLocaleString("fr-DZ")}
                        </span>
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded px-1.5 py-0.5 border ${SEVERITY_BADGE[severity]}`}>
                          <Clock className="h-2.5 w-2.5" />
                          {daysLabel}
                        </span>
                        {cardValue > 0 && (
                          <span className="text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">
                            {formatPrice(cardValue)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {neverSold
                          ? t("Aucune vente enregistrée", "لا يوجد سجل بيع")
                          : `${t("Dernier vente", "آخر بيع")}: ${formatDate(row.last_sold_at)}`}
                      </p>
                      {daysSinceEdit !== null && (
                        <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                          <Pencil className="h-2.5 w-2.5 shrink-0" />
                          {t(
                            `Prix modifié il y a ${Math.floor(daysSinceEdit)} j — toujours invendu`,
                            `تعديل سعر منذ ${Math.floor(daysSinceEdit)} يوم — لم يُباع بعد`,
                          )}
                        </p>
                      )}
                      {isEditingPrice ? (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          <Input
                            type="number"
                            value={editingPriceVal}
                            onChange={(e) => setEditingPriceVal(e.target.value)}
                            className="h-7 text-xs w-28"
                            placeholder={t("Nouveau prix", "السعر الجديد")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void savePrice(row);
                              if (e.key === "Escape") cancelEditPrice();
                            }}
                            autoFocus
                            disabled={isSaving}
                          />
                          <button
                            type="button"
                            onClick={() => void savePrice(row)}
                            disabled={isSaving}
                            className="h-7 px-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50"
                          >
                            <Save className="h-3 w-3" />
                            {isSaving ? "…" : t("Sauv.", "حفظ")}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditPrice}
                            disabled={isSaving}
                            className="h-7 px-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[11px]"
                          >
                            <X className="h-3 w-3" />
                          </button>
                          {priceError && editingPriceId === row.id && (
                            <span className="text-[10px] text-red-600 w-full">{priceError}</span>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => startEditPrice(row)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded px-1.5 py-0.5 transition-colors"
                          >
                            <Pencil className="h-2.5 w-2.5" />
                            {row.selling_price != null
                              ? formatPrice(Number(row.selling_price))
                              : t("Modifier prix", "تعديل السعر")}
                          </button>
                          {row.cost_price != null && Number(row.cost_price) > 0 && (
                            <span className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5 font-medium">
                              {t("Coût", "تكلفة")}: {formatPrice(Number(row.cost_price))}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => openForSlowMoverTransfer(row)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                          >
                            <Send className="h-3 w-3" />
                            {t("Envoyer vers →", "← إرسال لمتجر")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2 content: متاح في متاجر أخرى ──────────────────────── */}
        <TabsContent value="cross" className="space-y-3 mt-0">
          <div className="flex items-center gap-2">
            <StoreIcon className="h-4 w-4 text-blue-500" />
            <h2 className="font-semibold text-sm">
              {t("Produits disponibles dans d'autres magasins", "منتجات متوفرة في متاجر أخرى")}
            </h2>
            {crossQuery.data && crossQuery.data.length > 0 && (
              <Badge variant="secondary" className="ml-1 bg-blue-100 text-blue-700 border-blue-200">
                {crossQuery.data.length}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "Sélectionnez un ou plusieurs produits, puis demandez un transfert depuis le magasin source.",
              "اختر منتجاً أو أكثر ثم اطلب نقلاً من المتجر المصدر.",
            )}
          </p>

          {crossQuery.isLoading && <CardSkeletons />}

          {!crossQuery.isLoading && (!crossQuery.data || crossQuery.data.length === 0) && (
            <div className="rounded-xl border bg-muted/30 p-8 text-center">
              <Package className="h-9 w-9 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">
                {t("Aucun produit manquant — votre stock est complet ✓", "لا توجد منتجات ناقصة — مخزونك مكتمل ✓")}
              </p>
            </div>
          )}

          {crossQuery.data && crossQuery.data.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {crossQuery.data.map((row) => {
                const name = lang === "ar" && row.name_ar ? row.name_ar : row.name_en;
                const storeName = lang === "ar" ? row.source_store_name_ar : row.source_store_name_en;
                const isSelected = selected.has(row.source_product_id);
                return (
                  <div
                    key={row.source_product_id}
                    onClick={() => toggleSelect(row.source_product_id)}
                    className={`relative bg-white border rounded-xl p-3 shadow-sm flex gap-3 cursor-pointer transition-all ${
                      isSelected ? "border-blue-400 ring-1 ring-blue-200 bg-blue-50/40" : "hover:border-blue-200"
                    }`}
                  >
                    <div className="absolute top-2.5 right-2.5 z-10">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? "bg-blue-600 border-blue-600" : "border-gray-300 bg-white"}`}>
                        {isSelected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                      </div>
                    </div>
                    <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden border">
                      {row.image_url
                        ? <img src={resolveImg(row.image_url)} alt={name} className="w-full h-full object-cover" />
                        : <Package className="h-6 w-6 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0 pr-6">
                      <p className="font-semibold text-sm truncate">{name}</p>
                      {(row.reference || row.barcode) && (
                        <p className="text-[11px] font-mono text-muted-foreground truncate">
                          {row.reference ?? row.barcode}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">
                          <StoreIcon className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate max-w-[90px]">{storeName}</span>
                        </span>
                        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5">
                          {t("Dispo", "متاح")}: {Number(row.source_stock).toLocaleString("fr-DZ")}
                        </span>
                        {Number(row.local_stock) > 0 && (
                          <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
                            {t("Ici", "هنا")}: {Number(row.local_stock).toLocaleString("fr-DZ")}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openForProduct(row); }}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                        {t("Demander un transfert →", "← طلب نقل")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Tab 3 content: انتهاء الصلاحية ──────────────────────────── */}
        <TabsContent value="expiry" className="space-y-3 mt-0">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-orange-500" />
            <h2 className="font-semibold text-sm">
              {t("Produits proches de la péremption", "منتجات قريبة من انتهاء الصلاحية")}
            </h2>
            {expiryQuery.data && expiryQuery.data.length > 0 && (
              <Badge variant="secondary" className="ml-1 bg-orange-100 text-orange-700 border-orange-200">
                {expiryQuery.data.length}
              </Badge>
            )}
          </div>

          {/* Days filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{t("Horizon :", "المدى:")}</span>
            {[7, 14, 30, 60, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setExpiryDays(d)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors font-medium ${
                  expiryDays === d
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-white text-muted-foreground border-muted-foreground/30 hover:bg-orange-50 hover:border-orange-300"
                }`}
              >
                {d}j
              </button>
            ))}
          </div>

          {!expirySettings.enabled && (
            <div className="rounded-xl border bg-muted/30 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t(
                  "Les alertes de péremption sont désactivées. Activez-les dans Paramètres → Notifications.",
                  "تنبيهات انتهاء الصلاحية معطّلة. فعّلها من الإعدادات ← الإشعارات.",
                )}
              </p>
            </div>
          )}

          {expirySettings.enabled && expiryQuery.isLoading && <CardSkeletons />}

          {expirySettings.enabled && !expiryQuery.isLoading && (!expiryQuery.data || expiryQuery.data.length === 0) && (
            <div className="rounded-xl border bg-muted/30 p-8 text-center">
              <CalendarClock className="h-9 w-9 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">
                {t(
                  `Aucun lot n'expire dans les ${expiryDays} prochains jours ✓`,
                  `لا توجد دفعات تنتهي خلال الـ ${expiryDays} يوماً القادمة ✓`,
                )}
              </p>
            </div>
          )}

          {expirySettings.enabled && expiryQuery.data && expiryQuery.data.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {expiryQuery.data.map((row) => {
                const name = lang === "ar" && row.name_ar ? row.name_ar : row.name_en;
                const col = expiryCardStyle(Number(row.days_left));
                const dl = Number(row.days_left);
                return (
                  <div key={row.batch_id} className={`bg-white border rounded-xl p-3 shadow-sm flex gap-3 ${col.card}`}>
                    <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden border">
                      {row.image_url
                        ? <img src={resolveImg(row.image_url)} alt={name} className="w-full h-full object-cover" />
                        : <Package className="h-6 w-6 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{name}</p>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded border font-semibold whitespace-nowrap shrink-0 ${col.badge}`}>
                          {dl < 0 ? t("Expiré", "منتهي") : col.label}
                        </span>
                      </div>
                      {(row.reference || row.barcode) && (
                        <p className="text-[11px] text-muted-foreground/70 font-mono mt-0.5">
                          {row.reference ?? row.barcode}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span>
                          📅 {new Date(row.expiry_date).toLocaleDateString("fr-DZ", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                        <span>
                          {t("Qté", "الكمية")}: <span className="font-semibold text-foreground">{row.quantity}</span>
                        </span>
                        {row.lot_number && (
                          <span className="font-mono text-[11px] bg-muted/60 px-1 rounded">{row.lot_number}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

      </Tabs>

      {/* ── Floating action bar (cross-store multi-select) ─────────────── */}
      {selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-2.5 max-w-[90vw]">
          {multiStoreConflict ? (
            <span className="text-[11px] text-amber-300 flex items-center gap-1.5 shrink-0">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("Magasins différents — choisissez un seul", "متاجر مختلفة — اختر متجراً واحداً")}
            </span>
          ) : (
            <>
              <span className="text-sm font-medium whitespace-nowrap">
                {selected.size} {t("article(s) sélectionné(s)", "صنف/أصناف")}
              </span>
              <Button
                size="sm"
                className="bg-blue-500 hover:bg-blue-400 text-white rounded-xl text-xs h-7 px-3"
                onClick={openForSelected}
              >
                <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
                {t("Demander le transfert", "طلب النقل")}
              </Button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-slate-400 hover:text-white ml-1 text-sm leading-none"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Transfer dialog ────────────────────────────────────────────── */}
      <CreateTransferDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setSelected(new Set());
        }}
        otherStores={otherStores}
        isAdmin={!!isAdmin}
        onCreated={() => {
          void qc.invalidateQueries({ queryKey: ["alerts-count"] });
          void qc.invalidateQueries({ queryKey: ["alerts-cross-store-missing"] });
        }}
        initialDirection={dialogConfig?.direction ?? "in"}
        initialStoreId={dialogConfig?.storeId}
        initialLines={dialogConfig?.lines}
        initialPickedProducts={dialogConfig?.pickedProducts}
      />
    </div>
  );
}

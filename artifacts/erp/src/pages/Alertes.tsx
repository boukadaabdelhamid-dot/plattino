import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { useMe } from "@/hooks/use-me";
import { useStoreContext } from "@/hooks/use-store";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGetErpStoresAll } from "@workspace/api-client-react";
import { CreateTransferDialog, type LineDraft, type ProductLite } from "@/pages/Transfers";
import {
  AlertTriangle, Package, ArrowLeftRight, RefreshCw,
  Store as StoreIcon, Clock, TrendingDown, Check,
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
  last_sold_at: string | null;
  days_since_last_sale: number | null;
};

type DialogConfig = {
  storeId: string;
  lines: LineDraft[];
  pickedProducts: Record<number, ProductLite>;
};

const DAY_OPTIONS = [30, 60, 90, 180] as const;
type Days = (typeof DAY_OPTIONS)[number];

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchCrossStoreMissing(): Promise<CrossStoreMissingRow[]> {
  const res = await fetch(`${API_BASE}/api/erp/alerts/cross-store-missing`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("fetch failed");
  return res.json() as Promise<CrossStoreMissingRow[]>;
}

async function fetchSlowMovers(days: Days): Promise<SlowMoverRow[]> {
  const res = await fetch(
    `${API_BASE}/api/erp/alerts/slow-movers?days=${days}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error("fetch failed");
  return res.json() as Promise<SlowMoverRow[]>;
}

function resolveImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return url;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-DZ", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Shared skeleton row ───────────────────────────────────────────────────────
function CardSkeletons() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-[108px] rounded-xl" />
      ))}
    </div>
  );
}

// ── Helper: build a ProductLite from a cross-store alert row ─────────────────
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

// ── Main page ────────────────────────────────────────────────────────────────
export default function Alertes() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const { isAdmin } = useMe();
  const { currentStoreId } = useStoreContext();
  const qc = useQueryClient();

  // ── Day filter for slow-movers ──
  const [slowDays, setSlowDays] = useState<Days>(30);

  // ── Selection state ──
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // ── Dialog state ──
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [dialogConfig, setDialogConfig] = useState<DialogConfig | null>(null);

  // ── Queries ──
  const crossQuery = useQuery<CrossStoreMissingRow[]>({
    queryKey: ["alerts-cross-store-missing"],
    queryFn: fetchCrossStoreMissing,
    staleTime: 60_000,
  });

  const slowQuery = useQuery<SlowMoverRow[]>({
    queryKey: ["alerts-slow-movers", slowDays],
    queryFn: () => fetchSlowMovers(slowDays),
    staleTime: 60_000,
  });

  // Stores list for the transfer dialog
  const { data: allStores } = useGetErpStoresAll();
  const otherStores = useMemo(
    () =>
      ((allStores ?? []) as Array<{ id: number; nameEn: string; nameAr: string; isActive?: boolean }>)
        .filter((s) => s.id !== currentStoreId && s.isActive !== false),
    [allStores, currentStoreId],
  );

  const isRefetching = crossQuery.isRefetching || slowQuery.isRefetching;
  const refetchAll = () => {
    void crossQuery.refetch();
    void slowQuery.refetch();
    void qc.invalidateQueries({ queryKey: ["alerts-count"] });
  };

  // ── Multi-store check: are all selected items from the same source store? ──
  const multiStoreConflict = useMemo(() => {
    if (selected.size === 0) return false;
    const rows = (crossQuery.data ?? []).filter((r) => selected.has(r.source_product_id));
    const storeIds = new Set(rows.map((r) => r.source_store_id));
    return storeIds.size > 1;
  }, [selected, crossQuery.data]);

  // ── Toggle card selection ──
  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Open dialog for a single product ──
  const openForProduct = (row: CrossStoreMissingRow) => {
    setDialogConfig({
      storeId: String(row.source_store_id),
      lines: [{ sourceProductId: String(row.source_product_id), quantity: "1" }],
      pickedProducts: { [row.source_product_id]: rowToProductLite(row) },
    });
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };

  // ── Open dialog for all selected products (same store) ──
  const openForSelected = () => {
    if (multiStoreConflict) return;
    const rows = (crossQuery.data ?? []).filter((r) => selected.has(r.source_product_id));
    if (rows.length === 0) return;
    const storeId = String(rows[0]!.source_store_id);
    const pickedProducts: Record<number, ProductLite> = {};
    const lines: LineDraft[] = [];
    for (const row of rows) {
      pickedProducts[row.source_product_id] = rowToProductLite(row);
      lines.push({ sourceProductId: String(row.source_product_id), quantity: "1" });
    }
    setDialogConfig({ storeId, lines, pickedProducts });
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-8 pb-28">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold">
              {t("Alertes Intelligentes", "التنبيهات الذكية")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t(
                "Transferts inter-magasins · Bضاعة راكدة",
                "نقل بين المتاجر · بضاعة راكدة",
              )}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refetchAll}
          disabled={isRefetching}
        >
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* ── Section 1 : produits disponibles ailleurs ───────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <StoreIcon className="h-4 w-4 text-blue-500" />
          <h2 className="font-semibold text-sm">
            {t(
              "Produits disponibles dans d'autres magasins",
              "منتجات متوفرة في متاجر أخرى",
            )}
          </h2>
          {crossQuery.data && crossQuery.data.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 bg-blue-100 text-blue-700 border-blue-200"
            >
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

        {!crossQuery.isLoading &&
          (!crossQuery.data || crossQuery.data.length === 0) && (
            <div className="rounded-xl border bg-muted/30 p-8 text-center">
              <Package className="h-9 w-9 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">
                {t(
                  "Aucun produit manquant — votre stock est complet ✓",
                  "لا توجد منتجات ناقصة — مخزونك مكتمل ✓",
                )}
              </p>
            </div>
          )}

        {crossQuery.data && crossQuery.data.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {crossQuery.data.map((row) => {
              const name =
                lang === "ar" && row.name_ar ? row.name_ar : row.name_en;
              const storeName =
                lang === "ar"
                  ? row.source_store_name_ar
                  : row.source_store_name_en;
              const isSelected = selected.has(row.source_product_id);
              return (
                <div
                  key={row.source_product_id}
                  onClick={() => toggleSelect(row.source_product_id)}
                  className={`relative bg-white border rounded-xl p-3 shadow-sm flex gap-3 cursor-pointer transition-all ${
                    isSelected
                      ? "border-blue-400 ring-1 ring-blue-200 bg-blue-50/40"
                      : "hover:border-blue-200"
                  }`}
                >
                  {/* Checkbox top-right */}
                  <div className="absolute top-2.5 right-2.5 z-10">
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? "bg-blue-600 border-blue-600"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {isSelected && (
                        <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                      )}
                    </div>
                  </div>

                  {/* Image */}
                  <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden border">
                    {row.image_url ? (
                      <img
                        src={resolveImg(row.image_url)}
                        alt={name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Package className="h-6 w-6 text-slate-400" />
                    )}
                  </div>

                  {/* Info — pr-6 so text doesn't overlap checkbox */}
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

                    {/* Single-product transfer button — stops propagation so it doesn't toggle checkbox */}
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
      </section>

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <div className="border-t" />

      {/* ── Section 2 : bضاعة راكدة ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-orange-500" />
            <h2 className="font-semibold text-sm">
              {t("Bضاعة راكدة — Produits invendus", "بضاعة راكدة — منتجات لم تُباع")}
            </h2>
            {slowQuery.data && slowQuery.data.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 bg-orange-100 text-orange-700 border-orange-200"
              >
                {slowQuery.data.length}
              </Badge>
            )}
          </div>
          {/* Day filter pills */}
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

        <p className="text-xs text-muted-foreground">
          {t(
            `Produits en stock qui n'ont pas été vendus depuis plus de ${slowDays} jours. Envisagez une promotion ou un transfert.`,
            `منتجات في المخزون لم تُباع منذ أكثر من ${slowDays} يوماً. فكّر في تخفيض السعر أو النقل.`,
          )}
        </p>

        {slowQuery.isLoading && <CardSkeletons />}

        {!slowQuery.isLoading &&
          (!slowQuery.data || slowQuery.data.length === 0) && (
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

        {slowQuery.data && slowQuery.data.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {slowQuery.data.map((row) => {
              const name =
                lang === "ar" && row.name_ar ? row.name_ar : row.name_en;
              const neverSold = row.last_sold_at === null;
              const daysLabel = neverSold
                ? t("Jamais vendu", "لم يُباع قط")
                : `${row.days_since_last_sale ?? "?"} ${t("jours", "يوم")}`;
              return (
                <div
                  key={row.id}
                  className="bg-white border rounded-xl p-3 shadow-sm flex gap-3 hover:border-orange-200 transition-colors"
                >
                  <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden border">
                    {row.image_url ? (
                      <img
                        src={resolveImg(row.image_url)}
                        alt={name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Package className="h-6 w-6 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{name}</p>
                    {(row.reference || row.barcode) && (
                      <p className="text-[11px] font-mono text-muted-foreground truncate">
                        {row.reference ?? row.barcode}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                        {t("Stock", "مخزون")}: {Number(row.stock).toLocaleString("fr-DZ")}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded px-1.5 py-0.5 border ${
                          neverSold
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-orange-50 text-orange-700 border-orange-200"
                        }`}
                      >
                        <Clock className="h-2.5 w-2.5" />
                        {daysLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {neverSold
                        ? t("Aucune vente enregistrée", "لا يوجد سجل بيع")
                        : `${t("Dernier vente", "آخر بيع")}: ${formatDate(row.last_sold_at)}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Floating action bar — appears when products are selected ────── */}
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
            aria-label="Annuler la sélection"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Transfer dialog — keyed to remount with fresh initial state ── */}
      <CreateTransferDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setSelected(new Set()); // clear selection after dialog closes
        }}
        otherStores={otherStores}
        isAdmin={!!isAdmin}
        onCreated={() => {
          void qc.invalidateQueries({ queryKey: ["alerts-count"] });
          void qc.invalidateQueries({ queryKey: ["alerts-cross-store-missing"] });
        }}
        initialDirection="in"
        initialStoreId={dialogConfig?.storeId}
        initialLines={dialogConfig?.lines}
        initialPickedProducts={dialogConfig?.pickedProducts}
      />
    </div>
  );
}

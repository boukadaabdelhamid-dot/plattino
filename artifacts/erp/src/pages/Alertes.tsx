import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useLang } from "@/hooks/use-lang";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Package, ArrowLeftRight, RefreshCw,
  Store as StoreIcon, Clock, TrendingDown,
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

// ── Main page ────────────────────────────────────────────────────────────────
export default function Alertes() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const [slowDays, setSlowDays] = useState<Days>(30);
  const qc = useQueryClient();

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

  const isRefetching = crossQuery.isRefetching || slowQuery.isRefetching;
  const refetchAll = () => {
    void crossQuery.refetch();
    void slowQuery.refetch();
    void qc.invalidateQueries({ queryKey: ["alerts-count"] });
  };

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-8">
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
            "Ces produits ont du stock dans d'autres magasins mais sont absents ou épuisés ici. Demandez un transfert pour les récupérer rapidement.",
            "هذه المنتجات متوفرة في متاجر أخرى لكنها غائبة أو نافدة هنا. اطلب نقلاً للحصول عليها بسرعة.",
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
              return (
                <div
                  key={row.source_product_id}
                  className="bg-white border rounded-xl p-3 shadow-sm flex gap-3 hover:border-blue-200 transition-colors"
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
                    <Link href="/transfers">
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                        {t("Demander un transfert →", "← طلب نقل")}
                      </button>
                    </Link>
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
        {/* Section header + day filter */}
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
                      {/* Stock badge */}
                      <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                        {t("Stock", "مخزون")}: {Number(row.stock).toLocaleString("fr-DZ")}
                      </span>
                      {/* Days indicator */}
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
                    {/* Last sale date */}
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
    </div>
  );
}

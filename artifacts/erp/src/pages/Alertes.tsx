import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useLang } from "@/hooks/use-lang";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Package, ArrowLeftRight, RefreshCw, Store as StoreIcon,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("midanic_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

async function fetchCrossStoreMissing(): Promise<CrossStoreMissingRow[]> {
  const res = await fetch(`${API_BASE}/api/erp/alerts/cross-store-missing`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("fetch failed");
  return res.json() as Promise<CrossStoreMissingRow[]>;
}

function resolveImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return url;
}

export default function Alertes() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  const { data: rows, isLoading, refetch, isRefetching } = useQuery<CrossStoreMissingRow[]>({
    queryKey: ["alerts-cross-store-missing"],
    queryFn: fetchCrossStoreMissing,
    staleTime: 60_000,
  });

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t("Alertes Intelligentes", "التنبيهات الذكية")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("Opportunités de transfert inter-magasins", "فرص النقل بين المتاجر")}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* ── Section: produits disponibles ailleurs ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <StoreIcon className="h-4 w-4 text-blue-500" />
          <h2 className="font-semibold text-sm">
            {t(
              "Produits disponibles dans d'autres magasins",
              "منتجات متوفرة في متاجر أخرى"
            )}
          </h2>
          {rows && rows.length > 0 && (
            <Badge variant="secondary" className="ml-1 bg-amber-100 text-amber-700 border-amber-200">
              {rows.length}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "Ces produits ont du stock dans d'autres magasins mais sont absents ou épuisés ici. Demandez un transfert pour les récupérer rapidement.",
            "هذه المنتجات متوفرة في متاجر أخرى لكنها غائبة أو نافدة هنا. اطلب نقلاً للحصول عليها بسرعة."
          )}
        </p>

        {/* Loading */}
        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[100px] rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && (!rows || rows.length === 0) && (
          <div className="rounded-xl border bg-muted/30 p-10 text-center">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium text-muted-foreground">
              {t(
                "Aucun produit manquant — votre stock est complet ✓",
                "لا توجد منتجات ناقصة — مخزونك مكتمل ✓"
              )}
            </p>
          </div>
        )}

        {/* List */}
        {rows && rows.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => {
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

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{name}</p>
                    {(row.reference || row.barcode) && (
                      <p className="text-[11px] font-mono text-muted-foreground truncate">
                        {row.reference ?? row.barcode}
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {/* Source store */}
                      <span className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-100 rounded px-1.5 py-0.5">
                        <StoreIcon className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate max-w-[90px]">{storeName}</span>
                      </span>
                      {/* Available there */}
                      <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5">
                        {t("Dispo", "متاح")}: {Number(row.source_stock).toLocaleString("fr-DZ")}
                      </span>
                      {/* Local stock if partial */}
                      {Number(row.local_stock) > 0 && (
                        <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
                          {t("Ici", "هنا")}: {Number(row.local_stock).toLocaleString("fr-DZ")}
                        </span>
                      )}
                    </div>

                    {/* Transfer link */}
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
      </div>
    </div>
  );
}

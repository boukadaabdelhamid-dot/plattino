import React, { useState } from "react";
import { useGetErpStoresAll, type Store, type Product } from "@workspace/api-client-react";
import { useStoreContext } from "@/hooks/use-store";
import { useLang } from "@/hooks/use-lang";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Send, CheckCircle2, AlertCircle, XCircle, Store as StoreIcon } from "lucide-react";

type CopyResult = {
  productId: number;
  targetStoreId: number;
  status: "created" | "already_exists" | "error";
  newProductId?: number;
  message?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  productIds: number[];
  products: Product[];
};

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export default function CopyToStoresModal({ open, onClose, productIds, products }: Props) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const { currentStoreId } = useStoreContext();
  const { data: allStoresData } = useGetErpStoresAll();

  const otherStores = ((allStoresData ?? []) as Store[]).filter((s: Store) => s.id !== currentStoreId);

  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CopyResult[] | null>(null);

  const toggleStore = (id: number) => {
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (selectedStoreIds.size === 0) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("midanic_token");
      const res = await fetch(`${API_BASE}/api/erp/products/copy-to-stores`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          productIds,
          targetStoreIds: Array.from(selectedStoreIds),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { results: CopyResult[] };
      setResults(data.results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setResults(productIds.flatMap((pid) =>
        Array.from(selectedStoreIds).map((tid) => ({
          productId: pid,
          targetStoreId: tid,
          status: "error" as const,
          message: msg,
        }))
      ));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSelectedStoreIds(new Set());
    setResults(null);
    onClose();
  };

  const storeName = (id: number) => {
    const s = otherStores.find((s) => s.id === id);
    if (!s) return `#${id}`;
    return lang === "ar" ? s.nameAr : s.nameEn;
  };

  const productLabel = (id: number) => {
    const p = products.find((p) => p.id === id);
    if (!p) return `#${id}`;
    return p.nameEn || p.nameAr;
  };

  const createdCount = results?.filter((r) => r.status === "created").length ?? 0;
  const skippedCount = results?.filter((r) => r.status === "already_exists").length ?? 0;
  const errorCount = results?.filter((r) => r.status === "error").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1B3057]">
            <Send className="h-5 w-5" />
            {t("Envoyer vers d'autres magasins", "إرسال إلى متاجر أخرى")}
          </DialogTitle>
        </DialogHeader>

        {!results ? (
          <>
            {/* Product summary */}
            <div className="text-sm text-muted-foreground mb-1">
              {productIds.length === 1
                ? <span className="font-medium text-foreground">{productLabel(productIds[0]!)}</span>
                : <span>{productIds.length} {t("articles sélectionnés", "منتج محدد")}</span>
              }
              {" "}{t("sera copié dans les magasins choisis (stock = 0).", "سيُنسخ إلى المتاجر المحددة (مخزون = 0).")}
            </div>

            {/* Store multi-select */}
            <div className="border rounded-md overflow-hidden">
              {otherStores.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {t("Aucun autre magasin disponible.", "لا توجد متاجر أخرى متاحة.")}
                </div>
              ) : (
                <div className="divide-y max-h-56 overflow-y-auto">
                  {otherStores.map((store) => (
                    <label
                      key={store.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 cursor-pointer select-none"
                    >
                      <Checkbox
                        checked={selectedStoreIds.has(store.id)}
                        onCheckedChange={() => toggleStore(store.id)}
                      />
                      <StoreIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium">{lang === "ar" ? store.nameAr : store.nameEn}</span>
                      {store.nameAr !== store.nameEn && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          {lang === "ar" ? store.nameEn : store.nameAr}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground mt-1">
              {t(
                "Les attributs (catégorie, famille, marque, couleur) seront associés par nom dans le magasin cible. Les codes-barres secondaires ne sont pas copiés.",
                "سيتم مطابقة الخصائص (الفئة، العائلة، الماركة، اللون) بالاسم في المتجر الهدف. الباركودات الثانوية لا تُنسخ."
              )}
            </div>

            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                {t("Annuler", "إلغاء")}
              </Button>
              <Button
                onClick={handleSend}
                disabled={loading || selectedStoreIds.size === 0 || otherStores.length === 0}
                className="bg-[#1B3057] hover:bg-[#1B3057]/90 gap-2"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {t("Envoi en cours…", "جارٍ الإرسال…")}</>
                ) : (
                  <><Send className="h-4 w-4" /> {t("Envoyer", "إرسال")} ({selectedStoreIds.size})</>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {/* Results summary badges */}
            <div className="flex gap-2 flex-wrap">
              {createdCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {createdCount} {t("créé(s)", "تم إنشاؤه")}
                </span>
              )}
              {skippedCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1">
                  <AlertCircle className="h-3.5 w-3.5" /> {skippedCount} {t("déjà existant(s)", "موجود مسبقاً")}
                </span>
              )}
              {errorCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-3 py-1">
                  <XCircle className="h-3.5 w-3.5" /> {errorCount} {t("erreur(s)", "خطأ")}
                </span>
              )}
            </div>

            {/* Results table */}
            <div className="border rounded-md overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">
                        {t("Article", "المنتج")}
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">
                        {t("Magasin cible", "المتجر الهدف")}
                      </th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">
                        {t("Résultat", "النتيجة")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {results.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs truncate max-w-[140px]" title={productLabel(r.productId)}>
                          {productLabel(r.productId)}
                        </td>
                        <td className="px-3 py-2 text-xs truncate max-w-[120px]" title={storeName(r.targetStoreId)}>
                          {storeName(r.targetStoreId)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.status === "created" && (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {t("Créé", "تم")}
                            </span>
                          )}
                          {r.status === "already_exists" && (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                              <AlertCircle className="h-3.5 w-3.5" />
                              {t("Existant", "موجود")}
                            </span>
                          )}
                          {r.status === "error" && (
                            <span className="inline-flex items-center gap-1 text-xs text-red-600" title={r.message}>
                              <XCircle className="h-3.5 w-3.5" />
                              {t("Erreur", "خطأ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleClose} className="bg-[#1B3057] hover:bg-[#1B3057]/90">
                {t("Fermer", "إغلاق")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

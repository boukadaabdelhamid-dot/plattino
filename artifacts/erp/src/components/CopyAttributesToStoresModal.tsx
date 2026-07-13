import React, { useState } from "react";
import { useGetErpStoresAll, type Store } from "@workspace/api-client-react";
import { useStoreContext } from "@/hooks/use-store";
import { useLang } from "@/hooks/use-lang";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Send, CheckCircle2, AlertCircle, XCircle, Store as StoreIcon } from "lucide-react";

type CopyAttrResult = {
  targetStoreId: number;
  copied: number;
  skipped: number;
  errors: number;
  firstError?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  type: "family" | "brand" | "color";
  ids?: number[];   // when omitted, copies all items of that type
  itemCount: number;
};

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export default function CopyAttributesToStoresModal({ open, onClose, type, ids, itemCount }: Props) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const { currentStoreId } = useStoreContext();
  const { data: allStoresData } = useGetErpStoresAll();

  const otherStores = ((allStoresData ?? []) as Store[]).filter((s: Store) => s.id !== currentStoreId);

  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CopyAttrResult[] | null>(null);

  const toggleStore = (id: number) => {
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const typeLabel = {
    family: t("familles", "عائلات"),
    brand: t("marques", "علامات تجارية"),
    color: t("couleurs", "ألوان"),
  }[type];

  const handleSend = async () => {
    if (selectedStoreIds.size === 0) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("midanic_token");
      const res = await fetch(`${API_BASE}/api/erp/settings/products/copy-attributes-to-stores`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type,
          ...(ids ? { ids } : {}),
          targetStoreIds: Array.from(selectedStoreIds),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { results: CopyAttrResult[] };
      setResults(data.results);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Erreur réseau";
      setResults(Array.from(selectedStoreIds).map((tid) => ({
        targetStoreId: tid, copied: 0, skipped: 0, errors: 1, firstError: reason,
      })));
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

  const totalCopied = results?.reduce((a, r) => a + r.copied, 0) ?? 0;
  const totalSkipped = results?.reduce((a, r) => a + r.skipped, 0) ?? 0;
  const totalErrors = results?.reduce((a, r) => a + r.errors, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1B3057]">
            <Send className="h-5 w-5" />
            {t("Copier vers d'autres magasins", "نسخ إلى متاجر أخرى")}
          </DialogTitle>
        </DialogHeader>

        {!results ? (
          <>
            <div className="text-sm text-muted-foreground mb-1">
              <span className="font-medium text-foreground">{itemCount}</span>{" "}
              {typeLabel}{" "}
              {t("seront copiées dans les magasins choisis.", "ستُنسخ إلى المتاجر المحددة.")}
            </div>

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

            <p className="text-xs text-muted-foreground mt-1">
              {t(
                "Les éléments déjà présents (même nom) dans le magasin cible seront ignorés.",
                "العناصر الموجودة بنفس الاسم في المتجر الهدف ستُتجاهل تلقائياً."
              )}
            </p>

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
                  <><Loader2 className="h-4 w-4 animate-spin" />{t("Copie en cours…", "جارٍ النسخ…")}</>
                ) : (
                  <><Send className="h-4 w-4" />{t("Copier", "نسخ")} ({selectedStoreIds.size})</>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {totalCopied > 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />{totalCopied} {t("copié(s)", "تم نسخه")}
                </span>
              )}
              {totalSkipped > 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1">
                  <AlertCircle className="h-3.5 w-3.5" />{totalSkipped} {t("déjà existant(s)", "موجود مسبقاً")}
                </span>
              )}
              {totalErrors > 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-3 py-1">
                  <XCircle className="h-3.5 w-3.5" />{totalErrors} {t("erreur(s)", "خطأ")}
                </span>
              )}
            </div>

            <div className="border rounded-md overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">
                        {t("Magasin cible", "المتجر الهدف")}
                      </th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">
                        {t("Copié", "نُسخ")}
                      </th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">
                        {t("Ignoré", "تُجوهل")}
                      </th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">
                        {t("Erreur", "خطأ")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {results.map((r, i) => (
                      <React.Fragment key={i}>
                        <tr className="hover:bg-muted/20">
                          <td className="px-3 py-2 text-xs font-medium">{storeName(r.targetStoreId)}</td>
                          <td className="px-3 py-2 text-center text-xs text-emerald-600 font-semibold">{r.copied}</td>
                          <td className="px-3 py-2 text-center text-xs text-amber-600">{r.skipped}</td>
                          <td className="px-3 py-2 text-center text-xs text-red-600 font-semibold">{r.errors}</td>
                        </tr>
                        {r.errors > 0 && r.firstError && (
                          <tr className="bg-red-50">
                            <td colSpan={4} className="px-3 py-1.5">
                              <span className="flex items-center gap-1.5 text-xs text-red-700">
                                <XCircle className="h-3 w-3 shrink-0" />
                                {r.firstError}
                                {r.errors > 1 && (
                                  <span className="text-red-500 ml-1">
                                    {t(`(+${r.errors - 1} autre(s))`, `(+${r.errors - 1} أخرى)`)}
                                  </span>
                                )}
                              </span>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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

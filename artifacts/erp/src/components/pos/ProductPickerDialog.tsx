import { useEffect, useMemo, useState } from "react";
import type { Product } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ShoppingCart } from "lucide-react";
import { useLang } from "@/hooks/use-lang";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
function resolveImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return url;
}

export function ProductPickerDialog({
  open, onOpenChange, products, onPick, extraBarcodesMap = new Map(),
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  products: Product[]; onPick: (p: Product) => void;
  extraBarcodesMap?: Map<string, number>;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const [q, setQ] = useState("");
  useEffect(() => { if (open) setQ(""); }, [open]);
  const filtered = useMemo(() => {
    const trimmed = q.trim().toLowerCase();
    if (!trimmed) return products;
    const extraPid = extraBarcodesMap.get(trimmed);
    return products.filter(
      (p) =>
        (p.nameEn ?? "").toLowerCase().includes(trimmed) ||
        (p.nameAr ?? "").toLowerCase().includes(trimmed) ||
        (p.barcode ?? "").toLowerCase().includes(trimmed) ||
        (p.reference ?? "").toLowerCase().includes(trimmed) ||
        (extraPid !== undefined && p.id === extraPid)
    );
  }, [q, products, extraBarcodesMap]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-center">{t("Choisir un article", "اختيار منتج")}</DialogTitle>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filtre", "بحث")} className="h-11" autoFocus data-testid="input-picker-filter" />
        <div className="max-h-[60vh] overflow-y-auto border rounded">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">{t("Aucun article trouvé", "لا يوجد مقال مطابق")}</div>
          ) : (
            filtered.map((p) => (
              <button key={p.id} type="button"
                className="w-full flex items-center gap-3 px-3 py-2.5 border-b hover:bg-blue-50 text-left transition-colors"
                onClick={() => onPick(p)}
                data-testid={`button-pick-product-${p.id}`}>
                <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {p.imageUrl ? (
                    <img src={resolveImg(p.imageUrl)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ShoppingCart className="h-5 w-5 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm uppercase truncate">
                    {lang === "ar" ? (p.nameAr || p.nameEn) : (p.nameEn || p.nameAr)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {parseFloat(p.price ?? "0").toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} DZD
                  </div>
                </div>
                <div className="text-sm font-bold text-slate-600 ml-2">{p.stock}</div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, FolderOpen, Clock, PackageOpen } from "lucide-react";
import { useLang } from "@/hooks/use-lang";

type DraftItem = {
  productId: number;
  quantity: number;
  unitPrice: string;
  nameEn?: string | null;
  nameAr?: string | null;
};

type Draft = {
  id: number;
  customerName: string;
  totalAmount: string;
  createdAt: string;
  items: DraftItem[];
};

const fmt = (n: number) =>
  n.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DraftsDialog({
  open, onOpenChange, apiBase, onLoad,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  apiBase: string;
  onLoad: (items: DraftItem[]) => void;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const tok = () => localStorage.getItem("midanic_token") ?? "";

  async function fetchDrafts() {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/erp/pos/drafts`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      if (r.ok) setDrafts(await r.json() as Draft[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void fetchDrafts();
  }, [open]);

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      await fetch(`${apiBase}/api/erp/pos/drafts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok()}` },
      });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  function handleLoad(draft: Draft) {
    onLoad(draft.items);
    void handleDelete(draft.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-center flex items-center justify-center gap-2">
            <PackageOpen className="h-5 w-5 text-blue-600" />
            {t("Bons en attente", "الفواتير المعلقة")}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="text-center py-10 text-muted-foreground text-sm">{t("Chargement...", "جاري التحميل...")}</div>
        ) : drafts.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            {t("Aucun bon en attente", "لا توجد فواتير معلقة")}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto divide-y">
            {drafts.map((draft) => (
              <div key={draft.id} className="flex items-center gap-3 py-3 px-1">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{draft.customerName}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3 shrink-0" />
                    {new Date(draft.createdAt).toLocaleString("fr-DZ")}
                    <span className="mx-1">·</span>
                    {draft.items.length} {t("article", "مقال")}{draft.items.length > 1 ? "s" : ""}
                  </div>
                </div>
                <div className="text-sm font-bold text-emerald-700 shrink-0 min-w-[90px] text-right">
                  {fmt(parseFloat(draft.totalAmount))} {currency}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2.5 text-blue-600 border-blue-200 hover:bg-blue-50 shrink-0"
                  onClick={() => handleLoad(draft)}
                  disabled={deleting === draft.id}
                >
                  <FolderOpen className="h-3.5 w-3.5 mr-1" />
                  {t("Charger", "تحميل")}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-red-500 hover:bg-red-50 shrink-0"
                  onClick={() => void handleDelete(draft.id)}
                  disabled={deleting === draft.id}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import type { CustomerSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Pencil } from "lucide-react";
import { useLang } from "@/hooks/use-lang";

type CustomerExt = CustomerSummary & { current_balance?: string | null; credit_limit?: string | null };

const fmtBal = (n: number) =>
  n.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ClientPickerButton({
  onPick, customers,
}: { onPick: (c: CustomerSummary | null) => void; customers: CustomerSummary[] }) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = (customers as CustomerExt[]).filter((c) =>
    c.name.toLowerCase().includes(q.toLowerCase()) || c.email.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <>
      <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-600"
        onClick={() => setOpen(true)} aria-label={t("Choisir client", "اختيار عميل")} data-testid="button-pick-client">
        <Pencil className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Choisir un client", "اختيار العميل")}</DialogTitle>
          </DialogHeader>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filtre", "بحث")} className="h-10" autoFocus />
          <div className="max-h-80 overflow-y-auto border rounded">
            <button type="button"
              className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm border-b"
              onClick={() => { onPick(null); setOpen(false); }}>
              <span className="font-semibold">DIVERS COMPTOIR</span>
              <span className="text-xs text-muted-foreground block">{t("Client par défaut", "عميل افتراضي")}</span>
            </button>
            {filtered.map((c) => {
              const bal = Number(c.current_balance ?? 0);
              const balColor = bal > 0 ? "text-red-600" : bal < 0 ? "text-emerald-600" : "text-muted-foreground";
              return (
                <button key={c.id} type="button"
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm border-b"
                  onClick={() => { onPick(c as CustomerSummary); setOpen(false); }}
                  data-testid={`button-client-${c.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">{c.name}</span>
                    <span className={`font-semibold tabular-nums text-xs shrink-0 ${balColor}`}>
                      {fmtBal(bal)} {currency}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{c.email}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm">{t("Aucun client", "لا يوجد عملاء")}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

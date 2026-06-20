import React, { useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Printer, X } from "lucide-react";
import InvoiceTemplate, { type InvoiceData } from "./InvoiceTemplate";
import { useLang } from "@/hooks/use-lang";

/**
 * Renders a printable invoice preview. The TVA on/off switch in the header
 * lets the cashier flip the breakdown right before printing — its initial
 * value comes from `data.showTva`, which callers are expected to seed from
 * `store.showTvaByDefault`.
 */
export default function InvoiceDialog({
  open, onOpenChange, data, autoPrint, onShowTvaChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  data: InvoiceData | null;
  autoPrint?: boolean;
  /** Optional: notify parent when the user flips the in-dialog TVA toggle. */
  onShowTvaChange?: (showTva: boolean) => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  useEffect(() => {
    if (!open || !autoPrint) return;
    const timer = setTimeout(() => handlePrint(), 250);
    return () => clearTimeout(timer);
  }, [open, autoPrint]);

  function handlePrint() {
    const node = printRef.current;
    if (!node) { window.print(); return; }
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) { window.print(); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Facture</title></head><body>${node.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); w.close(); } catch { /* noop */ } }, 300);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[230mm] p-0 max-h-[92vh] overflow-y-auto">
        <div className="invoice-no-print sticky top-0 z-20 bg-white border-b px-4 py-2 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-sm">{t("Aperçu facture", "معاينة الفاتورة")}</h2>
          <div className="flex items-center gap-3">
            {data && onShowTvaChange && (
              <div className="flex items-center gap-2 px-2 py-1 rounded border bg-slate-50">
                <Label htmlFor="invoice-tva-toggle" className="text-xs cursor-pointer">
                  TVA {data.showTva ? `(${data.tvaRate.toFixed(0)}%)` : "off"}
                </Label>
                <Switch
                  id="invoice-tva-toggle"
                  checked={data.showTva}
                  onCheckedChange={(v) => onShowTvaChange(v)}
                  data-testid="switch-invoice-tva"
                />
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4 mr-1" /> {t("Fermer", "إغلاق")}
            </Button>
            <Button size="sm" className="bg-[#1B3057] hover:bg-[#142441]" onClick={handlePrint} data-testid="button-print-invoice">
              <Printer className="h-4 w-4 mr-1" /> {t("Imprimer", "طباعة")}
            </Button>
          </div>
        </div>
        <div ref={printRef} className="p-3 bg-slate-100">
          {data && <InvoiceTemplate data={data} currency={currency} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

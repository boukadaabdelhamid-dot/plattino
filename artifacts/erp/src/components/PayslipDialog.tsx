import React, { useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import PayslipTemplate from "./PayslipTemplate";
import { useLang } from "@/hooks/use-lang";
import type { Payslip } from "@workspace/api-client-react";

export default function PayslipDialog({
  open, onOpenChange, payslip, currency,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  payslip: Payslip | null;
  currency: string;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  function handlePrint() {
    const node = printRef.current;
    if (!node) { window.print(); return; }
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) { window.print(); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Bulletin de paie</title></head><body>${node.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); w.close(); } catch { /* noop */ } }, 300);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[210mm] p-0 max-h-[92vh] overflow-y-auto">
        <div className="payslip-no-print sticky top-0 z-20 bg-white border-b px-4 py-2 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-sm">{t("Aperçu du bulletin de paie", "معاينة قسيمة الراتب")}</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handlePrint} disabled={!payslip}>
              <Printer className="h-3.5 w-3.5 mr-1.5" />{t("Imprimer", "طباعة")}
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="p-4">
          {payslip && (
            <div ref={printRef}>
              <PayslipTemplate payslip={payslip} currency={currency} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

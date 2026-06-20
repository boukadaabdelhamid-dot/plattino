import { useEffect, useState } from "react";
import type { CustomerSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RotateCcw, Check } from "lucide-react";
import { useLang } from "@/hooks/use-lang";

const fmt = (n: number) =>
  n.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PaymentDialog({
  open, onOpenChange, net, client, versement, setVersement, onConfirm, isPending,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  net: number; client: CustomerSummary | null;
  versement: number; setVersement: (n: number) => void;
  onConfirm: (opts: { mode: "comptant" | "terme"; cloture: boolean; impression: boolean }) => void;
  isPending: boolean;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const cloture = true;
  const [impression, setImpression] = useState(true);
  const [versementOn, setVersementOn] = useState(false);
  const [localAmount, setLocalAmount] = useState("");

  type ClientExt = { current_balance?: string | null; credit_limit?: string | null };
  const soldeClient = Number((client as unknown as ClientExt)?.current_balance ?? 0);
  const seuilCredit = Number((client as unknown as ClientExt)?.credit_limit ?? 0);

  // Versement-aware credit math (mirrors the authoritative backend logic):
  //   reste (debt)        = net - versement
  //   nouveau solde       = solde actuel + reste
  //   crédit disponible   = plafond - nouveau solde
  //   versement min req.  = solde actuel + net - plafond  (to stay within limit)
  const appliedVersement = Math.min(Math.max(0, versement), net);
  const reste = Math.max(0, net - appliedVersement);
  const nouveauSolde = soldeClient + reste;
  const creditDisponible = seuilCredit - nouveauSolde;
  const depassement = Math.max(0, nouveauSolde - seuilCredit);
  const versementMinNecessaire = Math.max(0, soldeClient + net - seuilCredit);
  // À-terme is allowed only when the remaining debt keeps the customer within
  // their authorized credit limit. A versement that fully covers the sale
  // (reste === 0) never creates debt, so it is always allowed.
  const termeBlocked = reste > 0 && (seuilCredit === 0 || depassement > 0.001);

  useEffect(() => {
    if (open) { setLocalAmount(""); setVersement(0); setVersementOn(false); }
  }, [open, setVersement]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">{t("Règlement de la commande", "تسوية الطلبية")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between gap-4 text-sm pb-2 border-b">
            <label className="flex items-center gap-2 opacity-60 cursor-default select-none">
              <Switch checked={cloture} disabled data-testid="switch-cloture" />
              <span>{t("Clôture", "إغلاق")}</span>
              <span className="text-xs text-muted-foreground">({t("auto", "تلقائي")})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={impression} onCheckedChange={setImpression} data-testid="switch-impression" />
              <span>{t("Impression", "طباعة")}</span>
            </label>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("Solde actuel du client", "رصيد العميل الحالي")}</span>
              <span className={`font-semibold tabular-nums ${soldeClient > 0 ? "text-red-600" : soldeClient < 0 ? "text-emerald-600" : ""}`}>
                {client ? fmt(soldeClient) : "—"} {client ? currency : ""}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("Plafond de crédit", "حد الائتمان")}</span>
              <span className="font-semibold tabular-nums">{client && seuilCredit > 0 ? fmt(seuilCredit) : "—"} {client && seuilCredit > 0 ? currency : ""}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("Versement sur cet achat", "دفعة على هذا الشراء")}</span>
              <span className="font-semibold tabular-nums">{fmt(appliedVersement)} {currency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("Montant restant dû", "المبلغ المتبقي")}</span>
              <span className="font-semibold tabular-nums">{fmt(reste)} {currency}</span>
            </div>
            {client && (
              <>
                <div className="flex justify-between border-t pt-1.5 mt-1">
                  <span className="text-muted-foreground">{t("Nouveau solde du client", "الرصيد الجديد للعميل")}</span>
                  <span className={`font-semibold tabular-nums ${depassement > 0.001 ? "text-red-600" : nouveauSolde > 0 ? "text-amber-700" : ""}`}>
                    {fmt(nouveauSolde)} {currency}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Crédit disponible après vente", "الائتمان المتاح بعد البيع")}</span>
                  <span className={`font-semibold tabular-nums ${creditDisponible < 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {fmt(creditDisponible)} {currency}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <Input
              type="number" step="0.01" min="0" max={net} value={localAmount}
              onChange={(e) => {
                setLocalAmount(e.target.value);
                const parsed = parseFloat(e.target.value) || 0;
                setVersement(Math.min(Math.max(0, parsed), net));
              }}
              placeholder="0,00"
              className="h-12 text-xl font-bold pr-12 text-right"
              disabled={!versementOn}
              data-testid="input-versement"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">{currency}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("Versement min nécessaire", "الدفعة الدنيا المطلوبة")}</span>
            <span className={`font-semibold tabular-nums ${versementMinNecessaire > 0 ? "text-amber-700" : ""}`}>
              {client ? `${fmt(versementMinNecessaire)} ${currency}` : "—"}
            </span>
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <Switch
              checked={versementOn}
              onCheckedChange={(on) => { setVersementOn(on); if (!on) { setLocalAmount(""); setVersement(0); } }}
              data-testid="switch-versement"
            />
            <span>{t("Versement", "دفعة")}</span>
          </label>
        </div>

        {/* Terme requires a linked customer — show contextual warning when none selected */}
        {!client && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-center">
            {t(
              "Sélectionnez un client pour activer la vente à terme.",
              "اختر عميلاً لتفعيل البيع الآجل."
            )}
          </p>
        )}

        {/* Credit limit exceeded — block à-terme and tell the cashier the minimum versement */}
        {client && termeBlocked && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 text-center">
            {seuilCredit === 0
              ? t(
                  "Ce client n'est pas autorisé à acheter à terme (plafond = 0).",
                  "هذا العميل غير مخوّل للشراء بالأجل (الحد = 0).",
                )
              : t(
                  `Plafond de crédit dépassé. Versement minimum requis : ${fmt(versementMinNecessaire)} ${currency}.`,
                  `تم تجاوز حد الائتمان. الحد الأدنى للدفعة المطلوبة: ${fmt(versementMinNecessaire)} ${currency}.`,
                )}
          </p>
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-stretch">
          <Button variant="outline"
            className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!client || isPending || termeBlocked}
            onClick={() => !isPending && client && !termeBlocked && onConfirm({ mode: "terme", cloture, impression })}
            data-testid="button-aterme">
            <RotateCcw className="h-4 w-4 mr-1.5" />{t("À terme", "آجل")}
          </Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            disabled={isPending}
            onClick={() => !isPending && onConfirm({ mode: "comptant", cloture, impression })}
            data-testid="button-comptant">
            <Check className="h-4 w-4 mr-1.5" />{t("Comptant", "نقداً")} ({fmt(net)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

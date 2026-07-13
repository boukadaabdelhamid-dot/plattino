import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ShoppingCart } from "lucide-react";
import type { PurchaseOrder, Supplier } from "@workspace/api-client-react";

type ExtendedPO = PurchaseOrder & { paymentMethod?: string };

const fmt = (n: number) =>
  n.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-DZ", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
};

const STATUS_COLORS: Record<string, string> = {
  received:  "bg-emerald-100 text-emerald-700",
  pending:   "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-700",
};

const statusLabel = (s: string) =>
  s === "received" ? "Clôturée" : s === "cancelled" ? "Annulée" : "En cours";

const refOf = (id: number) =>
  `${String(id).padStart(6, "0")}/${new Date().getFullYear()}`;

interface Props {
  open: boolean;
  onClose: () => void;
  pos: ExtendedPO[];
  supplierMap: Record<number, Supplier>;
}

export default function PurchaseHistorySheet({ open, onClose, pos, supplierMap }: Props) {
  const sorted = React.useMemo(
    () => [...pos].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    }),
    [pos],
  );

  const totalAmt = sorted.reduce((s, p) => s + parseFloat(p.totalAmount ?? "0"), 0);
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[540px] p-0 flex flex-col overflow-hidden"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <SheetTitle className="text-base font-semibold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-[#1B3057]" />
            Journal des achats
          </SheetTitle>
          <div className="flex gap-4 text-xs pt-0.5">
            <span className="text-muted-foreground">
              <strong className="text-foreground">{sorted.length}</strong> bon{sorted.length !== 1 ? "s" : ""}
            </span>
            <span className="text-emerald-700 font-medium">
              Total : <strong>{fmt(totalAmt)} DA</strong>
            </span>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto divide-y">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <ShoppingCart className="h-8 w-8 opacity-20" />
              <p className="text-sm">Aucun bon d'achat</p>
            </div>
          ) : (
            sorted.map((po) => {
              const supplier = supplierMap[po.supplierId];
              const isComptant = po.paymentMethod === "comptant";
              const statusCls = STATUS_COLORS[po.status] ?? "bg-gray-100 text-gray-600";
              const amount = parseFloat(po.totalAmount ?? "0");

              return (
                <div key={po.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/70">
                  {/* Ref + Date */}
                  <div className="shrink-0 text-center w-[72px]">
                    <p className="text-[10px] font-mono text-muted-foreground">{refOf(po.id)}</p>
                    <p className="text-[10px] text-muted-foreground">{fmtDate(po.createdAt)}</p>
                  </div>

                  {/* Supplier + badges */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm uppercase truncate">
                      {supplier?.name ?? `Fournisseur #${po.supplierId}`}
                    </p>
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusCls}`}>
                        {statusLabel(po.status)}
                      </span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        isComptant
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {isComptant ? "Comptant" : "À terme"}
                      </span>
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right shrink-0">
                    <p className="font-bold tabular-nums text-sm">{fmt(amount)}</p>
                    <p className="text-[10px] text-muted-foreground">DA</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

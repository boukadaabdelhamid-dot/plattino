import React, { useState } from "react";
import {
  useCreateErpCaisseTransfer, useGetErpCaisseTransferRecipients,
  getGetErpCaisseTransferRecipientsQueryKey,
  type CaisseTransferSummary,
} from "@workspace/api-client-react";
import { useMe } from "@/hooks/use-me";
import { useLang } from "@/hooks/use-lang";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Send, CheckCircle2, XCircle, Clock, Building2 } from "lucide-react";
import { format } from "date-fns";

export type TFn = (fr: string, ar: string) => string;
export type PersonLike = { name?: string | null; email?: string | null } | null | undefined;
export type CaisseLike = { kind?: string; owner?: PersonLike } | null | undefined;

export const fmtAmount = (v: string | number | undefined | null): string => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "0");
  return n.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e ?? "");
};

export const personLabel = (p: PersonLike): string => p?.name || p?.email || "—";

export const makeCaisseLabel = (t: TFn) => (c: CaisseLike): string => {
  if (!c) return "—";
  if (c.kind === "main") return t("Caisse principale", "الصندوق الرئيسي");
  return personLabel(c.owner);
};

export const makeTransferStatusBadge = (t: TFn) => (s: string) => {
  const cfg: Record<string, { cls: string; icon: React.ReactNode; labelFr: string; labelAr: string }> = {
    pending:   { cls: "bg-amber-100 text-amber-700 border-amber-200",       icon: <Clock className="h-3 w-3" />,        labelFr: "En attente", labelAr: "قيد الانتظار" },
    accepted:  { cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" />, labelFr: "Acceptée", labelAr: "مقبولة" },
    rejected:  { cls: "bg-red-100 text-red-700 border-red-200",             icon: <XCircle className="h-3 w-3" />,      labelFr: "Refusée", labelAr: "مرفوضة" },
    cancelled: { cls: "bg-gray-100 text-gray-700 border-gray-200",          icon: <XCircle className="h-3 w-3" />,      labelFr: "Annulée", labelAr: "ملغاة" },
  };
  const c = cfg[s] ?? cfg.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${c.cls}`}>
      {c.icon}{t(c.labelFr, c.labelAr)}
    </span>
  );
};

export const makeReasonLabel = (t: TFn): Record<string, string> => ({
  sale:             t("Vente", "بيع"),
  transfer_in:      t("Transfert reçu", "تحويل وارد"),
  transfer_out:     t("Transfert envoyé", "تحويل صادر"),
  transfer_hold:    t("Transfert (ancien — en attente)", "حجز تحويل (قديم)"),
  transfer_refund:  t("Remboursement (ancien)", "استرجاع (قديم)"),
  admin_deposit:    t("Dépôt → principale", "إيداع"),
  admin_withdraw:   t("Retrait ← principale", "سحب"),
  adjustment:       t("Ajustement", "تعديل"),
});

export function TransfersTable({
  rows, emptyMsg, renderActions, caisseLabel, transferStatusBadge, t,
}: {
  rows: CaisseTransferSummary[];
  emptyMsg: string;
  renderActions?: (tr: CaisseTransferSummary) => React.ReactNode;
  caisseLabel: (c: CaisseLike) => string;
  transferStatusBadge: (s: string) => React.ReactNode;
  t: TFn;
}) {
  const { lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  return (
    <Card className="border shadow-sm">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>{t("De", "من")}</TableHead>
              <TableHead>{t("À", "إلى")}</TableHead>
              <TableHead className="text-right">{t("Montant", "المبلغ")}</TableHead>
              <TableHead>{t("Statut", "الحالة")}</TableHead>
              {renderActions && <TableHead className="text-right">{t("Actions", "الإجراءات")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={renderActions ? 7 : 6} className="text-center py-8 text-muted-foreground">{emptyMsg}</TableCell>
              </TableRow>
            ) : rows.map(tr => (
              <TableRow key={tr.id} data-testid={`row-transfer-${tr.id}`}>
                <TableCell className="text-xs text-muted-foreground font-mono">#{tr.id}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{tr.createdAt ? format(new Date(tr.createdAt), "MMM d HH:mm") : "—"}</TableCell>
                <TableCell>{caisseLabel(tr.senderCaisse)}</TableCell>
                <TableCell>{caisseLabel(tr.recipientCaisse)}</TableCell>
                <TableCell className="text-right font-bold">{fmtAmount(tr.amount)} {currency}</TableCell>
                <TableCell>{transferStatusBadge(tr.status)}</TableCell>
                {renderActions && <TableCell className="text-right">{renderActions(tr)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * Shared "send money" dialog used by both the Caisse page and Mon Compte.
 * No funds are held on submit — the transfer is created as `pending` and the
 * balance only moves once the recipient (or an admin, for the main caisse)
 * accepts it. The caller decides whether the trigger button is shown at all
 * (create permission), but the amount is always validated against the live
 * balance client-side as a courtesy (the server re-checks on accept).
 */
export function SendTransferDialog({
  open, onClose, onSent, myBalance, mainCaisseId, t,
}: {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  myBalance: string;
  mainCaisseId: number | null;
  t: TFn;
}) {
  const { user } = useMe();
  const { toast } = useToast();
  const { lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const { data: staff } = useGetErpCaisseTransferRecipients(
    undefined,
    { query: { enabled: open, queryKey: getGetErpCaisseTransferRecipientsQueryKey() } },
  );
  const create = useCreateErpCaisseTransfer();
  const [target, setTarget] = useState<"main" | "colleague">("main");
  const [recipient, setRecipient] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const recipients = (staff ?? []).filter(s => s.id !== user?.id);

  const reset = () => { setTarget("main"); setRecipient(""); setAmount(""); setNotes(""); };

  const handleSubmit = () => {
    const a = parseFloat(amount);
    if (!a || Math.round(a * 100) <= 0) { toast({ title: t("Montant invalide", "مبلغ غير صالح"), variant: "destructive" }); return; }
    if (a > parseFloat(myBalance)) { toast({ title: t("Solde insuffisant", "رصيد غير كافٍ"), variant: "destructive" }); return; }
    let data: { amount: string; notes?: string; recipientUserId?: number; recipientCaisseId?: number };
    if (target === "main") {
      if (!mainCaisseId) { toast({ title: t("Caisse principale introuvable", "الصندوق الرئيسي غير موجود"), variant: "destructive" }); return; }
      data = { amount: a.toFixed(2), notes: notes || undefined, recipientCaisseId: mainCaisseId };
    } else {
      const r = parseInt(recipient);
      if (!r) { toast({ title: t("Choisir un destinataire", "اختر مستلماً"), variant: "destructive" }); return; }
      data = { amount: a.toFixed(2), notes: notes || undefined, recipientUserId: r };
    }
    create.mutate({ data }, {
      onSuccess: () => {
        toast({ title: t("Transfert envoyé", "تم الإرسال") });
        reset();
        onSent(); onClose();
      },
      onError: (e: unknown) => toast({ title: "Erreur", description: errMsg(e), variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Envoyer de l'argent", "إرسال أموال")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-xs text-muted-foreground">{t("Mon solde:", "رصيدي:")} <span className="font-bold">{fmtAmount(myBalance)} {currency}</span></div>
          <div>
            <Label className="text-xs mb-1 block">{t("Destination *", "الوجهة *")}</Label>
            <Select value={target} onValueChange={(v) => setTarget(v as "main" | "colleague")}>
              <SelectTrigger data-testid="select-transfer-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="main">{t("Caisse principale", "الصندوق الرئيسي")}</SelectItem>
                <SelectItem value="colleague">{t("Un collègue", "زميل")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {target === "colleague" && (
            <div>
              <Label className="text-xs mb-1 block">{t("Destinataire *", "المستلم *")}</Label>
              <Select value={recipient} onValueChange={setRecipient}>
                <SelectTrigger data-testid="select-recipient"><SelectValue placeholder={t("Choisir un collègue...", "اختر زميلاً...")} /></SelectTrigger>
                <SelectContent>
                  {recipients.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name || s.email} ({s.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs mb-1 block">{t(`Montant (${currency}) *`, `المبلغ (${currency}) *`)}</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 text-lg font-bold" data-testid="input-transfer-amount" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t("Note", "ملاحظة")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={t("Optionnel...", "اختياري...")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Annuler", "إلغاء")}</Button>
          <Button className="bg-[#1B3057] hover:bg-[#152544]" onClick={handleSubmit} disabled={create.isPending} data-testid="button-confirm-transfer">
            <Send className="h-4 w-4 mr-1.5" /> {t("Envoyer", "إرسال")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Admin-only dialog: send funds FROM the main caisse to a staff member's
 * personal caisse. Uses the optional senderCaisseId API param.
 */
export function SendFromMainDialog({
  open, onClose, onSent, mainCaisseId, mainBalance, t,
}: {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  mainCaisseId: number | null;
  mainBalance: string;
  t: TFn;
}) {
  const { user } = useMe();
  const { toast } = useToast();
  const { lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const { data: staff } = useGetErpCaisseTransferRecipients(
    { includeMe: true },
    { query: { enabled: open, queryKey: getGetErpCaisseTransferRecipientsQueryKey({ includeMe: true }) } },
  );
  const create = useCreateErpCaisseTransfer();
  const [recipient, setRecipient] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const recipients = staff ?? [];

  const reset = () => { setRecipient(""); setAmount(""); setNotes(""); };

  const handleSubmit = () => {
    if (!mainCaisseId) {
      toast({ title: t("Caisse principale introuvable", "الصندوق الرئيسي غير موجود"), variant: "destructive" });
      return;
    }
    const a = parseFloat(amount);
    if (!a || Math.round(a * 100) <= 0) {
      toast({ title: t("Montant invalide", "مبلغ غير صالح"), variant: "destructive" });
      return;
    }
    if (a > parseFloat(mainBalance)) {
      toast({ title: t("Solde insuffisant dans la caisse principale", "رصيد الصندوق الرئيسي غير كافٍ"), variant: "destructive" });
      return;
    }
    const r = parseInt(recipient);
    if (!r) {
      toast({ title: t("Choisir un destinataire", "اختر مستلماً"), variant: "destructive" });
      return;
    }
    create.mutate(
      { data: { senderCaisseId: mainCaisseId, recipientUserId: r, amount: a.toFixed(2), notes: notes || undefined } },
      {
        onSuccess: () => {
          toast({ title: t("Virement envoyé depuis la Caisse Principale", "تم التحويل من الصندوق الرئيسي") });
          reset(); onSent(); onClose();
        },
        onError: (e: unknown) => toast({ title: "Erreur", description: errMsg(e), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            {t("Virement depuis la Caisse Principale", "تحويل من الصندوق الرئيسي")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-xs text-muted-foreground">
            {t("Solde disponible:", "الرصيد المتاح:")} <span className="font-bold text-blue-700">{fmtAmount(mainBalance)} {currency}</span>
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t("Destinataire *", "المستلم *")}</Label>
            <Select value={recipient} onValueChange={setRecipient}>
              <SelectTrigger data-testid="select-main-transfer-recipient">
                <SelectValue placeholder={t("Choisir un staff...", "اختر موظفاً...")} />
              </SelectTrigger>
              <SelectContent>
                {recipients.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name || s.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t(`Montant (${currency}) *`, `المبلغ (${currency}) *`)}</Label>
            <Input
              type="number" min="0" step="0.01"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              className="h-9 text-lg font-bold"
              data-testid="input-main-transfer-amount"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t("Note", "ملاحظة")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={t("Optionnel...", "اختياري...")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Annuler", "إلغاء")}</Button>
          <Button className="bg-[#1B3057] hover:bg-[#152544]" onClick={handleSubmit} disabled={create.isPending} data-testid="button-confirm-main-transfer">
            <Send className="h-4 w-4 mr-1.5" /> {t("Virer", "تحويل")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

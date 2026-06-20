import React, { useMemo, useState } from "react";
import {
  useGetErpCaisses, useGetErpCaisseTransfers,
  useAcceptErpCaisseTransfer, useRejectErpCaisseTransfer, useCancelErpCaisseTransfer,
  useAdminDepositErpCaisse, useAdminWithdrawErpCaisse, useAdminAdjustErpCaisse,
  useGetErpCaisse,
  getGetErpCaissesQueryKey, getGetErpCaisseTransfersQueryKey,
  type CaisseSummary, type CaisseMovement,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/use-me";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Wallet, Send, Inbox, ArrowDownLeft, ArrowUpRight, Settings, Building2,
  CheckCircle2, XCircle, Clock, Sliders,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  fmtAmount, errMsg, personLabel, makeCaisseLabel, makeTransferStatusBadge,
  makeReasonLabel, TransfersTable, SendTransferDialog, SendFromMainDialog,
  type TFn, type CaisseLike,
} from "@/components/caisse/transfer-ui";

export default function Caisse() {
  const { user, isAdmin } = useMe();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const caisseLabel = makeCaisseLabel(t);
  const transferStatusBadge = makeTransferStatusBadge(t);

  const { data: caisses, isLoading: loadingCaisses } = useGetErpCaisses();
  const { data: transfers } = useGetErpCaisseTransfers({ box: "all" });

  const myCaisse = useMemo(
    () => (caisses ?? []).find(c => c.ownerUserId === user?.id) ?? null,
    [caisses, user?.id],
  );
  const mainCaisse = useMemo(
    () => (caisses ?? []).find(c => c.kind === "main") ?? null,
    [caisses],
  );
  const otherStaffCaisses = useMemo(
    () => (caisses ?? []).filter(c => c.kind === "staff" && c.ownerUserId !== user?.id),
    [caisses, user?.id],
  );

  // Pending transfers awaiting my approval.
  // Admins can accept ANY pending transfer whose recipient is the main caisse
  // (including their own sends — no self-approval block for the main caisse).
  // For personal-caisse transfers, standard rule: I must be the recipient and
  // not the sender.
  const inbox = (transfers ?? []).filter(tr => {
    if (tr.status !== "pending") return false;
    if (isAdmin && tr.recipientCaisse?.kind === "main") return true;
    return tr.senderCaisse?.ownerUserId !== user?.id && tr.recipientCaisse?.ownerUserId === user?.id;
  });
  const outbox = (transfers ?? []).filter(tr => tr.senderCaisse?.ownerUserId === user?.id);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: getGetErpCaissesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetErpCaisseTransfersQueryKey() });
  };

  const accept = useAcceptErpCaisseTransfer();
  const reject = useRejectErpCaisseTransfer();
  const cancel = useCancelErpCaisseTransfer();
  const handleAccept = (id: number) => accept.mutate({ id }, { onSuccess: () => { toast({ title: t("Transfert accepté", "تم القبول") }); refreshAll(); }, onError: (e: unknown) => toast({ title: "Erreur", description: errMsg(e), variant: "destructive" }) });
  const handleReject = (id: number) => reject.mutate({ id }, { onSuccess: () => { toast({ title: t("Transfert refusé", "تم الرفض") }); refreshAll(); }, onError: (e: unknown) => toast({ title: "Erreur", description: errMsg(e), variant: "destructive" }) });
  const handleCancel = (id: number) => cancel.mutate({ id }, { onSuccess: () => { toast({ title: t("Annulé", "تم الإلغاء") }); refreshAll(); }, onError: (e: unknown) => toast({ title: "Erreur", description: errMsg(e), variant: "destructive" }) });

  const [sendOpen, setSendOpen] = useState(false);
  const [sendFromMainOpen, setSendFromMainOpen] = useState(false);
  const [adminAction, setAdminAction] = useState<null | { type: "deposit" | "withdraw" | "adjust"; caisse: CaisseSummary }>(null);
  const [detailCaisseId, setDetailCaisseId] = useState<number | null>(null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="h-6 w-6 text-amber-500" />
          {t("Caisses", "الصناديق")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Gérez votre caisse, transférez entre collègues et supervisez la caisse principale.",
            "أدر صندوقك، حوّل بين الزملاء وراقب الصندوق الرئيسي."
          )}
        </p>
      </div>

      {loadingCaisses ? (
        <div className="text-sm text-muted-foreground">{t("Chargement...", "جاري التحميل...")}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myCaisse && (
              <Card className="border-2 border-amber-200 bg-amber-50/40" data-testid="card-my-caisse">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-amber-600" />
                    {t("Ma caisse", "صندوقي")}
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={() => setDetailCaisseId(myCaisse.id)}>
                    {t("Détails", "التفاصيل")}
                  </Button>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-amber-700" data-testid="text-my-balance">{fmtAmount(myCaisse.balance)} {currency}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("Propriétaire:", "المالك:")} {personLabel(myCaisse.owner)}</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="bg-[#1B3057] hover:bg-[#152544]" onClick={() => setSendOpen(true)} data-testid="button-send-transfer">
                      <Send className="h-4 w-4 mr-1.5" /> {t("Envoyer", "إرسال")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {mainCaisse && (
              <Card className="border-2 border-blue-200 bg-blue-50/40" data-testid="card-main-caisse">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-blue-600" />
                    {t("Caisse principale", "الصندوق الرئيسي")}
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={() => setDetailCaisseId(mainCaisse.id)}>
                    {t("Détails", "التفاصيل")}
                  </Button>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-blue-700" data-testid="text-main-balance">{fmtAmount(mainCaisse.balance)} {currency}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAdmin
                      ? t("Visible et gérée par les administrateurs", "مرئية وتُدار من قِبل المسؤولين")
                      : t("Lecture seule", "للقراءة فقط")}
                  </p>
                  {isAdmin && (
                    <div className="mt-3">
                      <Button size="sm" className="bg-[#1B3057] hover:bg-[#152544]" onClick={() => setSendFromMainOpen(true)} data-testid="button-send-from-main">
                        <Send className="h-4 w-4 mr-1.5" /> {t("Virer vers un staff", "تحويل لموظف")}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <Tabs defaultValue="inbox" className="w-full">
            <TabsList>
              <TabsTrigger value="inbox" data-testid="tab-inbox">
                <Inbox className="h-4 w-4 mr-1.5" />
                {t("Reçus", "الواردة")} {inbox.length > 0 && <span className="ml-1.5 inline-flex items-center justify-center text-xs bg-red-500 text-white rounded-full h-5 min-w-5 px-1">{inbox.length}</span>}
              </TabsTrigger>
              <TabsTrigger value="outbox" data-testid="tab-outbox">
                <Send className="h-4 w-4 mr-1.5" /> {t("Envoyés", "المرسلة")}
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="admin" data-testid="tab-admin">
                  <Settings className="h-4 w-4 mr-1.5" /> Admin
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="inbox" className="mt-3">
              <TransfersTable
                rows={inbox}
                emptyMsg={t("Aucun transfert en attente", "لا توجد تحويلات معلقة")}
                caisseLabel={caisseLabel}
                transferStatusBadge={transferStatusBadge}
                t={t}
                renderActions={(tr) => (
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handleAccept(tr.id)} disabled={accept.isPending} data-testid={`button-accept-${tr.id}`}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> {t("Accepter", "قبول")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleReject(tr.id)} disabled={reject.isPending} data-testid={`button-reject-${tr.id}`}>
                      <XCircle className="h-4 w-4 mr-1" /> {t("Refuser", "رفض")}
                    </Button>
                  </div>
                )}
              />
            </TabsContent>

            <TabsContent value="outbox" className="mt-3">
              <TransfersTable
                rows={outbox}
                emptyMsg={t("Aucun transfert envoyé", "لم تُرسل أية تحويلات")}
                caisseLabel={caisseLabel}
                transferStatusBadge={transferStatusBadge}
                t={t}
                renderActions={(tr) => tr.status === "pending" ? (
                  <Button size="sm" variant="outline" onClick={() => handleCancel(tr.id)} disabled={cancel.isPending} data-testid={`button-cancel-${tr.id}`}>
                    {t("Annuler", "إلغاء")}
                  </Button>
                ) : null}
              />
            </TabsContent>

            {isAdmin && (
              <TabsContent value="admin" className="mt-3 space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{t("Toutes les caisses", "كل الصناديق")}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>{t("Propriétaire", "المالك")}</TableHead>
                          <TableHead className="text-right">{t("Solde", "الرصيد")}</TableHead>
                          <TableHead className="text-right">{t("Actions", "الإجراءات")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(caisses ?? []).map(c => (
                          <TableRow key={c.id} data-testid={`row-caisse-${c.id}`}>
                            <TableCell>
                              {c.kind === "main"
                                ? <span className="text-xs font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-700">{t("Principale", "رئيسي")}</span>
                                : <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-700">Staff</span>}
                            </TableCell>
                            <TableCell>{caisseLabel(c)}</TableCell>
                            <TableCell className="text-right font-bold">{fmtAmount(c.balance)} {currency}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex gap-1 justify-end flex-wrap">
                                <Button size="sm" variant="ghost" onClick={() => setDetailCaisseId(c.id)}>{t("Détails", "التفاصيل")}</Button>
                                {c.kind === "staff" && (
                                  <>
                                    <Button size="sm" variant="outline" className="text-emerald-700" onClick={() => setAdminAction({ type: "deposit", caisse: c })} data-testid={`button-deposit-${c.id}`}>
                                      <ArrowUpRight className="h-3.5 w-3.5 mr-1" /> {t("Dépôt", "إيداع")}
                                    </Button>
                                    <Button size="sm" variant="outline" className="text-blue-700" onClick={() => setAdminAction({ type: "withdraw", caisse: c })} data-testid={`button-withdraw-${c.id}`}>
                                      <ArrowDownLeft className="h-3.5 w-3.5 mr-1" /> {t("Retrait", "سحب")}
                                    </Button>
                                  </>
                                )}
                                <Button size="sm" variant="outline" className="text-amber-700" onClick={() => setAdminAction({ type: "adjust", caisse: c })} data-testid={`button-adjust-${c.id}`}>
                                  <Sliders className="h-3.5 w-3.5 mr-1" /> {t("Ajuster", "تعديل")}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {otherStaffCaisses.length === 0 && (caisses?.length ?? 0) <= 2 && (
                      <p className="text-center text-sm text-muted-foreground py-4">
                        {t("Aucun autre staff pour le moment.", "لا يوجد موظفون آخرون حالياً.")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </>
      )}

      <SendTransferDialog open={sendOpen} onClose={() => setSendOpen(false)} onSent={refreshAll} myBalance={myCaisse?.balance ?? "0.00"} mainCaisseId={mainCaisse?.id ?? null} t={t} />
      <SendFromMainDialog open={sendFromMainOpen} onClose={() => setSendFromMainOpen(false)} onSent={refreshAll} mainCaisseId={mainCaisse?.id ?? null} mainBalance={mainCaisse?.balance ?? "0.00"} t={t} />
      {adminAction && (
        <AdminCaisseDialog
          action={adminAction}
          onClose={() => setAdminAction(null)}
          onDone={refreshAll}
          mainCaisseId={mainCaisse?.id ?? null}
          t={t}
          caisseLabel={caisseLabel}
        />
      )}
      {detailCaisseId !== null && (
        <CaisseDetailDialog id={detailCaisseId} onClose={() => setDetailCaisseId(null)} t={t} caisseLabel={caisseLabel} />
      )}
    </div>
  );
}

function AdminCaisseDialog({
  action, onClose, onDone, mainCaisseId, t, caisseLabel,
}: {
  action: { type: "deposit" | "withdraw" | "adjust"; caisse: CaisseSummary };
  onClose: () => void;
  onDone: () => void;
  mainCaisseId: number | null;
  t: TFn;
  caisseLabel: (c: CaisseLike) => string;
}) {
  const { toast } = useToast();
  const { lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const deposit = useAdminDepositErpCaisse();
  const withdraw = useAdminWithdrawErpCaisse();
  const adjust = useAdminAdjustErpCaisse();
  const [amount, setAmount] = useState("");
  const [delta, setDelta] = useState("");
  const [notes, setNotes] = useState("");

  const titleMap = {
    deposit: t("Dépôt vers principale", "إيداع للصندوق الرئيسي"),
    withdraw: t("Retrait depuis principale", "سحب من الصندوق الرئيسي"),
    adjust: t("Ajustement de solde", "تعديل الرصيد"),
  };

  const handleSubmit = () => {
    if (action.type === "adjust") {
      const d = parseFloat(delta);
      if (isNaN(d) || d === 0 || !notes.trim()) {
        toast({ title: t("Delta non nul + raison requis", "مطلوب: دلتا غير صفري + سبب"), variant: "destructive" });
        return;
      }
      adjust.mutate(
        { data: { caisseId: action.caisse.id, delta: d.toFixed(2), notes: notes.trim() } },
        { onSuccess: () => { toast({ title: t("Ajusté", "تم التعديل") }); onDone(); onClose(); }, onError: (e: unknown) => toast({ title: "Erreur", description: errMsg(e), variant: "destructive" }) },
      );
      return;
    }
    const a = parseFloat(amount);
    if (!a || a <= 0) { toast({ title: t("Montant invalide", "مبلغ غير صالح"), variant: "destructive" }); return; }
    const payload = { data: { caisseId: action.caisse.id, amount: a.toFixed(2), notes: notes || undefined } };
    const fn = action.type === "deposit" ? deposit : withdraw;
    fn.mutate(payload, {
      onSuccess: () => { toast({ title: t("Opération réussie", "تمت العملية") }); onDone(); onClose(); },
      onError: (e: unknown) => toast({ title: "Erreur", description: errMsg(e), variant: "destructive" }),
    });
  };

  const pending = deposit.isPending || withdraw.isPending || adjust.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titleMap[action.type]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-xs text-muted-foreground">
            {t("Caisse:", "الصندوق:")} <span className="font-medium">{caisseLabel(action.caisse)}</span> ·
            {t("Solde:", "الرصيد:")} <span className="font-bold">{fmtAmount(action.caisse.balance)} {currency}</span>
          </div>
          {action.type === "adjust" ? (
            <>
              <div>
                <Label className="text-xs mb-1 block">{t(`Delta signé (${currency}) *`, `الفارق المُوقَّع (${currency}) *`)}</Label>
                <Input type="number" step="0.01" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="ex: 500 ou -250" className="h-9 text-lg font-bold" data-testid="input-adjust-delta" />
                <p className="text-[11px] text-muted-foreground mt-1">{t("Positif = crédit, négatif = débit", "موجب = دائن، سالب = مدين")}</p>
              </div>
              <div>
                <Label className="text-xs mb-1 block">{t("Raison *", "السبب *")}</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={t("Justification obligatoire...", "التبرير إلزامي...")} data-testid="input-adjust-notes" />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label className="text-xs mb-1 block">{t(`Montant (${currency}) *`, `المبلغ (${currency}) *`)}</Label>
                <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 text-lg font-bold" data-testid="input-admin-amount" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">{t("Note", "ملاحظة")}</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
              {action.type === "deposit" && mainCaisseId === null && (
                <p className="text-xs text-red-600">{t("Aucune caisse principale trouvée.", "لم يُعثر على صندوق رئيسي.")}</p>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Annuler", "إلغاء")}</Button>
          <Button onClick={handleSubmit} disabled={pending} className="bg-[#1B3057] hover:bg-[#152544]" data-testid="button-confirm-admin">
            {t("Confirmer", "تأكيد")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CaisseDetailDialog({ id, onClose, t, caisseLabel }: {
  id: number; onClose: () => void; t: TFn; caisseLabel: (c: CaisseLike) => string;
}) {
  const { data, isLoading } = useGetErpCaisse(id);
  const { lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const reasonLabel = makeReasonLabel(t);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Mouvements", "حركات الصندوق")}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("Chargement...", "جاري التحميل...")}</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">{t("Introuvable", "غير موجود")}</p>
        ) : (
          <>
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <div>
                <p className="text-sm font-medium">{caisseLabel(data)}</p>
                <p className="text-xs text-muted-foreground">
                  {data.kind === "main" ? t("Caisse principale", "الصندوق الرئيسي") : t("Caisse staff", "صندوق الموظف")}
                </p>
              </div>
              <p className="text-2xl font-bold">{fmtAmount(data.balance)} {currency}</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>{t("Raison", "السبب")}</TableHead>
                  <TableHead>{t("Contrepartie", "الطرف المقابل")}</TableHead>
                  <TableHead>{t("Acteur", "المنفِّذ")}</TableHead>
                  <TableHead className="text-right">{t("Montant", "المبلغ")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.movements ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">{t("Aucun mouvement", "لا توجد حركات")}</TableCell></TableRow>
                ) : (data.movements ?? []).map((m: CaisseMovement) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs text-muted-foreground">{m.createdAt ? format(new Date(m.createdAt), "MMM d HH:mm") : "—"}</TableCell>
                    <TableCell className="text-sm">{reasonLabel[m.reason] ?? m.reason}{m.notes ? <div className="text-[11px] text-muted-foreground italic">{m.notes}</div> : null}</TableCell>
                    <TableCell className="text-sm">{m.counterparty ? caisseLabel(m.counterparty) : "—"}</TableCell>
                    <TableCell className="text-sm">{personLabel(m.actorUser)}</TableCell>
                    <TableCell className={`text-right font-bold ${m.type === "credit" ? "text-emerald-600" : "text-red-600"}`}>
                      {m.type === "credit" ? "+" : "-"} {fmtAmount(m.amount)} {currency}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

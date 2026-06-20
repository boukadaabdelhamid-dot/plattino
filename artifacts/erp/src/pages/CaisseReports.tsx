import React, { useMemo, useState } from "react";
import {
  useGetErpCaisseReports,
  useGetErpCaisses,
  useGetErpCaisseSessions,
  useOpenErpCaisseSession,
  useCloseErpCaisseSession,
  type CaisseReportRow,
  type CaisseSessionDetail,
  type CaisseSummary,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/hooks/use-lang";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BarChart2, Download, Wallet, FileText, LockOpen, Lock, ChevronDown, ChevronRight } from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const todayISO = (offsetDays = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmt = (v: string | number | undefined | null): string => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return n.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDT = (iso: string | undefined | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-DZ");
};

const personLabel = (r: CaisseReportRow): string =>
  r.owner?.name || r.owner?.email || `Caisse #${r.caisseId}`;

const caisseName = (c: CaisseSummary, tFn: (fr: string, ar: string) => string) =>
  c.kind === "main"
    ? `${tFn("Principale", "رئيسي")} — ${tFn("Caisse principale", "الصندوق الرئيسي")}`
    : (c.owner?.name || c.owner?.email || `Caisse #${c.id}`);

const csvEscape = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ─── Movement summary detail ──────────────────────────────────────────────────

interface MovSummaryProps {
  s: CaisseSessionDetail;
  currency: string;
  t: (fr: string, ar: string) => string;
}

function MovSummary({ s, currency, t }: MovSummaryProps) {
  const ms = s.movementSummary;
  if (!ms) return null;
  const rows = [
    { label: t("Ventes", "مبيعات"), value: ms.totalSales, color: "text-emerald-700" },
    { label: t("Transferts reçus", "تحويلات واردة"), value: ms.transfersIn, color: "text-emerald-700" },
    { label: t("Transferts envoyés", "تحويلات صادرة"), value: ms.transfersOut, color: "text-red-600" },
    { label: t("En attente (ancien)", "في الانتظار (قديم)"), value: ms.transfersHeld, color: "text-amber-600" },
    { label: t("Remboursements (ancien)", "استرجاعات (قديم)"), value: ms.transfersRefunded, color: "" },
    { label: t("Dépôts admin", "إيداعات إدارة"), value: ms.adminDeposits, color: "text-red-600" },
    { label: t("Retraits admin", "سحوبات إدارة"), value: ms.adminWithdrawals, color: "text-emerald-700" },
    { label: t("Ajustements (+)", "تعديلات (+)"), value: ms.adjustmentsCredit, color: "text-emerald-700" },
    { label: t("Ajustements (-)", "تعديلات (-)"), value: ms.adjustmentsDebit, color: "text-red-600" },
  ];
  return (
    <div className="space-y-1">
      {rows.map(r => (
        <div key={r.label} className="flex justify-between text-sm">
          <span className="text-muted-foreground">{r.label}</span>
          <span className={r.color}>{fmt(r.value)} {currency}</span>
        </div>
      ))}
      <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
        <span>{t("Mouvement net", "الحركة الصافية")}</span>
        <span className={parseFloat(ms.netMovement) >= 0 ? "text-emerald-700" : "text-red-600"}>
          {parseFloat(ms.netMovement) >= 0 ? "+" : ""}{fmt(ms.netMovement)} {currency}
        </span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t("Nb mouvements", "عدد الحركات")}</span>
        <span>{ms.movementCount}</span>
      </div>
    </div>
  );
}

// ─── Single session card (collapsible) ───────────────────────────────────────

interface SessionCardProps {
  session: CaisseSessionDetail;
  currency: string;
  t: (fr: string, ar: string) => string;
}

function SessionCard({ session, currency, t }: SessionCardProps) {
  const [open, setOpen] = useState(false);
  const isOpen = session.status === "open";
  const ecart = session.ecart != null ? parseFloat(session.ecart) : null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-3">
          {open
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <div>
            <div className="text-sm font-medium">{fmtDT(session.openedAt)}</div>
            {session.closedAt && (
              <div className="text-xs text-muted-foreground">→ {fmtDT(session.closedAt)}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isOpen ? (
            <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">{t("Ouverte", "مفتوحة")}</Badge>
          ) : (
            <Badge variant="secondary">{t("Fermée", "مغلقة")}</Badge>
          )}
          {ecart != null && (
            <span className={`text-sm font-semibold ${ecart >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              {t("Écart", "فارق")}: {ecart >= 0 ? "+" : ""}{fmt(ecart)} {currency}
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 bg-muted/20 border-t space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3">
            <div className="bg-white rounded-md p-3 border">
              <div className="text-xs text-muted-foreground">{t("Solde ouverture", "رصيد الفتح")}</div>
              <div className="text-base font-bold">{fmt(session.openingBalance)} {currency}</div>
            </div>
            <div className="bg-white rounded-md p-3 border">
              <div className="text-xs text-muted-foreground">{t("Solde théorique", "الرصيد النظري")}</div>
              <div className="text-base font-bold">
                {session.theoreticalClosingBalance ? `${fmt(session.theoreticalClosingBalance)} ${currency}` : "—"}
              </div>
            </div>
            <div className="bg-white rounded-md p-3 border">
              <div className="text-xs text-muted-foreground">{t("Solde réel", "الرصيد الفعلي")}</div>
              <div className="text-base font-bold">
                {session.actualClosingBalance ? `${fmt(session.actualClosingBalance)} ${currency}` : "—"}
              </div>
            </div>
            <div className={`rounded-md p-3 border ${ecart != null ? (ecart >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200") : "bg-white"}`}>
              <div className="text-xs text-muted-foreground">{t("Écart", "الفارق")}</div>
              <div className={`text-base font-bold ${ecart != null && ecart >= 0 ? "text-emerald-700" : ecart != null ? "text-red-600" : ""}`}>
                {ecart != null ? `${ecart >= 0 ? "+" : ""}${fmt(ecart)} ${currency}` : "—"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                {t("Détail des mouvements", "تفاصيل الحركات")}
              </div>
              <MovSummary s={session} currency={currency} t={t} />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                {t("Infos", "معلومات")}
              </div>
              <div className="text-sm flex gap-2">
                <span className="text-muted-foreground">{t("Ouvert par:", "فُتح بواسطة:")}</span>
                <span>{session.openedByUser?.name || session.openedByUser?.email || "—"}</span>
              </div>
              {session.closedByUser && (
                <div className="text-sm flex gap-2">
                  <span className="text-muted-foreground">{t("Fermé par:", "أُغلق بواسطة:")}</span>
                  <span>{session.closedByUser.name || session.closedByUser.email}</span>
                </div>
              )}
              {session.notes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">{t("Notes:", "ملاحظات:")}</span>
                  <p className="mt-0.5">{session.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Z-Report Tab ─────────────────────────────────────────────────────────────

interface ZReportTabProps {
  t: (fr: string, ar: string) => string;
  currency: string;
}

function ZReportTab({ t, currency }: ZReportTabProps) {
  const [selectedCaisseId, setSelectedCaisseId] = useState<number | null>(null);
  const [openSessionOpen, setOpenSessionOpen] = useState(false);
  const [closeSessionOpen, setCloseSessionOpen] = useState(false);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [actualClosing, setActualClosing] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caisses = [] } = useGetErpCaisses({ query: { staleTime: 30_000 } as any });

  const { data: sessions = [], isLoading: sessionsLoading, refetch: refetchSessions } = useGetErpCaisseSessions(
    selectedCaisseId ?? 0,
    { limit: 50 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !!selectedCaisseId, staleTime: 5_000 } as any },
  );

  const openMutation = useOpenErpCaisseSession();
  const closeMutation = useCloseErpCaisseSession();

  const activeSession = sessions.find(s => s.status === "open") ?? null;

  const theoreticalBalance = activeSession
    ? parseFloat(activeSession.openingBalance) + parseFloat(activeSession.movementSummary?.netMovement ?? "0")
    : 0;

  const handleOpenSession = async () => {
    if (!selectedCaisseId) return;
    setError(null);
    try {
      await openMutation.mutateAsync({
        id: selectedCaisseId,
        data: { openingBalance, notes: sessionNotes || undefined },
      });
      setOpenSessionOpen(false);
      setSessionNotes("");
      refetchSessions();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || t("Erreur lors de l'ouverture", "خطأ عند الفتح"));
    }
  };

  const handleCloseSession = async () => {
    if (!selectedCaisseId) return;
    setError(null);
    try {
      await closeMutation.mutateAsync({
        id: selectedCaisseId,
        data: { actualClosingBalance: actualClosing, notes: sessionNotes || undefined },
      });
      setCloseSessionOpen(false);
      setActualClosing("");
      setSessionNotes("");
      refetchSessions();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || t("Erreur lors de la fermeture", "خطأ عند الإغلاق"));
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("Sélectionner une caisse", "اختر الصندوق")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedCaisseId ? String(selectedCaisseId) : ""}
            onValueChange={(v) => { setSelectedCaisseId(Number(v)); setError(null); }}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder={t("Choisir une caisse…", "اختر الصندوق...")} />
            </SelectTrigger>
            <SelectContent>
              {caisses.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {caisseName(c, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedCaisseId && (
        <>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-amber-600" />
                {t("Session en cours", "الجلسة الحالية")}
              </CardTitle>
              <div className="flex gap-2">
                {activeSession ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setActualClosing(theoreticalBalance.toFixed(2));
                      setSessionNotes("");
                      setError(null);
                      setCloseSessionOpen(true);
                    }}
                  >
                    <Lock className="h-4 w-4 mr-1.5" />
                    {t("Clôturer (Z-Report)", "إغلاق (Z-Report)")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="bg-[#1B3057] hover:bg-[#152544]"
                    onClick={() => {
                      setOpeningBalance("0");
                      setSessionNotes("");
                      setError(null);
                      setOpenSessionOpen(true);
                    }}
                  >
                    <LockOpen className="h-4 w-4 mr-1.5" />
                    {t("Ouvrir session", "فتح جلسة")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <p className="text-sm text-muted-foreground">{t("Chargement…", "جاري التحميل...")}</p>
              ) : activeSession ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {t("Ouverte", "مفتوحة")}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {t("Depuis", "منذ")} {fmtDT(activeSession.openedAt)}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
                        {t("Solde ouverture", "رصيد الفتح")}
                      </div>
                      <div className="text-2xl font-bold">{fmt(activeSession.openingBalance)} {currency}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {t("Solde théorique actuel:", "الرصيد النظري الحالي:")} {" "}
                        <span className="font-semibold text-foreground">{fmt(theoreticalBalance)} {currency}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                        {t("Activité depuis l'ouverture", "النشاط منذ الفتح")}
                      </div>
                      <MovSummary s={activeSession} currency={currency} t={t} />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("Aucune session ouverte pour cette caisse.", "لا توجد جلسة مفتوحة لهذا الصندوق.")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("Historique des sessions", "سجل الجلسات")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sessionsLoading ? (
                <p className="text-sm text-muted-foreground">{t("Chargement…", "جاري التحميل...")}</p>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("Aucune session pour cette caisse.", "لا توجد جلسات لهذا الصندوق.")}
                </p>
              ) : (
                sessions.map(s => (
                  <SessionCard key={s.id} session={s} currency={currency} t={t} />
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Open session dialog */}
      <Dialog open={openSessionOpen} onOpenChange={(v) => { setOpenSessionOpen(v); if (!v) setError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Ouvrir une session", "فتح جلسة")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("Solde d'ouverture (DA)", "رصيد الفتح (دج)")}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t("Notes (optionnel)", "ملاحظات (اختياري)")}</Label>
              <Textarea
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                className="mt-1"
                rows={2}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenSessionOpen(false)}>{t("Annuler", "إلغاء")}</Button>
            <Button
              className="bg-[#1B3057] hover:bg-[#152544]"
              onClick={handleOpenSession}
              disabled={openMutation.isPending}
            >
              <LockOpen className="h-4 w-4 mr-1.5" />
              {openMutation.isPending ? t("Ouverture…", "جاري الفتح...") : t("Ouvrir", "فتح")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close session dialog */}
      <Dialog open={closeSessionOpen} onOpenChange={(v) => { setCloseSessionOpen(v); if (!v) setError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Clôturer la session (Z-Report)", "إغلاق الجلسة (Z-Report)")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {activeSession && (
              <div className="rounded-md bg-muted/60 px-4 py-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("Solde ouverture", "رصيد الفتح")}</span>
                  <span className="font-medium">{fmt(activeSession.openingBalance)} {currency}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("Mouvement net", "الحركة الصافية")}</span>
                  <span className={parseFloat(activeSession.movementSummary?.netMovement ?? "0") >= 0 ? "text-emerald-700" : "text-red-600"}>
                    {parseFloat(activeSession.movementSummary?.netMovement ?? "0") >= 0 ? "+" : ""}
                    {fmt(activeSession.movementSummary?.netMovement ?? "0")} {currency}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                  <span>{t("Solde théorique", "الرصيد النظري")}</span>
                  <span>{fmt(theoreticalBalance)} {currency}</span>
                </div>
              </div>
            )}
            <div>
              <Label>{t("Solde réel compté (DA)", "الرصيد الفعلي المعدود (دج)")}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={actualClosing}
                onChange={(e) => setActualClosing(e.target.value)}
                className="mt-1"
              />
            </div>
            {actualClosing !== "" && (
              <div className="text-sm flex items-center gap-2">
                <span className="text-muted-foreground">{t("Écart calculé:", "الفارق المحسوب:")}</span>
                <span className={
                  parseFloat(actualClosing) - theoreticalBalance >= 0
                    ? "text-emerald-700 font-semibold"
                    : "text-red-600 font-semibold"
                }>
                  {parseFloat(actualClosing) - theoreticalBalance >= 0 ? "+" : ""}
                  {fmt(parseFloat(actualClosing) - theoreticalBalance)} {currency}
                </span>
              </div>
            )}
            <div>
              <Label>{t("Notes (optionnel)", "ملاحظات (اختياري)")}</Label>
              <Textarea
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                className="mt-1"
                rows={2}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseSessionOpen(false)}>{t("Annuler", "إلغاء")}</Button>
            <Button
              variant="destructive"
              onClick={handleCloseSession}
              disabled={closeMutation.isPending || !actualClosing}
            >
              <Lock className="h-4 w-4 mr-1.5" />
              {closeMutation.isPending ? t("Clôture…", "جاري الإغلاق...") : t("Clôturer", "إغلاق")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CaisseReports() {
  const [from, setFrom] = useState<string>(todayISO());
  const [to, setTo] = useState<string>(todayISO());
  const [activeTab, setActiveTab] = useState<"report" | "zreport">("report");
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading, isFetching, refetch } = useGetErpCaisseReports(
    { from, to },
    { query: { staleTime: 10_000 } as any },
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const totals = data?.totals;

  const handleExport = () => {
    if (!rows.length) return;
    const headers = [
      "Caisse ID", t("Propriétaire", "المالك"), "Email", t("Solde actuel", "الرصيد الحالي"),
      t("Ventes", "المبيعات"), t("Transferts reçus", "تحويلات واردة"), t("Transferts envoyés", "تحويلات صادرة"),
      t("En attente", "في الانتظار"), t("Remboursements", "استرجاعات"),
      t("Dépôts → principale", "إيداعات → رئيسي"), t("Retraits ← principale", "سحوبات ← رئيسي"),
      t("Ajustements (+)", "تعديلات (+)"), t("Ajustements (-)", "تعديلات (-)"),
      t("Mouvement net", "الحركة الصافية"), t("Nb mouvements", "عدد الحركات"),
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        r.caisseId,
        csvEscape(r.owner?.name ?? ""),
        csvEscape(r.owner?.email ?? ""),
        r.currentBalance,
        r.totalSales, r.transfersIn, r.transfersOut,
        r.transfersHeld, r.transfersRefunded,
        r.adminDeposits, r.adminWithdrawals,
        r.adjustmentsCredit, r.adjustmentsDebit,
        r.netMovement, r.movementCount,
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `caisse-report-${from}-to-${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const setQuickRange = (days: number) => {
    setFrom(todayISO(-days + 1));
    setTo(todayISO());
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart2 className="h-6 w-6 text-amber-500" />
          {t("Rapport caisses", "تقرير الصناديق")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("Activité agrégée et gestion de sessions Z-Report.", "النشاط المجمّع وإدارة جلسات Z-Report.")}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "report"
              ? "border-[#1B3057] text-[#1B3057]"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("report")}
        >
          <BarChart2 className="h-4 w-4 inline mr-1.5" />
          {t("Rapport activité", "تقرير النشاط")}
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "zreport"
              ? "border-[#1B3057] text-[#1B3057]"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("zreport")}
        >
          <FileText className="h-4 w-4 inline mr-1.5" />
          {t("Z-Report / Sessions", "Z-Report / الجلسات")}
        </button>
      </div>

      {activeTab === "report" && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("Période", "الفترة")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label className="text-xs mb-1 block">{t("Du", "من")}</Label>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[160px]" data-testid="input-from-date" />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">{t("Au", "إلى")}</Label>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[160px]" data-testid="input-to-date" />
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setQuickRange(1)} data-testid="button-range-today">{t("Aujourd'hui", "اليوم")}</Button>
                  <Button size="sm" variant="outline" onClick={() => setQuickRange(7)} data-testid="button-range-7d">{t("7 jours", "7 أيام")}</Button>
                  <Button size="sm" variant="outline" onClick={() => setQuickRange(30)} data-testid="button-range-30d">{t("30 jours", "30 يوماً")}</Button>
                </div>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">{t("Actualiser", "تحديث")}</Button>
                  <Button size="sm" className="bg-[#1B3057] hover:bg-[#152544]" onClick={handleExport} disabled={rows.length === 0} data-testid="button-export-csv">
                    <Download className="h-4 w-4 mr-1.5" /> {t("Exporter CSV", "تصدير CSV")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4 text-amber-600" />
                {t("Activité par caisse", "النشاط لكل صندوق")}
              </CardTitle>
              {data && (
                <span className="text-xs text-muted-foreground">
                  {new Date(data.from).toLocaleString("fr-DZ")} → {new Date(data.to).toLocaleString("fr-DZ")}
                </span>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-right">{t("Solde actuel", "الرصيد")}</TableHead>
                      <TableHead className="text-right">{t("Ventes", "مبيعات")}</TableHead>
                      <TableHead className="text-right">{t("Transf. reçus", "تحويلات واردة")}</TableHead>
                      <TableHead className="text-right">{t("Transf. envoyés", "تحويلات صادرة")}</TableHead>
                      <TableHead className="text-right">{t("En attente", "انتظار")}</TableHead>
                      <TableHead className="text-right">{t("Remb.", "استرجاع")}</TableHead>
                      <TableHead className="text-right">{t("Dépôts→princ.", "إيداعات")}</TableHead>
                      <TableHead className="text-right">{t("Retraits←princ.", "سحوبات")}</TableHead>
                      <TableHead className="text-right">{t("Ajust. (±)", "تعديلات")}</TableHead>
                      <TableHead className="text-right">{t("Net", "صافي")}</TableHead>
                      <TableHead className="text-right">{t("Mvts", "حركات")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                          {t("Chargement...", "جاري التحميل...")}
                        </TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                          {t("Aucune caisse staff", "لا توجد صناديق موظفين")}
                        </TableCell>
                      </TableRow>
                    ) : rows.map((r) => {
                      const adjNet = parseFloat(r.adjustmentsCredit) - parseFloat(r.adjustmentsDebit);
                      const net = parseFloat(r.netMovement);
                      return (
                        <TableRow key={r.caisseId} data-testid={`row-report-${r.caisseId}`}>
                          <TableCell>
                            <div className="font-medium">{personLabel(r)}</div>
                            {r.owner?.email && <div className="text-xs text-muted-foreground">{r.owner.email}</div>}
                          </TableCell>
                          <TableCell className="text-right font-bold">{fmt(r.currentBalance)} {currency}</TableCell>
                          <TableCell className="text-right text-emerald-700">{fmt(r.totalSales)}</TableCell>
                          <TableCell className="text-right text-emerald-700">{fmt(r.transfersIn)}</TableCell>
                          <TableCell className="text-right text-red-700">{fmt(r.transfersOut)}</TableCell>
                          <TableCell className="text-right text-amber-700">{fmt(r.transfersHeld)}</TableCell>
                          <TableCell className="text-right">{fmt(r.transfersRefunded)}</TableCell>
                          <TableCell className="text-right text-red-700">{fmt(r.adminDeposits)}</TableCell>
                          <TableCell className="text-right text-emerald-700">{fmt(r.adminWithdrawals)}</TableCell>
                          <TableCell className={`text-right ${adjNet >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                            {adjNet >= 0 ? "+" : ""}{fmt(adjNet)}
                          </TableCell>
                          <TableCell className={`text-right font-bold ${net >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                            {net >= 0 ? "+" : ""}{fmt(net)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">{r.movementCount}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  {totals && rows.length > 0 && (
                    <TableFooter>
                      <TableRow data-testid="row-totals">
                        <TableCell className="font-bold">{t("Totaux", "المجموع")}</TableCell>
                        <TableCell />
                        <TableCell className="text-right font-bold">{fmt(totals.totalSales)}</TableCell>
                        <TableCell className="text-right font-bold">{fmt(totals.transfersIn)}</TableCell>
                        <TableCell className="text-right font-bold">{fmt(totals.transfersOut)}</TableCell>
                        <TableCell className="text-right font-bold">{fmt(totals.transfersHeld)}</TableCell>
                        <TableCell className="text-right font-bold">{fmt(totals.transfersRefunded)}</TableCell>
                        <TableCell className="text-right font-bold">{fmt(totals.adminDeposits)}</TableCell>
                        <TableCell className="text-right font-bold">{fmt(totals.adminWithdrawals)}</TableCell>
                        <TableCell className="text-right font-bold">
                          {fmt(parseFloat(totals.adjustmentsCredit) - parseFloat(totals.adjustmentsDebit))}
                        </TableCell>
                        <TableCell className="text-right font-bold">{fmt(totals.netMovement)}</TableCell>
                        <TableCell className="text-right font-bold">{totals.movementCount}</TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "zreport" && <ZReportTab t={t} currency={currency} />}
    </div>
  );
}

import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPayrollAdjustments, useCreatePayrollAdjustment, useDeletePayrollAdjustment,
  getGetPayrollAdjustmentsQueryKey,
  useGetPayrollRuns, getGetPayrollRunsQueryKey,
  useGetPayslips, getGetPayslipsQueryKey,
  useGeneratePayroll,
  type Employee, type Payslip,
} from "@workspace/api-client-react";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2, Lock, Printer, PlayCircle } from "lucide-react";
import PayslipDialog from "@/components/PayslipDialog";

type EmployeeRow = Employee & { id: number; name?: string | null };

function monthRange(d = new Date()): { start: string; end: string } {
  const y = d.getFullYear(), m = d.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

const typeMeta: Record<string, { fr: string; ar: string; sign: 1 | -1; color: string }> = {
  advance:   { fr: "Avance",  ar: "سلفة",  sign: -1, color: "text-amber-700 bg-amber-100" },
  deduction: { fr: "Retenue", ar: "خصم",   sign: -1, color: "text-red-700 bg-red-100" },
  bonus:     { fr: "Prime",   ar: "منحة",  sign: 1,  color: "text-emerald-700 bg-emerald-100" },
};

export default function PayrollPanel({ employees, currency }: { employees: EmployeeRow[]; currency: string }) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const activeEmployees = useMemo(() => employees.filter(e => e.status === "active"), [employees]);

  const [adjEmployeeId, setAdjEmployeeId] = useState<string>("");
  const [adjFilterEmployeeId, setAdjFilterEmployeeId] = useState<string>("all");
  const [adjType, setAdjType] = useState<"advance" | "deduction" | "bonus">("advance");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjDate, setAdjDate] = useState(new Date().toISOString().slice(0, 10));
  const [adjReason, setAdjReason] = useState("");

  const { data: adjustments, isLoading: loadingAdj } = useGetPayrollAdjustments(
    adjFilterEmployeeId !== "all" ? { employeeId: Number(adjFilterEmployeeId) } : undefined,
  );
  const createAdj = useCreatePayrollAdjustment();
  const deleteAdj = useDeletePayrollAdjustment();

  const [period, setPeriod] = useState(monthRange());
  const { data: runs, isLoading: loadingRuns } = useGetPayrollRuns();
  const generate = useGeneratePayroll();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const { data: payslips, isLoading: loadingPayslips } = useGetPayslips(
    selectedRunId ? { runId: selectedRunId } : undefined,
    { query: { enabled: !!selectedRunId } },
  );
  const [printSlip, setPrintSlip] = useState<Payslip | null>(null);

  const invalidateAdj = () => qc.invalidateQueries({ queryKey: getGetPayrollAdjustmentsQueryKey() });

  const handleAddAdjustment = () => {
    const employeeId = Number(adjEmployeeId);
    const amount = Number(adjAmount);
    if (!employeeId || !amount || amount <= 0 || !adjDate) return;
    createAdj.mutate({
      data: { employeeId, type: adjType, amount, date: adjDate, reason: adjReason || undefined },
    }, {
      onSuccess: () => {
        setAdjAmount(""); setAdjReason("");
        invalidateAdj();
      },
    });
  };

  const handleDeleteAdjustment = (id: number) => {
    if (!confirm(t("Supprimer cet ajustement ?", "حذف هذا التعديل؟"))) return;
    deleteAdj.mutate({ id }, { onSuccess: invalidateAdj });
  };

  const handleGenerate = () => {
    if (!period.start || !period.end || period.start > period.end) return;
    const msg = t(
      `Générer la paie pour ${activeEmployees.length} employé(s) actif(s) sur la période ${period.start} → ${period.end} ?`,
      `توليد الرواتب لـ ${activeEmployees.length} موظف نشط للفترة ${period.start} → ${period.end}؟`,
    );
    if (!confirm(msg)) return;
    generate.mutate({ data: { periodStart: period.start, periodEnd: period.end } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPayrollRunsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPayslipsQueryKey() });
        invalidateAdj();
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        alert(msg);
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* ── Générer la paie ── */}
      <Card className="border shadow-sm">
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <PlayCircle className="h-4 w-4" />{t("Générer la paie", "توليد الرواتب")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(
              "Génère en une fois la fiche de paie de chaque employé actif pour la période choisie. Les avances/retenues/primes de cette période sont intégrées et la période devient verrouillée.",
              "يولد دفعة واحدة قسيمة راتب كل موظف نشط للفترة المحددة. تُدمج السلف والخصومات والمنح لهذه الفترة وتصبح مقفلة.",
            )}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs mb-1 block">{t("Début période", "بداية الفترة")}</Label>
              <Input type="date" className="h-8 text-sm w-40" value={period.start}
                onChange={e => setPeriod(p => ({ ...p, start: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Fin période", "نهاية الفترة")}</Label>
              <Input type="date" className="h-8 text-sm w-40" value={period.end}
                onChange={e => setPeriod(p => ({ ...p, end: e.target.value }))} />
            </div>
            <Button onClick={handleGenerate} disabled={generate.isPending || activeEmployees.length === 0} data-testid="button-generate-payroll">
              <PlayCircle className="h-4 w-4 mr-2" />
              {t(`Générer (${activeEmployees.length} employés)`, `توليد (${activeEmployees.length} موظف)`)}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Avances / Retenues / Primes ── */}
      <Card className="border shadow-sm">
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-semibold">{t("Avances, retenues et primes", "السلف والخصومات والمنح")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div>
              <Label className="text-xs mb-1 block">{t("Employé", "الموظف")}</Label>
              <Select value={adjEmployeeId} onValueChange={setAdjEmployeeId}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Choisir", "اختر")} /></SelectTrigger>
                <SelectContent>
                  {employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Type", "النوع")}</Label>
              <Select value={adjType} onValueChange={v => setAdjType(v as typeof adjType)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(typeMeta).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{t(v.fr, v.ar)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t(`Montant (${currency})`, `المبلغ (${currency})`)}</Label>
              <Input type="number" className="h-8 text-sm" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Date", "التاريخ")}</Label>
              <Input type="date" className="h-8 text-sm" value={adjDate} onChange={e => setAdjDate(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs mb-1 block">{t("Motif (optionnel)", "السبب (اختياري)")}</Label>
                <Input className="h-8 text-sm" value={adjReason} onChange={e => setAdjReason(e.target.value)} />
              </div>
              <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleAddAdjustment}
                disabled={createAdj.isPending || !adjEmployeeId || !adjAmount} data-testid="button-add-payroll-adjustment">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">{t("Historique", "السجل")}</span>
            <Select value={adjFilterEmployeeId} onValueChange={setAdjFilterEmployeeId}>
              <SelectTrigger className="h-7 text-xs w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Tous les employés", "كل الموظفين")}</SelectItem>
                {employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loadingAdj ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="overflow-x-auto border rounded">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground uppercase tracking-wide">
                    <th className="py-2 px-3 text-left">{t("Employé", "الموظف")}</th>
                    <th className="py-2 px-3 text-left">{t("Type", "النوع")}</th>
                    <th className="py-2 px-3 text-right">{t("Montant", "المبلغ")}</th>
                    <th className="py-2 px-3 text-left">{t("Date", "التاريخ")}</th>
                    <th className="py-2 px-3 text-left">{t("Motif", "السبب")}</th>
                    <th className="py-2 px-3 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {(adjustments ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-muted-foreground italic">
                      {t("Aucun ajustement", "لا توجد تعديلات")}
                    </td></tr>
                  ) : (adjustments ?? []).map(a => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-2 px-3">{a.employeeName ?? "—"}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded-full font-semibold ${typeMeta[a.type]?.color}`}>
                          {t(typeMeta[a.type]?.fr ?? a.type, typeMeta[a.type]?.ar ?? a.type)}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold">
                        {Number(a.amount).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-3">{a.date}</td>
                      <td className="py-2 px-3 text-muted-foreground truncate max-w-[200px]">{a.reason ?? "—"}</td>
                      <td className="py-2 px-3">
                        {a.payslipId ? (
                          <span title={t("Verrouillé (déjà payé)", "مقفل (تم دفعه)")}>
                            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                        ) : (
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteAdjustment(a.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Historique des paies ── */}
      <Card className="border shadow-sm">
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-semibold">{t("Historique des paies", "سجل الرواتب")}</h2>
          {loadingRuns ? (
            <Skeleton className="h-16" />
          ) : (runs ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-4 text-center">{t("Aucune paie générée", "لم يتم توليد أي راتب بعد")}</p>
          ) : (
            <div className="space-y-2">
              {(runs ?? []).map(r => (
                <div key={r.id} className="border rounded">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/30"
                    onClick={() => setSelectedRunId(id => id === r.id ? null : r.id)}
                  >
                    <span className="font-medium">{r.periodStart} → {r.periodEnd}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`${r.employeeCount ?? 0} employés · Total`, `${r.employeeCount ?? 0} موظف · المجموع`)}{" "}
                      <span className="font-semibold tabular-nums">
                        {Number(r.totalNet ?? 0).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} {currency}
                      </span>
                    </span>
                  </button>
                  {selectedRunId === r.id && (
                    <div className="border-t overflow-x-auto">
                      {loadingPayslips ? (
                        <div className="p-3"><Skeleton className="h-16" /></div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/30 text-muted-foreground uppercase tracking-wide">
                              <th className="py-1.5 px-3 text-left">{t("Employé", "الموظف")}</th>
                              <th className="py-1.5 px-3 text-right">{t("Base", "الأساس")}</th>
                              <th className="py-1.5 px-3 text-right">{t("Prime", "منحة")}</th>
                              <th className="py-1.5 px-3 text-right">{t("Avances", "سلف")}</th>
                              <th className="py-1.5 px-3 text-right">{t("Retenues", "خصومات")}</th>
                              <th className="py-1.5 px-3 text-right">{t("Net", "الصافي")}</th>
                              <th className="py-1.5 px-3 w-16" />
                            </tr>
                          </thead>
                          <tbody>
                            {(payslips ?? []).map(p => (
                              <tr key={p.id} className="border-b last:border-0">
                                <td className="py-1.5 px-3">{p.employeeName ?? "—"}</td>
                                <td className="py-1.5 px-3 text-right tabular-nums">{Number(p.baseSalary).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })}</td>
                                <td className="py-1.5 px-3 text-right tabular-nums text-emerald-700">{Number(p.bonusAmount).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })}</td>
                                <td className="py-1.5 px-3 text-right tabular-nums text-amber-700">{Number(p.advancesAmount).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })}</td>
                                <td className="py-1.5 px-3 text-right tabular-nums text-red-700">{Number(p.deductionsAmount).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })}</td>
                                <td className="py-1.5 px-3 text-right tabular-nums font-bold">{Number(p.netAmount).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })}</td>
                                <td className="py-1.5 px-3">
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setPrintSlip(p)}>
                                    <Printer className="h-3.5 w-3.5" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PayslipDialog open={!!printSlip} onOpenChange={v => { if (!v) setPrintSlip(null); }} payslip={printSlip} currency={currency} />
    </div>
  );
}

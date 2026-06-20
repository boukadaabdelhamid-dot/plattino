import React, { useState } from "react";
import {
  useGetTransactions, useCreateTransaction, useGetAccountingSummary,
  getGetTransactionsQueryKey,
  type CreateTransactionRequestType,
  type CreateTransactionRequestCategory,
  type Transaction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { format } from "date-fns";

type TxForm = { type: string; category: string; amount: string; description: string; date: string };
const emptyForm: TxForm = { type: "income", category: "", amount: "", description: "", date: new Date().toISOString().slice(0, 10) };

export default function Accounting() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const { data: transactions, isLoading } = useGetTransactions();
  const { data: summary } = useGetAccountingSummary();
  const createTx = useCreateTransaction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TxForm>(emptyForm);

  const handleSave = () => {
    createTx.mutate(
      { data: { type: form.type as CreateTransactionRequestType, category: form.category as CreateTransactionRequestCategory, amount: form.amount, description: form.description, date: form.date } },
      { onSettled: () => { qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }); setOpen(false); setForm(emptyForm); } }
    );
  };

  const txTypeLabels: Record<string, string> = {
    income: t("Revenu", "دخل"),
    expense: t("Dépense", "مصروف"),
  };

  const categoryLabels: Record<string, string> = {
    sales: t("Ventes", "مبيعات"),
    purchase: t("Achats", "مشتريات"),
    salary: t("Salaires", "رواتب"),
    rent: t("Loyer", "إيجار"),
    utilities: t("Services", "خدمات"),
    marketing: t("Marketing", "تسويق"),
    other: t("Autre", "أخرى"),
  };

  const kpiCards = [
    { labelFr: "Revenus totaux", labelAr: "إجمالي الدخل", value: summary?.totalIncome, icon: TrendingUp, color: "text-emerald-600" },
    { labelFr: "Dépenses totales", labelAr: "إجمالي المصروفات", value: summary?.totalExpenses, icon: TrendingDown, color: "text-red-500" },
    { labelFr: "Solde net comptable", labelAr: "رصيد الحساب الصافي", value: summary?.netBalance, icon: DollarSign, color: (summary?.netBalance ?? 0) >= 0 ? "text-primary" : "text-destructive" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("Comptabilité", "المحاسبة")}</h1>
          <p className="text-sm text-muted-foreground">{t("Suivre les revenus et dépenses", "تتبع الدخل والمصروفات")}</p>
        </div>
        <Button onClick={() => setOpen(true)} data-testid="button-add-transaction">
          <Plus className="h-4 w-4 mr-2" /> {t("Ajouter une transaction", "إضافة معاملة")}
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-4">
          {kpiCards.map(({ labelFr, labelAr, value, icon: Icon, color }) => (
            <Card key={labelFr} className="border shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t(labelFr, labelAr)}</p>
                    <p className={`text-xl font-bold ${color}`}>{(value ?? 0).toLocaleString()} {currency}</p>
                  </div>
                  <Icon className={`h-6 w-6 ${color} opacity-70`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("Transactions", "المعاملات")} ({transactions?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Date", "التاريخ")}</TableHead>
                    <TableHead>{t("Type", "النوع")}</TableHead>
                    <TableHead>{t("Catégorie", "الفئة")}</TableHead>
                    <TableHead>{t("Description", "الوصف")}</TableHead>
                    <TableHead>{t("Montant", "المبلغ")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(transactions ?? []).map((tx: Transaction) => (
                    <TableRow key={tx.id} data-testid={`row-tx-${tx.id}`}>
                      <TableCell className="text-sm text-muted-foreground">
                        {tx.date ? format(new Date(tx.date), "dd/MM/yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${tx.type === "income" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                          {txTypeLabels[tx.type] ?? tx.type}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{categoryLabels[tx.category ?? ""] ?? tx.category}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{tx.description}</TableCell>
                      <TableCell className={`font-semibold ${tx.type === "income" ? "text-emerald-600" : "text-red-600"}`}>
                        {tx.type === "income" ? "+" : "-"} {tx.amount} {currency}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!transactions || transactions.length === 0) && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t("Aucune transaction enregistrée", "لا توجد معاملات مسجلة")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("Ajouter une transaction", "إضافة معاملة")}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label className="text-xs mb-1 block">{t("Type", "النوع")}</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">{t("Revenu", "دخل")}</SelectItem>
                  <SelectItem value="expense">{t("Dépense", "مصروف")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Catégorie", "الفئة")}</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Sélectionner...", "اختر...")} /></SelectTrigger>
                <SelectContent>
                  {["sales", "purchase", "salary", "rent", "utilities", "marketing", "other"].map((c) => (
                    <SelectItem key={c} value={c}>{categoryLabels[c] ?? c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t(`Montant (${currency})`, `المبلغ (${currency})`)}</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Date", "التاريخ")}</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs mb-1 block">{t("Description", "الوصف")}</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="h-8 text-sm" placeholder={t("Description succincte...", "وصف مختصر...")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Annuler", "إلغاء")}</Button>
            <Button onClick={handleSave} disabled={createTx.isPending || !form.amount || !form.category} data-testid="button-save-transaction">{t("Enregistrer", "حفظ")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

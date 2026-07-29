import React, { useState, useMemo } from "react";
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
import { Plus, TrendingUp, TrendingDown, DollarSign, X } from "lucide-react";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type TxForm = { type: string; category: string; amount: string; description: string; date: string };
const emptyForm: TxForm = { type: "income", category: "", amount: "", description: "", date: new Date().toISOString().slice(0, 10) };

// ─── Component ────────────────────────────────────────────────────────────────

export default function Accounting() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  // ── Remote data ──────────────────────────────────────────────────────────
  const { data: transactions, isLoading } = useGetTransactions();
  const { data: summary } = useGetAccountingSummary();
  const createTx = useCreateTransaction();

  // ── Create form ──────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TxForm>(emptyForm);

  // ── Filter state ─────────────────────────────────────────────────────────
  const [search,         setSearch]        = useState("");
  const [filterType,     setFilterType]    = useState("all");
  const [filterCategory, setFilterCat]     = useState("all");
  const [groupBy,        setGroupBy]       = useState<"jour" | "mois" | "annee">("jour");
  const [dateFrom,       setDateFrom]      = useState("");
  const [dateTo,         setDateTo]        = useState("");

  // ── Pagination state ─────────────────────────────────────────────────────
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // ── Labels ───────────────────────────────────────────────────────────────
  const txTypeLabels: Record<string, string> = {
    income:  t("Revenu", "دخل"),
    expense: t("Dépense", "مصروف"),
  };
  const categoryLabels: Record<string, string> = {
    sales:     t("Ventes",    "مبيعات"),
    purchase:  t("Achats",    "مشتريات"),
    salary:    t("Salaires",  "رواتب"),
    rent:      t("Loyer",     "إيجار"),
    utilities: t("Services",  "خدمات"),
    marketing: t("Marketing", "تسويق"),
    other:     t("Autre",     "أخرى"),
  };

  // ── Derived: sorted & filtered transactions ──────────────────────────────
  const sorted = useMemo(
    () => [...(transactions ?? [])].sort((a: Transaction, b: Transaction) => (a.date < b.date ? 1 : -1)),
    [transactions],
  );

  const filteredTx = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((tx: Transaction) => {
      if (filterType !== "all" && tx.type !== filterType) return false;
      if (filterCategory !== "all" && tx.category !== filterCategory) return false;
      if (q && !tx.description?.toLowerCase().includes(q) && !(tx.reference ?? "").toLowerCase().includes(q)) return false;
      if (dateFrom || dateTo) {
        if (groupBy === "jour") {
          const txDate = tx.date?.slice(0, 10) ?? "";
          if (dateFrom && txDate < dateFrom) return false;
          if (dateTo   && txDate > dateTo)   return false;
        } else if (groupBy === "mois") {
          const txMon = tx.date?.slice(0, 7) ?? "";
          if (dateFrom && txMon < dateFrom) return false;
          if (dateTo   && txMon > dateTo)   return false;
        } else {
          const txYr = tx.date?.slice(0, 4) ?? "";
          if (dateFrom && txYr < dateFrom) return false;
          if (dateTo   && txYr > dateTo)   return false;
        }
      }
      return true;
    });
  }, [sorted, filterType, filterCategory, search, groupBy, dateFrom, dateTo]);

  // ── Derived: filtered KPI ────────────────────────────────────────────────
  const isFiltered = filterType !== "all" || filterCategory !== "all" || dateFrom !== "" || dateTo !== "" || search.trim() !== "";

  const kpiIncome   = isFiltered ? filteredTx.filter((tx: Transaction) => tx.type === "income").reduce((s: number, tx: Transaction) => s + Number(tx.amount), 0) : Number(summary?.totalIncome ?? 0);
  const kpiExpenses = isFiltered ? filteredTx.filter((tx: Transaction) => tx.type === "expense").reduce((s: number, tx: Transaction) => s + Number(tx.amount), 0) : Number(summary?.totalExpenses ?? 0);
  const kpiBalance  = isFiltered ? kpiIncome - kpiExpenses : Number(summary?.netBalance ?? 0);

  // ── Derived: pagination ──────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredTx.length / pageSize));
  const pagedTx    = filteredTx.slice((page - 1) * pageSize, page * pageSize);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function resetFilters() {
    setSearch(""); setFilterType("all"); setFilterCat("all");
    setDateFrom(""); setDateTo(""); setPage(1);
  }
  function resetPage() { setPage(1); }
  function handleFilterChange<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); resetPage(); };
  }

  const hasFilters = isFiltered;

  const handleSave = () => {
    createTx.mutate(
      { data: { type: form.type as CreateTransactionRequestType, category: form.category as CreateTransactionRequestCategory, amount: form.amount, description: form.description, date: form.date } },
      { onSettled: () => { qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() }); setOpen(false); setForm(emptyForm); } }
    );
  };

  const kpiCards = [
    { labelFr: isFiltered ? "Revenus (filtrés)" : "Revenus totaux",   labelAr: isFiltered ? "الدخل (مصفى)"    : "إجمالي الدخل",       value: kpiIncome,   icon: TrendingUp,   color: "text-emerald-600" },
    { labelFr: isFiltered ? "Dépenses (filtrées)" : "Dépenses totales", labelAr: isFiltered ? "المصاريف (مصفى)" : "إجمالي المصروفات", value: kpiExpenses, icon: TrendingDown, color: "text-red-500" },
    { labelFr: isFiltered ? "Solde (filtré)" : "Solde net comptable",  labelAr: isFiltered ? "الرصيد (مصفى)"   : "رصيد الحساب الصافي", value: kpiBalance,  icon: DollarSign,   color: kpiBalance >= 0 ? "text-primary" : "text-destructive" },
  ];

  // ── Page numbers helper (like Products.tsx) ──────────────────────────────
  function buildPages(current: number, total: number): (number | "...")[] {
    const pages: (number | "...")[] = [];
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (current > 3) pages.push("...");
      for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
      if (current < total - 2) pages.push("...");
      pages.push(total);
    }
    return pages;
  }

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("Comptabilité", "المحاسبة")}</h1>
          <p className="text-sm text-muted-foreground">{t("Suivre les revenus et dépenses", "تتبع الدخل والمصروفات")}</p>
        </div>
        <Button onClick={() => setOpen(true)} data-testid="button-add-transaction">
          <Plus className="h-4 w-4 mr-2" /> {t("Ajouter une transaction", "إضافة معاملة")}
        </Button>
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────── */}
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

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <Card className="border shadow-sm">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-2 items-end">
            {/* Search */}
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs mb-1 block">{t("Recherche", "بحث")}</Label>
              <div className="relative">
                <Input
                  value={search}
                  onChange={(e) => handleFilterChange(setSearch)(e.target.value)}
                  placeholder={t("Description, référence…", "الوصف، المرجع…")}
                  className="h-8 text-sm pr-7"
                />
                {search && (
                  <button onClick={() => handleFilterChange(setSearch)("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Type */}
            <div className="w-36">
              <Label className="text-xs mb-1 block">{t("Type", "النوع")}</Label>
              <Select value={filterType} onValueChange={handleFilterChange(setFilterType)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("Tous", "الكل")}</SelectItem>
                  <SelectItem value="income">{t("Revenus", "دخل")}</SelectItem>
                  <SelectItem value="expense">{t("Dépenses", "مصروف")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Category */}
            <div className="w-40">
              <Label className="text-xs mb-1 block">{t("Catégorie", "الفئة")}</Label>
              <Select value={filterCategory} onValueChange={handleFilterChange(setFilterCat)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("Toutes", "الكل")}</SelectItem>
                  {Object.entries(categoryLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Période dropdown (style Dashboard Ventes) */}
            <div>
              <Label className="text-xs mb-1 block">{t("Période", "الفترة")}</Label>
              <select
                value={groupBy}
                onChange={(e) => {
                  setGroupBy(e.target.value as "jour" | "mois" | "annee");
                  setDateFrom(""); setDateTo(""); resetPage();
                }}
                className="h-8 border rounded-md px-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60 w-32"
              >
                <option value="jour">{t("Par jour", "يومياً")}</option>
                <option value="mois">{t("Par mois", "شهرياً")}</option>
                <option value="annee">{t("Par année", "سنوياً")}</option>
              </select>
            </div>

            {/* Début / Fin — always visible, type varies with Période */}
            <div>
              <Label className="text-xs mb-1 block">{t("Début", "البداية")}</Label>
              <Input
                type={groupBy === "mois" ? "month" : groupBy === "annee" ? "number" : "date"}
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); resetPage(); }}
                className="h-8 text-sm w-36"
                {...(groupBy === "annee" ? { min: 2000, max: 2099, placeholder: "2024" } : {})}
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Fin", "النهاية")}</Label>
              <Input
                type={groupBy === "mois" ? "month" : groupBy === "annee" ? "number" : "date"}
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); resetPage(); }}
                className="h-8 text-sm w-36"
                {...(groupBy === "annee" ? { min: 2000, max: 2099, placeholder: "2025" } : {})}
              />
            </div>

            {/* Reset */}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 text-xs gap-1 self-end">
                <X className="h-3.5 w-3.5" /> {t("Réinitialiser", "إعادة تعيين")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Transactions table ───────────────────────────────────────── */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("Transactions", "المعاملات")} ({filteredTx.length}{isFiltered ? ` / ${sorted.length}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Date", "التاريخ")}</TableHead>
                      <TableHead>{t("Type", "النوع")}</TableHead>
                      <TableHead>{t("Catégorie", "الفئة")}</TableHead>
                      <TableHead>{t("Description", "الوصف")}</TableHead>
                      <TableHead className="text-right">{t("Montant", "المبلغ")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedTx.map((tx: Transaction) => (
                      <TableRow key={tx.id} data-testid={`row-tx-${tx.id}`}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {(tx.createdAt ?? tx.date) ? format(new Date(tx.createdAt ?? tx.date), "dd/MM/yyyy HH:mm") : "—"}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${tx.type === "income" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                            {txTypeLabels[tx.type] ?? tx.type}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{categoryLabels[tx.category ?? ""] ?? tx.category}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{tx.description}</TableCell>
                        <TableCell className={`font-semibold text-right ${tx.type === "income" ? "text-emerald-600" : "text-red-600"}`}>
                          {tx.type === "income" ? "+" : "-"} {Number(tx.amount).toLocaleString()} {currency}
                        </TableCell>
                      </TableRow>
                    ))}
                    {pagedTx.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {isFiltered ? t("Aucun résultat pour ces filtres", "لا توجد نتائج لهذه الفلاتر") : t("Aucune transaction enregistrée", "لا توجد معاملات مسجلة")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* ── Pagination bar (style Articles / Products) ───────── */}
              <div className="flex items-center justify-between gap-4 flex-wrap px-4 py-3 border-t">
                <span className="text-sm text-muted-foreground">
                  {filteredTx.length === 0
                    ? t("Aucune transaction trouvée", "لا توجد معاملات")
                    : `${t("Affichage", "عرض")} ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredTx.length)} ${t("sur", "من")} ${filteredTx.length} ${t("transaction(s)", "معاملة")}`}
                </span>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{t("Lignes :", "الصفوف:")}</span>
                    <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                      <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50, 100, 200].map((n) => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline" size="sm" className="h-8 px-2 text-xs"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      ← Préc.
                    </Button>
                    {buildPages(page, totalPages).map((pg, i) =>
                      pg === "..." ? (
                        <span key={`e${i}`} className="px-1 text-muted-foreground text-xs select-none">…</span>
                      ) : (
                        <Button
                          key={pg}
                          variant={pg === page ? "default" : "outline"}
                          size="sm"
                          className={`h-8 w-8 p-0 text-xs ${pg === page ? "bg-[#1B3057] hover:bg-[#1B3057]/90" : ""}`}
                          onClick={() => setPage(pg as number)}
                        >
                          {pg}
                        </Button>
                      )
                    )}
                    <Button
                      variant="outline" size="sm" className="h-8 px-2 text-xs"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Suiv. →
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Create dialog ────────────────────────────────────────────── */}
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
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Sélectionner…", "اختر…")} /></SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
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
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="h-8 text-sm" placeholder={t("Description succincte…", "وصف مختصر…")} />
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

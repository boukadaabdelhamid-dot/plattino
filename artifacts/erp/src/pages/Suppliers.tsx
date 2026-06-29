import React, { useState } from "react";
import {
  useGetSuppliers, useCreateSupplier, useUpdateSupplier,
  useGetSupplierOperations, useCreateSupplierOperation,
  useGetErpStoresAll,
  getGetSuppliersQueryKey, getGetSupplierOperationsQueryKey,
} from "@workspace/api-client-react";
import type { Supplier, SupplierOperation } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { useStoreContext } from "@/hooks/use-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, CreditCard, TrendingDown, TrendingUp, FileText, RefreshCw, SlidersHorizontal, MoreVertical, Link2, Store } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// The generated Supplier type predates the global-account feature; extend locally.
type GlobalSupplier = Supplier & { globalSupplierId?: string | null };
type GlobalOperation = SupplierOperation & { runningBalance: string; storeNameAr?: string | null; storeNameEn?: string | null };
type StoreLite = { id: number; nameEn: string; nameAr: string; isActive?: boolean };

const fmt = (n: string | number | null | undefined) =>
  parseFloat(String(n ?? "0")).toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Payment Dialog ───────────────────────────────────────────────────────────
function PaymentDialog({
  supplier, open, onOpenChange,
}: { supplier: Supplier | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const createOp = useCreateSupplierOperation();

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const handlePay = () => {
    if (!supplier || !amount) return;
    createOp.mutate(
      { id: supplier.id, data: { amount: parseFloat(amount), date, reference: reference || undefined, note: note || undefined } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetSuppliersQueryKey() });
          qc.invalidateQueries({ queryKey: getGetSupplierOperationsQueryKey(supplier.id) });
          onOpenChange(false);
          setAmount(""); setReference(""); setNote("");
        },
        onError: (err) => alert(`Erreur: ${(err as Error).message}`),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-emerald-600" />
            {t("Règlement fournisseur", "تسديد المورد")}
          </DialogTitle>
        </DialogHeader>
        {supplier && (
          <div className="text-sm text-muted-foreground mb-2">
            {supplier.name} — {t("Solde actuel:", "الرصيد الحالي:")}
            <span className="font-bold text-rose-600 ml-1">{fmt(supplier.currentBalance)} DA</span>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1 block">{t("Montant (DA)", "المبلغ (دج)")}</Label>
            <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t("Date", "التاريخ")}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t("Référence", "المرجع")}</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t("Note", "ملاحظة")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
          </div>
        </div>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Annuler", "إلغاء")}</Button>
          <Button
            onClick={handlePay}
            disabled={createOp.isPending || !amount}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {t("Confirmer le règlement", "تأكيد التسديد")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ajustement Dialog ────────────────────────────────────────────────────────
function AjustementDialog({
  supplier, open, onOpenChange,
}: { supplier: Supplier | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  const [newBalance, setNewBalance] = React.useState("");
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (open) { setNewBalance(""); setDate(new Date().toISOString().slice(0, 10)); setNote(""); setError(""); }
  }, [open]);

  const handleAdjust = async () => {
    if (!supplier || newBalance === "") return;
    const parsed = parseFloat(newBalance);
    if (!Number.isFinite(parsed)) { setError(t("Valeur invalide", "قيمة غير صالحة")); return; }
    setLoading(true); setError("");
    try {
      const token = localStorage.getItem("midanic_token");
      const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
      const res = await fetch(`${apiBase}/api/erp/suppliers/${supplier.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetBalance: parsed, date, note: note || undefined }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erreur serveur"); }
      qc.invalidateQueries({ queryKey: getGetSuppliersQueryKey() });
      qc.invalidateQueries({ queryKey: getGetSupplierOperationsQueryKey(supplier.id) });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-amber-600" />
            {t("Ajustement de solde", "تعديل الرصيد")}
          </DialogTitle>
        </DialogHeader>
        {supplier && (
          <div className="text-sm text-muted-foreground mb-1 p-3 bg-amber-50 rounded-md border border-amber-100">
            <span className="font-medium">{supplier.name}</span>
            <br />
            {t("Solde actuel :", "الرصيد الحالي:")}
            <span className="font-bold ml-1 tabular-nums">{fmt(supplier.currentBalance)} DA</span>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1 block">{t("Nouveau solde (DA)", "الرصيد الجديد (دج)")}</Label>
            <Input
              type="number"
              step="0.01"
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              placeholder="0.00"
              className="h-9"
            />
            {newBalance !== "" && Number.isFinite(parseFloat(newBalance)) && supplier && (
              <p className="text-xs text-muted-foreground mt-1">
                {t("Écart :", "الفارق:")}
                {" "}
                <span className="font-medium tabular-nums">
                  {(parseFloat(newBalance) - parseFloat(supplier.currentBalance ?? "0")).toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA
                </span>
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t("Date", "التاريخ")}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">{t("Note (optionnel)", "ملاحظة (اختياري)")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
          </div>
          {error && <p className="text-xs text-rose-600 font-medium">{error}</p>}
        </div>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Annuler", "إلغاء")}</Button>
          <Button
            onClick={handleAdjust}
            disabled={loading || newBalance === ""}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {loading ? t("En cours…", "جارٍ التحديث…") : t("Confirmer", "تأكيد")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Import to Stores Dialog ──────────────────────────────────────────────────
function ImportDialog({
  supplier, open, onOpenChange,
}: { supplier: GlobalSupplier | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const { currentStoreId } = useStoreContext();
  const { data: allStores } = useGetErpStoresAll();

  const otherStores = ((allStores ?? []) as StoreLite[])
    .filter((s) => s.id !== currentStoreId && s.isActive !== false);

  const [selected, setSelected] = React.useState<number[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (open) { setSelected([]); setError(""); }
  }, [open]);

  const toggle = (id: number) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleImport = async () => {
    if (!supplier || selected.length === 0) return;
    setLoading(true); setError("");
    try {
      const token = localStorage.getItem("midanic_token");
      const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
      const res = await fetch(`${apiBase}/api/erp/suppliers/${supplier.id}/import-to-stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetStoreIds: selected }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Erreur serveur"); }
      qc.invalidateQueries({ queryKey: getGetSuppliersQueryKey() });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-4 w-4 text-indigo-600" />
            {t("Importer vers d'autres magasins", "استيراد إلى متاجر أخرى")}
          </DialogTitle>
        </DialogHeader>
        {supplier && (
          <div className="text-sm text-muted-foreground mb-1 p-3 bg-indigo-50 rounded-md border border-indigo-100">
            <span className="font-medium">{supplier.name}</span>
            <p className="text-xs mt-1">
              {t(
                "Le solde devient partagé : une opération dans n'importe quel magasin affecte le solde dans tous.",
                "يصبح الرصيد مشتركاً: أي عملية في أي متجر تؤثر على الرصيد في جميع المتاجر.",
              )}
            </p>
          </div>
        )}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {otherStores.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-4 text-center">
              {t("Aucun autre magasin disponible", "لا توجد متاجر أخرى متاحة")}
            </p>
          ) : (
            otherStores.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-3 p-2 rounded-md border hover:bg-slate-50 cursor-pointer"
              >
                <Checkbox
                  checked={selected.includes(s.id)}
                  onCheckedChange={() => toggle(s.id)}
                />
                <span className="text-sm font-medium">{lang === "ar" ? s.nameAr : s.nameEn}</span>
              </label>
            ))
          )}
        </div>
        {error && <p className="text-xs text-rose-600 font-medium">{error}</p>}
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Annuler", "إلغاء")}</Button>
          <Button
            onClick={handleImport}
            disabled={loading || selected.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {loading ? t("En cours…", "جارٍ…") : t("Importer", "استيراد")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Statement Sheet ──────────────────────────────────────────────────────────
function StatementSheet({
  supplier, open, onOpenChange,
}: { supplier: Supplier | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const qc = useQueryClient();
  const linked = !!(supplier as GlobalSupplier | null)?.globalSupplierId;
  const { data, isLoading } = useGetSupplierOperations(supplier?.id ?? 0, {
    query: { enabled: open && !!supplier, queryKey: getGetSupplierOperationsQueryKey(supplier?.id ?? 0) },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 overflow-y-auto">
        <SheetHeader className="px-5 py-4 border-b bg-[#1B3057] text-white">
          <SheetTitle className="text-white flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t("Relevé de compte", "كشف حساب")} — {supplier?.name ?? ""}
            </span>
            <Button
              size="icon" variant="ghost"
              className="h-7 w-7 text-white hover:bg-white/20"
              onClick={() => { if (supplier) qc.invalidateQueries({ queryKey: getGetSupplierOperationsQueryKey(supplier.id) }); }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </SheetTitle>
        </SheetHeader>

        {supplier && (
          <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("Solde actuel", "الرصيد الحالي")}</span>
            <span className={`font-bold text-lg ${parseFloat(supplier.currentBalance) > 0 ? "text-rose-600" : "text-emerald-600"}`}>
              {fmt(supplier.currentBalance)} DA
            </span>
          </div>
        )}

        <div className="p-4">
          {isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="font-semibold">{t("Date", "التاريخ")}</TableHead>
                    {linked && <TableHead className="font-semibold">{t("Magasin", "المتجر")}</TableHead>}
                    <TableHead className="font-semibold">{t("Type", "النوع")}</TableHead>
                    <TableHead className="font-semibold">{t("Référence / Note", "المرجع / ملاحظة")}</TableHead>
                    <TableHead className="font-semibold text-right">{t("Débit", "دين")}</TableHead>
                    <TableHead className="font-semibold text-right">{t("Crédit", "دائن")}</TableHead>
                    <TableHead className="font-semibold text-right">{t("Solde", "الرصيد")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!data?.operations || data.operations.length === 0) ? (
                    <TableRow>
                      <TableCell colSpan={linked ? 7 : 6} className="text-center py-8 text-muted-foreground italic">
                        {t("Aucune opération", "لا توجد عمليات")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    (data.operations as GlobalOperation[]).map((op) => (
                      <TableRow key={op.id}>
                        <TableCell className="text-sm tabular-nums">{op.date}</TableCell>
                        {linked && (
                          <TableCell className="text-xs text-muted-foreground">
                            {(lang === "ar" ? op.storeNameAr : op.storeNameEn) ?? "—"}
                          </TableCell>
                        )}
                        <TableCell>
                          {op.type === "purchase" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                              <TrendingUp className="h-3 w-3" />
                              {t("Achat", "شراء")}
                            </span>
                          ) : op.type === "ajustement" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                              <SlidersHorizontal className="h-3 w-3" />
                              {t("Ajustement", "تعديل")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                              <TrendingDown className="h-3 w-3" />
                              {t("Règlement", "تسديد")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={op.reference ?? op.note ?? undefined}>
                          {op.reference ?? op.note ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-rose-600">
                          {op.type === "purchase"
                            ? fmt(op.amount)
                            : op.type === "ajustement" && parseFloat(op.amount ?? "0") < 0
                            ? fmt(Math.abs(parseFloat(op.amount ?? "0")))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-emerald-600">
                          {op.type === "payment"
                            ? fmt(op.amount)
                            : op.type === "ajustement" && parseFloat(op.amount ?? "0") >= 0
                            ? fmt(op.amount)
                            : "—"}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums font-bold ${parseFloat(op.runningBalance) > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {fmt(op.runningBalance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Supplier Form Dialog ─────────────────────────────────────────────────────
type SupplierForm = { name: string; contactName: string; email: string; phone: string; address: string; notes: string; };
const emptyForm: SupplierForm = { name: "", contactName: "", email: "", phone: "", address: "", notes: "" };

// ─── Main Suppliers Page ──────────────────────────────────────────────────────
export default function Suppliers() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const { data: suppliers, isLoading } = useGetSuppliers();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();

  const [filterName, setFilterName] = useState("");
  const [filterContact, setFilterContact] = useState("");
  const [filterEmail, setFilterEmail] = useState("");
  const [filterPhone, setFilterPhone] = useState("");
  const [filterBalance, setFilterBalance] = useState("");

  const filteredSuppliers = (suppliers ?? []).filter((s: Supplier) => {
    if (filterName && !s.name?.toLowerCase().includes(filterName.toLowerCase())) return false;
    if (filterContact && !s.contactName?.toLowerCase().includes(filterContact.toLowerCase())) return false;
    if (filterEmail && !s.email?.toLowerCase().includes(filterEmail.toLowerCase())) return false;
    if (filterPhone && !s.phone?.toLowerCase().includes(filterPhone.toLowerCase())) return false;
    if (filterBalance && !String(parseFloat(s.currentBalance ?? "0").toFixed(2)).includes(filterBalance)) return false;
    return true;
  });

  const [dialog, setDialog] = useState<{ open: boolean; editing: Supplier | null }>({ open: false, editing: null });
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [adjustSupplier, setAdjustSupplier] = useState<Supplier | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [importSupplier, setImportSupplier] = useState<GlobalSupplier | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const openCreate = () => { setForm(emptyForm); setDialog({ open: true, editing: null }); };
  const openEdit = (s: Supplier) => {
    setForm({ name: s.name ?? "", contactName: s.contactName ?? "", email: s.email ?? "", phone: s.phone ?? "", address: s.address ?? "", notes: s.notes ?? "" });
    setDialog({ open: true, editing: s });
  };
  const openStatement = (s: Supplier) => { setStatementSupplier(s); setStatementOpen(true); };
  const openPayment = (s: Supplier) => { setPaymentSupplier(s); setPaymentOpen(true); };
  const openAdjust = (s: Supplier) => { setAdjustSupplier(s); setAdjustOpen(true); };
  const openImport = (s: GlobalSupplier) => { setImportSupplier(s); setImportOpen(true); };

  const handleSave = () => {
    const onSettled = () => { qc.invalidateQueries({ queryKey: getGetSuppliersQueryKey() }); setDialog({ open: false, editing: null }); };
    if (dialog.editing) {
      updateSupplier.mutate({ id: dialog.editing.id, data: form }, { onSettled });
    } else {
      createSupplier.mutate({ data: form }, { onSettled });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("Fournisseurs", "الموردون")}</h1>
          <p className="text-sm text-muted-foreground">{t("Gérer votre réseau de fournisseurs", "إدارة شبكة الموردين")}</p>
        </div>
        <Button onClick={openCreate} className="bg-[#1B3057] hover:bg-[#142441]" data-testid="button-add-supplier">
          <Plus className="h-4 w-4 mr-2" /> {t("Ajouter un fournisseur", "إضافة مورد")}
        </Button>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="font-semibold">{t("Nom", "الاسم")}</TableHead>
                    <TableHead className="font-semibold">{t("Contact", "جهة الاتصال")}</TableHead>
                    <TableHead className="font-semibold">Email</TableHead>
                    <TableHead className="font-semibold">{t("Téléphone", "الهاتف")}</TableHead>
                    <TableHead className="font-semibold text-right">{t("Solde (DA)", "الرصيد (دج)")}</TableHead>
                    <TableHead className="font-semibold text-center">{t("Actions", "الإجراءات")}</TableHead>
                  </TableRow>
                  <TableRow className="bg-white border-b">
                    <TableHead className="py-1 px-2">
                      <Input value={filterName} onChange={(e) => setFilterName(e.target.value)} placeholder={t("Filtre...", "بحث...")} className="h-7 text-xs" />
                    </TableHead>
                    <TableHead className="py-1 px-2">
                      <Input value={filterContact} onChange={(e) => setFilterContact(e.target.value)} placeholder={t("Filtre...", "بحث...")} className="h-7 text-xs" />
                    </TableHead>
                    <TableHead className="py-1 px-2">
                      <Input value={filterEmail} onChange={(e) => setFilterEmail(e.target.value)} placeholder={t("Filtre...", "بحث...")} className="h-7 text-xs" />
                    </TableHead>
                    <TableHead className="py-1 px-2">
                      <Input value={filterPhone} onChange={(e) => setFilterPhone(e.target.value)} placeholder={t("Filtre...", "بحث...")} className="h-7 text-xs" />
                    </TableHead>
                    <TableHead className="py-1 px-2">
                      <Input value={filterBalance} onChange={(e) => setFilterBalance(e.target.value)} placeholder={t("Filtre...", "بحث...")} className="h-7 text-xs text-right" />
                    </TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSuppliers.map((s: Supplier) => {
                    const balance = parseFloat(s.currentBalance ?? "0");
                    return (
                      <TableRow key={s.id} data-testid={`row-supplier-${s.id}`} className="hover:bg-slate-50/70">
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {s.name}
                            {(s as GlobalSupplier).globalSupplierId && (
                              <span
                                className="inline-flex items-center text-indigo-600"
                                title={t("Compte partagé entre magasins", "حساب مشترك بين المتاجر")}
                              >
                                <Link2 className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{s.contactName ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{s.email ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{s.phone ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={`font-bold ${balance > 0 ? "text-rose-600" : balance < 0 ? "text-emerald-600" : "text-slate-500"}`}>
                            {fmt(balance)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(s)}>
                                <Pencil className="h-4 w-4 mr-2 text-slate-600" />
                                {t("Modifier", "تعديل")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openStatement(s)}>
                                <FileText className="h-4 w-4 mr-2 text-blue-600" />
                                {t("Relevé de compte", "كشف الحساب")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openPayment(s)}>
                                <CreditCard className="h-4 w-4 mr-2 text-emerald-600" />
                                {t("Règlement", "تسديد")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openAdjust(s)}>
                                <SlidersHorizontal className="h-4 w-4 mr-2 text-amber-600" />
                                {t("Ajustement de solde", "تعديل الرصيد")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openImport(s as GlobalSupplier)}>
                                <Store className="h-4 w-4 mr-2 text-indigo-600" />
                                {t("Importer vers d'autres magasins", "استيراد إلى متاجر أخرى")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredSuppliers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {t("Aucun fournisseur", "لا يوجد موردون")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog.editing ? t("Modifier le fournisseur", "تعديل المورد") : t("Ajouter un fournisseur", "إضافة مورد")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {[
              { label: t("Raison sociale", "اسم الشركة"), key: "name", full: true },
              { label: t("Personne de contact", "جهة الاتصال"), key: "contactName" },
              { label: "Email", key: "email" },
              { label: t("Téléphone", "الهاتف"), key: "phone" },
              { label: t("Adresse", "العنوان"), key: "address", full: true },
              { label: t("Notes", "ملاحظات"), key: "notes", full: true },
            ].map(({ label, key, full }) => (
              <div key={key} className={full ? "col-span-2" : ""}>
                <Label className="text-xs mb-1 block">{label}</Label>
                <Input
                  value={(form as any)[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, editing: null })}>{t("Annuler", "إلغاء")}</Button>
            <Button
              onClick={handleSave}
              disabled={createSupplier.isPending || updateSupplier.isPending}
              data-testid="button-save-supplier"
            >
              {t("Enregistrer", "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Statement Sheet */}
      <StatementSheet
        supplier={statementSupplier}
        open={statementOpen}
        onOpenChange={setStatementOpen}
      />

      {/* Payment Dialog */}
      <PaymentDialog
        supplier={paymentSupplier}
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
      />

      {/* Ajustement Dialog */}
      <AjustementDialog
        supplier={adjustSupplier}
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
      />

      {/* Import to Stores Dialog */}
      <ImportDialog
        supplier={importSupplier}
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  );
}

import React, { useState, useMemo } from "react";
import {
  useGetAdminRetours, useCreateBonRetour, getGetAdminRetoursQueryKey,
  useGetAdminRetour, getGetAdminRetourQueryKey, useCreateStandaloneRetour,
  useGetProducts, useGetErpCustomers, useGetOrder, getGetOrderQueryKey,
  type BonRetourDetailItemsItem, type Product, type CustomerSummary,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RotateCcw, Plus, Printer, Trash2, ChevronsUpDown, Check, User, Search, ShoppingBag } from "lucide-react";
import { format } from "date-fns";
import InvoiceDialog from "@/components/InvoiceDialog";
import type { InvoiceData } from "@/components/InvoiceTemplate";
import { useCurrentStore } from "@/hooks/use-current-store";
import { ProductPickerDialog } from "@/components/pos/ProductPickerDialog";

type CustomerSaleItem = {
  productId: number;
  productNameEn: string | null;
  productNameAr: string | null;
  unitPrice: string;
  quantity: number;
  returnedQty: number;
  orderId: number;
  orderDate: string;
  orderSource: string;
};

type RetourLine = {
  productId: number;
  designation: string;
  qty: number;
  pu: number;
};

export default function Retours() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const [showNouveauRetour, setShowNouveauRetour] = useState(false);
  const [printRetourId, setPrintRetourId] = useState<number | null>(null);
  const qc = useQueryClient();

  const handleCreated = (id: number) => {
    setPrintRetourId(id);
    qc.invalidateQueries({ queryKey: getGetAdminRetoursQueryKey() });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <RotateCcw className="h-6 w-6 text-amber-600" />
            {t("Retours", "المرتجعات")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("Gestion des bons de retour", "إدارة وصولات الإرجاع")}
          </p>
        </div>
        <Button
          className="bg-amber-600 hover:bg-amber-700 text-white"
          onClick={() => setShowNouveauRetour(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t("Nouveau retour", "إرجاع جديد")}
        </Button>
      </div>

      <RetoursHistory
        onPrint={(id) => setPrintRetourId(id)}
        onNewRetour={() => setShowNouveauRetour(true)}
      />

      <NouveauRetourDialog
        open={showNouveauRetour}
        onOpenChange={setShowNouveauRetour}
        onCreated={handleCreated}
      />

      <RetourPrintDialog
        retourId={printRetourId}
        open={!!printRetourId}
        onOpenChange={(o) => { if (!o) setPrintRetourId(null); }}
      />
    </div>
  );
}

export function RetourPrintDialog({ retourId, open, onOpenChange }: {
  retourId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const store = useCurrentStore();
  const [showTva, setShowTva] = useState(false);

  const { data: retour } = useGetAdminRetour(retourId ?? 0, {
    query: { enabled: open && !!retourId, queryKey: getGetAdminRetourQueryKey(retourId ?? 0) },
  });

  const invoiceData: InvoiceData | null = React.useMemo(() => {
    if (!retour || !retourId) return null;
    const items: BonRetourDetailItemsItem[] = retour.items ?? [];
    return {
      kind: "retour",
      number: `RT-${String(retour.id).padStart(6, "0")}`,
      date: retour.createdAt ? new Date(retour.createdAt) : new Date(),
      store,
      party: {
        name: retour.clientName ?? t("Client anonyme", "عميل مجهول"),
        address: "",
        phone: "",
      },
      lines: items.map((it) => ({
        designation: (it.product?.nameEn || it.product?.nameAr || "—").toUpperCase(),
        reference: it.product?.reference ?? it.product?.barcode ?? null,
        qty: it.quantity ?? 0,
        unitPrice: parseFloat(it.unitPrice ?? "0"),
      })),
      showTva,
      tvaRate: parseFloat(store?.tvaRate ?? "19"),
    };
  }, [retour, retourId, store, showTva, t]);

  return (
    <InvoiceDialog
      open={open}
      onOpenChange={onOpenChange}
      data={invoiceData}
      onShowTvaChange={setShowTva}
    />
  );
}

function RetoursHistory({ onPrint, onNewRetour }: {
  onPrint: (id: number) => void;
  onNewRetour: () => void;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const { data: retours, isLoading } = useGetAdminRetours();
  const [filterRetour, setFilterRetour] = useState("");
  const [filterCommande, setFilterCommande] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterType, setFilterType] = useState<"all" | "remboursement" | "sans_remboursement">("all");
  const [filterDate, setFilterDate] = useState("");

  const filteredRetours = useMemo(() => {
    if (!retours) return [];
    return retours.filter((r) => {
      if (filterRetour && !String(r.id).includes(filterRetour)) return false;
      if (filterCommande && !String(r.originalOrderId ?? "").includes(filterCommande)) return false;
      if (filterClient && !((r.clientName ?? "").toLowerCase().includes(filterClient.toLowerCase()))) return false;
      if (filterType !== "all" && r.retourType !== filterType) return false;
      if (filterDate && r.createdAt && !r.createdAt.startsWith(filterDate)) return false;
      return true;
    });
  }, [retours, filterRetour, filterCommande, filterClient, filterType, filterDate]);

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {t("Historique des retours", "سجل الإرجاعات")} ({retours?.length ?? 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Filter row */}
        <div className="flex flex-wrap gap-2 p-4 border-b bg-muted/30">
          <Input
            placeholder={t("N° Retour", "رقم الإرجاع")}
            value={filterRetour}
            onChange={(e) => setFilterRetour(e.target.value)}
            className="h-8 text-xs w-28"
          />
          <Input
            placeholder={t("N° Commande", "رقم الطلب")}
            value={filterCommande}
            onChange={(e) => setFilterCommande(e.target.value)}
            className="h-8 text-xs w-32"
          />
          <Input
            placeholder={t("Client", "العميل")}
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="h-8 text-xs w-36"
          />
          <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
            <SelectTrigger className="h-8 text-xs w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Tous les types", "جميع الأنواع")}</SelectItem>
              <SelectItem value="remboursement">{t("Remboursement", "مع استرداد")}</SelectItem>
              <SelectItem value="sans_remboursement">{t("Sans remboursement", "بدون استرداد")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="h-8 text-xs w-36"
          />
        </div>

        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{t("N° Retour", "رقم")}</TableHead>
                  <TableHead className="text-xs">{t("Commande", "الطلب")}</TableHead>
                  <TableHead className="text-xs">{t("Client", "العميل")}</TableHead>
                  <TableHead className="text-xs">{t("Articles", "المنتجات")}</TableHead>
                  <TableHead className="text-xs">{t("Montant", "المبلغ")}</TableHead>
                  <TableHead className="text-xs">{t("Type", "النوع")}</TableHead>
                  <TableHead className="text-xs">{t("Motif", "السبب")}</TableHead>
                  <TableHead className="text-xs">{t("Date", "التاريخ")}</TableHead>
                  <TableHead className="text-xs text-right">{t("Imprimer", "طباعة")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRetours.map((retour) => {
                  const items: BonRetourDetailItemsItem[] = retour.items ?? [];
                  const total = items.reduce(
                    (s, i) => s + (i.quantity ?? 0) * parseFloat(i.unitPrice ?? "0"),
                    0
                  );
                  return (
                    <TableRow key={retour.id}>
                      <TableCell className="text-sm font-medium text-amber-700">
                        #{retour.id}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {retour.originalOrderId ? `#${retour.originalOrderId}` : <span className="italic">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">{retour.clientName ?? <span className="italic text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(() => {
                          if (!items.length) return <span className="italic text-xs">—</span>;
                          const names = items.map((i) => i.product?.nameEn || i.product?.nameAr || "—").join(", ");
                          return <span className="truncate max-w-[180px] block">{names}</span>;
                        })()}
                      </TableCell>
                      <TableCell className="text-sm font-semibold">
                        {total > 0 ? `${total.toFixed(2)} ${currency}` : <span className="italic text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {retour.retourType === "remboursement" ? (
                          <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">
                            {t("Remboursement", "استرداد")}
                          </span>
                        ) : retour.retourType === "sans_remboursement" ? (
                          <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-gray-100 text-gray-700 border-gray-200">
                            {t("Sans remboursement", "بدون استرداد")}
                          </span>
                        ) : (
                          <span className="italic text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">
                        {retour.reason ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {retour.createdAt ? format(new Date(retour.createdAt), "dd/MM/yyyy HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="h-8 text-xs"
                          onClick={() => onPrint(retour.id)}>
                          <Printer className="h-3.5 w-3.5 mr-1" /> {t("Bon", "وصل")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredRetours.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      {(filterRetour || filterCommande || filterClient || filterType !== "all" || filterDate)
                        ? t("Aucun retour trouvé", "لا توجد نتائج")
                        : t("Aucun retour enregistré", "لا توجد إرجاعات مسجلة")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClotureRetourModal({ open, onOpenChange, onConfirm, isPending }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (retourType: string) => void;
  isPending: boolean;
}) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const [selected, setSelected] = useState<"remboursement" | "sans_remboursement" | null>(null);

  React.useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-amber-600" />
            {t("Clôturer le Bon de Retour", "إغلاق وصل الإرجاع")}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("Choisissez le mode de traitement de ce retour :", "اختر طريقة معالجة هذا الإرجاع:")}
        </p>

        <div className="grid grid-cols-2 gap-3 py-2">
          <button
            type="button"
            onClick={() => setSelected("remboursement")}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all text-center ${
              selected === "remboursement"
                ? "border-emerald-500 bg-emerald-50"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <span className="text-2xl">💰</span>
            <span className="text-sm font-semibold text-emerald-700">
              {t("Remboursement", "استرداد المبلغ")}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelected("sans_remboursement")}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all text-center ${
              selected === "sans_remboursement"
                ? "border-gray-500 bg-gray-100"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <span className="text-2xl">🔄</span>
            <span className="text-sm font-semibold text-gray-700">
              {t("Sans remboursement", "بدون استرداد")}
            </span>
          </button>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t("Annuler", "إلغاء")}
          </Button>
          <Button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || isPending}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isPending ? t("Enregistrement...", "جاري الحفظ...") : t("Confirmer", "تأكيد")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NouveauRetourDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  const { data: productsResp } = useGetProducts({ limit: 500 });
  const products: Product[] = useMemo(() => (productsResp?.products ?? []) as Product[], [productsResp]);

  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  const { data: extraBarcodesData = [] } = useQuery<{ barcode: string; productId: number }[]>({
    queryKey: ["extra-barcodes-all"],
    queryFn: async () => {
      const token = localStorage.getItem("midanic_token");
      const r = await fetch(`${apiBase}/api/erp/products/extra-barcodes`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!r.ok) return [];
      return r.json() as Promise<{ barcode: string; productId: number }[]>;
    },
    staleTime: 60_000,
  });
  const extraBarcodesMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const { barcode, productId } of extraBarcodesData) m.set(barcode.toLowerCase(), productId);
    return m;
  }, [extraBarcodesData]);

  const [lines, setLines] = useState<RetourLine[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [clientComboOpen, setClientComboOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [saleItemSearch, setSaleItemSearch] = useState("");
  const [reason, setReason] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientPickerRef = React.useRef<HTMLDivElement>(null);

  // Fetch past purchase items only when a real named customer is selected
  const hasRealCustomer = !!(selectedCustomer && selectedCustomer.id !== 0);
  const { data: customerSaleItems = [], isLoading: saleItemsLoading } = useQuery<CustomerSaleItem[]>({
    queryKey: ["customer-sale-items", selectedCustomer?.id],
    queryFn: async () => {
      const token = localStorage.getItem("midanic_token");
      const r = await fetch(`${apiBase}/api/erp/customers/${selectedCustomer!.id}/sale-items`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!r.ok) return [];
      return r.json() as Promise<CustomerSaleItem[]>;
    },
    enabled: hasRealCustomer,
    staleTime: 30_000,
  });

  const filteredSaleItems = useMemo(() => {
    const q = saleItemSearch.trim().toLowerCase();
    if (!q) return customerSaleItems;
    return customerSaleItems.filter((item) =>
      (item.productNameEn ?? "").toLowerCase().includes(q) ||
      (item.productNameAr ?? "").toLowerCase().includes(q)
    );
  }, [customerSaleItems, saleItemSearch]);

  const { data: _custRes } = useGetErpCustomers(
    clientSearch.trim().length > 0 ? { search: clientSearch.trim(), limit: 20 } : { limit: 20 }
  );
  const customerResults = _custRes?.data ?? [];

  const createRetour = useCreateStandaloneRetour();
  const [clotureOpen, setClotureOpen] = useState(false);

  React.useEffect(() => {
    if (open) {
      setLines([]);
      setSelectedCustomer(null);
      setClientSearch("");
      setClientComboOpen(false);
      setSaleItemSearch("");
      setReason("");
      setError(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!clientComboOpen) return;
    const handler = (e: MouseEvent) => {
      if (clientPickerRef.current && !clientPickerRef.current.contains(e.target as Node)) {
        setClientComboOpen(false);
        setClientSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [clientComboOpen]);

  const addProduct = (p: Product) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [
        ...prev,
        {
          productId: p.id,
          designation: (lang === "ar" ? (p.nameAr || p.nameEn) : (p.nameEn || p.nameAr) || `#${p.id}`).toUpperCase(),
          qty: 1,
          pu: parseFloat(p.price ?? "0"),
        },
      ];
    });
    setPickerOpen(false);
  };

  const addFromSaleItem = (item: CustomerSaleItem) => {
    const returnableQty = Math.max(0, item.quantity - (item.returnedQty ?? 0));
    if (returnableQty === 0) return;
    const designation = (lang === "ar"
      ? (item.productNameAr || item.productNameEn)
      : (item.productNameEn || item.productNameAr) || `#${item.productId}`
    )!.toUpperCase();
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === item.productId);
      if (idx >= 0) {
        // already in list — increment by returnable qty
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + returnableQty };
        return next;
      }
      return [
        ...prev,
        {
          productId: item.productId,
          designation,
          qty: returnableQty,
          pu: parseFloat(item.unitPrice),
        },
      ];
    });
  };

  const removeLine = (productId: number) => setLines((prev) => prev.filter((l) => l.productId !== productId));
  const setQty = (productId: number, qty: number) => {
    if (qty < 1) return;
    setLines((prev) => prev.map((l) => l.productId === productId ? { ...l, qty } : l));
  };
  const setPu = (productId: number, pu: number) => {
    if (pu < 0) return;
    setLines((prev) => prev.map((l) => l.productId === productId ? { ...l, pu } : l));
  };

  const total = lines.reduce((s, l) => s + l.pu * l.qty, 0);

  const handleCloture = () => {
    setError(null);
    if (lines.length === 0) {
      setError(t("Ajoutez au moins un article.", "أضف منتجاً واحداً على الأقل."));
      return;
    }
    setClotureOpen(true);
  };

  const handleClotureConfirm = (retourType: string) => {
    createRetour.mutate(
      {
        data: {
          clientUserId: (selectedCustomer && selectedCustomer.id !== 0) ? selectedCustomer.id : undefined,
          reason: reason.trim() || undefined,
          retourType,
          items: lines.map((l) => ({ productId: l.productId, quantity: l.qty, unitPrice: l.pu })),
        },
      },
      {
        onSuccess: (data) => {
          qc.invalidateQueries({ queryKey: getGetAdminRetoursQueryKey() });
          setClotureOpen(false);
          const id = (data as { id?: number }).id;
          if (id) onCreated(id);
          else onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(msg ?? t("Une erreur est survenue.", "حدث خطأ، حاول مجدداً."));
          setClotureOpen(false);
        },
      }
    );
  };

  return (
    <>
      <ClotureRetourModal
        open={clotureOpen}
        onOpenChange={setClotureOpen}
        onConfirm={handleClotureConfirm}
        isPending={createRetour.isPending}
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-600" />
              {t("Nouveau Bon de Retour", "وصل إرجاع جديد")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("Client (optionnel)", "العميل (اختياري)")}</Label>
                <div className="relative" ref={clientPickerRef}>
                  <button
                    type="button"
                    onClick={() => setClientComboOpen((v) => !v)}
                    className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 h-9 text-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <span className={selectedCustomer ? "text-foreground font-medium" : "text-muted-foreground"}>
                      {selectedCustomer ? selectedCustomer.name : t("Sélectionner un client...", "اختر عميلاً...")}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                  {clientComboOpen && (
                    <div className="absolute z-50 top-full mt-1 left-0 right-0 min-w-[280px] bg-popover border rounded-md shadow-lg overflow-hidden">
                      <div className="flex items-center border-b px-3">
                        <input
                          autoFocus
                          className="flex h-9 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                          placeholder={t("Rechercher...", "بحث...")}
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {!clientSearch.trim() && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent border-b cursor-pointer"
                            onClick={() => { setSelectedCustomer({ id: 0, name: "DIVERS COMPTOIR", email: "" }); setClientComboOpen(false); setClientSearch(""); }}
                          >
                            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="flex flex-col min-w-0 text-left">
                              <span className="font-semibold truncate">DIVERS COMPTOIR</span>
                              <span className="text-xs text-muted-foreground">{t("Client par défaut", "عميل افتراضي")}</span>
                            </div>
                            {(!selectedCustomer || selectedCustomer.id === 0) && <Check className="ml-auto h-4 w-4 text-primary shrink-0" />}
                          </button>
                        )}
                        {customerResults.length === 0 && clientSearch.trim() && (
                          <div className="py-4 text-center text-sm text-muted-foreground">
                            {t("Aucun client trouvé", "لم يتم العثور على عميل")}
                          </div>
                        )}
                        {customerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent border-b cursor-pointer"
                            onClick={() => { setSelectedCustomer(c); setClientComboOpen(false); setClientSearch(""); }}
                          >
                            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="flex flex-col min-w-0 text-left">
                              <span className="font-medium truncate">{c.name}</span>
                              {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                            </div>
                            {selectedCustomer?.id === c.id && <Check className="ml-auto h-4 w-4 text-primary shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("Motif du retour (optionnel)", "سبب الإرجاع (اختياري)")}</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("Ex: article défectueux...", "مثال: منتج معيب...")}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            {/* ── Customer past purchases panel ── */}
            {hasRealCustomer ? (
              <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b">
                  <span className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    {t("Achats de ce client", "مشتريات هذا الزبون")}
                    {customerSaleItems.length > 0 && (
                      <span className="text-amber-600 font-normal">({customerSaleItems.length})</span>
                    )}
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100"
                    onClick={() => setPickerOpen(true)}>
                    <Plus className="h-3 w-3 mr-1" /> {t("Autre article", "منتج آخر")}
                  </Button>
                </div>

                {/* Search */}
                <div className="px-3 py-2 border-b bg-white">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={saleItemSearch}
                      onChange={(e) => setSaleItemSearch(e.target.value)}
                      placeholder={t("Rechercher un produit acheté...", "البحث عن منتج تم شراؤه...")}
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                </div>

                {/* Items list */}
                <div className="max-h-48 overflow-y-auto">
                  {saleItemsLoading ? (
                    <div className="p-3 space-y-2">
                      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                    </div>
                  ) : filteredSaleItems.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      {saleItemSearch
                        ? t("Aucun produit trouvé", "لم يتم العثور على منتج")
                        : t("Aucun achat trouvé pour ce client", "لا توجد مشتريات لهذا الزبون")}
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60 border-b">
                        <tr>
                          <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wide">{t("Produit", "المنتج")}</th>
                          <th className="text-center px-2 py-1.5 font-semibold text-muted-foreground uppercase tracking-wide w-20">{t("Vendue", "مباعة")}</th>
                          <th className="text-center px-2 py-1.5 font-semibold text-muted-foreground uppercase tracking-wide w-20">{t("Retournée", "مُرجعة")}</th>
                          <th className="text-center px-2 py-1.5 font-semibold text-muted-foreground uppercase tracking-wide w-20">{t("Restante", "متبقية")}</th>
                          <th className="text-right px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wide w-24">{t("Prix payé", "السعر المدفوع")}</th>
                          <th className="w-20 px-2 py-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSaleItems.map((item, idx) => {
                          const name = lang === "ar"
                            ? (item.productNameAr || item.productNameEn || `#${item.productId}`)
                            : (item.productNameEn || item.productNameAr || `#${item.productId}`);
                          const returnedQty = item.returnedQty ?? 0;
                          const returnableQty = Math.max(0, item.quantity - returnedQty);
                          const exhausted = returnableQty === 0;
                          const alreadyAdded = lines.some((l) => l.productId === item.productId);
                          return (
                            <tr key={`${item.orderId}-${item.productId}-${idx}`}
                              className={`border-b last:border-0 transition-colors ${exhausted ? "opacity-50 bg-gray-50" : "hover:bg-amber-50/50"}`}>
                              <td className="px-3 py-2">
                                <div className="font-medium truncate max-w-[180px]">{name}</div>
                                <div className="text-muted-foreground text-[10px]">
                                  {item.orderSource === "pos" ? "VR" : "BV"}-{String(item.orderId).padStart(5, "0")}
                                  {" · "}{item.orderDate ? format(new Date(item.orderDate), "dd/MM/yy") : "—"}
                                </div>
                              </td>
                              <td className="text-center px-2 py-2 font-semibold">{item.quantity}</td>
                              <td className="text-center px-2 py-2 text-red-600 font-medium">
                                {returnedQty > 0 ? returnedQty : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="text-center px-2 py-2">
                                <span className={`font-semibold ${exhausted ? "text-gray-400" : "text-emerald-700"}`}>
                                  {returnableQty}
                                </span>
                              </td>
                              <td className="text-right px-3 py-2 text-muted-foreground">
                                {parseFloat(item.unitPrice).toFixed(2)} {currency}
                              </td>
                              <td className="px-2 py-2 text-right">
                                <button
                                  type="button"
                                  disabled={exhausted}
                                  onClick={() => !exhausted && addFromSaleItem(item)}
                                  className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border transition-colors ${
                                    exhausted
                                      ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                      : alreadyAdded
                                        ? "border-amber-400 bg-amber-100 text-amber-700 hover:bg-amber-200"
                                        : "border-amber-300 bg-white text-amber-700 hover:bg-amber-50"
                                  }`}
                                >
                                  <Plus className="h-2.5 w-2.5" />
                                  {exhausted ? t("Épuisé", "مُكتمل") : alreadyAdded ? t("+Ajouter", "+إضافة") : t("Ajouter", "إضافة")}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("Articles", "المنتجات")} ({lines.length})</span>
                <Button size="sm" variant="outline" className="h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={() => setPickerOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> {t("Ajouter article", "إضافة منتج")}
                </Button>
              </div>
            )}

            {/* ── Return lines table ── */}
            {(hasRealCustomer || lines.length > 0) && (
              <div>
                {hasRealCustomer && (
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">{t("Articles à retourner", "المنتجات المراد إرجاعها")} ({lines.length})</span>
                  </div>
                )}
                {lines.length > 0 ? (
                  <div className="border rounded overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("Désignation", "المنتج")}</TableHead>
                          <TableHead className="text-center w-24">{t("Qté", "الكمية")}</TableHead>
                          <TableHead className="text-right">{t("P.U.", "السعر")}</TableHead>
                          <TableHead className="text-right">{t("Total", "المجموع")}</TableHead>
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => (
                          <TableRow key={line.productId}>
                            <TableCell className="text-sm font-medium">{line.designation}</TableCell>
                            <TableCell className="text-center">
                              <Input
                                type="number"
                                min={1}
                                value={line.qty}
                                onChange={(e) => setQty(line.productId, parseInt(e.target.value) || 1)}
                                className="h-7 w-16 text-center text-sm mx-auto"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={line.pu}
                                  onChange={(e) => setPu(line.productId, parseFloat(e.target.value) || 0)}
                                  className="h-7 w-24 text-right text-sm"
                                />
                                <span className="text-xs text-muted-foreground shrink-0">{currency}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-sm font-semibold">
                              {(line.pu * line.qty).toFixed(2)} {currency}
                            </TableCell>
                            <TableCell>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                                onClick={() => removeLine(line.productId)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-amber-50">
                          <TableCell colSpan={3} className="text-right font-semibold text-sm">
                            {t("Total Retour", "إجمالي الإرجاع")}
                          </TableCell>
                          <TableCell className="text-right font-bold text-amber-700">
                            {total.toFixed(2)} {currency}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="border rounded py-6 text-center text-xs text-muted-foreground">
                    {t("Cliquez sur « Ajouter » pour sélectionner des articles à retourner", "اضغط على « إضافة » لاختيار منتجات الإرجاع")}
                  </div>
                )}
              </div>
            )}

            {/* When no customer: show empty state for lines */}
            {!hasRealCustomer && lines.length === 0 && (
              <div className="border rounded py-8 text-center text-sm text-muted-foreground">
                {t("Aucun article ajouté", "لم يتم إضافة أي منتج")}
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 whitespace-pre-line">{error}</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createRetour.isPending}>
              {t("Annuler", "إلغاء")}
            </Button>
            <Button
              onClick={handleCloture}
              disabled={createRetour.isPending || lines.length === 0}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t("Clôturer", "إغلاق")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        products={products}
        onPick={addProduct}
        extraBarcodesMap={extraBarcodesMap}
      />
    </>
  );
}

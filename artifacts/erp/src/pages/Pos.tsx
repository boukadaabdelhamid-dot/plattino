import React, { useRef, useState, useMemo } from "react";
import {
  useGetProducts,
  useGetErpCustomers,
  useCreateOrder,
  useUpdateOrderStatus,
  getGetTransactionsQueryKey,
  getGetErpCustomersQueryKey,
  type Product,
  type CustomerSummary,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useMe } from "@/hooks/use-me";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, Search, Save, RotateCcw, Printer,
  X, Eye, EyeOff, Settings, Users, Barcode, Check, FileText, FolderOpen,
} from "lucide-react";
import InvoiceDialog from "@/components/InvoiceDialog";
import type { InvoiceData } from "@/components/InvoiceTemplate";
import { useCurrentStore } from "@/hooks/use-current-store";
import { Row } from "@/components/pos/Row";
import { ClientPickerButton } from "@/components/pos/ClientPickerButton";
import { ProductPickerDialog } from "@/components/pos/ProductPickerDialog";
import { PaymentDialog } from "@/components/pos/PaymentDialog";
import { DraftsDialog } from "@/components/pos/DraftsDialog";

type CartLine = {
  productId: number;
  designation: string;
  qty: number;
  qtyBonus: number;
  pu: number;
  reduction: number;
};

const fmt = (n: number) =>
  n.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Pos() {
  const qc = useQueryClient();
  const { user } = useMe();
  const store = useCurrentStore();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const { data: productsResp } = useGetProducts({ limit: 9999, inStockOnly: true });
  const { data: customersResp } = useGetErpCustomers();
  const createOrder = useCreateOrder();
  const updateOrderStatus = useUpdateOrderStatus();
  const [invoice, setInvoice] = useState<{ data: InvoiceData; auto: boolean } | null>(null);
  const [proformaOpen, setProformaOpen] = useState(false);

  const products: Product[] = (productsResp?.products ?? []) as Product[];
  type ProductFull = Product & { priceMin?: string | null };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const productsById = useMemo(() => new Map(products.map(p => [p.id, p as ProductFull])), [products]);

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
    for (const { barcode, productId } of extraBarcodesData) {
      m.set(barcode.toLowerCase(), productId);
    }
    return m;
  }, [extraBarcodesData]);
  const customers: CustomerSummary[] = (customersResp ?? []) as CustomerSummary[];

  const [lines, setLines] = useState<CartLine[]>([]);
  const [code, setCode] = useState("");
  const [qtyStr, setQtyStr] = useState("1");
  const [barcode, setBarcode] = useState("");
  const [showMontant, setShowMontant] = useState(true);
  const [showPrixMin, setShowPrixMin] = useState(false);
  const [client, setClient] = useState<CustomerSummary | null>(null);
  const [preparateur] = useState(user?.name ?? "Admin");
  const [versement, setVersement] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editLine, setEditLine] = useState<{ idx: number; line: CartLine; qtyInput: string } | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [emptyState, setEmptyState] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);

  const codeRef = useRef<HTMLInputElement>(null);

  const subtotal = lines.reduce((s, l) => s + l.pu * l.qty, 0);
  const totalReduction = lines.reduce((s, l) => s + l.reduction, 0);
  const net = Math.max(0, subtotal - totalReduction);
  const reste = Math.max(0, net - versement);
  const totalArticles = lines.reduce((s, l) => s + l.qty + l.qtyBonus, 0);

  // The store's configured default comptoir customer (if any). Every counter
  // sale must be linked to a real customer: use the manually selected client,
  // otherwise fall back to this default. If neither exists the sale is blocked.
  const defaultComptoirCustomer = useMemo(
    () => customers.find((c) => c.id === store?.defaultComptoirCustomerId) ?? null,
    [customers, store?.defaultComptoirCustomerId],
  );
  const effectiveClient = client ?? defaultComptoirCustomer;

  function addProduct(p: Product, addQty = 1) {
    setLines((prev) => {
      const existing = prev.findIndex((l) => l.productId === p.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], qty: next[existing].qty + addQty };
        return next;
      }
      return [
        ...prev,
        {
          productId: p.id,
          designation: (p.nameEn || p.nameAr || `Produit #${p.id}`).toUpperCase(),
          qty: addQty, qtyBonus: 0,
          pu: parseFloat(p.price ?? "0"),
          reduction: 0,
        },
      ];
    });
    setEmptyState(false);
  }

  function tryAddByCode(input: string, qtyToAdd: number) {
    if (!input.trim()) return;
    const trimmed = input.trim().toLowerCase();
    let found = products.find(
      (p) =>
        (p.barcode ?? "").toLowerCase() === trimmed ||
        (p.reference ?? "").toLowerCase() === trimmed ||
        String(p.id) === trimmed
    );
    if (!found) {
      const extraPid = extraBarcodesMap.get(trimmed);
      if (extraPid !== undefined) found = products.find((p) => p.id === extraPid);
    }
    if (found) {
      addProduct(found, qtyToAdd);
      setCode(""); setQtyStr("1");
      setTimeout(() => codeRef.current?.focus(), 50);
    } else {
      setPickerOpen(true);
    }
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateLine(idx: number, patch: Partial<CartLine>) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }
  function resetSale() {
    setLines([]); setVersement(0); setClient(null);
    setEmptyState(false); setCode(""); setQtyStr("1");
  }

  async function saveDraft() {
    if (lines.length === 0) {
      alert(t("Ajoutez au moins un article pour créer un bon en attente.", "أضف منتجاً واحداً على الأقل."));
      return;
    }
    const token = localStorage.getItem("midanic_token");
    try {
      const r = await fetch(`${apiBase}/api/erp/pos/drafts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          customerName: client?.name ?? "BON EN ATTENTE",
          customerPhone: (client as unknown as { phone?: string } | null)?.phone ?? "0000000000",
          lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, pu: l.pu })),
        }),
      });
      if (!r.ok) { alert(t("Erreur lors de la sauvegarde du bon.", "خطأ في حفظ الفاتورة.")); return; }
      resetSale();
    } catch {
      alert(t("Erreur réseau lors de la sauvegarde.", "خطأ في الشبكة أثناء الحفظ."));
    }
  }

  function handleLoadDraft(items: { productId: number; quantity: number; unitPrice: string; nameEn?: string | null; nameAr?: string | null }[]) {
    const newLines: CartLine[] = items.map((item) => ({
      productId: item.productId,
      designation: (item.nameEn || item.nameAr || `Produit #${item.productId}`).toUpperCase(),
      qty: item.quantity,
      qtyBonus: 0,
      pu: parseFloat(item.unitPrice),
      reduction: 0,
    }));
    setLines(newLines);
    setEmptyState(false);
    setCode("");
  }

  function buildInvoiceLines() {
    return lines.map((l) => {
      const p = products.find((x) => x.id === l.productId);
      return {
        designation: l.designation,
        reference: p?.reference ?? p?.barcode ?? null,
        qty: l.qty,
        unitPrice: l.pu,
      };
    });
  }

  function setInvoiceShowTva(showTva: boolean) {
    setInvoice((prev) => prev ? { ...prev, data: { ...prev.data, showTva } } : prev);
  }

  function openProforma() {
    if (lines.length === 0) {
      alert(t("Ajoutez au moins un article", "أضف منتجاً واحداً على الأقل"));
      return;
    }
    const data: InvoiceData = {
      kind: "proforma",
      number: `PRO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`,
      date: new Date(),
      store,
      party: {
        name: effectiveClient?.name ?? "DIVERS COMPTOIR",
        phone: effectiveClient?.phone ?? null,
      },
      lines: buildInvoiceLines(),
      showTva: !!store?.showTvaByDefault,
      tvaRate: parseFloat(store?.tvaRate ?? "19"),
      notes: t("Devis valable 7 jours", "صالح لمدة 7 أيام"),
    };
    setInvoice({ data, auto: false });
    setProformaOpen(true);
  }
  void proformaOpen;

  function handlePaymentConfirm(opts: { mode: "comptant" | "terme"; cloture: boolean; impression: boolean }) {
    if (lines.length === 0) {
      alert(t("Ajoutez au moins un article", "أضف منتجاً واحداً على الأقل"));
      return;
    }
    // Block any counter sale that is not linked to a real customer.
    if (!effectiveClient) {
      alert(t(
        "Aucun client sélectionné. Choisissez un client ou configurez un client comptoir par défaut dans les paramètres.",
        "لم يتم اختيار عميل. اختر عميلاً أو عيّن عميل الكاونتر الافتراضي في الإعدادات.",
      ));
      return;
    }
    const buyer = effectiveClient;
    const items = lines.map((l) => ({ productId: l.productId, quantity: l.qty }));
    const customerName = buyer.name;
    const snapshotLines = buildInvoiceLines();
    // Down-payment collected now. Only meaningful for à-terme sales; clamp to
    // [0, net]. The backend is the single source of truth: it credits the
    // caisse by this versement and registers only the remaining receivable
    // (net - versement) against the customer's credit balance.
    const appliedVersement = opts.mode === "terme"
      ? Math.min(Math.max(0, versement), net)
      : 0;
    createOrder.mutate(
      {
        data: {
          customerName,
          customerPhone: buyer.phone ?? "0000000000",
          customerAddress: "Vente comptoir",
          items,
          linkedCustomerId: buyer.id,
          paymentMode: opts.mode,
          versement: appliedVersement,
        },
      },
      {
        onSuccess: (order) => {
          // Automatically mark the order as delivered — no manual step needed
          updateOrderStatus.mutate(
            { id: order.id, data: { status: "delivered" } },
            {
              onSettled: () => {
                void qc.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
                // Refresh customer list so the updated credit balance shows.
                void qc.invalidateQueries({ queryKey: getGetErpCustomersQueryKey() });
                setPaymentOpen(false);
                if (opts.impression) {
                  const data: InvoiceData = {
                    kind: "sale",
                    number: `FV-${String(order.id).padStart(6, "0")}`,
                    date: new Date(),
                    store,
                    party: {
                      name: customerName,
                      phone: buyer.phone ?? null,
                    },
                    lines: snapshotLines,
                    showTva: !!store?.showTvaByDefault,
                    tvaRate: parseFloat(store?.tvaRate ?? "19"),
                    notes: opts.mode === "terme" ? t("Vente à terme", "بيع بالأجل") : undefined,
                  };
                  setInvoice({ data, auto: true });
                }
                resetSale();
                setEmptyState(true);
              },
            }
          );
        },
        onError: (err) => alert(`Erreur: ${(err as Error).message}`),
      }
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
      <Card className="border shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <div className="relative">
              <Label className="text-[11px] text-muted-foreground absolute -top-2 left-3 bg-white px-1 z-10">Code</Label>
              <Input
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") tryAddByCode(code, parseFloat(qtyStr.replace(",", ".")) || 1); }}
                className="h-11 pr-12"
                data-testid="input-code"
              />
              <Button
                size="icon" variant="ghost"
                className="absolute right-1 top-1 h-9 w-9 text-muted-foreground"
                onClick={() => setPickerOpen(true)}
                data-testid="button-open-picker"
                aria-label={t("Choisir un article", "اختيار مقال")}
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <div className="relative">
              <Label className="text-[11px] text-muted-foreground absolute -top-2 left-3 bg-white px-1 z-10">{t("Qté *", "الكمية *")}</Label>
              <Input
                inputMode="decimal" value={qtyStr}
                onChange={(e) => setQtyStr(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") tryAddByCode(code, parseFloat(qtyStr.replace(",", ".")) || 1); }}
                className="h-11 pr-10 text-center font-semibold"
                data-testid="input-qty"
              />
              <Button
                size="icon" variant="ghost"
                className="absolute right-1 top-1 h-9 w-9 text-emerald-600"
                onClick={() => tryAddByCode(code, parseFloat(qtyStr.replace(",", ".")) || 1)} aria-label={t("Confirmer", "تأكيد")}
              >
                <Check className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="font-semibold">{t("Désignation", "التسمية")}</TableHead>
                  <TableHead className="text-center font-semibold w-16">{t("Qté", "الكمية")}</TableHead>
                  <TableHead className="text-center font-semibold w-20">{t("Qté Bonus", "مجانية")}</TableHead>
                  <TableHead className="text-right font-semibold w-24">{t("PU", "ث.و")}</TableHead>
                  <TableHead className="text-right font-semibold w-24">{t("Réduction", "تخفيض")}</TableHead>
                  {showPrixMin && (<TableHead className="text-right font-semibold w-24">{t("Prix Min", "الحد الأدنى")}</TableHead>)}
                  {showMontant && (<TableHead className="text-right font-semibold w-28">{t("Montant", "المبلغ")}</TableHead>)}
                  <TableHead className="w-10 text-center">
                    <Button variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => setShowMontant((v) => !v)} aria-label={t("Toggle Montant", "تبديل المبلغ")}>
                      {showMontant ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emptyState && lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6 + (showMontant ? 1 : 0) + (showPrixMin ? 1 : 0)} className="text-center py-12 text-red-500 italic">
                      {t("Il faut créer une vente...", "يجب إنشاء عملية بيع...")}
                    </TableCell>
                  </TableRow>
                ) : lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6 + (showMontant ? 1 : 0) + (showPrixMin ? 1 : 0)} className="text-center py-12 text-muted-foreground italic">
                      {t("Scannez un code ou cliquez sur + pour ajouter un article", "امسح كوداً أو انقر + لإضافة مقال")}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {lines.map((l, idx) => (
                      <TableRow key={idx} data-testid={`row-line-${idx}`}>
                        <TableCell className="font-medium">{l.designation}</TableCell>
                        <TableCell className="text-center">{l.qty}</TableCell>
                        <TableCell className="text-center">{l.qtyBonus}</TableCell>
                        <TableCell className="text-right">{fmt(l.pu)}</TableCell>
                        <TableCell className="text-right">{fmt(l.reduction)}</TableCell>
                        {showPrixMin && (
                          <TableCell className="text-right text-orange-600 font-medium">
                            {fmt(parseFloat(productsById.get(l.productId)?.priceMin ?? "0"))}
                          </TableCell>
                        )}
                        {showMontant && (
                          <TableCell className="text-right font-semibold">
                            {fmt(l.pu * l.qty - l.reduction)}
                          </TableCell>
                        )}
                        <TableCell className="text-center">
                          <div className="flex gap-1 justify-end">
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => setEditLine({ idx, line: { ...l }, qtyInput: String(l.qty) })}
                              aria-label={t("Modifier", "تعديل")} data-testid={`button-edit-line-${idx}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500"
                              onClick={() => removeLine(idx)} aria-label={t("Supprimer", "حذف")}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-slate-50 font-bold">
                      <TableCell>{t("Total", "المجموع")}</TableCell>
                      <TableCell className="text-center">{lines.reduce((s, l) => s + l.qty, 0)}</TableCell>
                      <TableCell /><TableCell /><TableCell />
                      {showPrixMin && <TableCell />}
                      {showMontant && (<TableCell className="text-right">{fmt(net)}</TableCell>)}
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{lines.length} {t("articles", "مقالات")} / {totalArticles} (KG)</span>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0"
              onClick={() => setPickerOpen(true)} aria-label={t("Ajouter article", "إضافة مقال")} data-testid="button-add-line">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-between border-t pt-2 text-muted-foreground">
            <span className="text-xs font-medium">Midanic POS</span>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Ajouter", "إضافة")}><Plus className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600" onClick={() => setDraftsOpen(true)} aria-label={t("Bons en attente", "الفواتير المعلقة")} title={t("Bons en attente", "الفواتير المعلقة")}><FolderOpen className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" onClick={() => void saveDraft()} aria-label={t("Sauvegarder comme bon en attente", "حفظ كفاتورة معلقة")} title={t("Sauvegarder comme bon en attente", "حفظ كفاتورة معلقة")}><Save className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={resetSale} aria-label={t("Annuler", "إلغاء")}><X className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Info"><Settings className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Précédent", "السابق")}><RotateCcw className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Imprimer", "طباعة")} onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Toggle Prix Min", "تبديل الحد الأدنى")} onClick={() => setShowPrixMin((v) => !v)} title={t("Prix Min", "الحد الأدنى")}>
                {showPrixMin ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <Card className="bg-[#1B3057] text-white border-0 shadow-lg">
          <CardContent className="p-4 space-y-2">
            <Row label={t("Total", "المجموع")} value={fmt(subtotal)} />
            <Row label={t("Réduction", "التخفيض")} value={fmt(totalReduction)} />
            <div className="border-t border-white/20 my-1.5" />
            <Row label={t("Net", "الصافي")} value={fmt(net)} highlight="green" />
            <Row label={t("Versement", "الدفعة")} value={fmt(versement)} muted />
            <Row label={t("Reste", "الباقي")} value={fmt(reste)} highlight="red" />
            <Button
              className="w-full h-12 mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base"
              onClick={() => {
                if (!effectiveClient) {
                  alert(t(
                    "Aucun client sélectionné. Choisissez un client ou configurez un client comptoir par défaut dans les paramètres.",
                    "لم يتم اختيار عميل. اختر عميلاً أو عيّن عميل الكاونتر الافتراضي في الإعدادات.",
                  ));
                  return;
                }
                setPaymentOpen(true);
              }}
              data-testid="button-payer"
            >
              {t("Payer", "دفع")}
            </Button>
            <Button
              variant="outline"
              className="w-full h-10 mt-1 border-amber-300 text-amber-700 hover:bg-amber-50 font-semibold"
              onClick={openProforma}
              data-testid="button-proforma"
            >
              <FileText className="h-4 w-4 mr-1.5" />
              {t("Facture proforma", "فاتورة أولية")}
            </Button>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Button size="sm" variant="outline" className="h-7 px-2 rounded-full text-emerald-600 border-emerald-200">A+</Button>
              <div className="flex items-center gap-1">
                <ClientPickerButton onPick={setClient} customers={customers} />
                <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-600" aria-label={t("Liste clients", "قائمة العملاء")}>
                  <Users className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground font-medium">{t("Client :", "العميل:")}</span>
                <span className="font-semibold truncate" data-testid="text-client-name">
                  {effectiveClient ? effectiveClient.name : "DIVERS COMPTOIR"}
                </span>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="text-muted-foreground font-medium">{t("Adresse :", "العنوان:")}</span>
                <span className="text-xs truncate">{effectiveClient?.email ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="text-muted-foreground font-medium">{t("Solde :", "الرصيد:")}</span>
                {(() => {
                  const bal = Number((effectiveClient as unknown as { current_balance?: string | null })?.current_balance ?? 0);
                  return (
                    <span className={`font-semibold tabular-nums ${bal > 0 ? "text-red-600" : bal < 0 ? "text-emerald-600" : ""}`}>
                      {effectiveClient ? fmt(bal) : "0,00"} {effectiveClient ? currency : ""}
                    </span>
                  );
                })()}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-3 space-y-2">
            <div className="text-sm flex justify-between">
              <span className="text-muted-foreground">{t("Préparateur :", "المُعدّ:")}</span>
              <span className="font-semibold">{preparateur}</span>
            </div>
            <div className="relative">
              <Input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    tryAddByCode(barcode, 1);
                    setBarcode("");
                  }
                }}
                placeholder={t("Code à Barres", "كود الباركود")}
                className="h-9 pr-10 text-sm"
                data-testid="input-barcode"
              />
              <Barcode className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <ProductPickerDialog
        open={pickerOpen} onOpenChange={setPickerOpen}
        products={products}
        onPick={(p) => { addProduct(p, 1); setPickerOpen(false); }}
        extraBarcodesMap={extraBarcodesMap}
      />

      <Dialog open={!!editLine} onOpenChange={(o) => !o && setEditLine(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Modifier la ligne", "تعديل السطر")}</DialogTitle>
          </DialogHeader>
          {editLine && (
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs">{t("Désignation", "التسمية")}</Label>
                <Input value={editLine.line.designation} disabled className="h-9" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t("Qté", "الكمية")}</Label>
                  <Input inputMode="decimal" value={editLine.qtyInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = parseFloat(raw.replace(",", "."));
                      setEditLine({ ...editLine, qtyInput: raw, line: { ...editLine.line, qty: isNaN(parsed) || parsed <= 0 ? editLine.line.qty : parsed } });
                    }}
                    className="h-9" data-testid="input-edit-qty" />
                </div>
                <div>
                  <Label className="text-xs">{t("Qté Bonus", "مجانية")}</Label>
                  <Input type="number" min="0" value={editLine.line.qtyBonus}
                    onChange={(e) => setEditLine({ ...editLine, line: { ...editLine.line, qtyBonus: Math.max(0, parseInt(e.target.value) || 0) } })}
                    className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">{t(`PU (${currency})`, `ث.و (${currency})`)}</Label>
                  <Input type="number" step="0.01" value={editLine.line.pu}
                    onChange={(e) => setEditLine({ ...editLine, line: { ...editLine.line, pu: parseFloat(e.target.value) || 0 } })}
                    className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">{t(`Réduction (${currency})`, `تخفيض (${currency})`)}</Label>
                  <Input type="number" step="0.01" min="0" value={editLine.line.reduction}
                    onChange={(e) => setEditLine({ ...editLine, line: { ...editLine.line, reduction: Math.max(0, parseFloat(e.target.value) || 0) } })}
                    className="h-9" />
                </div>
              </div>
              <div className="bg-slate-50 rounded p-2 text-sm flex justify-between">
                <span>{t("Montant ligne", "مبلغ السطر")}</span>
                <span className="font-bold">{fmt(editLine.line.pu * editLine.line.qty - editLine.line.reduction)} {currency}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLine(null)}>{t("Annuler", "إلغاء")}</Button>
            <Button
              onClick={() => { if (editLine) { updateLine(editLine.idx, editLine.line); setEditLine(null); } }}
              data-testid="button-save-line"
            >{t("Enregistrer", "حفظ")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PaymentDialog
        open={paymentOpen} onOpenChange={setPaymentOpen}
        net={net} client={client}
        versement={versement} setVersement={setVersement}
        onConfirm={handlePaymentConfirm}
        isPending={createOrder.isPending || updateOrderStatus.isPending}
      />

      <DraftsDialog
        open={draftsOpen}
        onOpenChange={setDraftsOpen}
        apiBase={apiBase}
        onLoad={handleLoadDraft}
      />

      <InvoiceDialog
        open={!!invoice}
        onOpenChange={(o) => { if (!o) { setInvoice(null); setProformaOpen(false); } }}
        data={invoice?.data ?? null}
        autoPrint={invoice?.auto}
        onShowTvaChange={setInvoiceShowTva}
      />
    </div>
  );
}

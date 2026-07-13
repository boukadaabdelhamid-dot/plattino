import React, { useMemo, useState, useCallback } from "react";
import {
  useGetPurchaseOrders, useCreatePurchaseOrder, useUpdatePurchaseOrder, useReceivePurchaseOrder,
  useDeletePurchaseOrder,
  useGetSuppliers, useGetProducts, useCreateSupplier,
  useGetPurchaseOrderItems,
  getGetPurchaseOrdersQueryKey, getGetSuppliersQueryKey,
  getGetPurchaseAnnexeChargesQueryKey,
  useGetPurchaseAnnexeCharges, useCreatePurchaseAnnexeCharge, useDeletePurchaseAnnexeCharge,
  getProducts,
  type PurchaseOrder, type Supplier, type Product, type PurchaseAnnexeCharge,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Pencil, Trash2, Search, Save, Eye, EyeOff,
  FileText, Filter, X, Check, ShoppingBag, RefreshCw, Cloud, History, Settings, Printer, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import InvoiceDialog from "@/components/InvoiceDialog";
import PurchaseHistorySheet from "@/components/PurchaseHistorySheet";
import { useCurrentStore } from "@/hooks/use-current-store";

type TFn = (fr: string, ar: string) => string;

type ColumnSettings = {
  showMontant: boolean;
  showQtyPrepared: boolean;
  showQtyGratuit: boolean;
  showProgression: boolean;
};

const DEFAULT_COL_SETTINGS: ColumnSettings = {
  showMontant: true,
  showQtyPrepared: true,
  showQtyGratuit: true,
  showProgression: true,
};

function loadColSettings(): ColumnSettings {
  try {
    const s = localStorage.getItem("po-column-settings");
    if (s) return { ...DEFAULT_COL_SETTINGS, ...JSON.parse(s) };
  } catch { /**/ }
  return DEFAULT_COL_SETTINGS;
}

function saveColSettings(s: ColumnSettings) {
  try { localStorage.setItem("po-column-settings", JSON.stringify(s)); } catch { /**/ }
}

type ExtendedPO = PurchaseOrder & { paymentMethod?: string };

const fmt = (n: number) =>
  n.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const refOf = (id: number) => {
  const year = new Date().getFullYear();
  return `${String(id).padStart(6, "0")}/${year}`;
};

const statusLabel = (s: string, t: TFn) =>
  s === "received" ? t("Clôturée", "مُغلقة") : s === "cancelled" ? t("Annulée", "ملغاة") : t("En cours", "جارٍ");

const statusClass = (s: string) =>
  s === "received"
    ? "bg-emerald-500 text-white"
    : s === "cancelled"
    ? "bg-red-100 text-red-700"
    : "bg-blue-500 text-white";

export default function PurchaseOrders() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;
  // Resolve the current store FIRST so we can use its id as part of the
  // React Query cache key. This scopes the cache per-store and prevents
  // data from store A from briefly appearing in store B's list after a
  // store switch (race condition: old in-flight request completing after
  // qc.clear() would overwrite the freshly-cleared cache).
  const store = useCurrentStore();
  const { data: rawPos, isLoading } = useGetPurchaseOrders({
    query: { queryKey: [...getGetPurchaseOrdersQueryKey(), store?.id ?? null] },
  });
  const pos = (rawPos ?? []) as ExtendedPO[];
  const { data: suppliers } = useGetSuppliers();
  const { data: productsRes } = useGetProducts({ limit: 500 });
  const createPO = useCreatePurchaseOrder();
  const updatePO = useUpdatePurchaseOrder();
  const receivePO = useReceivePurchaseOrder();
  const deletePO = useDeletePurchaseOrder();

  const products: Product[] = (productsRes?.products ?? []) as Product[];
  const supplierMap: Record<number, Supplier> = useMemo(() => {
    const m: Record<number, Supplier> = {};
    (suppliers ?? []).forEach((s: Supplier) => { m[s.id] = s; });
    return m;
  }, [suppliers]);

  const [refFilter, setRefFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null);
  const [chargesOpen, setChargesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [columnSettings, setColumnSettings] = useState<ColumnSettings>(loadColSettings);

  const toggleSetting = useCallback((key: keyof ColumnSettings) => {
    setColumnSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveColSettings(next);
      return next;
    });
  }, []);

  // Safety net: close the editor whenever the active store changes.
  // Prevents editing a PO that belongs to a different store, which would
  // cause the PUT /erp/purchase-orders/:id to return 404 (storeId mismatch).
  React.useEffect(() => {
    setEditorOpen(false);
    setEditingPO(null);
  }, [store?.id]);

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceShowTva, setInvoiceShowTva] = useState(false);
  const [invoiceBaseData, setInvoiceBaseData] = useState<Omit<import("@/components/InvoiceTemplate").InvoiceData, "showTva"> | null>(null);
  const [invoicePO, setInvoicePO] = useState<ExtendedPO | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoiceItems } = useGetPurchaseOrderItems(invoicePO?.id ?? 0, { query: { enabled: !!invoicePO && invoiceOpen && !invoiceBaseData } } as any);
  const rowBaseData = useMemo((): Omit<import("@/components/InvoiceTemplate").InvoiceData, "showTva"> | null => {
    if (!invoicePO || !invoiceItems) return null;
    const sup = supplierMap[invoicePO.supplierId];
    return {
      kind: "purchase",
      number: `FA-${String(invoicePO.id).padStart(6, "0")}`,
      date: invoicePO.createdAt ? new Date(invoicePO.createdAt) : new Date(),
      store,
      party: { name: sup?.name ?? "—", address: sup?.address ?? null, phone: sup?.phone ?? null },
      lines: invoiceItems.map((it) => {
        const p = products.find((x) => x.id === it.productId);
        return {
          designation: (it.productNameEn || it.productNameAr || `#${it.productId}`).toUpperCase(),
          reference: p?.reference ?? p?.barcode ?? null,
          qty: it.quantity,
          unitPrice: parseFloat(it.unitCost ?? "0"),
        };
      }),
      tvaRate: parseFloat(store?.tvaRate ?? "19"),
    };
  }, [invoicePO, invoiceItems, supplierMap, store, products]);
  const finalInvoiceData = useMemo(() => {
    const base = invoiceBaseData ?? rowBaseData;
    if (!base) return null;
    return { ...base, showTva: invoiceShowTva };
  }, [invoiceBaseData, rowBaseData, invoiceShowTva]);
  function handlePrint(baseData: Omit<import("@/components/InvoiceTemplate").InvoiceData, "showTva">) {
    setInvoiceBaseData(baseData);
    setInvoiceShowTva(!!store?.showTvaByDefault);
    setInvoiceOpen(true);
  }

  const filtered = useMemo(() => {
    return pos.filter((po) => {
      if (refFilter && !refOf(po.id).toLowerCase().includes(refFilter.toLowerCase())) return false;
      const sname = (supplierMap[po.supplierId]?.name ?? "").toLowerCase();
      if (supplierFilter && !sname.includes(supplierFilter.toLowerCase())) return false;
      if (statusFilter && !statusLabel(po.status, t).toLowerCase().includes(statusFilter.toLowerCase())) return false;
      if (paymentFilter) {
        const pm = po.paymentMethod ?? "a_terme";
        const pmLabel = pm === "comptant" ? t("Comptant", "نقدي") : t("À terme", "آجل");
        if (!pmLabel.toLowerCase().includes(paymentFilter.toLowerCase())) return false;
      }
      if (po.createdAt) {
        const d = new Date(po.createdAt);
        if (dateFrom && d < new Date(dateFrom)) return false;
        if (dateTo && d > new Date(dateTo + "T23:59:59")) return false;
      }
      return true;
    });
  }, [pos, supplierMap, refFilter, supplierFilter, statusFilter, paymentFilter, dateFrom, dateTo, lang]);

  const handlePrintList = useCallback(() => {
    const w = window.open("", "_blank", "width=900,height=600");
    if (!w) return;
    const rf = (id: number) => `${String(id).padStart(6, "0")}/${new Date().getFullYear()}`;
    const fd = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("fr-DZ") : "—";
    const total = filtered.reduce((s, p) => s + parseFloat(p.totalAmount ?? "0"), 0);
    const rows = filtered.map((po) => {
      const sn = supplierMap[po.supplierId]?.name ?? `#${po.supplierId}`;
      const st = statusLabel(po.status, t);
      const pm = po.paymentMethod === "comptant" ? t("Comptant", "نقدي") : t("À terme", "آجل");
      return `<tr><td>${rf(po.id)}</td><td>${fd(po.createdAt)}</td><td>${sn}</td><td>${st}</td><td>${pm}</td><td style="text-align:right">${fmt(parseFloat(po.totalAmount ?? "0"))}</td></tr>`;
    }).join("");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t("Achats","المشتريات")}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px}table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #ddd;padding:6px 8px}th{background:#f5f5f5;font-weight:bold}
      h2{margin:0 0 12px}tfoot td{font-weight:bold}</style></head>
      <body><h2>${t("Bons d'Achat", "سندات الشراء")} (${filtered.length})</h2>
      <table><thead><tr>
        <th>${t("Réf.","المرجع")}</th><th>${t("Date","التاريخ")}</th>
        <th>${t("Fournisseur","المورد")}</th><th>${t("État","الحالة")}</th>
        <th>${t("Règlement","الدفع")}</th><th>${t("Montant (DA)","المبلغ (دج)")}</th>
      </tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5">${t("Total","المجموع")}</td><td style="text-align:right">${fmt(total)} DA</td></tr></tfoot>
      </table></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }, [filtered, supplierMap, t]);

  function openNew() { setEditingPO(null); setEditorOpen(true); }
  function openExisting(po: PurchaseOrder) { setEditingPO(po); setEditorOpen(true); }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="h-6 w-6 text-[#1B3057]" />
          {t("Achats", "المشتريات")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("Gestion des bons d'achat et fournisseurs", "إدارة سندات الشراء والموردين")}
        </p>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50/50">
            <h2 className="font-semibold text-base">{t("Achats", "المشتريات")} ({filtered.length})</h2>
            <div className="flex items-center gap-1">
              <Button size="sm" className="h-8 bg-[#1B3057] hover:bg-[#142441]" onClick={openNew} data-testid="button-new-achat">
                <Plus className="h-4 w-4 mr-1.5" />
                {t("Nouvel Achat", "شراء جديد")}
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8"
                onClick={() => qc.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() })}
                aria-label={t("Rafraîchir", "تحديث")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={() => setChargesOpen(true)} aria-label={t("Charges annexes", "المصاريف الإضافية")}>
                <Cloud className="h-4 w-4 mr-1" />
                {t("Charges", "المصاريف")}
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Historique", "التاريخ")}
                onClick={() => setHistoryOpen(true)}>
                <History className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Documents", "مستندات")}
                onClick={handlePrintList}>
                <FileText className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Paramètres", "الإعدادات")}>
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-b mb-1">
                    {t("Colonnes du bon d'achat", "أعمدة سند الشراء")}
                  </div>
                  {([
                    { key: "showMontant",     label: t("Montant",       "المبلغ")       },
                    { key: "showQtyPrepared", label: t("Qté Préparée",  "مُحضَّرة")     },
                    { key: "showQtyGratuit",  label: t("Qté Gratuite",  "مجانية")       },
                    { key: "showProgression", label: t("Progression",   "التقدم")       },
                  ] as const).map(({ key, label }) => (
                    <DropdownMenuItem
                      key={key}
                      onClick={(e) => { e.preventDefault(); toggleSetting(key); }}
                      className="cursor-pointer gap-2"
                    >
                      <span className="w-4 h-4 flex items-center justify-center shrink-0">
                        {columnSettings[key] ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="font-semibold">{t("Réf.", "المرجع")}</TableHead>
                    <TableHead className="font-semibold">{t("Création", "الإنشاء")}</TableHead>
                    <TableHead className="font-semibold">{t("Fournisseur", "المورد")}</TableHead>
                    <TableHead className="font-semibold text-center">{t("État", "الحالة")}</TableHead>
                    <TableHead className="font-semibold text-center">{t("Règlement", "الدفع")}</TableHead>
                    <TableHead className="font-semibold text-right">{t("Montant", "المبلغ")}</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                  <TableRow className="bg-white border-b">
                    <TableCell className="py-1.5"><FilterInput value={refFilter} onChange={setRefFilter} /></TableCell>
                    <TableCell className="py-1.5">
                      <div className="flex flex-col gap-1">
                        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-7 text-xs" />
                        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-7 text-xs" />
                      </div>
                    </TableCell>
                    <TableCell className="py-1.5"><FilterInput value={supplierFilter} onChange={setSupplierFilter} /></TableCell>
                    <TableCell className="py-1.5 text-center"><FilterInput value={statusFilter} onChange={setStatusFilter} /></TableCell>
                    <TableCell className="py-1.5 text-center"><FilterInput value={paymentFilter} onChange={setPaymentFilter} /></TableCell>
                    <TableCell className="py-1.5 text-right"><span className="text-xs text-muted-foreground">=</span></TableCell>
                    <TableCell />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground italic">
                        {t("Aucune donnée disponible", "لا توجد بيانات")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((po) => (
                      <TableRow key={po.id} data-testid={`row-po-${po.id}`}
                        className="cursor-pointer hover:bg-blue-50/50" onClick={() => openExisting(po)}>
                        <TableCell className="font-medium text-slate-700">{refOf(po.id)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {po.createdAt ? format(new Date(po.createdAt), "yyyy-MM-dd HH:mm:ss") : "—"}
                        </TableCell>
                        <TableCell className="font-medium uppercase">
                          {supplierMap[po.supplierId]?.name ?? `#${po.supplierId}`}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusClass(po.status)}`}>
                            {statusLabel(po.status, t)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {po.paymentMethod === "comptant" ? (
                            <span className="inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                              {t("Comptant", "نقدي")}
                            </span>
                          ) : (
                            <span className="inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              {t("À terme", "آجل")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">
                          {fmt(parseFloat(po.totalAmount ?? "0"))}
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t("Actions", "الإجراءات")}>
                                <span className="text-lg leading-none">⋮</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => openExisting(po)}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                {t("Ouvrir", "فتح")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setInvoiceBaseData(null);
                                  setInvoicePO(po);
                                  setInvoiceShowTva(!!store?.showTvaByDefault);
                                  setInvoiceOpen(true);
                                }}
                              >
                                <Eye className="h-4 w-4 mr-2" />
                                {t("Voir", "عرض")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setInvoiceBaseData(null);
                                  setInvoicePO(po);
                                  setInvoiceShowTva(!!store?.showTvaByDefault);
                                  setInvoiceOpen(true);
                                }}
                              >
                                <Printer className="h-4 w-4 mr-2" />
                                {t("Imprimer la facture", "طباعة الفاتورة")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={po.status !== "pending"}
                                onClick={() => {
                                  receivePO.mutate({ id: po.id }, {
                                    onSettled: () => qc.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() }),
                                  });
                                }}
                              >
                                <Check className="h-4 w-4 mr-2" />
                                {t("Clôturer le bon", "إغلاق البون")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={po.status !== "pending"}
                                className="text-red-600 focus:text-red-600"
                                onClick={() => {
                                  if (!confirm(t(
                                    `Supprimer le bon d'achat N°${po.id} ? Cette action est irréversible.`,
                                    `حذف سند الشراء رقم ${po.id}؟ هذا الإجراء لا يمكن التراجع عنه.`
                                  ))) return;
                                  deletePO.mutate({ id: po.id }, {
                                    onSuccess: () => qc.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() }),
                                    onError: (err) => alert(`Erreur: ${(err as Error).message}`),
                                  });
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                {t("Supprimer", "حذف")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PurchaseHistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        pos={pos}
        supplierMap={supplierMap}
      />
      <PurchaseEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editingPO}
        onPrint={handlePrint}
        suppliers={suppliers ?? []}
        products={products}
        columnSettings={columnSettings}
        onSave={(payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (editingPO) {
            updatePO.mutate({ id: editingPO.id, data: payload as any }, {
              onSuccess: () => { qc.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() }); setEditorOpen(false); },
              onError: (err) => alert(`Erreur: ${(err as Error).message}`),
            });
          } else {
            createPO.mutate({ data: payload as any }, {
              onSuccess: () => { qc.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() }); setEditorOpen(false); },
              onError: (err) => alert(`Erreur: ${(err as Error).message}`),
            });
          }
        }}
        onClose={(po) => {
          receivePO.mutate({ id: po.id }, {
            onSettled: () => { qc.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() }); setEditorOpen(false); },
          });
        }}
        onDelete={(po) => {
          deletePO.mutate({ id: po.id }, {
            onSuccess: () => { qc.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() }); setEditorOpen(false); },
            onError: (err) => alert(`Erreur: ${(err as Error).message}`),
          });
        }}
        saving={createPO.isPending || updatePO.isPending || receivePO.isPending || deletePO.isPending}
      />
      <InvoiceDialog
        open={invoiceOpen}
        onOpenChange={(o) => { setInvoiceOpen(o); if (!o) { setInvoicePO(null); setInvoiceBaseData(null); } }}
        onShowTvaChange={setInvoiceShowTva}
        data={finalInvoiceData}
      />
      <ChargesManagerDialog
        open={chargesOpen}
        onOpenChange={setChargesOpen}
        pos={pos}
        supplierMap={supplierMap}
      />
    </div>
  );
}

function FilterInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Filter className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Filtre ..." className="h-7 text-xs pl-7" />
    </div>
  );
}

type EditLine = {
  productId: number; designation: string;
  qty: number; qtyPrepared: number; qtyGratuit: number; pu: number;
  /** Total annexe charges allocated to this item (sum across all charge records, in DA). */
  charges: number;
};

function PurchaseEditor({
  open, onOpenChange, editing, suppliers, products, onSave, onClose, onDelete, saving, onPrint, columnSettings,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: ExtendedPO | null;
  suppliers: Supplier[]; products: Product[];
  onSave: (payload: { supplierId: number; notes?: string; paymentMethod: string; items: { productId: number; quantity: number; unitCost: number }[] }) => void;
  onClose: (po: PurchaseOrder) => void;
  onDelete: (po: PurchaseOrder) => void;
  saving: boolean;
  onPrint: (baseData: Omit<import("@/components/InvoiceTemplate").InvoiceData, "showTva">) => void;
  columnSettings: ColumnSettings;
}) {
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [refAchat, setRefAchat] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [paymentMethod, setPaymentMethod] = useState<"comptant" | "a_terme">("a_terme");
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [code, setCode] = useState("");
  const cs = columnSettings;
  const store = useCurrentStore();

  const { data: existingItems } = useGetPurchaseOrderItems(editing?.id ?? 0, {
    query: { enabled: open && !!editing },
  });

  // Guard: load items from server only once per dialog open.
  // Without this, any background refetch of existingItems (e.g. triggered by a
  // WS purchase_received event) would overwrite in-progress edits.
  const hasLoadedItemsRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    // Reset the guard whenever the dialog opens/switches to a different PO.
    hasLoadedItemsRef.current = false;
    if (editing) {
      setRefAchat(editing.notes || `Bon N°${editing.id}`);
      setDate(editing.createdAt ? editing.createdAt.slice(0, 16) : new Date().toISOString().slice(0, 16));
      setPaymentMethod(editing.paymentMethod === "comptant" ? "comptant" : "a_terme");
      setLines([]);
    } else {
      setSupplier(null); setRefAchat(""); setLines([]); setCode("");
      setDate(new Date().toISOString().slice(0, 16));
      setPaymentMethod("a_terme");
    }
  }, [open, editing]);

  React.useEffect(() => {
    if (!open || !editing) return;
    const s = suppliers.find((x) => x.id === editing.supplierId);
    if (s) setSupplier(s);
  }, [open, editing, suppliers]);

  React.useEffect(() => {
    if (!open || !editing || !existingItems) return;
    // Only populate lines on the first load; ignore subsequent refetches so
    // background WS invalidations do not overwrite the user's in-progress edits.
    if (hasLoadedItemsRef.current) return;
    hasLoadedItemsRef.current = true;
    setLines(existingItems.map((it) => ({
      productId: it.productId,
      designation: (it.productNameEn || it.productNameAr || `#${it.productId}`).toUpperCase(),
      qty: it.quantity,
      qtyPrepared: editing.status === "received" ? it.quantity : 0,
      qtyGratuit: 0,
      pu: parseFloat(it.unitCost ?? "0"),
      charges: parseFloat(it.totalCharges ?? "0"),
    })));
  }, [open, editing, existingItems]);


  const subtotal = lines.reduce((s, l) => s + l.pu * l.qty, 0);

  function addProduct(p: Product) {
    setLines((prev) => {
      if (prev.some((l) => l.productId === p.id)) return prev;
      return [...prev, {
        productId: p.id,
        designation: (p.nameEn || p.nameAr || `#${p.id}`).toUpperCase(),
        qty: 1, qtyPrepared: 0, qtyGratuit: 0,
        pu: parseFloat(p.costPrice ?? p.price ?? "0"),
        charges: 0,
      }];
    });
  }

  async function tryAddByCode(input: string) {
    const tok = input.trim().toLowerCase();
    if (!tok) { setProductPickerOpen(true); return; }

    // Fast path: numeric ID → check local list first
    const byId = (products ?? []).find((p) => String(p.id) === tok);
    if (byId) { addProduct(byId); setCode(""); return; }

    // Server-side lookup: barcode (filterCode) + reference (filterRef) in parallel
    try {
      const [byCode, byRef] = await Promise.all([
        getProducts({ filterCode: tok, limit: 5 }),
        getProducts({ filterRef: tok, limit: 5 }),
      ]);
      const candidates = [
        ...(byCode?.products ?? []),
        ...(byRef?.products ?? []),
      ];
      // Require exact match (filterCode/filterRef do partial ILIKE on the server)
      const found = candidates.find(
        (p) =>
          (p.barcode ?? "").toLowerCase() === tok ||
          (p.reference ?? "").toLowerCase() === tok,
      );
      if (found) { addProduct(found); setCode(""); return; }
    } catch { /* network error → fall through to picker */ }

    // Fallback: open product picker for manual selection
    setProductPickerOpen(true);
  }

  function updateLine(idx: number, patch: Partial<EditLine>) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSave() {
    if (!supplier) { alert(t("Choisissez un fournisseur", "اختر مورداً")); return; }
    if (lines.length === 0) { alert(t("Ajoutez au moins un article", "أضف مقالاً واحداً على الأقل")); return; }
    onSave({
      supplierId: supplier.id,
      notes: refAchat || undefined,
      paymentMethod,
      items: lines.map((l) => ({ productId: l.productId, quantity: l.qty, unitCost: l.pu })),
    });
  }

  const isExisting = !!editing;
  const isReceived = editing?.status === "received";
  const hasCharges = isExisting && lines.some(l => l.charges > 0);
  const totalChargesAmt = lines.reduce((s, l) => s + l.charges, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0">
        <div className="bg-emerald-700 text-white px-5 py-3 flex items-center justify-between">
          <DialogHeader className="flex-1">
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <X className="h-4 w-4 cursor-pointer" onClick={() => onOpenChange(false)} />
              <span>
                {isExisting
                  ? `${t("Modifier achat", "تعديل الشراء")} n°${editing?.id ?? ""}`
                  : t("Nouvel Achat", "شراء جديد")}
              </span>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="p-5 space-y-4">
          {isExisting && (
            <div className="text-sm text-slate-700 border-b pb-3">
              <span className="font-semibold">{t("Bon d'Achat", "سند الشراء")} N°{editing?.id}</span>
              {" "}{t("du", "بتاريخ")}{" "}
              <span>{editing?.createdAt ? format(new Date(editing.createdAt), "yyyy-MM-dd HH:mm:ss") : "—"}</span>
              {" "}{t("pour le fournisseur", "للمورد")}{" "}
              <span className="font-semibold uppercase">{supplier?.name ?? "—"}</span>
            </div>
          )}

          <Card className="border shadow-sm overflow-hidden">
            <div className="bg-blue-100 px-4 py-2.5 border-b flex items-center justify-between">
              <h3 className="font-semibold text-[#1B3057] flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {t("Éditeur d'achat", "محرر الشراء")}
              </h3>
              <Button
                size="icon" variant="ghost"
                className="h-7 w-7 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full"
                onClick={handleSave} disabled={saving} data-testid="button-save-achat" aria-label={t("Enregistrer", "حفظ")}>
                <Save className="h-4 w-4" />
              </Button>
            </div>
            <CardContent className="p-4 space-y-3">
              <div className="bg-slate-50 rounded-md p-3 border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-muted-foreground">{t("Fournisseur", "المورد")}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-600"
                    onClick={() => setSupplierPickerOpen(true)} aria-label={t("Choisir fournisseur", "اختيار مورد")} data-testid="button-pick-supplier">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {supplier ? (
                  <div className="text-sm space-y-0.5">
                    <div><span className="text-muted-foreground">{t("Nom:", "الاسم:")} </span><span className="font-semibold uppercase">{supplier.name}</span></div>
                    <div><span className="text-muted-foreground">{t("Adresse:", "العنوان:")} </span>{supplier.address ?? "—"}</div>
                    <div><span className="text-muted-foreground">{t("Contact:", "التواصل:")} </span>{supplier.contactName ?? "—"}</div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">{t("Solde:", "الرصيد:")} </span>
                      {(() => {
                        const bal = parseFloat(supplier.currentBalance ?? "0");
                        const color = bal < 0 ? "text-rose-600" : bal > 0 ? "text-emerald-600" : "";
                        return (
                          <span className={`font-semibold tabular-nums ${color}`}>
                            {Math.abs(bal).toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA
                            {bal < 0 && <span className="text-xs font-normal ml-1 opacity-70">{t("(dette)", "(دين)")}</span>}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm italic text-muted-foreground py-2 text-center">
                    {t("Aucun fournisseur sélectionné", "لم يتم اختيار مورد")}
                  </div>
                )}
              </div>

              <div>
                <Label className="text-xs mb-1 block">{t("Réf. Achat", "مرجع الشراء")}</Label>
                <Input value={refAchat} onChange={(e) => setRefAchat(e.target.value)}
                  placeholder={t("Référence...", "المرجع...")} className="h-9" data-testid="input-ref-achat" />
              </div>

              <div>
                <Label className="text-xs mb-1 block">{t("Date", "التاريخ")}</Label>
                <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
              </div>

              <div>
                <Label className="text-xs mb-1.5 block">{t("Mode de règlement", "طريقة الدفع")}</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { if (!isExisting) setPaymentMethod("comptant"); }}
                    disabled={isExisting}
                    className={`flex-1 h-9 rounded-md border text-sm font-semibold transition-colors
                      ${paymentMethod === "comptant"
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white text-slate-600 border-slate-300 hover:border-emerald-400 hover:text-emerald-700"}
                      ${isExisting ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    ✓ {t("Comptant", "نقدي")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (!isExisting) setPaymentMethod("a_terme"); }}
                    disabled={isExisting}
                    className={`flex-1 h-9 rounded-md border text-sm font-semibold transition-colors
                      ${paymentMethod === "a_terme"
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-white text-slate-600 border-slate-300 hover:border-amber-400 hover:text-amber-700"}
                      ${isExisting ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    ⏱ {t("À terme", "آجل")}
                  </button>
                </div>
                {paymentMethod === "comptant" && !isExisting && (
                  <p className="text-xs text-emerald-700 mt-1">
                    {t("Payé immédiatement — aucune dette fournisseur.", "مدفوع فوراً — لا دين على المورد.")}
                  </p>
                )}
                {paymentMethod === "a_terme" && !isExisting && (
                  <p className="text-xs text-amber-700 mt-1">
                    {t("Paiement différé — crée une dette fournisseur.", "دفع مؤجل — ينشئ دينًا على المورد.")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <div className="px-4 py-2.5 border-b flex items-center justify-between bg-slate-50/50">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                {t("Liste des articles", "قائمة المقالات")}
                <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusClass(editing?.status ?? "pending")}`}>
                  {statusLabel(editing?.status ?? "pending", t)}
                </span>
              </h3>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled>{t("Importer des codes", "استيراد أكواد")}</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled>{t("Importer des lignes", "استيراد أسطر")}</Button>
              </div>
            </div>

            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-[200px_1fr_1fr_60px] gap-2 items-end">
                <div>
                  <Label className="text-xs mb-1 block">{t("Code Article", "كود المقال")}</Label>
                  <Input value={code} onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") tryAddByCode(code); }}
                    className="h-9" disabled={isReceived} data-testid="input-code-article" />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">{t("Sélectionnez un article", "اختر مقالاً")}</Label>
                  <Button variant="outline" className="h-9 w-full justify-start font-normal text-muted-foreground"
                    onClick={() => setProductPickerOpen(true)} disabled={isReceived} data-testid="button-select-article">
                    <Search className="h-3.5 w-3.5 mr-2" />
                    {t("Sélectionnez un article", "اختر مقالاً")}
                  </Button>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">{t("Sélectionnez un produit", "اختر منتجاً")}</Label>
                  <Input placeholder={t("Sélectionnez un produit", "اختر منتجاً")} disabled className="h-9" />
                </div>
                <Button size="icon" className="h-9 w-9 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full"
                  onClick={() => tryAddByCode(code)} disabled={isReceived} aria-label={t("Ajouter", "إضافة")}>
                  <Plus className="h-5 w-5" />
                </Button>
              </div>

              <div className="border rounded-md overflow-hidden">
                <div className="px-3 py-1.5 bg-slate-50 border-b flex items-center justify-between">
                  <span className="font-semibold text-sm">{t("Contenu", "المحتوى")}</span>
                </div>
                <Table>
                  <TableHeader className="bg-slate-50/50">
                    <TableRow>
                      <TableHead className="font-semibold">{t("Désignation ↑", "التسمية ↑")}</TableHead>
                      <TableHead className="font-semibold text-center w-20">{t("Qté", "الكمية")}</TableHead>
                      {cs.showQtyPrepared && <TableHead className="font-semibold text-center w-24">{t("Qté Préparée", "مُحضَّرة")}</TableHead>}
                      {cs.showProgression && <TableHead className="font-semibold text-center w-24">{t("Progression", "التقدم")}</TableHead>}
                      {cs.showQtyGratuit  && <TableHead className="font-semibold text-center w-24">{t("Qté Gratuite", "مجانية")}</TableHead>}
                      <TableHead className="font-semibold text-right w-24">{t("PU", "ث.و")}</TableHead>
                      {hasCharges && cs.showMontant && <TableHead className="font-semibold text-right w-24 text-orange-600">{t("Frais", "المصاريف")}</TableHead>}
                      {cs.showMontant && <TableHead className="font-semibold text-right w-28">{t("Montant", "المبلغ")}</TableHead>}
                      {hasCharges && cs.showMontant && <TableHead className="font-semibold text-right w-28 text-emerald-700">{t("Total eff.", "المجموع الفعلي")}</TableHead>}
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4 + (cs.showQtyPrepared ? 1 : 0) + (cs.showProgression ? 1 : 0) + (cs.showQtyGratuit ? 1 : 0) + (cs.showMontant ? 1 : 0) + (hasCharges && cs.showMontant ? 2 : 0)} className="text-center py-10 text-muted-foreground italic">
                          {t("Aucune donnée disponible", "لا توجد بيانات")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {lines.map((l, idx) => {
                          const progression = l.qty > 0 ? Math.round((l.qtyPrepared / l.qty) * 100) : 0;
                          return (
                            <TableRow key={idx} data-testid={`row-line-${idx}`}>
                              <TableCell className="font-medium uppercase text-xs">{l.designation}</TableCell>
                              <TableCell className="text-center">
                                <Input type="number" min="1" value={l.qty}
                                  onChange={(e) => updateLine(idx, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                                  className="h-7 w-16 text-center text-xs mx-auto" disabled={isReceived} data-testid={`input-qty-${idx}`} />
                              </TableCell>
                              {cs.showQtyPrepared && (
                                <TableCell className="text-center">
                                  <Input type="number" min="0" value={l.qtyPrepared}
                                    onChange={(e) => updateLine(idx, { qtyPrepared: Math.max(0, parseInt(e.target.value) || 0) })}
                                    className="h-7 w-16 text-center text-xs mx-auto" disabled={isReceived} />
                                </TableCell>
                              )}
                              {cs.showProgression && (
                                <TableCell className="text-center text-xs">
                                  <span className={`px-2 py-0.5 rounded ${progression === 100 ? "bg-emerald-100 text-emerald-700" : progression > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                                    {progression}%
                                  </span>
                                </TableCell>
                              )}
                              {cs.showQtyGratuit && (
                                <TableCell className="text-center">
                                  <Input type="number" min="0" value={l.qtyGratuit}
                                    onChange={(e) => updateLine(idx, { qtyGratuit: Math.max(0, parseInt(e.target.value) || 0) })}
                                    className="h-7 w-16 text-center text-xs mx-auto" disabled={isReceived} />
                                </TableCell>
                              )}
                              <TableCell className="text-right">
                                <Input type="number" step="0.01" min="0" value={l.pu}
                                  onChange={(e) => updateLine(idx, { pu: parseFloat(e.target.value) || 0 })}
                                  className="h-7 w-20 text-right text-xs ml-auto" disabled={isReceived} />
                              </TableCell>
                              {hasCharges && cs.showMontant && (
                                <TableCell className="text-right text-xs tabular-nums text-orange-600">
                                  {l.charges > 0 ? fmt(l.charges) : "—"}
                                </TableCell>
                              )}
                              {cs.showMontant && (
                                <TableCell className="text-right font-semibold tabular-nums">{fmt(l.pu * l.qty)}</TableCell>
                              )}
                              {hasCharges && cs.showMontant && (
                                <TableCell className="text-right font-semibold tabular-nums text-emerald-700">{fmt(l.pu * l.qty + l.charges)}</TableCell>
                              )}
                              <TableCell>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500"
                                  onClick={() => removeLine(idx)} disabled={isReceived} aria-label={t("Supprimer", "حذف")}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow className="bg-slate-50 font-bold">
                          <TableCell>{hasCharges ? t("Sous-total P.A.", "مجموع الشراء") : t("Total", "المجموع")} ({lines.length})</TableCell>
                          <TableCell className="text-center">{lines.reduce((s, l) => s + l.qty, 0)}</TableCell>
                          {cs.showQtyPrepared && <TableCell className="text-center">{lines.reduce((s, l) => s + l.qtyPrepared, 0)}</TableCell>}
                          {cs.showProgression && <TableCell />}
                          {cs.showQtyGratuit  && <TableCell className="text-center">{lines.reduce((s, l) => s + l.qtyGratuit, 0)}</TableCell>}
                          <TableCell />
                          {hasCharges && cs.showMontant && <TableCell />}
                          {cs.showMontant && <TableCell className="text-right tabular-nums">{fmt(subtotal)}</TableCell>}
                          {hasCharges && cs.showMontant && <TableCell />}
                          <TableCell />
                        </TableRow>
                        {hasCharges && cs.showMontant && (
                          <TableRow className="bg-orange-50 font-bold border-t-2 border-orange-200">
                            <TableCell className="text-orange-700 text-xs">{t("Total charges annexes", "مجموع المصاريف الإضافية")}</TableCell>
                            <TableCell />
                            {cs.showQtyPrepared && <TableCell />}
                            {cs.showProgression && <TableCell />}
                            {cs.showQtyGratuit  && <TableCell />}
                            <TableCell />
                            <TableCell className="text-right tabular-nums text-orange-700">{fmt(totalChargesAmt)}</TableCell>
                            <TableCell />
                            <TableCell className="text-right tabular-nums font-bold text-emerald-700">{fmt(subtotal + totalChargesAmt)}</TableCell>
                            <TableCell />
                          </TableRow>
                        )}
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-slate-50">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Annuler", "إلغاء")}</Button>
          {isExisting && (
            <Button variant="outline" className="border-[#1B3057] text-[#1B3057] hover:bg-blue-50"
              onClick={() => {
                onPrint({
                  kind: "purchase",
                  number: `FA-${String(editing!.id).padStart(6, "0")}`,
                  date: editing!.createdAt ? new Date(editing!.createdAt) : new Date(),
                  store,
                  party: { name: supplier?.name ?? "—", address: supplier?.address ?? null, phone: supplier?.phone ?? null },
                  lines: lines.map((l) => {
                    const p = products.find((x) => x.id === l.productId);
                    return { designation: l.designation, reference: p?.reference ?? p?.barcode ?? null, qty: l.qty, unitPrice: l.pu };
                  }),
                  tvaRate: parseFloat(store?.tvaRate ?? "19"),
                  notes: refAchat ? `Réf: ${refAchat}` : undefined,
                });
              }}
              disabled={!supplier || lines.length === 0}
              title={t("Imprimer la facture (TVA réglable dans l'aperçu)", "طباعة الفاتورة (TVA قابلة للتعديل)")}
              data-testid="button-print-purchase-invoice">
              <Printer className="h-4 w-4 mr-1.5" />
              {t("Facture", "فاتورة")}
            </Button>
          )}
          {isExisting && !isReceived && (
            <Button variant="outline" className="border-red-300 text-red-600 hover:bg-red-50"
              onClick={() => {
                if (!editing) return;
                if (!confirm(t(
                  `Supprimer le bon d'achat N°${editing.id} ? Cette action est irréversible.`,
                  `حذف سند الشراء رقم ${editing.id}؟ هذا الإجراء لا يمكن التراجع عنه.`
                ))) return;
                onDelete(editing);
              }}
              disabled={saving} data-testid="button-supprimer-achat">
              <AlertTriangle className="h-4 w-4 mr-1.5" />
              {t("Supprimer", "حذف")}
            </Button>
          )}
          {isExisting && !isReceived && (
            <Button variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              onClick={() => editing && onClose(editing)} disabled={saving} data-testid="button-cloturer">
              <Check className="h-4 w-4 mr-1.5" />
              {t("Clôturer", "إغلاق")}
            </Button>
          )}
          {!isExisting && (
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}
              disabled={saving || !supplier || lines.length === 0} data-testid="button-enregistrer-achat">
              <Save className="h-4 w-4 mr-1.5" />
              {t("Enregistrer", "حفظ")}
            </Button>
          )}
        </DialogFooter>

        <SupplierPickerDialog
          open={supplierPickerOpen}
          onOpenChange={setSupplierPickerOpen}
          suppliers={suppliers}
          onPick={(s) => { setSupplier(s); setSupplierPickerOpen(false); }}
        />

        <ProductPickerDialog
          open={productPickerOpen}
          onOpenChange={setProductPickerOpen}
          onPick={(p) => { addProduct(p); setProductPickerOpen(false); }}
        />
      </DialogContent>
    </Dialog>
  );
}

function SupplierPickerDialog({
  open, onOpenChange, suppliers, onPick,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  suppliers: Supplier[]; onPick: (s: Supplier) => void;
}) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;
  const createSupplier = useCreateSupplier();
  const [nom, setNom] = useState("");
  const [adresse, setAdresse] = useState("");
  const [ville, setVille] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const filtered = useMemo(() => {
    return suppliers.filter((s) => {
      if (nom && !s.name.toLowerCase().includes(nom.toLowerCase())) return false;
      if (adresse && !(s.address ?? "").toLowerCase().includes(adresse.toLowerCase())) return false;
      if (ville && !(s.address ?? "").toLowerCase().includes(ville.toLowerCase())) return false;
      return true;
    });
  }, [suppliers, nom, adresse, ville]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    createSupplier.mutate(
      { data: { name: newName, address: newAddress || undefined, phone: newPhone || undefined } },
      {
        onSuccess: (s) => {
          qc.invalidateQueries({ queryKey: getGetSuppliersQueryKey() });
          setShowCreate(false); setNewName(""); setNewAddress(""); setNewPhone("");
          onPick(s);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0">
        <div className="bg-blue-200 text-[#1B3057] px-5 py-3 flex items-center justify-between">
          <DialogHeader className="flex-1">
            <DialogTitle className="text-base">{t("Choisir un fournisseur", "اختيار مورد")}</DialogTitle>
          </DialogHeader>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">{t("Fournisseurs", "الموردون")} ({filtered.length})</h4>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-600"
                onClick={() => setShowCreate((v) => !v)} aria-label={t("Ajouter fournisseur", "إضافة مورد")} data-testid="button-add-supplier-quick">
                <Plus className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" aria-label={t("Visibilité", "الرؤية")}>
                <EyeOff className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {showCreate && (
            <div className="border rounded-md p-3 bg-slate-50 space-y-2">
              <h5 className="text-xs font-semibold text-muted-foreground">{t("Nouveau fournisseur", "مورد جديد")}</h5>
              <div className="grid grid-cols-3 gap-2">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("Nom *", "الاسم *")} className="h-8 text-sm" data-testid="input-new-supplier-name" />
                <Input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder={t("Adresse", "العنوان")} className="h-8 text-sm" />
                <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder={t("Téléphone", "الهاتف")} className="h-8 text-sm" />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowCreate(false)}>{t("Annuler", "إلغاء")}</Button>
                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleCreate} disabled={createSupplier.isPending || !newName.trim()} data-testid="button-create-supplier-quick">
                  {t("Créer", "إنشاء")}
                </Button>
              </div>
            </div>
          )}

          <div className="border rounded-md overflow-hidden max-h-[55vh] overflow-y-auto">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0">
                <TableRow>
                  <TableHead className="font-semibold">{t("Nom ↑", "الاسم ↑")}</TableHead>
                  <TableHead className="font-semibold">{t("Adresse", "العنوان")}</TableHead>
                  <TableHead className="font-semibold">{t("Ville", "المدينة")}</TableHead>
                  <TableHead className="font-semibold text-right">{t("Solde", "الرصيد")}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
                <TableRow>
                  <TableCell className="py-1.5"><FilterInput value={nom} onChange={setNom} /></TableCell>
                  <TableCell className="py-1.5"><FilterInput value={adresse} onChange={setAdresse} /></TableCell>
                  <TableCell className="py-1.5"><FilterInput value={ville} onChange={setVille} /></TableCell>
                  <TableCell /><TableCell />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground italic">
                      {t("Aucun fournisseur", "لا يوجد موردون")}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-blue-50/50"
                      onClick={() => onPick(s)} data-testid={`row-pick-supplier-${s.id}`}>
                      <TableCell className="font-semibold uppercase">{s.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.address ?? "—"}</TableCell>
                      <TableCell className="text-sm">—</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(() => {
                          const bal = parseFloat(s.currentBalance ?? "0");
                          const color = bal < 0 ? "text-rose-600 font-bold" : bal > 0 ? "text-emerald-600 font-semibold" : "text-slate-500";
                          return (
                            <span className={color}>
                              {Math.abs(bal).toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              {bal < 0 && <span className="text-[10px] font-normal text-rose-400 ml-1">↑</span>}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-600"
                          onClick={(e) => { e.stopPropagation(); onPick(s); }} aria-label={t("Choisir", "اختيار")}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductPickerDialog({
  open, onOpenChange, onPick,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  onPick: (p: Product) => void;
}) {
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  React.useEffect(() => { if (open) { setQ(""); setDebouncedQ(""); } }, [open]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { data: res, isFetching } = useGetProducts(
    { search: debouncedQ || undefined, limit: 50 },
    { query: { enabled: open } },
  );
  const filtered = res?.products ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Sélectionnez un article", "اختيار منتج")}</DialogTitle>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filtre", "بحث")}
          className="h-10" autoFocus data-testid="input-article-filter" />
        <div className="max-h-[55vh] overflow-y-auto border rounded">
          {isFetching ? (
            <div className="text-center py-10 text-muted-foreground text-sm">{t("Chargement…", "جارٍ التحميل…")}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">{t("Aucun article", "لا توجد مقالات")}</div>
          ) : (
            filtered.map((p) => (
              <button key={p.id} type="button"
                className="w-full text-left px-3 py-2 border-b hover:bg-blue-50 transition-colors"
                onClick={() => onPick(p)} data-testid={`button-pick-article-${p.id}`}>
                <div className="font-semibold uppercase text-sm">{p.nameEn || p.nameAr}</div>
                <div className="text-xs text-muted-foreground">
                  {p.reference ?? p.barcode ?? `#${p.id}`} · {parseFloat(p.price ?? "0").toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} DZD
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Charges Manager Dialog ───────────────────────────────────────────────────
function ChargesManagerDialog({
  open, onOpenChange, pos, supplierMap,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  pos: ExtendedPO[]; supplierMap: Record<number, Supplier>;
}) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;

  const { data: charges, isLoading } = useGetPurchaseAnnexeCharges();
  const createCharge = useCreatePurchaseAnnexeCharge();
  const deleteCharge = useDeletePurchaseAnnexeCharge();

  const [showCreate, setShowCreate] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [selectedPoIds, setSelectedPoIds] = useState<number[]>([]);

  React.useEffect(() => {
    if (!open) { setShowCreate(false); setDescription(""); setAmount(""); setSelectedPoIds([]); setNotes(""); }
  }, [open]);

  const amountNum = parseFloat(amount);
  const selectedPos = useMemo(() => pos.filter(p => selectedPoIds.includes(p.id)), [pos, selectedPoIds]);
  const totalPurchaseValue = selectedPos.reduce((s, p) => s + parseFloat(p.totalAmount ?? "0"), 0);

  function togglePo(id: number) {
    setSelectedPoIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function handleCreate() {
    if (!description.trim() || !amount || selectedPoIds.length === 0 || isNaN(amountNum) || amountNum <= 0) return;
    createCharge.mutate({ data: { description: description.trim(), totalAmount: amountNum, date, notes: notes || undefined, purchaseOrderIds: selectedPoIds } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPurchaseAnnexeChargesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() });
        setShowCreate(false); setDescription(""); setAmount(""); setNotes(""); setSelectedPoIds([]);
      },
      onError: (err) => alert(`Erreur: ${(err as Error).message}`),
    });
  }

  const sortedPos = useMemo(() =>
    [...pos].sort((a, b) => new Date(b.createdAt ?? "").getTime() - new Date(a.createdAt ?? "").getTime()),
  [pos]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0">
        <div className="bg-orange-600 text-white px-5 py-3 flex items-center justify-between">
          <DialogHeader className="flex-1">
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <X className="h-4 w-4 cursor-pointer" onClick={() => onOpenChange(false)} />
              {t("Charges annexes", "المصاريف الإضافية")}
            </DialogTitle>
          </DialogHeader>
          <Button size="sm" className="bg-white text-orange-700 hover:bg-orange-50 h-7 text-xs"
            onClick={() => setShowCreate(v => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("Nouveau", "جديد")}
          </Button>
        </div>

        <div className="p-5 space-y-4">
          {showCreate && (
            <Card className="border border-orange-200 shadow-sm">
              <div className="bg-orange-50 px-4 py-2.5 border-b">
                <h3 className="font-semibold text-orange-800 text-sm">{t("Nouvelle charge annexe", "مصروف إضافي جديد")}</h3>
              </div>
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs mb-1 block">{t("Description *", "الوصف *")}</Label>
                    <Input value={description} onChange={e => setDescription(e.target.value)}
                      placeholder={t("Ex: Frais de transport, Douanes…", "مثال: فروع الشحن، الجمارك…")} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">{t("Date *", "التاريخ *")}</Label>
                    <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">{t("Montant total (DA) *", "المبلغ الإجمالي (DA) *")}</Label>
                    <Input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">{t("Notes", "ملاحظات")}</Label>
                    <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="…" className="h-9" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs mb-1 block">
                    {t("Bons d'achat concernés *", "بونات الشراء المعنية *")}
                    {selectedPoIds.length > 0 && (
                      <span className="ml-2 text-orange-600 font-semibold">
                        ({selectedPoIds.length} {t("sélectionné(s)", "مختار")})
                        {!isNaN(amountNum) && amountNum > 0 && totalPurchaseValue > 0 && (
                          <span className="ml-1 text-muted-foreground font-normal text-xs">
                            — {t("valeur totale", "القيمة الإجمالية")} {fmt(totalPurchaseValue)} DA
                          </span>
                        )}
                      </span>
                    )}
                  </Label>
                  <div className="border rounded-md max-h-52 overflow-y-auto divide-y">
                    {sortedPos.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-sm italic">{t("Aucun bon d'achat", "لا توجد بونات شراء")}</div>
                    ) : sortedPos.map(po => {
                      const checked = selectedPoIds.includes(po.id);
                      const poValue = parseFloat(po.totalAmount ?? "0");
                      const estimatedCharge = !isNaN(amountNum) && amountNum > 0 && totalPurchaseValue > 0
                        ? (poValue / totalPurchaseValue) * amountNum : null;
                      return (
                        <label key={po.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 ${checked ? "bg-orange-50" : ""}`}>
                          <input type="checkbox" checked={checked} onChange={() => togglePo(po.id)} className="accent-orange-600 h-4 w-4" />
                          <span className="flex-1 text-sm">
                            <span className="font-semibold text-slate-700">N°{String(po.id).padStart(6, "0")}</span>
                            <span className="text-muted-foreground ml-2 text-xs">{po.createdAt ? format(new Date(po.createdAt), "yyyy-MM-dd") : ""}</span>
                            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-medium ${statusClass(po.status)}`}>{statusLabel(po.status, t)}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{supplierMap[po.supplierId]?.name ?? ""}</span>
                          </span>
                          <span className="tabular-nums text-sm font-semibold text-slate-700">{fmt(poValue)} DA</span>
                          {checked && estimatedCharge !== null && (
                            <span className="text-xs text-orange-600 font-semibold w-24 text-right">≈ {fmt(estimatedCharge)} DA</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>{t("Annuler", "إلغاء")}</Button>
                  <Button size="sm" className="bg-orange-600 hover:bg-orange-700"
                    onClick={handleCreate}
                    disabled={createCharge.isPending || !description.trim() || !amount || selectedPoIds.length === 0 || isNaN(amountNum) || amountNum <= 0}>
                    <Save className="h-3.5 w-3.5 mr-1" />
                    {createCharge.isPending ? t("Enregistrement…", "جارٍ الحفظ…") : t("Enregistrer", "حفظ")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border shadow-sm">
            <div className="bg-slate-50 px-4 py-2.5 border-b">
              <h3 className="font-semibold text-sm">{t("Charges enregistrées", "المصاريف المسجلة")} ({(charges ?? []).length})</h3>
            </div>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : (charges ?? []).length === 0 ? (
                <div className="text-center py-10 text-muted-foreground italic text-sm">{t("Aucune charge enregistrée", "لا توجد مصاريف مسجلة")}</div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50/50">
                    <TableRow>
                      <TableHead>{t("Date", "التاريخ")}</TableHead>
                      <TableHead>{t("Description", "الوصف")}</TableHead>
                      <TableHead className="text-center">{t("Bons", "البونات")}</TableHead>
                      <TableHead className="text-right">{t("Montant", "المبلغ")}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(charges as PurchaseAnnexeCharge[]).map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm text-muted-foreground">{c.date}</TableCell>
                        <TableCell className="font-medium">{c.description}</TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {(c.purchaseOrderIds ?? []).map(id => `N°${String(id).padStart(6, "0")}`).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums text-orange-700">
                          {fmt(parseFloat(c.totalAmount ?? "0"))} DA
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500"
                            onClick={() => {
                              if (!confirm(t(
                                `Supprimer "${c.description}" ? Cette action recalculera les CUMP des produits concernés.`,
                                `حذف "${c.description}"؟ سيعيد هذا احتساب CUMP للمنتجات المتأثرة.`
                              ))) return;
                              deleteCharge.mutate({ id: c.id }, {
                                onSuccess: () => {
                                  qc.invalidateQueries({ queryKey: getGetPurchaseAnnexeChargesQueryKey() });
                                  qc.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() });
                                },
                                onError: err => alert(`Erreur: ${(err as Error).message}`),
                              });
                            }}
                            disabled={deleteCharge.isPending}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}

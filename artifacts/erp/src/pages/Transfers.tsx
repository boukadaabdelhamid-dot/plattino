import React, { useMemo, useState } from "react";
import {
  useGetErpTransfers,
  useGetErpTransfer,
  useCreateErpTransfer,
  useApproveErpTransfer,
  useRejectErpTransfer,
  usePrepareErpTransfer,
  useShipErpTransfer,
  useReceiveErpTransfer,
  useCancelErpTransfer,
  useGetProducts,
  useGetErpStoresAll,
  getGetErpTransfersQueryKey,
  getGetErpTransferQueryKey,
  type StockTransferSummary,
  type StockTransferDetail,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useMe } from "@/hooks/use-me";
import { useStoreContext } from "@/hooks/use-store";
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeftRight, Plus, Send, CheckCircle2, XCircle, PackageCheck, Truck, Inbox, Ban, Trash2, ScanLine, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

type TrFn = (fr: string, ar: string) => string;

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

const STATUS_LABELS: Record<string, { fr: string; ar: string; cls: string }> = {
  requested:  { fr: "Demandé",      ar: "طلب",        cls: "bg-blue-100 text-blue-700 border border-blue-200" },
  approved:   { fr: "Approuvé",     ar: "مقبول",       cls: "bg-emerald-100 text-emerald-700 border border-emerald-200" },
  rejected:   { fr: "Rejeté",       ar: "مرفوض",       cls: "bg-red-100 text-red-700 border border-red-200" },
  prepared:   { fr: "Préparé",      ar: "محضّر",       cls: "bg-amber-100 text-amber-700 border border-amber-200" },
  in_transit: { fr: "En transit",   ar: "في الطريق",   cls: "bg-purple-100 text-purple-700 border border-purple-200" },
  received:   { fr: "Reçu",         ar: "مستلم",       cls: "bg-teal-100 text-teal-700 border border-teal-200" },
  cancelled:  { fr: "Annulé",       ar: "ملغى",        cls: "bg-gray-100 text-gray-600 border border-gray-200" },
};

function StatusBadge({ status }: { status: string }) {
  const { lang } = useLang();
  const s = STATUS_LABELS[status] ?? { fr: status, ar: status, cls: "bg-gray-100" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${s.cls}`}>
      {lang === "ar" ? s.ar : s.fr}
    </span>
  );
}

type LineDraft = { sourceProductId: string; quantity: string };

type ProductLite = {
  id: number;
  nameEn: string;
  nameAr: string;
  reference?: string | null;
  barcode?: string | null;
  stock: number;
};

function productKey(p: ProductLite): string | null {
  return p.reference || p.barcode || null;
}

function findByCode(products: ProductLite[], raw: string): ProductLite | undefined {
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  return products.find(
    (p) =>
      (p.barcode ?? "").toLowerCase() === t ||
      (p.reference ?? "").toLowerCase() === t,
  );
}

export default function Transfers() {
  const qc = useQueryClient();
  const { user, isAdmin } = useMe();
  const { currentStoreId } = useStoreContext();
  const { lang } = useLang();
  const tr: TrFn = (fr, ar) => lang === "ar" ? ar : fr;
  const [direction, setDirection] = useState<"in" | "out" | "all">("all");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const queryParams = statusFilter
    ? ({ direction, status: statusFilter } as Parameters<typeof useGetErpTransfers>[0])
    : ({ direction } as Parameters<typeof useGetErpTransfers>[0]);
  const { data: transfers, isLoading } = useGetErpTransfers(queryParams);
  const [openCreate, setOpenCreate] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const { data: allStores } = useGetErpStoresAll();
  const otherStores = ((allStores ?? []) as Array<{ id: number; nameEn: string; nameAr: string; isActive?: boolean }>)
    .filter((s) => s.id !== currentStoreId && s.isActive !== false);
  void user;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-primary" />
            {tr("Transferts", "التحويلات")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tr("Transferts de stock inter-magasins", "تحويلات المخزون بين المتاجر")}
          </p>
        </div>
        <Button
          onClick={() => setOpenCreate(true)}
          disabled={otherStores.length === 0}
          data-testid="button-new-transfer"
        >
          <Plus className="h-4 w-4 mr-2" /> {tr("Nouveau transfert", "تحويل جديد")}
        </Button>
      </div>

      <Tabs value={direction} onValueChange={(v) => setDirection(v as "in" | "out" | "all")}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all">{tr("Tous", "الكل")}</TabsTrigger>
            <TabsTrigger value="in" data-testid="tab-in">
              <Inbox className="h-3.5 w-3.5 mr-1" /> {tr("Entrants", "واردة")}
            </TabsTrigger>
            <TabsTrigger value="out" data-testid="tab-out">
              <Send className="h-3.5 w-3.5 mr-1" /> {tr("Sortants", "صادرة")}
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">{tr("Statut", "الحالة")}</Label>
            <Select value={statusFilter || "__all"} onValueChange={(v) => setStatusFilter(v === "__all" ? "" : v)}>
              <SelectTrigger className="h-8 text-sm w-44" data-testid="select-status-filter">
                <SelectValue placeholder={tr("Tous les statuts", "كل الحالات")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{tr("Tous", "الكل")}</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{lang === "ar" ? v.ar : v.fr}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <TabsContent value={direction}>
          <Card className="border shadow-sm mt-3">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>{tr("De", "من")}</TableHead>
                        <TableHead>{tr("À", "إلى")}</TableHead>
                        <TableHead>{tr("Articles", "أصناف")}</TableHead>
                        <TableHead>{tr("Qté", "كمية")}</TableHead>
                        <TableHead>{tr("Statut", "الحالة")}</TableHead>
                        <TableHead>{tr("Par", "بواسطة")}</TableHead>
                        <TableHead>{tr("Date", "التاريخ")}</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(transfers ?? []).map((t: StockTransferSummary) => {
                        const isOutgoing = t.sourceStoreId === currentStoreId;
                        return (
                          <TableRow key={t.id} data-testid={`row-transfer-${t.id}`}>
                            <TableCell className="font-mono text-xs">#{t.id}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                {!isOutgoing && <Inbox className="h-3.5 w-3.5 text-muted-foreground" />}
                                <span className="text-sm">{t.sourceStore?.nameEn ?? `#${t.sourceStoreId}`}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                {isOutgoing && <Send className="h-3.5 w-3.5 text-muted-foreground" />}
                                <span className="text-sm">{t.destinationStore?.nameEn ?? `#${t.destinationStoreId}`}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{t.itemCount ?? 0}</TableCell>
                            <TableCell className="text-sm font-semibold tabular-nums">{t.totalQuantity ?? 0}</TableCell>
                            <TableCell><StatusBadge status={t.status} /></TableCell>
                            <TableCell className="text-xs text-muted-foreground" data-testid={`text-initiator-${t.id}`}>
                              {t.initiatorUser?.name || t.initiatorUser?.email || `#${t.initiatorUserId ?? "?"}`}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {t.createdAt ? format(new Date(t.createdAt), "MMM d, HH:mm") : "—"}
                            </TableCell>
                            <TableCell>
                              <Button size="sm" variant="outline" onClick={() => setDetailId(t.id)} data-testid={`button-open-transfer-${t.id}`}>
                                {tr("Ouvrir", "فتح")}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {(!transfers || transfers.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                            {tr("Aucun transfert", "لا توجد تحويلات")}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CreateTransferDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        otherStores={otherStores}
        isAdmin={isAdmin}
        onCreated={() => qc.invalidateQueries({ queryKey: getGetErpTransfersQueryKey(queryParams) })}
      />
      {detailId !== null && (
        <TransferDetailDialog
          id={detailId}
          open={detailId !== null}
          onOpenChange={(o) => { if (!o) setDetailId(null); }}
          isAdmin={isAdmin}
          currentStoreId={currentStoreId}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: getGetErpTransferQueryKey(detailId) });
            qc.invalidateQueries({ queryKey: getGetErpTransfersQueryKey(queryParams) });
          }}
        />
      )}
    </div>
  );
}

// ─── Shared product search bar ─────────────────────────────────────
function ProductSearchBar({ products, disabled, onPick, tr, totalCount, autoFocus }: {
  products: ProductLite[];
  disabled?: boolean;
  onPick: (p: ProductLite) => void;
  tr: TrFn;
  totalCount?: number;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const tok = query.trim().toLowerCase();
    if (!tok) return [] as ProductLite[];
    const exact = findByCode(products, tok);
    if (exact) return [exact];
    return products
      .filter(
        (p) =>
          (p.nameEn ?? "").toLowerCase().includes(tok) ||
          (p.nameAr ?? "").toLowerCase().includes(tok) ||
          (p.reference ?? "").toLowerCase().includes(tok) ||
          (p.barcode ?? "").toLowerCase().includes(tok),
      )
      .slice(0, 8);
  }, [query, products]);

  function pick(p: ProductLite) {
    setError(null);
    setQuery("");
    onPick(p);
  }

  function handleSubmit() {
    const tok = query.trim();
    if (!tok) return;
    const found = findByCode(products, tok);
    if (found) { pick(found); return; }
    if (candidates.length === 1) { pick(candidates[0]); return; }
    if (candidates.length > 1) {
      setError(tr(`Plusieurs résultats pour "${tok}" — choisissez dans la liste.`, `عدة نتائج لـ "${tok}" — اختر من القائمة.`));
      return;
    }
    setError(tr(`Aucun produit ne correspond à "${tok}".`, `لا يوجد منتج يطابق "${tok}".`));
  }

  return (
    <div className="mb-3 relative">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <ScanLine className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
            placeholder={
              disabled
                ? tr("Sélectionnez d'abord le magasin source", "اختر المتجر المصدر أولاً")
                : tr("Scanner ou saisir ref/code-barres/nom…", "امسح أو أدخل مرجع/باركود/اسم…")
            }
            className="h-9 text-sm pl-8"
            disabled={disabled}
            autoFocus={autoFocus && !disabled}
            data-testid="input-scan"
          />
        </div>
        <Button
          type="button" size="sm" variant="outline"
          onClick={handleSubmit}
          disabled={!query.trim() || !!disabled}
          data-testid="button-scan-add"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> {tr("Ajouter", "إضافة")}
        </Button>
      </div>
      {candidates.length > 0 && (
        <div className="mt-1 border rounded-md bg-white shadow-sm max-h-56 overflow-y-auto" data-testid="scan-candidates">
          {candidates.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-b-0"
              onClick={() => pick(p)}
              data-testid={`button-pick-product-${p.id}`}
            >
              <div className="text-sm font-medium">{p.nameEn || p.nameAr}</div>
              <div className="text-[11px] text-muted-foreground font-mono">
                {p.reference ?? "—"} {p.barcode ? `· ${p.barcode}` : ""} · {tr("stock", "مخزون")} {p.stock}
              </div>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="text-[11px] text-red-600 mt-1" data-testid="text-scan-error">{error}</p>
      )}
      {totalCount !== undefined && totalCount > products.length && (
        <p className="text-[11px] text-muted-foreground mt-1">
          {totalCount - products.length} {tr("produit(s) masqués — référence/code-barres manquant.", "منتج مخفي — مرجع/باركود مفقود.")}
        </p>
      )}
    </div>
  );
}

// ─── Create dialog ────────────────────────────────────────────────
function CreateTransferDialog({
  open, onOpenChange, otherStores, isAdmin, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  otherStores: Array<{ id: number; nameEn: string; nameAr: string }>;
  isAdmin: boolean;
  onCreated: () => void;
}) {
  const { lang } = useLang();
  const tr: TrFn = (fr, ar) => lang === "ar" ? ar : fr;
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [otherStoreId, setOtherStoreId] = useState("");
  const [mode, setMode] = useState<"request" | "send">("request");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const { data: productsRes } = useGetProducts({ limit: 500 });
  const products = (productsRes?.products ?? []) as ProductLite[];
  const create = useCreateErpTransfer();

  const { data: inboundData } = useQuery({
    queryKey: ["/api/erp/stores/products", Number(otherStoreId)],
    enabled: direction === "in" && !!otherStoreId,
    queryFn: async () => {
      const token = localStorage.getItem("midanic_token");
      const res = await fetch(`${API_BASE}/api/erp/stores/${otherStoreId}/products`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ products: ProductLite[] }>;
    },
    staleTime: 30_000,
  });
  const inboundProducts = (inboundData?.products ?? []) as ProductLite[];
  const inboundMatchable = useMemo(
    () => inboundProducts,
    [inboundProducts],
  );

  const removeLine = (i: number) => setLines((l) => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const reset = () => {
    setDirection("out"); setOtherStoreId(""); setMode("request"); setNotes("");
    setLines([]);
  };

  React.useEffect(() => {
    if (direction === "in" && mode === "send") setMode("request");
  }, [direction, mode]);

  React.useEffect(() => {
    setLines([]);
  }, [direction, otherStoreId]);

  const matchableProducts = useMemo(
    () => products.filter((p) => productKey(p) !== null),
    [products],
  );

  function addProductToLines(p: ProductLite) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => Number(l.sourceProductId) === p.id);
      if (idx >= 0) {
        return prev.map((l, i) =>
          i === idx ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l,
        );
      }
      return [...prev, { sourceProductId: String(p.id), quantity: "1" }];
    });
  }

  const linesWithProduct = useMemo(
    () =>
      lines.map((l) => ({
        ...l,
        product:
          direction === "out"
            ? products.find((p) => p.id === Number(l.sourceProductId))
            : inboundProducts.find((p) => p.id === Number(l.sourceProductId)),
      })),
    [lines, products, inboundProducts, direction],
  );

  const hasUnmatchable =
    direction === "out" &&
    linesWithProduct.some((l) => l.product && productKey(l.product) === null);
  const hasOverstock =
    direction === "out" &&
    linesWithProduct.some(
      (l) => l.product && Number(l.quantity) > (l.product.stock ?? 0),
    );

  const valid = useMemo(() => {
    if (!otherStoreId) return false;
    if (lines.length === 0) return false;
    if (!lines.every((l) => l.sourceProductId && Number(l.quantity) > 0)) return false;
    if (hasUnmatchable) return false;
    return true;
  }, [otherStoreId, lines, hasUnmatchable]);

  const submit = () => {
    const otherId = Number(otherStoreId);
    create.mutate(
      {
        data: {
          ...(direction === "out"
            ? { destinationStoreId: otherId }
            : { sourceStoreId: otherId }),
          mode,
          notes: notes || undefined,
          items: lines.map((l) => ({
            sourceProductId: Number(l.sourceProductId),
            quantity: Number(l.quantity),
          })),
        },
      },
      {
        onSuccess: () => { reset(); onCreated(); onOpenChange(false); },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr("Nouveau transfert", "تحويل جديد")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs mb-1 block">{tr("Direction", "الاتجاه")}</Label>
            <div className="flex gap-2">
              <Button
                type="button" size="sm"
                variant={direction === "out" ? "default" : "outline"}
                onClick={() => setDirection("out")}
                data-testid="button-direction-out"
              >
                <Send className="h-3.5 w-3.5 mr-1" /> {tr("Envoyer vers un autre magasin", "إرسال إلى متجر آخر")}
              </Button>
              <Button
                type="button" size="sm"
                variant={direction === "in" ? "default" : "outline"}
                onClick={() => setDirection("in")}
                data-testid="button-direction-in"
              >
                <Inbox className="h-3.5 w-3.5 mr-1" /> {tr("Demander depuis un autre magasin", "طلب من متجر آخر")}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">
                {direction === "out" ? tr("Magasin destination", "المتجر الوجهة") : tr("Magasin source", "المتجر المصدر")}
              </Label>
              <Select value={otherStoreId} onValueChange={setOtherStoreId}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-other-store">
                  <SelectValue placeholder={tr("Choisir un magasin", "اختر متجراً")} />
                </SelectTrigger>
                <SelectContent>
                  {otherStores.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.nameEn} / {s.nameAr}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{tr("Mode", "الوضع")}</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "request" | "send")} disabled={direction === "in"}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="request">
                    {direction === "out" ? tr("Demander approbation", "طلب موافقة") : tr("Demande d'extraction", "طلب سحب")}
                  </SelectItem>
                  {isAdmin && direction === "out" && (
                    <SelectItem value="send">{tr("Envoyer directement (admin)", "إرسال مباشر (مسؤول)")}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {mode === "send" && direction === "out" && (
                <p className="text-[11px] text-amber-700 mt-1">
                  {tr("Le stock sera déduit immédiatement de la source.", "سيخصم المخزون فوراً من المصدر.")}
                </p>
              )}
              {direction === "in" && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {tr("L'admin source doit approuver.", "يجب على إدارة المصدر الموافقة.")}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs mb-2 block">{tr("Articles", "الأصناف")}</Label>

            <ProductSearchBar
              key={`${direction}-${otherStoreId}`}
              products={direction === "out" ? matchableProducts : inboundMatchable}
              disabled={direction === "in" && !otherStoreId}
              onPick={addProductToLines}
              tr={tr}
              totalCount={direction === "out" ? products.length : inboundProducts.length}
              autoFocus={direction === "out"}
            />

            {hasUnmatchable && (
              <div className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{tr("Certaines lignes n'ont pas de référence/code-barres et ne peuvent être appariées côté destination. Supprimez-les avant de soumettre.", "بعض الأسطر بدون مرجع أو باركود — أزلها قبل الإرسال.")}</span>
              </div>
            )}
            {hasOverstock && (
              <div className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{tr("Une ou plusieurs lignes dépassent le stock source disponible.", "بعض الأسطر تتجاوز المخزون المتاح.")}</span>
              </div>
            )}

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {lines.length === 0 && (
                <div className="text-xs text-muted-foreground border border-dashed rounded px-3 py-4 text-center">
                  {direction === "in" && !otherStoreId
                    ? tr("Sélectionnez un magasin source puis recherchez un produit.", "اختر المتجر المصدر ثم ابحث عن منتج.")
                    : tr("Scannez ou recherchez un produit ci-dessus.", "امسح أو ابحث عن منتج أعلاه.")}
                </div>
              )}
              {linesWithProduct.map((line, i) => {
                const p = line.product;
                const noKey = direction === "out" && p && productKey(p) === null;
                const qtyN = Number(line.quantity);
                const overStock = direction === "out" && p && qtyN > (p.stock ?? 0);
                return (
                  <div key={i} className="flex gap-2 items-start border rounded px-2 py-1.5">
                    <div className="flex-1 min-w-0">
                      {p ? (
                        <>
                          <div className="text-sm font-medium truncate">{p.nameEn || p.nameAr}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {p.reference ?? "—"} {p.barcode ? `· ${p.barcode}` : ""} · {tr("stock", "مخزون")} {p.stock}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground">{tr("Produit", "منتج")} #{line.sourceProductId} ({tr("inconnu", "غير معروف")})</div>
                      )}
                      {noKey && (
                        <p className="text-[11px] text-red-600 mt-1" data-testid={`text-line-nokey-${i}`}>
                          {tr("Pas de référence/code-barres — impossible d'apparier entre magasins.", "لا مرجع/باركود — لا يمكن المطابقة بين المتاجر.")}
                        </p>
                      )}
                      {overStock && (
                        <p className="text-[11px] text-amber-700 mt-1" data-testid={`text-line-overstock-${i}`}>
                          {tr(`Stock insuffisant — seulement ${p?.stock ?? 0} disponible.`, `مخزون غير كافٍ — ${p?.stock ?? 0} فقط متاح.`)}
                        </p>
                      )}
                    </div>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 text-sm w-20"
                      value={line.quantity}
                      onChange={(e) => updateLine(i, { quantity: e.target.value })}
                      data-testid={`input-qty-${i}`}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeLine(i)} data-testid={`button-remove-line-${i}`}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1 block">{tr("Notes", "ملاحظات")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 text-sm" />
          </div>

          {create.error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {(create.error as { error?: string })?.error ?? String(create.error)}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tr("Annuler", "إلغاء")}</Button>
          <Button onClick={submit} disabled={!valid || create.isPending} data-testid="button-submit-transfer">
            {mode === "send" ? tr("Envoyer", "إرسال") : tr("Demander", "طلب")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detail dialog ────────────────────────────────────────────────
function TransferDetailDialog({
  id, open, onOpenChange, isAdmin, currentStoreId, onChanged,
}: {
  id: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  currentStoreId: number | null;
  onChanged: () => void;
}) {
  const { lang } = useLang();
  const tr: TrFn = (fr, ar) => lang === "ar" ? ar : fr;
  const { data: detail, isLoading } = useGetErpTransfer(id);
  const approve = useApproveErpTransfer();
  const reject = useRejectErpTransfer();
  const prepare = usePrepareErpTransfer();
  const ship = useShipErpTransfer();
  const receive = useReceiveErpTransfer();
  const cancel = useCancelErpTransfer();

  const td = detail as StockTransferDetail | undefined;
  const isSource = td ? currentStoreId === td.sourceStoreId : false;
  const isDest = td ? currentStoreId === td.destinationStoreId : false;

  const act = (m: { mutate: (v: { id: number }, opts: { onSuccess: () => void }) => void }) => {
    m.mutate({ id }, { onSuccess: () => onChanged() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tr("Transfert", "تحويل")} #{id}
            {td && <StatusBadge status={td.status} />}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !td ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">{tr("De", "من")}</div>
                <div className="font-medium">{td.sourceStore?.nameEn ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{tr("À", "إلى")}</div>
                <div className="font-medium">{td.destinationStore?.nameEn ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{tr("Initié par", "بدأ بواسطة")}</div>
                <div className="font-medium" data-testid="text-detail-initiator">
                  {td.initiatorUser?.name || td.initiatorUser?.email || `#${td.initiatorUserId ?? "?"}`}
                  <span className="text-xs text-muted-foreground ml-1">({td.initiatorSide})</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{tr("Créé le", "أُنشئ")}</div>
                <div className="font-medium text-sm">
                  {td.createdAt ? format(new Date(td.createdAt), "MMM d, yyyy HH:mm") : "—"}
                </div>
              </div>
              {td.notes && (
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">{tr("Notes", "ملاحظات")}</div>
                  <div className="text-sm">{td.notes}</div>
                </div>
              )}
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">{tr("Articles", "الأصناف")}</div>
              <div className="border rounded overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("Produit", "المنتج")}</TableHead>
                      <TableHead>{tr("Clé appariement", "مفتاح المطابقة")}</TableHead>
                      <TableHead className="text-right">{tr("Qté", "الكمية")}</TableHead>
                      <TableHead className="text-right">{tr("Stock source", "مخزون المصدر")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {td.items?.map((it) => {
                      const insufficient = typeof it.sourceProductStock === "number" && it.sourceProductStock < it.quantity;
                      return (
                        <TableRow key={it.id}>
                          <TableCell className="text-sm">{it.sourceProductNameEn ?? `#${it.sourceProductId}`}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{it.matchKey}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{it.quantity}</TableCell>
                          <TableCell className={`text-right tabular-nums ${insufficient ? "text-red-600 font-semibold" : ""}`}>
                            {it.sourceProductStock ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">{tr("Historique", "السجل")}</div>
              <div className="space-y-1.5">
                {td.events?.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-xs">
                    <StatusBadge status={e.status} />
                    <span className="text-muted-foreground">
                      {e.createdAt ? format(new Date(e.createdAt), "MMM d, HH:mm") : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {tr("par", "بواسطة")} {e.actorUser?.name || e.actorUser?.email || `#${e.actorUserId}`}
                    </span>
                    {e.notes && <span className="text-muted-foreground italic">— {e.notes}</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t">
              {td.status === "requested" && isDest && (
                <>
                  <Button size="sm" onClick={() => act(approve)} disabled={approve.isPending} data-testid="button-approve">
                    <CheckCircle2 className="h-4 w-4 mr-1" /> {tr("Approuver", "قبول")}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => act(reject)} disabled={reject.isPending} data-testid="button-reject">
                    <XCircle className="h-4 w-4 mr-1" /> {tr("Rejeter", "رفض")}
                  </Button>
                </>
              )}
              {((td.status === "approved") || (td.status === "requested" && isAdmin)) && isSource && (
                <Button size="sm" onClick={() => act(prepare)} disabled={prepare.isPending} data-testid="button-prepare">
                  <PackageCheck className="h-4 w-4 mr-1" /> {tr("Préparer", "تجهيز")}
                </Button>
              )}
              {td.status === "prepared" && isSource && (
                <Button size="sm" onClick={() => act(ship)} disabled={ship.isPending} data-testid="button-ship">
                  <Truck className="h-4 w-4 mr-1" /> {tr("Expédier", "إرسال")}
                </Button>
              )}
              {td.status === "in_transit" && isDest && (
                <Button size="sm" onClick={() => act(receive)} disabled={receive.isPending} data-testid="button-receive">
                  <Inbox className="h-4 w-4 mr-1" /> {tr("Réceptionner", "استلام")}
                </Button>
              )}
              {!["received", "cancelled", "rejected"].includes(td.status) && isSource &&
               (!["prepared", "in_transit"].includes(td.status) || isAdmin) && (
                <Button size="sm" variant="outline" onClick={() => act(cancel)} disabled={cancel.isPending} data-testid="button-cancel-transfer">
                  <Ban className="h-4 w-4 mr-1" /> {tr("Annuler", "إلغاء")}
                </Button>
              )}
            </div>
            {(approve.error || reject.error || prepare.error || ship.error || receive.error || cancel.error) && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                {((approve.error || reject.error || prepare.error || ship.error || receive.error || cancel.error) as { error?: string })?.error ?? tr("Action échouée", "فشل الإجراء")}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tr("Fermer", "إغلاق")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

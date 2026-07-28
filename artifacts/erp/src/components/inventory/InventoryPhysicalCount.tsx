import { useState, useMemo, useRef, useEffect, memo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useGetInventoryCountSessions, useStartInventoryCount, useGetInventoryCountSession,
  useUpdateInventoryCountItem, useCompleteInventoryCount,
  getGetInventoryCountSessionsQueryKey, getGetInventoryCountSessionQueryKey,
  getGetInventoryStockQueryKey, getGetInventoryMovementsQueryKey,
  type InventoryCountSessionSummary, type InventoryCountItem, type InventoryCountSessionDetail,
} from "@workspace/api-client-react";
import { useLang } from "@/hooks/use-lang";
import { usePermissions } from "@/hooks/use-permissions";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ClipboardList, ClipboardCheck, Search } from "lucide-react";
import { format } from "date-fns";

// Height (px) of one virtualized product row. Must match the row's actual rendered height.
const ROW_HEIGHT = 49;

// Shared between the header and every row so their columns always line up pixel-for-pixel.
// Fixed columns are kept narrow so the flexible "product name" column always keeps enough
// room on small (mobile) viewports without forcing horizontal scroll. `min-w-0` on the name
// cell (see below) lets it truncate instead of growing the grid past the container width.
const ROW_GRID_COLS = "grid grid-cols-[1fr_56px_76px_60px] gap-2 px-3 items-center";

export default function InventoryPhysicalCount() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const { can } = usePermissions();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const canCount = can("inventory", "count");

  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

  const { data: sessions, isLoading } = useGetInventoryCountSessions();
  const startCount = useStartInventoryCount();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetInventoryCountSessionsQueryKey() });
  };

  const handleStart = () => {
    startCount.mutate(
      { data: {} },
      {
        onSuccess: (session) => {
          invalidateAll();
          setActiveSessionId(session.id);
        },
        onError: (err: any) => {
          toast({
            variant: "destructive",
            title: t("Erreur", "خطأ"),
            description: err?.error ?? t("Impossible de démarrer le comptage.", "تعذر بدء الجرد."),
          });
        },
      },
    );
  };

  const list: InventoryCountSessionSummary[] = sessions ?? [];
  const openSession = list.find((s) => s.status === "open");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t(
            "Comptez physiquement le stock et régularisez les écarts en une seule opération traçable.",
            "قم بعدّ المخزون فعلياً وقم بتسوية الفروقات في عملية واحدة قابلة للتتبع.",
          )}
        </p>
        {canCount && !openSession && (
          <Button onClick={handleStart} disabled={startCount.isPending} data-testid="button-start-count">
            <ClipboardList className="h-4 w-4 mr-2" /> {t("Nouveau jrd", "جرد جديد")}
          </Button>
        )}
      </div>

      {openSession && (
        <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800 text-sm">
          <span>
            <strong>{t("Session en cours", "جلسة جارية")}</strong> — {t("démarrée le", "بدأت في")}{" "}
            {openSession.createdAt ? format(new Date(openSession.createdAt), "dd/MM/yyyy HH:mm") : "—"}
            {openSession.createdByName ? ` (${openSession.createdByName})` : ""}
          </span>
          <Button size="sm" onClick={() => setActiveSessionId(openSession.id)} data-testid="button-continue-count">
            {t("Continuer le comptage", "متابعة الجرد")}
          </Button>
        </div>
      )}

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Date", "التاريخ")}</TableHead>
                    <TableHead>{t("Réalisé par", "أُجري بواسطة")}</TableHead>
                    <TableHead>{t("Statut", "الحالة")}</TableHead>
                    <TableHead className="text-right">{t("Comptés", "معدود")}</TableHead>
                    <TableHead className="text-right">{t("Écart total", "إجمالي الفرق")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((s) => (
                    <TableRow key={s.id} data-testid={`row-count-session-${s.id}`}>
                      <TableCell className="text-sm">
                        {s.createdAt ? format(new Date(s.createdAt), "dd/MM/yyyy HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.createdByName ?? "—"}</TableCell>
                      <TableCell>
                        {s.status === "open" ? (
                          <Badge className="bg-blue-100 text-blue-700 border border-blue-200">{t("En cours", "جارية")}</Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">{t("Terminé", "مكتملة")}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.countedCount}/{s.itemCount}</TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${s.totalVariance > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                        {s.totalVariance}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setActiveSessionId(s.id)} data-testid={`button-view-count-${s.id}`}>
                          {s.status === "open" ? t("Ouvrir", "فتح") : t("Détails", "التفاصيل")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {list.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {t("Aucune session de comptage", "لا توجد جلسات جرد")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {activeSessionId != null && (
        <CountSessionDialog
          sessionId={activeSessionId}
          canCount={canCount}
          onClose={() => setActiveSessionId(null)}
          onCompleted={() => {
            invalidateAll();
            qc.invalidateQueries({ queryKey: getGetInventoryStockQueryKey() });
            qc.invalidateQueries({ queryKey: getGetInventoryMovementsQueryKey() });
          }}
        />
      )}
    </div>
  );
}

function CountSessionDialog({
  sessionId, canCount, onClose, onCompleted,
}: {
  sessionId: number;
  canCount: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Debounce the search filter so typing doesn't recompute/re-render the whole list on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(id);
  }, [search]);

  const { data: session, isLoading } = useGetInventoryCountSession(sessionId);
  const updateItem = useUpdateInventoryCountItem();
  const completeCount = useCompleteInventoryCount();

  const sessionKey = getGetInventoryCountSessionQueryKey(sessionId);

  const isOpen = session?.status === "open";
  const items: InventoryCountItem[] = session?.items ?? [];
  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return items;
    const qLower = debouncedSearch.trim().toLowerCase();
    return items.filter((it) => it.nameEn?.toLowerCase().includes(qLower) || it.nameAr?.includes(debouncedSearch.trim()));
  }, [items, debouncedSearch]);

  const countedTotal = useMemo(() => items.filter((it) => it.countedQuantity != null).length, [items]);
  const varianceTotal = useMemo(() => items.reduce((sum, it) => sum + Math.abs(it.difference ?? 0), 0), [items]);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Patch just the one changed row in the cache instead of invalidating/refetching
  // the whole session (which can hold thousands of items) on every keystroke.
  const commitCount = (item: InventoryCountItem, value: number) => {
    updateItem.mutate(
      { id: sessionId, itemId: item.id, data: { countedQuantity: value } },
      {
        onSuccess: (updated) => {
          qc.setQueryData<InventoryCountSessionDetail>(sessionKey, (old) => {
            if (!old) return old;
            return {
              ...old,
              items: old.items.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)),
            };
          });
          qc.invalidateQueries({ queryKey: getGetInventoryCountSessionsQueryKey() });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("Erreur", "خطأ"),
            description: t("Échec de l'enregistrement de la quantité.", "فشل حفظ الكمية."),
          });
        },
      },
    );
  };

  const handleComplete = () => {
    completeCount.mutate(
      { id: sessionId },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          qc.invalidateQueries({ queryKey: sessionKey });
          qc.invalidateQueries({ queryKey: getGetInventoryCountSessionsQueryKey() });
          onCompleted();
          toast({ title: t("Jrd validé", "تم تأكيد الجرد"), description: t("Les écarts ont été régularisés.", "تمت تسوية الفروقات.") });
        },
        onError: (err: any) => {
          toast({
            variant: "destructive",
            title: t("Erreur", "خطأ"),
            description: err?.error ?? t("Échec de la validation.", "فشل التأكيد."),
          });
        },
      },
    );
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {isOpen ? t("Comptage en cours", "جرد جارٍ") : t("Détail du comptage", "تفاصيل الجرد")}
            </DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8 h-9"
                    placeholder={t("Rechercher un produit...", "بحث عن منتج...")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="input-search-count-product"
                  />
                </div>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {countedTotal}/{items.length} {t("comptés", "معدود")}
                </span>
              </div>

              <div className="flex-1 min-h-0 border rounded-md flex flex-col">
                <div className={`${ROW_GRID_COLS} py-2 bg-background text-xs font-medium text-muted-foreground sticky top-0 z-10`}>
                  <span className="min-w-0 truncate">{t("Produit", "المنتج")}</span>
                  <span className="text-right">{t("Système", "النظام")}</span>
                  <span className="text-right">{t("Compté", "المعدود")}</span>
                  <span className="text-right">{t("Écart", "الفرق")}</span>
                </div>
                <div ref={parentRef} className="flex-1 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                      {t("Aucun produit trouvé", "لم يتم العثور على منتج")}
                    </div>
                  ) : (
                    <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const item = filtered[virtualRow.index];
                        return (
                          <div
                            key={item.id}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            <CountItemRow
                              item={item}
                              lang={lang}
                              disabled={!isOpen || !canCount}
                              onCommit={commitCount}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>{t("Fermer", "إغلاق")}</Button>
            {isOpen && canCount && (
              <Button onClick={() => setConfirmOpen(true)} disabled={items.length === 0} data-testid="button-validate-count">
                <ClipboardCheck className="h-4 w-4 mr-2" /> {t("Valider le comptage", "تأكيد الجرد")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Confirmer la validation du jrd ?", "تأكيد الجرد؟")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `Le stock des produits comptés sera ajusté pour correspondre exactement aux quantités saisies. Écart total : ${varianceTotal}. Cette action est irréversible.`,
                `سيتم تعديل مخزون المنتجات المعدودة ليطابق تماماً الكميات المدخلة. إجمالي الفرق: ${varianceTotal}. هذا الإجراء لا يمكن التراجع عنه.`,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Annuler", "إلغاء")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleComplete} disabled={completeCount.isPending} data-testid="button-confirm-validate-count">
              {t("Confirmer", "تأكيد")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Isolated per-row component: keeps its own input state locally so typing in one
// row never triggers a re-render of the parent (and therefore the other rows).
// Only commits (onBlur) reach the network/cache layer.
const CountItemRow = memo(function CountItemRow({
  item, lang, disabled, onCommit,
}: {
  item: InventoryCountItem;
  lang: string;
  disabled: boolean;
  onCommit: (item: InventoryCountItem, value: number) => void;
}) {
  const [value, setValue] = useState(item.countedQuantity != null ? String(item.countedQuantity) : "");

  useEffect(() => {
    setValue(item.countedQuantity != null ? String(item.countedQuantity) : "");
  }, [item.countedQuantity]);

  const handleBlur = () => {
    const raw = value.trim();
    if (raw === "") return;
    const num = Number(raw);
    if (isNaN(num) || num < 0) return;
    if (num === item.countedQuantity) return;
    onCommit(item, num);
  };

  const name = (lang === "ar" ? item.nameAr : item.nameEn) || item.nameEn || item.nameAr;

  return (
    <div
      className={`${ROW_GRID_COLS} border-b h-full`}
      data-testid={`row-count-item-${item.id}`}
    >
      <span className="min-w-0 font-medium text-sm truncate" title={name || undefined}>
        {name || <span className="italic text-muted-foreground">{lang === "ar" ? "منتج بدون اسم" : "Produit sans nom"}</span>}
      </span>
      <span className="text-right tabular-nums text-muted-foreground text-sm">{item.systemQuantity}</span>
      <Input
        type="number"
        disabled={disabled}
        className="h-8 px-2 text-right tabular-nums"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        data-testid={`input-counted-${item.id}`}
      />
      <span className={`text-right font-semibold tabular-nums text-sm ${
        item.difference == null ? "text-muted-foreground" : item.difference === 0 ? "text-muted-foreground" : item.difference > 0 ? "text-emerald-600" : "text-red-600"
      }`}>
        {item.difference == null ? "—" : (item.difference > 0 ? `+${item.difference}` : item.difference)}
      </span>
    </div>
  );
});

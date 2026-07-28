import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInventoryCountSessions, useStartInventoryCount, useGetInventoryCountSession,
  useUpdateInventoryCountItem, useCompleteInventoryCount,
  getGetInventoryCountSessionsQueryKey, getGetInventoryCountSessionQueryKey,
  getGetInventoryStockQueryKey, getGetInventoryMovementsQueryKey,
  type InventoryCountSessionSummary, type InventoryCountItem,
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [localCounts, setLocalCounts] = useState<Record<number, string>>({});

  const { data: session, isLoading } = useGetInventoryCountSession(sessionId);
  const updateItem = useUpdateInventoryCountItem();
  const completeCount = useCompleteInventoryCount();

  const invalidateSession = () => {
    qc.invalidateQueries({ queryKey: getGetInventoryCountSessionQueryKey(sessionId) });
    qc.invalidateQueries({ queryKey: getGetInventoryCountSessionsQueryKey() });
  };

  const isOpen = session?.status === "open";
  const items: InventoryCountItem[] = session?.items ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((it) => it.nameEn?.toLowerCase().includes(q) || it.nameAr?.includes(search.trim()));
  }, [items, search]);

  const countedTotal = items.filter((it) => it.countedQuantity != null).length;
  const varianceTotal = items.reduce((sum, it) => sum + Math.abs(it.difference ?? 0), 0);

  const commitCount = (item: InventoryCountItem, raw: string) => {
    if (raw.trim() === "") return;
    const value = Number(raw);
    if (isNaN(value) || value < 0) return;
    if (value === item.countedQuantity) return;
    updateItem.mutate(
      { id: sessionId, itemId: item.id, data: { countedQuantity: value } },
      { onSuccess: invalidateSession },
    );
  };

  const handleComplete = () => {
    completeCount.mutate(
      { id: sessionId },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          invalidateSession();
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

              <div className="flex-1 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>{t("Produit", "المنتج")}</TableHead>
                      <TableHead className="text-right">{t("Système", "النظام")}</TableHead>
                      <TableHead className="text-right w-32">{t("Compté", "المعدود")}</TableHead>
                      <TableHead className="text-right">{t("Écart", "الفرق")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((it) => {
                      const value = localCounts[it.id] ?? (it.countedQuantity != null ? String(it.countedQuantity) : "");
                      return (
                        <TableRow key={it.id} data-testid={`row-count-item-${it.id}`}>
                          <TableCell className="font-medium text-sm">
                            {lang === "ar" ? it.nameAr : it.nameEn}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{it.systemQuantity}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              disabled={!isOpen || !canCount}
                              className="h-8 text-right tabular-nums"
                              value={value}
                              onChange={(e) => setLocalCounts((prev) => ({ ...prev, [it.id]: e.target.value }))}
                              onBlur={(e) => commitCount(it, e.target.value)}
                              data-testid={`input-counted-${it.id}`}
                            />
                          </TableCell>
                          <TableCell className={`text-right font-semibold tabular-nums ${
                            it.difference == null ? "text-muted-foreground" : it.difference === 0 ? "text-muted-foreground" : it.difference > 0 ? "text-emerald-600" : "text-red-600"
                          }`}>
                            {it.difference == null ? "—" : (it.difference > 0 ? `+${it.difference}` : it.difference)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                          {t("Aucun produit trouvé", "لم يتم العثور على منتج")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
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

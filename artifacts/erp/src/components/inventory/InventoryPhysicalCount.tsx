import { useState, useMemo, useRef, useEffect, memo } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useGetInventoryCountSessions, useStartInventoryCount, useGetInventoryCountSession,
  useUpdateInventoryCountItem, useCompleteInventoryCount, useGetInventoryFilterOptions,
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ClipboardList, ClipboardCheck, Search, Printer, RotateCcw } from "lucide-react";
import { format } from "date-fns";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

// Height (px) of one virtualized product row. Must match the row's actual rendered height.
const ROW_HEIGHT = 49;

// Shared between the header and every row so their columns always line up pixel-for-pixel.
// Fixed columns are kept narrow so the flexible "product name" column always keeps enough
// room on small (mobile) viewports without forcing horizontal scroll.
const ROW_GRID_COLS = "grid grid-cols-[1fr_56px_76px_60px] gap-2 px-3 items-center";

type CountedFilter = "all" | "counted" | "uncounted";

export default function InventoryPhysicalCount() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const { can } = usePermissions();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const canCount = can("inventory", "count");

  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

  // Dialog to enter an optional note before starting a new session
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [startNote, setStartNote] = useState("");

  // Alert to confirm closing the session directly from the banner
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const { data: sessions, isLoading } = useGetInventoryCountSessions();
  const startCount = useStartInventoryCount();
  // completeCount is also used here (for the banner "Fermer le jrd" shortcut)
  const completeCount = useCompleteInventoryCount();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetInventoryCountSessionsQueryKey() });
  };

  const handleStart = () => {
    startCount.mutate(
      // notes is accepted by the backend even though the generated type is {}
      { data: { notes: startNote.trim() || undefined } as Parameters<typeof startCount.mutate>[0]["data"] },
      {
        onSuccess: (session) => {
          invalidateAll();
          setActiveSessionId(session.id);
          setStartDialogOpen(false);
          setStartNote("");
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

  const handleCloseBanner = () => {
    if (!openSession) return;
    completeCount.mutate(
      { id: openSession.id },
      {
        onSuccess: () => {
          setCloseConfirmOpen(false);
          invalidateAll();
          qc.invalidateQueries({ queryKey: getGetInventoryStockQueryKey() });
          qc.invalidateQueries({ queryKey: getGetInventoryMovementsQueryKey() });
          toast({
            title: t("Jrd clôturé", "تم إغلاق الجرد"),
            description: t("Les écarts ont été régularisés.", "تمت تسوية الفروقات."),
          });
        },
        onError: (err: any) => {
          toast({
            variant: "destructive",
            title: t("Erreur", "خطأ"),
            description: err?.error ?? t("Échec de la clôture.", "فشل الإغلاق."),
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
          <Button onClick={() => setStartDialogOpen(true)} data-testid="button-start-count">
            <ClipboardList className="h-4 w-4 mr-2" /> {t("Nouveau jrd", "جرد جديد")}
          </Button>
        )}
      </div>

      {/* ── Start session dialog ── */}
      <Dialog open={startDialogOpen} onOpenChange={(o) => { if (!o) { setStartDialogOpen(false); setStartNote(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Démarrer un nouveau jrd", "بدء جرد جديد")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-sm text-muted-foreground mb-1.5 block">
              {t("Note / Nom (optionnel)", "ملاحظة / اسم (اختياري)")}
            </Label>
            <Input
              value={startNote}
              onChange={(e) => setStartNote(e.target.value)}
              placeholder={t("Ex : Jrd juillet 2026", "مثال: جرد يوليو 2026")}
              onKeyDown={(e) => { if (e.key === "Enter") handleStart(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setStartDialogOpen(false); setStartNote(""); }}>
              {t("Annuler", "إلغاء")}
            </Button>
            <Button onClick={handleStart} disabled={startCount.isPending} data-testid="button-confirm-start">
              <ClipboardList className="h-4 w-4 mr-2" />
              {startCount.isPending ? "..." : t("Démarrer", "بدء")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Open session banner ── */}
      {openSession && (
        <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800 text-sm gap-2 flex-wrap">
          <span>
            <strong>{t("Session en cours", "جلسة جارية")}</strong>
            {openSession.notes ? ` — ${openSession.notes}` : ""}
            {" — "}{t("démarrée le", "بدأت في")}{" "}
            {openSession.createdAt ? format(new Date(openSession.createdAt), "dd/MM/yyyy HH:mm") : "—"}
            {openSession.createdByName ? ` (${openSession.createdByName})` : ""}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={() => setActiveSessionId(openSession.id)} data-testid="button-continue-count">
              {t("Continuer le comptage", "متابعة الجرد")}
            </Button>
            {canCount && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setCloseConfirmOpen(true)}
                disabled={completeCount.isPending}
                data-testid="button-close-count-banner"
              >
                {t("Fermer le jrd", "غلق الجرد")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Close from banner — confirmation ── */}
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Fermer le jrd ?", "إغلاق الجرد؟")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Le stock des produits comptés sera ajusté selon les quantités saisies. Les produits non comptés ne seront pas modifiés. Cette action est irréversible.",
                "سيتم تعديل مخزون المنتجات المعدودة وفق الكميات المدخلة. المنتجات غير المعدودة لن تُعدَّل. هذا الإجراء لا يمكن التراجع عنه.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Annuler", "إلغاء")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCloseBanner}
              disabled={completeCount.isPending}
              data-testid="button-confirm-close-banner"
            >
              {completeCount.isPending ? "..." : t("Confirmer la clôture", "تأكيد الإغلاق")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Sessions list ── */}
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
                        <div>{s.createdAt ? format(new Date(s.createdAt), "dd/MM/yyyy HH:mm") : "—"}</div>
                        {s.notes && (
                          <div className="text-xs text-muted-foreground mt-0.5 max-w-[160px] truncate">{s.notes}</div>
                        )}
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
                        <div className="flex items-center justify-end gap-1">
                          {s.status === "completed" && canCount && !openSession && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-muted-foreground"
                              onClick={() => setActiveSessionId(s.id)}
                              title={t("Réouvrir pour modification", "إعادة الفتح للتعديل")}
                              data-testid={`button-reopen-count-${s.id}`}
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveSessionId(s.id)}
                            data-testid={`button-view-count-${s.id}`}
                          >
                            {s.status === "open" ? t("Ouvrir", "فتح") : t("Détails", "التفاصيل")}
                          </Button>
                        </div>
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
          hasOpenSession={!!openSession}
          onClose={() => setActiveSessionId(null)}
          onCompleted={() => {
            invalidateAll();
            qc.invalidateQueries({ queryKey: getGetInventoryStockQueryKey() });
            qc.invalidateQueries({ queryKey: getGetInventoryMovementsQueryKey() });
          }}
          onReopened={() => {
            invalidateAll();
          }}
        />
      )}
    </div>
  );
}

function CountSessionDialog({
  sessionId, canCount, hasOpenSession, onClose, onCompleted, onReopened,
}: {
  sessionId: number;
  canCount: boolean;
  hasOpenSession: boolean;
  onClose: () => void;
  onCompleted: () => void;
  onReopened: () => void;
}) {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [countedFilter, setCountedFilter] = useState<CountedFilter>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Debounce the search filter so typing doesn't recompute the whole list on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(id);
  }, [search]);

  const { data: session, isLoading } = useGetInventoryCountSession(sessionId);
  const { data: filterOptions } = useGetInventoryFilterOptions();
  const updateItem = useUpdateInventoryCountItem();
  const completeCount = useCompleteInventoryCount();

  // Reopen a completed session — no generated hook, use raw fetch
  const reopenSession = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("midanic_token") ?? "";
      const res = await fetch(`${API_BASE}/api/erp/inventory/count-sessions/${sessionId}/reopen`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw await res.json().catch(() => ({ error: "Erreur" }));
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetInventoryCountSessionQueryKey(sessionId) });
      onReopened();
      toast({ title: t("Session réouverte", "تمت إعادة فتح الجلسة") });
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: t("Erreur", "خطأ"),
        description: err?.error ?? t("Impossible de réouvrir.", "تعذرت إعادة الفتح."),
      });
    },
  });

  const sessionKey = getGetInventoryCountSessionQueryKey(sessionId);

  const isOpen = session?.status === "open";
  const items: InventoryCountItem[] = session?.items ?? [];

  const familyOptions = useMemo(
    () => (filterOptions?.families ?? []).map((f) => ({ value: String(f.id), labelFr: f.nameFr, labelAr: f.nameAr })),
    [filterOptions],
  );
  const brandOptions = useMemo(
    () => (filterOptions?.brands ?? []).map((b) => ({ value: String(b.id), labelFr: b.nameFr, labelAr: b.nameAr })),
    [filterOptions],
  );

  // All active filters applied cumulatively (AND).
  const filtered = useMemo(() => {
    const familyId = familyFilter ? Number(familyFilter) : null;
    const brandId = brandFilter ? Number(brandFilter) : null;
    const q = debouncedSearch.trim();
    const qLower = q.toLowerCase();
    return items.filter((it) => {
      if (familyId != null && it.familyId !== familyId) return false;
      if (brandId != null && it.brandId !== brandId) return false;
      if (q && !(it.nameEn?.toLowerCase().includes(qLower) || it.nameAr?.includes(q))) return false;
      if (countedFilter === "counted" && it.countedQuantity == null) return false;
      if (countedFilter === "uncounted" && it.countedQuantity != null) return false;
      return true;
    });
  }, [items, familyFilter, brandFilter, debouncedSearch, countedFilter]);

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
  // the whole session on every keystroke.
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

  // Open a new window with a printable version of the current (filtered) list.
  const handlePrint = () => {
    const pw = window.open("", "_blank");
    if (!pw) return;
    const note = session?.notes ? ` — ${session.notes}` : "";
    const dateStr = session?.createdAt ? format(new Date(session.createdAt), "dd/MM/yyyy HH:mm") : "";
    const rows = filtered.map((item) => {
      const name = (lang === "ar" ? item.nameAr : item.nameEn) || item.nameEn || item.nameAr || "—";
      const counted = item.countedQuantity != null ? String(item.countedQuantity) : "—";
      const diff = item.difference == null ? "—" : item.difference > 0 ? `+${item.difference}` : String(item.difference);
      const diffStyle = item.difference == null || item.difference === 0 ? "" : item.difference > 0 ? "color:#16a34a" : "color:#dc2626";
      return `<tr><td>${name}</td><td style="text-align:right">${item.systemQuantity}</td><td style="text-align:right">${counted}</td><td style="text-align:right;font-weight:600;${diffStyle}">${diff}</td></tr>`;
    }).join("");
    pw.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${lang === "ar" ? "جرد المخزون" : "Inventaire physique"}</title>
<style>body{font-family:sans-serif;font-size:13px;padding:20px}h2{margin-bottom:4px}p{margin:0 0 12px;color:#666}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 10px}th{background:#f3f4f6;font-weight:600}</style>
</head><body>
<h2>${lang === "ar" ? "جرد المخزون" : "Inventaire physique"}${note}</h2>
<p>${dateStr} — ${countedTotal}/${items.length} ${lang === "ar" ? "معدود" : "comptés"}</p>
<table><thead><tr>
<th>${lang === "ar" ? "المنتج" : "Produit"}</th>
<th style="text-align:right">${lang === "ar" ? "النظام" : "Système"}</th>
<th style="text-align:right">${lang === "ar" ? "المعدود" : "Compté"}</th>
<th style="text-align:right">${lang === "ar" ? "الفرق" : "Écart"}</th>
</tr></thead><tbody>${rows}</tbody></table>
</body></html>`);
    pw.document.close();
    pw.focus();
    pw.print();
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {isOpen ? t("Comptage en cours", "جرد جارٍ") : t("Détail du comptage", "تفاصيل الجرد")}
              {session?.notes && <span className="ml-2 text-sm font-normal text-muted-foreground">— {session.notes}</span>}
            </DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <>
              {/* Search + count + print */}
              <div className="flex items-center gap-2">
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
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-2.5"
                  onClick={handlePrint}
                  title={t("Imprimer la liste", "طباعة القائمة")}
                  data-testid="button-print-count"
                >
                  <Printer className="h-4 w-4" />
                </Button>
              </div>

              {/* Family / Brand filters */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="w-full sm:w-44">
                  <SearchableSelect
                    value={familyFilter}
                    onValueChange={setFamilyFilter}
                    options={familyOptions}
                    placeholder={t("Toutes les familles", "كل العائلات")}
                    searchPlaceholder={t("Rechercher une famille…", "ابحث عن عائلة...")}
                    noneLabel={t("Toutes les familles", "كل العائلات")}
                    emptyText={t("Aucun résultat", "لا توجد نتائج")}
                    className="h-9"
                  />
                </div>
                <div className="w-full sm:w-44">
                  <SearchableSelect
                    value={brandFilter}
                    onValueChange={setBrandFilter}
                    options={brandOptions}
                    placeholder={t("Toutes les marques", "كل الماركات")}
                    searchPlaceholder={t("Rechercher une marque…", "ابحث عن ماركة...")}
                    noneLabel={t("Toutes les marques", "كل الماركات")}
                    emptyText={t("Aucun résultat", "لا توجد نتائج")}
                    className="h-9"
                  />
                </div>
                {(familyFilter || brandFilter) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 text-xs text-muted-foreground"
                    onClick={() => { setFamilyFilter(""); setBrandFilter(""); }}
                    data-testid="button-clear-count-filters"
                  >
                    {t("Réinitialiser", "إعادة تعيين")}
                  </Button>
                )}
              </div>

              {/* Counted / uncounted toggle */}
              <div className="flex items-center gap-1.5">
                {(["all", "uncounted", "counted"] as CountedFilter[]).map((f) => (
                  <Button
                    key={f}
                    size="sm"
                    variant={countedFilter === f ? "default" : "outline"}
                    className="h-7 text-xs px-3"
                    onClick={() => setCountedFilter(f)}
                    data-testid={`button-count-filter-${f}`}
                  >
                    {f === "all"
                      ? t("Tout", "الكل")
                      : f === "counted"
                        ? t("Comptés", "المعدودة")
                        : t("Non comptés", "غير المعدودة")}
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground ml-auto">
                  {filtered.length !== items.length
                    ? `${filtered.length} / ${items.length}`
                    : `${items.length}`}{" "}
                  {t("produit(s)", "منتج")}
                </span>
              </div>

              {/* Virtualized list */}
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
            {/* Reopen a completed session — only if no other session is currently open */}
            {!isOpen && canCount && !hasOpenSession && (
              <Button
                variant="outline"
                onClick={() => reopenSession.mutate()}
                disabled={reopenSession.isPending}
                data-testid="button-reopen-session"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {reopenSession.isPending ? "..." : t("Réouvrir", "إعادة فتح")}
              </Button>
            )}
            {isOpen && canCount && (
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={items.length === 0}
                data-testid="button-validate-count"
              >
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
            <AlertDialogAction
              onClick={handleComplete}
              disabled={completeCount.isPending}
              data-testid="button-confirm-validate-count"
            >
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

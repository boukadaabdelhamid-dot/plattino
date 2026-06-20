import React, { useState } from "react";
import {
  useGetInventoryMovements, useAdjustInventory, useGetProducts,
  useGetInventoryStock,
  getGetInventoryMovementsQueryKey, getGetInventoryStockQueryKey,
  type ProductStockLevel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SlidersHorizontal, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

const MOVEMENT_TYPE_COLORS: Record<string, string> = {
  in: "bg-emerald-100 text-emerald-700",
  out: "bg-red-100 text-red-700",
  adjustment: "bg-blue-100 text-blue-700",
};

export default function Inventory() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const { data: movements, isLoading: movementsLoading } = useGetInventoryMovements();
  const { data: stockData, isLoading: stockLoading } = useGetInventoryStock();
  const { data: productsRes } = useGetProducts();
  const adjustInventory = useAdjustInventory();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ productId: "", quantity: "", reason: "" });

  const products = productsRes?.products ?? [];
  const productMap: Record<number, string> = {};
  products.forEach((p: any) => { productMap[p.id] = lang === "ar" ? p.nameAr : p.nameEn; });

  const handleSave = () => {
    adjustInventory.mutate(
      { data: { productId: parseInt(form.productId), quantity: parseInt(form.quantity), reason: form.reason } },
      { onSettled: () => { qc.invalidateQueries({ queryKey: getGetInventoryMovementsQueryKey() }); qc.invalidateQueries({ queryKey: getGetInventoryStockQueryKey() }); setOpen(false); } }
    );
  };

  const stockItems: ProductStockLevel[] = stockData ?? [];
  const alertItems = stockItems.filter((s) => s.status === "critical" || s.status === "low");
  const criticalCount = alertItems.filter((s) => s.status === "critical").length;

  const stockStatusLabels: Record<string, string> = {
    critical: t("Critique", "حرج"),
    low: t("Faible", "منخفض"),
    ok: "OK",
  };
  const stockStatusColors: Record<string, { badge: string; row: string }> = {
    critical: { badge: "bg-red-100 text-red-700 border border-red-200", row: "bg-red-50" },
    low: { badge: "bg-amber-100 text-amber-700 border border-amber-200", row: "bg-amber-50" },
    ok: { badge: "bg-emerald-100 text-emerald-700 border border-emerald-200", row: "" },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("Stock", "المخزون")}</h1>
          <p className="text-sm text-muted-foreground">{t("Niveaux de stock et mouvements", "مستويات المخزون والحركات")}</p>
        </div>
        <Button onClick={() => setOpen(true)} data-testid="button-adjust-inventory">
          <SlidersHorizontal className="h-4 w-4 mr-2" /> {t("Ajuster le stock", "تعديل المخزون")}
        </Button>
      </div>

      {alertItems.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <span>
            <strong>{alertItems.length} {t("produit(s)", "منتج")}</strong> {t("en stock faible.", "بمخزون منخفض.")}
            {criticalCount > 0 && (
              <> &nbsp;<span className="text-red-700 font-medium">{criticalCount} {t("critique(s).", "حرج.")}</span></>
            )}
          </span>
        </div>
      )}

      <Tabs defaultValue="stock">
        <TabsList className="mb-2">
          <TabsTrigger value="stock">{t("Stock actuel", "المخزون الحالي")}</TabsTrigger>
          <TabsTrigger value="movements">{t("Historique des mouvements", "سجل الحركات")}</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              {stockLoading ? (
                <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Produit (FR)", "المنتج (FR)")}</TableHead>
                        <TableHead>{t("Produit (AR)", "المنتج (AR)")}</TableHead>
                        <TableHead className="text-right">{t("Stock", "المخزون")}</TableHead>
                        <TableHead>{t("Statut", "الحالة")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockItems.map((s) => {
                        const cfg = stockStatusColors[s.status as keyof typeof stockStatusColors] ?? stockStatusColors.ok;
                        return (
                          <TableRow key={s.id} className={cfg.row} data-testid={`row-stock-${s.id}`}>
                            <TableCell className="font-medium">{s.nameEn}</TableCell>
                            <TableCell className="text-muted-foreground" dir="rtl">{s.nameAr}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{s.stock}</TableCell>
                            <TableCell>
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.badge}`}>
                                {stockStatusLabels[s.status] ?? s.status}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {stockItems.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{t("Aucun produit", "لا توجد منتجات")}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements">
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              {movementsLoading ? (
                <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Produit", "المنتج")}</TableHead>
                        <TableHead>{t("Type", "النوع")}</TableHead>
                        <TableHead>{t("Quantité", "الكمية")}</TableHead>
                        <TableHead>{t("Motif", "السبب")}</TableHead>
                        <TableHead>{t("Date", "التاريخ")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(movements ?? []).map((m: any) => (
                        <TableRow key={m.id} data-testid={`row-movement-${m.id}`}>
                          <TableCell className="font-medium">{productMap[m.productId] ?? `#${m.productId}`}</TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${MOVEMENT_TYPE_COLORS[m.type] ?? "bg-gray-100 text-gray-600"}`}>
                              {m.type}
                            </span>
                          </TableCell>
                          <TableCell className={`font-semibold ${m.type === "out" ? "text-red-600" : "text-emerald-600"}`}>
                            {m.type === "out" ? "-" : "+"}{m.quantity}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{m.reason}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {m.createdAt ? format(new Date(m.createdAt), "dd/MM/yyyy") : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                      {(!movements || movements.length === 0) && (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t("Aucun mouvement enregistré", "لا توجد حركات مسجلة")}</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("Ajuster le stock", "تعديل المخزون")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs mb-1 block">{t("Produit", "المنتج")}</Label>
              <Select value={form.productId} onValueChange={(v) => setForm((f) => ({ ...f, productId: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Sélectionner un produit", "اختر منتجاً")} /></SelectTrigger>
                <SelectContent>
                  {products.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{lang === "ar" ? p.nameAr : p.nameEn}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Quantité (+ pour ajouter, - pour réduire)", "الكمية (+ للإضافة، - للتخفيض)")}</Label>
              <Input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} className="h-8 text-sm" placeholder={t("ex. 10 ou -5", "مثال: 10 أو -5")} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Motif", "السبب")}</Label>
              <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="h-8 text-sm" placeholder={t("Motif de l'ajustement...", "سبب التعديل...")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Annuler", "إلغاء")}</Button>
            <Button onClick={handleSave} disabled={adjustInventory.isPending || !form.productId || !form.quantity} data-testid="button-save-adjustment">{t("Appliquer", "تطبيق")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

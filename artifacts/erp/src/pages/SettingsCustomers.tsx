import React, { useState } from "react";
import {
  useGetErpCustomerClassifications,
  useCreateErpCustomerClassification,
  useUpdateErpCustomerClassification,
  useDeleteErpCustomerClassification,
  useGetErpPriceTiers,
  useCreateErpPriceTier,
  useUpdateErpPriceTier,
  useDeleteErpPriceTier,
  type CustomerClassification,
  type PriceTier,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Plus, Loader2, Tag, Layers } from "lucide-react";

type TFn = (fr: string, ar: string) => string;

function ClassifTable({ items, isLoading, onAdd, onEdit, onDelete, t }: {
  items: CustomerClassification[]; isLoading: boolean;
  onAdd: () => void; onEdit: (item: CustomerClassification) => void;
  onDelete: (item: CustomerClassification) => void; t: TFn;
}) {
  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-[#1B3057]">
            <Tag className="h-4 w-4" />
            {t("Classifications", "التصنيفات")}
          </CardTitle>
          <Button size="sm" className="bg-[#1B3057] hover:bg-[#152544] h-8 text-xs gap-1" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />{t("Ajouter", "إضافة")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">{t("Chargement...", "جاري التحميل...")}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">{t("Aucune classification", "لا توجد تصنيفات")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-12">#</TableHead>
                <TableHead className="text-xs">{t("Label FR", "بالفرنسية")}</TableHead>
                <TableHead className="text-xs">{t("Label AR", "بالعربية")}</TableHead>
                <TableHead className="text-xs">{t("Couleur", "اللون")}</TableHead>
                <TableHead className="text-xs text-right">{t("Actions", "إجراءات")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs text-muted-foreground">{item.id}</TableCell>
                  <TableCell className="text-sm font-medium">{item.labelFr}</TableCell>
                  <TableCell className="text-sm" dir="rtl">{item.labelAr}</TableCell>
                  <TableCell>
                    {item.color ? (
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 rounded border border-muted" style={{ backgroundColor: item.color }} />
                        <span className="text-xs text-muted-foreground font-mono">{item.color}</span>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-[#1B3057]" onClick={() => onEdit(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => onDelete(item)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TierTable({ items, isLoading, onAdd, onEdit, onDelete, t }: {
  items: PriceTier[]; isLoading: boolean;
  onAdd: () => void; onEdit: (item: PriceTier) => void;
  onDelete: (item: PriceTier) => void; t: TFn;
}) {
  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-[#1B3057]">
            <Layers className="h-4 w-4" />
            {t("Grilles de prix", "شرائح الأسعار")}
          </CardTitle>
          <Button size="sm" className="bg-[#1B3057] hover:bg-[#152544] h-8 text-xs gap-1" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />{t("Ajouter", "إضافة")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">{t("Aucune grille", "لا توجد شرائح")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-12">#</TableHead>
                <TableHead className="text-xs">{t("Code", "الكود")}</TableHead>
                <TableHead className="text-xs">{t("Label FR", "بالفرنسية")}</TableHead>
                <TableHead className="text-xs">{t("Label AR", "بالعربية")}</TableHead>
                <TableHead className="text-xs text-right">{t("Actions", "إجراءات")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs text-muted-foreground">{item.id}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{item.code}</TableCell>
                  <TableCell className="text-sm font-medium">{item.labelFr}</TableCell>
                  <TableCell className="text-sm" dir="rtl">{item.labelAr}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-[#1B3057]" onClick={() => onEdit(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => onDelete(item)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsCustomers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;

  const { data: classifs = [], isLoading: loadingClassifs } = useGetErpCustomerClassifications();
  const { data: tiers = [], isLoading: loadingTiers } = useGetErpPriceTiers();

  const createClassif = useCreateErpCustomerClassification();
  const updateClassif = useUpdateErpCustomerClassification();
  const deleteClassif = useDeleteErpCustomerClassification();
  const createTier = useCreateErpPriceTier();
  const updateTier = useUpdateErpPriceTier();
  const deleteTier = useDeleteErpPriceTier();

  const [classifDialog, setClassifDialog] = useState<{ open: boolean; editing: CustomerClassification | null }>({ open: false, editing: null });
  const [classifForm, setClassifForm] = useState({ labelFr: "", labelAr: "", color: "" });
  const [tierDialog, setTierDialog] = useState<{ open: boolean; editing: PriceTier | null }>({ open: false, editing: null });
  const [tierForm, setTierForm] = useState({ labelFr: "", labelAr: "", code: "" });
  const [saving, setSaving] = useState(false);
  const [deleteClassifTarget, setDeleteClassifTarget] = useState<CustomerClassification | null>(null);
  const [deleteTierTarget, setDeleteTierTarget] = useState<PriceTier | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/erp/customer-classifications"] });
    qc.invalidateQueries({ queryKey: ["/api/erp/price-tiers"] });
  };

  const handleSaveClassif = async () => {
    if (!classifForm.labelFr.trim() || !classifForm.labelAr.trim()) {
      toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: t("Les deux labels sont requis", "كلا الاسمَين مطلوبان") });
      return;
    }
    setSaving(true);
    try {
      const body = { labelFr: classifForm.labelFr.trim(), labelAr: classifForm.labelAr.trim(), color: classifForm.color.trim() || undefined };
      if (classifDialog.editing) await updateClassif.mutateAsync({ id: classifDialog.editing.id, data: body });
      else await createClassif.mutateAsync({ data: body });
      toast({ title: t("Enregistré", "تم الحفظ") });
      setClassifDialog({ open: false, editing: null });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: t("Erreur", "خطأ") });
    } finally { setSaving(false); }
  };

  const handleSaveTier = async () => {
    if (!tierForm.labelFr.trim() || !tierForm.labelAr.trim() || !tierForm.code.trim()) {
      toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: t("Tous les champs sont requis", "جميع الحقول مطلوبة") });
      return;
    }
    setSaving(true);
    try {
      const body = { labelFr: tierForm.labelFr.trim(), labelAr: tierForm.labelAr.trim(), code: tierForm.code.trim() };
      if (tierDialog.editing) await updateTier.mutateAsync({ id: tierDialog.editing.id, data: body });
      else await createTier.mutateAsync({ data: body });
      toast({ title: t("Enregistré", "تم الحفظ") });
      setTierDialog({ open: false, editing: null });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: t("Erreur", "خطأ") });
    } finally { setSaving(false); }
  };

  const handleDeleteClassif = async () => {
    if (!deleteClassifTarget) return;
    try {
      await deleteClassif.mutateAsync({ id: deleteClassifTarget.id });
      toast({ title: t("Supprimé", "تم الحذف") });
      setDeleteClassifTarget(null);
      invalidate();
    } catch { toast({ variant: "destructive", title: t("Erreur", "خطأ") }); }
  };

  const handleDeleteTier = async () => {
    if (!deleteTierTarget) return;
    try {
      await deleteTier.mutateAsync({ id: deleteTierTarget.id });
      toast({ title: t("Supprimé", "تم الحذف") });
      setDeleteTierTarget(null);
      invalidate();
    } catch { toast({ variant: "destructive", title: t("Erreur", "خطأ") }); }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3057]">{t("Paramètres Clients", "إعدادات العملاء")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("Gérez les classifications et grilles de prix clients", "إدارة تصنيفات العملاء وشرائح الأسعار")}
        </p>
      </div>

      <Tabs defaultValue="classifications">
        <TabsList className="mb-4">
          <TabsTrigger value="classifications" className="gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            {t("Classifications", "التصنيفات")}
          </TabsTrigger>
          <TabsTrigger value="tiers" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            {t("Grilles de prix", "شرائح الأسعار")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="classifications">
          <ClassifTable
            items={classifs as CustomerClassification[]}
            isLoading={loadingClassifs}
            onAdd={() => { setClassifForm({ labelFr: "", labelAr: "", color: "" }); setClassifDialog({ open: true, editing: null }); }}
            onEdit={(item) => { setClassifForm({ labelFr: item.labelFr, labelAr: item.labelAr, color: item.color ?? "" }); setClassifDialog({ open: true, editing: item }); }}
            onDelete={setDeleteClassifTarget}
            t={t}
          />
        </TabsContent>

        <TabsContent value="tiers">
          <TierTable
            items={tiers as PriceTier[]}
            isLoading={loadingTiers}
            onAdd={() => { setTierForm({ labelFr: "", labelAr: "", code: "" }); setTierDialog({ open: true, editing: null }); }}
            onEdit={(item) => { setTierForm({ labelFr: item.labelFr, labelAr: item.labelAr, code: item.code }); setTierDialog({ open: true, editing: item }); }}
            onDelete={setDeleteTierTarget}
            t={t}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={classifDialog.open} onOpenChange={(v) => setClassifDialog((d) => ({ ...d, open: v }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#1B3057]">
              {classifDialog.editing ? t("Modifier classification", "تعديل التصنيف") : t("Nouvelle classification", "تصنيف جديد")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs mb-1.5 block">{t("Label français", "الاسم بالفرنسية")}</Label>
              <Input value={classifForm.labelFr} onChange={(e) => setClassifForm((f) => ({ ...f, labelFr: e.target.value }))} className="h-9" placeholder="ex: Normal, Grossiste..." />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">{t("Label arabe", "الاسم بالعربية")}</Label>
              <Input value={classifForm.labelAr} onChange={(e) => setClassifForm((f) => ({ ...f, labelAr: e.target.value }))} className="h-9" dir="rtl" placeholder="مثال: عادي، جملة..." />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">{t("Couleur hex (optionnel)", "لون (اختياري)")}</Label>
              <div className="flex gap-2 items-center">
                <Input value={classifForm.color} onChange={(e) => setClassifForm((f) => ({ ...f, color: e.target.value }))} className="h-9 font-mono" placeholder="#3B82F6" />
                {classifForm.color && /^#[0-9a-fA-F]{6}$/.test(classifForm.color) && (
                  <div className="h-9 w-9 rounded border border-muted shrink-0" style={{ backgroundColor: classifForm.color }} />
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClassifDialog((d) => ({ ...d, open: false }))}>{t("Annuler", "إلغاء")}</Button>
            <Button className="bg-[#1B3057] hover:bg-[#152544]" onClick={handleSaveClassif} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {classifDialog.editing ? t("Modifier", "تعديل") : t("Ajouter", "إضافة")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tierDialog.open} onOpenChange={(v) => setTierDialog((d) => ({ ...d, open: v }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#1B3057]">
              {tierDialog.editing ? t("Modifier grille", "تعديل الشريحة") : t("Nouvelle grille de prix", "شريحة أسعار جديدة")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs mb-1.5 block">{t("Code (unique)", "الكود (فريد)")}</Label>
              <Input value={tierForm.code} onChange={(e) => setTierForm((f) => ({ ...f, code: e.target.value.toLowerCase().replace(/\s+/g, "_") }))} className="h-9 font-mono" placeholder="ex: detail, gros, special" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">{t("Label français", "الاسم بالفرنسية")}</Label>
              <Input value={tierForm.labelFr} onChange={(e) => setTierForm((f) => ({ ...f, labelFr: e.target.value }))} className="h-9" placeholder="ex: Détail, Demi-gros, Gros..." />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">{t("Label arabe", "الاسم بالعربية")}</Label>
              <Input value={tierForm.labelAr} onChange={(e) => setTierForm((f) => ({ ...f, labelAr: e.target.value }))} className="h-9" dir="rtl" placeholder="مثال: تجزئة، نصف جملة..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTierDialog((d) => ({ ...d, open: false }))}>{t("Annuler", "إلغاء")}</Button>
            <Button className="bg-[#1B3057] hover:bg-[#152544]" onClick={handleSaveTier} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {tierDialog.editing ? t("Modifier", "تعديل") : t("Ajouter", "إضافة")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteClassifTarget} onOpenChange={(v) => !v && setDeleteClassifTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Confirmer la suppression", "تأكيد الحذف")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Supprimer", "حذف")} <strong>{deleteClassifTarget?.labelFr}</strong>?{" "}
              {t("Cette action est irréversible.", "هذا الإجراء لا يمكن التراجع عنه.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Annuler", "إلغاء")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleDeleteClassif}>
              {t("Supprimer", "حذف")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTierTarget} onOpenChange={(v) => !v && setDeleteTierTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Confirmer la suppression", "تأكيد الحذف")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Supprimer", "حذف")} <strong>{deleteTierTarget?.labelFr}</strong>?{" "}
              {t("Cette action est irréversible.", "هذا الإجراء لا يمكن التراجع عنه.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Annuler", "إلغاء")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleDeleteTier}>
              {t("Supprimer", "حذف")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import React, { useState, useRef } from "react";
import {
  useGetErpSettingsProductsFamilies,
  useCreateErpSettingsProductsFamily,
  useUpdateErpSettingsProductsFamily,
  useDeleteErpSettingsProductsFamily,
  useGetErpSettingsProductsBrands,
  useCreateErpSettingsProductsBrand,
  useUpdateErpSettingsProductsBrand,
  useDeleteErpSettingsProductsBrand,
  useGetErpSettingsProductsColors,
  useCreateErpSettingsProductsColor,
  useUpdateErpSettingsProductsColor,
  useDeleteErpSettingsProductsColor,
  useGetErpSettingsProductsTypes,
  useCreateErpSettingsProductsType,
  useUpdateErpSettingsProductsType,
  useDeleteErpSettingsProductsType,
  type ProductFamily,
  type ProductBrand,
  type ProductColor,
  type ProductType,
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
import { Pencil, Trash2, Plus, Loader2, Layers, Tag, Palette, LayoutGrid, Image as ImageIcon, Upload, X } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const tok = () => localStorage.getItem("midanic_token") ?? "";

type TFn = (fr: string, ar: string) => string;
type AttributeItem = { id: number; nameAr: string; nameFr: string; hexCode?: string | null; imageUrl?: string | null; createdAt?: string };
type AttributeForm = { nameAr: string; nameFr: string; hexCode?: string; imageUrl?: string };

function AttributeTable({
  title, titleAr, icon: Icon, items, isLoading, onAdd, onEdit, onDelete, showHex = false, showImage = false, t,
}: {
  title: string; titleAr: string; icon: React.ComponentType<{ className?: string }>;
  items: AttributeItem[]; isLoading: boolean;
  onAdd: () => void; onEdit: (item: AttributeItem) => void; onDelete: (item: AttributeItem) => void;
  showHex?: boolean; showImage?: boolean; t: TFn;
}) {
  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-[#1B3057]">
            <Icon className="h-4 w-4" />
            {title}
            <span className="text-xs text-muted-foreground font-normal" dir="rtl">/ {titleAr}</span>
          </CardTitle>
          <Button size="sm" className="bg-[#1B3057] hover:bg-[#152544] h-8 text-xs gap-1" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            {t("Ajouter", "إضافة")}
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
            <p className="text-sm">{t("Aucun élément", "لا توجد عناصر")}</p>
            <p className="text-xs mt-1">{t("Cliquez sur \"Ajouter\" pour créer le premier", "انقر على \"إضافة\" لإنشاء الأول")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-12">#</TableHead>
                {showImage && <TableHead className="text-xs w-16">{t("Image", "الصورة")}</TableHead>}
                <TableHead className="text-xs">{t("Nom FR", "الاسم بالفرنسية")}</TableHead>
                <TableHead className="text-xs" dir="rtl">{t("Nom AR", "الاسم بالعربية")}</TableHead>
                {showHex && <TableHead className="text-xs">{t("Couleur", "اللون")}</TableHead>}
                <TableHead className="text-xs text-right">{t("Actions", "الإجراءات")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs text-muted-foreground">{item.id}</TableCell>
                  {showImage && (
                    <TableCell>
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.nameFr} className="h-10 w-10 object-cover rounded-md border" />
                      ) : (
                        <div className="h-10 w-10 rounded-md border bg-muted flex items-center justify-center">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-sm font-medium">{item.nameFr}</TableCell>
                  <TableCell className="text-sm" dir="rtl">{item.nameAr}</TableCell>
                  {showHex && (
                    <TableCell>
                      {item.hexCode ? (
                        <div className="flex items-center gap-2">
                          <div className="h-5 w-5 rounded border border-muted" style={{ backgroundColor: item.hexCode }} />
                          <span className="text-xs text-muted-foreground font-mono">{item.hexCode}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
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

export default function ProductSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;

  const { data: familiesData, isLoading: loadingFamilies } = useGetErpSettingsProductsFamilies();
  const { data: brandsData, isLoading: loadingBrands } = useGetErpSettingsProductsBrands();
  const { data: colorsData, isLoading: loadingColors } = useGetErpSettingsProductsColors();
  const { data: typesData, isLoading: loadingTypes } = useGetErpSettingsProductsTypes();

  const families: AttributeItem[] = (familiesData?.items ?? []) as AttributeItem[];
  const brands: AttributeItem[] = (brandsData?.items ?? []) as AttributeItem[];
  const colors: AttributeItem[] = (colorsData?.items ?? []) as AttributeItem[];
  const types: AttributeItem[] = (typesData?.items ?? []) as AttributeItem[];

  const createFamily = useCreateErpSettingsProductsFamily();
  const updateFamily = useUpdateErpSettingsProductsFamily();
  const deleteFamily = useDeleteErpSettingsProductsFamily();
  const createBrand = useCreateErpSettingsProductsBrand();
  const updateBrand = useUpdateErpSettingsProductsBrand();
  const deleteBrand = useDeleteErpSettingsProductsBrand();
  const createColor = useCreateErpSettingsProductsColor();
  const updateColor = useUpdateErpSettingsProductsColor();
  const deleteColor = useDeleteErpSettingsProductsColor();
  const createType = useCreateErpSettingsProductsType();
  const updateType = useUpdateErpSettingsProductsType();
  const deleteType = useDeleteErpSettingsProductsType();

  const [dialog, setDialog] = useState<{
    open: boolean; type: "family" | "brand" | "color" | "type"; editing: AttributeItem | null;
  }>({ open: false, type: "family", editing: null });

  const [form, setForm] = useState<AttributeForm>({ nameAr: "", nameFr: "", hexCode: "", imageUrl: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ item: AttributeItem; type: "family" | "brand" | "color" | "type" } | null>(null);

  const imageFileRef = useRef<HTMLInputElement>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/erp/settings/products/families"] });
    qc.invalidateQueries({ queryKey: ["/api/erp/settings/products/brands"] });
    qc.invalidateQueries({ queryKey: ["/api/erp/settings/products/colors"] });
    qc.invalidateQueries({ queryKey: ["/api/erp/settings/products/types"] });
    qc.invalidateQueries({ queryKey: ["/api/product-types"] });
  };

  const openAdd = (type: "family" | "brand" | "color" | "type") => {
    setForm({ nameAr: "", nameFr: "", hexCode: "", imageUrl: "" });
    setDialog({ open: true, type, editing: null });
  };

  const openEdit = (type: "family" | "brand" | "color" | "type", item: AttributeItem) => {
    setForm({ nameAr: item.nameAr, nameFr: item.nameFr, hexCode: item.hexCode ?? "", imageUrl: item.imageUrl ?? "" });
    setDialog({ open: true, type, editing: item });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API_BASE}/api/uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok()}` },
        body: fd,
      });
      const data = await r.json() as { url?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setForm((f) => ({ ...f, imageUrl: data.url ?? "" }));
    } catch (err) {
      toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: (err as Error).message });
    } finally {
      setUploading(false);
      if (imageFileRef.current) imageFileRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!form.nameAr.trim() || !form.nameFr.trim()) {
      toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: t("Les deux noms sont requis", "كلا الاسمَين مطلوبان") });
      return;
    }
    setSaving(true);
    const body = { nameAr: form.nameAr.trim(), nameFr: form.nameFr.trim() };
    const colorBody = { ...body, hexCode: form.hexCode?.trim() || undefined };
    const typeBody = { ...body, imageUrl: form.imageUrl?.trim() || null };

    try {
      if (dialog.type === "family") {
        if (dialog.editing) await updateFamily.mutateAsync({ id: dialog.editing.id, data: body });
        else await createFamily.mutateAsync({ data: body });
      } else if (dialog.type === "brand") {
        if (dialog.editing) await updateBrand.mutateAsync({ id: dialog.editing.id, data: body });
        else await createBrand.mutateAsync({ data: body });
      } else if (dialog.type === "color") {
        if (dialog.editing) await updateColor.mutateAsync({ id: dialog.editing.id, data: colorBody });
        else await createColor.mutateAsync({ data: colorBody });
      } else {
        if (dialog.editing) await updateType.mutateAsync({ id: dialog.editing.id, data: typeBody });
        else await createType.mutateAsync({ data: typeBody });
      }
      toast({ title: t("Enregistré", "تم الحفظ") });
      setDialog((d) => ({ ...d, open: false }));
      invalidateAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: msg ?? t("Une erreur s'est produite", "حدث خطأ ما") });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === "family") await deleteFamily.mutateAsync({ id: deleteTarget.item.id });
      else if (deleteTarget.type === "brand") await deleteBrand.mutateAsync({ id: deleteTarget.item.id });
      else if (deleteTarget.type === "color") await deleteColor.mutateAsync({ id: deleteTarget.item.id });
      else await deleteType.mutateAsync({ id: deleteTarget.item.id });
      toast({ title: t("Supprimé", "تم الحذف") });
      setDeleteTarget(null);
      invalidateAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: msg ?? t("Suppression impossible", "تعذّر الحذف") });
    }
  };

  const dialogTitle = {
    family: dialog.editing ? t("Modifier la famille", "تعديل العائلة") : t("Nouvelle famille", "عائلة جديدة"),
    brand: dialog.editing ? t("Modifier la marque", "تعديل الماركة") : t("Nouvelle marque", "ماركة جديدة"),
    color: dialog.editing ? t("Modifier la couleur", "تعديل اللون") : t("Nouvelle couleur", "لون جديد"),
    type: dialog.editing ? t("Modifier le type", "تعديل النوع") : t("Nouveau type", "نوع جديد"),
  }[dialog.type];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3057]">{t("Paramètres Produits", "إعدادات المنتجات")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t(
            "Gérez les familles, marques, couleurs et types utilisés dans vos produits",
            "إدارة العائلات والعلامات التجارية والألوان والأنواع المستخدمة في منتجاتك"
          )}
        </p>
      </div>

      <Tabs defaultValue="types">
        <TabsList className="mb-4">
          <TabsTrigger value="types" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" />
            {t("Types / Catégories", "الأنواع / الفئات")}
          </TabsTrigger>
          <TabsTrigger value="families" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            {t("Familles", "العائلات")}
          </TabsTrigger>
          <TabsTrigger value="brands" className="gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            {t("Marques", "العلامات")}
          </TabsTrigger>
          <TabsTrigger value="colors" className="gap-1.5">
            <Palette className="h-3.5 w-3.5" />
            {t("Couleurs", "الألوان")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="types">
          <AttributeTable
            title={t("Types de produits", "أنواع المنتجات")}
            titleAr="أنواع المنتجات"
            icon={LayoutGrid}
            items={types}
            isLoading={loadingTypes}
            onAdd={() => openAdd("type")}
            onEdit={(item) => openEdit("type", item)}
            onDelete={(item) => setDeleteTarget({ item, type: "type" })}
            showImage
            t={t}
          />
          <p className="text-xs text-muted-foreground mt-3 px-1">
            {t(
              "Les types de produits sont affichés comme catégories dans le Web Store (\"Shop by Category\").",
              "تُعرض أنواع المنتجات كتصنيفات في المتجر الإلكتروني (\"تسوق حسب الفئة\")."
            )}
          </p>
        </TabsContent>

        <TabsContent value="families">
          <AttributeTable title={t("Familles de produits", "عائلات المنتجات")} titleAr="عائلات المنتجات" icon={Layers}
            items={families} isLoading={loadingFamilies}
            onAdd={() => openAdd("family")} onEdit={(item) => openEdit("family", item)}
            onDelete={(item) => setDeleteTarget({ item, type: "family" })} t={t} />
        </TabsContent>

        <TabsContent value="brands">
          <AttributeTable title={t("Marques", "العلامات التجارية")} titleAr="العلامات التجارية" icon={Tag}
            items={brands} isLoading={loadingBrands}
            onAdd={() => openAdd("brand")} onEdit={(item) => openEdit("brand", item)}
            onDelete={(item) => setDeleteTarget({ item, type: "brand" })} t={t} />
        </TabsContent>

        <TabsContent value="colors">
          <AttributeTable title={t("Couleurs", "الألوان")} titleAr="الألوان" icon={Palette}
            items={colors} isLoading={loadingColors}
            onAdd={() => openAdd("color")} onEdit={(item) => openEdit("color", item)}
            onDelete={(item) => setDeleteTarget({ item, type: "color" })} showHex t={t} />
        </TabsContent>
      </Tabs>

      {/* Shared dialog for add/edit */}
      <Dialog open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#1B3057]">{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs mb-1.5 block">{t("Nom français", "الاسم بالفرنسية")}</Label>
              <Input
                value={form.nameFr}
                onChange={(e) => setForm((f) => ({ ...f, nameFr: e.target.value }))}
                placeholder="ex: Parfums, L'Oréal, Rouge..."
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">{t("Nom arabe", "الاسم بالعربية")}</Label>
              <Input
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
                placeholder="مثال: العطور، لوريال، أحمر..."
                className="h-9"
                dir="rtl"
              />
            </div>
            {dialog.type === "color" && (
              <div>
                <Label className="text-xs mb-1.5 block">{t("Code couleur hex (optionnel)", "كود اللون (اختياري)")}</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    value={form.hexCode ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, hexCode: e.target.value }))}
                    placeholder="#FF5733"
                    className="h-9 font-mono"
                  />
                  {form.hexCode && /^#[0-9a-fA-F]{6}$/.test(form.hexCode) && (
                    <div className="h-9 w-9 rounded border border-muted shrink-0" style={{ backgroundColor: form.hexCode }} />
                  )}
                </div>
              </div>
            )}
            {dialog.type === "type" && (
              <div>
                <Label className="text-xs mb-1.5 block">
                  {t("Image du type (Web Store)", "صورة النوع (المتجر)")}
                </Label>
                <input
                  ref={imageFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                {form.imageUrl ? (
                  <div className="space-y-2">
                    <div className="relative inline-block">
                      <img
                        src={form.imageUrl}
                        alt="Preview"
                        className="h-24 w-24 object-cover rounded-lg border"
                      />
                      <button
                        type="button"
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center shadow"
                        onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex gap-2 items-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1"
                        onClick={() => imageFileRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        {t("Changer", "تغيير")}
                      </Button>
                    </div>
                    <Input
                      value={form.imageUrl}
                      onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                      placeholder="https://..."
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-20 w-full border-dashed flex flex-col items-center justify-center gap-1.5"
                    onClick={() => imageFileRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <><Loader2 className="h-5 w-5 animate-spin" /><span className="text-xs">{t("Téléchargement...", "جاري الرفع...")}</span></>
                    ) : (
                      <><ImageIcon className="h-5 w-5 text-muted-foreground" /><span className="text-xs text-muted-foreground">{t("Cliquer pour ajouter une image", "انقر لإضافة صورة")}</span></>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog((d) => ({ ...d, open: false }))}>{t("Annuler", "إلغاء")}</Button>
            <Button className="bg-[#1B3057] hover:bg-[#152544]" onClick={handleSave} disabled={saving || uploading}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {dialog.editing ? t("Modifier", "تعديل") : t("Ajouter", "إضافة")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Confirmer la suppression", "تأكيد الحذف")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Supprimer", "حذف")}{" "}
              <strong>{deleteTarget?.item.nameFr}</strong>
              {" "}? {t("Cette action est irréversible.", "هذا الإجراء لا يمكن التراجع عنه.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Annuler", "إلغاء")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleDelete}>
              {t("Supprimer", "حذف")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

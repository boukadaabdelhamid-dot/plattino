import React, { useState } from "react";
import {
  useGetErpStores, useCreateErpStore, useUpdateErpStore, useDeleteErpStore,
  getGetErpStoresQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Store as StoreIcon, Plus, Trash2, Edit2 } from "lucide-react";

type FormState = {
  id?: number;
  nameAr: string; nameEn: string; slug: string; isActive: boolean;
  address: string; phone: string; logoUrl: string;
  tvaRate: string; showTvaByDefault: boolean;
  nif: string; rc: string; ai: string;
};
const empty: FormState = {
  nameAr: "", nameEn: "", slug: "", isActive: true,
  address: "", phone: "", logoUrl: "",
  tvaRate: "19", showTvaByDefault: false,
  nif: "", rc: "", ai: "",
};

export default function Stores() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const { data: stores, isLoading } = useGetErpStores();
  const create = useCreateErpStore();
  const update = useUpdateErpStore();
  const del = useDeleteErpStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetErpStoresQueryKey() });

  const handleSave = () => {
    setError(null);
    if (!form.nameAr.trim() || !form.nameEn.trim() || (!form.id && !form.slug.trim())) {
      setError(t("Nom AR, EN et slug requis", "الاسم بالعربية والفرنسية والمعرف مطلوبة"));
      return;
    }
    const payload = {
      nameAr: form.nameAr.trim(), nameEn: form.nameEn.trim(),
      isActive: form.isActive,
      address: form.address.trim() || undefined,
      phone: form.phone.trim() || undefined,
      logoUrl: form.logoUrl.trim() || undefined,
      tvaRate: form.tvaRate.trim() || "19",
      showTvaByDefault: form.showTvaByDefault,
      nif: form.nif.trim() || undefined,
      rc: form.rc.trim() || undefined,
      ai: form.ai.trim() || undefined,
    };
    if (form.id) {
      update.mutate({ id: form.id, data: payload }, {
        onSuccess: () => { invalidate(); setOpen(false); setForm(empty); },
        onError: (e: unknown) => setError((e as { message?: string })?.message ?? "Erreur"),
      });
    } else {
      create.mutate({ data: { ...payload, slug: form.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") } }, {
        onSuccess: () => { invalidate(); setOpen(false); setForm(empty); },
        onError: (e: unknown) => setError((e as { message?: string })?.message ?? "Erreur"),
      });
    }
  };

  const handleDelete = (id: number, name: string, itemCount: number) => {
    if (itemCount > 0) return;
    if (!confirm(t(`Supprimer ${name} ?`, `حذف ${name} ؟`))) return;
    del.mutate({ id }, {
      onSuccess: invalidate,
      onError: (e: unknown) => alert((e as { message?: string })?.message ?? "Erreur"),
    });
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <StoreIcon className="h-6 w-6 text-primary" />
            {t("Magasins", "المتاجر")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("Gérer vos points de vente", "إدارة نقاط البيع")}
          </p>
        </div>
        <Button onClick={() => { setForm(empty); setError(null); setOpen(true); }} data-testid="button-new-store">
          <Plus className="h-4 w-4 mr-2" />
          {t("Nouveau", "جديد")}
        </Button>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Slug</TableHead>
                    <TableHead>{t("Nom FR", "الاسم FR")}</TableHead>
                    <TableHead>{t("الاسم", "الاسم")}</TableHead>
                    <TableHead>NIF / RC</TableHead>
                    <TableHead>TVA</TableHead>
                    <TableHead>{t("Statut", "الحالة")}</TableHead>
                    <TableHead className="text-right">{t("Actions", "الإجراءات")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(stores ?? []).map((s) => (
                    <TableRow key={s.id} data-testid={`row-store-${s.id}`}>
                      <TableCell className="font-mono text-xs">{s.slug}</TableCell>
                      <TableCell className="font-medium">{s.nameEn}</TableCell>
                      <TableCell dir="rtl">{s.nameAr}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.nif || "—"} / {s.rc || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {s.showTvaByDefault
                          ? <span className="text-emerald-700">{t("Activée", "مفعّلة")} ({s.tvaRate ?? "19"}%)</span>
                          : <span className="text-muted-foreground">{t("Hors taxes", "بدون ضريبة")}</span>}
                      </TableCell>
                      <TableCell>
                        {s.isActive
                          ? <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">{t("Actif", "نشط")}</span>
                          : <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">{t("Inactif", "غير نشط")}</span>}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" className="h-7"
                          onClick={() => { setForm({ id: s.id, nameAr: s.nameAr, nameEn: s.nameEn, slug: s.slug, isActive: s.isActive ?? true, address: s.address ?? "", phone: s.phone ?? "", logoUrl: s.logoUrl ?? "", tvaRate: s.tvaRate ?? "19", showTvaByDefault: !!s.showTvaByDefault, nif: s.nif ?? "", rc: s.rc ?? "", ai: s.ai ?? "" }); setError(null); setOpen(true); }}
                          data-testid={`btn-edit-store-${s.id}`}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost"
                          className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-40"
                          onClick={() => handleDelete(s.id, s.nameEn, (s as { itemCount?: number }).itemCount ?? 0)}
                          disabled={((s as { itemCount?: number }).itemCount ?? 0) > 0}
                          title={((s as { itemCount?: number }).itemCount ?? 0) > 0 ? t("Magasin non vide", "المتجر يحتوي على بيانات") : t("Supprimer", "حذف")}
                          data-testid={`btn-delete-store-${s.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!stores || stores.length === 0) && (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t("Aucun magasin", "لا توجد متاجر")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? t("Modifier magasin", "تعديل المتجر") : t("Nouveau magasin", "متجر جديد")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("Nom FR *", "الاسم بالفرنسية *")}</Label>
              <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} data-testid="input-store-name-en" autoFocus />
            </div>
            <div>
              <Label dir="rtl">{t("Nom AR *", "الاسم بالعربية *")}</Label>
              <Input dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} data-testid="input-store-name-ar" />
            </div>
            {!form.id && (
              <div className="col-span-2">
                <Label>Slug * (a-z, 0-9, -)</Label>
                <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="principal" data-testid="input-store-slug" />
              </div>
            )}
            <div className="col-span-2">
              <Label>{t("Adresse", "العنوان")}</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="input-store-address" />
            </div>
            <div>
              <Label>{t("Téléphone", "الهاتف")}</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-store-phone" />
            </div>
            <div>
              <Label>Logo URL</Label>
              <Input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://..." data-testid="input-store-logo" />
            </div>
            <div><Label>NIF</Label><Input value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} data-testid="input-store-nif" /></div>
            <div><Label>RC</Label><Input value={form.rc} onChange={(e) => setForm({ ...form, rc: e.target.value })} data-testid="input-store-rc" /></div>
            <div>
              <Label>{t("AI / Article d'imposition", "المادة الضريبية")}</Label>
              <Input value={form.ai} onChange={(e) => setForm({ ...form, ai: e.target.value })} data-testid="input-store-ai" />
            </div>
            <div>
              <Label>{t("Taux TVA (%)", "نسبة TVA (%)")}</Label>
              <Input type="number" step="0.01" min="0" value={form.tvaRate} onChange={(e) => setForm({ ...form, tvaRate: e.target.value })} data-testid="input-store-tva" />
            </div>
            <div className="col-span-2 flex items-center justify-between border rounded-md px-3 py-2 bg-slate-50">
              <div>
                <Label className="cursor-pointer">{t("Assujetti à la TVA par défaut", "خاضع للضريبة افتراضياً")}</Label>
                <p className="text-xs text-muted-foreground">{t("Affichera HT/TVA/TTC sur les factures", "سيُظهر HT/TVA/TTC على الفواتير")}</p>
              </div>
              <Switch checked={form.showTvaByDefault} onCheckedChange={(v) => setForm({ ...form, showTvaByDefault: v })} data-testid="switch-store-tva-default" />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} data-testid="input-store-active" />
              <span>{t("Actif", "نشط")}</span>
            </label>
            {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Annuler", "إلغاء")}</Button>
            <Button onClick={handleSave} disabled={create.isPending || update.isPending} data-testid="button-save-store">
              {(create.isPending || update.isPending) ? "..." : t("Enregistrer", "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

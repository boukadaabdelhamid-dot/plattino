import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetErpCustomers,
  useUpdateErpStore,
  getGetErpStoresMineQueryKey,
  type CustomerSummary,
} from "@workspace/api-client-react";
import { useMe } from "@/hooks/use-me";
import { useLang } from "@/hooks/use-lang";
import { useCurrentStore } from "@/hooks/use-current-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { User, Store as StoreIcon, Shield, Save, Settings as SettingsIcon, Users } from "lucide-react";
import { getStoreName, setStoreName, DEFAULT_STORE_NAME } from "@/lib/store-settings";

export default function Settings() {
  const { user, role } = useMe();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const [storeName, setStoreNameState] = useState(() => getStoreName());
  const [saved, setSaved] = useState(false);

  const typedUser = user as { name?: string; email?: string; role?: string } | null;

  const queryClient = useQueryClient();
  const currentStore = useCurrentStore();
  const { data: customersResp } = useGetErpCustomers();
  const customers: CustomerSummary[] = (customersResp ?? []) as CustomerSummary[];
  const updateStore = useUpdateErpStore();

  function handleSetDefaultComptoir(value: string) {
    if (!currentStore) return;
    const id = value === "__none__" ? null : Number(value);
    updateStore.mutate(
      { id: currentStore.id, data: { defaultComptoirCustomerId: id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetErpStoresMineQueryKey() });
          toast({
            title: t("Enregistré", "تم الحفظ"),
            description: t("Client comptoir par défaut mis à jour.", "تم تحديث عميل الكاونتر الافتراضي."),
          });
        },
        onError: (e: unknown) => {
          toast({
            title: t("Erreur", "خطأ"),
            description: (e as { message?: string })?.message ?? "Erreur",
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleSave() {
    setStoreName(storeName);
    setSaved(true);
    toast({ title: t("Enregistré", "تم الحفظ"), description: t("Nom du magasin mis à jour.", "تم تحديث اسم المتجر.") });
    setTimeout(() => setSaved(false), 2500);
  }

  const roleLabel =
    role === "admin" ? t("Administrateur", "مدير")
    : role === "employee" ? t("Employé", "موظف")
    : t("Client", "عميل");

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3057]">{t("Paramètres", "الإعدادات")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("Configuration générale du système", "إعدادات النظام العامة")}
        </p>
      </div>

      <Card className="border shadow-sm">
        <CardHeader className="pb-3 pt-4 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-[#1B3057]">
            <User className="h-4 w-4" />
            {t("Profil utilisateur", "الملف الشخصي")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4 space-y-3">
          <div className="flex items-center justify-between py-1 border-b border-muted last:border-0">
            <span className="text-sm text-muted-foreground">{t("Nom", "الاسم")}</span>
            <span className="text-sm font-medium">{typedUser?.name ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-muted last:border-0">
            <span className="text-sm text-muted-foreground">{t("Email", "البريد الإلكتروني")}</span>
            <span className="text-sm font-medium">{typedUser?.email ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-muted-foreground">{t("Rôle", "الدور")}</span>
            <Badge variant="outline" className="text-xs font-normal">{roleLabel}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border shadow-sm">
        <CardHeader className="pb-3 pt-4 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-[#1B3057]">
            <SettingsIcon className="h-4 w-4" />
            {t("Nom du magasin (étiquettes)", "اسم المتجر للطباعة")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <p className="text-xs text-muted-foreground mb-4">
            {t("Ce nom apparaît sur les étiquettes imprimées des produits.", "يظهر هذا الاسم على ملصقات المنتجات المطبوعة.")}
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs mb-1.5 block">{t("Nom du magasin", "اسم المتجر")}</Label>
              <Input
                value={storeName}
                onChange={(e) => setStoreNameState(e.target.value)}
                placeholder={DEFAULT_STORE_NAME}
                className="h-9 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <Button onClick={handleSave} disabled={saved} className="h-9 shrink-0 bg-[#1B3057] hover:bg-[#152544]">
              <Save className="h-4 w-4 mr-1.5" />
              {saved ? t("Enregistré ✓", "تم الحفظ ✓") : t("Enregistrer", "حفظ")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {role === "admin" && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 pt-4 px-5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-[#1B3057]">
              <Users className="h-4 w-4" />
              {t("Client comptoir par défaut", "عميل الكاونتر الافتراضي")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <p className="text-xs text-muted-foreground mb-4">
              {t(
                "Client utilisé automatiquement pour les ventes comptoir lorsqu'aucun client n'est sélectionné. Sans ce réglage, une vente comptoir sans client est bloquée.",
                "العميل المُستخدم تلقائياً لمبيعات الكاونتر عند عدم اختيار عميل. بدون هذا الإعداد، يُمنع البيع في الكاونتر بدون عميل.",
              )}
            </p>
            {currentStore ? (
              <div>
                <Label className="text-xs mb-1.5 block">
                  {t("Magasin actuel", "المتجر الحالي")} : {lang === "ar" ? currentStore.nameAr : currentStore.nameEn}
                </Label>
                <Select
                  value={currentStore.defaultComptoirCustomerId ? String(currentStore.defaultComptoirCustomerId) : "__none__"}
                  onValueChange={handleSetDefaultComptoir}
                  disabled={updateStore.isPending}
                >
                  <SelectTrigger className="h-9 text-sm" data-testid="select-default-comptoir">
                    <SelectValue placeholder={t("Aucun (bloquer les ventes sans client)", "بدون (منع المبيعات بدون عميل)")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      {t("Aucun (bloquer les ventes sans client)", "بدون (منع المبيعات بدون عميل)")}
                    </SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("Aucun magasin sélectionné.", "لم يتم اختيار متجر.")}</p>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <p className="text-xs font-semibold uppercase text-muted-foreground mb-3 tracking-wide">
          {t("Administration", "الإدارة")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="border shadow-sm cursor-pointer hover:border-[#1B3057]/50 hover:shadow-md transition-all group" onClick={() => navigate("/stores")}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[#1B3057]/10 flex items-center justify-center shrink-0 group-hover:bg-[#1B3057]/20 transition-colors">
                <StoreIcon className="h-5 w-5 text-[#1B3057]" />
              </div>
              <div>
                <p className="font-semibold text-sm">{t("Gestion des magasins", "إدارة المتاجر")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("Configurer les points de vente", "إعداد نقاط البيع")}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm cursor-pointer hover:border-[#1B3057]/50 hover:shadow-md transition-all group" onClick={() => navigate("/staff")}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[#1B3057]/10 flex items-center justify-center shrink-0 group-hover:bg-[#1B3057]/20 transition-colors">
                <Shield className="h-5 w-5 text-[#1B3057]" />
              </div>
              <div>
                <p className="font-semibold text-sm">{t("Accès & Autorisations", "الصلاحيات والموظفين")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("Gérer les droits d'accès", "إدارة حقوق الوصول")}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

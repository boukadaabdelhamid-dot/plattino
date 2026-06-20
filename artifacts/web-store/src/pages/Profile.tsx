import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/hooks/use-lang";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { User, Phone, MapPin, Mail, LogOut, Save, Loader2, Package, Lock, Eye, EyeOff } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  address: string | null;
  city: string | null;
}

function authHeaders() {
  const token = localStorage.getItem("midanic_token") ?? "";
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export default function Profile() {
  const { user, logout } = useAuth();
  const { lang } = useLang();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  const [form, setForm] = useState({ name: "", phone: "", address: "", city: "" });
  const [dirty, setDirty] = useState(false);

  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ["profile-me"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name ?? "",
        phone: profile.phone ?? "",
        address: profile.address ?? "",
        city: profile.city ?? "",
      });
      setDirty(false);
    }
  }, [profile]);

  const changePassword = useMutation({
    mutationFn: async () => {
      if (pwForm.newPassword !== pwForm.confirmPassword) {
        throw new Error(t("Les mots de passe ne correspondent pas", "كلمتا المرور غير متطابقتين"));
      }
      const res = await fetch(`${API_BASE}/api/auth/me/password`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast({ title: t("Mot de passe modifié", "تم تغيير كلمة المرور") });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: err.message }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? "Failed"); }
      return res.json() as Promise<UserProfile>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: t("Profil mis à jour", "تم تحديث الملف الشخصي") });
      setDirty(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: err.message }),
  });

  if (!user) {
    setLocation("/auth/login");
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-lg" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="flex items-center gap-3 mb-8">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-serif font-bold text-primary">
            {profile?.name ?? user.name}
          </h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Mes informations", "معلوماتي")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  {t("Nom complet", "الاسم الكامل")}
                </Label>
                <Input
                  value={form.name}
                  onChange={(e) => { setForm(p => ({ ...p, name: e.target.value })); setDirty(true); }}
                  placeholder={t("Votre nom", "اسمك")}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  {t("Email", "البريد الإلكتروني")}
                </Label>
                <Input value={user.email} disabled className="bg-muted/50 text-muted-foreground" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  {t("Téléphone", "رقم الهاتف")}
                </Label>
                <Input
                  value={form.phone}
                  onChange={(e) => { setForm(p => ({ ...p, phone: e.target.value })); setDirty(true); }}
                  placeholder="+213 5XX XXX XXX"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {t("Ville", "المدينة")}
                </Label>
                <Input
                  value={form.city}
                  onChange={(e) => { setForm(p => ({ ...p, city: e.target.value })); setDirty(true); }}
                  placeholder={t("Votre ville", "مدينتك")}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {t("Adresse de livraison", "عنوان التوصيل")}
                </Label>
                <Input
                  value={form.address}
                  onChange={(e) => { setForm(p => ({ ...p, address: e.target.value })); setDirty(true); }}
                  placeholder={t("Rue, quartier, bâtiment...", "الشارع، الحي، الرقم...")}
                />
              </div>

              <Button
                onClick={() => save.mutate()}
                disabled={!dirty || save.isPending}
                className="w-full gap-2 mt-2"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("Enregistrer", "حفظ التغييرات")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Separator className="my-6" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {t("Changer le mot de passe", "تغيير كلمة المرور")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{t("Mot de passe actuel", "كلمة المرور الحالية")}</Label>
            <div className="relative">
              <Input
                type={showCurrent ? "text" : "password"}
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm(p => ({ ...p, currentPassword: e.target.value }))}
                placeholder="••••••••"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(v => !v)}
                className="absolute inset-y-0 end-0 pe-3 flex items-center text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{t("Nouveau mot de passe", "كلمة المرور الجديدة")}</Label>
            <div className="relative">
              <Input
                type={showNew ? "text" : "password"}
                value={pwForm.newPassword}
                onChange={(e) => setPwForm(p => ({ ...p, newPassword: e.target.value }))}
                placeholder="••••••••"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute inset-y-0 end-0 pe-3 flex items-center text-muted-foreground hover:text-foreground"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{t("Confirmer le nouveau mot de passe", "تأكيد كلمة المرور الجديدة")}</Label>
            <Input
              type="password"
              value={pwForm.confirmPassword}
              onChange={(e) => setPwForm(p => ({ ...p, confirmPassword: e.target.value }))}
              placeholder="••••••••"
              dir="ltr"
            />
          </div>

          <Button
            onClick={() => changePassword.mutate()}
            disabled={!pwForm.currentPassword || !pwForm.newPassword || !pwForm.confirmPassword || changePassword.isPending}
            className="w-full gap-2 mt-2"
          >
            {changePassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {t("Modifier le mot de passe", "تغيير كلمة المرور")}
          </Button>
        </CardContent>
      </Card>

      <Separator className="my-6" />

      <div className="flex flex-col gap-3">
        <Button variant="outline" className="w-full gap-2" onClick={() => setLocation("/orders")}>
          <Package className="h-4 w-4" />
          {t("Mes commandes", "طلباتي")}
        </Button>
        <Button
          variant="destructive"
          className="w-full gap-2"
          onClick={() => { logout(); setLocation("/"); }}
        >
          <LogOut className="h-4 w-4" />
          {t("Se déconnecter", "تسجيل الخروج")}
        </Button>
      </div>
    </div>
  );
}

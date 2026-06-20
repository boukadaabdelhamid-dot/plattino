import React, { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetProducts, useGetCategories, type Product } from "@workspace/api-client-react";
import { useLang } from "@/hooks/use-lang";
import { useCurrentStore } from "@/hooks/use-current-store";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Globe, Image, Phone, Mail, MapPin, Facebook, Instagram,
  ExternalLink, Save, AlertTriangle, Eye, Upload, Loader2, X, ShoppingCart, Package,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

type WebSettings = {
  description: string | null;
  email: string | null;
  bannerUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  whatsappNumber: string | null;
  showPrices: boolean;
  showStock: boolean;
  acceptOrders: boolean;
  minOrderAmount: string | number;
  featuredProductIds: number[];
  featuredCategoryIds: number[];
};

const DEFAULTS: WebSettings = {
  description: "",
  email: "",
  bannerUrl: "",
  facebookUrl: "",
  instagramUrl: "",
  tiktokUrl: "",
  whatsappNumber: "",
  showPrices: true,
  showStock: true,
  acceptOrders: true,
  minOrderAmount: 0,
  featuredProductIds: [],
  featuredCategoryIds: [],
};

function authFetch(path: string, opts?: RequestInit) {
  const token = localStorage.getItem("midanic_token");
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

const tok = () => localStorage.getItem("midanic_token") ?? "";

export default function WebStoreSettings() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentStore = useCurrentStore();

  const [form, setForm] = useState<WebSettings>(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const bannerFileRef = useRef<HTMLInputElement>(null);

  const [identity, setIdentity] = useState({ nameEn: "", nameAr: "", logoUrl: null as string | null });
  const [identityDirty, setIdentityDirty] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentStore) {
      setIdentity({
        nameEn: currentStore.nameEn ?? "",
        nameAr: currentStore.nameAr ?? "",
        logoUrl: (currentStore as { logoUrl?: string | null }).logoUrl ?? null,
      });
      setIdentityDirty(false);
    }
  }, [currentStore?.id]);

  const { data: settings, isLoading } = useQuery<WebSettings>({
    queryKey: ["web-store-settings"],
    queryFn: async () => {
      const res = await authFetch("/api/erp/stores/web-settings");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: productsRes } = useGetProducts({ limit: 200 });
  const { data: categories } = useGetCategories();

  const products: Product[] = productsRes?.products ?? [];

  useEffect(() => {
    if (settings) {
      setForm({
        ...DEFAULTS,
        ...settings,
        minOrderAmount: Number(settings.minOrderAmount ?? 0),
        featuredProductIds: (settings.featuredProductIds as number[]) ?? [],
        featuredCategoryIds: (settings.featuredCategoryIds as number[]) ?? [],
      });
      setDirty(false);
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/erp/stores/web-settings", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          minOrderAmount: Number(form.minOrderAmount) || 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["web-store-settings"] });
      toast({ title: t("Paramètres sauvegardés", "تم حفظ الإعدادات") });
      setDirty(false);
    },
    onError: (err: Error) => {
      toast({ title: t("Erreur", "خطأ"), description: err.message, variant: "destructive" });
    },
  });

  function update<K extends keyof WebSettings>(key: K, value: WebSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  const saveIdentity = useMutation({
    mutationFn: async () => {
      if (!currentStore) throw new Error("No store");
      const r = await fetch(`${API_BASE}/api/erp/stores/${currentStore.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ nameEn: identity.nameEn, nameAr: identity.nameAr, logoUrl: identity.logoUrl }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["erp-stores-mine"] });
      queryClient.invalidateQueries({ queryKey: ["store-config"] });
      toast({ title: t("Identité du magasin sauvegardée", "تم حفظ هوية المتجر") });
      setIdentityDirty(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: err.message }),
  });

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
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
      setIdentity((p) => ({ ...p, logoUrl: data.url ?? null }));
      setIdentityDirty(true);
    } catch (err) {
      toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: (err as Error).message });
    } finally {
      setUploadingLogo(false);
      if (logoFileRef.current) logoFileRef.current.value = "";
    }
  }

  function toggleId(arr: number[], id: number): number[] {
    return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBanner(true);
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
      update("bannerUrl", data.url ?? null);
    } catch (err) {
      toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: (err as Error).message });
    } finally {
      setUploadingBanner(false);
      if (bannerFileRef.current) bannerFileRef.current.value = "";
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl">
        <div className="h-6 w-48 bg-muted animate-pulse rounded mb-8" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl space-y-6" dir={lang === "ar" ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">{t("Paramètres de la boutique en ligne", "إعدادات المتجر الإلكتروني")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("Configuration affichée dans le Web Store", "الإعدادات المعروضة في المتجر الإلكتروني")}
              {currentStore && ` — ${currentStore.nameEn || currentStore.nameAr}`}
            </p>
          </div>
        </div>
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          {t("Sauvegarder", "حفظ")}
        </Button>
      </div>

      {dirty && (
        <div className="flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("Des modifications non sauvegardées sont en attente.", "توجد تغييرات لم يتم حفظها بعد.")}
        </div>
      )}

      {/* ── 0. Identité du Magasin ── */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            {t("Identité du Magasin", "هوية المتجر")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />

          {/* Logo + Nom en grand */}
          <div className="flex flex-col sm:flex-row items-center gap-6 pb-2">
            {/* Logo upload zone */}
            <div className="relative flex-shrink-0">
              <button
                type="button"
                className="group relative h-24 w-24 rounded-xl border-2 border-dashed border-primary/30 overflow-hidden flex items-center justify-center bg-muted hover:border-primary transition-colors"
                onClick={() => logoFileRef.current?.click()}
                disabled={uploadingLogo}
              >
                {identity.logoUrl ? (
                  <img src={identity.logoUrl} alt="logo" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground group-hover:text-primary transition-colors">
                    {uploadingLogo ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                    <span className="text-[10px]">{t("Logo", "الشعار")}</span>
                  </div>
                )}
                {identity.logoUrl && (
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    {uploadingLogo ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Upload className="h-5 w-5 text-white" />}
                  </div>
                )}
              </button>
              {identity.logoUrl && !uploadingLogo && (
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center shadow"
                  onClick={() => { setIdentity((p) => ({ ...p, logoUrl: null })); setIdentityDirty(true); }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Nom en grand */}
            <div className="flex-1 text-center sm:text-start space-y-0.5 min-w-0">
              <p className="text-4xl font-serif font-bold text-primary leading-tight truncate">
                {identity.nameEn || <span className="text-muted-foreground/40">—</span>}
              </p>
              <p className="text-2xl font-bold text-primary/60 truncate" dir="rtl">
                {identity.nameAr || <span className="text-muted-foreground/40">—</span>}
              </p>
            </div>
          </div>

          <Separator />

          {/* Champs nom */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t("Nom (Français / Anglais)", "الاسم (الإنجليزية / الفرنسية)")}</Label>
              <Input
                value={identity.nameEn}
                onChange={(e) => { setIdentity((p) => ({ ...p, nameEn: e.target.value })); setIdentityDirty(true); }}
                placeholder="Midanic"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t("Nom (Arabe)", "الاسم (العربية)")}</Label>
              <Input
                value={identity.nameAr}
                onChange={(e) => { setIdentity((p) => ({ ...p, nameAr: e.target.value })); setIdentityDirty(true); }}
                dir="rtl"
                placeholder="ميدانيك"
              />
            </div>
          </div>

          <Button
            onClick={() => saveIdentity.mutate()}
            disabled={!identityDirty || !currentStore || saveIdentity.isPending}
            className="gap-2"
          >
            {saveIdentity.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("Sauvegarder l'identité", "حفظ هوية المتجر")}
          </Button>
        </CardContent>
      </Card>

      {/* ── 1. Visibilité et comportement ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            {t("Visibilité & Comportement", "الظهور والسلوك")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium text-sm">{t("Afficher les prix", "عرض الأسعار")}</p>
              <p className="text-xs text-muted-foreground">{t("Les clients voient les prix des produits", "يرى العملاء أسعار المنتجات")}</p>
            </div>
            <Switch checked={form.showPrices} onCheckedChange={(v) => update("showPrices", v)} />
          </div>
          <Separator />
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium text-sm">{t("Afficher le stock", "عرض المخزون")}</p>
              <p className="text-xs text-muted-foreground">{t("Les clients voient la disponibilité des produits", "يرى العملاء توفر المنتجات")}</p>
            </div>
            <Switch checked={form.showStock} onCheckedChange={(v) => update("showStock", v)} />
          </div>
          <Separator />
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium text-sm">{t("Accepter les commandes", "استقبال الطلبات")}</p>
              <p className="text-xs text-muted-foreground">{t("Si désactivé, les clients ne peuvent pas passer de commande", "إذا تم تعطيله، لا يمكن للعملاء تقديم طلبات")}</p>
            </div>
            <Switch checked={form.acceptOrders} onCheckedChange={(v) => update("acceptOrders", v)} />
          </div>
          {!form.acceptOrders && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t("Les commandes sont actuellement suspendues sur la boutique.", "الطلبات معلقة حالياً في المتجر.")}
            </div>
          )}
          <Separator />
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("Montant minimum de commande (DA)", "الحد الأدنى للطلب (دج)")}</Label>
            <p className="text-xs text-muted-foreground">{t("Laisser à 0 pour désactiver la limite.", "اتركه 0 لتعطيل الحد الأدنى.")}</p>
            <Input
              type="number"
              min={0}
              step={50}
              value={form.minOrderAmount as number}
              onChange={(e) => update("minOrderAmount", Number(e.target.value))}
              className="max-w-xs"
              placeholder="0"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── 2. Médias & Identité ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Image className="h-4 w-4 text-primary" />
            {t("Médias & Identité", "الهوية والوسائط")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t("Image de couverture (Banner)", "صورة الغلاف (Banner)")}
            </Label>
            <input
              ref={bannerFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleBannerUpload}
            />
            {form.bannerUrl ? (
              <div className="space-y-2">
                <div className="relative">
                  <img src={form.bannerUrl} alt="banner preview" className="rounded-lg max-h-48 object-cover w-full border" />
                  <button
                    type="button"
                    className="absolute top-2 right-2 h-7 w-7 rounded-full bg-destructive text-white flex items-center justify-center shadow-md"
                    onClick={() => { update("bannerUrl", null); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex gap-2 items-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => bannerFileRef.current?.click()}
                    disabled={uploadingBanner}
                  >
                    {uploadingBanner ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {t("Changer l'image", "تغيير الصورة")}
                  </Button>
                </div>
                <Input
                  value={form.bannerUrl ?? ""}
                  onChange={(e) => update("bannerUrl", e.target.value || null)}
                  placeholder="https://..."
                  className="text-xs font-mono h-8"
                />
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-24 w-full border-dashed flex flex-col items-center justify-center gap-2"
                onClick={() => bannerFileRef.current?.click()}
                disabled={uploadingBanner}
              >
                {uploadingBanner ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /><span className="text-xs text-muted-foreground">{t("Téléchargement...", "جاري الرفع...")}</span></>
                ) : (
                  <><Upload className="h-5 w-5 text-muted-foreground" /><span className="text-xs text-muted-foreground">{t("Cliquer pour uploader une image de couverture", "انقر لرفع صورة الغلاف")}</span></>
                )}
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("Description de la boutique", "وصف المتجر")}</Label>
            <Textarea
              rows={3}
              value={form.description ?? ""}
              onChange={(e) => update("description", e.target.value || null)}
              placeholder={t("Description affichée sur la page d'accueil...", "الوصف الظاهر في الصفحة الرئيسية...")}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── 3. Informations de contact ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            {t("Informations de contact", "معلومات التواصل")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {t("Email", "البريد الإلكتروني")}</Label>
            <Input value={form.email ?? ""} onChange={(e) => update("email", e.target.value || null)} placeholder="contact@example.com" type="email" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {t("Téléphone", "الهاتف")}</Label>
            <Input value={currentStore?.phone ?? ""} disabled placeholder={t("Géré dans Paramètres → Général", "يُدار في الإعدادات → عام")} className="bg-muted/30" />
            <p className="text-xs text-muted-foreground">{t("Modifiable dans Paramètres → Général", "قابل للتعديل في الإعدادات → عام")}</p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {t("Adresse", "العنوان")}</Label>
            <Input value={currentStore?.address ?? ""} disabled placeholder={t("Géré dans Paramètres → Général", "يُدار في الإعدادات → عام")} className="bg-muted/30" />
          </div>
        </CardContent>
      </Card>

      {/* ── 4. Réseaux sociaux ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-primary" />
            {t("Réseaux sociaux", "شبكات التواصل الاجتماعي")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5"><Facebook className="h-3.5 w-3.5" /> Facebook</Label>
            <Input value={form.facebookUrl ?? ""} onChange={(e) => update("facebookUrl", e.target.value || null)} placeholder="https://facebook.com/..." />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5"><Instagram className="h-3.5 w-3.5" /> Instagram</Label>
            <Input value={form.instagramUrl ?? ""} onChange={(e) => update("instagramUrl", e.target.value || null)} placeholder="https://instagram.com/..." />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.17a8.16 8.16 0 0 0 4.77 1.52V7.24a4.85 4.85 0 0 1-1-.55z"/></svg>
              TikTok
            </Label>
            <Input value={form.tiktokUrl ?? ""} onChange={(e) => update("tiktokUrl", e.target.value || null)} placeholder="https://tiktok.com/@..." />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.998 2C6.477 2 2 6.477 2 12c0 1.884.518 3.645 1.419 5.156L2 22l4.979-1.391A9.945 9.945 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 11.998 2z"/></svg>
              WhatsApp
            </Label>
            <Input value={form.whatsappNumber ?? ""} onChange={(e) => update("whatsappNumber", e.target.value || null)} placeholder="+213 5XX XXX XXX" />
          </div>
        </CardContent>
      </Card>

      {/* ── 5. Mise en avant — Catégories ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {t("Catégories mises en avant", "التصنيفات المميزة في الصفحة الرئيسية")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {t("Les catégories sélectionnées apparaissent en premier sur la page d'accueil.", "التصنيفات المحددة تظهر أولاً في الصفحة الرئيسية.")}
          </p>
          {(!categories || categories.length === 0) ? (
            <p className="text-sm text-muted-foreground">{t("Aucune catégorie disponible.", "لا توجد تصنيفات متاحة.")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const selected = form.featuredCategoryIds.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => update("featuredCategoryIds", toggleId(form.featuredCategoryIds, cat.id))}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary hover:text-primary"
                    }`}
                  >
                    {lang === "ar" ? cat.nameAr : cat.nameEn}
                    {selected && " ✓"}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 6. Mise en avant — Produits ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            {t("Produits mis en avant", "المنتجات المميزة في الصفحة الرئيسية")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {t("Les produits sélectionnés apparaissent en premier dans la collection sur la page d'accueil.", "المنتجات المحددة تظهر أولاً في المجموعة على الصفحة الرئيسية.")}
          </p>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Aucun produit disponible.", "لا توجد منتجات متاحة.")}</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
              {products.map((p) => {
                const selected = form.featuredProductIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => update("featuredProductIds", toggleId(form.featuredProductIds, p.id))}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary hover:text-primary"
                    }`}
                  >
                    {lang === "ar" ? (p.nameAr || p.nameEn) : (p.nameEn || p.nameAr)}
                    {selected && " ✓"}
                  </button>
                );
              })}
            </div>
          )}
          {form.featuredProductIds.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {form.featuredProductIds.length} {t("produit(s) sélectionné(s)", "منتج محدد")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Save footer */}
      <div className="flex justify-end pt-2 pb-8">
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} size="lg" className="gap-2 min-w-40">
          <Save className="h-4 w-4" />
          {save.isPending ? t("Sauvegarde...", "جاري الحفظ...") : t("Sauvegarder les paramètres", "حفظ الإعدادات")}
        </Button>
      </div>
    </div>
  );
}

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Info, CreditCard, Briefcase, FileText, User, MapPin, Tag, Building2 } from "lucide-react";
import { WILAYAS, getCommunesByWilaya } from "@/data/algeria-geo";
import { CommuneCombobox } from "@/components/ui/commune-combobox";
import type { CustomerClassification, PriceTier } from "@workspace/api-client-react";

export type ContactFormState = {
  name: string;
  email: string;
  password: string;
  phone: string;
  address: string;
  commune: string;
  gps: string;
  notes: string;
  contactType: string;
  wilaya: string;
  classificationId: string;
  priceTierId: string;
  accountNumber: string;
  rc: string;
  nif: string;
  ai: string;
  nis: string;
  creditLimit: string;
  minBalanceAlert: string;
  currentBalance: string;
  foreignCurrency: boolean;
};

export const emptyContactForm: ContactFormState = {
  name: "", email: "", password: "", phone: "", address: "",
  commune: "", gps: "", notes: "", contactType: "customer",
  wilaya: "", classificationId: "", priceTierId: "",
  accountNumber: "", rc: "", nif: "", ai: "", nis: "",
  creditLimit: "", minBalanceAlert: "", currentBalance: "0", foreignCurrency: false,
};

export type ContactTypeOption = { value: string; label: string };

type TFn = (fr: string, ar: string) => string;

/**
 * Shared rich 4-tab contact form dialog.
 * Used both by the Customers page ("Nouveau client") and the Suppliers page
 * ("Ajouter un fournisseur"). The dialog is purely presentational/controlled:
 * each page owns its own form state, save handler and save target, so reusing
 * the visual component does not change either page's persistence logic.
 */
export function ContactFormDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSave,
  saving,
  error,
  title,
  classifs,
  tiers,
  currency,
  lang,
  t,
  contactTypeOptions,
  saveButtonTestId = "button-save-customer",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: ContactFormState;
  setForm: (value: ContactFormState) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  title: React.ReactNode;
  classifs: CustomerClassification[];
  tiers: PriceTier[];
  currency: string;
  lang: string;
  t: TFn;
  contactTypeOptions: ContactTypeOption[];
  saveButtonTestId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {title}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="basic" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pt-3 border-b shrink-0">
            <TabsList className="h-9">
              <TabsTrigger value="basic" className="text-xs gap-1">
                <Info className="h-3.5 w-3.5" />{t("Infos de base", "أساسي")}
              </TabsTrigger>
              <TabsTrigger value="financial" className="text-xs gap-1">
                <CreditCard className="h-3.5 w-3.5" />{t("Financier", "المالي")}
              </TabsTrigger>
              <TabsTrigger value="legal" className="text-xs gap-1">
                <Briefcase className="h-3.5 w-3.5" />{t("Juridique", "القانوني")}
              </TabsTrigger>
              <TabsTrigger value="notes" className="text-xs gap-1">
                <FileText className="h-3.5 w-3.5" />{t("Notes", "ملاحظات")}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Tab 1: Basic Info ── */}
          <TabsContent value="basic" className="flex-1 overflow-y-auto p-6 mt-0 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <User className="h-3.5 w-3.5" />{t("Identité", "الهوية")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cn-name">{t("Nom *", "الاسم *")}</Label>
                <Input id="cn-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus data-testid="input-customer-name" className="h-8 text-sm" />
              </div>
              <div>
                <Label htmlFor="cn-email">{t("Email *", "البريد *")}</Label>
                <Input id="cn-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-customer-email" className="h-8 text-sm" />
              </div>
              <div>
                <Label htmlFor="cn-phone">{t("Téléphone", "الهاتف")}</Label>
                <Input id="cn-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+213 ..." data-testid="input-customer-phone" className="h-8 text-sm" />
              </div>
              <div>
                <Label htmlFor="cn-type">{t("Type de contact", "نوع الاتصال")}</Label>
                <Select value={form.contactType} onValueChange={(v) => setForm({ ...form, contactType: v })}>
                  <SelectTrigger id="cn-type" className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {contactTypeOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />{t("Localisation", "الموقع الجغرافي")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cn-wilaya">{t("Wilaya", "الولاية")}</Label>
                <Select value={form.wilaya} onValueChange={(v) => setForm({ ...form, wilaya: v === "none" ? "" : v, commune: "" })}>
                  <SelectTrigger id="cn-wilaya" className="h-8 text-sm"><SelectValue placeholder={t("Choisir...", "اختر...")} /></SelectTrigger>
                  <SelectContent className="max-h-[260px] overflow-y-auto">
                    <SelectItem value="none">{t("Non précisée", "غير محددة")}</SelectItem>
                    {WILAYAS.map((w) => (
                      <SelectItem key={w.code} value={w.nameFr}>{w.code} — {lang === "ar" ? w.nameAr : w.nameFr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cn-commune">{t("Commune", "البلدية")}</Label>
                {(() => {
                  const wObj = WILAYAS.find((w) => w.nameFr === form.wilaya);
                  const comms = wObj ? getCommunesByWilaya(wObj.code) : [];
                  return (
                    <CommuneCombobox
                      communes={comms}
                      value={form.commune}
                      onChange={(v) => setForm({ ...form, commune: v })}
                      placeholder={t("Choisir...", "اختر...")}
                      searchPlaceholder={t("Rechercher commune...", "بحث عن بلدية...")}
                      emptyText={t("Aucune commune trouvée", "لا توجد نتائج")}
                      disabled={comms.length === 0}
                    />
                  );
                })()}
              </div>
              <div className="col-span-2">
                <Label htmlFor="cn-address">{t("Adresse", "العنوان")}</Label>
                <Input id="cn-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="input-customer-address" className="h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="cn-gps">{t("GPS (lat,lng)", "GPS (خط,طول)")}</Label>
                <Input id="cn-gps" value={form.gps} onChange={(e) => setForm({ ...form, gps: e.target.value })} className="h-8 text-sm font-mono" placeholder="36.737,3.086" />
              </div>
            </div>

            <Separator />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Tag className="h-3.5 w-3.5" />{t("Classification & Tarif", "التصنيف والتسعير")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("Classification", "التصنيف")}</Label>
                <Select value={form.classificationId} onValueChange={(v) => setForm({ ...form, classificationId: v === "none" ? "" : v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Aucune", "بدون")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("Aucune", "بدون")}</SelectItem>
                    {classifs.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        <div className="flex items-center gap-2">
                          {c.color && <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                          {lang === "ar" ? c.labelAr : c.labelFr}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("Grille de prix", "شريحة السعر")}</Label>
                <Select value={form.priceTierId} onValueChange={(v) => setForm({ ...form, priceTierId: v === "none" ? "" : v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Standard", "قياسي")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("Standard", "قياسي")}</SelectItem>
                    {tiers.map((tier) => (
                      <SelectItem key={tier.id} value={String(tier.id)}>
                        {lang === "ar" ? tier.labelAr : tier.labelFr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 2: Financial ── */}
          <TabsContent value="financial" className="flex-1 overflow-y-auto p-6 mt-0 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <CreditCard className="h-3.5 w-3.5" />{t("Informations financières", "المعلومات المالية")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cn-accno">{t("N° Compte", "رقم الحساب")}</Label>
                <Input id="cn-accno" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} className="h-8 text-sm font-mono" />
              </div>
              <div>
                <Label htmlFor="cn-balance">{t(`Solde initial (${currency})`, `الرصيد الابتدائي (${currency})`)}</Label>
                <Input id="cn-balance" type="number" value={form.currentBalance} onChange={(e) => setForm({ ...form, currentBalance: e.target.value })} className="h-8 text-sm" />
              </div>
              <div>
                <Label htmlFor="cn-credit">{t(`Plafond crédit (${currency})`, `سقف الائتمان (${currency})`)}</Label>
                <Input id="cn-credit" type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} placeholder="0.00" className="h-8 text-sm" />
              </div>
              <div>
                <Label htmlFor="cn-minalert">{t(`Alerte solde min. (${currency})`, `تنبيه الرصيد الأدنى (${currency})`)}</Label>
                <Input id="cn-minalert" type="number" value={form.minBalanceAlert} onChange={(e) => setForm({ ...form, minBalanceAlert: e.target.value })} placeholder="0.00" className="h-8 text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch checked={form.foreignCurrency} onCheckedChange={(v) => setForm({ ...form, foreignCurrency: v })} />
              <Label>{t("Devise étrangère", "عملة أجنبية")}</Label>
            </div>
          </TabsContent>

          {/* ── Tab 3: Legal ── */}
          <TabsContent value="legal" className="flex-1 overflow-y-auto p-6 mt-0 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" />{t("Identifiants légaux", "المعرّفات القانونية")}
            </p>
            <div className="grid grid-cols-2 gap-4">
              {(["rc", "nif", "ai", "nis"] as const).map((field) => {
                const labels: Record<string, [string, string]> = {
                  rc: ["RC (Registre Commerce)", "سجل تجاري (RC)"],
                  nif: ["NIF (N° Fiscal)", "رقم الضريبي (NIF)"],
                  ai: ["AI (Article d'Imposition)", "مادة الفرض (AI)"],
                  nis: ["NIS (N° Statistiques)", "رقم الإحصائي (NIS)"],
                };
                return (
                  <div key={field}>
                    <Label htmlFor={`cn-${field}`}>{t(labels[field][0], labels[field][1])}</Label>
                    <Input
                      id={`cn-${field}`}
                      value={form[field]}
                      onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                      className="h-8 text-sm font-mono"
                      placeholder={field.toUpperCase()}
                    />
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* ── Tab 4: Notes ── */}
          <TabsContent value="notes" className="flex-1 overflow-y-auto p-6 mt-0 space-y-4">
            <div>
              <Label htmlFor="cn-notes">{t("Notes CRM", "ملاحظات")}</Label>
              <textarea
                id="cn-notes"
                className="w-full mt-1 p-2 text-sm border rounded-md resize-none h-28 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder={t("Informations supplémentaires...", "معلومات إضافية...")}
              />
            </div>
            <Separator />
            <div>
              <Label htmlFor="cn-pwd">{t("Mot de passe", "كلمة المرور")}</Label>
              <Input id="cn-pwd" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={t("Auto-généré si vide", "يُولّد تلقائياً")} data-testid="input-customer-password" className="h-8 text-sm" />
              <p className="text-[11px] text-muted-foreground mt-1">{t("Min. 6 caractères.", "6 أحرف كحد أدنى.")}</p>
            </div>
          </TabsContent>
        </Tabs>

        {/* Fixed bottom save bar */}
        <div className="px-6 py-3 border-t bg-background flex items-center gap-3 shrink-0">
          <div className="flex-1">
            {error && <p className="text-sm text-red-600" data-testid="text-create-error">{error}</p>}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Annuler", "إلغاء")}</Button>
          <Button onClick={onSave} disabled={saving} className="bg-[#1B3057] hover:bg-[#1B3057]/90" data-testid={saveButtonTestId}>
            {saving ? "..." : t("Enregistrer", "حفظ")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import {
  useGetErpCustomers, useGetErpCustomer, useCreateCustomerNote,
  useCreateErpCustomer, useUpdateErpCustomer,
  useGetErpCustomerClassifications, useGetErpPriceTiers,
  getGetErpCustomersQueryKey, getGetErpCustomerQueryKey,
  useGetCustomerOperations, useCreateCustomerOperation,
  useUpdateCustomerOperation, useDeleteCustomerOperation,
  getGetCustomerOperationsQueryKey,
  type CustomerSummary, type CustomerNote, type CustomerClassification, type PriceTier,
  type CustomerOperation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/use-me";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  User, MessageSquarePlus, UserPlus, Search, Download,
  MapPin, Phone, Mail, Building2, Tag, Layers, CreditCard,
  Briefcase, Info, FileText, X, Printer, MoreVertical,
  Pencil, Eye, EyeOff, ShoppingBag, BarChart2, StickyNote, KeyRound,
  ArrowDownCircle, ArrowUpCircle, Plus, ChevronLeft,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { WILAYAS, getCommunesByWilaya } from "@/data/algeria-geo";
import { CommuneCombobox } from "@/components/ui/commune-combobox";
import { ContactFormDialog } from "@/components/ContactFormDialog";
import { ShippingLabelModal } from "@/components/ShippingLabelModal";
import { useCurrentStore } from "@/hooks/use-current-store";

type TFn = (fr: string, ar: string) => string;

function ClassifBadge({ c }: { c?: CustomerClassification | null }) {
  if (!c) return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border"
      style={c.color ? { backgroundColor: c.color + "22", borderColor: c.color, color: c.color } : {}}
    >
      {c.labelFr}
    </span>
  );
}

function TierBadge({ pt, lang }: { pt?: PriceTier | null; lang: string }) {
  if (!pt) return null;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
      {lang === "ar" ? pt.labelAr : pt.labelFr}
    </span>
  );
}

function CustomerSheet({ customerId, onClose, t, lang, currency, initialTab = "basic", initialEditing = false }: {
  customerId: number; onClose: () => void; t: TFn; lang: string; currency: string;
  initialTab?: string; initialEditing?: boolean;
}) {
  const qc = useQueryClient();
  const { data: customer, isLoading } = useGetErpCustomer(customerId, {
    query: { enabled: !!customerId, queryKey: getGetErpCustomerQueryKey(customerId) },
  });
  const { data: classifs = [] } = useGetErpCustomerClassifications();
  const { data: tiers = [] } = useGetErpPriceTiers();
  const updateCustomer = useUpdateErpCustomer();
  const addNote = useCreateCustomerNote();

  const store = useCurrentStore();
  const [note, setNote] = useState("");
  const [activeTab, setActiveTab] = useState(initialTab);
  const [editing, setEditing] = useState(initialEditing);
  const [form, setForm] = useState<Record<string, string | boolean | number | null>>({});
  const [labelOpen, setLabelOpen] = useState(false);

  React.useEffect(() => {
    if (customer) {
      const p = (customer.profile ?? {}) as Record<string, unknown>;
      const s = (v: unknown, fallback = "") => (v != null ? String(v) : fallback);
      setForm({
        name: s(customer.name),
        phone: s(customer.phone),
        address: s(customer.address),
        city: s(customer.city),
        contactType: s(p.contactType, "customer"),
        wilaya: s(p.wilaya),
        commune: s(p.commune),
        gps: s(p.gps),
        classificationId: p.classificationId != null ? String(p.classificationId) : "",
        priceTierId: p.priceTierId != null ? String(p.priceTierId) : "",
        accountNumber: s(p.accountNumber),
        creditLimit: p.creditLimit != null ? String(p.creditLimit) : "",
        minBalanceAlert: p.minBalanceAlert != null ? String(p.minBalanceAlert) : "",
        currentBalance: p.currentBalance != null ? String(p.currentBalance) : "0",
        foreignCurrency: Boolean(p.foreignCurrency),
        rc: s(p.rc),
        nif: s(p.nif),
        ai: s(p.ai),
        nis: s(p.nis),
      });
    }
  }, [customer]);

  const handleSave = () => {
    const str = (k: string) => String(form[k] ?? "");
    const payload = {
      name: str("name") || undefined,
      phone: str("phone") || undefined,
      address: str("address") || undefined,
      city: str("city") || undefined,
      contactType: (str("contactType") || "customer") as "customer" | "customer_supplier",
      wilaya: str("wilaya") || null,
      commune: str("commune") || null,
      gps: str("gps") || null,
      classificationId: form.classificationId ? Number(form.classificationId) : null,
      priceTierId: form.priceTierId ? Number(form.priceTierId) : null,
      accountNumber: str("accountNumber") || null,
      creditLimit: form.creditLimit !== "" && form.creditLimit != null ? Number(form.creditLimit) : null,
      minBalanceAlert: form.minBalanceAlert !== "" && form.minBalanceAlert != null ? Number(form.minBalanceAlert) : null,
      currentBalance: form.currentBalance !== "" && form.currentBalance != null ? Number(form.currentBalance) : 0,
      foreignCurrency: Boolean(form.foreignCurrency),
      rc: str("rc") || null,
      nif: str("nif") || null,
      ai: str("ai") || null,
      nis: str("nis") || null,
    };
    updateCustomer.mutate({ id: customerId, data: payload }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetErpCustomerQueryKey(customerId) });
        qc.invalidateQueries({ queryKey: getGetErpCustomersQueryKey() });
        setEditing(false);
      },
    });
  };

  const handleAddNote = () => {
    if (!note.trim()) return;
    addNote.mutate({ id: customerId, data: { note } }, {
      onSettled: () => {
        qc.invalidateQueries({ queryKey: getGetErpCustomerQueryKey(customerId) });
        setNote("");
      },
    });
  };

  const selectedWilaya = String(form.wilaya ?? "");
  const wilayaObj = WILAYAS.find((w) => w.nameFr === selectedWilaya || w.nameAr === selectedWilaya);
  const communes = wilayaObj ? getCommunesByWilaya(wilayaObj.code) : [];

  if (isLoading) return (
    <div className="p-6 space-y-3">
      {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
  if (!customer) return <div className="p-6 text-muted-foreground">{t("Introuvable", "غير موجود")}</div>;

  const totalOrders = customer.orders?.length ?? 0;
  const totalSpent = (customer.orders ?? []).reduce((s, o) => s + parseFloat(o.totalAmount), 0);
  const profile = (customer.profile ?? {}) as Record<string, unknown>;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base truncate">{customer.name}</p>
            <p className="text-sm text-muted-foreground truncate">{customer.email}</p>
          </div>
          <div className="flex gap-3 text-center shrink-0">
            <div>
              <p className="font-bold text-primary text-lg">{totalOrders}</p>
              <p className="text-[10px] text-muted-foreground">{t("Cmd.", "طلبات")}</p>
            </div>
            <div>
              <p className="font-bold text-primary text-lg">{totalSpent.toFixed(0)}</p>
              <p className="text-[10px] text-muted-foreground">{currency}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <ClassifBadge c={profile.classification as CustomerClassification | null} />
          <TierBadge pt={profile.priceTier as PriceTier | null} lang={lang} />
          <div className="ml-auto flex gap-2">
            {!editing ? (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)}>
                {t("Modifier", "تعديل")}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(false)}>
                  {t("Annuler", "إلغاء")}
                </Button>
                <Button size="sm" className="h-7 text-xs bg-[#1B3057] hover:bg-[#152544]" onClick={handleSave} disabled={updateCustomer.isPending}>
                  {updateCustomer.isPending ? "..." : t("Enregistrer", "حفظ")}
                </Button>
              </>
            )}
            <Button
              size="sm" variant="outline"
              className="h-7 w-7 p-0"
              title={t("Étiquette de livraison", "ملصق الشحن")}
              onClick={() => setLabelOpen(true)}
            >
              <Printer className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-y-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="px-6 pt-3 border-b">
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Nom", "الاسم")}</Label>
                {editing
                  ? <Input value={String(form.name ?? "")} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-8 text-sm" />
                  : <p className="text-sm font-medium py-1">{customer.name}</p>}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1">
                  <Mail className="h-3 w-3" /> Email
                </Label>
                <p className="text-sm py-1 text-muted-foreground truncate">{customer.email}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1">
                  <Phone className="h-3 w-3" />{t("Téléphone", "الهاتف")}
                </Label>
                {editing
                  ? <Input value={String(form.phone ?? "")} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="h-8 text-sm" />
                  : <p className="text-sm py-1">{customer.phone || "—"}</p>}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Type de contact", "نوع الاتصال")}</Label>
                {editing ? (
                  <Select value={String(form.contactType ?? "customer")} onValueChange={(v) => setForm((f) => ({ ...f, contactType: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">{t("Client", "عميل")}</SelectItem>
                      <SelectItem value="customer_supplier">{t("Client / Fournisseur", "عميل / مورد")}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm py-1">
                    {profile.contactType === "customer_supplier" ? t("Client / Fournisseur", "عميل / مورد") : t("Client", "عميل")}
                  </p>
                )}
              </div>
            </div>

            <Separator />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />{t("Localisation", "الموقع الجغرافي")}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Wilaya", "الولاية")}</Label>
                {editing ? (
                  <Select value={String(form.wilaya ?? "")} onValueChange={(v) => setForm((f) => ({ ...f, wilaya: v, commune: "" }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Choisir...", "اختر...")} /></SelectTrigger>
                    <SelectContent className="max-h-[260px] overflow-y-auto">
                      {WILAYAS.map((w) => (
                        <SelectItem key={w.code} value={w.nameFr}>{w.code} — {lang === "ar" ? w.nameAr : w.nameFr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : <p className="text-sm py-1">{String(profile.wilaya ?? "") || "—"}</p>}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Commune", "البلدية")}</Label>
                {editing ? (
                  <CommuneCombobox
                    communes={communes}
                    value={String(form.commune ?? "")}
                    onChange={(v) => setForm((f) => ({ ...f, commune: v }))}
                    placeholder={t("Choisir...", "اختر...")}
                    searchPlaceholder={t("Rechercher commune...", "بحث عن بلدية...")}
                    emptyText={t("Aucune commune trouvée", "لا توجد نتائج")}
                  />
                ) : <p className="text-sm py-1">{String(profile.commune ?? "") || "—"}</p>}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Adresse", "العنوان")}</Label>
                {editing
                  ? <Input value={String(form.address ?? "")} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="h-8 text-sm" />
                  : <p className="text-sm py-1">{customer.address || "—"}</p>}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("GPS (lat,lng)", "GPS")}</Label>
                {editing
                  ? <Input value={String(form.gps ?? "")} onChange={(e) => setForm((f) => ({ ...f, gps: e.target.value }))} className="h-8 text-sm font-mono" placeholder="36.737,3.086" />
                  : <p className="text-sm py-1 font-mono">{String(profile.gps ?? "") || "—"}</p>}
              </div>
            </div>

            <Separator />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Tag className="h-3.5 w-3.5" />{t("Classification & Tarif", "التصنيف والتسعير")}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Classification", "التصنيف")}</Label>
                {editing ? (
                  <Select value={String(form.classificationId ?? "")} onValueChange={(v) => setForm((f) => ({ ...f, classificationId: v === "none" ? "" : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Aucune", "بدون")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("Aucune", "بدون")}</SelectItem>
                      {(classifs as CustomerClassification[]).map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          <div className="flex items-center gap-2">
                            {c.color && <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                            {lang === "ar" ? c.labelAr : c.labelFr}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : <ClassifBadge c={profile.classification as CustomerClassification | null} />}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Grille de prix", "شريحة السعر")}</Label>
                {editing ? (
                  <Select value={String(form.priceTierId ?? "")} onValueChange={(v) => setForm((f) => ({ ...f, priceTierId: v === "none" ? "" : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Standard", "قياسي")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("Standard", "قياسي")}</SelectItem>
                      {(tiers as PriceTier[]).map((tier) => (
                        <SelectItem key={tier.id} value={String(tier.id)}>
                          {lang === "ar" ? tier.labelAr : tier.labelFr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : <TierBadge pt={profile.priceTier as PriceTier | null} lang={lang} />}
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
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("N° Compte", "رقم الحساب")}</Label>
                {editing
                  ? <Input value={String(form.accountNumber ?? "")} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} className="h-8 text-sm font-mono" />
                  : <p className="text-sm py-1 font-mono">{String(profile.accountNumber ?? "") || "—"}</p>}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Solde actuel", "الرصيد الحالي")} ({currency})</Label>
                {editing
                  ? <Input type="number" value={String(form.currentBalance ?? "0")} onChange={(e) => setForm((f) => ({ ...f, currentBalance: e.target.value }))} className="h-8 text-sm" />
                  : <p className="text-sm py-1 font-semibold text-primary">{Number(profile.currentBalance ?? 0).toFixed(2)} {currency}</p>}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Plafond crédit", "سقف الائتمان")} ({currency})</Label>
                {editing
                  ? <Input type="number" value={String(form.creditLimit ?? "")} onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value }))} className="h-8 text-sm" placeholder="0.00" />
                  : <p className="text-sm py-1">{profile.creditLimit != null ? `${Number(profile.creditLimit).toFixed(2)} ${currency}` : "—"}</p>}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Alerte solde min.", "تنبيه الرصيد")} ({currency})</Label>
                {editing
                  ? <Input type="number" value={String(form.minBalanceAlert ?? "")} onChange={(e) => setForm((f) => ({ ...f, minBalanceAlert: e.target.value }))} className="h-8 text-sm" placeholder="0.00" />
                  : <p className="text-sm py-1">{profile.minBalanceAlert != null ? `${Number(profile.minBalanceAlert).toFixed(2)} ${currency}` : "—"}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-sm">{t("Devise étrangère", "عملة أجنبية")}</Label>
              {editing
                ? <Switch checked={Boolean(form.foreignCurrency)} onCheckedChange={(v) => setForm((f) => ({ ...f, foreignCurrency: v }))} />
                : <Badge variant="outline" className="text-xs">{Boolean(profile.foreignCurrency) ? t("Oui", "نعم") : t("Non", "لا")}</Badge>}
            </div>

            <Separator />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t("Historique commandes", "سجل الطلبات")}
            </p>
            <div className="space-y-1">
              {(customer.orders ?? []).slice(0, 10).map((o) => (
                <div key={o.id} className="flex items-center justify-between py-2 border-b border-muted last:border-0">
                  <div>
                    <p className="text-sm font-medium">#{o.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.createdAt ? format(new Date(o.createdAt), "dd/MM/yyyy") : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-primary">{Number(o.totalAmount).toFixed(2)} {currency}</p>
                    <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                  </div>
                </div>
              ))}
              {(!customer.orders || customer.orders.length === 0) && (
                <p className="text-sm text-muted-foreground">{t("Aucune commande", "لا توجد طلبات")}</p>
              )}
            </div>
          </TabsContent>

          {/* ── Tab 3: Legal ── */}
          <TabsContent value="legal" className="flex-1 overflow-y-auto p-6 mt-0 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" />{t("Informations juridiques", "المعلومات القانونية")}
            </p>
            <div className="grid grid-cols-2 gap-4">
              {(["rc", "nif", "ai", "nis"] as const).map((field) => {
                const labels: Record<string, [string, string]> = {
                  rc: ["RC (Registre Commerce)", "سجل تجاري (RC)"],
                  nif: ["NIF (N° Fiscal)", "رقم التعريف الضريبي (NIF)"],
                  ai: ["AI (Article d'Imposition)", "مادة الفرض (AI)"],
                  nis: ["NIS (N° Statistiques)", "رقم التعريف الإحصائي (NIS)"],
                };
                return (
                  <div key={field}>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      {t(labels[field][0], labels[field][1])}
                    </Label>
                    {editing
                      ? <Input value={String(form[field] ?? "")} onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))} className="h-8 text-sm font-mono" placeholder={field.toUpperCase()} />
                      : <p className="text-sm py-1 font-mono">{String(profile[field] ?? "") || "—"}</p>}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* ── Tab 4: Notes ── */}
          <TabsContent value="notes" className="flex-1 overflow-y-auto p-6 mt-0 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t("Notes CRM", "ملاحظات")}
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(customer.notes ?? []).map((n: CustomerNote) => (
                <div key={n.id} className="bg-muted/50 rounded-md p-3 text-sm">
                  <p>{n.note}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {n.createdAt ? format(new Date(n.createdAt), "dd/MM/yyyy HH:mm") : ""}
                  </p>
                </div>
              ))}
              {(!customer.notes || customer.notes.length === 0) && (
                <p className="text-sm text-muted-foreground">{t("Aucune note", "لا توجد ملاحظات")}</p>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-8 text-sm flex-1"
                placeholder={t("Ajouter une note...", "إضافة ملاحظة...")}
                onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
              />
              <Button size="sm" onClick={handleAddNote} disabled={addNote.isPending || !note.trim()}>
                <MessageSquarePlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Shipping label modal */}
      <ShippingLabelModal
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        customer={{
          customerId,
          name: customer.name,
          phone: customer.phone,
          wilaya: String(profile.wilaya ?? "") || null,
          commune: String(profile.commune ?? "") || null,
          address: customer.address,
        }}
        storeInfo={store ? {
          name: store.nameAr || store.nameEn || "Midanic",
          phone: store.phone ?? null,
          address: store.address ?? null,
          logoUrl: store.logoUrl ?? null,
        } : null}
        lang={lang}
      />
    </div>
  );
}

// ─── Customer Detail Sheet ────────────────────────────────────────
function CustomerDetailSheet({ customerId, onClose, t, lang, currency }: {
  customerId: number; onClose: () => void; t: TFn; lang: string; currency: string;
}) {
  const qc = useQueryClient();
  const { data: customer, isLoading } = useGetErpCustomer(customerId, {
    query: { enabled: !!customerId, queryKey: getGetErpCustomerQueryKey(customerId) },
  });
  const { data: opsRaw = [] } = useGetCustomerOperations(customerId, {}, {
    query: { queryKey: getGetCustomerOperationsQueryKey(customerId, {}) },
  });
  const createOp = useCreateCustomerOperation();

  const [activeTab, setActiveTab] = useState("detail");
  const [quickOp, setQuickOp] = useState<{ type: "versement" | "remboursement" } | null>(null);
  const [quickForm, setQuickForm] = useState({ amount: "", date: new Date().toISOString().slice(0, 10), reference: "", note: "" });
  const [quickError, setQuickError] = useState<string | null>(null);
  const [resetPwdOpen, setResetPwdOpen] = useState(false);
  const [resetPwdValue, setResetPwdValue] = useState("");
  const [resetPwdError, setResetPwdError] = useState<string | null>(null);
  const [resetPwdSuccess, setResetPwdSuccess] = useState(false);
  const updateCustomerPwd = useUpdateErpCustomer();

  const fmtDt = (d: string | null | undefined) => {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yyyy HH:mm"); } catch { return d; }
  };

  if (isLoading) return (
    <div className="p-6 space-y-3">
      {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
  if (!customer) return <div className="p-6 text-muted-foreground">{t("Introuvable", "غير موجود")}</div>;

  const profile = (customer.profile ?? {}) as Record<string, unknown>;
  const ops = opsRaw as CustomerOperation[];
  const totalVersements   = ops.filter((o) => o.type === "versement").reduce((s, o) => s + Number(o.amount), 0);
  const totalRemboursements = ops.filter((o) => o.type === "remboursement").reduce((s, o) => s + Number(o.amount), 0);
  const totalVentesATerme = ops.filter((o) => (o.type as string) === "vente_a_terme").reduce((s, o) => s + Number(o.amount), 0);
  const currentBalance = Number(profile.currentBalance ?? 0);

  const orders = customer.orders ?? [];
  const ventes = orders.filter((o) => (o.status as string) !== "returned");
  const retours = orders.filter((o) => (o.status as string) === "returned");

  function handleQuickOp() {
    const num = Number(quickForm.amount);
    if (!num || num <= 0) { setQuickError(t("Montant invalide", "مبلغ غير صالح")); return; }
    createOp.mutate(
      {
        id: customerId,
        data: {
          type: quickOp!.type,
          amount: num,
          date: quickForm.date,
          reference: quickForm.reference || undefined,
          note: quickForm.note || undefined,
        },
      },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getGetErpCustomerQueryKey(customerId) });
          void qc.invalidateQueries({ queryKey: getGetErpCustomersQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetCustomerOperationsQueryKey(customerId, {}) });
          setQuickOp(null);
          setQuickForm({ amount: "", date: new Date().toISOString().slice(0, 10), reference: "", note: "" });
          setQuickError(null);
        },
        onError: () => setQuickError(t("Erreur lors de l'enregistrement", "خطأ في الحفظ")),
      }
    );
  }

  const opTypeLabel = (type: string) => {
    if (type === "versement")    return { label: t("Versement", "دفعة"),       cls: "text-green-700 bg-green-50 border-green-200" };
    if (type === "remboursement") return { label: t("Remboursement", "استرداد"), cls: "text-red-600 bg-red-50 border-red-200" };
    if (type === "avoir_retour") return { label: t("Avoir / Retour", "إشعار دائن"), cls: "text-green-700 bg-green-50 border-green-200" };
    return { label: t("Vente à terme", "بيع آجل"), cls: "text-amber-700 bg-amber-50 border-amber-200" };
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      pending: t("En attente", "معلق"), confirmed: t("Confirmé", "مؤكد"),
      shipped: t("Expédié", "مشحون"), delivered: t("Livré", "مسلّم"),
      returned: t("Retourné", "مرتجع"), cancelled: t("Annulé", "ملغى"),
    };
    return map[s] ?? s;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base truncate">{customer.name}</p>
            <p className="text-sm text-muted-foreground truncate">{customer.email}</p>
          </div>
          <div className="flex items-center gap-3 text-center shrink-0">
            <div>
              <p className="font-bold text-primary">{orders.length}</p>
              <p className="text-[10px] text-muted-foreground">{t("Cmd.", "طلبات")}</p>
            </div>
            <div>
              <p className={`font-bold text-sm ${currentBalance > 0 ? "text-red-600" : currentBalance < 0 ? "text-green-700" : "text-foreground"}`}>
                {currentBalance > 0 ? "+" : ""}{currentBalance.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground">{t("Solde", "الرصيد")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-3 border-b shrink-0">
          <TabsList className="h-9 text-xs">
            <TabsTrigger value="detail"  className="text-xs px-3">DÉTAIL</TabsTrigger>
            <TabsTrigger value="balance" className="text-xs px-3">BALANCE</TabsTrigger>
            <TabsTrigger value="ventes"  className="text-xs px-3">VENTES</TabsTrigger>
            <TabsTrigger value="retours" className="text-xs px-3">RETOURS</TabsTrigger>
          </TabsList>
        </div>

        {/* ── DÉTAIL ── */}
        <TabsContent value="detail" className="flex-1 overflow-y-auto p-6 mt-0 space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("Informations générales", "المعلومات العامة")}</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Nom", "الاسم")}</p>
                <p className="font-medium">{customer.name || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Email", "البريد الإلكتروني")}</p>
                <p className="font-medium break-all">{customer.email || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Téléphone", "الهاتف")}</p>
                <p className="font-medium">{customer.phone || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Type", "النوع")}</p>
                <p className="font-medium">{String(profile.contactType ?? "customer")}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Adresse", "العنوان")}</p>
                <p className="font-medium">{customer.address || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Wilaya", "الولاية")}</p>
                <p className="font-medium">{String(profile.wilaya ?? "") || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Commune", "البلدية")}</p>
                <p className="font-medium">{String(profile.commune ?? "") || "—"}</p>
              </div>
            </div>
          </div>

          <Separator />
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("Classification & Tarif", "التصنيف والسعر")}</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Classification", "التصنيف")}</p>
                <ClassifBadge c={(profile.classification as CustomerClassification | null)} />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Grille tarifaire", "شبكة الأسعار")}</p>
                <TierBadge pt={(profile.priceTier as PriceTier | null)} lang={lang} />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("N° Compte", "رقم الحساب")}</p>
                <p className="font-mono text-sm">{String(profile.accountNumber ?? "") || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5">{t("Plafond crédit", "سقف الائتمان")}</p>
                <p className="font-medium">{profile.creditLimit != null ? `${Number(profile.creditLimit).toFixed(2)} ${currency}` : "—"}</p>
              </div>
            </div>
          </div>

          {/* ── Informations de connexion ── */}
          <Separator />
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              {t("Informations de connexion", "معلومات الولوج")}
            </p>
            {!customer.email ? (
              <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground text-center">
                {t("Aucun compte web associé", "لا يوجد حساب متجر إلكتروني")}
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/20 divide-y text-sm">
                {/* Email */}
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  <p className="text-[11px] text-muted-foreground shrink-0 w-28">{t("Email de connexion", "بريد الولوج")}</p>
                  <p className="font-medium break-all text-right">{customer.email}</p>
                </div>
                {/* Nom d'utilisateur */}
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  <p className="text-[11px] text-muted-foreground shrink-0 w-28">{t("Nom d'utilisateur", "اسم المستخدم")}</p>
                  <p className="font-medium text-right">{customer.name || "—"}</p>
                </div>
                {/* Reset password */}
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  <p className="text-[11px] text-muted-foreground shrink-0 w-28">{t("Mot de passe", "كلمة المرور")}</p>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-xs gap-1.5 ml-auto"
                    onClick={() => { setResetPwdValue(""); setResetPwdError(null); setResetPwdSuccess(false); setResetPwdOpen(true); }}
                  >
                    <KeyRound className="h-3 w-3" />
                    {t("Réinitialiser", "إعادة تعيين")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {customer.notes && customer.notes.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("Notes", "الملاحظات")}</p>
                {customer.notes.slice(0, 5).map((n, i) => (
                  <div key={i} className="bg-muted/40 rounded-md px-3 py-2 text-sm">{n.note}</div>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── BALANCE ── */}
        <TabsContent value="balance" className="flex-1 overflow-y-auto p-6 mt-0 space-y-4">
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-2">
            <div className={`col-span-2 rounded-lg border p-3 flex items-center justify-between ${currentBalance > 0 ? "bg-red-50 border-red-200" : currentBalance < 0 ? "bg-green-50 border-green-200" : "bg-muted/40 border-border"}`}>
              <div>
                <p className="text-[11px] text-muted-foreground font-medium">{t("Solde actuel", "الرصيد الحالي")}</p>
                <p className={`text-xl font-bold mt-0.5 ${currentBalance > 0 ? "text-red-600" : currentBalance < 0 ? "text-green-700" : "text-foreground"}`}>
                  {currentBalance > 0 ? "+" : ""}{currentBalance.toFixed(2)} {currency}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {currentBalance > 0 ? t("Client débiteur", "العميل مدين") : currentBalance < 0 ? t("Crédit en faveur du client", "رصيد لصالح العميل") : t("Compte soldé", "الحساب مسوّى")}
                </p>
              </div>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${currentBalance > 0 ? "bg-red-100" : currentBalance < 0 ? "bg-green-100" : "bg-muted"}`}>
                <CreditCard className={`h-5 w-5 ${currentBalance > 0 ? "text-red-600" : currentBalance < 0 ? "text-green-700" : "text-muted-foreground"}`} />
              </div>
            </div>
            <div className="rounded-lg border bg-green-50 border-green-200 p-3">
              <p className="text-[11px] text-muted-foreground">{t("Versements", "الدفعات")}</p>
              <p className="text-base font-bold text-green-700 mt-0.5">−{totalVersements.toFixed(2)} {currency}</p>
            </div>
            <div className="rounded-lg border bg-red-50 border-red-200 p-3">
              <p className="text-[11px] text-muted-foreground">{t("Remboursements", "الاستردادات")}</p>
              <p className="text-base font-bold text-red-600 mt-0.5">+{totalRemboursements.toFixed(2)} {currency}</p>
            </div>
            {totalVentesATerme > 0 && (
              <div className="col-span-2 rounded-lg border bg-amber-50 border-amber-200 p-3">
                <p className="text-[11px] text-muted-foreground">{t("Ventes à terme (POS)", "مبيعات آجلة (POS)")}</p>
                <p className="text-base font-bold text-amber-700 mt-0.5">+{totalVentesATerme.toFixed(2)} {currency}</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              size="sm" variant="outline"
              className="flex-1 h-9 text-xs border-green-300 text-green-700 hover:bg-green-50"
              onClick={() => { setQuickOp({ type: "versement" }); setQuickForm({ amount: "", date: new Date().toISOString().slice(0, 10), reference: "", note: "" }); setQuickError(null); }}
            >
              <ArrowDownCircle className="h-3.5 w-3.5 mr-1.5" />{t("Ajouter Versement", "إضافة دفعة")}
            </Button>
            <Button
              size="sm" variant="outline"
              className="flex-1 h-9 text-xs border-red-300 text-red-600 hover:bg-red-50"
              onClick={() => { setQuickOp({ type: "remboursement" }); setQuickForm({ amount: "", date: new Date().toISOString().slice(0, 10), reference: "", note: "" }); setQuickError(null); }}
            >
              <ArrowUpCircle className="h-3.5 w-3.5 mr-1.5" />{t("Ajouter Remboursement", "إضافة استرداد")}
            </Button>
          </div>

          <Separator />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("Historique des mouvements", "سجل الحركات المالية")}</p>

          {ops.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("Aucun mouvement", "لا توجد حركات")}</p>
          ) : (
            <div className="space-y-0">
              {/* Running balance header */}
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-1 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b">
                <span>{t("Opération", "العملية")}</span>
                <span className="text-right">{t("Montant", "المبلغ")}</span>
                <span className="text-right w-20">{t("Solde", "الرصيد")}</span>
              </div>
              {(() => {
                let running = 0;
                return ops.map((op) => {
                  const delta = (op.type === "versement" || op.type === "avoir_retour") ? -Number(op.amount) : Number(op.amount);
                  running += delta;
                  const { label, cls } = opTypeLabel(op.type);
                  const sign = (op.type === "versement" || op.type === "avoir_retour") ? "−" : "+";
                  return (
                    <div key={op.id} className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-start py-2.5 border-b border-muted last:border-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-semibold border rounded px-1.5 py-0.5 shrink-0 ${cls}`}>{label}</span>
                          {op.reference && <span className="text-[11px] text-muted-foreground font-mono truncate">{op.reference}</span>}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDt(op.createdAt)}</p>
                        {op.note && <p className="text-[11px] text-muted-foreground italic mt-0.5">{op.note}</p>}
                      </div>
                      <p className={`text-sm font-bold shrink-0 text-right ${(op.type === "versement" || op.type === "avoir_retour") ? "text-green-700" : op.type === "remboursement" ? "text-red-600" : "text-amber-700"}`}>
                        {sign}{Number(op.amount).toFixed(2)}
                      </p>
                      <p className={`text-sm font-bold shrink-0 text-right w-20 ${running > 0 ? "text-red-600" : running < 0 ? "text-green-700" : "text-muted-foreground"}`}>
                        {running > 0 ? "+" : ""}{running.toFixed(2)}
                      </p>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </TabsContent>

        {/* ── VENTES ── */}
        <TabsContent value="ventes" className="flex-1 overflow-y-auto p-6 mt-0 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t("Factures de vente", "فواتير البيع")} ({ventes.length})
          </p>
          {ventes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("Aucune vente", "لا توجد مبيعات")}</p>
          ) : (
            <div className="space-y-1">
              {ventes.map((o) => (
                <div key={o.id} className="flex items-center justify-between py-2.5 border-b border-muted last:border-0 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">#{o.id}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {fmtDt(o.createdAt)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-primary">{Number(o.totalAmount).toFixed(2)} {currency}</p>
                    <span className={`text-[10px] border rounded px-1.5 py-0.5 font-medium ${
                      (o.status as string) === "delivered" ? "bg-green-50 border-green-200 text-green-700" :
                      (o.status as string) === "shipped"   ? "bg-blue-50 border-blue-200 text-blue-700" :
                      (o.status as string) === "confirmed" ? "bg-indigo-50 border-indigo-200 text-indigo-700" :
                      (o.status as string) === "cancelled" ? "bg-red-50 border-red-200 text-red-600" :
                      "bg-amber-50 border-amber-200 text-amber-700"
                    }`}>{statusLabel(o.status as string)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── RETOURS ── */}
        <TabsContent value="retours" className="flex-1 overflow-y-auto p-6 mt-0 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t("Retours", "المرتجعات")} ({retours.length})
          </p>
          {retours.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("Aucun retour", "لا توجد مرتجعات")}</p>
          ) : (
            <div className="space-y-1">
              {retours.map((o) => (
                <div key={o.id} className="flex items-center justify-between py-2.5 border-b border-muted last:border-0 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">#{o.id}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {fmtDt(o.createdAt)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-red-600">{Number(o.totalAmount).toFixed(2)} {currency}</p>
                    <span className="text-[10px] border rounded px-1.5 py-0.5 font-medium bg-red-50 border-red-200 text-red-600">
                      {t("Retourné", "مرتجع")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Quick Versement / Remboursement dialog */}
      <Dialog open={!!quickOp} onOpenChange={(v) => { if (!v) { setQuickOp(null); setQuickError(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              {quickOp?.type === "versement"
                ? <><ArrowDownCircle className="h-4 w-4 text-green-700" />{t("Ajouter un versement", "إضافة دفعة")}</>
                : <><ArrowUpCircle className="h-4 w-4 text-red-600" />{t("Ajouter un remboursement", "إضافة استرداد")}</>
              }
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label className="text-xs">{t("Montant *", "المبلغ *")} ({currency})</Label>
              <Input
                type="number" step="0.01" min="0.01"
                value={quickForm.amount}
                onChange={(e) => setQuickForm((f) => ({ ...f, amount: e.target.value }))}
                className="h-8 text-sm mt-1" placeholder="0.00" autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">{t("Date *", "التاريخ *")}</Label>
              <Input
                type="date"
                value={quickForm.date}
                onChange={(e) => setQuickForm((f) => ({ ...f, date: e.target.value }))}
                className="h-8 text-sm mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">{t("Référence", "المرجع")} ({t("optionnel", "اختياري")})</Label>
              <Input
                value={quickForm.reference}
                onChange={(e) => setQuickForm((f) => ({ ...f, reference: e.target.value }))}
                className="h-8 text-sm mt-1"
                placeholder={t("Ex: Reçu N°...", "مثال: وصل رقم...")}
              />
            </div>
            <div>
              <Label className="text-xs">{t("Note", "ملاحظة")} ({t("optionnel", "اختياري")})</Label>
              <Input
                value={quickForm.note}
                onChange={(e) => setQuickForm((f) => ({ ...f, note: e.target.value }))}
                className="h-8 text-sm mt-1"
                placeholder={t("Remarque...", "ملاحظة...")}
              />
            </div>
            {quickError && <p className="text-xs text-destructive">{quickError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setQuickOp(null); setQuickError(null); }}>
              {t("Annuler", "إلغاء")}
            </Button>
            <Button
              size="sm"
              className={`h-8 text-xs ${quickOp?.type === "versement" ? "bg-green-700 hover:bg-green-800" : "bg-red-600 hover:bg-red-700"}`}
              onClick={handleQuickOp}
              disabled={createOp.isPending}
            >
              {createOp.isPending ? "..." : t("Enregistrer", "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={resetPwdOpen} onOpenChange={(v) => { if (!v) { setResetPwdOpen(false); setResetPwdError(null); setResetPwdSuccess(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <KeyRound className="h-4 w-4 text-primary" />
              {t("Réinitialiser le mot de passe", "إعادة تعيين كلمة المرور")}
            </DialogTitle>
          </DialogHeader>
          {resetPwdSuccess ? (
            <div className="py-4 text-center space-y-2">
              <p className="text-sm font-medium text-green-700">✓ {t("Mot de passe mis à jour avec succès", "تم تحديث كلمة المرور بنجاح")}</p>
              <p className="text-xs text-muted-foreground">{t("Le client peut maintenant se connecter avec le nouveau mot de passe.", "يمكن للعميل الولوج بكلمة المرور الجديدة.")}</p>
            </div>
          ) : (
            <div className="space-y-3 py-1">
              <p className="text-xs text-muted-foreground">
                {t(`Nouveau mot de passe pour : ${customer?.email}`, `كلمة مرور جديدة لـ: ${customer?.email}`)}
              </p>
              <div>
                <Label className="text-xs">{t("Nouveau mot de passe *", "كلمة المرور الجديدة *")} ({t("min. 6 caractères", "6 أحرف على الأقل")})</Label>
                <Input
                  type="password"
                  value={resetPwdValue}
                  onChange={(e) => { setResetPwdValue(e.target.value); setResetPwdError(null); }}
                  className="h-8 text-sm mt-1"
                  placeholder="••••••••"
                  autoFocus
                />
              </div>
              {resetPwdError && <p className="text-xs text-destructive">{resetPwdError}</p>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setResetPwdOpen(false); setResetPwdError(null); setResetPwdSuccess(false); }}>
              {resetPwdSuccess ? t("Fermer", "إغلاق") : t("Annuler", "إلغاء")}
            </Button>
            {!resetPwdSuccess && (
              <Button
                size="sm"
                className="h-8 text-xs bg-[#1B3057] hover:bg-[#152544]"
                disabled={updateCustomerPwd.isPending}
                onClick={() => {
                  if (resetPwdValue.length < 6) { setResetPwdError(t("Minimum 6 caractères", "6 أحرف على الأقل")); return; }
                  updateCustomerPwd.mutate(
                    { id: customerId, data: { password: resetPwdValue } as Parameters<typeof updateCustomerPwd.mutate>[0]["data"] },
                    {
                      onSuccess: () => { setResetPwdSuccess(true); setResetPwdValue(""); },
                      onError: () => setResetPwdError(t("Erreur lors de la mise à jour", "خطأ في التحديث")),
                    }
                  );
                }}
              >
                {updateCustomerPwd.isPending ? "..." : t("Enregistrer", "حفظ")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Customer Operations Sheet ────────────────────────────────────
function CustomerOperationsSheet({ customerId, customerName, onClose, t, lang, currency }: {
  customerId: number; customerName: string; onClose: () => void;
  t: TFn; lang: string; currency: string;
}) {
  const qc = useQueryClient();
  const [filterType, setFilterType] = useState<"all" | "versement" | "remboursement" | "vente_a_terme">("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ type: "versement", amount: "", date: new Date().toISOString().slice(0, 10), reference: "", note: "" });
  const [newError, setNewError] = useState<string | null>(null);
  const [editOp, setEditOp] = useState<CustomerOperation | null>(null);
  const [editForm, setEditForm] = useState({ type: "versement", amount: "", date: new Date().toISOString().slice(0, 10), reference: "", note: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteOp, setDeleteOp] = useState<CustomerOperation | null>(null);

  const params = {
    ...(filterType !== "all" ? { type: filterType as "versement" | "remboursement" | "vente_a_terme" } : {}),
    ...(filterFrom ? { from: filterFrom } : {}),
    ...(filterTo ? { to: filterTo } : {}),
  };

  const { data: ops = [], isLoading } = useGetCustomerOperations(customerId, params, {
    query: { queryKey: getGetCustomerOperationsQueryKey(customerId, params) },
  });
  const createOp = useCreateCustomerOperation();
  const updateOp = useUpdateCustomerOperation();
  const deleteOpMut = useDeleteCustomerOperation();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetCustomerOperationsQueryKey(customerId) });
    qc.invalidateQueries({ queryKey: getGetErpCustomerQueryKey(customerId) });
    qc.invalidateQueries({ queryKey: getGetErpCustomersQueryKey() });
  };

  const handleCreate = () => {
    setNewError(null);
    if (!newForm.amount || isNaN(Number(newForm.amount)) || Number(newForm.amount) <= 0) {
      setNewError(t("Montant invalide", "مبلغ غير صالح"));
      return;
    }
    createOp.mutate({
      id: customerId,
      data: {
        type: newForm.type as "versement" | "remboursement",
        amount: Number(newForm.amount),
        date: newForm.date,
        reference: newForm.reference || null,
        note: newForm.note || null,
      },
    }, {
      onSuccess: () => {
        invalidateAll();
        setNewOpen(false);
        setNewForm({ type: "versement", amount: "", date: new Date().toISOString().slice(0, 10), reference: "", note: "" });
      },
      onError: (err: any) => setNewError(err?.response?.data?.error ?? t("Erreur lors de la création", "خطأ في الإنشاء")),
    });
  };

  const openEdit = (op: CustomerOperation) => {
    setEditOp(op);
    setEditForm({ type: op.type, amount: String(Number(op.amount)), date: op.date ?? "", reference: op.reference ?? "", note: op.note ?? "" });
    setEditError(null);
  };

  const handleEdit = () => {
    if (!editOp) return;
    setEditError(null);
    if (!editForm.amount || isNaN(Number(editForm.amount)) || Number(editForm.amount) <= 0) {
      setEditError(t("Montant invalide", "مبلغ غير صالح"));
      return;
    }
    updateOp.mutate({
      id: customerId,
      opId: editOp.id,
      data: {
        type: editForm.type as "versement" | "remboursement",
        amount: Number(editForm.amount),
        date: editForm.date,
        reference: editForm.reference || null,
        note: editForm.note || null,
      },
    }, {
      onSuccess: () => { invalidateAll(); setEditOp(null); },
      onError: (err: any) => setEditError(err?.response?.data?.error ?? t("Erreur lors de la modification", "خطأ في التعديل")),
    });
  };

  const handleDelete = () => {
    if (!deleteOp) return;
    deleteOpMut.mutate({ id: customerId, opId: deleteOp.id }, {
      onSuccess: () => { invalidateAll(); setDeleteOp(null); },
    });
  };

  const totalVersements = ops.filter((o) => o.type === "versement").reduce((s, o) => s + Number(o.amount), 0);
  const totalRemboursements = ops.filter((o) => o.type === "remboursement").reduce((s, o) => s + Number(o.amount), 0);

  const opsWithBalance = (ops as CustomerOperation[]).reduce<{ op: CustomerOperation; runningBalance: number }[]>((acc, op) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].runningBalance : 0;
    // versement & avoir_retour reduce balance (customer paid us / credited), remboursement & vente_a_terme increase it
    const delta = (op.type === "versement" || op.type === "avoir_retour") ? -Number(op.amount) : Number(op.amount);
    acc.push({ op, runningBalance: prev + delta });
    return acc;
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={onClose}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base truncate">{customerName}</p>
            <p className="text-xs text-muted-foreground">{t("Opérations client", "عمليات الزبون")}</p>
          </div>
          <Button size="sm" className="h-7 gap-1 bg-[#1B3057] hover:bg-[#152544] text-xs" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" />{t("Nouveau", "جديد")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {/* KPIs */}
        <div className="mt-3 flex gap-4">
          <div className="flex items-center gap-1.5">
            <ArrowDownCircle className="h-4 w-4 text-green-600 shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground">{t("Versements", "الدفعات")}</p>
              <p className="text-sm font-bold text-green-700">+{totalVersements.toFixed(2)} {currency}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowUpCircle className="h-4 w-4 text-red-500 shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground">{t("Remboursements", "المبالغ المستردة")}</p>
              <p className="text-sm font-bold text-red-600">-{totalRemboursements.toFixed(2)} {currency}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <CreditCard className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground">{t("Net", "الصافي")}</p>
              <p className="text-sm font-bold text-primary">{(totalVersements - totalRemboursements).toFixed(2)} {currency}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b flex gap-2 flex-wrap items-center bg-card">
        <Select value={filterType} onValueChange={(v) => setFilterType(v as "all" | "versement" | "remboursement" | "vente_a_terme")}>
          <SelectTrigger className="h-7 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">{t("Tous types", "كل الأنواع")}</SelectItem>
            <SelectItem value="versement" className="text-xs">{t("Versements", "الدفعات")}</SelectItem>
            <SelectItem value="remboursement" className="text-xs">{t("Remboursements", "المبالغ المستردة")}</SelectItem>
            <SelectItem value="vente_a_terme" className="text-xs">{t("Ventes à terme", "مبيعات آجلة")}</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
          className="h-7 w-[130px] text-xs px-2" placeholder={t("De", "من")} />
        <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
          className="h-7 w-[130px] text-xs px-2" placeholder={t("À", "إلى")} />
        {(filterFrom || filterTo || filterType !== "all") && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterType("all"); }}>
            <X className="h-3 w-3 mr-1" />{t("Effacer", "مسح")}
          </Button>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">{ops.length} {t("opération(s)", "عملية")}</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead className="text-xs">{t("Date", "التاريخ")}</TableHead>
                <TableHead className="text-xs">{t("Type", "النوع")}</TableHead>
                <TableHead className="text-xs text-right">{t("Montant", "المبلغ")}</TableHead>
                <TableHead className="text-xs text-right">{t("Solde après", "الرصيد بعد")}</TableHead>
                <TableHead className="text-xs">{t("Référence", "المرجع")}</TableHead>
                <TableHead className="text-xs">{t("Note", "ملاحظة")}</TableHead>
                <TableHead className="text-xs w-[90px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opsWithBalance.map(({ op, runningBalance }) => (
                <TableRow key={op.id}>
                  <TableCell className="text-xs">
                    {op.date ? format(new Date(op.date), "dd/MM/yyyy") : "—"}
                  </TableCell>
                  <TableCell>
                    {op.type === "versement" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                        <ArrowDownCircle className="h-3 w-3" />{t("Versement", "دفعة")}
                      </span>
                    ) : op.type === "avoir_retour" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                        <ArrowDownCircle className="h-3 w-3" />{t("Avoir / Retour", "إشعار دائن")}
                      </span>
                    ) : op.type === "vente_a_terme" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                        <ArrowUpCircle className="h-3 w-3" />{t("Vente à terme", "بيع آجل")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                        <ArrowUpCircle className="h-3 w-3" />{t("Remboursement", "استرداد")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-right font-semibold">
                    <span className={(op.type === "versement" || op.type === "avoir_retour") ? "text-green-700" : op.type === "vente_a_terme" ? "text-amber-700" : "text-red-600"}>
                      {(op.type === "versement" || op.type === "avoir_retour") ? "−" : "+"}{Number(op.amount).toFixed(2)} {currency}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-right font-semibold">
                    <span className={runningBalance > 0 ? "text-red-600" : runningBalance < 0 ? "text-green-700" : "text-muted-foreground"}>
                      {runningBalance.toFixed(2)} {currency}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{op.reference || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{op.note || "—"}</TableCell>
                  <TableCell className="p-1">
                    <div className="flex items-center gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => openEdit(op)}>
                        {t("Modifier", "تعديل")}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive hover:text-destructive" onClick={() => setDeleteOp(op)}>
                        {t("Supprimer", "حذف")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {ops.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    {t("Aucune opération", "لا توجد عمليات")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* New Operation Dialog */}
      <Dialog open={newOpen} onOpenChange={(v) => { setNewOpen(v); if (!v) { setNewError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              {t("Nouvelle opération", "عملية جديدة")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Type *", "النوع *")}</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNewForm((f) => ({ ...f, type: "versement" }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                      newForm.type === "versement"
                        ? "border-green-500 bg-green-50 text-green-700"
                        : "border-muted bg-background text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <ArrowDownCircle className="h-4 w-4" />
                    {t("Versement", "دفعة")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewForm((f) => ({ ...f, type: "remboursement" }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                      newForm.type === "remboursement"
                        ? "border-red-500 bg-red-50 text-red-600"
                        : "border-muted bg-background text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <ArrowUpCircle className="h-4 w-4" />
                    {t("Remboursement", "استرداد")}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Montant *", "المبلغ *")} ({currency})</Label>
                <Input
                  type="number" min="0.01" step="0.01"
                  value={newForm.amount}
                  onChange={(e) => setNewForm((f) => ({ ...f, amount: e.target.value }))}
                  className="h-8 text-sm"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Date *", "التاريخ *")}</Label>
                <Input
                  type="date"
                  value={newForm.date}
                  onChange={(e) => setNewForm((f) => ({ ...f, date: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Référence", "المرجع")}</Label>
                <Input
                  value={newForm.reference}
                  onChange={(e) => setNewForm((f) => ({ ...f, reference: e.target.value }))}
                  className="h-8 text-sm"
                  placeholder={t("N° chèque, virement...", "رقم الشيك أو التحويل...")}
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Note", "ملاحظة")}</Label>
                <Input
                  value={newForm.note}
                  onChange={(e) => setNewForm((f) => ({ ...f, note: e.target.value }))}
                  className="h-8 text-sm"
                  placeholder={t("Commentaire libre...", "تعليق حر...")}
                />
              </div>
            </div>
            {newError && <p className="text-xs text-destructive">{newError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNewOpen(false)}>{t("Annuler", "إلغاء")}</Button>
            <Button size="sm" className="bg-[#1B3057] hover:bg-[#152544]" onClick={handleCreate} disabled={createOp.isPending}>
              {createOp.isPending ? "..." : t("Enregistrer", "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Operation Dialog */}
      <Dialog open={!!editOp} onOpenChange={(v) => { if (!v) { setEditOp(null); setEditError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              {t("Modifier l'opération", "تعديل العملية")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Type *", "النوع *")}</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, type: "versement" }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                      editForm.type === "versement"
                        ? "border-green-500 bg-green-50 text-green-700"
                        : "border-muted bg-background text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <ArrowDownCircle className="h-4 w-4" />
                    {t("Versement", "دفعة")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, type: "remboursement" }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                      editForm.type === "remboursement"
                        ? "border-red-500 bg-red-50 text-red-600"
                        : "border-muted bg-background text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <ArrowUpCircle className="h-4 w-4" />
                    {t("Remboursement", "استرداد")}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Montant *", "المبلغ *")} ({currency})</Label>
                <Input
                  type="number" min="0.01" step="0.01"
                  value={editForm.amount}
                  onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                  className="h-8 text-sm"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Date *", "التاريخ *")}</Label>
                <Input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Référence", "المرجع")}</Label>
                <Input
                  value={editForm.reference}
                  onChange={(e) => setEditForm((f) => ({ ...f, reference: e.target.value }))}
                  className="h-8 text-sm"
                  placeholder={t("N° chèque, virement...", "رقم الشيك أو التحويل...")}
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t("Note", "ملاحظة")}</Label>
                <Input
                  value={editForm.note}
                  onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                  className="h-8 text-sm"
                  placeholder={t("Commentaire libre...", "تعليق حر...")}
                />
              </div>
            </div>
            {editError && <p className="text-xs text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOp(null)}>{t("Annuler", "إلغاء")}</Button>
            <Button size="sm" className="bg-[#1B3057] hover:bg-[#152544]" onClick={handleEdit} disabled={updateOp.isPending}>
              {updateOp.isPending ? "..." : t("Enregistrer", "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteOp} onOpenChange={(v) => { if (!v) setDeleteOp(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Supprimer l'opération", "حذف العملية")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            {t(
              `Voulez-vous supprimer cet opération de ${deleteOp ? Number(deleteOp.amount).toFixed(2) : ""} ${currency} ? Cette action annulera son effet sur le solde.`,
              `هل تريد حذف هذه العملية بمبلغ ${deleteOp ? Number(deleteOp.amount).toFixed(2) : ""} ${currency}؟ سيتم عكس تأثيرها على الرصيد.`
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteOp(null)}>{t("Annuler", "إلغاء")}</Button>
            <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleteOpMut.isPending}>
              {deleteOpMut.isPending ? "..." : t("Supprimer", "حذف")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ExtCustomer = CustomerSummary & {
  wilaya?: string | null;
  contact_type?: string | null;
  rc?: string | null;
  nif?: string | null;
  ai?: string | null;
  nis?: string | null;
  account_number?: string | null;
  credit_limit?: string | null;
  current_balance?: string | null;
  min_balance_alert?: string | null;
  foreign_currency?: boolean | null;
  classification?: CustomerClassification | null;
  priceTier?: PriceTier | null;
};

function exportXLSX(customers: ExtCustomer[], currency: string, lang: string) {
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const rows = customers.map((c) => ({
    "ID": c.id,
    [t("Nom", "الاسم")]: c.name,
    "Email": c.email,
    [t("Téléphone", "الهاتف")]: c.phone ?? "",
    [t("Wilaya", "الولاية")]: c.wilaya ?? "",
    [t("Type contact", "نوع الاتصال")]: c.contact_type ?? "",
    [t("Classification", "التصنيف")]: c.classification
      ? (lang === "ar" ? c.classification.labelAr : c.classification.labelFr)
      : "",
    [t("Grille de prix", "شريحة السعر")]: c.priceTier
      ? (lang === "ar" ? c.priceTier.labelAr : c.priceTier.labelFr)
      : "",
    [t("N° Compte", "رقم الحساب")]: c.account_number ?? "",
    [`${t("Solde", "الرصيد")} (${currency})`]: c.current_balance != null ? Number(c.current_balance) : "",
    [`${t("Crédit max", "الائتمان")} (${currency})`]: c.credit_limit != null ? Number(c.credit_limit) : "",
    [`${t("Alerte min.", "تنبيه")} (${currency})`]: c.min_balance_alert != null ? Number(c.min_balance_alert) : "",
    [t("Devise étrangère", "عملة أجنبية")]: c.foreign_currency ? t("Oui", "نعم") : t("Non", "لا"),
    "RC": c.rc ?? "",
    "NIF": c.nif ?? "",
    "AI": c.ai ?? "",
    "NIS": c.nis ?? "",
    [t("Commandes", "طلبات")]: Number(c.total_orders ?? 0),
    [`${t("Total dépensé", "الإجمالي المدفوع")} (${currency})`]: Number(c.total_spent ?? 0),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t("Clients", "العملاء"));
  XLSX.writeFile(wb, `clients-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export default function Customers() {
  const qc = useQueryClient();
  const { isAdmin } = useMe();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const { data: classifs = [] } = useGetErpCustomerClassifications();
  const { data: tiers = [] } = useGetErpPriceTiers();

  const [detailId, setDetailId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedTab, setSelectedTab] = useState("basic");
  const [selectedEditing, setSelectedEditing] = useState(false);
  const openSheet = (id: number, tab = "basic", editing = false) => {
    setOpsCustomer(null);
    setDetailId(null);
    setSelectedTab(tab);
    setSelectedEditing(editing);
    setSelectedId(id);
  };
  const openDetail = (id: number) => {
    setOpsCustomer(null);
    setSelectedId(null);
    setDetailId(id);
  };
  const [opsCustomer, setOpsCustomer] = useState<{ id: number; name: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createCustomer = useCreateErpCustomer();
  const [createForm, setCreateForm] = useState({
    name: "", email: "", password: "", phone: "", address: "",
    commune: "", gps: "", notes: "", contactType: "customer",
    wilaya: "", classificationId: "", priceTierId: "",
    accountNumber: "", rc: "", nif: "", ai: "", nis: "",
    creditLimit: "", minBalanceAlert: "", currentBalance: "0", foreignCurrency: false,
  });

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterClassif, setFilterClassif] = useState<string>("all");
  const [filterTier, setFilterTier] = useState<string>("all");
  const [filterWilaya, setFilterWilaya] = useState<string>("all");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const queryParams = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(filterClassif !== "all" && filterClassif !== "none" ? { classificationId: parseInt(filterClassif) } : {}),
    ...(filterWilaya !== "all" ? { wilaya: filterWilaya } : {}),
    ...(filterTier !== "all" && filterTier !== "none" ? { priceTierId: parseInt(filterTier) } : {}),
  };

  const { data: customers, isLoading } = useGetErpCustomers(queryParams, {
    query: { queryKey: getGetErpCustomersQueryKey(queryParams) },
  });

  const filtered = (customers ?? []) as ExtCustomer[];
  const displayedCustomers = filterClassif === "none"
    ? filtered.filter((c) => c.classification == null)
    : filterTier === "none"
      ? filtered.filter((c) => c.priceTier == null)
      : filtered;

  const handleCreate = () => {
    setCreateError(null);
    if (!createForm.name.trim() || !createForm.email.trim()) {
      setCreateError(t("Le nom et l'email sont obligatoires", "الاسم والبريد مطلوبان"));
      return;
    }
    createCustomer.mutate(
      {
        data: {
          name: createForm.name.trim(),
          email: createForm.email.trim(),
          password: createForm.password || undefined,
          phone: createForm.phone.trim() || undefined,
          address: createForm.address.trim() || undefined,
          notes: createForm.notes.trim() || undefined,
          contactType: (createForm.contactType as "customer" | "customer_supplier") || "customer",
          wilaya: createForm.wilaya || null,
          commune: createForm.commune.trim() || null,
          gps: createForm.gps.trim() || null,
          classificationId: createForm.classificationId ? parseInt(createForm.classificationId) : null,
          priceTierId: createForm.priceTierId ? parseInt(createForm.priceTierId) : null,
          accountNumber: createForm.accountNumber.trim() || null,
          rc: createForm.rc.trim() || null,
          nif: createForm.nif.trim() || null,
          ai: createForm.ai.trim() || null,
          nis: createForm.nis.trim() || null,
          creditLimit: createForm.creditLimit ? Number(createForm.creditLimit) : null,
          minBalanceAlert: createForm.minBalanceAlert ? Number(createForm.minBalanceAlert) : null,
          currentBalance: createForm.currentBalance ? Number(createForm.currentBalance) : 0,
          foreignCurrency: createForm.foreignCurrency,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetErpCustomersQueryKey() });
          setCreateOpen(false);
          setCreateForm({ name: "", email: "", password: "", phone: "", address: "", commune: "", gps: "", notes: "", contactType: "customer", wilaya: "", classificationId: "", priceTierId: "", accountNumber: "", rc: "", nif: "", ai: "", nis: "", creditLimit: "", minBalanceAlert: "", currentBalance: "0", foreignCurrency: false });
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? t("Erreur lors de la création", "خطأ في الإنشاء");
          setCreateError(msg);
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("Clients", "العملاء")}</h1>
          <p className="text-sm text-muted-foreground">{t("Gestion de la relation client", "إدارة علاقات العملاء")}</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => exportXLSX(displayedCustomers, currency, lang)}>
              <Download className="h-4 w-4" />
              {t("Exporter Excel", "تصدير Excel")}
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)} data-testid="button-new-customer" className="bg-[#1B3057] hover:bg-[#1B3057]/90">
            <UserPlus className="h-4 w-4 mr-2" />
            {t("Nouveau client", "عميل جديد")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" placeholder={t("Rechercher nom, email, tél...", "بحث...")} />
        </div>
        <Select value={filterWilaya} onValueChange={setFilterWilaya}>
          <SelectTrigger className="h-8 w-[150px] text-xs gap-1">
            <MapPin className="h-3 w-3 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[260px] overflow-y-auto">
            <SelectItem value="all">{t("Toutes wilayas", "كل الولايات")}</SelectItem>
            {WILAYAS.map((w) => (
              <SelectItem key={w.code} value={w.nameFr}>{w.code} — {lang === "ar" ? w.nameAr : w.nameFr}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterClassif} onValueChange={setFilterClassif}>
          <SelectTrigger className="h-8 w-[150px] text-xs gap-1">
            <Tag className="h-3 w-3 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Toutes classif.", "كل التصنيفات")}</SelectItem>
            <SelectItem value="none">{t("Sans classif.", "بدون تصنيف")}</SelectItem>
            {(classifs as CustomerClassification[]).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{lang === "ar" ? c.labelAr : c.labelFr}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterTier} onValueChange={setFilterTier}>
          <SelectTrigger className="h-8 w-[150px] text-xs gap-1">
            <Layers className="h-3 w-3 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Toutes grilles", "كل الشرائح")}</SelectItem>
            <SelectItem value="none">{t("Sans grille", "بدون شريحة")}</SelectItem>
            {(tiers as PriceTier[]).map((tier) => (
              <SelectItem key={tier.id} value={String(tier.id)}>{lang === "ar" ? tier.labelAr : tier.labelFr}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{displayedCustomers.length} {t("client(s)", "عميل")}</span>
      </div>

      {/* Table */}
      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{t("Nom", "الاسم")}</TableHead>
                    <TableHead className="text-xs">{t("Contact", "التواصل")}</TableHead>
                    <TableHead className="text-xs">{t("Wilaya", "الولاية")}</TableHead>
                    <TableHead className="text-xs">{t("Classification", "التصنيف")}</TableHead>
                    <TableHead className="text-xs">{t("Grille", "الشريحة")}</TableHead>
                    <TableHead className="text-xs">{t("Cmd.", "طلبات")}</TableHead>
                    {isAdmin && <TableHead className="text-xs">{t("Solde", "الرصيد")}</TableHead>}
                    <TableHead className="text-xs w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedCustomers.map((c) => (
                    <TableRow
                      key={c.id}
                      data-testid={`row-customer-${c.id}`}
                      className={isAdmin ? "cursor-pointer hover:bg-muted/40" : ""}
                      onClick={() => isAdmin && openSheet(c.id)}
                    >
                      <TableCell className="font-medium text-sm">{c.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div>{c.email}</div>
                        {c.phone && <div className="text-xs">{c.phone}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{c.wilaya || "—"}</TableCell>
                      <TableCell><ClassifBadge c={c.classification} /></TableCell>
                      <TableCell><TierBadge pt={c.priceTier} lang={lang} /></TableCell>
                      <TableCell className="text-sm">{Number(c.total_orders ?? 0)}</TableCell>
                      {isAdmin && (() => {
                        const bal = Number(c.current_balance ?? 0);
                        const color = bal > 0 ? "text-red-600" : bal < 0 ? "text-green-600" : "text-muted-foreground";
                        return (
                          <TableCell className={`font-semibold text-sm ${color}`}>
                            {bal.toFixed(2)} {currency}
                          </TableCell>
                        );
                      })()}
                      <TableCell>
                        {isAdmin ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm" variant="ghost" className="h-7 w-7 p-0"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`btn-menu-${c.id}`}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDetail(c.id); }}>
                                  <Eye className="h-4 w-4 mr-2" />{t("Détail", "التفاصيل")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openSheet(c.id, "basic", true); }}>
                                  <Pencil className="h-4 w-4 mr-2" />{t("Modifier", "تعديل")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openSheet(c.id, "financial"); }}>
                                  <ShoppingBag className="h-4 w-4 mr-2" />{t("Historique", "السجل")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openSheet(c.id, "financial"); }}>
                                  <BarChart2 className="h-4 w-4 mr-2" />{t("Situation", "الوضع المالي")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedId(null); setOpsCustomer({ id: c.id, name: c.name }); }}>
                                  <CreditCard className="h-4 w-4 mr-2" />{t("Opérations", "العمليات")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openSheet(c.id, "notes"); }}>
                                  <StickyNote className="h-4 w-4 mr-2" />{t("Notes", "الملاحظات")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {displayedCustomers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-8 text-muted-foreground">
                        {t("Aucun client trouvé", "لا يوجد عملاء")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CustomerDetailSheet — view-only with tabs DÉTAIL/BALANCE/VENTES/RETOURS */}
      <Sheet open={!!detailId} onOpenChange={(v) => !v && setDetailId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("Détail client", "تفاصيل العميل")}</SheetTitle>
          </SheetHeader>
          {detailId && (
            <CustomerDetailSheet
              customerId={detailId}
              onClose={() => setDetailId(null)}
              t={t} lang={lang} currency={currency}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* CustomerSheet — Modifier (edit form: ESSENTIEL/FINANCE/LEGAL) */}
      <Sheet open={!!selectedId} onOpenChange={(v) => !v && setSelectedId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("Modifier le client", "تعديل العميل")}</SheetTitle>
          </SheetHeader>
          {selectedId && (
            <CustomerSheet
              customerId={selectedId}
              onClose={() => setSelectedId(null)}
              t={t} lang={lang} currency={currency}
              initialTab={selectedTab}
              initialEditing={selectedEditing}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Customer operations sheet */}
      <Sheet open={!!opsCustomer} onOpenChange={(v) => !v && setOpsCustomer(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("Opérations client", "عمليات الزبون")}</SheetTitle>
          </SheetHeader>
          {opsCustomer && (
            <CustomerOperationsSheet
              customerId={opsCustomer.id}
              customerName={opsCustomer.name}
              onClose={() => setOpsCustomer(null)}
              t={t} lang={lang} currency={currency}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create customer dialog — shared 4-tab contact form */}
      <ContactFormDialog
        open={createOpen}
        onOpenChange={(v) => { setCreateOpen(v); if (!v) setCreateError(null); }}
        form={createForm}
        setForm={setCreateForm}
        onSave={handleCreate}
        saving={createCustomer.isPending}
        error={createError}
        title={<><UserPlus className="h-4 w-4" />{t("Nouveau client", "عميل جديد")}</>}
        classifs={classifs as CustomerClassification[]}
        tiers={tiers as PriceTier[]}
        currency={currency}
        lang={lang}
        t={t}
        contactTypeOptions={[
          { value: "customer", label: t("Client", "عميل") },
          { value: "customer_supplier", label: t("Client / Fournisseur", "عميل / مورد") },
        ]}
      />
    </div>
  );
}

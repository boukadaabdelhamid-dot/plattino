import React, { useState } from "react";
import {
  useGetErpStaff, useCreateErpStaff, useDeleteErpStaff, useSetErpStaffStores,
  useResetErpStaffPassword,
  useGetErpStores,
  getGetErpStaffQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, UserPlus, Trash2, Crown, User, Key, Eye, EyeOff } from "lucide-react";

export default function Staff() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const { data: staff, isLoading } = useGetErpStaff();
  const { data: stores } = useGetErpStores();
  const create = useCreateErpStaff();
  const del = useDeleteErpStaff();
  const setStores = useSetErpStaffStores();
  const resetPassword = useResetErpStaffPassword();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "employee" as "employee" | "admin", phone: "", storeIds: [] as number[] });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<"admin" | "employee">("employee");
  const [editStoreIds, setEditStoreIds] = useState<number[]>([]);
  const [pwdTarget, setPwdTarget] = useState<{ id: number; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  const allStores = stores ?? [];
  const toggleStore = (id: number, current: number[], set: (v: number[]) => void) => {
    set(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };

  const handleCreate = () => {
    setError(null);
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setError(t("Nom, email et mot de passe sont requis", "الاسم والبريد وكلمة المرور مطلوبة"));
      return;
    }
    if (form.password.length < 6) {
      setError(t("Mot de passe min. 6 caractères", "كلمة المرور 6 أحرف على الأقل"));
      return;
    }
    if (form.storeIds.length === 0) {
      setError(t("Sélectionnez au moins un magasin", "اختر متجراً واحداً على الأقل"));
      return;
    }
    create.mutate(
      { data: { name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role, storeIds: form.storeIds, phone: form.phone.trim() || undefined } },
      {
        onSuccess: () => { qc.invalidateQueries({ queryKey: getGetErpStaffQueryKey() }); setOpen(false); setForm({ name: "", email: "", password: "", role: "employee", phone: "", storeIds: [] }); },
        onError: (err: unknown) => { setError((err as { message?: string })?.message ?? t("Échec de la création", "فشل الإنشاء")); },
      }
    );
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(t(`Supprimer ${name} ?`, `حذف ${name} ؟`))) return;
    del.mutate({ id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetErpStaffQueryKey() }) });
  };

  const closePwdDialog = () => { setPwdTarget(null); setNewPassword(""); setShowNewPassword(false); setPwdError(null); };

  const handleResetPassword = () => {
    if (!pwdTarget) return;
    setPwdError(null);
    if (newPassword.length < 6) {
      setPwdError(t("Mot de passe min. 6 caractères", "كلمة المرور 6 أحرف على الأقل"));
      return;
    }
    resetPassword.mutate(
      { id: pwdTarget.id, data: { password: newPassword } },
      {
        onSuccess: () => {
          toast({ title: t("Mot de passe réinitialisé", "تمت إعادة تعيين كلمة المرور"), description: pwdTarget.name });
          closePwdDialog();
        },
        onError: (err: unknown) => {
          setPwdError((err as { message?: string })?.message ?? t("Échec de la réinitialisation", "فشل إعادة التعيين"));
        },
      }
    );
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            {t("Accès & Personnel", "الصلاحيات والموظفون")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("Gérer les comptes administrateurs et employés", "إدارة حسابات المسؤولين والموظفين")}
          </p>
        </div>
        <Button onClick={() => { setError(null); setOpen(true); }} data-testid="button-new-staff">
          <UserPlus className="h-4 w-4 mr-2" />
          {t("Nouveau", "جديد")}
        </Button>
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-3 text-sm text-amber-900">
          <p className="font-semibold mb-1">{t("À propos des rôles", "عن الصلاحيات")}</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            <li><strong>Admin</strong> — {t("accès complet (achats, fournisseurs, comptabilité, totaux clients).", "وصول كامل (المشتريات، الموردون، المحاسبة، إجماليات العملاء).")}</li>
            <li><strong>{t("Employé", "موظف")}</strong> — {t("caisse, ventes, stock et clients (sans données financières sensibles).", "الصندوق، المبيعات، المخزون والعملاء (بدون البيانات المالية الحساسة).")}</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Rôle", "الدور")}</TableHead>
                    <TableHead>{t("Nom", "الاسم")}</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>{t("Téléphone", "الهاتف")}</TableHead>
                    <TableHead>{t("Magasins", "المتاجر")}</TableHead>
                    <TableHead className="text-right">{t("Actions", "الإجراءات")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(staff ?? []).map((s) => (
                    <TableRow key={s.id} data-testid={`row-staff-${s.id}`}>
                      <TableCell>
                        {s.role === "admin" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                            <Crown className="h-3 w-3" /> Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
                            <User className="h-3 w-3" /> {t("Employé", "موظف")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.email}</TableCell>
                      <TableCell className="text-sm">{s.phone || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {((s as { stores?: Array<{ id: number; nameEn: string }> }).stores ?? []).map((st) => (
                          <span key={st.id} className="inline-block mr-1 mb-0.5 px-1.5 py-0.5 rounded bg-muted">{st.nameEn}</span>
                        ))}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          title={t("Magasins accessibles", "المتاجر المتاحة")}
                          onClick={() => {
                            setEditId(s.id);
                            setEditRole(s.role === "admin" ? "admin" : "employee");
                            setEditStoreIds(((s as { stores?: Array<{ id: number }> }).stores ?? []).map((x) => x.id));
                          }}
                          data-testid={`btn-edit-stores-${s.id}`}>
                          <Shield className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          title={t("Réinitialiser le mot de passe", "إعادة تعيين كلمة المرور")}
                          onClick={() => { setPwdTarget({ id: s.id, name: s.name }); setNewPassword(""); setShowNewPassword(false); setPwdError(null); }}
                          data-testid={`btn-reset-password-${s.id}`}>
                          <Key className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDelete(s.id, s.name)}
                          data-testid={`btn-delete-staff-${s.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!staff || staff.length === 0) && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("Aucun compte", "لا توجد حسابات")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("Nouveau membre", "عضو جديد")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("Rôle *", "الصلاحية *")}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button type="button" onClick={() => setForm({ ...form, role: "employee" })}
                  className={`px-3 py-2 rounded-md border text-sm font-medium transition ${form.role === "employee" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                  data-testid="role-employee">
                  <User className="h-4 w-4 inline mr-1" /> {t("Employé", "موظف")}
                </button>
                <button type="button" onClick={() => setForm({ ...form, role: "admin" })}
                  className={`px-3 py-2 rounded-md border text-sm font-medium transition ${form.role === "admin" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                  data-testid="role-admin">
                  <Crown className="h-4 w-4 inline mr-1" /> Admin
                </button>
              </div>
            </div>
            <div>
              <Label htmlFor="staff-name">{t("Nom *", "الاسم *")}</Label>
              <Input id="staff-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-staff-name" autoFocus />
            </div>
            <div>
              <Label htmlFor="staff-email">Email *</Label>
              <Input id="staff-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-staff-email" />
            </div>
            <div>
              <Label htmlFor="staff-phone">{t("Téléphone", "الهاتف")}</Label>
              <Input id="staff-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+213 ..." data-testid="input-staff-phone" />
            </div>
            <div>
              <Label htmlFor="staff-pwd">{t("Mot de passe * (min 6)", "كلمة المرور * (6 أحرف)")}</Label>
              <div className="relative">
                <Input id="staff-pwd" type={showPassword ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="pr-9" data-testid="input-staff-password" />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? t("Masquer", "إخفاء") : t("Afficher", "إظهار")}
                  data-testid="toggle-staff-password">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label>{t("Magasins *", "المتاجر *")}</Label>
              <div className="grid grid-cols-1 gap-1 mt-1 max-h-40 overflow-y-auto border rounded-md p-2">
                {allStores.length === 0 && <p className="text-xs text-muted-foreground">{t("Aucun magasin disponible", "لا توجد متاجر متاحة")}</p>}
                {allStores.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-accent cursor-pointer">
                    <input type="checkbox" checked={form.storeIds.includes(s.id)}
                      onChange={() => toggleStore(s.id, form.storeIds, (v) => setForm({ ...form, storeIds: v }))}
                      data-testid={`store-checkbox-${s.id}`}
                    />
                    <span className="flex-1">{s.nameEn} <span className="text-xs text-muted-foreground" dir="rtl">{s.nameAr}</span></span>
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-red-600" data-testid="text-staff-error">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Annuler", "إلغاء")}</Button>
            <Button onClick={handleCreate} disabled={create.isPending} data-testid="button-save-staff">
              {create.isPending ? "..." : t("Enregistrer", "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editId !== null} onOpenChange={(v) => { if (!v) setEditId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("Magasins accessibles", "المتاجر المتاحة")}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {allStores.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-accent cursor-pointer border">
                <input
                  type="checkbox"
                  checked={editStoreIds.includes(s.id)}
                  onChange={() => toggleStore(s.id, editStoreIds, setEditStoreIds)}
                  data-testid={`edit-store-checkbox-${s.id}`}
                />
                <span className="flex-1">{s.nameEn} <span className="text-xs text-muted-foreground" dir="rtl">{s.nameAr}</span></span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)}>{t("Annuler", "إلغاء")}</Button>
            <Button onClick={() => {
              if (editId == null) return;
              setStores.mutate({ id: editId, data: { storeIds: editStoreIds } }, {
                onSuccess: () => {
                  qc.invalidateQueries({ queryKey: getGetErpStaffQueryKey() });
                  toast({ title: t("Magasins mis à jour", "تم تحديث المتاجر") });
                  setEditId(null);
                },
                onError: (err: unknown) => {
                  toast({
                    variant: "destructive",
                    title: t("Échec de la sauvegarde", "فشل الحفظ"),
                    description: (err as { message?: string })?.message,
                  });
                },
              });
            }} disabled={setStores.isPending} data-testid="button-save-staff-stores">
              {setStores.isPending ? "..." : t("Enregistrer", "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pwdTarget !== null} onOpenChange={(v) => { if (!v) closePwdDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Réinitialiser le mot de passe", "إعادة تعيين كلمة المرور")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("Nouveau mot de passe pour", "كلمة مرور جديدة لـ")} <strong className="text-foreground">{pwdTarget?.name}</strong>
            </p>
            <div>
              <Label htmlFor="new-pwd">{t("Nouveau mot de passe (min 6)", "كلمة المرور الجديدة (6 أحرف)")}</Label>
              <div className="relative">
                <Input id="new-pwd" type={showNewPassword ? "text" : "password"} value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)} className="pr-9" autoFocus data-testid="input-new-password" />
                <button type="button" onClick={() => setShowNewPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground hover:text-foreground"
                  aria-label={showNewPassword ? t("Masquer", "إخفاء") : t("Afficher", "إظهار")}
                  data-testid="toggle-new-password">
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {pwdError && <p className="text-sm text-red-600" data-testid="text-pwd-error">{pwdError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePwdDialog}>{t("Annuler", "إلغاء")}</Button>
            <Button onClick={handleResetPassword} disabled={resetPassword.isPending} data-testid="button-save-new-password">
              {resetPassword.isPending ? "..." : t("Enregistrer", "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

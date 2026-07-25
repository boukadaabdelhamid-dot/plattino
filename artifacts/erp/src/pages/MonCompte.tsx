import React, { useMemo, useState } from "react";
import {
  useGetErpAccountMe, useGetErpCaisseTransfers,
  useAcceptErpCaisseTransfer, useRejectErpCaisseTransfer, useCancelErpCaisseTransfer,
  getGetErpAccountMeQueryKey, getGetErpCaisseTransfersQueryKey, getGetErpCaissesQueryKey,
  getGetMeQueryKey, customFetch, ApiError,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/use-me";
import { useLang } from "@/hooks/use-lang";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { User, Wallet, Send, Inbox, Building2, CheckCircle2, XCircle, Store as StoreIcon, Pencil, X, Loader2, KeyRound, Eye, EyeOff } from "lucide-react";
import {
  fmtAmount, errMsg, personLabel, makeCaisseLabel, makeTransferStatusBadge,
  TransfersTable, SendTransferDialog, type TFn,
} from "@/components/caisse/transfer-ui";

export default function MonCompte() {
  const { isAdmin } = useMe();
  const { can } = usePermissions();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { lang } = useLang();
  const t: TFn = (fr, ar) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const caisseLabel = makeCaisseLabel(t);
  const transferStatusBadge = makeTransferStatusBadge(t);

  const { data: account, isLoading } = useGetErpAccountMe();
  const { data: transfers } = useGetErpCaisseTransfers({ box: "all" });

  const myId = account?.user?.id ?? null;
  const myBalance = account?.caisse?.balance ?? "0.00";
  const mainCaisseId = account?.mainCaisseId ?? null;
  const canSend = isAdmin || can("orders", "create");

  const mine = useMemo(
    () => (transfers ?? []).filter(
      tr => tr.senderCaisse?.ownerUserId === myId || tr.recipientCaisse?.ownerUserId === myId,
    ),
    [transfers, myId],
  );
  const inbox = useMemo(
    () => (transfers ?? []).filter(tr =>
      tr.status === "pending" && tr.senderCaisse?.ownerUserId !== myId && (
        tr.recipientCaisse?.ownerUserId === myId ||
        (isAdmin && tr.recipientCaisse?.kind === "main")
      ),
    ),
    [transfers, myId, isAdmin],
  );
  const outbox = useMemo(
    () => mine.filter(tr => tr.senderCaisse?.ownerUserId === myId),
    [mine, myId],
  );

  const [sendOpen, setSendOpen] = useState(false);

  // ─── Edit profile ─────────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setFormName(account?.user?.name ?? "");
    setFormEmail(account?.user?.email ?? "");
    setEditMode(true);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await customFetch("/api/auth/me", {
        method: "PUT",
        body: JSON.stringify({ name: formName.trim(), email: formEmail.trim() }),
      });
      toast({ title: t("Profil mis à jour", "تم تحديث الملف الشخصي") });
      // Invalidate BOTH queries so name/email refresh everywhere:
      //   - getGetMeQueryKey  → useMe() → Sidebar, caisse dialogs, etc.
      //   - getGetErpAccountMeQueryKey → profile card on this page
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      qc.invalidateQueries({ queryKey: getGetErpAccountMeQueryKey() });
      setEditMode(false);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 409
        ? t("Cette adresse email est déjà utilisée.", "البريد الإلكتروني مستخدم من حساب آخر.")
        : (err instanceof ApiError
            ? ((err.data as { error?: string })?.error ?? t("Une erreur est survenue.", "حدث خطأ."))
            : t("Erreur réseau", "خطأ في الشبكة"));
      toast({ title: t("Erreur", "خطأ"), description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  // ─── Change password ───────────────────────────────────────────────────────
  const [pwMode, setPwMode] = useState(false);
  const [formCurrentPw, setFormCurrentPw] = useState("");
  const [formNewPw, setFormNewPw] = useState("");
  const [formConfirmPw, setFormConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const startChangePassword = () => {
    setFormCurrentPw("");
    setFormNewPw("");
    setFormConfirmPw("");
    setShowCurrentPw(false);
    setShowNewPw(false);
    setShowConfirmPw(false);
    setPwMode(true);
  };

  const savePassword = async () => {
    if (formNewPw !== formConfirmPw) {
      toast({
        title: t("Erreur", "خطأ"),
        description: t("Les deux nouveaux mots de passe ne correspondent pas.", "كلمتا المرور الجديدتان غير متطابقتين."),
        variant: "destructive",
      });
      return;
    }
    if (formNewPw.length < 6) {
      toast({
        title: t("Erreur", "خطأ"),
        description: t("Le nouveau mot de passe doit contenir au moins 6 caractères.", "يجب أن تتكون كلمة المرور الجديدة من 6 أحرف على الأقل."),
        variant: "destructive",
      });
      return;
    }
    setPwSaving(true);
    try {
      await customFetch("/api/auth/me/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword: formCurrentPw, newPassword: formNewPw }),
      });
      toast({ title: t("Mot de passe modifié", "تم تغيير كلمة المرور"), description: t("Votre mot de passe a été mis à jour.", "تم تحديث كلمة مرورك بنجاح.") });
      setPwMode(false);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 401
        ? t("L'ancien mot de passe est incorrect.", "كلمة المرور الحالية غير صحيحة.")
        : (err instanceof ApiError
            ? ((err.data as { error?: string })?.error ?? t("Une erreur est survenue.", "حدث خطأ."))
            : t("Erreur réseau", "خطأ في الشبكة"));
      toast({ title: t("Erreur", "خطأ"), description: msg, variant: "destructive" });
    } finally {
      setPwSaving(false);
    }
  };
  // ──────────────────────────────────────────────────────────────────────────

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: getGetErpAccountMeQueryKey() });
    qc.invalidateQueries({ queryKey: getGetErpCaisseTransfersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetErpCaissesQueryKey() });
  };

  const accept = useAcceptErpCaisseTransfer();
  const reject = useRejectErpCaisseTransfer();
  const cancel = useCancelErpCaisseTransfer();
  const onErr = (e: unknown) => toast({ title: "Erreur", description: errMsg(e), variant: "destructive" });
  const handleAccept = (id: number) => accept.mutate({ id }, { onSuccess: () => { toast({ title: t("Transfert accepté", "تم القبول") }); refreshAll(); }, onError: onErr });
  const handleReject = (id: number) => reject.mutate({ id }, { onSuccess: () => { toast({ title: t("Transfert refusé", "تم الرفض") }); refreshAll(); }, onError: onErr });
  const handleCancel = (id: number) => cancel.mutate({ id }, { onSuccess: () => { toast({ title: t("Annulé", "تم الإلغاء") }); refreshAll(); }, onError: onErr });

  const roleLabel = (r: string | undefined): string => {
    if (r === "admin") return t("Administrateur", "مدير");
    if (r === "employee") return t("Employé", "موظف");
    return r ?? "—";
  };
  const storeName = account?.store
    ? (lang === "ar" ? account.store.nameAr : account.store.nameEn)
    : "—";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <User className="h-6 w-6 text-[#1B3057]" />
          {t("Mon Compte", "حسابي")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Votre profil, le solde de votre caisse et l'historique de vos virements.",
            "ملفك الشخصي، رصيد صندوقك وسجل حوالاتك."
          )}
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t("Chargement...", "جاري التحميل...")}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* ── Profile card ──────────────────────────────────────────── */}
            <Card data-testid="card-identity">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <User className="h-5 w-5 text-[#1B3057]" />
                    {t("Profil", "الملف الشخصي")}
                  </span>
                  {!editMode && !pwMode && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={startEdit}
                      data-testid="button-edit-profile"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      {t("Modifier", "تعديل")}
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {editMode ? (
                  /* ── Edit form ─────────────────────────────────────────── */
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1">
                      <Label htmlFor="edit-name">{t("Nom", "الاسم")}</Label>
                      <Input
                        id="edit-name"
                        value={formName}
                        onChange={e => setFormName(e.target.value)}
                        disabled={saving}
                        data-testid="input-edit-name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-email">Email</Label>
                      <Input
                        id="edit-email"
                        type="email"
                        value={formEmail}
                        onChange={e => setFormEmail(e.target.value)}
                        disabled={saving}
                        data-testid="input-edit-email"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="bg-[#1B3057] hover:bg-[#152544]"
                        onClick={saveProfile}
                        disabled={saving || !formName.trim() || !formEmail.trim()}
                        data-testid="button-save-profile"
                      >
                        {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                        {t("Enregistrer", "حفظ")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditMode(false)}
                        disabled={saving}
                        data-testid="button-cancel-edit-profile"
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        {t("Annuler", "إلغاء")}
                      </Button>
                    </div>
                  </div>
                ) : pwMode ? (
                  /* ── Change password form ──────────────────────────────── */
                  <div className="space-y-3 pt-1" data-testid="form-change-password">
                    <div className="space-y-1">
                      <Label htmlFor="pw-current">{t("Mot de passe actuel", "كلمة المرور الحالية")}</Label>
                      <div className="relative">
                        <Input
                          id="pw-current"
                          type={showCurrentPw ? "text" : "password"}
                          value={formCurrentPw}
                          onChange={e => setFormCurrentPw(e.target.value)}
                          disabled={pwSaving}
                          autoComplete="current-password"
                          data-testid="input-current-password"
                          className={lang === "ar" ? "pl-10" : "pr-10"}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={`absolute top-0 h-full px-3 text-muted-foreground hover:text-foreground ${lang === "ar" ? "left-0" : "right-0"}`}
                          onClick={() => setShowCurrentPw(v => !v)}
                          tabIndex={-1}
                          data-testid="toggle-current-password"
                        >
                          {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pw-new">{t("Nouveau mot de passe", "كلمة المرور الجديدة")}</Label>
                      <div className="relative">
                        <Input
                          id="pw-new"
                          type={showNewPw ? "text" : "password"}
                          value={formNewPw}
                          onChange={e => setFormNewPw(e.target.value)}
                          disabled={pwSaving}
                          autoComplete="new-password"
                          data-testid="input-new-password"
                          className={lang === "ar" ? "pl-10" : "pr-10"}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={`absolute top-0 h-full px-3 text-muted-foreground hover:text-foreground ${lang === "ar" ? "left-0" : "right-0"}`}
                          onClick={() => setShowNewPw(v => !v)}
                          tabIndex={-1}
                          data-testid="toggle-new-password"
                        >
                          {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pw-confirm">{t("Confirmer le nouveau mot de passe", "تأكيد كلمة المرور الجديدة")}</Label>
                      <div className="relative">
                        <Input
                          id="pw-confirm"
                          type={showConfirmPw ? "text" : "password"}
                          value={formConfirmPw}
                          onChange={e => setFormConfirmPw(e.target.value)}
                          disabled={pwSaving}
                          autoComplete="new-password"
                          data-testid="input-confirm-password"
                          className={lang === "ar" ? "pl-10" : "pr-10"}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={`absolute top-0 h-full px-3 text-muted-foreground hover:text-foreground ${lang === "ar" ? "left-0" : "right-0"}`}
                          onClick={() => setShowConfirmPw(v => !v)}
                          tabIndex={-1}
                          data-testid="toggle-confirm-password"
                        >
                          {showConfirmPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    {formNewPw && formConfirmPw && formNewPw !== formConfirmPw && (
                      <p className="text-xs text-destructive" data-testid="text-password-mismatch">
                        {t("Les mots de passe ne correspondent pas.", "كلمتا المرور غير متطابقتين.")}
                      </p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="bg-[#1B3057] hover:bg-[#152544]"
                        onClick={savePassword}
                        disabled={pwSaving || !formCurrentPw || !formNewPw || !formConfirmPw || formNewPw !== formConfirmPw}
                        data-testid="button-save-password"
                      >
                        {pwSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                        {t("Enregistrer", "حفظ")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPwMode(false)}
                        disabled={pwSaving}
                        data-testid="button-cancel-change-password"
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        {t("Annuler", "إلغاء")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* ── Read-only view ────────────────────────────────────── */
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("Nom", "الاسم")}</span>
                      <span className="font-medium" data-testid="text-account-name">{personLabel(account?.user)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("Rôle", "الدور")}</span>
                      <span className="font-medium" data-testid="text-account-role">{roleLabel(account?.user?.role)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <StoreIcon className="h-3.5 w-3.5" /> {t("Magasin", "المتجر")}
                      </span>
                      <span className="font-medium" data-testid="text-account-store">{storeName}</span>
                    </div>
                    {account?.user?.email && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Email</span>
                        <span className="font-medium text-xs" data-testid="text-account-email">{account.user.email}</span>
                      </div>
                    )}
                    <div className="pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs"
                        onClick={startChangePassword}
                        data-testid="button-change-password"
                      >
                        <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                        {t("Changer le mot de passe", "تغيير كلمة المرور")}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── Caisse card ───────────────────────────────────────────── */}
            <Card className="border-2 border-amber-200 bg-amber-50/40" data-testid="card-account-caisse">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-amber-600" />
                  {t("Ma caisse", "صندوقي")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-amber-700" data-testid="text-account-balance">{fmtAmount(myBalance)} {currency}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("Solde actuel", "الرصيد الحالي")}</p>
                {canSend && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="bg-[#1B3057] hover:bg-[#152544]" onClick={() => setSendOpen(true)} data-testid="button-account-send">
                      <Send className="h-4 w-4 mr-1.5" /> {t("Envoyer de l'argent", "إرسال أموال")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="inbox" className="w-full">
            <TabsList>
              <TabsTrigger value="inbox" data-testid="tab-account-inbox">
                <Inbox className="h-4 w-4 mr-1.5" />
                {t("Reçus", "الواردة")} {inbox.length > 0 && <span className="ml-1.5 inline-flex items-center justify-center text-xs bg-red-500 text-white rounded-full h-5 min-w-5 px-1">{inbox.length}</span>}
              </TabsTrigger>
              <TabsTrigger value="outbox" data-testid="tab-account-outbox">
                <Send className="h-4 w-4 mr-1.5" /> {t("Envoyés", "المرسلة")}
              </TabsTrigger>
              <TabsTrigger value="all" data-testid="tab-account-all">
                <Building2 className="h-4 w-4 mr-1.5" /> {t("Tout", "الكل")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="inbox" className="mt-3">
              <TransfersTable
                rows={inbox}
                emptyMsg={t("Aucun virement en attente", "لا توجد حوالات معلقة")}
                caisseLabel={caisseLabel}
                transferStatusBadge={transferStatusBadge}
                t={t}
                renderActions={(tr) => (
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handleAccept(tr.id)} disabled={accept.isPending} data-testid={`button-accept-${tr.id}`}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> {t("Accepter", "قبول")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleReject(tr.id)} disabled={reject.isPending} data-testid={`button-reject-${tr.id}`}>
                      <XCircle className="h-4 w-4 mr-1" /> {t("Refuser", "رفض")}
                    </Button>
                  </div>
                )}
              />
            </TabsContent>

            <TabsContent value="outbox" className="mt-3">
              <TransfersTable
                rows={outbox}
                emptyMsg={t("Aucun virement envoyé", "لم تُرسل أية حوالات")}
                caisseLabel={caisseLabel}
                transferStatusBadge={transferStatusBadge}
                t={t}
                renderActions={(tr) => tr.status === "pending" ? (
                  <Button size="sm" variant="outline" onClick={() => handleCancel(tr.id)} disabled={cancel.isPending} data-testid={`button-cancel-${tr.id}`}>
                    {t("Annuler", "إلغاء")}
                  </Button>
                ) : null}
              />
            </TabsContent>

            <TabsContent value="all" className="mt-3">
              <TransfersTable
                rows={mine}
                emptyMsg={t("Aucun virement", "لا توجد حوالات")}
                caisseLabel={caisseLabel}
                transferStatusBadge={transferStatusBadge}
                t={t}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      <SendTransferDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onSent={refreshAll}
        myBalance={myBalance}
        mainCaisseId={mainCaisseId}
        t={t}
      />
    </div>
  );
}

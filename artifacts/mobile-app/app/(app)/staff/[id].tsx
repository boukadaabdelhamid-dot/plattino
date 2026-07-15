import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetErpStaff,
  useGetErpStoresAll,
  useSetErpStaffStores,
  useResetErpStaffPassword,
  useDeleteErpStaff,
  getGetErpStaffQueryKey,
  getGetErpStoresAllQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useMe } from "@/hooks/use-me";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useConfirm } from "@/contexts/confirm-context";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle, ScreenTitle, Badge, ErrorState } from "@/components/ui";
import { StoreCheckList } from "@/components/StoreCheckList";
import { colors } from "@/lib/colors";

/**
 * Staff management screen. The backend has no generic staff-info-edit
 * endpoint (only /erp/staff/:id/stores, /password, and DELETE), so name/
 * email/role are shown read-only here, matching what's actually mutable.
 */
export default function StaffDetail() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { id } = useLocalSearchParams<{ id: string }>();
  const staffId = Number(id);
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const { confirm } = useConfirm();
  const { user } = useMe();

  const { data: staffList } = useGetErpStaff({
    query: { enabled: ready, queryKey: getGetErpStaffQueryKey() },
  });
  const member = (staffList as any[] | undefined)?.find((s) => s.id === staffId);

  const { data: stores } = useGetErpStoresAll({
    query: { enabled: ready, queryKey: getGetErpStoresAllQueryKey() },
  });

  const [storeIds, setStoreIds] = useState<number[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();

  useEffect(() => {
    if (member?.stores) setStoreIds(member.stores.map((s: { id: number }) => s.id));
  }, [member]);

  const setStores = useSetErpStaffStores();
  const resetPassword = useResetErpStaffPassword();
  const deleteStaff = useDeleteErpStaff();

  if (!ready) return null;
  if (Number.isNaN(staffId)) return <ErrorState title={t("Membre introuvable", "العضو غير موجود")} />;
  if (!member) return null;

  const isSelf = (user as { id?: number } | null)?.id === staffId;

  function handleSaveStores() {
    if (storeIds.length === 0) {
      feedback.error(new Error(t("Sélectionnez au moins un magasin", "اختر متجرًا واحدًا على الأقل")));
      return;
    }
    setStores.mutate(
      { id: staffId, data: { storeIds } },
      {
        onSuccess: () => {
          feedback.success("Magasins mis à jour", "تم تحديث المتاجر");
          queryClient.invalidateQueries({ queryKey: getGetErpStaffQueryKey() });
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  function handleResetPassword() {
    if (newPassword.trim().length < 6) {
      setPasswordError(t("Min. 6 caractères", "6 أحرف على الأقل"));
      return;
    }
    setPasswordError(undefined);
    resetPassword.mutate(
      { id: staffId, data: { password: newPassword.trim() } },
      {
        onSuccess: () => {
          feedback.success("Mot de passe réinitialisé", "تم إعادة تعيين كلمة المرور");
          setNewPassword("");
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Supprimer ce membre ?",
      titleAr: "حذف هذا العضو؟",
      message: "Cette action est irréversible.",
      messageAr: "هذا الإجراء لا يمكن التراجع عنه.",
      destructive: true,
    });
    if (!ok) return;
    deleteStaff.mutate(
      { id: staffId },
      {
        onSuccess: () => {
          feedback.success("Membre supprimé", "تم حذف العضو");
          queryClient.invalidateQueries({ queryKey: getGetErpStaffQueryKey() });
          router.back();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <View style={{ marginBottom: 4 }}>
        <ScreenTitle>{member.name}</ScreenTitle>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <Badge label={member.role === "admin" ? t("Administrateur", "مدير") : t("Employé", "موظف")} tone={member.role === "admin" ? "info" : "muted"} />
        </View>
      </View>

      <Card>
        <SectionTitle>{t("Informations", "المعلومات")}</SectionTitle>
        <FormField label="Email" value={member.email} onChangeText={() => {}} editable={false} />
        {member.phone ? <FormField label={t("Téléphone", "الهاتف")} value={member.phone} onChangeText={() => {}} editable={false} /> : null}
        <Text style={styles.hint}>
          {t(
            "Le nom, l'email et le rôle ne peuvent pas être modifiés depuis l'application.",
            "لا يمكن تعديل الاسم أو البريد الإلكتروني أو الدور من التطبيق.",
          )}
        </Text>
      </Card>

      {member.role !== "admin" ? (
        <Card>
          <SectionTitle>{t("Accès aux magasins", "الوصول إلى المتاجر")}</SectionTitle>
          <StoreCheckList
            label={t("Magasins autorisés", "المتاجر المسموحة")}
            stores={stores ?? []}
            selectedIds={storeIds}
            onChange={setStoreIds}
          />
          <Button
            label={t("Enregistrer les magasins", "حفظ المتاجر")}
            onPress={handleSaveStores}
            loading={setStores.isPending}
            variant="secondary"
            testID="button-save-staff-stores"
          />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>{t("Réinitialiser le mot de passe", "إعادة تعيين كلمة المرور")}</SectionTitle>
        <FormField
          label={t("Nouveau mot de passe", "كلمة المرور الجديدة")}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          error={passwordError}
        />
        <Button
          label={t("Réinitialiser", "إعادة تعيين")}
          onPress={handleResetPassword}
          loading={resetPassword.isPending}
          variant="secondary"
          testID="button-reset-password"
        />
      </Card>

      {!isSelf ? (
        <Card>
          <SectionTitle>{t("Zone de danger", "منطقة الخطر")}</SectionTitle>
          <Button
            label={t("Supprimer le membre", "حذف العضو")}
            onPress={handleDelete}
            loading={deleteStaff.isPending}
            variant="danger"
            testID="button-delete-staff"
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
});

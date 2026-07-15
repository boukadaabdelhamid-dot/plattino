import React, { useEffect, useState } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useUpdateProfile, useChangePassword } from "@/hooks/use-admin-api";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle, LoadingView, Button, FormField } from "@/components/ui";

/** Richer /auth/me fields (phone/address/city) exist on the backend but aren't in the generated User type. */
type MeExtra = { phone?: string; address?: string; city?: string };

export default function SettingsProfile() {
  const { ready } = useProtectedRoute({ section: "settings" });
  const { t } = useLang();
  const feedback = useApiFeedback();
  const { data: me, isLoading } = useGetMe({ query: { enabled: ready, queryKey: getGetMeQueryKey() } });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (me) {
      const extra = me as unknown as MeExtra;
      setName(me.name ?? "");
      setPhone(extra.phone ?? "");
      setAddress(extra.address ?? "");
      setCity(extra.city ?? "");
    }
  }, [me]);

  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();

  if (!ready) return null;
  if (isLoading) return <LoadingView />;

  function handleSaveProfile() {
    if (!name.trim()) {
      setErrors({ name: t("Requis", "مطلوب") });
      return;
    }
    setErrors({});
    updateProfile.mutate(
      { name: name.trim(), phone: phone.trim(), address: address.trim(), city: city.trim() },
      {
        onSuccess: () => feedback.success("Profil mis à jour", "تم تحديث الملف الشخصي"),
        onError: (e) => feedback.error(e),
      },
    );
  }

  function handleChangePassword() {
    const next: Record<string, string> = {};
    if (!currentPassword.trim()) next.currentPassword = t("Requis", "مطلوب");
    if (!newPassword.trim() || newPassword.trim().length < 6) next.newPassword = t("Min. 6 caractères", "6 أحرف على الأقل");
    setPasswordErrors(next);
    if (Object.keys(next).length > 0) return;
    changePassword.mutate(
      { currentPassword: currentPassword.trim(), newPassword: newPassword.trim() },
      {
        onSuccess: () => {
          feedback.success("Mot de passe modifié", "تم تغيير كلمة المرور");
          setCurrentPassword("");
          setNewPassword("");
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Profil", "الملف الشخصي")}</SectionTitle>
        <FormField label={t("Nom", "الاسم")} value={name} onChangeText={setName} error={errors.name} />
        <FormField label="Email" value={me?.email ?? ""} onChangeText={() => {}} editable={false} />
        <FormField label={t("Rôle", "الدور")} value={me?.role === "admin" ? t("Administrateur", "مدير") : t("Employé", "موظف")} onChangeText={() => {}} editable={false} />
        <FormField label={t("Téléphone", "الهاتف")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <FormField label={t("Adresse", "العنوان")} value={address} onChangeText={setAddress} />
        <FormField label={t("Ville", "المدينة")} value={city} onChangeText={setCity} />
        <Button
          label={t("Enregistrer", "حفظ")}
          onPress={handleSaveProfile}
          loading={updateProfile.isPending}
          testID="button-save-profile"
        />
      </Card>

      <Card>
        <SectionTitle>{t("Changer le mot de passe", "تغيير كلمة المرور")}</SectionTitle>
        <FormField
          label={t("Mot de passe actuel", "كلمة المرور الحالية")}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          error={passwordErrors.currentPassword}
        />
        <FormField
          label={t("Nouveau mot de passe", "كلمة المرور الجديدة")}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          error={passwordErrors.newPassword}
        />
        <Button
          label={t("Changer le mot de passe", "تغيير كلمة المرور")}
          onPress={handleChangePassword}
          loading={changePassword.isPending}
          variant="secondary"
          testID="button-change-password"
        />
      </Card>
    </Screen>
  );
}

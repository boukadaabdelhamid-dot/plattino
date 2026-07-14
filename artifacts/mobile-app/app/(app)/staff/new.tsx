import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateErpStaff,
  useGetErpStoresAll,
  getGetErpStaffQueryKey,
  getGetErpStoresAllQueryKey,
  CreateStaffRequestRole,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle } from "@/components/ui";
import { StoreCheckList } from "@/components/StoreCheckList";

export default function NewStaff() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [storeIds, setStoreIds] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: stores } = useGetErpStoresAll({
    query: { enabled: ready, queryKey: getGetErpStoresAllQueryKey() },
  });
  const createStaff = useCreateErpStaff();

  if (!ready) return null;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t("Requis", "مطلوب");
    if (!email.trim()) next.email = t("Requis", "مطلوب");
    if (!password.trim() || password.trim().length < 6) next.password = t("Min. 6 caractères", "6 أحرف على الأقل");
    if (role === "employee" && storeIds.length === 0) next.storeIds = t("Sélectionnez au moins un magasin", "اختر متجرًا واحدًا على الأقل");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    createStaff.mutate(
      {
        data: {
          name: name.trim(),
          email: email.trim(),
          password: password.trim(),
          phone: phone.trim() || undefined,
          role: role as CreateStaffRequestRole,
          storeIds: storeIds.length > 0 ? storeIds : undefined,
        },
      },
      {
        onSuccess: () => {
          feedback.success("Membre du personnel créé", "تم إنشاء الموظف");
          queryClient.invalidateQueries({ queryKey: getGetErpStaffQueryKey() });
          router.back();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Informations", "المعلومات")}</SectionTitle>
        <FormField label={t("Nom complet", "الاسم الكامل")} value={name} onChangeText={setName} error={errors.name} />
        <FormField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
        <FormField label={t("Téléphone", "الهاتف")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <FormField
          label={t("Mot de passe", "كلمة المرور")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          error={errors.password}
        />
      </Card>

      <Card>
        <SectionTitle>{t("Rôle", "الدور")}</SectionTitle>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            label={t("Employé", "موظف")}
            variant={role === "employee" ? "primary" : "secondary"}
            onPress={() => setRole("employee")}
            style={{ flex: 1 }}
            testID="button-role-employee"
          />
          <Button
            label={t("Administrateur", "مدير")}
            variant={role === "admin" ? "primary" : "secondary"}
            onPress={() => setRole("admin")}
            style={{ flex: 1 }}
            testID="button-role-admin"
          />
        </View>
      </Card>

      {role === "employee" ? (
        <Card>
          <SectionTitle>{t("Accès aux magasins", "الوصول إلى المتاجر")}</SectionTitle>
          <StoreCheckList
            label={t("Magasins autorisés", "المتاجر المسموحة")}
            stores={stores ?? []}
            selectedIds={storeIds}
            onChange={setStoreIds}
            error={errors.storeIds}
          />
        </Card>
      ) : null}

      <Button
        label={t("Créer le compte", "إنشاء الحساب")}
        onPress={handleSubmit}
        loading={createStaff.isPending}
        testID="button-submit-staff"
      />
    </Screen>
  );
}

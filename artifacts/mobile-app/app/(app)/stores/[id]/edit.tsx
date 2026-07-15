import React, { useEffect, useState } from "react";
import { View, Switch, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetErpStoresAll,
  useUpdateErpStore,
  useDeleteErpStore,
  getGetErpStoresAllQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useConfirm } from "@/contexts/confirm-context";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle, ErrorState } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function EditStore() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { id } = useLocalSearchParams<{ id: string }>();
  const storeId = Number(id);
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const { confirm } = useConfirm();

  const { data: stores } = useGetErpStoresAll({
    query: { enabled: ready, queryKey: getGetErpStoresAllQueryKey() },
  });
  const store = (stores as any[] | undefined)?.find((s) => s.id === storeId);

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (store) {
      setNameEn(store.nameEn ?? "");
      setNameAr(store.nameAr ?? "");
      setAddress(store.address ?? "");
      setPhone(store.phone ?? "");
      setIsActive(!!store.isActive);
    }
  }, [store]);

  const updateStore = useUpdateErpStore();
  const deleteStore = useDeleteErpStore();

  if (!ready) return null;
  if (Number.isNaN(storeId)) return <ErrorState title={t("Magasin introuvable", "المتجر غير موجود")} />;
  if (!store) return null;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!nameEn.trim()) next.nameEn = t("Requis", "مطلوب");
    if (!nameAr.trim()) next.nameAr = t("Requis", "مطلوب");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    updateStore.mutate(
      {
        id: storeId,
        data: {
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          address: address.trim() || null,
          phone: phone.trim() || null,
          isActive,
        },
      },
      {
        onSuccess: () => {
          feedback.success("Magasin mis à jour", "تم تحديث المتجر");
          queryClient.invalidateQueries({ queryKey: getGetErpStoresAllQueryKey() });
          router.back();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Supprimer ce magasin ?",
      titleAr: "حذف هذا المتجر؟",
      message: "Impossible si le magasin contient encore des données (produits, commandes, employés...).",
      messageAr: "غير ممكن إذا كان المتجر لا يزال يحتوي على بيانات (منتجات، طلبات، موظفون...).",
      destructive: true,
    });
    if (!ok) return;
    deleteStore.mutate(
      { id: storeId },
      {
        onSuccess: () => {
          feedback.success("Magasin supprimé", "تم حذف المتجر");
          queryClient.invalidateQueries({ queryKey: getGetErpStoresAllQueryKey() });
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
        <FormField label={t("Nom (Français)", "الاسم (فرنسي)")} value={nameEn} onChangeText={setNameEn} error={errors.nameEn} />
        <FormField label={t("Nom (Arabe)", "الاسم (عربي)")} value={nameAr} onChangeText={setNameAr} error={errors.nameAr} />
        <FormField label={t("Adresse", "العنوان")} value={address} onChangeText={setAddress} />
        <FormField label={t("Téléphone", "الهاتف")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <View style={styles.row}>
          <Text style={styles.label}>{t("Magasin actif", "متجر نشط")}</Text>
          <Switch value={isActive} onValueChange={setIsActive} trackColor={{ true: colors.primary }} testID="switch-store-active" />
        </View>
      </Card>

      <Button
        label={t("Enregistrer", "حفظ")}
        onPress={handleSubmit}
        loading={updateStore.isPending}
        testID="button-submit-store-edit"
      />

      <Card>
        <SectionTitle>{t("Zone de danger", "منطقة الخطر")}</SectionTitle>
        <Button
          label={t("Supprimer le magasin", "حذف المتجر")}
          onPress={handleDelete}
          loading={deleteStore.isPending}
          variant="danger"
          testID="button-delete-store"
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  label: { fontSize: 14, color: colors.text },
});

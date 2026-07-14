import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateErpStore, getGetErpStoresAllQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle } from "@/components/ui";

function slugify(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function NewStore() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createStore = useCreateErpStore();

  if (!ready) return null;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!nameEn.trim()) next.nameEn = t("Requis", "مطلوب");
    if (!nameAr.trim()) next.nameAr = t("Requis", "مطلوب");
    if (!slug.trim()) next.slug = t("Requis", "مطلوب");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    createStore.mutate(
      {
        data: {
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          slug: slug.trim(),
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          feedback.success("Magasin créé", "تم إنشاء المتجر");
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
        <FormField
          label={t("Nom (Français)", "الاسم (فرنسي)")}
          value={nameEn}
          onChangeText={(v) => {
            setNameEn(v);
            if (!slugTouched) setSlug(slugify(v));
          }}
          error={errors.nameEn}
        />
        <FormField label={t("Nom (Arabe)", "الاسم (عربي)")} value={nameAr} onChangeText={setNameAr} error={errors.nameAr} />
        <FormField
          label="Slug"
          value={slug}
          onChangeText={(v) => {
            setSlugTouched(true);
            setSlug(v);
          }}
          autoCapitalize="none"
          error={errors.slug}
        />
        <FormField label={t("Adresse", "العنوان")} value={address} onChangeText={setAddress} />
        <FormField label={t("Téléphone", "الهاتف")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      </Card>

      <Button
        label={t("Créer le magasin", "إنشاء المتجر")}
        onPress={handleSubmit}
        loading={createStore.isPending}
        testID="button-submit-store"
      />
    </Screen>
  );
}

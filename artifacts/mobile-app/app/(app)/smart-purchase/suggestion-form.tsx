/**
 * suggestion-form.tsx — Create or edit a purchase suggestion (Idée).
 *
 * Route params (via useLocalSearchParams):
 *   id            – suggestion id when editing; absent when creating
 *   product_name  – prefilled when editing
 *   market_price  – prefilled when editing
 *   notes         – prefilled when editing
 */
import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { FormField, Button } from "@/components/ui";
import { Screen } from "@/components/Screen";
import { useCreateSuggestion, usePatchSuggestion } from "@/hooks/use-smart-purchase";

export default function SuggestionForm() {
  const { ready } = useProtectedRoute({ section: "purchases" });
  const { t } = useLang();
  const router = useRouter();
  const feedback = useApiFeedback();

  const params = useLocalSearchParams<{
    id?: string;
    product_name?: string;
    market_price?: string;
    notes?: string;
  }>();

  const isEdit = !!params.id;

  const [productName, setProductName]   = useState(params.product_name ?? "");
  const [marketPrice, setMarketPrice]   = useState(params.market_price ?? "");
  const [notes, setNotes]               = useState(params.notes ?? "");

  const create = useCreateSuggestion();
  const patch  = usePatchSuggestion();

  const submitting = create.isPending || patch.isPending;

  if (!ready) return null;

  function handleSubmit() {
    const name = productName.trim();
    if (!name) {
      feedback.error(new Error(t("Le nom du produit est requis", "اسم المنتج مطلوب")));
      return;
    }
    const body = {
      product_name: name,
      market_price: marketPrice.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    if (isEdit) {
      patch.mutate(
        { id: Number(params.id), ...body },
        {
          onSuccess: () => {
            feedback.success(
              t("Idée modifiée", "تم تعديل الاقتراح"),
              t("Idée modifiée", "تم تعديل الاقتراح"),
            );
            router.back();
          },
          onError: (e) => feedback.error(e),
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          feedback.success(
            t("Idée ajoutée", "تمت إضافة الاقتراح"),
            t("Idée ajoutée", "تمت إضافة الاقتراح"),
          );
          router.back();
        },
        onError: (e) => feedback.error(e),
      });
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <FormField
          label={t("Nom du produit *", "اسم المنتج *")}
          value={productName}
          onChangeText={setProductName}
          placeholder={t("Ex: iPhone 15 Pro Max", "مثال: آيفون 15 برو ماكس")}
        />
        <FormField
          label={t("Prix du marché (DA)", "سعر السوق (دج)")}
          value={marketPrice}
          onChangeText={setMarketPrice}
          placeholder={t("Optionnel", "اختياري")}
          keyboardType="decimal-pad"
        />
        <FormField
          label={t("Remarques", "ملاحظات")}
          value={notes}
          onChangeText={setNotes}
          placeholder={t("Optionnel", "اختياري")}
          multiline
        />
        <View style={{ height: 16 }} />
        <Button
          label={isEdit
            ? t("Enregistrer les modifications", "حفظ التعديلات")
            : t("Ajouter l'idée", "إضافة الاقتراح")}
          onPress={handleSubmit}
          loading={submitting}
          testID="button-submit-suggestion"
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
});

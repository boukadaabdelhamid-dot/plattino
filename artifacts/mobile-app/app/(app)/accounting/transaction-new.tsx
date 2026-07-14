import React, { useState } from "react";
import { Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTransaction,
  getGetTransactionsQueryKey,
  getGetAccountingSummaryQueryKey,
  CreateTransactionRequestType,
  CreateTransactionRequestCategory,
  type CreateTransactionRequestType as TxType,
  type CreateTransactionRequestCategory as TxCategory,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle } from "@/components/ui";
import { colors } from "@/lib/colors";

const CATEGORY_LABEL: Record<string, [string, string]> = {
  sales: ["Ventes", "المبيعات"],
  purchase: ["Achats", "المشتريات"],
  salary: ["Salaires", "الرواتب"],
  rent: ["Loyer", "الإيجار"],
  utilities: ["Charges", "الخدمات"],
  marketing: ["Marketing", "التسويق"],
  other: ["Autre", "أخرى"],
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewTransaction() {
  const { ready } = useProtectedRoute({ section: "accounting" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const [type, setType] = useState<TxType>(CreateTransactionRequestType.expense);
  const [category, setCategory] = useState<TxCategory>(CreateTransactionRequestCategory.other);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");

  const create = useCreateTransaction();

  if (!ready) return null;

  function handleSubmit() {
    const a = parseFloat(amount);
    if (!a || a <= 0) {
      setError(t("Montant invalide", "مبلغ غير صالح"));
      return;
    }
    if (!description.trim()) {
      setError(t("Description requise", "الوصف مطلوب"));
      return;
    }
    if (!date.trim()) {
      setError(t("Date requise", "التاريخ مطلوب"));
      return;
    }
    setError("");

    create.mutate(
      {
        data: {
          type,
          category,
          amount: a.toFixed(2),
          description: description.trim(),
          date: date.trim(),
          reference: reference.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          feedback.success("Transaction enregistrée", "تم تسجيل المعاملة");
          queryClient.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAccountingSummaryQueryKey() });
          router.back();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Nouvelle transaction", "معاملة جديدة")}</SectionTitle>

        <Text style={styles.label}>{t("Type", "النوع")}</Text>
        <Button
          label={type === "income" ? t("Revenu", "دخل") : t("Dépense", "مصروف")}
          variant="secondary"
          onPress={() => setType(type === "income" ? CreateTransactionRequestType.expense : CreateTransactionRequestType.income)}
          testID="button-toggle-type"
          style={{ marginBottom: 12, alignSelf: "flex-start" }}
        />

        <Text style={styles.label}>{t("Catégorie", "الفئة")}</Text>
        <Card style={styles.categoryWrap}>
          {Object.values(CreateTransactionRequestCategory).map((c) => {
            const [fr, ar] = CATEGORY_LABEL[c] ?? [c, c];
            return (
              <Button
                key={c}
                label={t(fr, ar)}
                variant={category === c ? "primary" : "secondary"}
                onPress={() => setCategory(c)}
                style={styles.categoryButton}
                testID={`button-category-${c}`}
              />
            );
          })}
        </Card>

        <FormField label={t("Montant", "المبلغ")} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <FormField label={t("Description", "الوصف")} value={description} onChangeText={setDescription} />
        <FormField label={t("Date (AAAA-MM-JJ)", "التاريخ (YYYY-MM-DD)")} value={date} onChangeText={setDate} />
        <FormField label={t("Référence (optionnel)", "المرجع (اختياري)")} value={reference} onChangeText={setReference} />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={t("Enregistrer", "حفظ")}
          onPress={handleSubmit}
          loading={create.isPending}
          testID="button-submit-transaction"
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: "500" },
  categoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 0, borderWidth: 0, backgroundColor: "transparent", marginBottom: 14 },
  categoryButton: { paddingHorizontal: 12 },
  error: { color: colors.danger, fontSize: 13, textAlign: "center", marginBottom: 8 },
});

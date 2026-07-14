import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateErpCaisseTransfer,
  useGetErpCaisses,
  useGetErpAccountMe,
  useGetErpCaisseTransferRecipients,
  getGetErpCaissesQueryKey,
  getGetErpAccountMeQueryKey,
  getGetErpCaisseTransferRecipientsQueryKey,
  getGetErpCaisseTransfersQueryKey,
  type CaisseTransferRecipient,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useMe } from "@/hooks/use-me";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle, ErrorState } from "@/components/ui";
import { PickerField } from "@/components/Picker";
import { colors } from "@/lib/colors";

export default function NewCaisseTransfer() {
  const { fromMain } = useLocalSearchParams<{ fromMain?: string }>();
  const isFromMain = fromMain === "1";
  const { ready, isAdmin } = useProtectedRoute({ section: "caisse" });
  const { t, lang } = useLang();
  const { user } = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const currency = lang === "ar" ? "دج" : "DA";

  const [target, setTarget] = useState<"main" | "colleague">(isFromMain ? "colleague" : "main");
  const [recipient, setRecipient] = useState<CaisseTransferRecipient | null>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const { data: caisses } = useGetErpCaisses({
    query: { enabled: ready, queryKey: getGetErpCaissesQueryKey() },
  });
  const myCaisse = (caisses ?? []).find((c) => c.ownerUserId === user?.id) ?? null;
  const mainCaisseFromList = (caisses ?? []).find((c) => c.kind === "main") ?? null;

  // Non-admin staff never receive the main caisse in the /erp/caisses list
  // (ownership-scoped by design), so its id — needed to target
  // recipientCaisseId when sending to main — must be resolved from
  // account/me instead. Only fetched when needed (main missing from the list
  // and we're not overriding the sender to main, which already implies admin).
  const needsMainCaisseId = !isFromMain && !mainCaisseFromList;
  const { data: accountMe } = useGetErpAccountMe({
    query: { enabled: ready && needsMainCaisseId, queryKey: getGetErpAccountMeQueryKey() },
  });
  const mainCaisseId = mainCaisseFromList?.id ?? accountMe?.mainCaisseId ?? null;
  // Balance display for the main caisse only exists in the admin-visible list;
  // non-admins can send to it without seeing its balance.
  const senderBalance = isFromMain ? mainCaisseFromList?.balance ?? "0.00" : myCaisse?.balance ?? "0.00";

  // Only admins may override the sender to the main caisse — mirrors the backend guard.
  const unauthorizedFromMain = isFromMain && !isAdmin;

  const recipientsParams = isFromMain ? { includeMe: true } : undefined;
  const { data: recipientsData } = useGetErpCaisseTransferRecipients(recipientsParams, {
    query: {
      enabled: ready && !unauthorizedFromMain && (isFromMain || target === "colleague"),
      queryKey: getGetErpCaisseTransferRecipientsQueryKey(recipientsParams),
    },
  });
  const excludeUserId = isFromMain ? null : user?.id;
  const recipients = (recipientsData ?? []).filter((r) => r.id !== excludeUserId);

  const create = useCreateErpCaisseTransfer();

  if (!ready) return null;
  if (unauthorizedFromMain) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }
  if (!isFromMain && !myCaisse) {
    return <ErrorState title={t("Aucune caisse personnelle", "لا يوجد صندوق شخصي")} />;
  }

  function handleSubmit() {
    const a = parseFloat(amount);
    if (!a || a <= 0) {
      setError(t("Montant invalide", "مبلغ غير صالح"));
      return;
    }
    if (a > parseFloat(senderBalance)) {
      setError(t("Solde insuffisant", "رصيد غير كافٍ"));
      return;
    }
    if (target === "colleague" && !recipient) {
      setError(t("Choisir un destinataire", "اختر مستلماً"));
      return;
    }
    if (target === "main" && !mainCaisseId) {
      setError(t("Caisse principale introuvable", "الصندوق الرئيسي غير موجود"));
      return;
    }
    setError("");

    create.mutate(
      {
        data: {
          senderCaisseId: isFromMain ? mainCaisseFromList?.id : undefined,
          amount: a.toFixed(2),
          notes: notes.trim() || undefined,
          ...(target === "main" ? { recipientCaisseId: mainCaisseId! } : { recipientUserId: recipient!.id }),
        },
      },
      {
        onSuccess: () => {
          feedback.success("Transfert envoyé", "تم إرسال التحويل");
          queryClient.invalidateQueries({ queryKey: getGetErpCaisseTransfersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetErpCaissesQueryKey() });
          router.back();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{isFromMain ? t("Virement depuis la caisse principale", "تحويل من الصندوق الرئيسي") : t("Envoyer de l'argent", "إرسال أموال")}</SectionTitle>
        <Text style={styles.balanceLabel}>
          {t("Solde disponible", "الرصيد المتاح")}: <Text style={styles.balanceValue}>{Number(senderBalance).toLocaleString("fr-FR")} {currency}</Text>
        </Text>

        {!isFromMain ? (
          <View style={styles.modeRow}>
            <Button
              label={t("Caisse principale", "الصندوق الرئيسي")}
              variant={target === "main" ? "primary" : "secondary"}
              onPress={() => setTarget("main")}
              style={{ flex: 1 }}
              testID="button-target-main"
            />
            <Button
              label={t("Un collègue", "زميل")}
              variant={target === "colleague" ? "primary" : "secondary"}
              onPress={() => setTarget("colleague")}
              style={{ flex: 1 }}
              testID="button-target-colleague"
            />
          </View>
        ) : null}

        {target === "colleague" ? (
          <PickerField<CaisseTransferRecipient>
            label={t("Destinataire", "المستلم")}
            value={recipient}
            items={recipients}
            keyExtractor={(r) => String(r.id)}
            labelExtractor={(r) => r.name || r.email}
            subtitleExtractor={(r) => r.role}
            onChange={setRecipient}
            placeholder={t("Choisir un collègue...", "اختر زميلاً...")}
          />
        ) : null}

        <FormField label={t(`Montant (${currency})`, `المبلغ (${currency})`)} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <FormField label={t("Note (optionnel)", "ملاحظة (اختياري)")} value={notes} onChangeText={setNotes} multiline />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={t("Envoyer", "إرسال")}
          onPress={handleSubmit}
          loading={create.isPending}
          testID="button-submit-caisse-transfer"
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceLabel: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: 14 },
  balanceValue: { fontWeight: "700", color: colors.text },
  modeRow: { flexDirection: "row", gap: 10, marginBottom: 6 },
  error: { color: colors.danger, fontSize: 13, textAlign: "center", marginBottom: 8 },
});

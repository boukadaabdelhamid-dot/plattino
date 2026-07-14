import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetErpCaisse,
  useGetErpCaisseSessions,
  useOpenErpCaisseSession,
  useCloseErpCaisseSession,
  useAdminDepositErpCaisse,
  useAdminWithdrawErpCaisse,
  useAdminAdjustErpCaisse,
  getGetErpCaisseQueryKey,
  getGetErpCaisseSessionsQueryKey,
  getGetErpCaissesQueryKey,
  type CaisseMovement,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useMe } from "@/hooks/use-me";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle, Divider, Badge, LoadingView, ErrorState } from "@/components/ui";
import { SheetModal } from "@/components/SheetModal";
import { colors } from "@/lib/colors";

const REASON_LABEL: Record<string, [string, string]> = {
  sale: ["Vente", "بيع"],
  transfer_in: ["Transfert reçu", "تحويل وارد"],
  transfer_out: ["Transfert envoyé", "تحويل صادر"],
  transfer_hold: ["Transfert (ancien)", "حجز تحويل (قديم)"],
  transfer_refund: ["Remboursement (ancien)", "استرجاع (قديم)"],
  admin_deposit: ["Dépôt → principale", "إيداع"],
  admin_withdraw: ["Retrait ← principale", "سحب"],
  adjustment: ["Ajustement", "تعديل"],
};

type Sheet = "open" | "close" | "deposit" | "withdraw" | "adjust" | null;

export default function CaisseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const caisseId = Number(id);
  const { ready, isAdmin, can } = useProtectedRoute({ section: "caisse" });
  const { t, lang } = useLang();
  const { user } = useMe();
  const feedback = useApiFeedback();
  const router = useRouter();
  const queryClient = useQueryClient();
  const currency = lang === "ar" ? "دج" : "DA";

  const [sheet, setSheet] = useState<Sheet>(null);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [actualClosing, setActualClosing] = useState("");
  const [amount, setAmount] = useState("");
  const [targetBalance, setTargetBalance] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const { data: caisse, isLoading, isError, refetch, isRefetching } = useGetErpCaisse(caisseId, {
    query: { enabled: ready && !!caisseId, queryKey: getGetErpCaisseQueryKey(caisseId) },
  });

  const sessionsParams = { limit: 10 };
  const { data: sessions, refetch: refetchSessions } = useGetErpCaisseSessions(caisseId, sessionsParams, {
    query: { enabled: ready && !!caisseId, queryKey: getGetErpCaisseSessionsQueryKey(caisseId, sessionsParams) },
  });
  const activeSession = (sessions ?? []).find((s) => s.status === "open") ?? null;
  const theoreticalBalance = activeSession
    ? parseFloat(activeSession.openingBalance) + parseFloat(activeSession.movementSummary?.netMovement ?? "0")
    : 0;

  const openSession = useOpenErpCaisseSession();
  const closeSession = useCloseErpCaisseSession();
  const deposit = useAdminDepositErpCaisse();
  const withdraw = useAdminWithdrawErpCaisse();
  const adjust = useAdminAdjustErpCaisse();

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (isError || !caisse) return <ErrorState title={t("Caisse introuvable", "الصندوق غير موجود")} />;

  const isMine = caisse.ownerUserId === user?.id;
  const canManage = isAdmin || isMine;
  const canOpen = canManage && can("caisse", "create");
  const canClose = canManage && can("caisse", "edit");

  function closeSheet() {
    setSheet(null);
    setError("");
    setAmount("");
    setTargetBalance("");
    setNotes("");
    setActualClosing("");
  }

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: getGetErpCaisseQueryKey(caisseId) });
    queryClient.invalidateQueries({ queryKey: getGetErpCaisseSessionsQueryKey(caisseId, sessionsParams) });
    queryClient.invalidateQueries({ queryKey: getGetErpCaissesQueryKey() });
    refetchSessions();
    refetch();
  }

  function submitOpenSession() {
    setError("");
    openSession.mutate(
      { id: caisseId, data: { openingBalance: openingBalance || "0", notes: notes.trim() || undefined } },
      {
        onSuccess: () => {
          feedback.success("Session ouverte", "تم فتح الجلسة");
          refreshAll();
          closeSheet();
        },
        onError: (e) => setError((e as any)?.message ?? t("Erreur lors de l'ouverture", "خطأ عند الفتح")),
      },
    );
  }

  function submitCloseSession() {
    if (!actualClosing) {
      setError(t("Indiquez le solde réel compté", "أدخل الرصيد الفعلي المعدود"));
      return;
    }
    setError("");
    closeSession.mutate(
      { id: caisseId, data: { actualClosingBalance: actualClosing, notes: notes.trim() || undefined } },
      {
        onSuccess: () => {
          feedback.success("Session clôturée", "تم إغلاق الجلسة");
          refreshAll();
          closeSheet();
        },
        onError: (e) => setError((e as any)?.message ?? t("Erreur lors de la clôture", "خطأ عند الإغلاق")),
      },
    );
  }

  function submitAdminAmount(kind: "deposit" | "withdraw") {
    const a = parseFloat(amount);
    if (!a || a <= 0) {
      setError(t("Montant invalide", "مبلغ غير صالح"));
      return;
    }
    setError("");
    const mutation = kind === "deposit" ? deposit : withdraw;
    mutation.mutate(
      { data: { caisseId, amount: a.toFixed(2), notes: notes.trim() || undefined } },
      {
        onSuccess: () => {
          feedback.success("Opération réussie", "تمت العملية");
          refreshAll();
          closeSheet();
        },
        onError: (e) => setError((e as any)?.message ?? t("Une erreur est survenue", "حدث خطأ")),
      },
    );
  }

  function submitAdjust() {
    const target = parseFloat(targetBalance);
    if (isNaN(target) || target < 0) {
      setError(t("Solde cible invalide", "رصيد مستهدف غير صالح"));
      return;
    }
    setError("");
    adjust.mutate(
      { data: { caisseId, targetBalance: target.toFixed(2), notes: notes.trim() || undefined } },
      {
        onSuccess: () => {
          feedback.success("Solde ajusté", "تم تعديل الرصيد");
          refreshAll();
          closeSheet();
        },
        onError: (e) => setError((e as any)?.message ?? t("Une erreur est survenue", "حدث خطأ")),
      },
    );
  }

  const movements = (caisse.movements ?? []) as CaisseMovement[];

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <Card>
        <SectionTitle>
          {caisse.kind === "main" ? t("Caisse principale", "الصندوق الرئيسي") : (caisse.owner?.name ?? t("Caisse personnelle", "صندوق شخصي"))}
        </SectionTitle>
        <Text style={styles.balance}>{Number(caisse.balance ?? 0).toLocaleString("fr-FR")} {currency}</Text>
        {(isMine || isAdmin) ? (
          <Button
            label={t("Envoyer un virement", "إرسال تحويل")}
            onPress={() =>
              router.push({
                pathname: "/caisse/transfer-new" as never,
                params: caisse.kind === "main" ? { fromMain: "1" } : {},
              } as never)
            }
            style={{ marginTop: 10 }}
            testID="button-detail-send-transfer"
          />
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t("Session de caisse", "جلسة الصندوق")}</SectionTitle>
        {activeSession ? (
          <>
            <View style={styles.row}>
              <Badge label={t("Ouverte", "مفتوحة")} tone="success" />
              <Text style={styles.mutedSmall}>
                {t("Depuis", "منذ")} {new Date(activeSession.openedAt).toLocaleString("fr-FR")}
              </Text>
            </View>
            <Divider />
            <Text style={styles.label}>{t("Solde d'ouverture", "رصيد الفتح")}</Text>
            <Text style={styles.value}>{Number(activeSession.openingBalance).toLocaleString("fr-FR")} {currency}</Text>
            <Text style={styles.label}>{t("Solde théorique actuel", "الرصيد النظري الحالي")}</Text>
            <Text style={styles.value}>{theoreticalBalance.toLocaleString("fr-FR")} {currency}</Text>
            {canClose ? (
              <Button
                label={t("Clôturer la session", "إغلاق الجلسة")}
                variant="danger"
                onPress={() => {
                  setActualClosing(theoreticalBalance.toFixed(2));
                  setSheet("close");
                }}
                style={{ marginTop: 10 }}
                testID="button-close-session"
              />
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.mutedSmall}>{t("Aucune session ouverte pour cette caisse.", "لا توجد جلسة مفتوحة لهذا الصندوق.")}</Text>
            {canOpen ? (
              <Button
                label={t("Ouvrir une session", "فتح جلسة")}
                onPress={() => {
                  setOpeningBalance("0");
                  setSheet("open");
                }}
                style={{ marginTop: 10 }}
                testID="button-open-session"
              />
            ) : null}
          </>
        )}
      </Card>

      {isAdmin ? (
        <Card>
          <SectionTitle>{t("Actions admin", "إجراءات الإدارة")}</SectionTitle>
          <View style={styles.actionsRow}>
            {caisse.kind === "staff" ? (
              <>
                <Button
                  label={t("Dépôt", "إيداع")}
                  variant="secondary"
                  onPress={() => setSheet("deposit")}
                  style={{ flex: 1 }}
                  testID="button-admin-deposit"
                />
                <Button
                  label={t("Retrait", "سحب")}
                  variant="secondary"
                  onPress={() => setSheet("withdraw")}
                  style={{ flex: 1 }}
                  testID="button-admin-withdraw"
                />
              </>
            ) : null}
            <Button
              label={t("Ajuster", "تعديل")}
              variant="secondary"
              onPress={() => {
                setTargetBalance(caisse.balance);
                setSheet("adjust");
              }}
              style={{ flex: 1 }}
              testID="button-admin-adjust"
            />
          </View>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>{t("Mouvements récents", "الحركات الأخيرة")}</SectionTitle>
        {movements.length === 0 ? (
          <Text style={styles.mutedSmall}>{t("Aucun mouvement", "لا توجد حركات")}</Text>
        ) : (
          movements.map((m, i) => {
            const [fr, ar] = REASON_LABEL[m.reason] ?? [m.reason, m.reason];
            return (
              <View key={m.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.movReason}>{t(fr, ar)}</Text>
                    <Text style={styles.mutedSmall}>{new Date(m.createdAt).toLocaleString("fr-FR")}</Text>
                    {m.notes ? <Text style={styles.mutedSmall}>{m.notes}</Text> : null}
                  </View>
                  <Text style={[styles.movAmount, { color: m.type === "credit" ? colors.success : colors.danger }]}>
                    {m.type === "credit" ? "+" : "-"}{Number(m.amount).toLocaleString("fr-FR")} {currency}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </Card>

      <SheetModal
        visible={sheet === "open"}
        onClose={closeSheet}
        title={t("Ouvrir une session", "فتح جلسة")}
        footer={
          <Button
            label={t("Ouvrir", "فتح")}
            onPress={submitOpenSession}
            loading={openSession.isPending}
            testID="button-submit-open-session"
          />
        }
      >
        <FormField label={t("Solde d'ouverture", "رصيد الفتح")} value={openingBalance} onChangeText={setOpeningBalance} keyboardType="decimal-pad" />
        <FormField label={t("Notes (optionnel)", "ملاحظات (اختياري)")} value={notes} onChangeText={setNotes} multiline />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SheetModal>

      <SheetModal
        visible={sheet === "close"}
        onClose={closeSheet}
        title={t("Clôturer la session", "إغلاق الجلسة")}
        footer={
          <Button
            label={t("Clôturer", "إغلاق")}
            variant="danger"
            onPress={submitCloseSession}
            loading={closeSession.isPending}
            testID="button-submit-close-session"
          />
        }
      >
        <Text style={styles.mutedSmall}>
          {t("Solde théorique", "الرصيد النظري")}: {theoreticalBalance.toLocaleString("fr-FR")} {currency}
        </Text>
        <FormField label={t("Solde réel compté", "الرصيد الفعلي المعدود")} value={actualClosing} onChangeText={setActualClosing} keyboardType="decimal-pad" />
        <FormField label={t("Notes (optionnel)", "ملاحظات (اختياري)")} value={notes} onChangeText={setNotes} multiline />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SheetModal>

      <SheetModal
        visible={sheet === "deposit" || sheet === "withdraw"}
        onClose={closeSheet}
        title={sheet === "deposit" ? t("Dépôt vers principale", "إيداع للصندوق الرئيسي") : t("Retrait depuis principale", "سحب من الصندوق الرئيسي")}
        footer={
          <Button
            label={t("Confirmer", "تأكيد")}
            onPress={() => submitAdminAmount(sheet === "deposit" ? "deposit" : "withdraw")}
            loading={deposit.isPending || withdraw.isPending}
            testID="button-submit-admin-amount"
          />
        }
      >
        <FormField label={t("Montant", "المبلغ")} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <FormField label={t("Notes (optionnel)", "ملاحظات (اختياري)")} value={notes} onChangeText={setNotes} multiline />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SheetModal>

      <SheetModal
        visible={sheet === "adjust"}
        onClose={closeSheet}
        title={t("Ajustement de solde", "تعديل الرصيد")}
        footer={
          <Button
            label={t("Confirmer", "تأكيد")}
            onPress={submitAdjust}
            loading={adjust.isPending}
            testID="button-submit-adjust"
          />
        }
      >
        <Text style={styles.mutedSmall}>{t("Solde actuel", "الرصيد الحالي")}: {Number(caisse.balance).toLocaleString("fr-FR")} {currency}</Text>
        <FormField label={t("Solde cible", "الرصيد المستهدف")} value={targetBalance} onChangeText={setTargetBalance} keyboardType="decimal-pad" />
        <FormField label={t("Notes (optionnel)", "ملاحظات (اختياري)")} value={notes} onChangeText={setNotes} multiline />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balance: { fontSize: 26, fontWeight: "700", color: colors.primary, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  actionsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  label: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
  value: { fontSize: 16, fontWeight: "600", color: colors.text },
  mutedSmall: { fontSize: 12, color: colors.textMuted },
  movReason: { fontSize: 14, fontWeight: "600", color: colors.text },
  movAmount: { fontSize: 14, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 13, textAlign: "center", marginTop: 6 },
});

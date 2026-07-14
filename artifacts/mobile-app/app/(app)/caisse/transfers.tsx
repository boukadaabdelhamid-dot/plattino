import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetErpCaisseTransfers,
  useAcceptErpCaisseTransfer,
  useRejectErpCaisseTransfer,
  useCancelErpCaisseTransfer,
  getGetErpCaisseTransfersQueryKey,
  getGetErpCaissesQueryKey,
  type GetErpCaisseTransfersBox,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useMe } from "@/hooks/use-me";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useConfirm } from "@/contexts/confirm-context";
import { ListScreen } from "@/components/ListScreen";
import { Card, Button, Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";
import { colors } from "@/lib/colors";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  pending: "warning",
  accepted: "success",
  rejected: "danger",
  cancelled: "muted",
};

const STATUS_LABEL: Record<string, [string, string]> = {
  pending: ["En attente", "قيد الانتظار"],
  accepted: ["Accepté", "مقبول"],
  rejected: ["Rejeté", "مرفوض"],
  cancelled: ["Annulé", "ملغى"],
};

export default function CaisseTransfers() {
  const { ready, isAdmin } = useProtectedRoute({ section: "caisse" });
  const { t, lang } = useLang();
  const { user } = useMe();
  const router = useRouter();
  const feedback = useApiFeedback();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const currency = lang === "ar" ? "دج" : "DA";

  const [box, setBox] = useState<GetErpCaisseTransfersBox>("inbox");

  const params = { box };
  const { data, isLoading, refetch, isRefetching } = useGetErpCaisseTransfers(params, {
    query: { enabled: ready, queryKey: getGetErpCaisseTransfersQueryKey(params) },
  });

  const accept = useAcceptErpCaisseTransfer();
  const reject = useRejectErpCaisseTransfer();
  const cancel = useCancelErpCaisseTransfer();

  if (!ready) return null;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetErpCaisseTransfersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetErpCaissesQueryKey() });
    refetch();
  }

  function handleAccept(id: number) {
    accept.mutate(
      { id },
      {
        onSuccess: () => {
          feedback.success("Transfert accepté", "تم قبول التحويل");
          invalidate();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  async function handleReject(id: number) {
    const ok = await confirm({
      title: t("Rejeter le transfert", "رفض التحويل"),
      message: t("Les fonds seront retournés à l'expéditeur.", "سيتم إرجاع الأموال إلى المرسل."),
      destructive: true,
    });
    if (!ok) return;
    reject.mutate(
      { id },
      {
        onSuccess: () => {
          feedback.success("Transfert rejeté", "تم رفض التحويل");
          invalidate();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  async function handleCancel(id: number) {
    const ok = await confirm({
      title: t("Annuler le transfert", "إلغاء التحويل"),
      message: t("Les fonds retourneront dans votre caisse.", "ستعود الأموال إلى صندوقك."),
      destructive: true,
    });
    if (!ok) return;
    cancel.mutate(
      { id },
      {
        onSuccess: () => {
          feedback.success("Transfert annulé", "تم إلغاء التحويل");
          invalidate();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={data ?? []}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(tr) => String(tr.id)}
        emptyTitle={t("Aucun transfert", "لا توجد تحويلات")}
        header={
          <View style={styles.tabRow}>
            <Button label={t("Reçus", "واردة")} variant={box === "inbox" ? "primary" : "secondary"} onPress={() => setBox("inbox")} style={{ flex: 1 }} testID="button-box-inbox" />
            <Button label={t("Envoyés", "صادرة")} variant={box === "outbox" ? "primary" : "secondary"} onPress={() => setBox("outbox")} style={{ flex: 1 }} testID="button-box-outbox" />
            {isAdmin ? (
              <Button label={t("Tous", "الكل")} variant={box === "all" ? "primary" : "secondary"} onPress={() => setBox("all")} style={{ flex: 1 }} testID="button-box-all" />
            ) : null}
          </View>
        }
        renderItem={(tr: any) => {
          const senderLabel = tr.senderCaisse?.kind === "main" ? t("Caisse principale", "الصندوق الرئيسي") : (tr.senderCaisse?.owner?.name ?? "—");
          const recipientLabel = tr.recipientCaisse?.kind === "main" ? t("Caisse principale", "الصندوق الرئيسي") : (tr.recipientCaisse?.owner?.name ?? "—");
          const [fr, ar] = STATUS_LABEL[tr.status] ?? [tr.status, tr.status];
          const isPending = tr.status === "pending";
          const iAmRecipient = box === "inbox" || tr.recipientCaisse?.owner?.id === user?.id || (isAdmin && tr.recipientCaisse?.kind === "main");
          const iAmSender = box === "outbox" || tr.requestedByUserId === user?.id;
          return (
            <Card style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.amount}>{Number(tr.amount).toLocaleString("fr-FR")} {currency}</Text>
                <Badge label={t(fr, ar)} tone={STATUS_TONE[tr.status] ?? "muted"} />
              </View>
              <Text style={styles.mutedSmall}>{senderLabel} → {recipientLabel}</Text>
              <Text style={styles.mutedSmall}>{new Date(tr.createdAt).toLocaleString("fr-FR")}</Text>
              {tr.notes ? <Text style={styles.mutedSmall}>{tr.notes}</Text> : null}
              {isPending ? (
                <View style={styles.actionsRow}>
                  {iAmRecipient ? (
                    <>
                      <Button label={t("Accepter", "قبول")} onPress={() => handleAccept(tr.id)} loading={accept.isPending} style={{ flex: 1 }} testID={`button-accept-${tr.id}`} />
                      <Button label={t("Rejeter", "رفض")} variant="danger" onPress={() => handleReject(tr.id)} loading={reject.isPending} style={{ flex: 1 }} testID={`button-reject-${tr.id}`} />
                    </>
                  ) : iAmSender ? (
                    <Button label={t("Annuler", "إلغاء")} variant="danger" onPress={() => handleCancel(tr.id)} loading={cancel.isPending} style={{ flex: 1 }} testID={`button-cancel-${tr.id}`} />
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        }}
      />
      <Fab onPress={() => router.push("/caisse/transfer-new" as never)} icon="send" testID="button-new-transfer-fab" />
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 4 },
  card: { marginHorizontal: 16, marginTop: 12, gap: 6 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  amount: { fontSize: 17, fontWeight: "700", color: colors.text },
  mutedSmall: { fontSize: 12, color: colors.textMuted },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 6 },
});

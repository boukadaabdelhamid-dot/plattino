import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useGetErpCaisses, useGetErpCaisseTransfers, getGetErpCaissesQueryKey, getGetErpCaisseTransfersQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useMe } from "@/hooks/use-me";
import { ListScreen } from "@/components/ListScreen";
import { Card, Button, Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";
import { colors } from "@/lib/colors";

export default function CaisseList() {
  const { ready } = useProtectedRoute({ section: "caisse" });
  const { t, lang } = useLang();
  const { user, isAdmin } = useMe();
  const router = useRouter();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data, isLoading, refetch, isRefetching } = useGetErpCaisses({
    query: { enabled: ready, queryKey: getGetErpCaissesQueryKey() },
  });

  const inboxParams = { box: "inbox" as const };
  const { data: inbox } = useGetErpCaisseTransfers(inboxParams, {
    query: { enabled: ready, queryKey: getGetErpCaisseTransfersQueryKey(inboxParams) },
  });
  const pendingCount = (inbox ?? []).filter((tr: any) => tr.status === "pending").length;

  if (!ready) return null;

  const caisses = data ?? [];
  const myCaisse = caisses.find((c: any) => c.ownerUserId === user?.id) ?? null;

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={caisses}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(c: any) => String(c.id)}
        emptyTitle={t("Aucune caisse", "لا توجد صناديق")}
        header={
          <View style={styles.headerRow}>
            <Button
              label={t("Transferts", "التحويلات")}
              variant="secondary"
              onPress={() => router.push("/caisse/transfers" as never)}
              style={{ flex: 1 }}
              testID="button-caisse-transfers"
              icon={pendingCount > 0 ? <Badge label={String(pendingCount)} tone="danger" /> : undefined}
            />
          </View>
        }
        renderItem={(c: any) => (
          <Card style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {c.kind === "main"
                    ? t("Caisse principale", "الصندوق الرئيسي")
                    : c.ownerUserId === user?.id
                    ? t("Ma caisse", "صندوقي")
                    : (c.owner?.name ?? t("Caisse personnelle", "صندوق شخصي"))}
                </Text>
                <Text style={styles.sub}>
                  {c.kind === "main" ? t("Lecture partagée", "قراءة مشتركة") : (c.owner?.name ?? "—")}
                </Text>
              </View>
              <Text style={styles.balance}>{Number(c.balance ?? 0).toLocaleString("fr-FR")} {currency}</Text>
            </View>
            <View style={styles.actionsRow}>
              <Button
                label={t("Détails", "التفاصيل")}
                variant="secondary"
                onPress={() => router.push(`/caisse/${c.id}` as never)}
                style={{ flex: 1 }}
                testID={`button-details-${c.id}`}
              />
              {(isAdmin || c.ownerUserId === user?.id) ? (
                <Button
                  label={t("Envoyer", "إرسال")}
                  onPress={() =>
                    router.push({
                      pathname: "/caisse/transfer-new" as never,
                      params: c.kind === "main" ? { fromMain: "1" } : {},
                    } as never)
                  }
                  style={{ flex: 1 }}
                  testID={`button-send-${c.id}`}
                />
              ) : null}
            </View>
          </Card>
        )}
      />
      {myCaisse ? (
        <Fab onPress={() => router.push("/caisse/transfer-new" as never)} icon="send" testID="button-new-transfer" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 4 },
  card: { marginHorizontal: 16, marginTop: 12, gap: 10 },
  cardTop: { flexDirection: "row", alignItems: "center" },
  name: { fontSize: 15, fontWeight: "600", color: colors.text },
  sub: { fontSize: 11, color: colors.textMuted },
  balance: { fontSize: 17, fontWeight: "700", color: colors.primary },
  actionsRow: { flexDirection: "row", gap: 8 },
});

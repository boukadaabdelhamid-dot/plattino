import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useGetErpCaisses, getGetErpCaissesQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { Card } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function CaisseList() {
  const { ready } = useProtectedRoute({ section: "caisse" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data, isLoading, refetch, isRefetching } = useGetErpCaisses({
    query: { enabled: ready, queryKey: getGetErpCaissesQueryKey() },
  });

  if (!ready) return null;

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(c: any) => String(c.id)}
      emptyTitle={t("Aucune caisse", "لا توجد صناديق")}
      renderItem={(c: any) => (
        <Card style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{c.kind === "main" ? t("Caisse principale", "الصندوق الرئيسي") : (c.owner?.name ?? t("Caisse personnelle", "صندوق شخصي"))}</Text>
            <Text style={styles.sub}>{t("Solde", "الرصيد")}</Text>
          </View>
          <Text style={styles.balance}>{Number(c.balance ?? 0).toLocaleString("fr-FR")} {currency}</Text>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 12 },
  name: { fontSize: 15, fontWeight: "600", color: colors.text },
  sub: { fontSize: 11, color: colors.textMuted },
  balance: { fontSize: 17, fontWeight: "700", color: colors.primary },
});

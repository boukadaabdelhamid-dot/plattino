import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { useGetAnalytics, getGetAnalyticsQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, LoadingView, SectionTitle } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function Reports() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data, isLoading, refetch, isRefetching } = useGetAnalytics({
    query: { enabled: ready, queryKey: getGetAnalyticsQueryKey() },
  });

  if (!ready) return null;

  const stats: { label: string; value: string; color?: string }[] = data
    ? [
        { label: t("Commandes", "الطلبات"), value: String(data.totalOrders) },
        { label: t("Chiffre d'affaires", "رقم الأعمال"), value: `${data.totalRevenue.toLocaleString("fr-FR")} ${currency}` },
        { label: t("Coût des ventes", "تكلفة المبيعات"), value: `${(data.totalCogs ?? 0).toLocaleString("fr-FR")} ${currency}` },
        { label: t("Retours", "المرتجعات"), value: `${(data.totalRetours ?? 0).toLocaleString("fr-FR")} ${currency}` },
        { label: t("Marge brute", "الهامش الإجمالي"), value: `${(data.grossMargin ?? 0).toFixed(1)}%` },
        { label: t("Bénéfice net", "صافي الربح"), value: `${data.netProfit.toLocaleString("fr-FR")} ${currency}`, color: colors.primary },
      ]
    : [];

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      {isLoading ? (
        <LoadingView />
      ) : (
        <Card>
          <SectionTitle>{t("Analyse (30 derniers jours)", "التحليلات (آخر 30 يومًا)")}</SectionTitle>
          <View style={{ gap: 10 }}>
            {stats.map((s) => (
              <View key={s.label} style={styles.row}>
                <Text style={styles.label}>{s.label}</Text>
                <Text style={[styles.value, s.color ? { color: s.color } : null]}>{s.value}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 },
  label: { fontSize: 13, color: colors.textMuted },
  value: { fontSize: 14, fontWeight: "700", color: colors.text },
});

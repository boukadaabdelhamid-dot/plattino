import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  useGetDashboardGeneral,
  useGetLowStock,
  useGetMonthlyReport,
  getGetDashboardGeneralQueryKey,
  getGetLowStockQueryKey,
  getGetMonthlyReportQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, LoadingView, SectionTitle, Badge } from "@/components/ui";
import { colors } from "@/lib/colors";

function money(n: number | undefined | null, currency: string) {
  return `${(n ?? 0).toLocaleString("fr-FR")} ${currency}`;
}

export default function Dashboard() {
  const { ready } = useProtectedRoute({ section: "dashboard" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data: general, isLoading: loadingGeneral, refetch: refetchGeneral, isRefetching } = useGetDashboardGeneral({
    query: { enabled: ready, queryKey: getGetDashboardGeneralQueryKey() },
  });
  const { data: lowStock, isLoading: loadingLowStock } = useGetLowStock(undefined, {
    query: { enabled: ready, queryKey: getGetLowStockQueryKey() },
  });
  const { data: monthly, isLoading: loadingMonthly } = useGetMonthlyReport(undefined, {
    query: { enabled: ready, queryKey: getGetMonthlyReportQueryKey() },
  });

  if (!ready) return <LoadingView />;

  const loading = loadingGeneral || loadingLowStock || loadingMonthly;

  return (
    <Screen onRefresh={refetchGeneral} refreshing={isRefetching}>
      {loading ? (
        <LoadingView />
      ) : (
        <>
          <Card>
            <SectionTitle>{t("Valeur du stock", "قيمة المخزون")}</SectionTitle>
            <Text style={styles.bigNumber}>{money(general?.stockValue, currency)}</Text>
          </Card>

          {monthly ? (
            <Card>
              <SectionTitle>{t("Rapport du mois", "تقرير الشهر")}</SectionTitle>
              <View style={styles.statsRow}>
                {Object.entries(monthly as unknown as Record<string, unknown>)
                  .filter(([, v]) => typeof v === "number")
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <View key={k} style={styles.statItem}>
                      <Text style={styles.statLabel}>{k}</Text>
                      <Text style={styles.statValue}>{money(v as number, currency)}</Text>
                    </View>
                  ))}
              </View>
            </Card>
          ) : null}

          <Card>
            <SectionTitle>{t("Alertes stock faible", "تنبيهات نقص المخزون")}</SectionTitle>
            {!lowStock || lowStock.length === 0 ? (
              <Text style={styles.muted}>{t("Aucune alerte", "لا توجد تنبيهات")}</Text>
            ) : (
              lowStock.slice(0, 10).map((p: any) => (
                <View key={p.id} style={styles.lowStockRow}>
                  <Text style={styles.lowStockName} numberOfLines={1}>{p.name ?? p.nameFr ?? `#${p.id}`}</Text>
                  <Badge label={String(p.stock ?? p.quantity ?? 0)} tone="danger" />
                </View>
              ))
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bigNumber: { fontSize: 26, fontWeight: "700", color: colors.primary },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  statItem: { minWidth: "40%" },
  statLabel: { fontSize: 11, color: colors.textMuted, textTransform: "capitalize" },
  statValue: { fontSize: 15, fontWeight: "600", color: colors.text },
  muted: { color: colors.textMuted, fontSize: 13 },
  lowStockRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  lowStockName: { flex: 1, fontSize: 14, color: colors.text, marginRight: 8 },
});

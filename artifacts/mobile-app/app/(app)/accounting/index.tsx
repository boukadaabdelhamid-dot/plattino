import React from "react";
import { Text, StyleSheet } from "react-native";
import { useGetAccountingSummary, getGetAccountingSummaryQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, LoadingView, SectionTitle } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function Accounting() {
  const { ready } = useProtectedRoute({ section: "accounting" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data, isLoading, refetch, isRefetching } = useGetAccountingSummary({
    query: { enabled: ready, queryKey: getGetAccountingSummaryQueryKey() },
  });

  if (!ready) return null;

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      {isLoading ? (
        <LoadingView />
      ) : (
        <>
          <Card>
            <SectionTitle>{t("Revenus totaux", "إجمالي الدخل")}</SectionTitle>
            <Text style={[styles.big, { color: "#15803D" }]}>{Number(data?.totalIncome ?? 0).toLocaleString("fr-FR")} {currency}</Text>
          </Card>
          <Card>
            <SectionTitle>{t("Dépenses totales", "إجمالي المصاريف")}</SectionTitle>
            <Text style={[styles.big, { color: colors.danger }]}>{Number(data?.totalExpenses ?? 0).toLocaleString("fr-FR")} {currency}</Text>
          </Card>
          <Card>
            <SectionTitle>{t("Solde (Grand Livre)", "الرصيد (السجل العام)")}</SectionTitle>
            <Text style={styles.big}>{Number(data?.netBalance ?? 0).toLocaleString("fr-FR")} {currency}</Text>
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 24, fontWeight: "700", color: colors.primary },
});

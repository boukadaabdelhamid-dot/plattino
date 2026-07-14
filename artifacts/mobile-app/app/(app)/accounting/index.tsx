import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import {
  useGetAccountingSummary,
  useGetTransactions,
  getGetAccountingSummaryQueryKey,
  getGetTransactionsQueryKey,
  type Transaction,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { Card, LoadingView, SectionTitle, Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";
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

export default function Accounting() {
  const { ready, can } = useProtectedRoute({ section: "accounting" });
  const { t, lang } = useLang();
  const router = useRouter();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useGetAccountingSummary({
    query: { enabled: ready, queryKey: getGetAccountingSummaryQueryKey() },
  });

  const { data: transactions, isLoading, refetch, isRefetching } = useGetTransactions({
    query: { enabled: ready, queryKey: getGetTransactionsQueryKey() },
  });

  if (!ready) return null;

  const sorted = [...(transactions ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const canCreate = can("accounting", "create");

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={sorted}
        isLoading={isLoading || summaryLoading}
        onRefresh={() => {
          refetch();
          refetchSummary();
        }}
        refreshing={isRefetching}
        keyExtractor={(tx) => String(tx.id)}
        emptyTitle={t("Aucune transaction", "لا توجد معاملات")}
        header={
          <View style={styles.summaryWrap}>
            <View style={styles.summaryRow}>
              <Card style={{ flex: 1 }}>
                <SectionTitle>{t("Revenus", "الدخل")}</SectionTitle>
                <Text style={[styles.big, { color: "#15803D" }]}>{Number(summary?.totalIncome ?? 0).toLocaleString("fr-FR")} {currency}</Text>
              </Card>
              <Card style={{ flex: 1 }}>
                <SectionTitle>{t("Dépenses", "المصاريف")}</SectionTitle>
                <Text style={[styles.big, { color: colors.danger }]}>{Number(summary?.totalExpenses ?? 0).toLocaleString("fr-FR")} {currency}</Text>
              </Card>
            </View>
            <Card style={{ marginTop: 12, marginHorizontal: 16 }}>
              <SectionTitle>{t("Solde (Grand Livre)", "الرصيد (السجل العام)")}</SectionTitle>
              <Text style={styles.big}>{Number(summary?.netBalance ?? 0).toLocaleString("fr-FR")} {currency}</Text>
            </Card>
            <Text style={styles.listTitle}>{t("Transactions", "المعاملات")}</Text>
          </View>
        }
        renderItem={(tx: Transaction) => {
          const [fr, ar] = CATEGORY_LABEL[tx.category] ?? [tx.category, tx.category];
          const isIncome = tx.type === "income";
          return (
            <Card style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.desc} numberOfLines={1}>{tx.description}</Text>
                <Text style={[styles.amount, { color: isIncome ? "#15803D" : colors.danger }]}>
                  {isIncome ? "+" : "-"}{Number(tx.amount).toLocaleString("fr-FR")} {currency}
                </Text>
              </View>
              <View style={styles.rowBetween}>
                <Badge label={t(fr, ar)} tone={isIncome ? "success" : "danger"} />
                <Text style={styles.mutedSmall}>{new Date(tx.date).toLocaleDateString("fr-FR")}</Text>
              </View>
              {tx.reference ? <Text style={styles.mutedSmall}>{tx.reference}</Text> : null}
            </Card>
          );
        }}
      />
      {canCreate ? (
        <Fab onPress={() => router.push("/accounting/transaction-new" as never)} testID="button-new-transaction" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryWrap: { paddingTop: 16 },
  summaryRow: { flexDirection: "row", gap: 12, paddingHorizontal: 16 },
  big: { fontSize: 20, fontWeight: "700", color: colors.primary, marginTop: 2 },
  listTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginHorizontal: 16, marginTop: 18, marginBottom: 4 },
  card: { marginHorizontal: 16, marginTop: 12, gap: 6 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  desc: { fontSize: 14, fontWeight: "600", color: colors.text, flex: 1 },
  amount: { fontSize: 15, fontWeight: "700" },
  mutedSmall: { fontSize: 11.5, color: colors.textMuted },
});
